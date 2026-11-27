//! On-disk spine cache budget.
//!
//! The app keeps generated entries under `<app data>/spine/books/<cache-key>/`.
//! After each completed job the whole cache is trimmed by least-recently-used
//! mtime so it never grows past the contract's 200 MB. The entry being served
//! is always retained.

use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// Total bytes allowed across all cached books.
pub const CACHE_LIMIT_BYTES: u64 = 200 * 1024 * 1024;

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
    use std::path::PathBuf;

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
}
