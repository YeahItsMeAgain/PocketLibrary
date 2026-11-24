//! Tauri shell around the PocketLibrary core catalog.
//!
//! The commands here are thin wrappers over `pocketlibrary_core::Api`; the web
//! UI reaches them only through the typed platform adapter.

use tauri::{AppHandle, Manager};

use pocketlibrary_core::{Api, ApiError, AppInfo, Book, LibraryStatus, ScanReport, Shelf};

#[cfg(target_os = "android")]
mod saf;

#[cfg(target_os = "android")]
use tauri_plugin_android_fs::{AndroidFsExt, FsUri, UriPermission};

#[cfg(target_os = "android")]
use crate::saf::SafSource;

fn wire(code: &'static str, message: impl Into<String>) -> ApiError {
    ApiError {
        code,
        message: message.into(),
    }
}

async fn blocking<T, F>(task: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ApiError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(task).await {
        Ok(result) => result,
        Err(error) => Err(wire("internal", format!("background task failed: {error}"))),
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
    let picked = picker
        .pick_dir(None, false)
        .map_err(|error| wire("picker", error.to_string()))?;

    let Some(uri) = picked else {
        // The user closed the picker; keep the current state.
        return current_status(app);
    };

    picker
        .persist_uri_permission(&uri)
        .map_err(|error| wire("grant", error.to_string()))?;
    let name = fs
        .get_name(&uri)
        .unwrap_or_else(|_| "Library folder".to_owned());
    let token = uri
        .to_json_string()
        .map_err(|error| wire("grant", error.to_string()))?;

    let api = app.state::<Api>();
    api.set_library_folder(&token, &name)?;
    api.library_status(true)
}

#[cfg(not(target_os = "android"))]
fn choose_folder(app: &AppHandle) -> Result<LibraryStatus, ApiError> {
    Err(wire(
        "unsupported",
        "Choosing a library folder needs the Android build.",
    ))
}

#[cfg(target_os = "android")]
fn rescan(app: &AppHandle) -> Result<ScanReport, ApiError> {
    let api = app.state::<Api>();
    let Some(token) = api.library_folder()? else {
        return Err(wire(
            "library_unavailable",
            "No library folder has been chosen yet.",
        ));
    };
    let uri = parse_folder_token(&token);
    if !grant_is_valid(app, &uri) {
        return Err(wire(
            "library_unavailable",
            "The library folder is no longer accessible.",
        ));
    }

    let source = SafSource::new(app.android_fs(), uri);
    api.scan(&source)
}

#[cfg(not(target_os = "android"))]
fn rescan(_app: &AppHandle) -> Result<ScanReport, ApiError> {
    Err(wire(
        "library_unavailable",
        "Scanning a library folder needs the Android build.",
    ))
}

#[tauri::command]
fn app_info(api: tauri::State<'_, Api>) -> Result<AppInfo, ApiError> {
    api.app_info()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let api = Api::open(data_dir.join("library.db"))?;
            app.manage(api);
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
            list_books,
            list_shelves,
            library_status,
            choose_library_folder,
            rescan_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
