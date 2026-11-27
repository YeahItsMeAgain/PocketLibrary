//! Read-only spine diagnostics for Settings.
//!
//! The panel needs facts the normal shelf payload deliberately hides (cover
//! paths, cache membership, the last queue error). This command reads them
//! without repairing, enqueueing or running inference.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use pocketlibrary_core::{Api, ApiError};

use crate::spine_queue::{SpineQueue, SpineQueueState};
use crate::spine_service::{SpineService, SpineStatus};

/// One book's local spine state.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineBookDiagnostic {
    pub book_id: i64,
    pub title: String,
    pub cover_present: bool,
    pub artifact_present: bool,
    pub last_error: Option<String>,
}

/// The whole Settings → Spine status payload.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineDiagnostics {
    pub status: SpineStatus,
    pub queue: SpineQueueState,
    pub books: Vec<SpineBookDiagnostic>,
}

/// Read the engine, queue and per-book cache state. This never mutates the
/// cache or the queue, so it is safe to open just to report a problem.
#[tauri::command]
pub async fn spine_diagnostics(app: AppHandle) -> Result<SpineDiagnostics, ApiError> {
    let app_for_kick = app.clone();
    let diagnostics = crate::blocking(move || {
        let service = app.state::<SpineService>();
        let api = app.state::<Api>();
        let status = service.status();
        let queue = app.state::<SpineQueue>().snapshot();
        let cached = service.cached_book_ids();
        let last_errors: BTreeMap<i64, String> = queue
            .attention
            .iter()
            .map(|failure| {
                (
                    failure.book_id,
                    format!("{}: {}", failure.code, failure.error),
                )
            })
            .collect();
        let books = api
            .list_books()?
            .into_iter()
            .map(|book| SpineBookDiagnostic {
                book_id: book.id,
                title: book.title,
                cover_present: book
                    .cover_path
                    .as_deref()
                    .map(Path::new)
                    .is_some_and(Path::is_file),
                artifact_present: cached.contains(&book.id),
                last_error: last_errors.get(&book.id).cloned(),
            })
            .collect();
        Ok(SpineDiagnostics {
            status,
            queue,
            books,
        })
    })
    .await?;
    // Reading status may have resolved the models; let any waiting jobs run.
    app_for_kick.state::<SpineQueue>().kick();
    Ok(diagnostics)
}
