//! Per-book spine generation and its on-disk cache.
//!
//! The Tauri commands are thin wrappers over `SpineService`. The heavy work
//! (image decode, ONNX inference, JPEG encode) happens on a blocking thread and
//! is guarded per book, so two UI calls cannot run the engine for the same book
//! at once. Results live under `<app data>/spine/books/<cache-key>/`, keyed by
//! the catalog content hash, a hash of the active cover bytes, the page count
//! and the model bundle id.
//!
//! Nothing here touches the network. Models come from `spine_assets`, which
//! extracts the APK assets on first use and sets `ORT_DYLIB_PATH`.

use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use pocketlibrary_core::spine_cache::{ARTIFACT_FILE, SpineCache, cache_key as spine_cache_key};
use pocketlibrary_core::{Api, ApiError, Book};
use pocketlibrary_spine::{BookInput, Engine, Models, SPINE_H, SPINE_W, Stage};

use crate::spine_assets::{self, SpineModelPaths};

/// Model bundle version. Part of the cache key and the status payload.
pub const BUNDLE_ID: &str = "spine-v1";
/// Page estimate used when a book has no reliable page count.
const ESTIMATED_PAGES: u32 = 320;

/// The wire shape shared with the frontend. Kept camelCase by serde.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineArtifact {
    pub book_id: i64,
    /// "crop" | "inpaint" | "fallback"
    pub route: String,
    /// "pass" | "review" | "fallback"
    pub verdict: String,
    pub mask_percent: f64,
    pub crop_box: Option<CropBox>,
    /// `data:image/jpeg;base64,...`
    pub art_data_url: String,
    /// `data:image/jpeg;base64,...`, exactly 52 x 236.
    pub spine_data_url: String,
    /// `data:image/jpeg;base64,...`
    pub fallback_data_url: String,
    /// True when the page count used for geometry was an estimate.
    #[serde(default)]
    pub pages_approximate: bool,
    pub run_json: Value,
    pub qa_json: Value,
}

/// One shelf-ready strip projected from a complete cache entry. The wall only
/// needs the verdict and the 52 x 236 image, so this wire shape stays small.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineCachedStrip {
    pub book_id: i64,
    /// "pass" | "review" | "fallback"
    pub verdict: String,
    /// `data:image/jpeg;base64,...`, exactly 52 x 236.
    pub spine_data_url: String,
}

/// The v8 pipeline's `final.crop_box_work`, expressed for the wire.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Engine availability, surfaced by `spine_status`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineStatus {
    /// "ready" | "bundled" | "missing" | "error"
    pub models: &'static str,
    pub bundle_id: &'static str,
    pub bytes: u64,
    pub error: Option<String>,
}

/// The managed Tauri state. Everything that needs I/O is lazy: a status call
/// resolves the models once, and the engine is only built on first generation.
pub struct SpineService {
    app_data_dir: PathBuf,
    cache: SpineCache,
    models: Mutex<Option<Result<SpineModelPaths, String>>>,
    engine: Mutex<Option<Arc<Engine>>>,
    in_flight: Mutex<HashSet<i64>>,
}

