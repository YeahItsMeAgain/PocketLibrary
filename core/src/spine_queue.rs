//! Ordering and persistence for the automatic spine queue.
//!
//! This module has no Tauri or ONNX dependency so the queue contract can be
//! exercised on a headless host. The app shell owns the worker and events; it
//! drives this state machine and persists the ids between transitions.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const QUEUE_FILE: &str = "queue.json";
const BACKFILL_FILE: &str = "backfill.json";

/// How many automatic attempts a book gets before it waits for the user.
///
/// A fallback verdict, or an artifact that cannot project, must not be retried
/// on every launch forever. After this many automatic failures the row stays
/// in `attention` (and Settings explains why) until an explicit Retry clears it.
pub const MAX_AUTOMATIC_ATTEMPTS: u32 = 3;

/// Coarse pipeline stages exposed on the wire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QueueStage {
    Art,
    Text,
    Check,
}

impl QueueStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Art => "art",
            Self::Text => "text",
            Self::Check => "check",
        }
    }
}

/// One book whose automatic job failed and has not been retried yet.
///
/// A failed job is never dropped: it leaves the pending queue but stays here so
/// the chip, the shelf marker and the Settings panel can explain it, and so a
/// retry starts from a known state. `state` is always `"needs-attention"`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueFailure {
    pub book_id: i64,
    #[serde(default = "attention_state")]
    pub state: String,
    #[serde(default)]
    pub code: String,
    pub error: String,
    #[serde(default)]
    pub attempts: u32,
}

fn attention_state() -> String {
    "needs-attention".to_owned()
}

/// The full queue state sent as `spine://queue` and returned by `spine_queue`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub running: bool,
    pub paused: bool,
    pub pending: usize,
    pub completed: u64,
    /// The number of books currently needing attention. This is outstanding
    /// work, not a lifetime counter, so retrying clears it.
    pub failed: u64,
    pub current_book_id: Option<i64>,
    /// "art" | "text" | "check" | null
    pub stage: Option<String>,
    /// True when the existing library has not yet been queued for this model
    /// bundle. The shell clears it after one full-library enqueue.
    pub backfill_pending: bool,
    /// Every failed book, with the last error and attempt count.
    pub attention: Vec<QueueFailure>,
}

/// One stage event sent as `spine://progress`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueProgress {
    pub book_id: i64,
    pub stage: String,
    pub index: u64,
    pub total: u64,
}

/// Bump when a QA change should give books their automatic attempts back.
///
/// A persisted attention row carries the attempts it already spent. Without
/// this, a book rejected by an older, stricter gate would wait forever after
/// an upgrade even though the new gate would accept it.
pub const SPINE_POLICY_VERSION: u32 = 2;

/// The queue payload written across process restarts.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedQueue {
    #[serde(default)]
    policy: u32,
    #[serde(default)]
    pending: Vec<i64>,
    #[serde(default)]
    attention: Vec<QueueFailure>,
}

/// Pure queue state. A single job runs at a time; `spine_generate` removes its
/// book from pending work and runs outside the worker.
#[derive(Default)]
pub struct QueueCore {
    pending: VecDeque<i64>,
    current: Option<i64>,
    paused: bool,
    running: bool,
    completed: u64,
    /// Lifetime failure count, used only for progress indices.
    failed_total: u64,
    stage: Option<QueueStage>,
    waiting: bool,
    backfill_pending: bool,
    attention: Vec<QueueFailure>,
}

impl QueueCore {
    /// Idempotently append books, preserving first-seen order.
    pub fn enqueue(&mut self, ids: impl IntoIterator<Item = i64>) -> usize {
        let mut added = 0;
        for id in ids {
            if self.current == Some(id) || self.pending.contains(&id) {
                continue;
            }
            self.pending.push_back(id);
            added += 1;
        }
        added
    }

    /// Remove a book from pending work. A job already running is left alone;
    /// the explicit generate path waits for the engine's per-book guard.
    pub fn remove(&mut self, id: i64) -> bool {
        let before = self.pending.len();
        self.pending.retain(|pending| *pending != id);
        before != self.pending.len()
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
        if !paused {
            self.waiting = false;
        }
    }

    pub fn can_start(&self) -> bool {
        !self.paused && !self.running && self.current.is_none() && !self.pending.is_empty()
    }

    pub fn is_waiting(&self) -> bool {
        self.waiting
    }

    /// True when the full-library backfill is still due for the active bundle.
    pub fn backfill_pending(&self) -> bool {
        self.backfill_pending
    }

