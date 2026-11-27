//! Command-level tests for editing a book's core fields.

mod common;

use common::{FakeDir, database, epub_with};
use pocketlibrary_core::{Api, Book, BookEdit};

fn rich_metadata() -> Vec<String> {
    vec![
        "<dc:title>The Dispossessed</dc:title>".to_owned(),
        "<dc:creator>Ursula K. Le Guin</dc:creator>".to_owned(),
        "<dc:description>&lt;p&gt;A quiet revolution.&lt;/p&gt;</dc:description>".to_owned(),
        "<dc:publisher>Harper &amp; Row</dc:publisher>".to_owned(),
        "<dc:date>1974-05-01</dc:date>".to_owned(),
        "<dc:identifier>urn:isbn:9780061054884</dc:identifier>".to_owned(),
        "<meta property=\"belongs-to-collection\" id=\"series\">Hainish</meta>".to_owned(),
        "<meta refines=\"#series\" property=\"collection-type\">series</meta>".to_owned(),
    ]
}

fn add_book(api: &Api, path: &str) -> Book {
    let source = FakeDir::new().file_with(path, epub_with(path, &rich_metadata(), None));
    api.scan(&source).expect("scan");
    api.list_books().expect("list books").remove(0)
}

#[test]
fn updates_title_authors_and_page_count() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");

    let detail = api
        .update_book(
            book.id,
            BookEdit {
                title: Some("  The Dispossessed (An Ambiguous Utopia)  ".to_owned()),
                authors: Some(vec![
                    " Ursula K. Le Guin ".to_owned(),
                    "   ".to_owned(),
                    "Hainish".to_owned(),
                ]),
                page_count: Some(Some(341)),
            },
        )
        .expect("update book");

    assert_eq!(detail.book.title, "The Dispossessed (An Ambiguous Utopia)");
    assert_eq!(detail.book.authors, ["Ursula K. Le Guin", "Hainish"]);
    assert_eq!(detail.book.page_count, Some(341));

    let reloaded = api.book(book.id).expect("reload book");
    assert_eq!(reloaded.title, detail.book.title);
    assert_eq!(reloaded.authors, detail.book.authors);
    assert_eq!(reloaded.page_count, detail.book.page_count);
}

#[test]
fn a_no_op_returns_the_existing_detail_without_changing_it() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    let before = api.get_book_detail(book.id, None).expect("detail");

    let after = api
        .update_book(
            book.id,
            BookEdit {
                title: Some(format!("  {}  ", before.book.title)),
                authors: Some(
                    before
                        .book
                        .authors
                        .iter()
                        .map(|author| format!(" {author} "))
                        .collect(),
                ),
                page_count: Some(before.book.page_count),
            },
        )
        .expect("no-op update");

    assert_eq!(after.book, before.book);
    assert_eq!(after.cover_data_url, before.cover_data_url);
}

#[test]
fn a_blank_title_is_rejected_and_changes_nothing() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    let before = api.book(book.id).expect("before");

    let error = api
        .update_book(
            book.id,
            BookEdit {
                title: Some("   ".to_owned()),
                ..BookEdit::default()
            },
        )
        .expect_err("blank title");

    assert_eq!(error.code, "invalid_title");
    assert_eq!(api.book(book.id).expect("after"), before);
}

#[test]
fn a_zero_page_count_is_rejected_and_changes_nothing() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    let before = api.book(book.id).expect("before");

    let error = api
        .update_book(
            book.id,
            BookEdit {
                title: Some("A New Title".to_owned()),
                page_count: Some(Some(0)),
                ..BookEdit::default()
            },
        )
        .expect_err("zero pages");

    assert_eq!(error.code, "invalid_page_count");
    assert_eq!(api.book(book.id).expect("after"), before);
}

#[test]
fn only_the_supplied_fields_change() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    let before = api.book(book.id).expect("before");

    let detail = api
        .update_book(
            book.id,
            BookEdit {
                authors: Some(vec!["A Different Author".to_owned()]),
                ..BookEdit::default()
            },
        )
        .expect("partial update");

    assert_eq!(detail.book.title, before.title);
    assert_eq!(detail.book.authors, ["A Different Author"]);
    assert_eq!(detail.book.page_count, before.page_count);
}

#[test]
fn a_null_page_count_clears_an_existing_one() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    api.update_book(
        book.id,
        BookEdit {
            page_count: Some(Some(341)),
            ..BookEdit::default()
        },
    )
    .expect("set page count");

    let detail = api
        .update_book(
            book.id,
            BookEdit {
                page_count: Some(None),
                ..BookEdit::default()
            },
        )
        .expect("clear page count");

    assert_eq!(detail.book.page_count, None);
}

#[test]
fn other_fields_and_labels_are_untouched() {
    let (_dir, api) = database();
    let book = add_book(&api, "The Dispossessed.epub");
    let label = api
        .create_label("Favourite", "#6e2630")
        .expect("create label");
    api.attach_label(book.id, label.id).expect("attach label");
    let before = api.get_book_detail(book.id, None).expect("before");

    let after = api
        .update_book(
            book.id,
            BookEdit {
                title: Some("The Dispossessed".to_owned()),
                ..BookEdit::default()
            },
        )
        .expect("retitle");

    assert_eq!(after.book.series, before.book.series);
    assert_eq!(after.book.language, before.book.language);
    assert_eq!(after.book.description, before.book.description);
    assert_eq!(after.book.publisher, before.book.publisher);
    assert_eq!(after.book.published_date, before.book.published_date);
    assert_eq!(after.book.identifier, before.book.identifier);
    assert_eq!(after.book.content_hash, before.book.content_hash);
    assert_eq!(after.book.format, before.book.format);
    assert_eq!(after.book.shelf_id, before.book.shelf_id);
    assert_eq!(after.book.slot_index, before.book.slot_index);
    assert_eq!(after.book.reading_status, before.book.reading_status);
    assert_eq!(after.book.labels, before.book.labels);
    assert_eq!(after.enrichment, before.enrichment);
}

#[test]
fn the_wire_shape_keeps_absent_and_null_page_counts_distinct() {
    let absent: BookEdit =
        serde_json::from_value(serde_json::json!({ "title": "A Book" })).expect("absent");
    assert_eq!(absent.page_count, None);

    let cleared: BookEdit =
        serde_json::from_value(serde_json::json!({ "pageCount": null })).expect("null");
    assert_eq!(cleared.page_count, Some(None));

    let present: BookEdit =
        serde_json::from_value(serde_json::json!({ "pageCount": 42 })).expect("present");
    assert_eq!(present.page_count, Some(Some(42)));
}
