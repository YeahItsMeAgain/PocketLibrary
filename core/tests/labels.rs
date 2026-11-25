mod common;

use common::{FakeDir, database};
use pocketlibrary_core::{Api, LabelUsage, ReadingStatus};

const OXBLOOD: &str = "#6e2630";
const FOREST: &str = "#294735";
const MUSTARD: &str = "#6b4d18";

fn source(titles: &[&str]) -> FakeDir {
    let mut source = FakeDir::new();
    for title in titles {
        source = source.file(&format!("{title}.epub"));
    }
    source
}

fn book_id(api: &Api, title: &str) -> i64 {
    api.list_books()
        .expect("books")
        .into_iter()
        .find(|book| book.title == title)
        .unwrap_or_else(|| panic!("book {title} exists"))
        .id
}

fn usage(api: &Api, name: &str) -> LabelUsage {
    api.label_usage()
        .expect("label usage")
        .into_iter()
        .find(|entry| entry.label.name == name)
        .unwrap_or_else(|| panic!("label {name} exists"))
}

#[test]
fn labels_can_be_created_renamed_recoloured_and_deleted_without_touching_books() {
    let (_dir, api) = database();
    api.scan(&source(&["gothic", "sci-fi"]))
        .expect("scan two books");
    let gothic = book_id(&api, "gothic");
    let sci_fi = book_id(&api, "sci-fi");

    let label = api.create_label("Gothic", OXBLOOD).expect("create label");
    assert_eq!(label.name, "Gothic");
    assert_eq!(label.colour, OXBLOOD);
    assert_eq!(usage(&api, "Gothic").book_count, 0);

    assert_eq!(
        api.create_label("Gothic", FOREST)
            .expect_err("names are unique")
            .code,
        "label_exists"
    );
    assert_eq!(
        api.create_label("Gothic", "#123456")
            .expect_err("colours stay in the palette")
            .code,
        "invalid_label_colour"
    );

    api.attach_label(gothic, label.id).expect("attach");
    api.attach_label(sci_fi, label.id).expect("attach");
    api.attach_label(gothic, label.id)
        .expect("attaching twice is a no-op");
    assert_eq!(usage(&api, "Gothic").book_count, 2);

    api.rename_label(label.id, "Weird Tales")
        .expect("rename label");
    api.recolour_label(label.id, FOREST)
        .expect("recolour label");
    let renamed = usage(&api, "Weird Tales");
    assert_eq!(renamed.label.colour, FOREST);
    assert_eq!(renamed.book_count, 2);
    assert_eq!(
        api.labels_for_book(gothic).expect("labels").len(),
        1,
        "a book wears a label once"
    );

    api.detach_label(sci_fi, label.id).expect("detach label");
    assert_eq!(usage(&api, "Weird Tales").book_count, 1);

    api.delete_label(label.id).expect("delete label");
    assert!(api.label_usage().expect("label usage").is_empty());
    assert_eq!(
        api.labels_for_book(gothic).expect("labels").len(),
        0,
        "deleting a label removes its associations"
    );
    let books = api.list_books().expect("books survive");
    assert_eq!(books.len(), 2);
    assert_eq!(
        books
            .iter()
            .map(|book| book.title.as_str())
            .collect::<Vec<_>>(),
        vec!["gothic", "sci-fi"],
        "no book is deleted with a label"
    );
}

