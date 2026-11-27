//! Shelf projection of generated spine artifacts.
//!
//! Generation writes a complete entry into `<app data>/spine/books/<key>/`
//! (`spine_cache` owns that layout). This module turns each complete entry
//! back into the one 52 x 236 data URL the wall needs, reading the runtime
//! strip first and falling back to the copy stored in `artifact.json`.
//!
//! The scan is total: a corrupt artifact, a missing image or an unreadable
//! directory is counted and skipped, never allowed to hide the whole shelf.
//! It lives in core rather than the Tauri shell so the real
//! generation → cache → projection path can be exercised on a headless host.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::spine_cache::{ARTIFACT_FILE, SpineCache};

/// The shelf contract's strip size.
pub const STRIP_W: u32 = 52;
pub const STRIP_H: u32 = 236;

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
    #[serde(default)]
    pub art_data_url: String,
    /// `data:image/jpeg;base64,...`, exactly 52 x 236.
    ///
    /// Older artifacts may only carry the runtime files, so a missing value is
    /// tolerated and projected from `spine-2x.jpg` instead.
    #[serde(default)]
    pub spine_data_url: String,
    /// `data:image/jpeg;base64,...`
    #[serde(default)]
    pub fallback_data_url: String,
    /// True when the page count used for geometry was an estimate.
    #[serde(default)]
    pub pages_approximate: bool,
    #[serde(default)]
    pub run_json: Value,
    #[serde(default)]
    pub qa_json: Value,
}

/// Which verdicts are allowed on the shelf wall.
///
/// `review` still paints: the QA gate flagged it, but the strip is real art.
/// `fallback` is the typographic cloth plate produced when generation failed
/// the gate, so it must never be counted as a finished shelf strip.
pub fn shelf_eligible(verdict: &str) -> bool {
    matches!(verdict, "pass" | "review")
}

/// Stamp each book with the cached strip the shelf should paint.
///
/// This is the single merge used by the Tauri `list_books` command and by the
/// host test, so the list payload and the on-disk projection cannot drift. A
/// fallback verdict is not shelf art: the typographic Cloth spine stays, so
/// those books keep `None`.
pub fn apply_cached_strips(books: &mut [crate::Book], strips: &[SpineCachedStrip]) {
    let by_book: BTreeMap<i64, &str> = strips
        .iter()
        .filter(|strip| strip.is_shelf_eligible())
        .map(|strip| (strip.book_id, strip.spine_data_url.as_str()))
        .collect();
    for book in books {
        if let Some(url) = by_book.get(&book.id) {
            book.spine_data_url = Some((*url).to_owned());
        }
    }
}

/// One shelf-ready strip projected from a complete cache entry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpineCachedStrip {
    pub book_id: i64,
    /// "pass" | "review" | "fallback"
    pub verdict: String,
    /// `data:image/jpeg;base64,...`, exactly 52 x 236.
    pub spine_data_url: String,
}

impl SpineCachedStrip {
    /// True only when this strip is real art the wall may paint.
    pub fn is_shelf_eligible(&self) -> bool {
        shelf_eligible(&self.verdict) && !self.spine_data_url.is_empty()
    }
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

/// Counts and strips from one scan, so the shell can log exactly why a wall
/// ended up empty.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CachedStrips {
    pub strips: Vec<SpineCachedStrip>,
    pub scanned: usize,
    pub projected: usize,
    pub skipped: usize,
    pub root: PathBuf,
}

impl CachedStrips {
    /// The strips the wall can actually paint: a projected image and a verdict
    /// that is not the typographic fallback.
    pub fn shelf_strips(&self) -> impl Iterator<Item = &SpineCachedStrip> {
        self.strips.iter().filter(|strip| strip.is_shelf_eligible())
    }

    pub fn shelf_eligible_count(&self) -> usize {
        self.shelf_strips().count()
    }

    /// Entries that projected but are not shelf art because QA said fallback.
    pub fn fallback_count(&self) -> usize {
        self.strips
            .iter()
            .filter(|strip| strip.verdict == "fallback")
            .count()
    }
}

/// Project every complete entry under `books_dir` into one strip per book.
/// The most recently written artifact wins when a book owns several keys.
pub fn cached_strips(books_dir: &Path) -> CachedStrips {
    let mut out = CachedStrips {
        root: books_dir.to_path_buf(),
        ..CachedStrips::default()
    };
    let mut latest: BTreeMap<i64, (SystemTime, SpineCachedStrip)> = BTreeMap::new();

    let Ok(entries) = fs::read_dir(books_dir) else {
        return out;
    };
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
        out.scanned += 1;
        let Some(artifact) = read_artifact(&path) else {
            out.skipped += 1;
            continue;
        };
        if artifact.book_id <= 0 {
            out.skipped += 1;
            continue;
        }
        let Some(spine_data_url) = projected_strip(&path, &artifact) else {
            out.skipped += 1;
            continue;
        };
        out.projected += 1;
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

    out.strips = latest.into_values().map(|(_, strip)| strip).collect();
    out
}

