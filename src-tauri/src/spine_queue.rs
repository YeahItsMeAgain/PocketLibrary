//! Automatic spine queue worker and events.
//!
//! The ordering state machine and its restart file live in
//! `pocketlibrary_core::spine_queue`, which has no Tauri or ONNX dependency and
//! is covered by host tests. This module owns the single worker, the model
//! readiness gate and the `spine://queue` / `spine://progress` events.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use pocketlibrary_core::Api;
use pocketlibrary_core::spine_queue::{self, QueueCore, QueueStage};
use pocketlibrary_spine::Stage;

use crate::spine_service::SpineService;

pub const QUEUE_EVENT: &str = "spine://queue";
pub const PROGRESS_EVENT: &str = "spine://progress";

pub use pocketlibrary_core::spine_queue::{
    QueueProgress as SpineProgress, QueueState as SpineQueueState,
};

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
    app_data_dir: PathBuf,
    app: AppHandle,
    worker_running: AtomicBool,
}

impl SpineQueue {
    pub fn new(app_data_dir: PathBuf, app: AppHandle) -> Self {
        let mut core = QueueCore::default();
        let restored = spine_queue::load_pending(&spine_queue::queue_path(&app_data_dir));
        core.enqueue(restored);
        Self {
            core: Mutex::new(core),
            app_data_dir,
            app,
            worker_running: AtomicBool::new(false),
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
            },
        }
    }

    /// Idempotently add books. Cached books are skipped when the worker peeks
    /// at them, so the caller does not need to hash every cover first.
    pub fn enqueue(&self, book_ids: Vec<i64>) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.enqueue(book_ids) > 0,
            Err(_) => false,
        };
        if changed {
            self.persist();
            self.emit_queue();
        }
        self.kick();
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

    fn persist(&self) {
        let ids = match self.core.lock() {
            Ok(core) => core.persist_ids(),
            Err(_) => return,
        };
        if let Err(error) =
            spine_queue::save_pending(&spine_queue::queue_path(&self.app_data_dir), &ids)
        {
            eprintln!("pocketlibrary spine: persist queue: {error}");
        }
    }

    fn emit_queue(&self) {
        let state = self.snapshot();
        if let Err(error) = self.app.emit(QUEUE_EVENT, state) {
            eprintln!("pocketlibrary spine: emit {QUEUE_EVENT}: {error}");
        }
    }

    fn emit_progress(&self, progress: SpineProgress) {
        if let Err(error) = self.app.emit(PROGRESS_EVENT, progress) {
            eprintln!("pocketlibrary spine: emit {PROGRESS_EVENT}: {error}");
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

    fn skip_cached(&self, book_id: i64) {
        let changed = match self.core.lock() {
            Ok(mut core) => core.skip_front(book_id),
            Err(_) => false,
        };
        if changed {
            self.persist();
            self.emit_queue();
        }
    }

    fn finish_job(&self, ok: bool) {
        if let Ok(mut core) = self.core.lock() {
            core.finish(ok);
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
        if service.is_cached(book_id, api.inner()) {
            queue.skip_cached(book_id);
            continue;
        }
        let Some(book_id) = queue.begin_next() else {
            break;
        };
        let result = service.generate_with_progress(book_id, api.inner(), |stage| {
            queue.stage_started(book_id, stage);
        });
        match result {
            Ok(_) => queue.finish_job(true),
            Err(error) => {
                eprintln!(
                    "pocketlibrary spine queue: book {book_id} failed ({:?}): {}",
                    error.code, error.message
                );
                queue.finish_job(false);
            }
        }
    }
    app.state::<SpineQueue>().worker_done();
}
