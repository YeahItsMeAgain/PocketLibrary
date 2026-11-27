//! Tauri shell around the PocketLibrary core catalog.
//!
//! The commands here are thin wrappers over `pocketlibrary_core::Api`; the web
//! UI reaches them only through the typed platform adapter.

use std::collections::BTreeMap;
use std::fs;
#[cfg(target_os = "android")]
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use pocketlibrary_core::diagnostics::{
    self, Diagnostics, DiagnosticsEnvironment, DiagnosticsSummary, Level,
};
use pocketlibrary_core::{
    Annotation, AnnotationKind, Api, ApiError, AppInfo, BackupPreview, BackupReport, Book,
    BookDetail, Bookmark, CoverChoices, CoverLookupOutcome, CoverOption, DeviceCoverPreview,
    Download, DownloadRequest, DownloadSink, EnrichmentMode, EnrichmentOutcome, EnrichmentSettings,
    ImportMode, Label, LabelUsage, LibraryStatus, ReadingState, ReadingStatus, ScanReport,
    SearchPage, SearchQuery, Shelf,
};

#[cfg(target_os = "android")]
mod saf;
mod spine_assets;
mod spine_queue;
mod spine_service;
mod updates;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, FsUri, UriPermission};

#[cfg(target_os = "android")]
use crate::saf::{SafDownloadSink, SafSource};

/// Whole-file reads are the M1 transport; refuse files that would exhaust the
/// WebView when Rust, IPC and PDF.js each hold a copy.
#[cfg(target_os = "android")]
const MAX_BOOK_BYTES: u64 = 100 * 1024 * 1024;

/// Metadata archives carry only the manifest and cached covers. This ceiling
/// is generous for covers but stops a mistakenly picked book or video from
/// being loaded whole into memory.
const MAX_BACKUP_BYTES: u64 = 64 * 1024 * 1024;

/// A device cover image is decoded in Rust; refuse an unreasonably large pick
/// before holding it in memory.
const MAX_DEVICE_COVER_BYTES: u64 = 20 * 1024 * 1024;

static DOWNLOAD_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

/// A user-facing result of writing an archive through the system picker.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupExport {
    file_name: String,
    bytes: usize,
    books: usize,
}

/// An inspected archive, held in memory between preview and import.
///
/// The picker's content URI never leaves the shell: the WebView only sees an
/// opaque token, so no raw path can be passed back in as a command argument.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSelection {
    token: String,
    file_name: String,
    preview: BackupPreview,
}

struct PendingBackup {
    token: String,
    bytes: Vec<u8>,
}

/// A diagnostics zip written through the system save picker.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedDiagnostics {
    file_name: String,
    bytes: usize,
}

/// A diagnostics zip handed to the Android share chooser.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedDiagnostics {
    file_name: String,
    bytes: usize,
}

/// A book handed to another app. It is marked reading only when PocketLibrary
/// is resumed after the chooser/handoff, never when the chooser merely opens.
#[derive(Default)]
struct PendingExternal {
    book_id: Mutex<Option<i64>>,
}

/// An import report plus the rescan that re-links restored pathless books.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportOutcome {
    report: BackupReport,
    scan: Option<ScanReport>,
    scan_error: Option<String>,
}

#[derive(Default)]
struct BackupExchange {
    pending: Mutex<Option<PendingBackup>>,
    next_token: AtomicU64,
}

impl BackupExchange {
    fn stash(&self, bytes: Vec<u8>) -> String {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let sequence = self.next_token.fetch_add(1, Ordering::Relaxed);
        let token = format!("backup-{stamp}-{sequence}");
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(PendingBackup {
                token: token.clone(),
                bytes,
            });
        }
        token
    }

    fn take(&self, token: &str) -> Option<Vec<u8>> {
        let mut pending = self.pending.lock().ok()?;
        match pending.as_ref() {
            Some(backup) if backup.token == token => pending.take().map(|backup| backup.bytes),
            _ => None,
        }
    }
}

/// The Android library folder as a download destination.
struct AppDownloadSink {
    app: AppHandle,
}

#[cfg(target_os = "android")]
fn android_library_uri(app: &AppHandle) -> pocketlibrary_core::Result<FsUri> {
    let api = app.state::<Api>();
    let token = api
        .library_folder()
        .map_err(|error| pocketlibrary_core::Error::SourceUnavailable {
            message: error.message,
        })?
        .ok_or_else(|| pocketlibrary_core::Error::SourceUnavailable {
            message: "No library folder has been chosen yet.".to_owned(),
        })?;
    let uri = parse_folder_token(&token);
    if !grant_is_valid(app, &uri) {
        return Err(pocketlibrary_core::Error::SourceUnavailable {
            message: "The library folder is no longer accessible.".to_owned(),
        });
    }
    Ok(uri)
}

impl DownloadSink for AppDownloadSink {
    fn list_root(&self) -> pocketlibrary_core::Result<Vec<String>> {
        #[cfg(target_os = "android")]
        {
            let uri = android_library_uri(&self.app)?;
            let fs = self.app.android_fs();
            SafDownloadSink::new(fs, uri).list_root()
        }
        #[cfg(not(target_os = "android"))]
        {
            Err(pocketlibrary_core::Error::SourceUnavailable {
                message: "Downloads need the Android build.".to_owned(),
            })
        }
    }

    fn write_file(&self, name: &str, bytes: &[u8]) -> pocketlibrary_core::Result<()> {
        #[cfg(target_os = "android")]
        {
            let uri = android_library_uri(&self.app)?;
            let fs = self.app.android_fs();
            SafDownloadSink::new(fs, uri).write_file(name, bytes)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (name, bytes);
            Err(pocketlibrary_core::Error::SourceUnavailable {
                message: "Downloads need the Android build.".to_owned(),
            })
        }
    }
}

/// Start the queue worker if it is not already running. The worker drains the
/// persisted queue at two files at a time; an enqueue during the final gap
/// simply starts a fresh pass.
fn spawn_download_worker(app: AppHandle) {
    if DOWNLOAD_WORKER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        {
            let api = app.state::<Api>();
            let sink = AppDownloadSink { app: app.clone() };
            if let Err(error) = api.process_downloads(&sink).await {
                eprintln!("pocketlibrary: download worker stopped ({:?})", error.code);
            }
        }
        DOWNLOAD_WORKER_RUNNING.store(false, Ordering::SeqCst);
        let api = app.state::<Api>();
        let still_queued = api
            .list_downloads()
            .map(|rows| {
                rows.iter()
                    .any(|row| matches!(row.state, pocketlibrary_core::DownloadState::Queued))
            })
            .unwrap_or(false);
        if still_queued {
            spawn_download_worker(app);
        }
    });
}

