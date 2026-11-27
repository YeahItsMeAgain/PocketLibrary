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
#[cfg(test)]
use std::time::SystemTime;

#[cfg(test)]
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use sha2::{Digest, Sha256};

#[cfg(test)]
use pocketlibrary_core::spine_cache::ARTIFACT_FILE;
use pocketlibrary_core::spine_cache::SpineCache;
use pocketlibrary_core::spine_cache::cache_key as spine_cache_key;
use pocketlibrary_core::spine_strip;
use pocketlibrary_core::{Api, ApiError, Book};
use pocketlibrary_spine::{BookInput, Engine, Models, Stage};
#[cfg(test)]
use pocketlibrary_spine::{SPINE_H, SPINE_W};

use crate::spine_assets::{self, SpineModelPaths};

/// Model bundle version. Part of the cache key and the status payload.
pub const BUNDLE_ID: &str = "spine-v1";
/// Page estimate used when a book has no reliable page count.
const ESTIMATED_PAGES: u32 = 320;

// The wire shape lives in core with the projection that produces it, so the
// real generation → cache → strip path is host-testable. Re-exported here for
// the command signatures and the shell's tests.
#[cfg(test)]
pub use pocketlibrary_core::spine_strip::CropBox;
pub use pocketlibrary_core::spine_strip::{SpineArtifact, SpineCachedStrip};

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
    /// Every call writes one summary line to `spine/spine.log` so an empty
    /// wall can be explained from a diagnostics export.
    pub fn cached_strips(&self) -> Vec<SpineCachedStrip> {
        self.cached_strips_report().strips
    }

    /// The same projection, plus the root that was scanned and the projection
    /// counts. `list_books` uses this once per shelf load to stamp strips into
    /// the book payload and to log exactly what the wall was given.
    pub fn cached_strips_report(&self) -> spine_strip::CachedStrips {
        let report = spine_strip::cached_strips(self.cache.books_dir());
        let root_state = if report.root.is_dir() {
            "present"
        } else {
            "missing"
        };
        spine_assets::log(
            &self.app_data_dir,
            &format!(
                "hydrate: scanned {}, projected {}, skipped {}, root {} ({root_state})",
                report.scanned,
                report.projected,
                report.skipped,
                report.root.display()
            ),
        );
        report
    }

    /// The app-data root the cache and the spine log live under.
    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    /// The ids that already own a complete artifact. This reads artifacts only
    /// (no image decode, no cover hashing) and is the cheap repair check the
    /// launch queue uses to decide which books still need a spine.
    pub fn cached_book_ids(&self) -> HashSet<i64> {
        spine_strip::cached_book_ids(self.cache.books_dir())
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
    spine_strip::artifact_from_dir(dir, book_id).map_err(cache_error)
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
    use base64::Engine as _;

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
            spine_data_url: None,
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

    /// A real EPUB on disk, exposed through the same `FileSource` seam the
    /// scanner uses on Android. One file at the root is enough for the scan.
    struct HostSource {
        root: PathBuf,
        name: String,
    }

    impl pocketlibrary_core::FileSource for HostSource {
        fn list(
            &self,
            dir_handle: Option<&str>,
        ) -> pocketlibrary_core::Result<Vec<pocketlibrary_core::SourceEntry>> {
            if dir_handle.is_some() {
                return Ok(Vec::new());
            }
            Ok(vec![pocketlibrary_core::SourceEntry {
                name: self.name.clone(),
                path: self.name.clone(),
                kind: pocketlibrary_core::SourceKind::File,
                handle: self.name.clone(),
            }])
        }

        fn read_quick(
            &self,
            handle: &str,
        ) -> pocketlibrary_core::Result<pocketlibrary_core::QuickBytes> {
            let mut file = fs::File::open(self.root.join(handle))?;
            pocketlibrary_core::QuickBytes::read_from(&mut file)
        }

        fn read_file(&self, handle: &str) -> pocketlibrary_core::Result<Vec<u8>> {
            Ok(fs::read(self.root.join(handle))?)
        }
    }

    fn host_models() -> Option<(PathBuf, PathBuf)> {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .to_path_buf();
        let models = repo.join(".scratch/spine-cover-art-prototype/v8-app/models");
        let migan =
            repo.join(".scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx");
        (models.join("det.onnx").is_file()
            && models.join("rec.onnx").is_file()
            && models.join("keys.txt").is_file()
            && migan.is_file())
        .then_some((models, migan))
    }

    fn set_host_models(models: &Path, migan: &Path) {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            // The service resolves models from the environment once per
            // process; this test is the only writer in this binary.
            unsafe {
                std::env::set_var("SPINE_MODELS_DIR", models);
                std::env::set_var("SPINE_MIGAN", migan);
            }
            if std::env::var_os("ORT_DYLIB_PATH").is_none() {
                let candidates = [
                    "/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0",
                    "/tmp/opencode/ortlib/libonnxruntime.so",
                    "/usr/lib/libonnxruntime.so",
                ];
                if let Some(found) = candidates.iter().find(|path| Path::new(path).is_file()) {
                    unsafe { std::env::set_var("ORT_DYLIB_PATH", found) };
                }
            }
        });
    }

    /// The real path: generate a spine from a scanned book into the temp app
    /// data dir, then project that same directory through `cached_strips()`.
    /// A fixture that writes `spine-2x.jpg` by hand would not catch a cache
    /// root, serialization or strip-size mismatch.
    #[test]
    fn a_real_generation_projects_a_52x236_strip_from_the_app_data_root() {
        let Some((models, migan)) = host_models() else {
            eprintln!("spine models missing; skipping real generation test");
            return;
        };
        set_host_models(&models, &migan);

        let temp = tempfile::tempdir().expect("tempdir");
        let app_data = temp.path().join("app-data");
        fs::create_dir_all(&app_data).expect("app data dir");
        let api = Api::open(app_data.join("library.db")).expect("open catalog");

        let library = temp.path().join("library");
        fs::create_dir_all(&library).expect("library dir");
        let sample = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("test-assets/sample.epub");
        fs::copy(&sample, library.join("sample.epub")).expect("copy sample");
        let source = HostSource {
            root: library,
            name: "sample.epub".to_owned(),
        };
        api.scan(&source).expect("scan sample");
        let book = api.list_books().expect("list books").remove(0);
        assert!(
            book.cover_path
                .as_deref()
                .is_some_and(|path| Path::new(path).is_file()),
            "the scan must produce a cover for generation"
        );

        let service = SpineService::new(app_data.clone());
        let artifact = service.generate(book.id, &api).expect("generate spine");
        assert_eq!(artifact.book_id, book.id);
        assert_eq!(&artifact.spine_data_url[..23], "data:image/jpeg;base64,");

        // A fresh service (the next launch) scans the same app-data root.
        let relaunched = SpineService::new(app_data.clone());
        let strips = relaunched.cached_strips();
        let strip = strips
            .iter()
            .find(|strip| strip.book_id == book.id)
            .expect("the generated book projects from the cache root");
        assert_eq!(strip.verdict, artifact.verdict);

        let bytes = STANDARD
            .decode(
                strip
                    .spine_data_url
                    .strip_prefix("data:image/jpeg;base64,")
                    .expect("data url prefix"),
            )
            .expect("base64 strip");
        let image = image::load_from_memory(&bytes)
            .expect("decode strip")
            .to_rgb8();
        assert_eq!((image.width(), image.height()), (SPINE_W, SPINE_H));

        // The shelf payload carries that strip with the book, so the wall does
        // not have to wait for a hydration map or an event round-trip.
        let mut merged = crate::shelf_books(&api, &relaunched).expect("shelf books");
        let merged_book = merged
            .drain(..)
            .find(|candidate| candidate.id == book.id)
            .expect("the book is still in the catalogue");
        let shelf_url = merged_book
            .spine_data_url
            .as_deref()
            .expect("the list payload carries the cached strip");
        assert!(shelf_url.starts_with("data:image/jpeg;base64,"));
        assert_eq!(
            merged_book.spine_style,
            pocketlibrary_core::SpineStyle::Wrap,
            "a book with no stored style defaults to Wrap"
        );

        let shelf_bytes = STANDARD
            .decode(
                shelf_url
                    .strip_prefix("data:image/jpeg;base64,")
                    .expect("data url prefix"),
            )
            .expect("base64 shelf strip");
        let shelf_image = image::load_from_memory(&shelf_bytes)
            .expect("decode shelf strip")
            .to_rgb8();
        assert_eq!(
            (shelf_image.width(), shelf_image.height()),
            (SPINE_W, SPINE_H)
        );

        // The diagnostic summary names the root and the counts the wall got.
        let log = fs::read_to_string(app_data.join("spine").join("spine.log"))
            .expect("hydration summary log");
        assert!(log.contains("hydrate: scanned 1, projected 1, skipped 0"));
        assert!(log.contains("shelf: books 1, strips 1"));
        assert!(log.contains(&format!("root {}", app_data.join("spine/books").display())));
        assert!(log.contains("present true"));
    }
}
