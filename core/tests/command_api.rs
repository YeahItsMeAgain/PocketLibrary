use pocketlibrary_core::{
    APP_NAME, Api, ApiError, Book, BookFormat, DEFAULT_DOWNLOAD_NAMING, Error, ReadingStatus,
    SCHEMA_VERSION,
};
use tempfile::TempDir;

fn database_path() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    (dir, path)
}

#[test]
fn fresh_database_migrates_to_the_current_schema() {
    let (_dir, path) = database_path();

    let api = Api::open(&path).expect("open fresh catalog");
    let info = api.app_info().expect("app info");

    assert_eq!(info.schema_version, SCHEMA_VERSION);
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
        page_count: Some(320),
        spine_style: pocketlibrary_core::SpineStyle::Wrap,
        spine_data_url: None,
        cover_path: Some("/covers/secret.jpg".to_owned()),
        cover_source: Some(pocketlibrary_core::CoverSource::Embedded),
        file_cover_path: Some("/covers/secret.jpg".to_owned()),
        file_cover_source: Some(pocketlibrary_core::CoverSource::Embedded),
        file_description: None,
        added_at: 0,
        shelf_id: Some(1),
        slot_index: Some(0),
        reading_status: ReadingStatus::Unread,
        labels: Vec::new(),
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

#[test]
fn download_naming_defaults_is_persisted_and_rejects_blank_patterns() {
    let (_dir, path) = database_path();
    let api = Api::open(&path).expect("open fresh catalog");

    assert_eq!(
        api.download_naming().expect("default naming"),
        DEFAULT_DOWNLOAD_NAMING
    );

    let saved = api
        .set_download_naming("  {title} - {author}  ")
        .expect("set naming");
    assert_eq!(saved, "{title} - {author}");
    assert_eq!(
        api.download_naming().expect("saved naming"),
        "{title} - {author}"
    );

    let error = api
        .set_download_naming("   ")
        .expect_err("blank pattern is invalid");
    assert_eq!(error.code, "invalid_download_naming");

    for invalid in ["{series} - {title}", "{author - {title}", "done}"] {
        let error = api
            .set_download_naming(invalid)
            .expect_err("malformed pattern is invalid");
        assert_eq!(error.code, "invalid_download_naming", "{invalid}");
    }
    assert_eq!(
        api.download_naming()
            .expect("rejected patterns do not persist"),
        "{title} - {author}"
    );

    drop(api);
    let reopened = Api::open(&path).expect("reopen catalog");
    assert_eq!(
        reopened.download_naming().expect("naming survives reopen"),
        "{title} - {author}"
    );
}

#[test]
fn source_errors_hide_paths_from_the_serialised_wire_message() {
    let error = Error::SourceUnavailable {
        message: "could not list Private/secret.epub: /storage/emulated/0/Books".to_owned(),
    };
    let api_error = ApiError::from(error);

    assert_eq!(api_error.code, "library_unavailable");
    let json = serde_json::to_string(&api_error).expect("serialise error");
    assert!(!json.contains("Private"));
    assert!(!json.contains("secret.epub"));
    assert!(!json.contains("/storage"));
    assert!(api_error.message.contains("library folder is unavailable"));
}

#[test]
fn migrating_a_version_one_library_resets_books_but_keeps_shelves_labels_and_settings() {
    let (_dir, path) = database_path();
    {
        let conn = rusqlite::Connection::open(&path).expect("create v1 database");
        conn.execute_batch(
            r#"
            PRAGMA user_version = 1;
            CREATE TABLE shelves (id INTEGER PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL);
            INSERT INTO shelves (ordinal, capacity) VALUES (0, 12);
            CREATE TABLE books (
                id INTEGER PRIMARY KEY, content_hash TEXT NOT NULL UNIQUE, quick_key TEXT,
                path TEXT NOT NULL, format TEXT NOT NULL, title TEXT NOT NULL,
                authors TEXT NOT NULL DEFAULT '[]', series TEXT, language TEXT, description TEXT,
                publisher TEXT, published_date TEXT, identifier TEXT, cover_path TEXT,
                added_at INTEGER NOT NULL, shelf_id INTEGER, slot_index INTEGER
            );
            CREATE TABLE labels (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, colour TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE book_labels (book_id INTEGER NOT NULL, label_id INTEGER NOT NULL, PRIMARY KEY (book_id, label_id));
            CREATE TABLE reading_state (book_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'unread', status_source TEXT NOT NULL DEFAULT 'auto', progress REAL NOT NULL DEFAULT 0, locator TEXT, last_opened_at INTEGER, finished_at INTEGER);
            CREATE TABLE annotations (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL, kind TEXT NOT NULL, colour TEXT, note TEXT, locator TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
            INSERT INTO settings (key, value, updated_at) VALUES ('shelf_capacity', '9', 0);
            INSERT INTO labels (name, colour, created_at) VALUES ('Gothic', '#5a1f2a', 0);
            INSERT INTO books (content_hash, path, format, title, added_at, shelf_id, slot_index)
                VALUES ('old-path-hash', 'ghost.epub', 'epub', 'Ghost', 0, 1, 0);
            INSERT INTO reading_state (book_id, status, progress) VALUES (1, 'reading', 0.5);
            INSERT INTO book_labels (book_id, label_id) VALUES (1, 1);
            INSERT INTO annotations (book_id, kind, locator, created_at, updated_at)
                VALUES (1, 'note', '{}', 0, 0);
            "#,
        )
        .expect("seed v1 database");
    }

    let api = Api::open(&path).expect("migrate v1 catalog");
    assert_eq!(
        api.app_info().expect("app info").schema_version,
        SCHEMA_VERSION
    );
    assert!(
        api.list_books().expect("list books").is_empty(),
        "path-derived books are cleared for the launch scan"
    );
    let shelves = api.list_shelves().expect("list shelves");
    assert_eq!(shelves.len(), 1, "shelves survive the reset");
    assert_eq!(
        api.list_labels().expect("labels kept"),
        vec![pocketlibrary_core::Label {
            id: 1,
            name: "Gothic".to_owned(),
            colour: "#5a1f2a".to_owned(),
            created_at: 0,
        }],
        "labels survive the reset"
    );
}