fn api_error(code: &'static str, message: impl Into<String>) -> ApiError {
    ApiError {
        code,
        message: message.into(),
    }
}

/// Keep a raw cause (which may contain paths or SAF text) in logs, not on the wire.
fn logged_error(
    code: &'static str,
    user_message: impl Into<String>,
    detail: impl std::fmt::Display,
) -> ApiError {
    eprintln!("pocketlibrary error ({code}): {detail}");
    pocketlibrary_core::diagnostics::log_event(
        Level::Error,
        "command.failed",
        &format!("{code}: {detail}"),
    );
    api_error(code, user_message)
}

fn diagnostics_of(app: &AppHandle) -> Arc<Diagnostics> {
    app.state::<Arc<Diagnostics>>().inner().clone()
}

fn log_diag(app: &AppHandle, level: Level, event: &str, message: &str) {
    diagnostics_of(app).append(level, event, message);
}

#[cfg(target_os = "android")]
fn android_identity() -> (String, String) {
    fn property(name: &str) -> Option<String> {
        std::process::Command::new("getprop")
            .arg(name)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|value| !value.is_empty())
    }
    (
        property("ro.build.version.release").unwrap_or_else(|| "Android".to_owned()),
        property("ro.product.model").unwrap_or_else(|| "Android device".to_owned()),
    )
}

#[cfg(not(target_os = "android"))]
fn android_identity() -> (String, String) {
    (
        "not Android".to_owned(),
        format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    )
}

fn diagnostics_environment(app: &AppHandle) -> Result<DiagnosticsEnvironment, ApiError> {
    let api = app.state::<Api>();
    let info = api.app_info()?;
    let books = api.list_books()?.len() as i64;
    let shelves = api.list_shelves()?.len() as i64;
    let labels = api.list_labels()?.len() as i64;
    let downloads = api.list_downloads()?;
    let failed = downloads
        .iter()
        .filter(|row| matches!(row.state, pocketlibrary_core::DownloadState::Failed))
        .count() as i64;
    let (android, device) = android_identity();
    Ok(DiagnosticsEnvironment {
        app_name: info.name,
        app_version: info.app_version,
        schema_version: info.schema_version,
        android,
        device,
        counts: BTreeMap::from([
            ("books".to_owned(), books),
            ("shelves".to_owned(), shelves),
            ("labels".to_owned(), labels),
            ("downloads".to_owned(), downloads.len() as i64),
            ("failedDownloads".to_owned(), failed),
        ]),
    })
}

fn diagnostics_zip(app: &AppHandle) -> Result<Vec<u8>, ApiError> {
    let environment = diagnostics_environment(app)?;
    diagnostics_of(app)
        .export_zip(&environment)
        .map_err(|error| {
            logged_error(
                "diagnostics_export",
                "Diagnostics could not be prepared. Please try again.",
                error,
            )
        })
}

async fn blocking<T, F>(task: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ApiError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(task).await {
        Ok(result) => result,
        Err(error) => Err(logged_error(
            "internal",
            "A background task failed. Please try again.",
            error,
        )),
    }
}

#[cfg(target_os = "android")]
fn parse_folder_token(token: &str) -> FsUri {
    FsUri::from_json_str(token).unwrap_or_else(|_| FsUri::from_uri(token))
}

/// A persisted read/write grant is only usable if the folder still lists.
#[cfg(target_os = "android")]
fn grant_is_valid(app: &AppHandle, uri: &FsUri) -> bool {
    let fs = app.android_fs();
    let picker = fs.picker();
    let read = picker
        .check_persisted_uri_permission(uri, UriPermission::Read)
        .unwrap_or(false);
    let write = picker
        .check_persisted_uri_permission(uri, UriPermission::Write)
        .unwrap_or(false);
    read && write && fs.read_dir(uri).is_ok()
}

#[cfg(target_os = "android")]
fn current_status(app: &AppHandle) -> Result<LibraryStatus, ApiError> {
    let api = app.state::<Api>();
    let valid = api
        .library_folder()?
        .map(|token| grant_is_valid(app, &parse_folder_token(&token)))
        .unwrap_or(false);
    api.library_status(valid)
}

#[cfg(not(target_os = "android"))]
fn current_status(app: &AppHandle) -> Result<LibraryStatus, ApiError> {
    let api = app.state::<Api>();
    api.library_status(false)
}

#[cfg(target_os = "android")]
fn choose_folder(app: &AppHandle) -> Result<LibraryStatus, ApiError> {
    let fs = app.android_fs();
    let picker = fs.picker();
    let picked = picker.pick_dir(None, false).map_err(|error| {
        logged_error(
            "picker",
            "The folder picker could not be opened. Please try again.",
            error,
        )
    })?;

    let Some(uri) = picked else {
        // The user closed the picker; keep the current state.
        return current_status(app);
    };

    picker.persist_uri_permission(&uri).map_err(|error| {
        logged_error(
            "grant",
            "The folder grant could not be saved. Please try again.",
            error,
        )
    })?;
    let name = fs
        .get_name(&uri)
        .unwrap_or_else(|_| "Library folder".to_owned());
    let token = uri.to_json_string().map_err(|error| {
        logged_error(
            "grant",
            "The folder grant could not be saved. Please try again.",
            error,
        )
    })?;

    let api = app.state::<Api>();
    api.set_library_folder(&token, &name)?;
    log_diag(
        app,
        Level::Info,
        "folder.granted",
        &format!("{name}: {token}"),
    );
    api.library_status(true)
}

