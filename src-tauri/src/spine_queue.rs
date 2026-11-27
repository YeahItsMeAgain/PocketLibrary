//! Automatic spine queue worker and events.
//!
//! The ordering state machine and its restart file live in
//! `pocketlibrary_core::spine_queue`, which has no Tauri or ONNX dependency and
//! is covered by host tests. This module owns the single worker, the model
//! readiness gate and the `spine://queue` / `spine://progress` events.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use pocketlibrary_core::spine_queue::{self, BackfillFlag, QueueCore, QueueStage};
use pocketlibrary_core::{Api, ApiError};
use pocketlibrary_spine::Stage;

use crate::spine_assets;
use crate::spine_service::{BUNDLE_ID, SpineService};

pub const QUEUE_EVENT: &str = "spine://queue";
pub const PROGRESS_EVENT: &str = "spine://progress";

pub use pocketlibrary_core::spine_queue::{
    QueueProgress as SpineProgress, QueueState as SpineQueueState,
};

/// One queue line in `<app data>/spine/spine.log`.
///
/// Every enqueue, skip, start, success and failure goes through here, so the
/// log always answers "what happened to book N?" without needing logcat.
fn log_queue_event(
    app_data_dir: &Path,
    action: &str,
    book_id: i64,
    title: &str,
    code: &str,
    message: &str,
) {
    let line =
        format!("queue {action}: book {book_id} title={title:?} code={code} message={message:?}");
    // Keep stderr for `cargo tauri dev` and logcat; the file survives the app
    // being closed and is the line a user can send us later.
    eprintln!("pocketlibrary spine {line}");
    spine_assets::log(app_data_dir, &line);
}

fn book_title(api: &Api, book_id: i64) -> String {
    api.book(book_id)
        .map(|book| book.title)
        .unwrap_or_else(|_| "unknown title".to_owned())
}

fn stage_from_engine(stage: Stage) -> QueueStage {
    match stage {
        Stage::Art => QueueStage::Art,
        Stage::Text => QueueStage::Text,
        Stage::Check => QueueStage::Check,
    }
}

/// The managed automatic queue.
pub struct SpineQueue {
    core: Mutex<QueueCore>,
    backfill: Mutex<BackfillFlag>,
    app_data_dir: PathBuf,
    app: AppHandle,
    worker_running: AtomicBool,
    /// The launch repair has already compared the catalogue to the cache.
    repair_done: AtomicBool,
}

impl SpineQueue {
    pub fn new(app_data_dir: PathBuf, app: AppHandle) -> Self {
        let mut core = QueueCore::default();
        let (restored, failures) = spine_queue::load_queue(&spine_queue::queue_path(&app_data_dir));
        core.enqueue(restored);
        core.restore_failures(failures);
        let backfill = BackfillFlag::load(&app_data_dir);
        core.set_backfill_pending(backfill.is_pending(BUNDLE_ID));
        Self {
            core: Mutex::new(core),
            backfill: Mutex::new(backfill),
            app_data_dir,
            app,
            worker_running: AtomicBool::new(false),
            repair_done: AtomicBool::new(false),
        }
    }

    pub fn snapshot(&self) -> SpineQueueState {
        match self.core.lock() {
            Ok(core) => core.snapshot(),
            Err(_) => SpineQueueState {
                running: false,
                paused: true,
                pending: 0,
                completed: 0,
                failed: 0,
                current_book_id: None,
                stage: None,
                backfill_pending: false,
                attention: Vec::new(),
            },
        }
    }

    /// Idempotently add books. Cached books are skipped when the worker peeks
    /// at them, so the caller does not need to hash every cover first.
    ///
    /// Each requested book gets one log line, including the title, so the log
    /// explains both work that was queued and work that was already waiting.
    pub fn enqueue(&self, books: Vec<(i64, String)>) {
        let ids: Vec<i64> = books.iter().map(|(id, _)| *id).collect();
        for (book_id, title) in &books {
            log_queue_event(
                &self.app_data_dir,
                "enqueue",
                *book_id,
                title,
                "queued",
                "automatic spine job requested",
            );
        }
        let changed = match self.core.lock() {
            Ok(mut core) => core.enqueue(ids) > 0,
            Err(_) => false,
        };
        if changed {
            self.persist();
            self.emit_queue();
        }
        self.kick();
    }

