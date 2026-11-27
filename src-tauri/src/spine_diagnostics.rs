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
    /// A readable `artifact.json` exists, even if it cannot paint.
    pub artifact_present: bool,
    /// The artifact projects and its verdict is `pass` or `review`.
    pub shelf_strip_present: bool,
    /// The book's stored presentation style.
    pub spine_style: String,
    /// True only when a usable strip exists and the style does not hide it.
    pub paints_art: bool,
    /// The artifact's wire verdict, when it is readable.
    pub verdict: Option<String>,
    /// Why an existing artifact cannot paint, or `None` when it can.
    pub shelf_reason: Option<String>,
    pub last_error: Option<String>,
}

/// The whole Settings → Spine status payload.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineDiagnostics {
    pub status: SpineStatus,
    pub queue: SpineQueueState,
    /// Books whose projected strip can paint on the wall.
    pub shelf_ready: usize,
    /// Books that actually paint: strip present and the style is not Cloth.
    pub paintable: usize,
    /// Books with a readable artifact on disk.
    pub artifacts_present: usize,
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
        let report = service.cached_strips_report();
        let artifacts = service.artifact_book_ids();
        let strips: BTreeMap<i64, &pocketlibrary_core::spine_strip::SpineCachedStrip> = report
            .strips
            .iter()
            .map(|strip| (strip.book_id, strip))
            .collect();
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
            .map(|book| {
                let strip = strips.get(&book.id);
                let shelf_strip_present = strip.is_some_and(|strip| strip.is_shelf_eligible());
                let paints_art = shelf_strip_present
                    && book.spine_style != pocketlibrary_core::SpineStyle::Cloth;
                let spine_style = book.spine_style.as_str().to_owned();
                let shelf_reason = match strip {
                    Some(strip) if strip.verdict == "fallback" => {
                        Some("quality gate returned fallback".to_owned())
                    }
                    Some(_) if !shelf_strip_present => {
                        Some("strip could not be decoded".to_owned())
                    }
                    None if artifacts.contains(&book.id) => {
                        Some("artifact could not be projected".to_owned())
                    }
                    _ => None,
                };
                SpineBookDiagnostic {
                    book_id: book.id,
                    title: book.title,
                    cover_present: book
                        .cover_path
                        .as_deref()
                        .map(Path::new)
                        .is_some_and(Path::is_file),
                    artifact_present: artifacts.contains(&book.id),
                    shelf_strip_present,
                    spine_style,
                    paints_art,
                    verdict: strip.map(|strip| strip.verdict.clone()),
                    shelf_reason,
                    last_error: last_errors.get(&book.id).cloned(),
                }
            })
            .collect::<Vec<_>>();
        let shelf_ready = books.iter().filter(|book| book.shelf_strip_present).count();
        let paintable = books.iter().filter(|book| book.paints_art).count();
        let artifacts_present = books.iter().filter(|book| book.artifact_present).count();
        Ok(SpineDiagnostics {
            status,
            queue,
            shelf_ready,
            paintable,
            artifacts_present,
            books,
        })
    })
    .await?;
    // Reading status may have resolved the models; let any waiting jobs run.
    app_for_kick.state::<SpineQueue>().kick();
    Ok(diagnostics)
}