#[cfg(not(target_os = "android"))]
fn choose_folder(app: &AppHandle) -> Result<LibraryStatus, ApiError> {
    Err(api_error(
        "unsupported",
        "Choosing a library folder needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn rescan(app: &AppHandle) -> Result<ScanReport, ApiError> {
    let api = app.state::<Api>();
    let Some(token) = api.library_folder()? else {
        return Err(api_error(
            "library_unavailable",
            "No library folder has been chosen yet.",
        ));
    };
    let uri = parse_folder_token(&token);
    if !grant_is_valid(app, &uri) {
        log_diag(
            app,
            Level::Warn,
            "folder.scan",
            "grant is no longer valid; scan skipped",
        );
        return Err(api_error(
            "library_unavailable",
            "The library folder is no longer accessible.",
        ));
    }

    let source = SafSource::new(app.android_fs(), uri);
    let report = api.scan(&source)?;
    log_diag(
        app,
        Level::Info,
        "folder.scanned",
        &format!(
            "total {} add {} relink {} remove {} duplicate {} skipped {}",
            report.total,
            report.added,
            report.relinked,
            report.removed,
            report.duplicates,
            report.skipped.len()
        ),
    );
    Ok(report)
}

#[cfg(not(target_os = "android"))]
fn rescan(_app: &AppHandle) -> Result<ScanReport, ApiError> {
    Err(api_error(
        "library_unavailable",
        "Scanning a library folder needs the Android build.",
    ))
}

/// Pick one image with the Android system picker and stage it in the cover
/// cache. The WebView receives only an opaque token and a preview data URL.
#[cfg(target_os = "android")]
fn choose_device_cover_response(
    app: &AppHandle,
    book_id: i64,
) -> Result<Option<DeviceCoverPreview>, ApiError> {
    let fs = app.android_fs();
    let picked = fs
        .picker()
        .pick_file(None, &["image/*"], false)
        .map_err(|error| {
            logged_error(
                "cover_picker",
                "The image picker could not be opened. Please try again.",
                error,
            )
        })?;
    let Some(uri) = picked else {
        return Ok(None);
    };
    let file = fs.open_file_readable(&uri).map_err(|error| {
        logged_error(
            "cover_read",
            "That image could not be read. Choose another one.",
            error,
        )
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_DEVICE_COVER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            logged_error(
                "cover_read",
                "That image could not be read. Choose another one.",
                error,
            )
        })?;
    if bytes.len() as u64 > MAX_DEVICE_COVER_BYTES {
        return Err(api_error(
            "cover_too_large",
            "That image is too large to use as a cover.",
        ));
    }
    let api = app.state::<Api>();
    let preview = api.prepare_device_cover(book_id, &bytes)?;
    log_diag(
        app,
        Level::Info,
        "cover.device",
        &format!(
            "book {book_id}: staged {}×{} device image{}",
            preview.width,
            preview.height,
            if preview.warning.is_some() {
                " (needs warning)"
            } else {
                ""
            }
        ),
    );
    Ok(Some(preview))
}

#[cfg(not(target_os = "android"))]
fn choose_device_cover_response(
    _app: &AppHandle,
    _book_id: i64,
) -> Result<Option<DeviceCoverPreview>, ApiError> {
    Err(api_error(
        "unsupported",
        "Choosing a cover image needs the Android build.",
    ))
}

/// Read a book's bytes for the in-app reader.
///
/// A Tauri command returning a raw IPC response is deliberate: the bytes never
/// become JSON or base64 on the wire. The whole file is still materialised once
/// in Rust and once in the WebView (unavoidable for foliate's Blob loader), so
/// very large EPUBs need headroom; this is documented in the reader notes.
#[cfg(target_os = "android")]
fn read_book_response(app: &AppHandle, book_id: i64) -> Result<tauri::ipc::Response, ApiError> {
    let api = app.state::<Api>();
    let token = api.library_folder()?.ok_or_else(|| {
        api_error(
            "library_unavailable",
            "No library folder has been chosen yet.",
        )
    })?;
    let uri = parse_folder_token(&token);
    if !grant_is_valid(app, &uri) {
        return Err(api_error(
            "library_unavailable",
            "The library folder is no longer accessible.",
        ));
    }
    let path = api.book_path(book_id)?;
    let source = SafSource::new(app.android_fs(), uri);
    let bytes = source
        .read_path_limited(&path, MAX_BOOK_BYTES)
        .map_err(|error| {
            log_diag(
                app,
                Level::Error,
                "reader.failed",
                &format!("book {book_id} at {path}: {error}"),
            );
            logged_error("read_book", "That book could not be read.", error)
        })?
        .ok_or_else(|| {
            log_diag(
                app,
                Level::Warn,
                "reader.refused",
                &format!("book {book_id} at {path} is larger than {MAX_BOOK_BYTES} bytes"),
            );
            api_error(
                "book_too_large",
                "This book is larger than 100 MB and cannot be held in memory on this device. Open it in another app instead.",
            )
        })?;
    log_diag(
        app,
        Level::Info,
        "reader.opened",
        &format!("book {book_id} at {path} ({} bytes)", bytes.len()),
    );
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(not(target_os = "android"))]
fn read_book_response(_app: &AppHandle, _book_id: i64) -> Result<tauri::ipc::Response, ApiError> {
    Err(api_error(
        "unsupported",
        "Opening a book needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn export_backup_response(app: &AppHandle) -> Result<Option<BackupExport>, ApiError> {
    let (bytes, books) = {
        let api = app.state::<Api>();
        let bytes = api.export_backup()?;
        let books = api.list_books()?.len();
        (bytes, books)
    };

    let fs = app.android_fs();
    let picked = fs
        .picker()
        .save_file(
            None,
            "pocketlibrary-backup.pocketlibrary",
            Some("application/zip"),
            false,
        )
        .map_err(|error| {
            logged_error(
                "backup_picker",
                "The file picker could not be opened. Please try again.",
                error,
            )
        })?;
    let Some(uri) = picked else {
        return Ok(None);
    };
    let file_name = fs
        .get_name(&uri)
        .unwrap_or_else(|_| "pocketlibrary-backup.pocketlibrary".to_owned());
    let mut file = fs.open_file_writable(&uri).map_err(|error| {
        logged_error(
            "backup_write",
            "That backup could not be written. Choose another destination.",
            error,
        )
    })?;
    file.write_all(&bytes)
        .and_then(|_| file.flush())
        .map_err(|error| {
            logged_error(
                "backup_write",
                "That backup could not be written. Choose another destination.",
                error,
            )
        })?;

    log_diag(
        app,
        Level::Info,
        "backup.exported",
        &format!("{file_name} ({} books, {} bytes)", books, bytes.len()),
    );
    Ok(Some(BackupExport {
        file_name,
        bytes: bytes.len(),
        books,
    }))
}

#[cfg(not(target_os = "android"))]
fn export_backup_response(_app: &AppHandle) -> Result<Option<BackupExport>, ApiError> {
    Err(api_error(
        "unsupported",
        "Exporting a backup needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn preview_backup_response(app: &AppHandle) -> Result<Option<BackupSelection>, ApiError> {
    let fs = app.android_fs();
    // An explicit MIME filter would hide `.pocketlibrary` files on providers
    // that report them as octet-stream, so let the user pick any document and
    // reject the wrong schema with a typed error instead.
    let picked = fs.picker().pick_file(None, &[], false).map_err(|error| {
        logged_error(
            "backup_picker",
            "The file picker could not be opened. Please try again.",
            error,
        )
    })?;
    let Some(uri) = picked else {
        return Ok(None);
    };
    let file_name = fs
        .get_name(&uri)
        .unwrap_or_else(|_| "PocketLibrary backup".to_owned());
    let file = fs.open_file_readable(&uri).map_err(|error| {
        logged_error(
            "backup_read",
            "That file could not be read. Choose another backup.",
            error,
        )
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_BACKUP_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            logged_error(
                "backup_read",
                "That file could not be read. Choose another backup.",
                error,
            )
        })?;
    if bytes.len() as u64 > MAX_BACKUP_BYTES {
        return Err(api_error(
            "backup_too_large",
            "That file is too large to be a PocketLibrary backup.",
        ));
    }

    let preview = {
        let api = app.state::<Api>();
        api.preview_backup(&bytes)?
    };
    let token = app.state::<BackupExchange>().stash(bytes);
    log_diag(
        app,
        Level::Info,
        "backup.previewed",
        &format!(
            "{file_name}: {} matched, {} new",
            preview.matched, preview.new
        ),
    );
    Ok(Some(BackupSelection {
        token,
        file_name,
        preview,
    }))
}

#[cfg(not(target_os = "android"))]
fn preview_backup_response(_app: &AppHandle) -> Result<Option<BackupSelection>, ApiError> {
    Err(api_error(
        "unsupported",
        "Inspecting a backup needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn import_backup_response(
    app: &AppHandle,
    token: &str,
    mode: ImportMode,
) -> Result<ImportOutcome, ApiError> {
    let bytes = app.state::<BackupExchange>().take(token).ok_or_else(|| {
        api_error(
            "backup_selection_expired",
            "That archive is no longer selected. Choose it again.",
        )
    })?;
    let report = app.state::<Api>().import_backup(&bytes, mode)?;
    // Restored books arrive without a device-local path. A scan matches them
    // to files by content hash and fills the path; a missing grant must not
    // turn a successful import into an error.
    let (scan, scan_error) = match rescan(app) {
        Ok(report) => (Some(report), None),
        Err(error) => (None, Some(error.message)),
    };
    log_diag(
        app,
        Level::Info,
        "backup.imported",
        &format!(
            "{mode:?}: matched {} new {} skipped {} replaced {}; scan {}",
            report.matched,
            report.new,
            report.skipped,
            report.replaced,
            if scan.is_some() { "ok" } else { "failed" }
        ),
    );
    Ok(ImportOutcome {
        report,
        scan,
        scan_error,
    })
}

#[cfg(not(target_os = "android"))]
fn import_backup_response(
    _app: &AppHandle,
    _token: &str,
    _mode: ImportMode,
) -> Result<ImportOutcome, ApiError> {
    Err(api_error(
        "unsupported",
        "Restoring a backup needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn save_diagnostics_response(app: &AppHandle) -> Result<Option<SavedDiagnostics>, ApiError> {
    let bytes = diagnostics_zip(app)?;
    let android_fs = app.android_fs();
    let picked = android_fs
        .picker()
        .save_file(
            None,
            diagnostics::export_file_name(),
            Some("application/zip"),
            false,
        )
        .map_err(|error| {
            logged_error(
                "diagnostics_picker",
                "The file picker could not be opened. Please try again.",
                error,
            )
        })?;
    let Some(uri) = picked else {
        log_diag(app, Level::Info, "diagnostics.export", "save cancelled");
        return Ok(None);
    };
    let file_name = android_fs
        .get_name(&uri)
        .unwrap_or_else(|_| diagnostics::export_file_name().to_owned());
    let mut file = android_fs.open_file_writable(&uri).map_err(|error| {
        logged_error(
            "diagnostics_write",
            "Diagnostics could not be saved. Choose another destination.",
            error,
        )
    })?;
    file.write_all(&bytes)
        .and_then(|_| file.flush())
        .map_err(|error| {
            logged_error(
                "diagnostics_write",
                "Diagnostics could not be saved. Choose another destination.",
                error,
            )
        })?;
    log_diag(
        app,
        Level::Info,
        "diagnostics.export",
        &format!("saved {file_name} ({} bytes)", bytes.len()),
    );
    Ok(Some(SavedDiagnostics {
        file_name,
        bytes: bytes.len(),
    }))
}

#[cfg(not(target_os = "android"))]
fn save_diagnostics_response(_app: &AppHandle) -> Result<Option<SavedDiagnostics>, ApiError> {
    Err(api_error(
        "unsupported",
        "Saving diagnostics needs the Android build.",
    ))
}

/// Stage the zip as a readable in-memory content URI and open ACTION_SEND.
///
/// The URI stays registered for the life of the process so a share target can
/// read it after this command returns. A failure here is reported as an error
/// so the WebView can fall back to the save picker.
#[cfg(target_os = "android")]
fn share_diagnostics_response(app: &AppHandle) -> Result<Option<SharedDiagnostics>, ApiError> {
    use tauri_plugin_android_fs::CustomFile;

    let bytes = diagnostics_zip(app)?;
    let file_name = diagnostics::export_file_name().to_owned();
    let len = bytes.len() as u64;
    let android_fs = app.android_fs();
    let content = Arc::new(bytes);
    let uri = android_fs
        .register_simple_readonly_custom_file(
            file_name.clone(),
            Some("application/zip".to_owned()),
            Some(len),
            None,
            move || Ok(CustomFile::from_arc_bytes(Arc::clone(&content))),
        )
        .map_err(|error| {
            logged_error(
                "diagnostics_share",
                "Diagnostics could not be shared. Saving instead.",
                error,
            )
        })?;
    if let Err(error) = android_fs.opener().share_file(&uri) {
        // Nothing can read the URI now, so release it before falling back.
        let _ = android_fs.unregister_simple_custom_file(&uri);
        return Err(logged_error(
            "diagnostics_share",
            "Diagnostics could not be shared. Saving instead.",
            error,
        ));
    }
    log_diag(
        app,
        Level::Info,
        "diagnostics.export",
        &format!("shared {file_name} ({len} bytes)"),
    );
    Ok(Some(SharedDiagnostics {
        file_name,
        bytes: len as usize,
    }))
}

#[cfg(not(target_os = "android"))]
fn share_diagnostics_response(_app: &AppHandle) -> Result<Option<SharedDiagnostics>, ApiError> {
    // Desktop has no native share chooser; the caller falls back to save.
    Ok(None)
}

/// Generate (or reuse) one book's spine. Inference runs on a blocking thread.
#[tauri::command]
async fn spine_generate(
    app: AppHandle,
    book_id: i64,
) -> Result<spine_service::SpineArtifact, ApiError> {
    // An explicit generate leaves the automatic queue, so it runs next rather
    // than waiting behind earlier pending books.
    app.state::<spine_queue::SpineQueue>().remove(book_id);
    blocking(move || {
        let service = app.state::<spine_service::SpineService>();
        let api = app.state::<Api>();
        service.generate(book_id, api.inner())
    })
    .await
}

/// Queue books for automatic generation. Idempotent; cached books are dropped
/// by the worker before inference.
#[tauri::command]
async fn spine_enqueue(app: AppHandle, book_ids: Vec<i64>) -> Result<(), ApiError> {
    app.state::<spine_queue::SpineQueue>().enqueue(book_ids);
    Ok(())
}

/// The full queue state, also pushed as `spine://queue`.
#[tauri::command]
fn spine_queue(app: AppHandle) -> Result<spine_queue::SpineQueueState, ApiError> {
    Ok(app.state::<spine_queue::SpineQueue>().snapshot())
}

/// Pause automatic jobs while the reader is open. An explicit generate still
/// runs.
#[tauri::command]
fn spine_pause(app: AppHandle, paused: bool) -> Result<(), ApiError> {
    app.state::<spine_queue::SpineQueue>().set_paused(paused);
    Ok(())
}

/// Persist the presentation style for one book's generated spine.
#[tauri::command]
async fn spine_set_style(
    app: AppHandle,
    book_id: i64,
    style: pocketlibrary_core::SpineStyle,
) -> Result<(), ApiError> {
    blocking(move || {
        let api = app.state::<Api>();
        api.set_spine_style(book_id, style)
    })
    .await
}

/// Read a cached spine without running inference; `None` means no entry yet.
#[tauri::command]
async fn spine_artifact(
    app: AppHandle,
    book_id: i64,
) -> Result<Option<spine_service::SpineArtifact>, ApiError> {
    blocking(move || {
        let service = app.state::<spine_service::SpineService>();
        let api = app.state::<Api>();
        service.artifact(book_id, api.inner())
    })
    .await
}

/// Whether the model bundle is available. Resolves the models once per app run.
#[tauri::command]
async fn spine_status(app: AppHandle) -> Result<spine_service::SpineStatus, ApiError> {
    let status = blocking({
        let app = app.clone();
        move || {
            let service = app.state::<spine_service::SpineService>();
            Ok(service.status())
        }
    })
    .await?;
    // `status` resolves the bundled models. If jobs were waiting for them,
    // this is the moment they can start.
    app.state::<spine_queue::SpineQueue>().kick();
    Ok(status)
}

#[tauri::command]
fn log_diagnostic(
    diag: tauri::State<'_, Arc<Diagnostics>>,
    level: String,
    event: String,
    message: String,
) {
    diag.append(Level::parse(&level), &event, &message);
}

#[tauri::command]
fn diagnostics_summary(diag: tauri::State<'_, Arc<Diagnostics>>) -> DiagnosticsSummary {
    diag.summary()
}

#[tauri::command]
fn clear_diagnostics(diag: tauri::State<'_, Arc<Diagnostics>>) {
    diag.clear();
}

#[tauri::command]
async fn export_diagnostics(app: AppHandle) -> Result<tauri::ipc::Response, ApiError> {
    blocking(move || {
        let bytes = diagnostics_zip(&app)?;
        // A cache copy is the staging point for sharing. The path stays in the
        // shell; the WebView only ever sees the bytes it hands to the share
        // sheet or the save picker.
        if let Ok(cache) = app.path().app_cache_dir() {
            let staging = cache.join("diagnostics");
            let _ = fs::create_dir_all(&staging);
            let _ = fs::write(staging.join(diagnostics::export_file_name()), &bytes);
        }
        log_diag(
            &app,
            Level::Info,
            "diagnostics.export",
            &format!("prepared {} bytes for sharing", bytes.len()),
        );
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

#[tauri::command]
async fn save_diagnostics(app: AppHandle) -> Result<Option<SavedDiagnostics>, ApiError> {
    blocking(move || save_diagnostics_response(&app)).await
}

#[tauri::command]
async fn share_diagnostics(app: AppHandle) -> Result<Option<SharedDiagnostics>, ApiError> {
    blocking(move || share_diagnostics_response(&app)).await
}

#[cfg(target_os = "android")]
fn delete_book_response(app: &AppHandle, book_id: i64, delete_file: bool) -> Result<(), ApiError> {
    let api = app.state::<Api>();
    let path = api.book_path(book_id)?;
    app.state::<spine_queue::SpineQueue>().remove(book_id);
    app.state::<spine_service::SpineService>()
        .remove_cache(book_id);
    if delete_file {
        let token = api.library_folder()?.ok_or_else(|| {
            api_error(
                "library_unavailable",
                "No library folder has been chosen yet.",
            )
        })?;
        let uri = parse_folder_token(&token);
        if !grant_is_valid(app, &uri) {
            return Err(api_error(
                "library_unavailable",
                "The library folder is no longer accessible.",
            ));
        }
        let source = SafSource::new(app.android_fs(), uri);
        if let Some(file_uri) = source.uri_for_path(&path)? {
            app.android_fs().remove_file(&file_uri).map_err(|error| {
                logged_error(
                    "delete_book",
                    "The book file could not be deleted. It is still in your library.",
                    error,
                )
            })?;
        }
    }
    api.delete_book(book_id)?;
    log_diag(
        app,
        Level::Info,
        "book.deleted",
        &format!("book {book_id} removed at {path} (file deleted: {delete_file})"),
    );
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn delete_book_response(app: &AppHandle, book_id: i64, _delete_file: bool) -> Result<(), ApiError> {
    let api = app.state::<Api>();
    app.state::<spine_queue::SpineQueue>().remove(book_id);
    app.state::<spine_service::SpineService>()
        .remove_cache(book_id);
    api.delete_book(book_id)?;
    log_diag(
        app,
        Level::Info,
        "book.deleted",
        &format!("book {book_id} removed from the catalogue"),
    );
    Ok(())
}

#[cfg(target_os = "android")]
fn open_book_externally_response(app: &AppHandle, book_id: i64) -> Result<(), ApiError> {
    let api = app.state::<Api>();
    let token = api.library_folder()?.ok_or_else(|| {
        api_error(
            "library_unavailable",
            "No library folder has been chosen yet.",
        )
    })?;
    let uri = parse_folder_token(&token);
    if !grant_is_valid(app, &uri) {
        return Err(api_error(
            "library_unavailable",
            "The library folder is no longer accessible.",
        ));
    }
    let path = api.book_path(book_id)?;
    let source = SafSource::new(app.android_fs(), uri);
    let file_uri = source
        .uri_for_path(&path)?
        .ok_or_else(|| api_error("book_not_found", "That book could not be found."))?;
    app.android_fs()
        .opener()
        .open_file(&file_uri)
        .map_err(|error| {
            logged_error(
                "external_reader",
                "No other reader could be opened for this book.",
                error,
            )
        })?;
    // The opener returns as soon as the chooser is requested. Remember the
    // book and mark it reading on the next resume, so an opened chooser alone
    // never changes the shelf.
    if let Ok(mut pending) = app.state::<PendingExternal>().book_id.lock() {
        *pending = Some(book_id);
    }
    log_diag(
        app,
        Level::Info,
        "reader.external",
        &format!("book {book_id} handed to another app at {path}"),
    );
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn open_book_externally_response(_app: &AppHandle, _book_id: i64) -> Result<(), ApiError> {
    Err(api_error(
        "unsupported",
        "Opening a book in another app needs the Android build.",
    ))
}

#[tauri::command]
async fn export_backup(app: AppHandle) -> Result<Option<BackupExport>, ApiError> {
    blocking(move || export_backup_response(&app)).await
}

#[tauri::command]
async fn preview_backup(app: AppHandle) -> Result<Option<BackupSelection>, ApiError> {
    blocking(move || preview_backup_response(&app)).await
}

#[tauri::command]
async fn import_backup(
    app: AppHandle,
    token: String,
    mode: ImportMode,
) -> Result<ImportOutcome, ApiError> {
    blocking(move || import_backup_response(&app, &token, mode)).await
}

#[tauri::command]
async fn open_book_externally(app: AppHandle, book_id: i64) -> Result<(), ApiError> {
    blocking(move || open_book_externally_response(&app, book_id)).await
}

#[tauri::command]
fn enqueue_download(app: AppHandle, request: DownloadRequest) -> Result<Download, ApiError> {
    let download = {
        let api = app.state::<Api>();
        api.enqueue_download(request)?
    };
    spawn_download_worker(app);
    Ok(download)
}

#[tauri::command]
fn list_downloads(api: tauri::State<'_, Api>) -> Result<Vec<Download>, ApiError> {
    api.list_downloads()
}

#[tauri::command]
fn cancel_download(api: tauri::State<'_, Api>, id: i64) -> Result<(), ApiError> {
    api.cancel_download(id)
}

#[tauri::command]
fn retry_download(app: AppHandle, id: i64) -> Result<Download, ApiError> {
    let download = {
        let api = app.state::<Api>();
        api.retry_download(id)?
    };
    spawn_download_worker(app);
    Ok(download)
}

#[tauri::command]
fn app_info(api: tauri::State<'_, Api>) -> Result<AppInfo, ApiError> {
    api.app_info()
}

#[tauri::command]
fn enrichment_settings(api: tauri::State<'_, Api>) -> Result<EnrichmentSettings, ApiError> {
    api.enrichment_settings()
}

#[tauri::command]
fn set_enrichment_mode(
    api: tauri::State<'_, Api>,
    mode: EnrichmentMode,
) -> Result<EnrichmentSettings, ApiError> {
    api.set_enrichment_mode(mode)
}

#[tauri::command]
async fn lookup_enrichment(
    api: tauri::State<'_, Api>,
    book_id: i64,
    force: bool,
) -> Result<EnrichmentOutcome, ApiError> {
    api.lookup_enrichment(book_id, force).await
}

#[tauri::command]
async fn accept_enrichment_candidate(
    api: tauri::State<'_, Api>,
    book_id: i64,
    key: String,
) -> Result<EnrichmentOutcome, ApiError> {
    api.accept_enrichment_candidate(book_id, &key).await
}

#[tauri::command]
fn cancel_enrichment(api: tauri::State<'_, Api>, book_id: i64) -> Result<(), ApiError> {
    api.cancel_enrichment(book_id)
}

#[tauri::command]
fn edit_blurb(
    api: tauri::State<'_, Api>,
    book_id: i64,
    text: Option<String>,
) -> Result<(), ApiError> {
    api.edit_blurb(book_id, text.as_deref())
}

#[tauri::command]
fn revert_enrichment(api: tauri::State<'_, Api>, book_id: i64) -> Result<(), ApiError> {
    api.revert_enrichment(book_id)
}

#[tauri::command]
fn cover_choices(api: tauri::State<'_, Api>, book_id: i64) -> Result<CoverChoices, ApiError> {
    api.cover_choices(book_id)
}

#[tauri::command]
async fn lookup_cover_candidates(
    api: tauri::State<'_, Api>,
    book_id: i64,
) -> Result<CoverLookupOutcome, ApiError> {
    api.lookup_cover_candidates(book_id).await
}

#[tauri::command]
async fn apply_cover_choice(
    api: tauri::State<'_, Api>,
    book_id: i64,
    choice: CoverOption,
    acknowledged: bool,
) -> Result<(), ApiError> {
    api.apply_cover_choice(book_id, choice, acknowledged).await
}

#[tauri::command]
async fn choose_device_cover(
    app: AppHandle,
    book_id: i64,
) -> Result<Option<DeviceCoverPreview>, ApiError> {
    blocking(move || choose_device_cover_response(&app, book_id)).await
}

#[tauri::command]
async fn apply_device_cover(
    api: tauri::State<'_, Api>,
    book_id: i64,
    token: String,
    acknowledged: bool,
) -> Result<(), ApiError> {
    api.apply_device_cover(book_id, &token, acknowledged).await
}

#[tauri::command]
fn reset_cover(api: tauri::State<'_, Api>, book_id: i64) -> Result<(), ApiError> {
    api.reset_cover(book_id)
}

#[tauri::command]
fn enrichment_targets(api: tauri::State<'_, Api>, limit: usize) -> Result<Vec<Book>, ApiError> {
    api.enrichment_targets(limit)
}

/// Search Libgen from the front desk. Network work runs on the async runtime;
/// the provider keeps mirror health in memory between calls.
#[tauri::command]
async fn search_libgen(
    api: tauri::State<'_, Api>,
    query: SearchQuery,
) -> Result<SearchPage, ApiError> {
    api.search_libgen(query).await
}

#[tauri::command]
fn list_books(api: tauri::State<'_, Api>) -> Result<Vec<Book>, ApiError> {
    api.list_books()
}

#[tauri::command]
fn list_shelves(api: tauri::State<'_, Api>) -> Result<Vec<Shelf>, ApiError> {
    api.list_shelves()
}

#[tauri::command]
async fn get_book_detail(app: AppHandle, id: i64) -> Result<BookDetail, ApiError> {
    blocking(move || {
        let api = app.state::<Api>();
        #[cfg(target_os = "android")]
        {
            if let Some(token) = api.library_folder()? {
                let uri = parse_folder_token(&token);
                if grant_is_valid(&app, &uri) {
                    let source = SafSource::new(app.android_fs(), uri);
                    return api.get_book_detail(id, Some(&source));
                }
            }
        }
        api.get_book_detail(id, None)
    })
    .await
}

#[tauri::command]
async fn library_status(app: AppHandle) -> Result<LibraryStatus, ApiError> {
    blocking(move || current_status(&app)).await
}

#[tauri::command]
async fn choose_library_folder(app: AppHandle) -> Result<LibraryStatus, ApiError> {
    blocking(move || choose_folder(&app)).await
}

#[tauri::command]
async fn rescan_library(app: AppHandle) -> Result<ScanReport, ApiError> {
    blocking(move || rescan(&app)).await
}

#[tauri::command]
fn move_book(
    api: tauri::State<'_, Api>,
    book_id: i64,
    shelf_id: i64,
    slot_index: i64,
) -> Result<(), ApiError> {
    api.move_book(book_id, shelf_id, slot_index)
}

#[tauri::command]
async fn delete_book(app: AppHandle, book_id: i64, delete_file: bool) -> Result<(), ApiError> {
    blocking(move || delete_book_response(&app, book_id, delete_file)).await
}

#[tauri::command]
fn get_shelf_capacity(api: tauri::State<'_, Api>) -> Result<i64, ApiError> {
    api.shelf_capacity()
}

#[tauri::command]
fn set_shelf_capacity(api: tauri::State<'_, Api>, capacity: i64) -> Result<i64, ApiError> {
    api.set_shelf_capacity(capacity)
}

#[tauri::command]
fn get_download_naming(api: tauri::State<'_, Api>) -> Result<String, ApiError> {
    api.download_naming()
}

#[tauri::command]
fn set_download_naming(api: tauri::State<'_, Api>, pattern: String) -> Result<String, ApiError> {
    api.set_download_naming(&pattern)
}

#[tauri::command]
fn label_usage(api: tauri::State<'_, Api>) -> Result<Vec<LabelUsage>, ApiError> {
    api.label_usage()
}

#[tauri::command]
fn create_label(
    api: tauri::State<'_, Api>,
    name: String,
    colour: String,
) -> Result<Label, ApiError> {
    api.create_label(&name, &colour)
}

#[tauri::command]
fn rename_label(
    api: tauri::State<'_, Api>,
    label_id: i64,
    name: String,
) -> Result<Label, ApiError> {
    api.rename_label(label_id, &name)
}

#[tauri::command]
fn recolour_label(
    api: tauri::State<'_, Api>,
    label_id: i64,
    colour: String,
) -> Result<Label, ApiError> {
    api.recolour_label(label_id, &colour)
}

#[tauri::command]
fn delete_label(api: tauri::State<'_, Api>, label_id: i64) -> Result<(), ApiError> {
    api.delete_label(label_id)
}

#[tauri::command]
fn attach_label(api: tauri::State<'_, Api>, book_id: i64, label_id: i64) -> Result<(), ApiError> {
    api.attach_label(book_id, label_id)
}

#[tauri::command]
fn detach_label(api: tauri::State<'_, Api>, book_id: i64, label_id: i64) -> Result<(), ApiError> {
    api.detach_label(book_id, label_id)
}

#[tauri::command]
async fn read_book(app: AppHandle, book_id: i64) -> Result<tauri::ipc::Response, ApiError> {
    blocking(move || read_book_response(&app, book_id)).await
}

#[tauri::command]
fn list_bookmarks(api: tauri::State<'_, Api>, book_id: i64) -> Result<Vec<Bookmark>, ApiError> {
    api.list_bookmarks(book_id)
}

#[tauri::command]
fn add_bookmark(
    api: tauri::State<'_, Api>,
    book_id: i64,
    locator: String,
) -> Result<Bookmark, ApiError> {
    api.add_bookmark(book_id, &locator)
}

#[tauri::command]
fn delete_bookmark(
    api: tauri::State<'_, Api>,
    book_id: i64,
    bookmark_id: i64,
) -> Result<(), ApiError> {
    api.delete_bookmark(book_id, bookmark_id)
}

#[tauri::command]
fn list_annotations(api: tauri::State<'_, Api>, book_id: i64) -> Result<Vec<Annotation>, ApiError> {
    api.list_annotations(book_id)
}

#[tauri::command]
fn create_annotation(
    api: tauri::State<'_, Api>,
    book_id: i64,
    kind: AnnotationKind,
    colour: Option<String>,
    note: Option<String>,
    locator: String,
) -> Result<Annotation, ApiError> {
    api.create_annotation(book_id, kind, colour.as_deref(), note.as_deref(), &locator)
}

#[tauri::command]
fn update_annotation(
    api: tauri::State<'_, Api>,
    book_id: i64,
    annotation_id: i64,
    colour: Option<String>,
    note: Option<String>,
    locator: Option<String>,
) -> Result<Annotation, ApiError> {
    api.update_annotation(
        book_id,
        annotation_id,
        colour.as_deref(),
        note.as_deref(),
        locator.as_deref(),
    )
}

#[tauri::command]
fn delete_annotation(
    api: tauri::State<'_, Api>,
    book_id: i64,
    annotation_id: i64,
) -> Result<(), ApiError> {
    api.delete_annotation(book_id, annotation_id)
}

#[tauri::command]
fn record_open(api: tauri::State<'_, Api>, book_id: i64) -> Result<(), ApiError> {
    api.record_open(book_id)
}

#[tauri::command]
fn record_progress(
    api: tauri::State<'_, Api>,
    book_id: i64,
    progress: f64,
    locator: Option<String>,
) -> Result<ReadingStatus, ApiError> {
    api.record_progress(book_id, progress, locator.as_deref())
}

#[tauri::command]
fn reading_state(api: tauri::State<'_, Api>, book_id: i64) -> Result<ReadingState, ApiError> {
    api.reading_state(book_id)
}

#[tauri::command]
fn set_reading_status(
    api: tauri::State<'_, Api>,
    book_id: i64,
    status: ReadingStatus,
) -> Result<(), ApiError> {
    api.set_reading_status(book_id, status)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let diagnostics = Arc::new(Diagnostics::new(data_dir.join("diagnostics.log")));
            diagnostics::install_global(Arc::clone(&diagnostics));
            diagnostics::install_panic_hook(Arc::clone(&diagnostics));
            spine_assets::install_panic_hook(data_dir.clone());
            app.manage(Arc::clone(&diagnostics));
            let unexpected = diagnostics.start_session()?;
            let api = Api::open(data_dir.join("library.db"))?;
            let info = api.app_info().map_err(|error| {
                std::io::Error::other(format!("app info: {} {}", error.code, error.message))
            })?;
            diagnostics.append(
                Level::Info,
                "startup",
                &format!(
                    "PocketLibrary {} schema {}{}",
                    info.app_version,
                    info.schema_version,
                    if unexpected {
                        "; previous session ended unexpectedly"
                    } else {
                        ""
                    }
                ),
            );
            app.manage(api);
            app.manage(spine_service::SpineService::new(data_dir.clone()));
            let spine_queue = spine_queue::SpineQueue::new(data_dir.clone(), app.handle().clone());
            app.manage(spine_queue);
            // Once per model bundle, queue the existing library behind any
            // restored jobs. New downloads, scans and cover changes enqueue
            // their own book immediately.
            app.state::<spine_queue::SpineQueue>()
                .backfill_once(app.state::<Api>().inner());
            let updates_state = updates::UpdatesState::from_config(app.config());
            app.manage(updates_state);
            app.manage(BackupExchange::default());
            app.manage(PendingExternal::default());
            spawn_download_worker(app.handle().clone());
            // Re-queue unfinished automatic jobs from the previous process.
            app.state::<spine_queue::SpineQueue>().kick();
            Ok(())
        });

    // tauri-plugin-android-fs only provides functionality on Android; registering
    // it conditionally keeps the desktop build compiling cleanly.
    #[cfg(target_os = "android")]
    {
        builder = builder
            .plugin(tauri_plugin_android_fs::init())
            .plugin(updates::android_plugin());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            app_info,
            enrichment_settings,
            set_enrichment_mode,
            lookup_enrichment,
            accept_enrichment_candidate,
            cancel_enrichment,
            edit_blurb,
            revert_enrichment,
            cover_choices,
            lookup_cover_candidates,
            apply_cover_choice,
            choose_device_cover,
            apply_device_cover,
            reset_cover,
            enrichment_targets,
            updates::updates_check,
            updates::updates_download,
            updates::updates_install,
            search_libgen,
            enqueue_download,
            list_downloads,
            cancel_download,
            retry_download,
            list_books,
            list_shelves,
            get_book_detail,
            library_status,
            choose_library_folder,
            rescan_library,
            move_book,
            delete_book,
            get_shelf_capacity,
            set_shelf_capacity,
            get_download_naming,
            set_download_naming,
            label_usage,
            create_label,
            rename_label,
            recolour_label,
            delete_label,
            attach_label,
            detach_label,
            read_book,
            list_bookmarks,
            add_bookmark,
            delete_bookmark,
            list_annotations,
            create_annotation,
            update_annotation,
            delete_annotation,
            record_open,
            record_progress,
            reading_state,
            set_reading_status,
            export_backup,
            preview_backup,
            import_backup,
            open_book_externally,
            log_diagnostic,
            diagnostics_summary,
            clear_diagnostics,
            export_diagnostics,
            save_diagnostics,
            share_diagnostics,
            spine_generate,
            spine_artifact,
            spine_status,
            spine_enqueue,
            spine_queue,
            spine_pause,
            spine_set_style
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(diagnostics) = app.try_state::<Arc<Diagnostics>>()
            {
                diagnostics.end_session();
            }
            // Android resumes the activity after the external reader handoff
            // (and after a cancelled chooser). Mark the pending book then,
            // never at the moment the chooser opens.
            if matches!(event, tauri::RunEvent::Resumed) {
                let pending = app
                    .state::<PendingExternal>()
                    .book_id
                    .lock()
                    .ok()
                    .and_then(|mut book_id| book_id.take());
                if let Some(book_id) = pending {
                    let api = app.state::<Api>();
                    if let Err(error) = api.record_open(book_id) {
                        eprintln!(
                            "pocketlibrary: external reader status not saved ({:?})",
                            error.code
                        );
                    }
                }
            }
        });
}