    /// Track whether the one-shot library backfill is still due.
    pub fn set_backfill_pending(&mut self, pending: bool) {
        self.backfill_pending = pending;
    }

    pub fn peek(&self) -> Option<i64> {
        self.pending.front().copied()
    }

    pub fn skip_front(&mut self, id: i64) -> bool {
        if self.pending.front() == Some(&id) {
            self.pending.pop_front();
            true
        } else {
            false
        }
    }

    pub fn take_next(&mut self) -> Option<i64> {
        if !self.can_start() {
            return None;
        }
        let id = self.pending.pop_front()?;
        self.current = Some(id);
        self.running = true;
        self.stage = None;
        self.waiting = false;
        Some(id)
    }

    pub fn set_stage(&mut self, id: i64, stage: QueueStage) {
        if self.current == Some(id) {
            self.stage = Some(stage);
        }
    }

    /// Finish the current job. Failures are retained in `attention`; use
    /// `fail_current` when the shell has a typed code and a clear message.
    pub fn finish(&mut self, ok: bool) {
        if ok {
            self.complete_current();
        } else {
            self.fail_current(
                "spine_failed",
                "The spine could not be generated for this book. Please try again.",
            );
        }
        self.running = false;
        self.stage = None;
        self.waiting = false;
    }

    /// Complete the current job and clear any previous failure for that book.
    pub fn complete_current(&mut self) {
        if let Some(id) = self.current.take() {
            self.completed += 1;
            self.attention.retain(|failure| failure.book_id != id);
        }
        self.running = false;
        self.stage = None;
        self.waiting = false;
    }

    /// Fail the current job without dropping it. The book moves to
    /// `attention` with its last error and bumped attempt count.
    pub fn fail_current(&mut self, code: &str, error: impl Into<String>) {
        if let Some(id) = self.current.take() {
            self.failed_total += 1;
            self.record_failure(id, code, error.into());
        }
        self.running = false;
        self.stage = None;
        self.waiting = false;
    }

    fn record_failure(&mut self, book_id: i64, code: &str, error: String) {
        if let Some(existing) = self
            .attention
            .iter_mut()
            .find(|failure| failure.book_id == book_id)
        {
            existing.state = attention_state();
            existing.code = code.to_owned();
            existing.error = error;
            existing.attempts = existing.attempts.saturating_add(1);
            return;
        }
        self.attention.push(QueueFailure {
            book_id,
            state: attention_state(),
            code: code.to_owned(),
            error,
            attempts: 1,
        });
    }

    /// Restore failures from the persisted queue file.
    pub fn restore_failures(&mut self, failures: impl IntoIterator<Item = QueueFailure>) {
        for failure in failures {
            if failure.book_id <= 0 {
                continue;
            }
            if let Some(existing) = self
                .attention
                .iter_mut()
                .find(|candidate| candidate.book_id == failure.book_id)
            {
                *existing = failure;
            } else {
                self.attention.push(failure);
            }
        }
    }

    /// Clear a book's failed state before requeueing it.
    pub fn clear_failure(&mut self, id: i64) -> bool {
        let before = self.attention.len();
        self.attention.retain(|failure| failure.book_id != id);
        before != self.attention.len()
    }

    /// The outstanding failures, in first-failure order.
    pub fn attention(&self) -> &[QueueFailure] {
        &self.attention
    }

    /// How many automatic attempts this book has already failed.
    pub fn attempts(&self, book_id: i64) -> u32 {
        self.attention
            .iter()
            .find(|failure| failure.book_id == book_id)
            .map(|failure| failure.attempts)
            .unwrap_or(0)
    }

    /// False once a book has used its automatic attempts; only an explicit
    /// Retry (which clears the failure first) may try again.
    pub fn automatic_attempt_due(&self, book_id: i64) -> bool {
        self.attempts(book_id) < MAX_AUTOMATIC_ATTEMPTS
    }

    /// Engine models are not ready yet. Keep every pending job.
    pub fn mark_waiting(&mut self) {
        self.waiting = true;
        self.running = false;
        self.stage = None;
    }

    pub fn snapshot(&self) -> QueueState {
        QueueState {
            running: self.running,
            paused: self.paused,
            pending: self.pending.len(),
            completed: self.completed,
            failed: self.attention.len() as u64,
            current_book_id: self.current,
            stage: self.stage.map(|stage| stage.as_str().to_owned()),
            backfill_pending: self.backfill_pending,
            attention: self.attention.clone(),
        }
    }