    /// Clear failed state and queue the books again. This is the explicit
    /// Retry path, so the old error disappears before the new job starts.
    pub fn retry(&self, books: Vec<(i64, String)>) {
        if books.is_empty() {
            return;
        }
        {
            if let Ok(mut core) = self.core.lock() {
                for (book_id, _) in &books {
                    core.clear_failure(*book_id);
                }
            }
        }
        for (book_id, title) in &books {
            log_queue_event(
                &self.app_data_dir,
                "retry",
                *book_id,
                title,
                "retry",
                "failed spine job cleared for another attempt",
            );
        }
        self.persist();
        self.emit_queue();
        self.enqueue(books);
    }

    /// Clear a book's failure when the user starts an explicit generation.
    pub fn clear_failure(&self, book_id: i64) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.clear_failure(book_id),
            Err(_) => false,
        };
        if changed {
            self.persist();
            self.emit_queue();
        }
    }

    /// Queue every book that has no complete strip yet, once per launch.
    ///
    /// The flag in `backfill.json` still records the one-time full-library
    /// backfill, but a warm install can have the flag cleared while books
    /// imported later (or a cache trimmed/gone) still lack art. The repair
    /// check is therefore unconditional and cheap: it reads
    /// `artifact.json` ids, never hashes covers or runs inference. Cached
    /// books are not enqueued; the queue core dedupes the rest.
    ///
    /// A book without a usable cover is still enqueued: the worker repairs or
    /// re-extracts the cover before generation, and only then may it fail with
    /// a visible needs-cover reason.
    pub fn backfill_once(&self, api: &Api, service: &SpineService) {
        if self.repair_done.swap(true, Ordering::SeqCst) {
            return;
        }
        let books = match api.list_books() {
            Ok(books) => books,
            Err(error) => {
                // Leave the flag pending: the next launch (or the frontend
                // fallback) can retry without a permanent skip.
                self.repair_done.store(false, Ordering::SeqCst);
                spine_assets::log(
                    &self.app_data_dir,
                    &format!(
                        "queue backfill: catalogue read failed code={} message={:?}",
                        error.code, error.message
                    ),
                );
                return;
            }
        };
        let shelf_ready = service.shelf_book_ids();
        let mut entries = Vec::new();
        for book in books {
            if shelf_ready.contains(&book.id) {
                log_queue_event(
                    &self.app_data_dir,
                    "skip",
                    book.id,
                    &book.title,
                    "cached",
                    "a shelf-eligible cached strip already exists",
                );
                continue;
            }
            if !self.automatic_attempt_due(book.id) {
                log_queue_event(
                    &self.app_data_dir,
                    "skip",
                    book.id,
                    &book.title,
                    "attention-cap",
                    "automatic attempts exhausted; waiting for Retry",
                );
                continue;
            }
            entries.push((book.id, book.title));
        }
        spine_assets::log(
            &self.app_data_dir,
            &format!(
                "queue backfill: {} shelf-ready, enqueueing {} book(s)",
                shelf_ready.len(),
                entries.len()
            ),
        );
        self.enqueue(entries);
        self.finish_backfill();
    }

    fn finish_backfill(&self) {
        let marked = match self.backfill.lock() {
            Ok(mut flag) => flag.mark_done(BUNDLE_ID),
            Err(_) => return,
        };
        match marked {
            Ok(()) => {
                if let Ok(mut core) = self.core.lock() {
                    core.set_backfill_pending(false);
                }
                self.emit_queue();
            }
            Err(error) => {
                // The in-memory queue already has the work. Keeping the flag
                // pending only means a harmless re-enqueue next launch.
                spine_assets::log(
                    &self.app_data_dir,
                    &format!("queue backfill: persist flag failed message={error:?}"),
                );
            }
        }
    }

    /// An explicit generate jumps the queue by leaving it.
    pub fn remove(&self, book_id: i64) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.remove(book_id),
            Err(_) => false,
        };
        if changed {
            self.persist();
            self.emit_queue();
        }
    }

    pub fn set_paused(&self, paused: bool) {
        if let Ok(mut core) = self.core.lock() {
            core.set_paused(paused);
        }
        self.emit_queue();
        if !paused {
            self.kick();
        }
    }

    fn has_work(&self) -> bool {
        self.core
            .lock()
            .map(|core| core.can_start())
            .unwrap_or(false)
    }

    fn is_waiting(&self) -> bool {
        self.core
            .lock()
            .map(|core| core.is_waiting())
            .unwrap_or(false)
    }

    fn peek(&self) -> Option<i64> {
        self.core.lock().ok().and_then(|core| core.peek())
    }

    /// Automatic attempts already spent on this book.
    fn attempts(&self, book_id: i64) -> u32 {
        self.core
            .lock()
            .map(|core| core.attempts(book_id))
            .unwrap_or(0)
    }

    fn automatic_attempt_due(&self, book_id: i64) -> bool {
        self.core
            .lock()
            .map(|core| core.automatic_attempt_due(book_id))
            .unwrap_or(true)
    }

    fn persist(&self) {
        let ids = match self.core.lock() {
            Ok(core) => core.persist_ids(),
            Err(_) => return,
        };
        let attention = self
            .core
            .lock()
            .map(|core| core.attention().to_vec())
            .unwrap_or_default();
        if let Err(error) = spine_queue::save_queue(
            &spine_queue::queue_path(&self.app_data_dir),
            &ids,
            &attention,
        ) {
            spine_assets::log(
                &self.app_data_dir,
                &format!("queue persist: failed message={error:?}"),
            );
        }
    }

    fn emit_queue(&self) {
        let state = self.snapshot();
        if let Err(error) = self.app.emit(QUEUE_EVENT, state) {
            spine_assets::log(
                &self.app_data_dir,
                &format!("queue emit: {QUEUE_EVENT} failed message={error:?}"),
            );
        }
    }

    fn emit_progress(&self, progress: SpineProgress) {
        if let Err(error) = self.app.emit(PROGRESS_EVENT, progress) {
            spine_assets::log(
                &self.app_data_dir,
                &format!("queue emit: {PROGRESS_EVENT} failed message={error:?}"),
            );
        }
    }

    fn stage_started(&self, book_id: i64, stage: Stage) {
        let stage = stage_from_engine(stage);
        let progress = match self.core.lock() {
            Ok(mut core) => {
                core.set_stage(book_id, stage);
                core.progress(book_id, stage)
            }
            Err(_) => return,
        };
        self.emit_progress(progress);
        self.emit_queue();
    }

    fn begin_next(&self) -> Option<i64> {
        let id = match self.core.lock() {
            Ok(mut core) => core.take_next(),
            Err(_) => None,
        }?;
        self.persist();
        self.emit_queue();
        Some(id)
    }

    fn skip_cached(&self, book_id: i64, title: &str) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.skip_front(book_id),
            Err(_) => false,
        };
        if changed {
            log_queue_event(
                &self.app_data_dir,
                "skip",
                book_id,
                title,
                "cached",
                "worker found a shelf-eligible cached strip",
            );
            self.persist();
            self.emit_queue();
        }
    }

    /// The book has used its automatic attempts and the failure is already in
    /// `attention`. Drop it from pending without running inference again; the
    /// row stays visible until the user retries.
    fn skip_attention_capped(&self, book_id: i64, title: &str, attempts: u32) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.skip_front(book_id),
            Err(_) => false,
        };
        if changed {
            log_queue_event(
                &self.app_data_dir,
                "skip",
                book_id,
                title,
                "attention-cap",
                &format!(
                    "automatic attempts exhausted ({attempts}/{}); waiting for Retry",
                    pocketlibrary_core::spine_queue::MAX_AUTOMATIC_ATTEMPTS
                ),
            );
            self.persist();
            self.emit_queue();
        }
    }

    fn finish_job(&self, ok: bool, code: &str, error: &str, title: &str) {
        let book_id = self.snapshot().current_book_id;
        if let Ok(mut core) = self.core.lock() {
            if ok {
                core.complete_current();
            } else {
                core.fail_current(code, error);
            }
        }
        if let Some(book_id) = book_id {
            if ok {
                log_queue_event(
                    &self.app_data_dir,
                    "success",
                    book_id,
                    title,
                    "ok",
                    "spine strip generated and cached",
                );
            } else {
                log_queue_event(&self.app_data_dir, "failure", book_id, title, code, error);
            }
        }
        self.persist();
        self.emit_queue();
    }

    fn mark_waiting(&self) {
        if let Ok(mut core) = self.core.lock() {
            core.mark_waiting();
        }
        self.persist();
        self.emit_queue();
    }

    /// Start the single worker if it is not already running. Safe to call from
    /// enqueue, resume, status and startup.
    pub fn kick(&self) {
        if self.worker_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = self.app.clone();
        tauri::async_runtime::spawn_blocking(move || run_worker(app));
    }

    fn worker_done(&self) {
        self.worker_running.store(false, Ordering::SeqCst);
        // An enqueue can land in the gap between the drain and this store.
        // Restart only when there is real startable work; a waiting queue needs
        // an explicit kick once models resolve.
        if self.has_work() && !self.is_waiting() {
            self.kick();
        }
    }
}

