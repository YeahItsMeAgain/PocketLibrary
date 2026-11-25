mod common;

use common::{FakeDir, database, database_at};
use pocketlibrary_core::{Api, Book, ReadingStatus};

fn source(count: usize) -> FakeDir {
    let mut source = FakeDir::new();
    for index in 0..count {
        source = source.file(&format!("book-{index}.epub"));
    }
    source
}

fn book<'a>(books: &'a [Book], title: &str) -> &'a Book {
    books
        .iter()
        .find(|book| book.title == title)
        .unwrap_or_else(|| panic!("book {title} exists"))
}

fn shelf_titles(books: &[Book], shelf_id: i64) -> Vec<String> {
    books
        .iter()
        .filter(|book| book.shelf_id == Some(shelf_id))
        .map(|book| book.title.clone())
        .collect()
}

#[test]
fn a_book_can_be_reordered_forward_and_back_within_its_shelf() {
    let (_dir, api) = database();
    api.set_shelf_capacity(4).expect("set capacity");
    api.scan(&source(3)).expect("scan three books");
    let shelf_id = api.list_shelves().expect("shelves")[0].id;
    let first = book(&api.list_books().expect("books"), "book-0").id;

    api.move_book(first, shelf_id, 2).expect("move to the end");
    let books = api.list_books().expect("books");
    assert_eq!(
        shelf_titles(&books, shelf_id),
        vec!["book-1", "book-2", "book-0"]
    );
    assert_eq!(book(&books, "book-0").slot_index, Some(2));

    api.move_book(first, shelf_id, 0)
        .expect("move back to the front");
    let books = api.list_books().expect("books");
    assert_eq!(
        shelf_titles(&books, shelf_id),
        vec!["book-0", "book-1", "book-2"]
    );
    assert!(
        books
            .iter()
            .filter(|book| book.shelf_id == Some(shelf_id))
            .enumerate()
            .all(|(index, book)| book.slot_index == Some(index as i64)),
        "slots stay contiguous"
    );
}

#[test]
fn moving_across_shelves_compacts_the_source_and_shifts_the_target() {
    let (_dir, api) = database();
    api.set_shelf_capacity(2).expect("set capacity");
    api.scan(&source(3)).expect("scan across two shelves");
    let shelves = api.list_shelves().expect("shelves");
    let books = api.list_books().expect("books");
    let moved = book(&books, "book-0").id;

    api.move_book(moved, shelves[1].id, 0)
        .expect("move down a shelf");

    let books = api.list_books().expect("books");
    assert_eq!(shelf_titles(&books, shelves[0].id), vec!["book-1"]);
    assert_eq!(
        shelf_titles(&books, shelves[1].id),
        vec!["book-0", "book-2"]
    );
    assert_eq!(book(&books, "book-1").slot_index, Some(0));
    assert_eq!(book(&books, "book-0").slot_index, Some(0));
    assert_eq!(book(&books, "book-2").slot_index, Some(1));
}

#[test]
fn a_cross_shelf_move_can_land_between_books() {
    let (_dir, api) = database();
    api.set_shelf_capacity(4).expect("set capacity");
    api.scan(&source(6)).expect("scan across two shelves");
    let shelves = api.list_shelves().expect("shelves");
    let books = api.list_books().expect("books");
    let moved = book(&books, "book-0").id;

    api.move_book(moved, shelves[1].id, 1)
        .expect("move between the target shelf's books");

    let books = api.list_books().expect("books");
    assert_eq!(
        shelf_titles(&books, shelves[0].id),
        vec!["book-1", "book-2", "book-3"]
    );
    assert_eq!(
        shelf_titles(&books, shelves[1].id),
        vec!["book-4", "book-0", "book-5"]
    );
    assert!(
        books
            .iter()
            .filter(|book| book.shelf_id == Some(shelves[1].id))
            .enumerate()
            .all(|(index, book)| book.slot_index == Some(index as i64)),
        "the target shelf stays contiguous"
    );
}

#[test]
fn a_full_target_shelf_rejects_a_cross_shelf_move() {
    let (_dir, api) = database();
    api.set_shelf_capacity(1).expect("set capacity");
    api.scan(&source(2)).expect("fill two shelves");
    let shelves = api.list_shelves().expect("shelves");
    let before = api.list_books().expect("books");
    let moved = book(&before, "book-0").id;

    let error = api
        .move_book(moved, shelves[1].id, 0)
        .expect_err("the target shelf is full");
    assert_eq!(error.code, "shelf_full");
    assert_eq!(api.list_books().expect("unchanged books"), before);
}

