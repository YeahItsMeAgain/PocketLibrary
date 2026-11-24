mod common;

use std::collections::HashSet;

use common::{FakeDir, database, database_at};
use pocketlibrary_core::{BookFormat, ReadingStatus};

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
    assert!(second.skipped.is_empty());
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
    let (_dir, _path, api) = database_at();
    api.scan(&FakeDir::new().file("keep.epub").file("leave.pdf"))
        .expect("first scan");
    let leaving_id = api
        .list_books()
        .expect("list before")
        .into_iter()
        .find(|book| book.title == "leave")
        .expect("leaving book")
        .id;
    api.set_reading_state(leaving_id, ReadingStatus::Reading, 0.42, None)
        .expect("seed progress");

    let first_removal = api
        .scan(&FakeDir::new().file("keep.epub"))
        .expect("removal scan");
    assert_eq!(first_removal.removed, 1);

    let state = api.reading_state(leaving_id).expect("reading state");
    assert_eq!(state.status, ReadingStatus::Finished);
    assert_eq!(state.status_source, "manual", "status_source is preserved");
    assert_eq!(state.progress, 0.42, "progress is preserved");

    let second_removal = api
        .scan(&FakeDir::new().file("keep.epub"))
        .expect("second removal scan");
    assert_eq!(
        second_removal.removed, 0,
        "a finished book is not removed twice"
    );

    let state = api.reading_state(leaving_id).expect("reading state");
    assert_eq!(state.status, ReadingStatus::Finished);
    assert_eq!(state.status_source, "manual");
    assert_eq!(state.progress, 0.42);
}

#[test]
fn renaming_a_file_keeps_one_book_with_its_labels_progress_and_locator() {
    let (_dir, _path, api) = database_at();
    let source = FakeDir::new().file("old name.epub");
    api.scan(&source).expect("first scan");
    let before = api.list_books().expect("list before");
    let id = before[0].id;
    api.set_reading_state(id, ReadingStatus::Reading, 0.66, Some(r#"{"page":3}"#))
        .expect("seed state");
    let label = api.create_label("Gothic", "#6e2630").expect("create label");
    api.attach_label(id, label.id).expect("attach label");

    let renamed = FakeDir::new()
        .dir("shelf")
        .file_with("shelf/new name.epub", source.bytes("old name.epub"));
    let report = api.scan(&renamed).expect("renamed scan");
    let after = api.list_books().expect("list after");

    assert_eq!(report.added, 0, "a rename is not a new book");
    assert_eq!(report.removed, 0, "a rename is not a removal");
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, id, "identity survives the move");
    assert_eq!(after[0].reading_status, ReadingStatus::Reading);

    let state = api.reading_state(id).expect("reading state");
    assert_eq!(state.progress, 0.66);
    assert_eq!(state.locator.as_deref(), Some(r#"{"page":3}"#));
    let labels = api.labels_for_book(id).expect("labels after rename");
    assert_eq!(labels, vec![label]);
}

#[test]
fn identical_bytes_at_two_paths_produce_one_book() {
    let (_dir, _path, api) = database_at();
    let bytes = common::minimal_epub("same book");
    let source = FakeDir::new()
        .file_with("first.epub", bytes.clone())
        .dir("nested")
        .file_with("nested/copy.epub", bytes);

    let report = api.scan(&source).expect("scan duplicates");

    assert_eq!(report.added, 1);
    assert_eq!(report.duplicates, 1);
    assert_eq!(api.list_books().expect("list books").len(), 1);
    assert_eq!(report.total, 1);

    // Re-importing the same bytes again is still rejected.
    let again = api.scan(&source).expect("rescan duplicates");
    assert_eq!(again.added, 0);
    assert_eq!(again.duplicates, 1);
    assert_eq!(api.list_books().expect("list books").len(), 1);
}

#[test]
fn an_unchanged_rescan_reads_only_quick_keys_not_whole_files() {
    let (_dir, api) = database();
    let source = FakeDir::new()
        .file("quick.epub")
        .dir("nested")
        .file("nested/other.pdf");
    api.scan(&source).expect("first scan");
    assert!(
        source.full_reads() >= 2,
        "the first scan reads new files to hash and parse them"
    );

    source.reset_full_reads();
    let report = api.scan(&source).expect("rescan");
    assert_eq!(source.full_reads(), 0, "unchanged files are not read whole");
    assert_eq!(report.added, 0);
    assert_eq!(report.removed, 0);
    assert_eq!(report.duplicates, 0);
    assert_eq!(api.list_books().expect("list books").len(), 2);
}

#[test]
fn a_malformed_file_is_skipped_with_a_reason_and_does_not_abort_the_scan() {
    let (_dir, api) = database();
    let source = FakeDir::new()
        .file("good.epub")
        .file_with("broken.epub", b"this is not a zip".to_vec())
        .file_with("broken.pdf", b"%PDF-1.4 truncated".to_vec())
        .file("good.pdf");

    let report = api
        .scan(&source)
        .expect("a bad file must not abort the scan");

    assert_eq!(report.added, 2);
    assert_eq!(report.skipped.len(), 2);
    let reasons: HashSet<_> = report
        .skipped
        .iter()
        .map(|issue| (issue.name.as_str(), issue.reason.code()))
        .collect();
    assert_eq!(
        reasons,
        HashSet::from([
            ("broken.epub", "invalid_epub"),
            ("broken.pdf", "invalid_pdf"),
        ])
    );
    assert!(
        report.skipped.iter().all(|issue| !issue.name.contains('/')),
        "scan issues carry a name, never a path"
    );
    let titles: Vec<_> = api
        .list_books()
        .expect("list books")
        .into_iter()
        .map(|book| book.title)
        .collect();
    assert_eq!(titles, vec!["good", "good"]);
}
