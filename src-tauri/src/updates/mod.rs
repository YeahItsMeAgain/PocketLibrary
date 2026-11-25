//! Android in-app update backend.
//!
//! Tauri's official updater plugin only supports Windows, macOS and Linux. The
//! Android replacement here follows the same trust model (HTTPS manifest plus
//! a minisign signature over the APK) but hands the verified file to Android's
//! package installer instead of applying a desktop bundle.
//!
//! The flow is deliberately split into three explicit user-facing actions:
//! [`updates_check`] fetches a few kilobytes of metadata, [`updates_download`]
//! transfers the APK with progress events, and [`updates_install`] opens the
//! package installer. Nothing downloads until the user asks for it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use pocketlibrary_core::updates::{
    MAX_APK_BYTES, MAX_MANIFEST_BYTES, ReleaseManifest, UpdateError as ManifestError,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

const DEFAULT_ENDPOINT: &str =
    "https://github.com/YeahItsMeAgain/PocketLibrary/releases/latest/download/latest.json";
const USER_AGENT: &str = concat!("PocketLibrary/", env!("CARGO_PKG_VERSION"));
const DOWNLOAD_DIR: &str = "updates";

/// A compact error shape shared with the web layer. Codes are stable; the
/// message is safe to show to the user.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    code: String,
    message: String,
}

impl UpdateError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn config(message: impl Into<String>) -> Self {
        Self::new("updaterNotConfigured", message)
    }

    fn network() -> Self {
        Self::new(
            "network",
            "Couldn't reach the update server. Check your connection and try again.",
        )
    }
}

