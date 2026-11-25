//! Tauri shell around the PocketLibrary core catalog.
//!
//! The commands here are thin wrappers over `pocketlibrary_core::Api`; the web
//! UI reaches them only through the typed platform adapter.

#[cfg(target_os = "android")]
use std::io::{Read, Write};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use pocketlibrary_core::{
    Annotation, AnnotationKind, Api, ApiError, AppInfo, BackupPreview, BackupReport, Book,
    BookDetail, Bookmark, Download, DownloadRequest, DownloadSink, ImportMode, Label, LabelUsage,
    LibraryStatus, ReadingState, ReadingStatus, ScanReport, SearchPage, SearchQuery, Shelf,
};

#[cfg(target_os = "android")]
mod saf;

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
    api_error(code, user_message)
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
        return Err(api_error(
            "library_unavailable",
            "The library folder is no longer accessible.",
        ));
    }

    let source = SafSource::new(app.android_fs(), uri);
    api.scan(&source)
}

#[cfg(not(target_os = "android"))]
fn rescan(_app: &AppHandle) -> Result<ScanReport, ApiError> {
    Err(api_error(
        "library_unavailable",
        "Scanning a library folder needs the Android build.",
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
        .map_err(|error| logged_error("read_book", "That book could not be read.", error))?
        .ok_or_else(|| {
            api_error(
                "book_too_large",
                "This book is larger than 100 MB and cannot be held in memory on this device. Open it in another app instead.",
            )
        })?;
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
            let api = Api::open(data_dir.join("library.db"))?;
            app.manage(api);
            app.manage(BackupExchange::default());
            app.manage(PendingExternal::default());
            spawn_download_worker(app.handle().clone());
            Ok(())
        });

    // tauri-plugin-android-fs only provides functionality on Android; registering
    // it conditionally keeps the desktop build compiling cleanly.
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_android_fs::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            app_info,
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
            open_book_externally
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
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