fn run_worker(app: AppHandle) {
    loop {
        let queue = app.state::<SpineQueue>();
        if !queue.has_work() {
            break;
        }
        let service = app.state::<SpineService>();
        // Models are required. Keep jobs pending instead of dropping them; a
        // later status check or enqueue kicks the worker again.
        if !service.models_ready() {
            queue.mark_waiting();
            break;
        }
        let Some(book_id) = queue.peek() else {
            break;
        };
        let api = app.state::<Api>();
        let title = book_title(api.inner(), book_id);
        if service.is_cached(book_id, api.inner()) {
            queue.skip_cached(book_id, &title);
            continue;
        }
        // A fallback or unprojectable artifact has already failed. Retry it
        // automatically only while it has attempts left; after that the
        // attention row is the user-visible truth and Retry resets it.
        if !queue.automatic_attempt_due(book_id) {
            let attempts = queue.attempts(book_id);
            queue.skip_attention_capped(book_id, &title, attempts);
            continue;
        }
        let Some(book_id) = queue.begin_next() else {
            break;
        };
        log_queue_event(
            &queue.app_data_dir,
            "start",
            book_id,
            &title,
            "started",
            "generation began",
        );
        let result = service.generate_with_progress(book_id, api.inner(), |stage| {
            queue.stage_started(book_id, stage);
        });
        match result {
            Ok(artifact) if artifact.verdict == "fallback" => {
                // The engine completed, but its QA gate rejected the art. That
                // is not a success: count it as an automatic failure so the
                // chip, marker and Settings explain why cloth is still shown.
                queue.finish_job(
                    false,
                    "spine_fallback",
                    "The quality check rejected this spine, so the cloth spine is still shown. Retry to try again.",
                    &title,
                );
            }
            Ok(_) => queue.finish_job(true, "ok", "", &title),
            Err(error) => {
                queue.finish_job(false, error.code, &error.message, &title);
            }
        }
    }
    app.state::<SpineQueue>().worker_done();
}

