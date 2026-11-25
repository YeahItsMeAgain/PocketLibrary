//! SAF-backed library source for Android.
//!
//! All folder-picking, grant persistence and tree walking stays in this shell
//! adapter; the scan rules themselves live in `pocketlibrary_core`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use pocketlibrary_core::{
    DownloadSink, Error, FileSource, QuickBytes, Result, SourceEntry, SourceKind,
};
use tauri_plugin_android_fs::{Entry, FsUri};

/// Lists a SAF tree one directory at a time.
pub struct SafSource<'a, R: tauri::Runtime> {
    fs: &'a tauri_plugin_android_fs::api::api_sync::AndroidFs<R>,
    root: FsUri,
    /// Document URI -> logical path relative to the root, for display/storage.
    paths: Mutex<HashMap<String, String>>,
}

impl<'a, R: tauri::Runtime> SafSource<'a, R> {
    pub fn new(fs: &'a tauri_plugin_android_fs::api::api_sync::AndroidFs<R>, root: FsUri) -> Self {
        let mut paths = HashMap::new();
        paths.insert(root.uri.clone(), String::new());
        Self {
            fs,
            root,
            paths: Mutex::new(paths),
        }
    }

    fn uri_for(&self, handle: Option<&str>) -> FsUri {
        match handle {
            None => self.root.clone(),
            Some(uri) => FsUri {
                uri: uri.to_owned(),
                document_top_tree_uri: self.root.document_top_tree_uri.clone(),
            },
        }
    }

    /// Find a logical library path by walking the SAF tree.
    ///
    /// The catalog stores library-relative paths. SAF only exposes content-URI
    /// handles, so the shell resolves the path here and hands the bytes back to
    /// the reader; neither the path nor the URI crosses the command wire.
    fn find_handle(&self, target: &str) -> Result<Option<String>> {
        fn walk(
            source: &SafSource<'_, impl tauri::Runtime>,
            dir: Option<&str>,
            target: &str,
        ) -> Result<Option<String>> {
            for entry in source.list(dir)? {
                if entry.kind == SourceKind::File && entry.path == target {
                    return Ok(Some(entry.handle));
                }
                if entry.kind == SourceKind::Directory
                    && let Some(handle) = walk(source, Some(&entry.handle), target)?
                {
                    return Ok(Some(handle));
                }
            }
            Ok(None)
        }

        walk(self, None, target)
    }

    /// Read a whole book, refusing anything above `limit` bytes.
    ///
    /// The reader receives the entire file over IPC, so a very large PDF would
    /// be copied twice (Rust buffer and WebView) before PDF.js sees it. Stop at
    /// `limit + 1` while reading instead of letting the allocation grow until
    /// the device runs out of memory; `None` means "too large".
    pub fn read_path_limited(&self, target: &str, limit: u64) -> Result<Option<Vec<u8>>> {
        let Some(handle) = self.find_handle(target)? else {
            return Err(Error::SourceUnavailable {
                message: format!("book path not found: {target}"),
            });
        };
        let uri = self.uri_for(Some(&handle));
        let file = self
            .fs
            .open_file_readable(&uri)
            .map_err(|error| Error::SourceUnavailable {
                message: error.to_string(),
            })?;
        let mut bytes = Vec::new();
        file.take(limit.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|error| Error::SourceUnavailable {
                message: error.to_string(),
            })?;
        Ok((bytes.len() as u64 <= limit).then_some(bytes))
    }
}

