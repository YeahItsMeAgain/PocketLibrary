//! On-disk spine cache: keys, entries, installs, removal and the LRU budget.
//!
//! The app keeps generated entries under `<app data>/spine/books/<cache-key>/`.
//! This module is the one owner of that layout so the cache contract (key
//! stability, last-writer-wins install, artifact round-trip and 200 MB LRU) can
//! be tested on a headless host. The Tauri shell only owns inference and the
//! JSON data URLs it puts in the artifact.
//!
//! An entry is complete when its `artifact.json` parses. The artifact is
//! written last, and a complete entry is promoted into place with one rename.
//! After each completed job the whole cache is trimmed by least-recently-used
//! mtime so it never grows past the contract's 200 MB. The entry being served
//! is always retained.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// Total bytes allowed across all cached books.
pub const CACHE_LIMIT_BYTES: u64 = 200 * 1024 * 1024;

/// Cache file written last; its presence means a complete entry.
pub const ARTIFACT_FILE: &str = "artifact.json";

/// The cache key from the spec: content hash, cover bytes, page count, bundle.
pub fn cache_key(content_hash: &str, cover_hash: &str, pages: u32, bundle_id: &str) -> String {
    sha256_hex(format!("{content_hash}\n{cover_hash}\n{pages}\n{bundle_id}").as_bytes())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// A cache operation failed in a way the caller should surface.
#[derive(Debug)]
pub enum CacheError {
    Io {
        context: String,
        source: std::io::Error,
    },
    Json {
        context: String,
        source: serde_json::Error,
    },
}

impl fmt::Display for CacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io { context, source } => write!(formatter, "{context}: {source}"),
            Self::Json { context, source } => write!(formatter, "{context}: {source}"),
        }
    }
}

impl std::error::Error for CacheError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            Self::Json { source, .. } => Some(source),
        }
    }
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> CacheError {
    CacheError::Io {
        context: context.into(),
        source,
    }
}

fn json_error(context: impl Into<String>, source: serde_json::Error) -> CacheError {
    CacheError::Json {
        context: context.into(),
        source,
    }
}

/// Handle to `<app data>/spine/books`.
#[derive(Clone, Debug)]
pub struct SpineCache {
    books_dir: PathBuf,
    limit: u64,
}

impl SpineCache {
    /// The production layout: `<app data>/spine/books` and the 200 MB budget.
    pub fn new(app_data_dir: &Path) -> Self {
        Self::with_limit(app_data_dir.join("spine").join("books"), CACHE_LIMIT_BYTES)
    }

    /// A cache rooted anywhere, with an explicit budget. Host tests use this.
    pub fn with_limit(books_dir: impl Into<PathBuf>, limit: u64) -> Self {
        Self {
            books_dir: books_dir.into(),
            limit,
        }
    }

    pub fn books_dir(&self) -> &Path {
        &self.books_dir
    }

    pub fn limit(&self) -> u64 {
        self.limit
    }

    /// The final directory for a cache key.
    pub fn entry_dir(&self, key: &str) -> PathBuf {
        self.books_dir.join(key)
    }

    /// A hidden, process-scoped scratch directory next to the final entry.
    /// The engine writes here; `install` promotes it with one rename.
    pub fn staged_dir(&self, key: &str) -> PathBuf {
        self.books_dir
            .join(format!(".{key}.tmp-{}", std::process::id()))
    }