/// The ids that own a readable artifact, whether or not it projects or passed
/// QA. Settings uses this for its "Artifact" column; it is *not* the launch
/// definition of done.
pub fn artifact_book_ids(books_dir: &Path) -> HashSet<i64> {
    let mut ids = HashSet::new();
    let Ok(entries) = fs::read_dir(books_dir) else {
        return ids;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        if let Some(artifact) = read_artifact(&path)
            && artifact.book_id > 0
        {
            ids.insert(artifact.book_id);
        }
    }
    ids
}

/// The single definition of "this book still needs a spine": it has no
/// shelf-eligible projected strip. An artifact that exists but cannot project,
/// or whose QA verdict is `fallback`, is unfinished work.
///
/// This decodes the cached strip, exactly like `list_books`, so the launch
/// repair can never disagree with what the wall was given.
pub fn shelf_book_ids(books_dir: &Path) -> HashSet<i64> {
    cached_strips(books_dir)
        .strips
        .iter()
        .filter(|strip| strip.is_shelf_eligible())
        .map(|strip| strip.book_id)
        .collect()
}

/// One entry's shelf strip, or `None` when the artifact is missing, unusable
/// or its verdict is not shelf art. Used by the worker before inference.
pub fn shelf_strip(dir: &Path) -> Option<String> {
    let artifact = read_artifact(dir)?;
    if artifact.book_id <= 0 || !shelf_eligible(&artifact.verdict) {
        return None;
    }
    projected_strip(dir, &artifact)
}