impl SpineService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let cache = SpineCache::new(&app_data_dir);
        Self {
            app_data_dir,
            cache,
            models: Mutex::new(None),
            engine: Mutex::new(None),
            in_flight: Mutex::new(HashSet::new()),
        }
    }

    /// Generate or reuse one book's spine. Call from a blocking thread.
    pub fn generate(&self, book_id: i64, api: &Api) -> Result<SpineArtifact, ApiError> {
        self.generate_with_progress(book_id, api, |_| {})
    }

    /// Generate with a coarse stage callback for the queue's progress events.
    pub fn generate_with_progress(
        &self,
        book_id: i64,
        api: &Api,
        mut progress: impl FnMut(Stage),
    ) -> Result<SpineArtifact, ApiError> {
        let book = find_book(api, book_id)?;
        let prepared = self.prepare(book_id, &book)?;

        if let Some(artifact) = self.cache.read(&prepared.dir) {
            return Ok(artifact);
        }

        if !self.begin(book_id) {
            // The first call may have completed between the cache check and the
            // guard; prefer its result over an "in progress" error.
            if let Some(artifact) = self.cache.read(&prepared.dir) {
                return Ok(artifact);
            }
            return Err(api_error(
                "spine_in_progress",
                "A spine for this book is already being generated.",
            ));
        }
        let _guard = InFlight {
            service: self,
            book_id,
        };

        let engine = self.engine()?;
        let staged = self.cache.staged_dir(&prepared.key);
        self.cache.discard(&staged);

        engine
            .generate_with_progress(&prepared.input, &staged, &mut progress)
            .map_err(|error| {
                eprintln!("pocketlibrary spine {book_id}: {error:#}");
                self.cache.discard(&staged);
                api_error(
                    "spine_failed",
                    "The spine could not be generated for this book. Please try again.",
                )
            })?;

        // The cache keeps only runtime files. Working copies are not needed by
        // any renderer and would otherwise count against the LRU budget.
        for working in ["source.jpg", "mask.png"] {
            let _ = fs::remove_file(staged.join(working));
        }

        let artifact = match artifact_from_dir(&staged, book_id).and_then(|mut artifact| {
            artifact.pages_approximate = prepared.pages_approximate;
            self.cache
                .write(&staged, &artifact)
                .map_err(|error| cache_error(error.to_string()))?;
            Ok(artifact)
        }) {
            Ok(artifact) => artifact,
            Err(error) => {
                self.cache.discard(&staged);
                return Err(error);
            }
        };
        self.cache
            .install(&staged, &prepared.key)
            .map_err(|error| cache_error(error.to_string()))?;
        self.cache.trim(Some(&prepared.dir));
        Ok(artifact)
    }

    /// Drop a deleted book's cache entries. The artifact records the book id,
    /// so this still works after the cover file has gone.
    pub fn remove_cache(&self, book_id: i64) {
        self.cache.remove_book(book_id);
    }

    /// True when this book already has a complete cache entry.
    pub fn is_cached(&self, book_id: i64, api: &Api) -> bool {
        let Ok(book) = find_book(api, book_id) else {
            return false;
        };
        let Ok(prepared) = self.prepare(book_id, &book) else {
            return false;
        };
        self.cache.read::<SpineArtifact>(&prepared.dir).is_some()
    }

    /// Resolve the bundled models once. Never builds an ONNX session.
    pub fn models_ready(&self) -> bool {
        let mut slot = match self.models.lock() {
            Ok(slot) => slot,
            Err(_) => return false,
        };
        if slot.is_none() {
            *slot = Some(spine_assets::ensure_models(&self.app_data_dir));
        }
        matches!(slot.as_ref(), Some(Ok(_)))
    }

    /// Read a cached artifact without running inference. Call from a blocking
    /// thread because hashing the cover touches disk.
    pub fn artifact(&self, book_id: i64, api: &Api) -> Result<Option<SpineArtifact>, ApiError> {
        let book = find_book(api, book_id)?;
        // No cover means no job and no cache entry; the UI paints its
        // typographic plate instead of showing an error.
        let Ok(prepared) = self.prepare(book_id, &book) else {
            return Ok(None);
        };
        Ok(self.cache.read(&prepared.dir))
    }

    /// Project every complete cache entry into a shelf strip. This is the
    /// launch fast path: it scans `spine/books/*/artifact.json` directly, so it
    /// never runs inference and never hashes a cover. Corrupt entries, and
    /// entries whose strip cannot be decoded, are skipped.
    ///
    /// A book can own more than one key (a changed cover keeps the old entry
    /// until the trim); the most recently written artifact wins.
    pub fn cached_strips(&self) -> Vec<SpineCachedStrip> {
        let Ok(entries) = fs::read_dir(self.cache.books_dir()) else {
            return Vec::new();
        };
        let mut latest: BTreeMap<i64, (SystemTime, SpineCachedStrip)> = BTreeMap::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                // Hidden staging directories are not complete entries.
                continue;
            }
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let Some(artifact) = self.cache.read::<SpineArtifact>(&path) else {
                continue;
            };
            let Some(spine_data_url) = projected_strip(&path, &artifact) else {
                eprintln!(
                    "pocketlibrary spine cache: cannot project strip in {}",
                    path.display()
                );
                continue;
            };
            let modified = fs::metadata(path.join(ARTIFACT_FILE))
                .and_then(|meta| meta.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let strip = SpineCachedStrip {
                book_id: artifact.book_id,
                verdict: artifact.verdict,
                spine_data_url,
            };
            match latest.get(&strip.book_id) {
                Some((seen, _)) if *seen > modified => {}
                _ => {
                    latest.insert(strip.book_id, (modified, strip));
                }
            }
        }
        latest.into_values().map(|(_, strip)| strip).collect()
    }

    /// Resolve the model bundle once and report it. Never builds the engine.
    pub fn status(&self) -> SpineStatus {
        let mut slot = match self.models.lock() {
            Ok(slot) => slot,
            Err(_) => {
                return SpineStatus {
                    models: "error",
                    bundle_id: BUNDLE_ID,
                    bytes: 0,
                    error: Some("The spine model state could not be read.".to_owned()),
                };
            }
        };
        if slot.is_none() {
            *slot = Some(spine_assets::ensure_models(&self.app_data_dir));
        }
        match slot.as_ref() {
            Some(Ok(paths)) => SpineStatus {
                models: READY_STATE,
                bundle_id: BUNDLE_ID,
                bytes: bundle_bytes(paths),
                error: None,
            },
            Some(Err(error)) => {
                // The raw filesystem/JNI detail stays in `spine.log`; the
                // WebView only receives a short, user-safe reason.
                spine_assets::log(
                    &self.app_data_dir,
                    &format!("status: models unavailable: {error}"),
                );
                SpineStatus {
                    models: classify_model_error(error),
                    bundle_id: BUNDLE_ID,
                    bytes: 0,
                    error: Some(user_safe_model_error(error).to_owned()),
                }
            }
            None => SpineStatus {
                models: "error",
                bundle_id: BUNDLE_ID,
                bytes: 0,
                error: Some("The spine model state could not be resolved.".to_owned()),
            },
        }
    }

    fn prepare(&self, book_id: i64, book: &Book) -> Result<Prepared, ApiError> {
        let cover = require_cover(book_id, book.cover_path.as_deref().map(Path::new))?;
        let (pages, pages_approximate) = pages_of(book);
        let cover_bytes = fs::read(&cover).map_err(|error| {
            eprintln!(
                "pocketlibrary spine {book_id}: read cover {}: {error}",
                cover.display()
            );
            api_error(
                "cover_unreadable",
                "This book's cover could not be read, so no spine could be built.",
            )
        })?;
        let cover_hash = sha256_hex(&cover_bytes);
        let key = cache_key(&book.content_hash, &cover_hash, pages, BUNDLE_ID);
        let dir = self.cache.entry_dir(&key);

        Ok(Prepared {
            input: BookInput {
                cover,
                title: book.title.clone(),
                author: author_line(&book.authors),
                pages,
            },
            key,
            dir,
            pages_approximate,
        })
    }

    fn begin(&self, book_id: i64) -> bool {
        match self.in_flight.lock() {
            Ok(mut set) => set.insert(book_id),
            Err(_) => false,
        }
    }

    fn finish(&self, book_id: i64) {
        if let Ok(mut set) = self.in_flight.lock() {
            set.remove(&book_id);
        }
    }

    fn model_paths(&self) -> Result<SpineModelPaths, ApiError> {
        let mut slot = self
            .models
            .lock()
            .map_err(|_| api_error("spine_models", "The spine model state could not be read."))?;
        if slot.is_none() {
            *slot = Some(spine_assets::ensure_models(&self.app_data_dir));
        }
        match slot.as_ref() {
            Some(Ok(paths)) => Ok(paths.clone()),
            Some(Err(error)) => {
                eprintln!("pocketlibrary spine: models unavailable: {error}");
                Err(api_error(
                    "spine_models_missing",
                    "The spine engine is not ready yet. Its models are missing.",
                ))
            }
            None => Err(api_error(
                "spine_models_missing",
                "The spine engine is not ready yet. Its models are missing.",
            )),
        }
    }

    fn engine(&self) -> Result<Arc<Engine>, ApiError> {
        let mut slot = self
            .engine
            .lock()
            .map_err(|_| api_error("spine_engine", "The spine engine could not be started."))?;
        if let Some(engine) = slot.as_ref() {
            return Ok(Arc::clone(engine));
        }
        let paths = self.model_paths()?;
        let engine = Engine::new(Models {
            det: paths.det,
            rec: paths.rec,
            keys: paths.keys,
            migan: Some(paths.migan),
        })
        .map_err(|error| {
            eprintln!("pocketlibrary spine: engine failed to load: {error:#}");
            api_error(
                "spine_engine",
                "The spine engine could not be started. Its models may be damaged.",
            )
        })?;
        let engine = Arc::new(engine);
        *slot = Some(Arc::clone(&engine));
        Ok(engine)
    }
}