    /// Read a complete artifact. A missing or corrupt file is no entry.
    pub fn read<T: DeserializeOwned>(&self, dir: &Path) -> Option<T> {
        let text = fs::read_to_string(dir.join(ARTIFACT_FILE)).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Write the artifact into `dir`. Generation writes it into a staged
    /// directory before `install`, so a reader never sees a partial entry.
    pub fn write<T: Serialize>(&self, dir: &Path, artifact: &T) -> Result<(), CacheError> {
        let text = serde_json::to_string_pretty(artifact)
            .map_err(|error| json_error("serialise spine artifact", error))?;
        fs::create_dir_all(dir)
            .map_err(|error| io_error(format!("create {}", dir.display()), error))?;
        fs::write(dir.join(ARTIFACT_FILE), text).map_err(|error| {
            io_error(
                format!("write {}", dir.join(ARTIFACT_FILE).display()),
                error,
            )
        })
    }

    /// Remove a staged directory after a failed job. Missing is fine.
    pub fn discard(&self, staged: &Path) {
        let _ = fs::remove_dir_all(staged);
    }

    /// Install a fully written entry in one rename, replacing any previous
    /// entry for the same key.
    pub fn install(&self, staged: &Path, key: &str) -> Result<PathBuf, CacheError> {
        let target = self.entry_dir(key);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| io_error(format!("create {}", parent.display()), error))?;
        }
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|error| io_error(format!("replace {}", target.display()), error))?;
        }
        if let Err(error) = fs::rename(staged, &target) {
            self.discard(staged);
            return Err(io_error(format!("install {}", target.display()), error));
        }
        Ok(target)
    }

    /// Drop every entry whose artifact records `book_id`. This still works
    /// after the cover file has gone because the artifact keeps the id.
    /// Corrupt entries cannot be attributed and are left for the trim.
    pub fn remove_book(&self, book_id: i64) {
        let Ok(entries) = fs::read_dir(&self.books_dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let belongs = self
                .read::<serde_json::Value>(&path)
                .is_some_and(|artifact| {
                    artifact.get("bookId").and_then(serde_json::Value::as_i64) == Some(book_id)
                });
            if !belongs {
                continue;
            }
            if let Err(error) = fs::remove_dir_all(&path) {
                eprintln!(
                    "pocketlibrary spine cache: remove {}: {error}",
                    path.display()
                );
            }
        }
    }

    /// Keep the cache under its budget, evicting the oldest entries first.
    /// `keep` is always retained, even when it is the oldest entry.
    pub fn trim(&self, keep: Option<&Path>) {
        trim_cache(&self.books_dir, self.limit, keep);
    }
}

/// Keep `books_dir` under `limit` bytes, evicting the oldest directories first.
/// `keep` is always retained, even when it is the oldest entry.
pub fn trim_cache(books_dir: &Path, limit: u64, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(books_dir) else {
        return;
    };
    let mut cache_dirs = Vec::new();
    let mut total = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) || name.starts_with('.') {
            continue;
        }
        let (bytes, modified) = dir_usage_and_mtime(&path);
        total = total.saturating_add(bytes);
        cache_dirs.push((path, bytes, modified));
    }
    if total <= limit {
        return;
    }

    cache_dirs.sort_by_key(|(_, _, modified)| *modified);
    for (path, bytes, _) in cache_dirs {
        if total <= limit {
            break;
        }
        if keep.is_some_and(|keep| keep == path.as_path()) {
            continue;
        }
        if fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(bytes);
        }
    }
}

