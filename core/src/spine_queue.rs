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

/// The full queue state sent as `spine://queue` and returned by `spine_queue`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueState {
    pub running: bool,
    pub paused: bool,
    pub pending: usize,
    pub completed: u64,
    pub failed: u64,
    pub current_book_id: Option<i64>,
    /// "art" | "text" | "check" | null
    pub stage: Option<String>,
    /// True when the existing library has not yet been queued for this model
    /// bundle. The shell clears it after one full-library enqueue.
    pub backfill_pending: bool,
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

/// The queue payload written across process restarts.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedQueue {
    #[serde(default)]
    pending: Vec<i64>,
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
    failed: u64,
    stage: Option<QueueStage>,
    waiting: bool,
    backfill_pending: bool,
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

    pub fn finish(&mut self, ok: bool) {
        if self.current.take().is_some() {
            if ok {
                self.completed += 1;
            } else {
                self.failed += 1;
            }
        }
        self.running = false;
        self.stage = None;
        self.waiting = false;
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
            failed: self.failed,
            current_book_id: self.current,
            stage: self.stage.map(|stage| stage.as_str().to_owned()),
            backfill_pending: self.backfill_pending,
        }
    }

    pub fn progress(&self, book_id: i64, stage: QueueStage) -> QueueProgress {
        let index = self.completed + self.failed + 1;
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

pub fn load_pending(path: &Path) -> Vec<i64> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<PersistedQueue>(&text)
        .map(|queue| queue.pending)
        .unwrap_or_default()
}

pub fn save_pending(path: &Path, ids: &[i64]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&PersistedQueue {
        pending: ids.to_vec(),
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
}