    pub fn progress(&self, book_id: i64, stage: QueueStage) -> QueueProgress {
        let index = self.completed + self.failed_total + 1;
        let total = index + self.pending.len() as u64;
        QueueProgress {
            book_id,
            stage: stage.as_str().to_owned(),
            index,
            total,
        }
    }

    /// Current first so a job interrupted by process death is re-queued ahead
    /// of work that had not started.
    pub fn persist_ids(&self) -> Vec<i64> {
        self.current
            .iter()
            .chain(self.pending.iter())
            .copied()
            .collect()
    }
}

pub fn queue_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("spine").join(QUEUE_FILE)
}

/// The one-shot library backfill marker, keyed by model bundle id.
///
/// A missing or unreadable file means "backfill due"; that is the safe
/// direction because the worker skips cache hits. It lives next to the queue
/// so an upgrade keeps the same app-data directory.
#[derive(Debug, Default)]
pub struct BackfillFlag {
    path: PathBuf,
    bundle_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedBackfill {
    #[serde(default)]
    bundle_id: Option<String>,
}

impl BackfillFlag {
    pub fn load(app_data_dir: &Path) -> Self {
        let path = backfill_path(app_data_dir);
        let bundle_id = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<PersistedBackfill>(&text).ok())
            .and_then(|flag| flag.bundle_id);
        Self { path, bundle_id }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// True when this bundle has never been fully queued.
    pub fn is_pending(&self, bundle_id: &str) -> bool {
        self.bundle_id.as_deref() != Some(bundle_id)
    }

    /// Record that this bundle's library backfill has been queued. The write is
    /// atomic so a crash cannot leave a half-written marker that reads as
    /// "done" for the wrong bundle.
    pub fn mark_done(&mut self, bundle_id: &str) -> std::io::Result<()> {
        write_backfill(&self.path, bundle_id)?;
        self.bundle_id = Some(bundle_id.to_owned());
        Ok(())
    }
}

pub fn backfill_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("spine").join(BACKFILL_FILE)
}

fn write_backfill(path: &Path, bundle_id: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&PersistedBackfill {
        bundle_id: Some(bundle_id.to_owned()),
    })
    .map_err(std::io::Error::other)?;
    let staged = path.with_extension(format!("json.tmp-{}", std::process::id()));
    fs::write(&staged, text)?;
    match fs::rename(&staged, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&staged);
            Err(error)
        }
    }
}

/// Load both the pending ids and the persisted failures.
pub fn load_queue(path: &Path) -> (Vec<i64>, Vec<QueueFailure>) {
    let Ok(text) = fs::read_to_string(path) else {
        return (Vec::new(), Vec::new());
    };
    let Some(queue) = serde_json::from_str::<PersistedQueue>(&text).ok() else {
        return (Vec::new(), Vec::new());
    };
    if queue.policy == SPINE_POLICY_VERSION {
        return (queue.pending, queue.attention);
    }
    // A changed QA policy invalidates the old verdicts. Give attention rows a
    // fresh budget by dropping them; the launch backfill re-queues the books.
    // Persist the reset so this happens once, not on every launch.
    let attention = Vec::new();
    let _ = save_queue(path, &queue.pending, &attention);
    (queue.pending, attention)
}

pub fn load_pending(path: &Path) -> Vec<i64> {
    load_queue(path).0
}

/// Persist pending work and outstanding failures together so a restart keeps
/// the chip and the shelf marker.
pub fn save_queue(path: &Path, ids: &[i64], attention: &[QueueFailure]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&PersistedQueue {
        policy: SPINE_POLICY_VERSION,
        pending: ids.to_vec(),
        attention: attention.to_vec(),
    })
    .map_err(std::io::Error::other)?;
    let staged = path.with_extension(format!("json.tmp-{}", std::process::id()));
    fs::write(&staged, text)?;
    match fs::rename(&staged, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&staged);
            Err(error)
        }
    }
}