#[test]
fn multiple_labels_combine_with_status_for_filtering() {
    let (_dir, api) = database();
    api.scan(&source(&["alpha", "beta", "gamma"]))
        .expect("scan three books");
    let alpha = book_id(&api, "alpha");
    let beta = book_id(&api, "beta");
    let gamma = book_id(&api, "gamma");

    let gothic = api.create_label("Gothic", OXBLOOD).expect("gothic");
    let winter = api.create_label("Winter", MUSTARD).expect("winter");
    api.attach_label(alpha, gothic.id).expect("alpha gothic");
    api.attach_label(beta, gothic.id).expect("beta gothic");
    api.attach_label(beta, winter.id).expect("beta winter");
    api.attach_label(gamma, winter.id).expect("gamma winter");

    api.set_reading_status(beta, ReadingStatus::Reading)
        .expect("beta reading");
    api.set_reading_status(gamma, ReadingStatus::Finished)
        .expect("gamma finished");

    let ids = |label_ids: &[i64], status: Option<ReadingStatus>| {
        api.filter_books(label_ids, status).expect("filter")
    };

    assert_eq!(ids(&[gothic.id], None), vec![alpha, beta]);
    assert_eq!(ids(&[gothic.id], Some(ReadingStatus::Reading)), vec![beta]);
    assert_eq!(ids(&[gothic.id, winter.id], None), vec![beta]);
    assert_eq!(ids(&[], Some(ReadingStatus::Finished)), vec![gamma]);
    assert_eq!(
        ids(&[gothic.id], Some(ReadingStatus::Finished)),
        Vec::<i64>::new()
    );
    assert_eq!(ids(&[], None), vec![alpha, beta, gamma]);
}

#[test]
fn opening_sets_reading_and_progress_finishes_but_manual_override_wins() {
    let (_dir, api) = database();
    api.scan(&source(&["open-me", "finish-me"]))
        .expect("scan two books");
    let opened = book_id(&api, "open-me");
    let finished = book_id(&api, "finish-me");

    api.record_open(opened).expect("record open");
    let state = api.reading_state(opened).expect("reading state");
    assert_eq!(state.status, ReadingStatus::Reading);
    assert_eq!(state.status_source, "auto");

    assert_eq!(
        api.record_progress(finished, 0.98, Some("{}"))
            .expect("record progress"),
        ReadingStatus::Finished
    );
    api.record_open(finished).expect("reopen finished");
    let state = api.reading_state(finished).expect("finished state");
    assert_eq!(
        state.status,
        ReadingStatus::Finished,
        "reopening does not clear finished"
    );
    assert_eq!(state.status_source, "auto");

    api.set_reading_status(opened, ReadingStatus::Unread)
        .expect("manual unread");
    api.record_open(opened).expect("auto open after manual");
    api.record_progress(opened, 1.0, Some("{}"))
        .expect("auto progress after manual");
    let state = api.reading_state(opened).expect("manual state");
    assert_eq!(state.status, ReadingStatus::Unread);
    assert_eq!(
        state.status_source, "manual",
        "the manual override persists"
    );

    api.set_reading_status(opened, ReadingStatus::Finished)
        .expect("manual finished");
    let state = api.reading_state(opened).expect("manual finished state");
    assert_eq!(state.status, ReadingStatus::Finished);
    assert_eq!(state.status_source, "manual");
}

#[test]
fn bookmarks_are_annotations_and_read_book_paths_stay_in_the_shell() {
    let (_dir, api) = database();
    api.scan(&source(&["bookmarked"])).expect("scan one book");
    let id = book_id(&api, "bookmarked");

    assert!(api.list_bookmarks(id).expect("empty bookmarks").is_empty());
    assert_eq!(
        api.add_bookmark(id, "  ").expect_err("empty locator").code,
        "invalid_reader_locator"
    );

    let first = api
        .add_bookmark(
            id,
            r#"{"v":1,"cfi":"epubcfi(/6/2!/4,/2,/8/1:0)","progress":0.1}"#,
        )
        .expect("first bookmark");
    let second = api
        .add_bookmark(
            id,
            r#"{"v":1,"cfi":"epubcfi(/6/4!/4,/2,/8/1:12)","progress":0.6}"#,
        )
        .expect("second bookmark");
    assert_eq!(api.list_bookmarks(id).expect("bookmarks").len(), 2);
    assert_eq!(first.book_id, id);
    assert_eq!(second.book_id, id);

    api.delete_bookmark(id, first.id).expect("delete bookmark");
    let remaining = api.list_bookmarks(id).expect("remaining bookmarks");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, second.id);
    assert_eq!(
        api.delete_bookmark(id, first.id)
            .expect_err("already deleted")
            .code,
        "bookmark_not_found"
    );

    assert_eq!(api.book_path(id).expect("book path"), "bookmarked.epub");
}
