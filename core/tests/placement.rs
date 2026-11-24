mod common;

use common::{FakeDir, database, database_at};
use pocketlibrary_core::Api;

fn source(count: usize) -> FakeDir {
    let mut source = FakeDir::new();
    for index in 0..count {
        source = source.file(&format!("book-{index}.epub"));
    }
    source
}

#[test]
fn capacity_from_settings_is_enforced_across_shelves() {
    let (_dir, _path, api) = database_at();
    assert_eq!(api.shelf_capacity().expect("default capacity"), 12);

    assert_eq!(api.set_shelf_capacity(2).expect("set capacity"), 2);
    assert_eq!(
        api.list_shelves()
            .expect("shelves")
            .iter()
            .map(|shelf| shelf.capacity)
            .collect::<Vec<_>>(),
        vec![2]
    );

    let report = api.scan(&source(2)).expect("scan first two");
    assert_eq!(report.added, 2);
    assert!(
        report
            .placements
            .iter()
            .all(|placement| !placement.appended_shelf),
        "two books fit the first shelf"
    );

    let report = api.scan(&source(3)).expect("scan third");
    assert_eq!(report.added, 1);
    assert_eq!(report.placements[0].shelf_ordinal, 1);
    assert!(
        report.placements[0].appended_shelf,
        "the third book needs a new shelf"
    );

    let shelves = api.list_shelves().expect("shelves");
    assert_eq!(shelves.len(), 2);
    assert!(shelves.iter().all(|shelf| shelf.capacity == 2));
    let books = api.list_books().expect("books");
    assert_eq!(books[2].shelf_id, Some(shelves[1].id));
    assert_eq!(books[2].slot_index, Some(0));
}

#[test]
fn the_second_shelf_takes_the_next_book_after_the_first_is_full() {
    let (_dir, api) = database();
    api.set_shelf_capacity(2).expect("set capacity");

    api.scan(&source(2)).expect("fill first shelf");
    let report = api.scan(&source(3)).expect("place next book");
    let shelves = api.list_shelves().expect("shelves");
    let next = api
        .list_books()
        .expect("books")
        .into_iter()
        .find(|book| book.title == "book-2")
        .expect("third book");

    assert_eq!(shelves.len(), 2, "one shelf was appended");
    assert_eq!(next.shelf_id, Some(shelves[1].id));
    assert_eq!(next.slot_index, Some(0));
    assert!(report.placements[0].appended_shelf);
}

#[test]
fn a_full_library_appends_a_shelf_and_undo_removes_only_the_record() {
    let (_dir, api) = database();
    api.set_shelf_capacity(1).expect("set capacity");
    let before = source(1);
    api.scan(&before).expect("fill the only shelf");

    let after = source(2);
    let report = api.scan(&after).expect("append shelf");
    assert_eq!(report.added, 1);
    let placement = report.placements[0].clone();
    assert!(placement.appended_shelf);
    assert_eq!(placement.shelf_ordinal, 1);
    assert_eq!(api.list_shelves().expect("shelves").len(), 2);
    assert_eq!(api.list_books().expect("books").len(), 2);

    // The file is still in the folder; undo is purely catalog work.
    assert!(!after.bytes("book-1.epub").is_empty());
    assert!(
        api.undo_placement(placement.book_id, placement.shelf_id)
            .expect("undo placement")
    );
    assert_eq!(api.list_shelves().expect("shelves").len(), 1);
    let books = api.list_books().expect("books");
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].title, "book-0");

    let rescanned = api.scan(&after).expect("rescan re-adds the file");
    assert_eq!(rescanned.added, 1);
    assert_eq!(api.list_books().expect("books").len(), 2);
    assert_eq!(api.list_shelves().expect("shelves").len(), 2);
}

#[test]
fn undo_is_a_no_op_when_the_appended_shelf_gained_another_book() {
    let (_dir, api) = database();
    api.set_shelf_capacity(2).expect("set capacity");
    api.scan(&source(2)).expect("fill the only shelf");
    let report = api.scan(&source(3)).expect("append shelf");
    let placement = report.placements[0].clone();
    api.scan(&source(4))
        .expect("put another book on the new shelf");

    assert!(
        !api.undo_placement(placement.book_id, placement.shelf_id)
            .expect("undo is refused"),
        "a shelf that is no longer empty must not be removed"
    );
    assert_eq!(api.list_shelves().expect("shelves").len(), 2);
    assert_eq!(api.list_books().expect("books").len(), 4);
}

#[test]
fn capacity_and_placement_survive_a_service_reopen() {
    let (dir, path, api) = database_at();
    api.set_shelf_capacity(2).expect("set capacity");
    api.scan(&source(3)).expect("scan across two shelves");
    let shelves_before = api.list_shelves().expect("shelves before");
    let books_before = api.list_books().expect("books before");
    drop(api);

    let reopened = Api::open(&path).expect("reopen catalog");
    assert_eq!(reopened.shelf_capacity().expect("capacity"), 2);
    assert_eq!(
        reopened.list_shelves().expect("shelves after"),
        shelves_before
    );
    assert_eq!(reopened.list_books().expect("books after"), books_before);
    drop(dir);
}

#[test]
fn a_zero_capacity_is_rejected() {
    let (_dir, api) = database();
    let error = api.set_shelf_capacity(0).expect_err("zero is invalid");
    assert_eq!(error.code, "invalid_capacity");
    assert_eq!(api.shelf_capacity().expect("unchanged capacity"), 12);
}

#[test]
fn new_books_choose_the_lowest_shelf_with_room_not_the_last_shelf() {
    let (_dir, api) = database();
    api.set_shelf_capacity(1).expect("set capacity");
    api.scan(&source(3)).expect("fill three shelves");

    // Every shelf now has one book but room for a second.
    api.set_shelf_capacity(2).expect("grow capacity");
    let report = api.scan(&source(4)).expect("place the fourth book");
    let shelves = api.list_shelves().expect("shelves");
    let fourth = api
        .list_books()
        .expect("books")
        .into_iter()
        .find(|book| book.title == "book-3")
        .expect("fourth book");

    assert_eq!(shelves.len(), 3, "no new shelf is needed");
    assert_eq!(
        fourth.shelf_id,
        Some(shelves[0].id),
        "the book fills the lowest shelf with room, not the last shelf"
    );
    assert!(!report.placements[0].appended_shelf);
}
