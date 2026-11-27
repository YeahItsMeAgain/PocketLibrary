//! Read-only spine diagnostics for Settings.
//!
//! The panel needs facts the normal shelf payload deliberately hides (cover
//! paths, cache membership, the last queue error). This command reads them
//! without repairing, enqueueing or running inference.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use pocketlibrary_core::spine_queue::QueueFailure;
use pocketlibrary_core::{Api, ApiError};

use crate::spine_queue::{SpineQueue, SpineQueueState};
use crate::spine_service::{SpineArtifact, SpineService, SpineStatus};

/// A bounded number of attention rows and reason characters in the export.
const MAX_VERDICT_ROWS: usize = 40;
const MAX_REASON_CHARS: usize = 160;

/// One book's route/verdict line for the copyable diagnostics export.
///
/// `spine/spine.log` already carries `spine result:` lines for every
/// generation; this section repeats the essential facts for books that still
/// need attention so Copy logs alone explains what QA decided without another
/// device build.
#[derive(Clone, Debug, PartialEq)]
pub struct SpineVerdictRow {
    pub book_id: i64,
    pub title: String,
    pub route: String,
    pub verdict: String,
    pub mask_percent: f64,
    pub reasons: Vec<String>,
    /// Set when no readable artifact exists; the row then names the queue error.
    pub error: Option<String>,
}

impl SpineVerdictRow {
    fn from_artifact(book_id: i64, title: String, artifact: &SpineArtifact) -> Self {
        let reasons = artifact
            .decision_reasons()
            .into_iter()
            .map(|reason| reason.chars().take(MAX_REASON_CHARS).collect())
            .collect();
        Self {
            book_id,
            title,
            route: artifact.route.clone(),
            verdict: artifact.verdict.clone(),
            mask_percent: artifact.mask_percent,
            reasons,
            error: None,
        }
    }

    fn missing(book_id: i64, title: String, failure: &QueueFailure) -> Self {
        Self {
            book_id,
            title,
            route: "unknown".to_owned(),
            verdict: "unknown".to_owned(),
            mask_percent: 0.0,
            reasons: Vec::new(),
            error: Some(format!("{}: {}", failure.code, failure.error)),
        }
    }

    pub fn line(&self) -> String {
        if let Some(error) = &self.error {
            return format!(
                "book {} {:?} artifact=missing last={error:?}",
                self.book_id, self.title
            );
        }
        format!(
            "book {} {:?} route={} verdict={} mask={:.1} reasons={:?}",
            self.book_id, self.title, self.route, self.verdict, self.mask_percent, self.reasons
        )
    }
}

/// The `===== spine verdicts =====` body: one line per attention book.
pub fn verdicts_section(rows: &[SpineVerdictRow]) -> String {
    if rows.is_empty() {
        return "none".to_owned();
    }
    let mut lines: Vec<String> = rows
        .iter()
        .take(MAX_VERDICT_ROWS)
        .map(SpineVerdictRow::line)
        .collect();
    if rows.len() > MAX_VERDICT_ROWS {
        lines.push(format!("… {} more", rows.len() - MAX_VERDICT_ROWS));
    }
    lines.join("\n")
}

/// Collect the verdict rows for books currently in `attention`.
pub fn attention_verdicts(
    api: &Api,
    service: &SpineService,
    queue: &SpineQueueState,
) -> Vec<SpineVerdictRow> {
    queue
        .attention
        .iter()
        .map(|failure| {
            let title = api
                .book(failure.book_id)
                .map(|book| book.title)
                .unwrap_or_else(|_| "unknown title".to_owned());
            match service.artifact(failure.book_id, api) {
                Ok(Some(artifact)) => {
                    SpineVerdictRow::from_artifact(failure.book_id, title, &artifact)
                }
                _ => SpineVerdictRow::missing(failure.book_id, title, failure),
            }
        })
        .collect()
}

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
    /// True only when a usable strip exists and the style is Art.
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
    /// Books that actually paint: strip present and the style is Art.
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
                let paints_art =
                    shelf_strip_present && book.spine_style == pocketlibrary_core::SpineStyle::Art;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn artifact(verdict: &str, mask_percent: f64, reasons: &[&str]) -> SpineArtifact {
        SpineArtifact {
            book_id: 2,
            pipeline_version: pocketlibrary_core::spine_strip::SPINE_PIPELINE_VERSION,
            route: "inpaint".to_owned(),
            verdict: verdict.to_owned(),
            mask_percent,
            crop_box: None,
            art_data_url: String::new(),
            spine_data_url: String::new(),
            fallback_data_url: String::new(),
            pages_approximate: false,
            run_json: json!({ "final": { "route": "inpaint", "verdict": verdict } }),
            qa_json: json!({ "decision": { "verdict": verdict, "reasons": reasons } }),
        }
    }

    #[test]
    fn a_verdict_row_names_route_verdict_mask_and_reasons() {
        let row = SpineVerdictRow::from_artifact(
            2,
            "Rock Paper Scissors".to_owned(),
            &artifact(
                "fallback",
                57.2,
                &["more than 55% of the cover was reconstructed"],
            ),
        );
        let line = row.line();
        assert_eq!(
            line,
            "book 2 \"Rock Paper Scissors\" route=inpaint verdict=fallback mask=57.2 \
             reasons=[\"more than 55% of the cover was reconstructed\"]"
        );
    }

    #[test]
    fn the_copyable_export_has_a_bounded_spine_verdicts_section() {
        let row = SpineVerdictRow::from_artifact(
            2,
            "Rock Paper Scissors".to_owned(),
            &artifact(
                "fallback",
                57.2,
                &["residual text is readable in the 52x236 spine"],
            ),
        );
        let section = verdicts_section(&[row]);
        assert!(section.contains("route=inpaint"));
        assert!(section.contains("verdict=fallback"));
        assert!(section.contains("mask=57.2"));
        assert!(section.contains("residual text is readable"));

        let temp = tempfile::tempdir().expect("tempdir");
        let diagnostics =
            pocketlibrary_core::diagnostics::Diagnostics::new(temp.path().join("diagnostics.log"));
        let environment = pocketlibrary_core::diagnostics::DiagnosticsEnvironment {
            app_name: "PocketLibrary".to_owned(),
            app_version: "0.1.13".to_owned(),
            schema_version: 4,
            android: "14".to_owned(),
            device: "Pixel 8".to_owned(),
            counts: BTreeMap::new(),
        };
        let text = diagnostics.export_text(&environment, &[("spine verdicts", section)]);
        assert!(text.contains("===== spine verdicts ====="));
        assert!(text.contains("book 2 \"Rock Paper Scissors\""));
    }
}