#[test]
fn invalid_targets_are_rejected_and_a_same_slot_move_is_a_no_op() {
    let (_dir, api) = database();
    api.scan(&source(2)).expect("scan two books");
    let shelves = api.list_shelves().expect("shelves");
    let before = api.list_books().expect("books");
    let moved = book(&before, "book-0").id;

    assert_eq!(
        api.move_book(moved, 999, 0)
            .expect_err("missing shelf")
            .code,
        "invalid_target"
    );
    assert_eq!(
        api.move_book(moved, shelves[0].id, 9)
            .expect_err("slot beyond the shelf")
            .code,
        "invalid_target"
    );
    assert_eq!(
        api.move_book(moved, shelves[0].id, -1)
            .expect_err("negative slot")
            .code,
        "invalid_target"
    );
    assert_eq!(
        api.move_book(999, shelves[0].id, 0)
            .expect_err("missing book")
            .code,
        "book_not_found"
    );

    api.move_book(moved, shelves[0].id, 0)
        .expect("the same slot is a no-op");
    assert_eq!(api.list_books().expect("unchanged books"), before);
}

#[test]
fn moving_a_book_preserves_status_labels_progress_and_locator() {
    let (_dir, api) = database();
    api.set_shelf_capacity(1).expect("set capacity");
    api.scan(&source(2)).expect("scan across two shelves");
    let shelves = api.list_shelves().expect("shelves");
    let books = api.list_books().expect("books");
    let moved = book(&books, "book-0").id;

    let label = api.create_label("Gothic", "#6e2630").expect("create label");
    api.attach_label(moved, label.id).expect("attach label");
    api.set_reading_state(
        moved,
        ReadingStatus::Reading,
        0.42,
        Some("{\"cfi\":\"epubcfi(/6/4)\"}"),
    )
    .expect("set reading state");
    let state_before = api.reading_state(moved).expect("state before");

    // Make room on the lower shelf by growing capacity first.
    api.set_shelf_capacity(2).expect("grow capacity");
    api.move_book(moved, shelves[1].id, 1).expect("move down");

    let books = api.list_books().expect("books");
    let moved_book = book(&books, "book-0");
    assert_eq!(moved_book.shelf_id, Some(shelves[1].id));
    assert_eq!(moved_book.slot_index, Some(1));
    assert_eq!(moved_book.reading_status, ReadingStatus::Reading);
    assert_eq!(api.reading_state(moved).expect("state after"), state_before);
    assert_eq!(
        api.labels_for_book(moved).expect("labels after"),
        vec![label]
    );
}

#[test]
fn a_rearranged_shelf_survives_reopening_the_catalog() {
    let (dir, path, api) = database_at();
    api.set_shelf_capacity(2).expect("set capacity");
    api.scan(&source(3)).expect("scan across two shelves");
    let shelves = api.list_shelves().expect("shelves");
    let books = api.list_books().expect("books");
    let first = book(&books, "book-0").id;
    api.move_book(first, shelves[0].id, 1)
        .expect("reorder the first shelf");
    let expected = api.list_books().expect("books before reopen");
    drop(api);

    let reopened = Api::open(&path).expect("reopen catalog");
    assert_eq!(reopened.list_books().expect("books after reopen"), expected);
    drop(dir);
}

#[test]
fn deleting_a_book_compacts_its_shelf_and_forgets_its_metadata() {
    let (_dir, api) = database();
    api.set_shelf_capacity(4).expect("set capacity");
    api.scan(&source(3)).expect("scan three books");
    let shelf_id = api.list_shelves().expect("shelves")[0].id;
    let books = api.list_books().expect("books");
    let removed = book(&books, "book-1");
    let removed_id = removed.id;
    let label = api.create_label("Gothic", "#6e2630").expect("create label");
    api.attach_label(removed_id, label.id)
        .expect("attach label");

    api.delete_book(removed_id).expect("delete book");

    let books = api.list_books().expect("books after delete");
    assert!(books.iter().all(|book| book.id != removed_id));
    assert_eq!(shelf_titles(&books, shelf_id), vec!["book-0", "book-2"]);
    assert!(
        books
            .iter()
            .filter(|book| book.shelf_id == Some(shelf_id))
            .enumerate()
            .all(|(index, book)| book.slot_index == Some(index as i64)),
        "the shelf stays contiguous after deletion"
    );
    let usage = api.label_usage().expect("label usage");
    assert_eq!(usage[0].book_count, 0, "the deleted book's labels cascade");
}