pub fn save_pending(path: &Path, ids: &[i64]) -> std::io::Result<()> {
    save_queue(path, ids, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(core: &QueueCore) -> Vec<i64> {
        core.pending.iter().copied().collect()
    }

    #[test]
    fn enqueue_dedupes_and_keeps_fifo_order() {
        let mut core = QueueCore::default();
        assert_eq!(core.enqueue([3, 1, 2, 1, 3]), 3);
        assert_eq!(ids(&core), vec![3, 1, 2]);

        assert_eq!(core.take_next(), Some(3));
        assert_eq!(core.enqueue([3, 4]), 1);
        assert_eq!(core.take_next(), None, "one automatic job at a time");
        core.finish(true);
        assert_eq!(core.take_next(), Some(1));
        core.finish(true);
        assert_eq!(core.take_next(), Some(2));
        core.finish(true);
        assert_eq!(core.take_next(), Some(4));
    }

    #[test]
    fn explicit_generate_jumps_the_queue() {
        let mut core = QueueCore::default();
        core.enqueue([10, 20, 30]);
        assert!(core.remove(20));
        assert!(!core.remove(20), "dedupe removal is idempotent");
        assert_eq!(core.take_next(), Some(10));
        core.finish(true);
        assert_eq!(core.take_next(), Some(30));
        assert_eq!(core.peek(), None);
    }

    #[test]
    fn pause_stops_new_automatic_jobs_until_resumed() {
        let mut core = QueueCore::default();
        core.enqueue([1, 2]);
        core.set_paused(true);
        assert!(!core.can_start());
        assert_eq!(core.take_next(), None);

        core.set_paused(false);
        assert_eq!(core.take_next(), Some(1));
        core.finish(true);
        assert_eq!(core.snapshot().completed, 1);
        assert_eq!(core.take_next(), Some(2));
    }

    #[test]
    fn waiting_jobs_stay_pending() {
        let mut core = QueueCore::default();
        core.enqueue([7, 8]);
        core.mark_waiting();
        let state = core.snapshot();
        assert_eq!(state.pending, 2);
        assert!(!state.running);
        assert_eq!(state.current_book_id, None);
        core.set_paused(false);
        assert_eq!(core.take_next(), Some(7));
    }

    #[test]
    fn persisted_queue_reloads_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("spine").join(QUEUE_FILE);
        save_pending(&path, &[4, 5, 6]).expect("save queue");
        assert_eq!(load_pending(&path), vec![4, 5, 6]);

        let mut core = QueueCore::default();
        core.enqueue(load_pending(&path));
        assert_eq!(core.take_next(), Some(4));

        core.enqueue([7]);
        assert_eq!(core.persist_ids(), vec![4, 5, 6, 7]);
        save_pending(&path, &core.persist_ids()).expect("save running queue");

        let mut reloaded = QueueCore::default();
        reloaded.enqueue(load_pending(&path));
        assert_eq!(ids(&reloaded), vec![4, 5, 6, 7]);
        assert_eq!(reloaded.take_next(), Some(4));
    }

    #[test]
    fn progress_counts_the_current_job() {
        let mut core = QueueCore::default();
        core.enqueue([1, 2, 3]);
        let id = core.take_next().expect("first job");
        core.set_stage(id, QueueStage::Art);
        let progress = core.progress(id, QueueStage::Art);
        assert_eq!(progress.index, 1);
        assert_eq!(progress.total, 3);
        assert_eq!(progress.stage, "art");
        core.finish(true);
        let id = core.take_next().expect("second job");
        let progress = core.progress(id, QueueStage::Text);
        assert_eq!(progress.index, 2);
        assert_eq!(progress.total, 3);
        assert_eq!(progress.stage, "text");
    }

    #[test]
    fn backfill_runs_once_per_bundle_and_again_for_a_new_bundle() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut flag = BackfillFlag::load(dir.path());
        assert!(
            flag.is_pending("spine-v1"),
            "a fresh install owes a backfill"
        );
        assert!(!flag.path().exists());

        flag.mark_done("spine-v1").expect("mark backfill");
        assert!(!flag.is_pending("spine-v1"));
        assert!(flag.path().exists());

        // A later process sees the marker and does not queue the library again.
        let reloaded = BackfillFlag::load(dir.path());
        assert!(!reloaded.is_pending("spine-v1"));
        // A new model bundle invalidates the completed backfill.
        assert!(reloaded.is_pending("spine-v2"));

        // A corrupt marker reads as pending rather than silently skipping work.
        fs::write(reloaded.path(), "{ not json").expect("corrupt marker");
        assert!(BackfillFlag::load(dir.path()).is_pending("spine-v1"));
    }

    #[test]
    fn snapshot_carries_the_backfill_state() {
        let mut core = QueueCore::default();
        assert!(!core.snapshot().backfill_pending);
        core.set_backfill_pending(true);
        assert!(core.snapshot().backfill_pending);
        core.set_backfill_pending(false);
        assert!(!core.snapshot().backfill_pending);
    }

    #[test]
    fn a_failed_job_stays_in_the_snapshot_until_retry() {
        let mut core = QueueCore::default();
        core.enqueue([7]);
        assert_eq!(core.take_next(), Some(7));
        core.fail_current("cover_missing", "This book has no cover.");
        let state = core.snapshot();
        assert_eq!(state.pending, 0);
        assert_eq!(state.failed, 1);
        assert_eq!(state.attention.len(), 1);
        assert_eq!(state.attention[0].book_id, 7);
        assert_eq!(state.attention[0].state, "needs-attention");
        assert_eq!(state.attention[0].code, "cover_missing");
        assert_eq!(state.attention[0].error, "This book has no cover.");
        assert_eq!(state.attention[0].attempts, 1);
        assert!(!state.running);

        // A second failure bumps attempts instead of duplicating the row.
        core.enqueue([7]);
        assert_eq!(core.take_next(), Some(7));
        core.fail_current("spine_failed", "Still failing.");
        assert_eq!(core.snapshot().failed, 1);
        assert_eq!(core.snapshot().attention[0].attempts, 2);

        // Retry clears the state before the job is queued again.
        assert!(core.clear_failure(7));
        assert_eq!(core.snapshot().failed, 0);
        assert_eq!(core.enqueue([7]), 1);
        assert_eq!(core.take_next(), Some(7));
        core.finish(true);
        assert_eq!(core.snapshot().completed, 1);
        assert!(core.snapshot().attention.is_empty());
    }

    #[test]
    fn automatic_retries_stop_at_the_attempt_cap() {
        let mut core = QueueCore::default();
        for attempt in 1..=MAX_AUTOMATIC_ATTEMPTS {
            assert!(core.automatic_attempt_due(9), "attempt {attempt} is due");
            core.enqueue([9]);
            assert_eq!(core.take_next(), Some(9));
            core.fail_current("spine_fallback", "QA rejected the art.");
        }
        assert!(!core.automatic_attempt_due(9));
        assert_eq!(core.attempts(9), MAX_AUTOMATIC_ATTEMPTS);
        // The row is still visible and an explicit retry resets the budget.
        assert_eq!(core.snapshot().failed, 1);
        assert!(core.clear_failure(9));
        assert!(core.automatic_attempt_due(9));
    }

    #[test]
    fn a_new_qa_policy_clears_old_attention_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("spine").join(QUEUE_FILE);
        std::fs::create_dir_all(path.parent().unwrap()).expect("dir");
        // A queue written by the older, stricter gate.
        std::fs::write(
            &path,
            r#"{"policy": 1, "pending": [7], "attention": [{"bookId": 7, "state": "needs-attention", "code": "spine_fallback", "error": "old", "attempts": 3}]}"#,
        )
        .expect("write old queue");

        let (pending, attention) = load_queue(&path);
        assert_eq!(pending, vec![7], "pending work survives an upgrade");
        assert!(
            attention.is_empty(),
            "old attempts must not block the new policy"
        );

        // The reset is written back, so the next load keeps the empty state
        // instead of resetting on every launch.
        let text = std::fs::read_to_string(&path).expect("read queue");
        assert!(text.contains(&format!("\"policy\": {SPINE_POLICY_VERSION}")));
        let (_, attention) = load_queue(&path);
        assert!(attention.is_empty());
    }

    #[test]
    fn failures_survive_a_restart_and_a_success_clears_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("spine").join(QUEUE_FILE);
        let mut core = QueueCore::default();
        core.enqueue([4, 5]);
        assert_eq!(core.take_next(), Some(4));
        core.fail_current("spine_failed", "The engine stopped.");
        save_queue(&path, &core.persist_ids(), core.attention()).expect("save queue");

        let (pending, attention) = load_queue(&path);
        let mut reloaded = QueueCore::default();
        reloaded.enqueue(pending);
        reloaded.restore_failures(attention);
        assert_eq!(reloaded.snapshot().failed, 1);
        assert_eq!(reloaded.snapshot().attention[0].book_id, 4);
        assert_eq!(reloaded.snapshot().attention[0].attempts, 1);
        assert_eq!(reloaded.snapshot().pending, 1);

        assert_eq!(reloaded.take_next(), Some(5));
        reloaded.finish(true);
        assert_eq!(
            reloaded.snapshot().failed,
            1,
            "book 4 still waits for retry"
        );
        assert!(reloaded.clear_failure(4));
        reloaded.enqueue([4]);
        assert_eq!(reloaded.take_next(), Some(4));
        reloaded.finish(true);
        assert_eq!(reloaded.snapshot().failed, 0);
        assert!(reloaded.snapshot().attention.is_empty());
    }
}