struct Prepared {
    input: BookInput,
    key: String,
    dir: PathBuf,
    pages_approximate: bool,
}

struct InFlight<'a> {
    service: &'a SpineService,
    book_id: i64,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.service.finish(self.book_id);
    }
}

/// The cache key from the spec: content hash, cover bytes, page count, bundle.
/// The definition lives in `pocketlibrary_core::spine_cache`; this stays for
/// callers and tests that use the shell-side name.
pub fn cache_key(content_hash: &str, cover_hash: &str, pages: u32, bundle_id: &str) -> String {
    spine_cache_key(content_hash, cover_hash, pages, bundle_id)
}

/// A real positive page count, or a clamped estimate with a flag for the
/// artifact. EPUBs are reflowable and commonly have no page count.
fn pages_of(book: &Book) -> (u32, bool) {
    match book.page_count {
        Some(pages) if pages > 0 => (pages.clamp(1, i64::from(u32::MAX)) as u32, false),
        _ => (ESTIMATED_PAGES, true),
    }
}

fn author_line(authors: &[String]) -> String {
    authors.join(", ")
}

fn find_book(api: &Api, book_id: i64) -> Result<Book, ApiError> {
    api.book(book_id)
}

/// A clear, UI-facing error when a book has no cover file to work from.
fn require_cover(book_id: i64, cover_path: Option<&Path>) -> Result<PathBuf, ApiError> {
    let path = cover_path.ok_or_else(|| missing_cover(book_id))?;
    if !path.is_file() {
        return Err(missing_cover(book_id));
    }
    Ok(path.to_path_buf())
}

