use pocketlibrary_core::{APP_NAME, Api, Book, BookFormat, SCHEMA_VERSION};
use tempfile::TempDir;

fn database_path() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    (dir, path)
}

#[test]
fn fresh_database_migrates_to_schema_version_one() {
    let (_dir, path) = database_path();

    let api = Api::open(&path).expect("open fresh catalog");
    let info = api.app_info().expect("app info");

    assert_eq!(info.schema_version, SCHEMA_VERSION);
    assert_eq!(info.schema_version, 1);
}

#[test]
fn reopening_a_database_keeps_the_schema_version() {
    let (_dir, path) = database_path();

    {
        let api = Api::open(&path).expect("open fresh catalog");
        assert_eq!(
            api.app_info().expect("app info").schema_version,
            SCHEMA_VERSION
        );
    }

    let reopened = Api::open(&path).expect("reopen migrated catalog");
    assert_eq!(
        reopened.app_info().expect("app info").schema_version,
        SCHEMA_VERSION,
        "migrations must be idempotent on reopen"
    );
}

#[test]
fn fresh_database_has_one_empty_shelf_and_no_books() {
    let (_dir, path) = database_path();
    let api = Api::open(&path).expect("open fresh catalog");

    let shelves = api.list_shelves().expect("list shelves");
    assert_eq!(shelves.len(), 1);
    assert_eq!(shelves[0].ordinal, 0);
    assert_eq!(shelves[0].capacity, 12);
    assert_eq!(api.list_books().expect("list books"), Vec::new());
}

#[test]
fn app_info_reports_the_crate_version_and_schema_version() {
    let (_dir, path) = database_path();
    let api = Api::open(&path).expect("open fresh catalog");

    let info = api.app_info().expect("app info");

    assert_eq!(info.name, APP_NAME);
    assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(info.schema_version, SCHEMA_VERSION);
}

#[test]
fn serialised_books_do_not_leak_filesystem_paths() {
    let book = Book {
        id: 7,
        content_hash: "hash".to_owned(),
        quick_key: None,
        path: "/books/secret.epub".to_owned(),
        format: BookFormat::Epub,
        title: "A Book".to_owned(),
        authors: vec!["An Author".to_owned()],
        series: None,
        language: None,
        description: None,
        publisher: None,
        published_date: None,
        identifier: None,
        cover_path: Some("/covers/secret.jpg".to_owned()),
        added_at: 0,
        shelf_id: Some(1),
        slot_index: Some(0),
    };

    let json = serde_json::to_value(&book).expect("serialise book");
    let object = json.as_object().expect("book is an object");

    assert!(
        !object.contains_key("path"),
        "path must stay in the core model"
    );
    assert!(
        !object.contains_key("coverPath"),
        "coverPath must stay in the core model"
    );
    assert_eq!(object.get("id"), Some(&serde_json::json!(7)));
}