impl From<ManifestError> for UpdateError {
    fn from(error: ManifestError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<std::io::Error> for UpdateError {
    fn from(error: std::io::Error) -> Self {
        Self::new("io", format!("Couldn't store the update: {error}"))
    }
}

impl From<tauri::Error> for UpdateError {
    fn from(error: tauri::Error) -> Self {
        Self::new("io", format!("Couldn't find the app cache: {error}"))
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterSettings {
    #[serde(default)]
    pubkey: String,
    #[serde(default)]
    endpoints: Vec<String>,
}

impl UpdaterSettings {
    fn from_config(config: &tauri::Config) -> Self {
        config
            .plugins
            .0
            .get("updater")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default()
    }

    fn endpoint(&self) -> Result<&str, UpdateError> {
        let endpoint = self
            .endpoints
            .iter()
            .map(|value| value.trim())
            .find(|value| !value.is_empty())
            .unwrap_or(DEFAULT_ENDPOINT);
        let parsed = url::Url::parse(endpoint).map_err(|_| {
            UpdateError::config("The updater endpoint in tauri.conf.json is not a valid URL.")
        })?;
        if parsed.scheme() != "https" {
            return Err(UpdateError::config(
                "The updater endpoint in tauri.conf.json must use HTTPS.",
            ));
        }
        Ok(endpoint)
    }

    fn public_key(&self) -> Result<&str, UpdateError> {
        if self.pubkey.trim().is_empty() {
            return Err(UpdateError::config(
                "No updater public key is configured in tauri.conf.json.",
            ));
        }
        Ok(self.pubkey.trim())
    }
}

/// A verified download waiting for the user to confirm installation.
#[derive(Clone)]
struct DownloadedApk {
    path: PathBuf,
    manifest: ReleaseManifest,
}

pub struct UpdatesState {
    settings: UpdaterSettings,
    /// The newest release from the last successful check. Download only ever
    /// uses this value, never a URL supplied by the web layer.
    latest: Mutex<Option<ReleaseManifest>>,
    downloaded: Mutex<Option<DownloadedApk>>,
    downloading: AtomicBool,
}

impl UpdatesState {
    pub fn from_config(config: &tauri::Config) -> Self {
        Self {
            settings: UpdaterSettings::from_config(config),
            latest: Mutex::new(None),
            downloaded: Mutex::new(None),
            downloading: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub available: bool,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

impl UpdateCheck {
    fn up_to_date(current_version: String, latest: &ReleaseManifest) -> Self {
        Self {
            current_version,
            available: false,
            latest_version: Some(latest.version.clone()),
            notes: None,
            pub_date: None,
            size: None,
            sha256: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub version: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum DownloadEvent {
    Started {
        content_length: Option<u64>,
        total: u64,
    },
    Progress {
        chunk_length: u64,
        downloaded: u64,
        content_length: Option<u64>,
    },
    Finished {
        bytes: u64,
    },
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Read a response body while enforcing the manifest's small size limit even
/// when the server lies about `Content-Length`.
async fn read_limited(response: wreq::Response, limit: usize) -> Result<Vec<u8>, UpdateError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| UpdateError::network())?;
        if body.len() + chunk.len() > limit {
            return Err(UpdateError::new(
                "manifestInvalid",
                "The update server sent an unexpectedly large manifest.",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn check_client() -> Result<wreq::Client, UpdateError> {
    wreq::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(wreq::redirect::Policy::limited(5))
        .build()
        .map_err(|_| UpdateError::network())
}

fn download_client() -> Result<wreq::Client, UpdateError> {
    wreq::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .redirect(wreq::redirect::Policy::limited(8))
        .build()
        .map_err(|_| UpdateError::network())
}

/// Fetch and validate `latest.json`. Returns the running version even when no
/// update is available so the UI can show "up to date".
#[tauri::command]
pub async fn updates_check(app: AppHandle) -> Result<UpdateCheck, UpdateError> {
    let current = current_version();
    let endpoint = app.state::<UpdatesState>().settings.endpoint()?.to_owned();
    let client = check_client()?;

    let response = client
        .get(&endpoint)
        .header(wreq::header::USER_AGENT, USER_AGENT)
        .header(wreq::header::CACHE_CONTROL, "no-cache")
        .header(wreq::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| UpdateError::network())?;

    if response.status().as_u16() == 204 {
        let state = app.state::<UpdatesState>();
        *state.latest.lock().unwrap() = None;
        return Ok(UpdateCheck {
            current_version: current,
            available: false,
            latest_version: None,
            notes: None,
            pub_date: None,
            size: None,
            sha256: None,
        });
    }
    if !response.status().is_success() {
        return Err(UpdateError::new(
            "server",
            format!("The update server answered {}.", response.status().as_u16()),
        ));
    }

    if let Some(length) = response.content_length()
        && length > MAX_MANIFEST_BYTES as u64
    {
        return Err(UpdateError::new(
            "manifestInvalid",
            "The update server sent an unexpectedly large manifest.",
        ));
    }
    let bytes = read_limited(response, MAX_MANIFEST_BYTES).await?;
    let manifest = ReleaseManifest::parse(&bytes)?;
    let available = manifest.is_newer_than(&current)?;

    let state = app.state::<UpdatesState>();
    *state.latest.lock().unwrap() = available.then(|| manifest.clone());

    if !available {
        return Ok(UpdateCheck::up_to_date(current, &manifest));
    }

    Ok(UpdateCheck {
        current_version: current,
        available: true,
        latest_version: Some(manifest.version.clone()),
        notes: Some(manifest.notes.clone()),
        pub_date: manifest.pub_date.clone(),
        size: Some(manifest.size),
        sha256: Some(manifest.sha256.clone()),
    })
}

/// Download and verify the release found by the most recent [`updates_check`].
///
/// The APK is written to a temporary file in the app cache, checked for exact
/// size, SHA-256 and the minisign signature, then renamed into place. A failed
/// check deletes the file; a verified file can only be installed explicitly.
#[tauri::command]
pub async fn updates_download(
    app: AppHandle,
    on_event: Channel<DownloadEvent>,
) -> Result<DownloadedUpdate, UpdateError> {
    let (manifest, public_key) = {
        let state = app.state::<UpdatesState>();
        let manifest = state
            .latest
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| UpdateError::new("noUpdate", "Check for updates first."))?;
        (manifest, state.settings.public_key()?.to_owned())
    };

    if app
        .state::<UpdatesState>()
        .downloading
        .swap(true, Ordering::SeqCst)
    {
        return Err(UpdateError::new(
            "downloadInProgress",
            "An update download is already running.",
        ));
    }

    let result = download_to_cache(&app, &manifest, &public_key, &on_event).await;
    app.state::<UpdatesState>()
        .downloading
        .store(false, Ordering::SeqCst);

    let downloaded = result?;
    let summary = DownloadedUpdate {
        version: manifest.version.clone(),
        bytes: manifest.size,
        sha256: manifest.sha256.to_ascii_lowercase(),
    };
    *app.state::<UpdatesState>().downloaded.lock().unwrap() = Some(downloaded);
    Ok(summary)
}

async fn download_to_cache(
    app: &AppHandle,
    manifest: &ReleaseManifest,
    public_key: &str,
    on_event: &Channel<DownloadEvent>,
) -> Result<DownloadedApk, UpdateError> {
    let dir = app.path().app_cache_dir()?.join(DOWNLOAD_DIR);
    fs::create_dir_all(&dir)?;
    remove_stale_files(&dir);

    let final_path = dir.join(format!("PocketLibrary-{}.apk", manifest.version));
    let part_path = dir.join("download.part");
    let _ = fs::remove_file(&part_path);

    let client = download_client()?;
    let response = client
        .get(&manifest.url)
        .header(wreq::header::USER_AGENT, USER_AGENT)
        .header(wreq::header::ACCEPT, "application/octet-stream")
        .send()
        .await
        .map_err(|_| UpdateError::network())?;

    if !response.status().is_success() {
        return Err(UpdateError::new(
            "server",
            format!(
                "The download server answered {}.",
                response.status().as_u16()
            ),
        ));
    }

    let content_length = response.content_length();
    if let Some(length) = content_length
        && length != manifest.size
    {
        return Err(UpdateError::new(
            "sizeMismatch",
            format!(
                "The update server offered {length} bytes; the manifest says {}.",
                manifest.size
            ),
        ));
    }
    if manifest.size > MAX_APK_BYTES {
        return Err(UpdateError::new(
            "sizeInvalid",
            "The update is larger than PocketLibrary accepts.",
        ));
    }

    let _ = on_event.send(DownloadEvent::Started {
        content_length,
        total: manifest.size,
    });

    let write_result = write_stream(
        &part_path,
        response,
        manifest.size,
        content_length,
        on_event,
    )
    .await;
    if let Err(error) = write_result {
        let _ = fs::remove_file(&part_path);
        return Err(error);
    }

    if let Err(error) = pocketlibrary_core::updates::verify_apk(&part_path, manifest, public_key) {
        let _ = fs::remove_file(&part_path);
        return Err(error.into());
    }

    fs::rename(&part_path, &final_path)?;
    let _ = on_event.send(DownloadEvent::Finished {
        bytes: manifest.size,
    });

    Ok(DownloadedApk {
        path: final_path,
        manifest: manifest.clone(),
    })
}

async fn write_stream(
    path: &Path,
    response: wreq::Response,
    expected: u64,
    content_length: Option<u64>,
    on_event: &Channel<DownloadEvent>,
) -> Result<(), UpdateError> {
    use std::io::Write as _;

    let mut file = fs::File::create(path)?;
    let mut stream = response.bytes_stream();
    let mut downloaded = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| UpdateError::network())?;
        downloaded += chunk.len() as u64;
        if downloaded > expected {
            return Err(UpdateError::new(
                "sizeMismatch",
                "The download was larger than the manifest declared.",
            ));
        }
        file.write_all(&chunk)?;
        let _ = on_event.send(DownloadEvent::Progress {
            chunk_length: chunk.len() as u64,
            downloaded,
            content_length,
        });
    }
    file.flush()?;
    drop(file);

    if downloaded != expected {
        return Err(UpdateError::new(
            "sizeMismatch",
            format!("The download stopped at {downloaded} of {expected} bytes."),
        ));
    }
    Ok(())
}

fn remove_stale_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let extension = path.extension().and_then(|value| value.to_str());
        if matches!(extension, Some("apk" | "part")) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Open Android's package installer for the verified APK.
///
/// Android may first need the user to allow "install unknown apps" for
/// PocketLibrary. The Kotlin bridge opens that settings screen and rejects with
/// code `installPermission`; the UI should let the user retry after returning.
#[tauri::command]
pub async fn updates_install(app: AppHandle) -> Result<InstallResult, UpdateError> {
    let (downloaded, public_key) = {
        let state = app.state::<UpdatesState>();
        let downloaded = state
            .downloaded
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| UpdateError::new("noDownload", "Download the update first."))?;
        (downloaded, state.settings.public_key()?.to_owned())
    };

    // Re-check before handing the path to another process: the cache file could
    // have been replaced after the download completed.
    pocketlibrary_core::updates::verify_apk(&downloaded.path, &downloaded.manifest, &public_key)?;

    #[cfg(target_os = "android")]
    {
        let installer = app
            .try_state::<android::AndroidInstaller<tauri::Wry>>()
            .map(|state| state.0.clone())
            .ok_or_else(|| {
                UpdateError::new(
                    "installUnavailable",
                    "The Android installer is unavailable.",
                )
            })?;
        let path = downloaded.path.to_string_lossy().to_string();
        let result = installer
            .run_mobile_plugin_async::<InstallResult>(
                "installApk",
                serde_json::json!({ "path": path }),
            )
            .await
            .map_err(plugin_error)?;
        Ok(result)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = downloaded;
        Err(UpdateError::new(
            "unsupportedPlatform",
            "In-app installation is only available on Android.",
        ))
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    #[serde(default)]
    pub started: bool,
}

#[cfg(target_os = "android")]
fn plugin_error(error: tauri::plugin::mobile::PluginInvokeError) -> UpdateError {
    match error {
        tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) => UpdateError::new(
            response.code.unwrap_or_else(|| "installFailed".to_owned()),
            response
                .message
                .unwrap_or_else(|| "Android could not open the package installer.".to_owned()),
        ),
        other => UpdateError::new("installFailed", other.to_string()),
    }
}

#[cfg(target_os = "android")]
mod android {
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{Manager, Runtime};

    /// The registered Kotlin bridge. Kept in app state so commands can call it.
    pub struct AndroidInstaller<R: Runtime>(pub PluginHandle<R>);

    pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
        Builder::<R, ()>::new("pocketlibrary-updater")
            .setup(|app, api| {
                let handle = api.register_android_plugin("app.pocketlibrary", "UpdatesPlugin")?;
                app.manage(AndroidInstaller(handle));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "android")]
pub use android::plugin as android_plugin;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_reads_endpoint_and_key_and_trims_key() {
        let settings = UpdaterSettings {
            pubkey: " key ".to_owned(),
            endpoints: vec![" https://example.test/latest.json ".to_owned()],
        };
        assert_eq!(
            settings.endpoint().unwrap(),
            "https://example.test/latest.json"
        );
        assert_eq!(settings.public_key().unwrap(), "key");
    }

    #[test]
    fn settings_rejects_a_plain_http_endpoint() {
        let settings = UpdaterSettings {
            pubkey: "key".to_owned(),
            endpoints: vec!["http://example.test/latest.json".to_owned()],
        };
        assert!(settings.endpoint().is_err());
    }

    #[test]
    fn settings_defaults_to_github_and_rejects_missing_key() {
        let settings = UpdaterSettings::default();
        assert_eq!(settings.endpoint().unwrap(), DEFAULT_ENDPOINT);
        assert!(settings.public_key().is_err());
    }

    #[test]
    fn stale_file_cleanup_only_removes_downloads() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.apk"), b"old").unwrap();
        std::fs::write(dir.path().join("download.part"), b"old").unwrap();
        std::fs::write(dir.path().join("keep.txt"), b"keep").unwrap();
        remove_stale_files(dir.path());
        assert!(!dir.path().join("a.apk").exists());
        assert!(!dir.path().join("download.part").exists());
        assert!(dir.path().join("keep.txt").exists());
    }
}
