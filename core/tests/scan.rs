use std::collections::HashMap;

use pocketlibrary_core::{
    Api, BookFormat, Error, FileSource, ReadingStatus, Result, SourceEntry, SourceKind,
};
use tempfile::TempDir;

/// A small in-memory directory tree that stands in for SAF in host tests.
#[derive(Default)]
struct FakeDir {
    dirs: HashMap<String, Vec<SourceEntry>>,
    root_missing: bool,
}

impl FakeDir {
    fn new() -> Self {
        let mut dirs = HashMap::new();
        dirs.insert(String::new(), Vec::new());
        Self {
            dirs,
            root_missing: false,
        }
    }

    fn file(mut self, path: &str) -> Self {
        let (parent, name) = split(path);
        self.dirs
            .entry(parent.to_owned())
            .or_default()
            .push(SourceEntry {
                name: name.to_owned(),
                path: path.to_owned(),
                kind: SourceKind::File,
                handle: String::new(),
                len: 1_024,
                modified: Some(1_700_000_000),
            });
        self
    }

    fn dir(mut self, path: &str) -> Self {
        let (parent, name) = split(path);
        self.dirs
            .entry(parent.to_owned())
            .or_default()
            .push(SourceEntry {
                name: name.to_owned(),
                path: path.to_owned(),
                kind: SourceKind::Directory,
                handle: path.to_owned(),
                len: 0,
                modified: Some(1_700_000_000),
            });
        self.dirs.entry(path.to_owned()).or_default();
        self
    }

    fn missing() -> Self {
        Self {
            dirs: HashMap::new(),
            root_missing: true,
        }
    }
}

impl FileSource for FakeDir {
    fn list(&self, dir_handle: Option<&str>) -> Result<Vec<SourceEntry>> {
        let key = dir_handle.unwrap_or("");
        if self.root_missing {
            return Err(Error::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "folder is gone",
            )));
        }
        self.dirs
            .get(key)
            .cloned()
            .ok_or_else(|| Error::Io(std::io::Error::from(std::io::ErrorKind::NotFound)))
    }
}

fn split(path: &str) -> (&str, &str) {
    match path.rsplit_once('/') {
        Some((parent, name)) => (parent, name),
        None => ("", path),
    }
}

fn database() -> (TempDir, Api) {
    let dir = TempDir::new().expect("temporary directory");
    let api = Api::open(dir.path().join("library.db")).expect("open catalog");
    (dir, api)
}

#[test]
fn an_empty_folder_keeps_the_grant_and_shows_no_books() {
    let (_dir, api) = database();

    let report = api.scan(&FakeDir::new()).expect("scan empty folder");

    assert_eq!(report.total, 0);
    assert_eq!(report.added, 0);
    assert_eq!(report.removed, 0);
    assert!(api.list_books().expect("list books").is_empty());
    assert_eq!(api.list_shelves().expect("list shelves").len(), 1);
}

#[test]
fn a_nested_folder_finds_epub_and_pdf_and_ignores_hidden_and_other_files() {
    let (_dir, api) = database();
    let source = FakeDir::new()
        .file("sample.epub")
        .file("notes.txt")
        .file(".hidden.epub")
        .dir("Sub")
        .file("Sub/deep.pdf")
        .file("Sub/Novel.EPUB")
        .file("Sub/cover.jpg")
        .dir(".trash")
        .file(".trash/secret.pdf");

    let report = api.scan(&source).expect("scan nested folder");
    let books = api.list_books().expect("list books");

    assert_eq!(report.total, 3);
    assert_eq!(report.added, 3);
    assert_eq!(
        books
            .iter()
            .map(|book| (book.title.as_str(), book.format))
            .collect::<Vec<_>>(),
        vec![
            ("Novel", BookFormat::Epub),
            ("deep", BookFormat::Pdf),
            ("sample", BookFormat::Epub),
        ]
    );

    let shelves = api.list_shelves().expect("list shelves");
    assert_eq!(shelves.len(), 1);
    assert_eq!(
        books.iter().map(|book| book.slot_index).collect::<Vec<_>>(),
        vec![Some(0), Some(1), Some(2)]
    );
    assert!(
        books
            .iter()
            .all(|book| book.reading_status == ReadingStatus::Unread),
        "a fresh scan leaves books unread"
    );
}

#[test]
fn a_new_file_on_rescan_is_added_and_placed() {
    let (_dir, api) = database();

    api.scan(&FakeDir::new().file("first.epub"))
        .expect("first scan");

    let report = api
        .scan(&FakeDir::new().file("first.epub").file("second.pdf"))
        .expect("second scan");
    let books = api.list_books().expect("list books");

    assert_eq!(report.total, 2);
    assert_eq!(report.added, 1);
    assert_eq!(report.removed, 0);
    assert_eq!(books.len(), 2);
    assert_eq!(books[1].title, "second");
    assert_eq!(books[1].slot_index, Some(1));
    assert_eq!(books[1].shelf_id, books[0].shelf_id);
}

#[test]
fn a_removed_file_becomes_finished_and_its_record_is_kept() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file("stays.epub").file("leaves.pdf"))
        .expect("first scan");
    let before = api.list_books().expect("list before");
    let leaving_id = before
        .iter()
        .find(|book| book.title == "leaves")
        .expect("leaving book")
        .id;

    let report = api
        .scan(&FakeDir::new().file("stays.epub"))
        .expect("second scan");
    let after = api.list_books().expect("list after");

    assert_eq!(report.removed, 1);
    assert_eq!(after.len(), 2, "the record is never deleted");
    let leaving = after
        .iter()
        .find(|book| book.id == leaving_id)
        .expect("finished book is still present");
    assert_eq!(leaving.reading_status, ReadingStatus::Finished);
    assert!(leaving.shelf_id.is_some(), "its spine is still placed");
    let staying = after
        .iter()
        .find(|book| book.title == "stays")
        .expect("staying book");
    assert_eq!(staying.reading_status, ReadingStatus::Unread);
}

#[test]
fn rescanning_twice_is_idempotent() {
    let (_dir, api) = database();
    let source = FakeDir::new()
        .file("one.epub")
        .dir("nested")
        .file("nested/two.pdf");

    let first = api.scan(&source).expect("first scan");
    let second = api.scan(&source).expect("second scan");

    assert_eq!(first.total, 2);
    assert_eq!(second.total, 2);
    assert_eq!(second.added, 0);
    assert_eq!(second.removed, 0);
    assert_eq!(api.list_books().expect("list books").len(), 2);
    assert_eq!(api.list_shelves().expect("list shelves").len(), 1);
}

#[test]
fn a_missing_folder_reports_a_reconnect_worthy_error() {
    let (_dir, api) = database();

    let error = api
        .scan(&FakeDir::missing())
        .expect_err("missing folder must fail");

    assert_eq!(error.code, "library_unavailable");
    assert!(
        api.list_books().expect("catalog still opens").is_empty(),
        "the catalog is kept, not wiped"
    );
}
