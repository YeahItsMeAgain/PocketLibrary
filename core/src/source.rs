//! The library file-source abstraction.
//!
//! Scan rules live here, over a deliberately small seam: a source can list one
//! directory at a time and hands back an opaque `handle` for each child
//! directory. A fake directory backs host tests; the SAF adapter in `src-tauri`
//! supplies content-URI handles. Nothing above this module knows whether the
//! entries come from a real folder, a tree picker or a test fixture.

use std::path::Path;

use crate::error::{Error, Result};
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
    /// Source-specific handle used to list a directory; ignored for files.
    pub handle: String,
}

/// A directory tree that the scanner can walk.
pub trait FileSource {
    /// List the immediate children of `dir_handle`, or of the library root when
    /// it is `None`.
    fn list(&self, dir_handle: Option<&str>) -> Result<Vec<SourceEntry>>;
}

/// A book file discovered by a scan, before it is written to the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScannedBook {
    pub path: String,
    pub title: String,
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

/// The title placeholder used until metadata parsing lands: the filename stem.
fn title_for(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name);
    let trimmed = stem.trim();
    if trimmed.is_empty() {
        name.to_owned()
    } else {
        trimmed.to_owned()
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
                        path: entry.path,
                        title: title_for(&entry.name),
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
        assert_eq!(title_for("A Book.epub"), "A Book");
    }
}