fn missing_cover(book_id: i64) -> ApiError {
    eprintln!("pocketlibrary spine {book_id}: no cover file");
    api_error(
        "cover_missing",
        "This book has no cover to build a spine from. Add a cover first.",
    )
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// Build the wire artifact from the seven engine files in `dir`.
pub fn artifact_from_dir(dir: &Path, book_id: i64) -> Result<SpineArtifact, ApiError> {
    let run = read_json(&dir.join("run.json"))?;
    let qa = read_json(&dir.join("qa.json"))?;

    let route = run
        .pointer("/final/route")
        .and_then(Value::as_str)
        .unwrap_or("fallback");
    let verdict = run
        .pointer("/final/verdict")
        .and_then(Value::as_str)
        .unwrap_or("fallback");
    let mask_percent = run
        .pointer("/mask/coverage_pct")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let crop_box = run
        .pointer("/final/crop_box_work")
        .and_then(Value::as_array)
        .and_then(|values| {
            if values.len() < 4 {
                return None;
            }
            Some(CropBox {
                x: values[0].as_u64()? as u32,
                y: values[1].as_u64()? as u32,
                width: values[2].as_u64()? as u32,
                height: values[3].as_u64()? as u32,
            })
        });

    Ok(SpineArtifact {
        book_id,
        route: route_wire(route).to_owned(),
        verdict: verdict_wire(verdict).to_owned(),
        mask_percent,
        crop_box,
        art_data_url: jpeg_data_url(&dir.join("art.jpg"))?,
        spine_data_url: spine_data_url(&dir.join("spine-2x.jpg"))?,
        fallback_data_url: jpeg_data_url(&dir.join("fallback-spine.jpg"))?,
        pages_approximate: false,
        run_json: run,
        qa_json: qa,
    })
}

fn read_json(path: &Path) -> Result<Value, ApiError> {
    let text = fs::read_to_string(path)
        .map_err(|error| cache_error(format!("read {}: {error}", path.display())))?;
    serde_json::from_str(&text)
        .map_err(|error| cache_error(format!("parse {}: {error}", path.display())))
}

fn route_wire(route: &str) -> &'static str {
    match route {
        "text-free crop" | "crop" => "crop",
        "inpaint" => "inpaint",
        _ => "fallback",
    }
}