fn read_artifact(dir: &Path) -> Option<SpineArtifact> {
    let text = fs::read_to_string(dir.join(ARTIFACT_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Build the wire artifact from the engine's runtime files in `dir`.
pub fn artifact_from_dir(dir: &Path, book_id: i64) -> Result<SpineArtifact, String> {
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

fn read_json(path: &Path) -> Result<Value, String> {
    let text =
        fs::read_to_string(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("parse {}: {error}", path.display()))
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

fn jpeg_data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// `spine-2x.jpg` is 104 x 472; the contract wants a 52 x 236 data URL.
pub fn spine_data_url(path: &Path) -> Result<String, String> {
    let image = image::open(path)
        .map_err(|error| format!("decode {}: {error}", path.display()))?
        .to_rgb8();
    encode_spine_strip(&image)
}

/// A complete entry that has lost `spine-2x.jpg` can still be projected from
/// the strip already stored in its artifact.
fn spine_data_url_from_artifact(data_url: &str) -> Result<String, String> {
    let encoded = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .unwrap_or(data_url);
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("decode cached spine: {error}"))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|error| format!("read cached spine image: {error}"))?
        .to_rgb8();
    encode_spine_strip(&image)
}

/// The shelf contract is one 52 x 236 JPEG, whichever file it came from.
fn encode_spine_strip(image: &image::RgbImage) -> Result<String, String> {
    let spine = image::imageops::resize(image, STRIP_W, STRIP_H, FilterType::Nearest);
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92);
    encoder
        .encode_image(&spine)
        .map_err(|error| format!("encode spine: {error}"))?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

/// Prefer the runtime file; fall back to the strip stored in the artifact, then
/// to the text-free art. A complete artifact therefore still reaches the wall
/// when `spine-2x.jpg` was trimmed or lost.
fn projected_strip(dir: &Path, artifact: &SpineArtifact) -> Option<String> {
    spine_data_url(&dir.join("spine-2x.jpg"))
        .or_else(|_| spine_data_url_from_artifact(&artifact.spine_data_url))
        .or_else(|_| spine_data_url_from_artifact(&artifact.art_data_url))
        .ok()
}

/// Store an artifact exactly the way the shell does after generation: write it
/// into the staged directory, then promote that directory into place.
pub fn install_artifact(
    cache: &SpineCache,
    key: &str,
    staged: &Path,
    artifact: &SpineArtifact,
) -> Result<PathBuf, String> {
    cache
        .write(staged, artifact)
        .map_err(|error| format!("write artifact: {error}"))?;
    cache
        .install(staged, key)
        .map_err(|error| format!("install artifact: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fake_entry(root: &Path, key: &str, book_id: i64, strip: &[u8]) -> PathBuf {
        let dir = root.join(key);
        fs::create_dir_all(&dir).expect("entry dir");
        let image = image::RgbImage::from_pixel(STRIP_W * 2, STRIP_H * 2, image::Rgb([1, 2, 3]));
        image::save_buffer(
            dir.join("spine-2x.jpg"),
            image.as_raw(),
            image.width(),
            image.height(),
            image::ColorType::Rgb8,
        )
        .expect("spine file");
        let artifact = SpineArtifact {
            book_id,
            route: "crop".to_owned(),
            verdict: "pass".to_owned(),
            mask_percent: 1.0,
            crop_box: None,
            art_data_url: String::new(),
            spine_data_url: STANDARD.encode(strip),
            fallback_data_url: String::new(),
            pages_approximate: false,
            run_json: Value::Null,
            qa_json: Value::Null,
        };
        fs::write(
            dir.join(ARTIFACT_FILE),
            serde_json::to_string(&artifact).expect("artifact json"),
        )
        .expect("artifact");
        dir
    }

    #[test]
    fn projection_skips_corrupt_entries_and_keeps_the_rest() {
        let temp = tempfile::tempdir().expect("tempdir");
        fake_entry(temp.path(), "one", 1, b"x");
        let corrupt = temp.path().join("corrupt");
        fs::create_dir_all(&corrupt).expect("corrupt dir");
        fs::write(corrupt.join(ARTIFACT_FILE), "{ nope").expect("corrupt artifact");

        let report = cached_strips(temp.path());
        assert_eq!(report.scanned, 2);
        assert_eq!(report.projected, 1);
        assert_eq!(report.skipped, 1);
        assert_eq!(report.strips.len(), 1);
        assert_eq!(report.strips[0].book_id, 1);
    }

    #[test]
    fn a_missing_image_is_projected_from_the_artifact_copy() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = image::RgbImage::from_pixel(STRIP_W, STRIP_H, image::Rgb([9, 8, 7]));
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90)
            .encode_image(&source)
            .expect("encode cached strip");
        let dir = fake_entry(temp.path(), "one", 1, &jpeg);
        fs::remove_file(dir.join("spine-2x.jpg")).expect("drop runtime strip");

        let report = cached_strips(temp.path());
        assert_eq!(report.projected, 1);
        let data_url = &report.strips[0].spine_data_url;
        assert_eq!(&data_url[..23], "data:image/jpeg;base64,");
    }

    #[test]
    fn artifact_book_ids_ignore_corrupt_entries() {
        let temp = tempfile::tempdir().expect("tempdir");
        fake_entry(temp.path(), "one", 7, b"x");
        let corrupt = temp.path().join("corrupt");
        fs::create_dir_all(&corrupt).expect("corrupt dir");
        fs::write(corrupt.join(ARTIFACT_FILE), "not json").expect("corrupt");
        assert_eq!(artifact_book_ids(temp.path()), HashSet::from([7]));
    }

    #[test]
    fn a_fallback_artifact_is_present_but_not_a_shelf_strip() {
        let temp = tempfile::tempdir().expect("tempdir");
        let dir = fake_entry(temp.path(), "one", 7, b"x");
        let mut artifact = read_artifact(&dir).expect("artifact");
        artifact.verdict = "fallback".to_owned();
        fs::write(
            dir.join(ARTIFACT_FILE),
            serde_json::to_string(&artifact).expect("artifact json"),
        )
        .expect("rewrite artifact");

        let report = cached_strips(temp.path());
        assert_eq!(report.projected, 1, "the image still decodes");
        assert_eq!(report.fallback_count(), 1);
        assert_eq!(report.shelf_eligible_count(), 0);
        assert_eq!(artifact_book_ids(temp.path()), HashSet::from([7]));
        assert!(
            shelf_book_ids(temp.path()).is_empty(),
            "fallback is unfinished work, not a cache hit"
        );
        assert!(shelf_strip(&dir).is_none());
    }

    #[test]
    fn an_unprojectable_artifact_is_not_a_shelf_strip() {
        let temp = tempfile::tempdir().expect("tempdir");
        let dir = fake_entry(temp.path(), "one", 7, b"x");
        fs::remove_file(dir.join("spine-2x.jpg")).expect("drop runtime strip");
        let mut artifact = read_artifact(&dir).expect("artifact");
        artifact.spine_data_url = "not an image".to_owned();
        artifact.art_data_url = "not an image".to_owned();
        fs::write(
            dir.join(ARTIFACT_FILE),
            serde_json::to_string(&artifact).expect("artifact json"),
        )
        .expect("rewrite artifact");

        let report = cached_strips(temp.path());
        assert_eq!(report.projected, 0);
        assert_eq!(report.skipped, 1);
        assert_eq!(artifact_book_ids(temp.path()), HashSet::from([7]));
        assert!(
            shelf_book_ids(temp.path()).is_empty(),
            "an unusable artifact must be regenerated"
        );
        assert!(shelf_strip(&dir).is_none());
    }

    #[test]
    fn a_missing_runtime_strip_still_projects_from_art() {
        let temp = tempfile::tempdir().expect("tempdir");
        let dir = fake_entry(temp.path(), "one", 7, b"x");
        fs::remove_file(dir.join("spine-2x.jpg")).expect("drop runtime strip");
        let mut artifact = read_artifact(&dir).expect("artifact");
        artifact.spine_data_url = String::new();
        artifact.art_data_url = {
            let art = image::RgbImage::from_pixel(300, 450, image::Rgb([60, 30, 90]));
            let mut bytes = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 90)
                .encode_image(&art)
                .expect("encode art");
            format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        };
        fs::write(
            dir.join(ARTIFACT_FILE),
            serde_json::to_string(&artifact).expect("artifact json"),
        )
        .expect("rewrite artifact");

        assert!(shelf_strip(&dir).is_some());
        let report = cached_strips(temp.path());
        assert_eq!(report.projected, 1);
        assert_eq!(report.skipped, 0);
    }
}
