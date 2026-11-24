use std::collections::{HashMap, HashSet};

use pocketlibrary_core::{
    Api, BookFormat, Error, FileSource, ReadingStatus, Result, SourceEntry, SourceKind,
};
use tempfile::TempDir;

/// A small in-memory directory tree that stands in for SAF in host tests.
#[derive(Default)]
struct FakeDir {
    dirs: HashMap<String, Vec<SourceEntry>>,
    failures: HashSet<String>,
    root_missing: bool,
}

impl FakeDir {
    fn new() -> Self {
        let mut dirs = HashMap::new();
        dirs.insert(String::new(), Vec::new());
        Self {
            dirs,
            failures: HashSet::new(),
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
            });
        self.dirs.entry(path.to_owned()).or_default();
        self
    }

    fn failing_dir(mut self, path: &str) -> Self {
        self = self.dir(path);
        self.failures.insert(path.to_owned());
        self
    }

    fn missing() -> Self {
        Self {
            dirs: HashMap::new(),
            failures: HashSet::new(),
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
        if self.failures.contains(key) {
            return Err(Error::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("cannot list {key}"),
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
    let (dir, _path, api) = database_at();
    (dir, api)
}

fn database_at() -> (TempDir, std::path::PathBuf, Api) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    let api = Api::open(&path).expect("open catalog");
    (dir, path, api)
}

fn book_id_at(path: &std::path::Path, book_path: &str) -> i64 {
    let conn = rusqlite::Connection::open(path).expect("open catalog directly");
    conn.query_row("SELECT id FROM books WHERE path = ?1", [book_path], |row| {
        row.get(0)
    })
    .expect("book exists")
}

fn reading_state_at(path: &std::path::Path, book_id: i64) -> (String, String, f64, Option<i64>) {
    let conn = rusqlite::Connection::open(path).expect("open catalog directly");
    conn.query_row(
        "SELECT status, status_source, progress, finished_at
         FROM reading_state WHERE book_id = ?1",
        [book_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("reading state exists")
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

#[test]
fn a_failed_subfolder_aborts_without_touching_existing_books() {
    let (_dir, api) = database();
    api.scan(
        &FakeDir::new()
            .dir("Good")
            .file("Good/keep.epub")
            .dir("Broken")
            .file("Broken/lost.pdf"),
    )
    .expect("first scan");
    let before = api.list_books().expect("list before");

    let broken = FakeDir::new()
        .dir("Good")
        .file("Good/keep.epub")
        .failing_dir("Broken");
    let error = api
        .scan(&broken)
        .expect_err("a failed subtree must abort the scan");

    assert_eq!(error.code, "library_unavailable");
    assert!(
        !error.message.contains("Broken"),
        "the wire message must not carry a path fragment"
    );
    let after = api.list_books().expect("list after");
    assert_eq!(after.len(), before.len(), "no book is dropped");
    assert!(
        after
            .iter()
            .all(|book| book.reading_status == ReadingStatus::Unread),
        "a partial tree must not mark books finished"
    );
}

#[test]
fn an_overdeep_tree_aborts_instead_of_returning_a_partial_scan() {
    let (_dir, api) = database();
    let mut source = FakeDir::new();
    let mut path = String::new();
    for depth in 0..66 {
        let name = format!("level-{depth}");
        path = if path.is_empty() {
            name
        } else {
            format!("{path}/{name}")
        };
        source = source.dir(&path);
    }

    let error = api
        .scan(&source)
        .expect_err("depth limit must abort the scan");

    assert_eq!(error.code, "library_unavailable");
    assert!(api.list_books().expect("list books").is_empty());
}

#[test]
fn a_second_removal_scan_reports_nothing_and_keeps_progress() {
    let (_dir, path, api) = database_at();
    api.scan(&FakeDir::new().file("keep.epub").file("leave.pdf"))
        .expect("first scan");
    let leaving_id = book_id_at(&path, "leave.pdf");

    {
        let conn = rusqlite::Connection::open(&path).expect("open catalog directly");
        conn.execute(
            "INSERT INTO reading_state (book_id, status, status_source, progress)
             VALUES (?1, 'reading', 'manual', 0.42)",
            [leaving_id],
        )
        .expect("seed progress");
    }

    let first_removal = api
        .scan(&FakeDir::new().file("keep.epub"))
        .expect("removal scan");
    assert_eq!(first_removal.removed, 1);

    let (status, source, progress, finished_at) = reading_state_at(&path, leaving_id);
    assert_eq!(status, "finished");
    assert_eq!(source, "manual", "status_source is preserved");
    assert_eq!(progress, 0.42, "progress is preserved");
    assert!(finished_at.is_some());

    let second_removal = api
        .scan(&FakeDir::new().file("keep.epub"))
        .expect("second removal scan");
    assert_eq!(
        second_removal.removed, 0,
        "a finished book is not removed twice"
    );

    let (status, source, progress, finished_at_after) = reading_state_at(&path, leaving_id);
    assert_eq!(status, "finished");
    assert_eq!(source, "manual");
    assert_eq!(progress, 0.42);
    assert_eq!(
        finished_at_after, finished_at,
        "finished_at is not rewritten"
    );
}