/// Explicit retry for the chip and the Settings panel. The shell clears each
/// failed state before handing the books back to the queue.
#[tauri::command]
pub async fn spine_retry(app: AppHandle, book_ids: Vec<i64>) -> Result<(), ApiError> {
    let api = app.state::<Api>();
    let books = book_ids
        .into_iter()
        .filter_map(|book_id| api.book(book_id).ok().map(|book| (book.id, book.title)))
        .collect::<Vec<_>>();
    app.state::<SpineQueue>().retry(books);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failure_line_names_the_book_code_and_message() {
        let temp = tempfile::tempdir().expect("tempdir");
        log_queue_event(
            temp.path(),
            "failure",
            42,
            "The Book & Its Title",
            "cover_missing",
            "This book has no cover to build a spine from.",
        );
        let log = std::fs::read_to_string(spine_assets::log_path(temp.path()))
            .expect("spine.log written");
        assert!(log.contains("queue failure: book 42"));
        assert!(log.contains("title=\"The Book & Its Title\""));
        assert!(log.contains("code=cover_missing"));
        assert!(log.contains("This book has no cover"));
    }

    #[test]
    fn every_queue_event_is_one_line() {
        let temp = tempfile::tempdir().expect("tempdir");
        for action in ["enqueue", "skip", "start", "success"] {
            log_queue_event(
                temp.path(),
                action,
                action.len() as i64,
                "A Book",
                "ok",
                "message",
            );
        }
        let log = std::fs::read_to_string(spine_assets::log_path(temp.path()))
            .expect("spine.log written");
        assert_eq!(log.lines().count(), 4);
        assert!(log.contains("queue enqueue:"));
        assert!(log.contains("queue skip:"));
        assert!(log.contains("queue start:"));
        assert!(log.contains("queue success:"));
    }
}
