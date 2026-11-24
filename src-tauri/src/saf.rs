//! SAF-backed library source for Android.
//!
//! All folder-picking, grant persistence and tree walking stays in this shell
//! adapter; the scan rules themselves live in `pocketlibrary_core`.

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;

use pocketlibrary_core::{Error, FileSource, QuickBytes, Result, SourceEntry, SourceKind};
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

    /// Find a logical library path by walking the SAF tree, then read its bytes.
    ///
    /// The catalog stores library-relative paths. SAF only exposes content-URI
    /// handles, so the shell resolves the path here and hands the bytes back to
    /// the reader; neither the path nor the URI crosses the command wire.
    pub fn read_path(&self, target: &str) -> Result<Vec<u8>> {
        fn walk(source: &SafSource<'_, impl tauri::Runtime>, dir: Option<&str>, target: &str) -> Result<Option<String>> {
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

        match walk(self, None, target)? {
            Some(handle) => self.read_file(&handle),
            None => Err(Error::SourceUnavailable {
                message: format!("book path not found: {target}"),
            }),
        }
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
