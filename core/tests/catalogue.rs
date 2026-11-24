use pocketlibrary_core::{APP_NAME, SCHEMA_VERSION, Service};
use tempfile::TempDir;

fn database_path() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    (dir, path)
}

#[test]
fn fresh_database_migrates_to_schema_version_one() {
    let (_dir, path) = database_path();

    let service = Service::open(&path).expect("open fresh catalogue");
    let info = service.app_info().expect("app info");

    assert_eq!(info.schema_version, SCHEMA_VERSION);
    assert_eq!(info.schema_version, 1);
}

#[test]
fn reopening_a_database_keeps_the_schema_version() {
    let (_dir, path) = database_path();

    {
        let service = Service::open(&path).expect("open fresh catalogue");
        assert_eq!(
            service.app_info().expect("app info").schema_version,
            SCHEMA_VERSION
        );
    }

    let reopened = Service::open(&path).expect("reopen migrated catalogue");
    assert_eq!(
        reopened.app_info().expect("app info").schema_version,
        SCHEMA_VERSION,
        "migrations must be idempotent on reopen"
    );
}

#[test]
fn fresh_database_has_an_empty_catalogue() {
    let (_dir, path) = database_path();
    let service = Service::open(&path).expect("open fresh catalogue");

    assert_eq!(service.list_books().expect("list books"), Vec::new());
    assert_eq!(service.list_shelves().expect("list shelves"), Vec::new());
}

#[test]
fn app_info_reports_the_crate_version_and_schema_version() {
    let (_dir, path) = database_path();
    let service = Service::open(&path).expect("open fresh catalogue");

    let info = service.app_info().expect("app info");

    assert_eq!(info.name, APP_NAME);
    assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(info.schema_version, SCHEMA_VERSION);
}