impl<R: tauri::Runtime> FileSource for SafSource<'_, R> {
    fn list(&self, dir_handle: Option<&str>) -> Result<Vec<SourceEntry>> {
        let uri = self.uri_for(dir_handle);
        let parent = self
            .paths
            .lock()
            .ok()
            .and_then(|paths| paths.get(&uri.uri).cloned())
            .unwrap_or_default();

        let entries = self
            .fs
            .read_dir(&uri)
            .map_err(|error| Error::SourceUnavailable {
                message: error.to_string(),
            })?;

        let mut out = Vec::with_capacity(entries.len());
        for entry in entries {
            let name = entry.name().to_owned();
            let path = if parent.is_empty() {
                name.clone()
            } else {
                format!("{parent}/{name}")
            };

            match entry {
                Entry::File { uri, .. } => out.push(SourceEntry {
                    name,
                    path,
                    kind: SourceKind::File,
                    handle: uri.uri,
                }),
                Entry::Dir { uri, .. } => {
                    if let Ok(mut paths) = self.paths.lock() {
                        paths.insert(uri.uri.clone(), path.clone());
                    }
                    out.push(SourceEntry {
                        name,
                        path,
                        kind: SourceKind::Directory,
                        handle: uri.uri,
                    });
                }
            }
        }
        Ok(out)
    }

    fn read_quick(&self, handle: &str) -> Result<QuickBytes> {
        let uri = self.uri_for(Some(handle));
        let mut file =
            self.fs
                .open_file_readable(&uri)
                .map_err(|error| Error::SourceUnavailable {
                    message: error.to_string(),
                })?;
        QuickBytes::read_from(&mut file).map_err(|error| Error::SourceUnavailable {
            message: error.to_string(),
        })
    }

    fn read_file(&self, handle: &str) -> Result<Vec<u8>> {
        let uri = self.uri_for(Some(handle));
        let mut file =
            self.fs
                .open_file_readable(&uri)
                .map_err(|error| Error::SourceUnavailable {
                    message: error.to_string(),
                })?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| Error::SourceUnavailable {
                message: error.to_string(),
            })?;
        Ok(bytes)
    }
}


/// Writes validated downloads into the granted library folder root.
///
/// The bytes are first written to a sibling `.part` document and then renamed,
/// so a failure never exposes a half-written book. Providers that refuse the
/// rename still never expose the partial file under the book's name.
pub struct SafDownloadSink<'a, R: tauri::Runtime> {
    fs: &'a tauri_plugin_android_fs::api::api_sync::AndroidFs<R>,
    root: FsUri,
}

impl<'a, R: tauri::Runtime> SafDownloadSink<'a, R> {
    pub fn new(
        fs: &'a tauri_plugin_android_fs::api::api_sync::AndroidFs<R>,
        root: FsUri,
    ) -> Self {
        Self { fs, root }
    }
}

impl<R: tauri::Runtime> DownloadSink for SafDownloadSink<'_, R> {
    fn list_root(&self) -> Result<Vec<String>> {
        let entries = self
            .fs
            .read_dir(&self.root)
            .map_err(|error| Error::SourceUnavailable {
                message: error.to_string(),
            })?;
        Ok(entries
            .into_iter()
            .map(|entry| entry.name().to_owned())
            .collect())
    }

    fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mime = if name.to_ascii_lowercase().ends_with(".pdf") {
            "application/pdf"
        } else {
            "application/epub+zip"
        };
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let temp_name = format!(".pocketlibrary-{stamp}.part");
        let temp = self
            .fs
            .create_new_file(&self.root, &temp_name, Some(mime))
            .map_err(|error| Error::DownloadDisk {
                message: error.to_string(),
            })?;
        let write = || -> std::io::Result<()> {
            let mut file = self.fs.open_file_writable(&temp).map_err(|error| {
                std::io::Error::other(error.to_string())
            })?;
            file.write_all(bytes)?;
            file.flush()?;
            Ok(())
        };
        if let Err(error) = write() {
            let _ = self.fs.remove_file(&temp);
            return Err(Error::DownloadDisk {
                message: error.to_string(),
            });
        }
        if let Err(error) = self.fs.rename(&temp, name) {
            let _ = self.fs.remove_file(&temp);
            return Err(Error::DownloadDisk {
                message: error.to_string(),
            });
        }
        Ok(())
    }
}
