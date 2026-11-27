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

use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use pocketlibrary_core::spine_cache::{CACHE_LIMIT_BYTES, trim_cache};
use pocketlibrary_core::{Api, ApiError, Book};
use pocketlibrary_spine::{BookInput, Engine, Models, SPINE_H, SPINE_W, Stage};

use crate::spine_assets::{self, SpineModelPaths};

/// Model bundle version. Part of the cache key and the status payload.
pub const BUNDLE_ID: &str = "spine-v1";
/// Cache file written last; its presence means a complete entry.
const ARTIFACT_FILE: &str = "artifact.json";
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
    models: Mutex<Option<Result<SpineModelPaths, String>>>,
    engine: Mutex<Option<Arc<Engine>>>,
    in_flight: Mutex<HashSet<i64>>,
}

impl SpineService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            app_data_dir,
            models: Mutex::new(None),
            engine: Mutex::new(None),
            in_flight: Mutex::new(HashSet::new()),
        }
    }

    fn books_dir(&self) -> PathBuf {
        self.app_data_dir.join("spine").join("books")
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

        if let Some(artifact) = read_cached(&prepared.dir) {
            return Ok(artifact);
        }

        if !self.begin(book_id) {
            // The first call may have completed between the cache check and the
            // guard; prefer its result over an "in progress" error.
            if let Some(artifact) = read_cached(&prepared.dir) {
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
        let staged = self.books_dir().join(format!(
            ".{}.tmp-{}",
            key_name(&prepared.dir),
            std::process::id()
        ));
        if staged.exists() {
            fs::remove_dir_all(&staged).map_err(|error| {
                cache_error(format!(
                    "clear stale spine cache {}: {error}",
                    staged.display()
                ))
            })?;
        }

        engine
            .generate_with_progress(&prepared.input, &staged, &mut progress)
            .map_err(|error| {
                eprintln!("pocketlibrary spine {book_id}: {error:#}");
                let _ = fs::remove_dir_all(&staged);
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
            write_artifact(&staged, &artifact).map(|_| artifact)
        }) {
            Ok(artifact) => artifact,
            Err(error) => {
                let _ = fs::remove_dir_all(&staged);
                return Err(error);
            }
        };
        install_dir(&staged, &prepared.dir)?;
        trim_cache(&self.books_dir(), CACHE_LIMIT_BYTES, Some(&prepared.dir));
        Ok(artifact)
    }

    /// Drop a deleted book's cache entries. The artifact records the book id,
    /// so this still works after the cover file has gone.
    pub fn remove_cache(&self, book_id: i64) {
        let Ok(entries) = fs::read_dir(self.books_dir()) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let belongs = read_cached(&path).is_some_and(|artifact| artifact.book_id == book_id);
            if !belongs {
                continue;
            }
            if let Err(error) = fs::remove_dir_all(&path) {
                eprintln!(
                    "pocketlibrary spine: remove cache {}: {error}",
                    path.display()
                );
            }
        }
    }

    /// True when this book already has a complete cache entry.
    pub fn is_cached(&self, book_id: i64, api: &Api) -> bool {
        let Ok(book) = find_book(api, book_id) else {
            return false;
        };
        let Ok(prepared) = self.prepare(book_id, &book) else {
            return false;
        };
        read_cached(&prepared.dir).is_some()
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
        Ok(read_cached(&prepared.dir))
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
            Some(Err(error)) => SpineStatus {
                models: classify_model_error(error),
                bundle_id: BUNDLE_ID,
                bytes: 0,
                error: Some(error.clone()),
            },
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
        let dir = self.books_dir().join(&key);

        Ok(Prepared {
            input: BookInput {
                cover,
                title: book.title.clone(),
                author: author_line(&book.authors),
                pages,
            },
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
pub fn cache_key(content_hash: &str, cover_hash: &str, pages: u32, bundle_id: &str) -> String {
    sha256_hex(format!("{content_hash}\n{cover_hash}\n{pages}\n{bundle_id}").as_bytes())
}

fn key_name(dir: &Path) -> String {
    dir.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("book")
        .to_owned()
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
    api.list_books()?
        .into_iter()
        .find(|book| book.id == book_id)
        .ok_or_else(|| api_error("book_not_found", "That book is not in the library."))
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

fn read_cached(dir: &Path) -> Option<SpineArtifact> {
    let text = fs::read_to_string(dir.join(ARTIFACT_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_artifact(dir: &Path, artifact: &SpineArtifact) -> Result<(), ApiError> {
    let text = serde_json::to_string_pretty(artifact)
        .map_err(|error| cache_error(format!("serialise spine artifact: {error}")))?;
    fs::write(dir.join(ARTIFACT_FILE), text)
        .map_err(|error| cache_error(format!("write {}: {error}", ARTIFACT_FILE)))
}

/// Install a fully written entry in one rename.
fn install_dir(staged: &Path, target: &Path) -> Result<(), ApiError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| cache_error(format!("create {}: {error}", parent.display())))?;
    }
    if target.exists() {
        fs::remove_dir_all(target)
            .map_err(|error| cache_error(format!("replace {}: {error}", target.display())))?;
    }
    fs::rename(staged, target).map_err(|error| {
        let _ = fs::remove_dir_all(staged);
        cache_error(format!("install {}: {error}", target.display()))
    })
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
    let spine = image::imageops::resize(&image, SPINE_W, SPINE_H, FilterType::Nearest);
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92);
    encoder
        .encode_image(&spine)
        .map_err(|error| cache_error(format!("encode spine: {error}")))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
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

        write_artifact(temp.path(), &artifact).expect("write artifact");
        let read_back = read_cached(temp.path()).expect("read artifact");
        assert_eq!(artifact, read_back);

        // JSON persists the camelCase wire names the frontend expects.
        let text = fs::read_to_string(temp.path().join(ARTIFACT_FILE)).expect("read text");
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
}
