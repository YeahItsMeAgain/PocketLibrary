//! Tauri shell around the PocketLibrary core catalogue.
//!
//! The commands here are thin wrappers over `pocketlibrary_core::Service`; the
//! web UI reaches them only through the typed platform adapter.

use tauri::Manager;

use pocketlibrary_core::{AppInfo, Book, Service, Shelf};

/// A serialisable error envelope. Commands never return bare strings.
#[derive(Debug, serde::Serialize)]
struct CommandError {
    code: &'static str,
    message: String,
}

impl From<pocketlibrary_core::Error> for CommandError {
    fn from(error: pocketlibrary_core::Error) -> Self {
        Self {
            code: "catalogue",
            message: error.to_string(),
        }
    }
}

#[tauri::command]
fn app_info(service: tauri::State<'_, Service>) -> Result<AppInfo, CommandError> {
    service.app_info().map_err(Into::into)
}

#[tauri::command]
fn list_books(service: tauri::State<'_, Service>) -> Result<Vec<Book>, CommandError> {
    service.list_books().map_err(Into::into)
}

#[tauri::command]
fn list_shelves(service: tauri::State<'_, Service>) -> Result<Vec<Shelf>, CommandError> {
    service.list_shelves().map_err(Into::into)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let service = Service::open(data_dir.join("library.db"))?;
            app.manage(service);
            Ok(())
        });

    // tauri-plugin-android-fs only provides functionality on Android; registering
    // it conditionally keeps the desktop build compiling cleanly.
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_android_fs::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![app_info, list_books, list_shelves])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