fn dir_usage_and_mtime(dir: &Path) -> (u64, SystemTime) {
    let mut bytes = 0u64;
    let mut newest: Option<SystemTime> = None;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    bytes = bytes.saturating_add(meta.len());
                }
                if let Ok(modified) = meta.modified()
                    && newest.is_none_or(|newest| modified > newest)
                {
                    newest = Some(modified);
                }
            }
        }
    }
    // A cache entry is as recent as its newest runtime file. The directory
    // mtime is only a fallback for an entry that somehow has no files.
    let newest = newest.unwrap_or_else(|| {
        fs::metadata(dir)
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    (bytes, newest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::path::PathBuf;

    #[derive(Debug, Deserialize, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FakeArtifact {
        book_id: i64,
        art_data_url: String,
    }

    fn cache_dir(root: &Path, name: &str, bytes: usize, modified_secs: u64) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).expect("cache dir");
        let file = dir.join("art.jpg");
        fs::write(&file, vec![0u8; bytes]).expect("cache file");
        let modified = std::time::UNIX_EPOCH + std::time::Duration::from_secs(modified_secs);
        fs::File::options()
            .write(true)
            .open(&file)
            .expect("open cache file")
            .set_modified(modified)
            .expect("set mtime");
        dir
    }

    #[test]
    fn cache_key_is_stable_and_sensitive_to_each_part() {
        let base = cache_key("content", "cover", 240, "spine-v1");
        assert_eq!(base, cache_key("content", "cover", 240, "spine-v1"));
        assert_eq!(base.len(), 64);
        assert!(base.chars().all(|c| c.is_ascii_hexdigit()));

        assert_ne!(base, cache_key("other", "cover", 240, "spine-v1"));
        assert_ne!(base, cache_key("content", "other", 240, "spine-v1"));
        assert_ne!(base, cache_key("content", "cover", 241, "spine-v1"));
        assert_ne!(base, cache_key("content", "cover", 240, "spine-v2"));
    }

    #[test]
    fn artifacts_install_round_trip_and_remove_by_book() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = SpineCache::new(temp.path());
        let key = cache_key("content", "cover", 240, "spine-v1");
        let staged = cache.staged_dir(&key);
        let artifact = FakeArtifact {
            book_id: 7,
            art_data_url: "data:image/jpeg;base64,AA==".to_owned(),
        };
        cache.write(&staged, &artifact).expect("write artifact");

        let dir = cache.install(&staged, &key).expect("install");
        assert_eq!(dir, cache.entry_dir(&key));
        assert!(!staged.exists(), "staging moves in one rename");
        assert_eq!(cache.read::<FakeArtifact>(&dir), Some(artifact));

        // A second book lives alongside the first.
        let other_key = cache_key("other", "cover", 240, "spine-v1");
        let other_staged = cache.staged_dir(&other_key);
        cache
            .write(
                &other_staged,
                &FakeArtifact {
                    book_id: 8,
                    art_data_url: "data:image/jpeg;base64,BB==".to_owned(),
                },
            )
            .expect("write other");
        cache
            .install(&other_staged, &other_key)
            .expect("install other");

        cache.remove_book(7);
        assert!(!dir.exists(), "the matching book entry is removed");
        assert!(cache.entry_dir(&other_key).exists(), "other books survive");
        assert_eq!(cache.read::<FakeArtifact>(&dir), None);
    }

    #[test]
    fn install_replaces_an_existing_entry() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = SpineCache::with_limit(temp.path(), CACHE_LIMIT_BYTES);
        let key = "entry";
        let first = cache.staged_dir(key);
        cache
            .write(
                &first,
                &FakeArtifact {
                    book_id: 1,
                    art_data_url: "old".to_owned(),
                },
            )
            .expect("write first");
        let dir = cache.install(&first, key).expect("install first");

        let second = cache.staged_dir(key);
        cache
            .write(
                &second,
                &FakeArtifact {
                    book_id: 1,
                    art_data_url: "new".to_owned(),
                },
            )
            .expect("write second");
        cache.install(&second, key).expect("replace");
        assert_eq!(
            cache.read::<FakeArtifact>(&dir),
            Some(FakeArtifact {
                book_id: 1,
                art_data_url: "new".to_owned()
            }),
            "last writer wins"
        );
    }

    #[test]
    fn corrupt_artifacts_are_absent_entries_and_are_not_removed_by_book() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = SpineCache::new(temp.path());
        let dir = cache.entry_dir("broken");
        fs::create_dir_all(&dir).expect("entry dir");
        fs::write(dir.join(ARTIFACT_FILE), "{ not json").expect("corrupt artifact");

        assert_eq!(cache.read::<FakeArtifact>(&dir), None);
        cache.remove_book(7);
        assert!(
            dir.exists(),
            "a corrupt entry has no owner and is left for the trim"
        );

        // A directory without an artifact is equally not an entry.
        let empty = cache.entry_dir("empty");
        fs::create_dir_all(&empty).expect("empty dir");
        assert_eq!(cache.read::<FakeArtifact>(&empty), None);
    }

    #[test]
    fn trim_evicts_oldest_and_respects_the_cap() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let old = cache_dir(root, "old", 4, 10);
        let middle = cache_dir(root, "middle", 4, 20);
        let new = cache_dir(root, "new", 4, 30);

        trim_cache(root, 8, None);
        assert!(!old.exists(), "the least-recently-used entry goes first");
        assert!(middle.exists());
        assert!(new.exists());

        // Recreate the old entry and protect it; the next-oldest is evicted.
        let old = cache_dir(root, "old", 4, 5);
        trim_cache(root, 8, Some(&old));
        assert!(old.exists(), "the book being served is never deleted");
        assert!(!middle.exists());
        assert!(new.exists());
    }

    #[test]
    fn trim_is_a_noop_under_the_cap() {
        let temp = tempfile::tempdir().expect("tempdir");
        let one = cache_dir(temp.path(), "one", 4, 10);
        trim_cache(temp.path(), 4, None);
        assert!(one.exists());
    }

    #[test]
    fn trim_skips_hidden_staging_directories() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let live = cache_dir(root, "live", 4, 10);
        let staged = cache_dir(root, ".in-progress.tmp-1", 40, 20);

        SpineCache::with_limit(root, 8).trim(None);
        assert!(live.exists(), "hidden staging is not charged to the budget");
        assert!(staged.exists());
    }
}