fn verdict_wire(verdict: &str) -> &'static str {
    match verdict {
        "pass" => "pass",
        "review" => "review",
        _ => "fallback",
    }
}

fn jpeg_data_url(path: &Path) -> Result<String, ApiError> {
    let bytes =
        fs::read(path).map_err(|error| cache_error(format!("read {}: {error}", path.display())))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// `spine-2x.jpg` is 104 x 472; the contract wants a 52 x 236 data URL.
fn spine_data_url(path: &Path) -> Result<String, ApiError> {
    let image = image::open(path)
        .map_err(|error| cache_error(format!("decode {}: {error}", path.display())))?
        .to_rgb8();
    encode_spine_strip(&image)
}

/// A complete entry that has lost `spine-2x.jpg` can still be projected from
/// the strip already stored in its artifact.
fn spine_data_url_from_artifact(data_url: &str) -> Result<String, ApiError> {
    let encoded = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .unwrap_or(data_url);
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| cache_error(format!("decode cached spine: {error}")))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| cache_error(format!("read cached spine image: {error}")))?
        .to_rgb8();
    encode_spine_strip(&image)
}

/// The shelf contract is one 52 x 236 JPEG, whichever file it came from.
fn encode_spine_strip(image: &image::RgbImage) -> Result<String, ApiError> {
    let spine = image::imageops::resize(image, SPINE_W, SPINE_H, FilterType::Nearest);
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92);
    encoder
        .encode_image(&spine)
        .map_err(|error| cache_error(format!("encode spine: {error}")))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// Prefer the runtime file; fall back to the strip stored in the artifact.
fn projected_strip(dir: &Path, artifact: &SpineArtifact) -> Option<String> {
    spine_data_url(&dir.join("spine-2x.jpg"))
        .or_else(|_| spine_data_url_from_artifact(&artifact.spine_data_url))
        .ok()
}

fn bundle_bytes(paths: &SpineModelPaths) -> u64 {
    [&paths.det, &paths.rec, &paths.keys, &paths.migan]
        .into_iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum()
}

#[cfg(target_os = "android")]
const READY_STATE: &str = "bundled";
#[cfg(not(target_os = "android"))]
const READY_STATE: &str = "ready";

