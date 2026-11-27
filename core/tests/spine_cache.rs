//! Cache contract and single-book lookup as used by the queue's skip path.

mod common;

use common::{FakeDir, database};
use pocketlibrary_core::SpineStyle;
use pocketlibrary_core::spine_cache::{SpineCache, cache_key};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FakeArtifact {
    book_id: i64,
}

#[test]
fn book_loads_one_row_and_its_labels() {
    let (_dir, api) = database();
    let source = FakeDir::new().file("one.epub").file("two.epub");
    api.scan(&source).expect("scan books");
    let books = api.list_books().expect("list books");
    let wanted = books[0].clone();

    let label = api.create_label("Read", "#6e2630").expect("create label");
    api.attach_label(wanted.id, label.id).expect("attach label");

    let loaded = api.book(wanted.id).expect("load one book");
    let mut expected = wanted;
    expected.labels = vec![label];
    assert_eq!(loaded, expected, "the row and its labels match the list");

    let other = books[1].id;
    assert_eq!(
        api.book(other).expect("load the other book").labels,
        Vec::new(),
        "the other book's labels never leak in"
    );
}

#[test]
fn book_reports_not_found() {
    let (_dir, api) = database();
    let error = api.book(404).expect_err("missing book");
    assert_eq!(error.code, "book_not_found");
}

#[test]
fn the_skip_path_reads_one_book_and_skips_cached_entries() {
    let (_dir, api) = database();
    let source = FakeDir::new().file("one.epub").file("two.epub");
    api.scan(&source).expect("scan books");
    let books = api.list_books().expect("list books");
    assert_eq!(books.len(), 2);

    let cache_root = tempfile::tempdir().expect("cache tempdir");
    let cache = SpineCache::new(cache_root.path());

    // Only the first book has a complete entry.
    let first = &books[0];
    let cached_key = cache_key(&first.content_hash, "cover", 320, "spine-v1");
    let cached_dir = cache.entry_dir(&cached_key);
    cache
        .write(&cached_dir, &FakeArtifact { book_id: first.id })
        .expect("write entry");

    // The worker's loop: one `book(id)` per pending id, then one artifact
    // read. No list_books and no whole-catalogue label join.
    let mut skipped = 0;
    let mut queued = 0;
    for id in books.iter().map(|book| book.id) {
        let book = api.book(id).expect("single book lookup");
        let key = cache_key(&book.content_hash, "cover", 320, "spine-v1");
        if cache.read::<FakeArtifact>(&cache.entry_dir(&key)).is_some() {
            skipped += 1;
        } else {
            queued += 1;
        }
    }

    assert_eq!(skipped, 1, "the complete entry is skipped");
    assert_eq!(queued, 1, "the uncached book stays queued");
}

#[test]
fn spine_styles_round_trip_every_wire_spelling() {
    use rusqlite::Connection;

    for (style, wire) in [
        (SpineStyle::Art, "art"),
        (SpineStyle::Cloth, "cloth"),
        (SpineStyle::Typography, "typography"),
    ] {
        assert_eq!(style.as_str(), wire);
        assert_eq!(
            serde_json::to_string(&style).expect("serialise style"),
            format!("\"{wire}\"")
        );
        assert_eq!(
            serde_json::from_str::<SpineStyle>(&format!("\"{wire}\"")).expect("deserialise style"),
            style
        );

        let conn = Connection::open_in_memory().expect("in-memory database");
        let stored: SpineStyle = conn
            .query_row("SELECT ?1", [style], |row| row.get(0))
            .expect("read style back from SQLite");
        assert_eq!(stored, style);
    }

    assert!(
        serde_json::from_str::<SpineStyle>("\"hybrid\"").is_err(),
        "unknown wire spellings are rejected"
    );
    assert!(
        serde_json::from_str::<SpineStyle>("\"full-bleed\"").is_err(),
        "the removed art style is rejected"
    );
}

#[test]
fn typography_persists_through_set_and_reload() {
    let (_dir, api) = database();
    let source = FakeDir::new().file("one.epub");
    api.scan(&source).expect("scan books");
    let book = api.list_books().expect("list books").remove(0);

    api.set_spine_style(book.id, SpineStyle::Typography)
        .expect("persist typography");
    assert_eq!(
        api.book(book.id).expect("reload").spine_style,
        SpineStyle::Typography
    );

    let listed = api.list_books().expect("list books").remove(0);
    assert_eq!(listed.spine_style, SpineStyle::Typography);
}

#[test]
fn a_new_book_defaults_to_the_wrap_spine_style() {
    let (_dir, api) = database();
    let source = FakeDir::new().file("one.epub");
    api.scan(&source).expect("scan books");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(
        book.spine_style,
        SpineStyle::Art,
        "a scanned book's insert default is Art, not NULL"
    );
    assert_eq!(
        api.book(book.id).expect("reload").spine_style,
        SpineStyle::Art
    );
}
