//! The library file-source abstraction.
//!
//! Scan rules live here, over a deliberately small seam: a source can list one
//! directory at a time, hands back an opaque `handle` for each child, and can
//! read the bytes behind a file handle. A fake directory backs host tests; the
//! SAF adapter in `src-tauri` supplies content-URI handles. Nothing above this
//! module knows whether the entries come from a real folder, a tree picker or a
//! test fixture.

use std::path::Path;

use crate::error::{Error, Result};
use crate::identity::QUICK_SPAN;
use crate::models::BookFormat;

/// What a directory listing entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    File,
    Directory,
}

/// One immediate child of a directory in a library source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceEntry {
    /// File or directory name, without any parent path.
    pub name: String,
    /// Logical path relative to the library root, `/`-separated.
    pub path: String,
    pub kind: SourceKind,
    /// Source-specific handle: a directory handle to list, or a file handle to
    /// read. Never shown to the UI.
    pub handle: String,
}

/// The bytes needed to build a cheap identity check without reading a whole
/// file: its complete length plus the head and tail spans.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickBytes {
    pub length: u64,
    pub head: Vec<u8>,
    pub tail: Vec<u8>,
}

impl QuickBytes {
    /// Read the head and tail from a seekable file.
    pub fn read_from(file: &mut std::fs::File) -> Result<Self> {
        use std::io::{Read, Seek, SeekFrom};

        let length = file.metadata()?.len();
        let span = QUICK_SPAN as u64;
        let mut head = Vec::new();
        if length <= span * 2 {
            file.read_to_end(&mut head)?;
            return Ok(Self {
                length,
                head,
                tail: Vec::new(),
            });
        }

        head.resize(QUICK_SPAN, 0);
        file.read_exact(&mut head)?;
        let mut tail = vec![0u8; QUICK_SPAN];
        file.seek(SeekFrom::Start(length - span))?;
        file.read_exact(&mut tail)?;
        Ok(Self { length, head, tail })
    }
}

/// A directory tree that the scanner can walk and read.
pub trait FileSource {
    /// List the immediate children of `dir_handle`, or of the library root when
    /// it is `None`.
    fn list(&self, dir_handle: Option<&str>) -> Result<Vec<SourceEntry>>;

    /// Read the bytes needed for a quick key, without reading the whole file.
    fn read_quick(&self, handle: &str) -> Result<QuickBytes>;

    /// Read a file identified by a [`SourceEntry::handle`].
    fn read_file(&self, handle: &str) -> Result<Vec<u8>>;
}

/// A book file discovered by a scan, before it is written to the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScannedBook {
    pub name: String,
    pub path: String,
    pub handle: String,
    pub format: BookFormat,
}

/// Names that start with a dot are hidden on both Unix and Android.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Recognise EPUB and PDF by extension, case-insensitively.
fn format_for(name: &str) -> Option<BookFormat> {
    match Path::new(name)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "epub" => Some(BookFormat::Epub),
        "pdf" => Some(BookFormat::Pdf),
        _ => None,
    }
}

/// Walk the whole library recursively and return every EPUB/PDF file.
///
/// Hidden files and directories, and files with any other extension, are
/// skipped. Results are sorted by relative path so shelf placement is stable
/// across scans.
///
/// Any failure to list a directory (including one below the root) aborts the
/// whole scan and is reported as `library_unavailable`. Returning a partial tree
/// would make the caller treat unlisted books as removed.
pub(crate) fn collect_books(source: &dyn FileSource) -> Result<Vec<ScannedBook>> {
    let root = source
        .list(None)
        .map_err(|error| Error::SourceUnavailable {
            message: format!("could not list the library root: {error}"),
        })?;

    let mut books = Vec::new();
    walk(source, root, &mut books, 0)?;
    books.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(books)
}

fn walk(
    source: &dyn FileSource,
    entries: Vec<SourceEntry>,
    books: &mut Vec<ScannedBook>,
    depth: usize,
) -> Result<()> {
    // A damaged or hostile tree must not make the scan run forever.
    if depth > 64 {
        return Err(Error::SourceUnavailable {
            message: "the library tree is nested more than 64 levels deep".to_owned(),
        });
    }

    for entry in entries {
        if is_hidden(&entry.name) {
            continue;
        }

        match entry.kind {
            SourceKind::Directory => {
                let children =
                    source
                        .list(Some(&entry.handle))
                        .map_err(|error| Error::SourceUnavailable {
                            message: format!("could not list {}: {error}", entry.path),
                        })?;
                walk(source, children, books, depth + 1)?;
            }
            SourceKind::File => {
                if let Some(format) = format_for(&entry.name) {
                    books.push(ScannedBook {
                        name: entry.name,
                        path: entry.path,
                        handle: entry.handle,
                        format,
                    });
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_names_and_other_extensions_are_ignored() {
        assert!(is_hidden(".stfolder"));
        assert!(!is_hidden("books"));
        assert_eq!(format_for("Novel.EPUB"), Some(BookFormat::Epub));
        assert_eq!(format_for("paper.pdf"), Some(BookFormat::Pdf));
        assert_eq!(format_for("notes.txt"), None);
    }
}