fn classify_model_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("missing") || lower.contains("not found") || lower.contains("does not exist")
    {
        "missing"
    } else {
        "error"
    }
}

/// Short, user-safe reason for a model failure.
///
/// The raw detail (filesystem paths, hashes, JNI messages) is written to
/// `spine/spine.log`; it must never reach the WebView.
fn user_safe_model_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("missing") || lower.contains("not found") || lower.contains("does not exist")
    {
        "models missing"
    } else if lower.contains("size mismatch")
        || lower.contains("sha256 mismatch")
        || lower.contains("incomplete")
        || lower.contains("download")
    {
        "download incomplete"
    } else {
        "models could not be loaded"
    }
}

fn api_error(code: &'static str, message: impl Into<String>) -> ApiError {
    ApiError {
        code,
        message: message.into(),
    }
}

fn cache_error(detail: String) -> ApiError {
    eprintln!("pocketlibrary spine cache: {detail}");
    api_error(
        "spine_cache",
        "The spine cache could not be updated. Please try again.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(dir: &Path) {
        fs::create_dir_all(dir).expect("create fixture");
        let art = image::RgbImage::from_pixel(300, 200, image::Rgb([120, 80, 40]));
        let spine =
            image::RgbImage::from_pixel(SPINE_W * 2, SPINE_H * 2, image::Rgb([120, 80, 40]));
        let fallback = image::RgbImage::from_pixel(SPINE_W, SPINE_H, image::Rgb([40, 60, 120]));
        pocketlibrary_spine::save_jpg(&dir.join("art.jpg"), &art, 92).expect("art");
        pocketlibrary_spine::save_jpg(&dir.join("spine-2x.jpg"), &spine, 92).expect("spine");
        pocketlibrary_spine::save_jpg(&dir.join("fallback-spine.jpg"), &fallback, 92)
            .expect("fallback");
        let run = serde_json::json!({
            "route": "text-free crop",
            "final": {
                "route": "text-free crop",
                "verdict": "pass",
                "crop_box_work": [11, 22, 33, 44]
            },
            "mask": { "coverage_pct": 12.5 }
        });
        let qa =
            serde_json::json!({ "decision": { "route": "text-free crop", "verdict": "pass" } });
        fs::write(
            dir.join("run.json"),
            serde_json::to_string_pretty(&run).expect("run json"),
        )
        .expect("write run");
        fs::write(
            dir.join("qa.json"),
            serde_json::to_string_pretty(&qa).expect("qa json"),
        )
        .expect("write qa");
    }

    #[test]
    fn cache_key_is_stable_and_sensitive_to_each_part() {
        let base = cache_key("content", "cover", 240, BUNDLE_ID);
        assert_eq!(base, cache_key("content", "cover", 240, BUNDLE_ID));
        assert_eq!(base.len(), 64);
        assert!(base.chars().all(|c| c.is_ascii_hexdigit()));

        assert_ne!(base, cache_key("other", "cover", 240, BUNDLE_ID));
        assert_ne!(base, cache_key("content", "other", 240, BUNDLE_ID));
        assert_ne!(base, cache_key("content", "cover", 241, BUNDLE_ID));
        assert_ne!(base, cache_key("content", "cover", 240, "spine-v2"));
    }

    #[test]
    fn artifact_round_trips_through_a_fixture_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        fixture(temp.path());

        let artifact = artifact_from_dir(temp.path(), 7).expect("artifact");
        assert_eq!(artifact.book_id, 7);
        assert_eq!(artifact.route, "crop");
        assert_eq!(artifact.verdict, "pass");
        assert_eq!(artifact.mask_percent, 12.5);
        assert_eq!(
            artifact.crop_box,
            Some(CropBox {
                x: 11,
                y: 22,
                width: 33,
                height: 44
            })
        );
        assert!(artifact.art_data_url.starts_with("data:image/jpeg;base64,"));
        assert!(
            artifact
                .fallback_data_url
                .starts_with("data:image/jpeg;base64,")
        );

        let spine_bytes = STANDARD
            .decode(
                artifact
                    .spine_data_url
                    .strip_prefix("data:image/jpeg;base64,")
                    .expect("data url prefix"),
            )
            .expect("base64 spine");
        let spine = image::load_from_memory(&spine_bytes).expect("decode spine");
        assert_eq!((spine.width(), spine.height()), (SPINE_W, SPINE_H));

        let cache = SpineCache::with_limit(
            temp.path(),
            pocketlibrary_core::spine_cache::CACHE_LIMIT_BYTES,
        );
        cache.write(temp.path(), &artifact).expect("write artifact");
        let read_back: SpineArtifact = cache.read(temp.path()).expect("read artifact");
        assert_eq!(artifact, read_back);

        // JSON persists the camelCase wire names the frontend expects.
        let text = fs::read_to_string(
            temp.path()
                .join(pocketlibrary_core::spine_cache::ARTIFACT_FILE),
        )
        .expect("read text");
        assert!(text.contains("\"bookId\""));
        assert!(text.contains("\"artDataUrl\""));
        assert!(text.contains("\"runJson\""));
    }

    #[test]
    fn unknown_page_counts_use_a_clamped_estimate() {
        let mut book = Book {
            id: 1,
            content_hash: "hash".to_owned(),
            quick_key: None,
            path: "book.epub".to_owned(),
            format: pocketlibrary_core::BookFormat::Epub,
            title: "A Book".to_owned(),
            authors: Vec::new(),
            series: None,
            language: None,
            description: None,
            publisher: None,
            published_date: None,
            identifier: None,
            page_count: None,
            spine_style: pocketlibrary_core::SpineStyle::Wrap,
            cover_path: None,
            cover_source: None,
            file_cover_path: None,
            file_cover_source: None,
            file_description: None,
            added_at: 0,
            shelf_id: None,
            slot_index: None,
            reading_status: pocketlibrary_core::ReadingStatus::Unread,
            labels: Vec::new(),
        };
        assert_eq!(pages_of(&book), (ESTIMATED_PAGES, true));
        book.page_count = Some(0);
        assert_eq!(pages_of(&book), (ESTIMATED_PAGES, true));
        book.page_count = Some(412);
        assert_eq!(pages_of(&book), (412, false));
    }

    #[test]
    fn missing_cover_is_a_clear_error() {
        let error = require_cover(3, None).expect_err("no cover path");
        assert_eq!(error.code, "cover_missing");
        assert!(error.message.contains("no cover"));

        let temp = tempfile::tempdir().expect("tempdir");
        let absent = temp.path().join("gone.jpg");
        let error = require_cover(3, Some(&absent)).expect_err("cover file absent");
        assert_eq!(error.code, "cover_missing");
    }

    fn set_modified(path: &Path, secs: u64) {
        let modified = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(secs);
        fs::File::options()
            .write(true)
            .open(path)
            .expect("open for mtime")
            .set_modified(modified)
            .expect("set mtime");
    }

    /// Write a complete cache entry: runtime files in a staging dir, then the
    /// artifact and its strip in the entry directory the cache scan reads.
    fn write_cached_entry(cache: &SpineCache, key: &str, book_id: i64, verdict: &str) -> PathBuf {
        let staged = cache.staged_dir(key);
        fixture(&staged);
        let mut artifact = artifact_from_dir(&staged, book_id).expect("artifact");
        artifact.verdict = verdict.to_owned();
        let dir = cache.entry_dir(key);
        cache.write(&dir, &artifact).expect("write artifact");
        fs::copy(staged.join("spine-2x.jpg"), dir.join("spine-2x.jpg")).expect("copy spine");
        dir
    }

    fn decode_spine(strip: &SpineCachedStrip) -> image::RgbImage {
        let bytes = STANDARD
            .decode(
                strip
                    .spine_data_url
                    .strip_prefix("data:image/jpeg;base64,")
                    .expect("data url prefix"),
            )
            .expect("base64 strip");
        image::load_from_memory(&bytes)
            .expect("decode strip")
            .to_rgb8()
    }

    #[test]
    fn cached_strips_project_complete_entries_and_skip_corrupt_ones() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = SpineCache::new(temp.path());
        write_cached_entry(&cache, "pass", 1, "pass");
        write_cached_entry(&cache, "review", 2, "review");
        write_cached_entry(&cache, "fallback", 3, "fallback");

        let corrupt = cache.entry_dir("corrupt");
        fs::create_dir_all(&corrupt).expect("corrupt dir");
        fs::write(corrupt.join(ARTIFACT_FILE), "{ not json").expect("corrupt artifact");

        // A complete artifact whose strip is neither on disk nor a valid URL
        // cannot be projected and must not reach the wall.
        let unprojectable = cache.entry_dir("unprojectable");
        let mut artifact = cache
            .read::<SpineArtifact>(&cache.entry_dir("pass"))
            .expect("read pass artifact");
        artifact.book_id = 9;
        artifact.spine_data_url = "not a data url".to_owned();
        cache
            .write(&unprojectable, &artifact)
            .expect("write unprojectable");

        // A lost `spine-2x.jpg` still projects from the stored artifact.
        let repaired = write_cached_entry(&cache, "repaired", 4, "pass");
        fs::remove_file(repaired.join("spine-2x.jpg")).expect("drop strip file");

        let service = SpineService::new(temp.path().to_path_buf());
        let strips = service.cached_strips();
        let ids: Vec<i64> = strips.iter().map(|strip| strip.book_id).collect();
        assert_eq!(ids, vec![1, 2, 3, 4], "corrupt and unprojectable dropped");

        assert_eq!(strips[0].verdict, "pass");
        assert_eq!(strips[1].verdict, "review");
        assert_eq!(strips[2].verdict, "fallback");
        for strip in &strips {
            let spine = decode_spine(strip);
            assert_eq!((spine.width(), spine.height()), (SPINE_W, SPINE_H));
        }
    }

    #[test]
    fn cached_strips_dedupe_by_book_and_prefer_the_latest_artifact() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = SpineCache::new(temp.path());
        let older = write_cached_entry(&cache, "older", 5, "pass");
        let newer = write_cached_entry(&cache, "newer", 5, "review");
        set_modified(&older.join(ARTIFACT_FILE), 10);
        set_modified(&newer.join(ARTIFACT_FILE), 20);

        let service = SpineService::new(temp.path().to_path_buf());
        let strips = service.cached_strips();
        assert_eq!(strips.len(), 1, "one strip per book id");
        assert_eq!(strips[0].book_id, 5);
        assert_eq!(strips[0].verdict, "review", "latest artifact wins");
    }

    #[test]
    fn cached_strips_are_empty_without_a_cache_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        let service = SpineService::new(temp.path().to_path_buf());
        assert!(service.cached_strips().is_empty());
    }

    #[test]
    fn model_errors_are_short_and_user_safe() {
        // Raw paths and hashes never cross the wire.
        assert_eq!(
            user_safe_model_error(
                "missing /data/app/spine/models/spine-v1/migan.onnx: No such file"
            ),
            "models missing"
        );
        assert_eq!(
            user_safe_model_error("/data/spine/migan.onnx sha256 mismatch: expected aa, got bb"),
            "download incomplete"
        );
        assert_eq!(
            user_safe_model_error("JNI JavaVM::from_raw: jni error"),
            "models could not be loaded"
        );

        // The `models` enum keeps its existing classification.
        assert_eq!(
            classify_model_error("missing /data/app/spine/models/migan.onnx"),
            "missing"
        );
        assert_eq!(
            classify_model_error("JNI JavaVM::from_raw: jni error"),
            "error"
        );
    }
}
