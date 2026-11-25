//! Backup and restore through the transport-agnostic command API.

mod common;

use std::io::{Cursor, Read, Write};
use std::path::Path;

use common::{FakeDir, database, database_at};
use pocketlibrary_core::{
    Api, BACKUP_EXTENSION, BACKUP_FORMAT_VERSION, BookFormat, DownloadRequest, ImportMode,
    ReadingStatus,
};
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const OXBLOOD: &str = "#6e2630";

fn source(titles: &[&str]) -> FakeDir {
    let mut source = FakeDir::new();
    for title in titles {
        source = source.file(&format!("{title}.epub"));
    }
    source
}

fn book(api: &Api, title: &str) -> pocketlibrary_core::Book {
    api.list_books()
        .expect("books")
        .into_iter()
        .find(|book| book.title == title)
        .unwrap_or_else(|| panic!("book {title} exists"))
}

fn entry_names(bytes: &[u8]) -> Vec<String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("archive is a zip");
    (0..archive.len())
        .map(|index| {
            archive
                .by_index(index)
                .expect("read entry")
                .name()
                .expect("entry name")
                .to_string()
        })
        .collect()
}

fn manifest(bytes: &[u8]) -> Value {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("archive is a zip");
    let mut entry = archive.by_name("manifest.json").expect("manifest exists");
    let mut text = String::new();
    entry.read_to_string(&mut text).expect("read manifest");
    serde_json::from_str(&text).expect("manifest is JSON")
}

fn rewrite_manifest(bytes: &[u8], edit: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("archive is a zip");
    let mut json = String::new();
    archive
        .by_name("manifest.json")
        .expect("manifest exists")
        .read_to_string(&mut json)
        .expect("read manifest");
    let mut value: Value = serde_json::from_str(&json).expect("manifest JSON");
    edit(&mut value);

    let mut output = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut output);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip.start_file("manifest.json", options)
            .expect("manifest entry");
        zip.write_all(serde_json::to_string(&value).unwrap().as_bytes())
            .expect("write manifest");
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("source entry");
            if entry.name().expect("entry name") == "manifest.json" {
                continue;
            }
            let name = entry.name().expect("entry name").to_string();
            let mut contents = Vec::new();
            entry.read_to_end(&mut contents).expect("read entry");
            zip.start_file(name, options).expect("copy entry");
            zip.write_all(&contents).expect("write entry");
        }
        zip.finish().expect("finish archive");
    }
    output.into_inner()
}

fn archive_with_manifest(json: &str) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut output);
        zip.start_file(
            "manifest.json",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .expect("manifest entry");
        zip.write_all(json.as_bytes()).expect("write manifest");
        zip.finish().expect("finish archive");
    }
    output.into_inner()
}

fn set_reading_position(path: &Path, hash: &str, progress: f64, last_opened_at: i64) {
    let conn = rusqlite::Connection::open(path).expect("open test database");
    conn.execute(
        "UPDATE reading_state SET progress = ?1, last_opened_at = ?2
         WHERE book_id = (SELECT id FROM books WHERE content_hash = ?3)",
        rusqlite::params![progress, last_opened_at, hash],
    )
    .expect("backdate reading position");
}

fn download_request(title: &str) -> DownloadRequest {
    DownloadRequest {
        md5: "0123456789abcdef0123456789abcdef".to_owned(),
        title: title.to_owned(),
        authors: vec!["An Author".to_owned()],
        year: Some(1974),
        format: BookFormat::Epub,
        source: "Libgen".to_owned(),
        mirror_urls: vec!["https://example.test/ads.php?md5=x".to_owned()],
    }
}

#[test]
fn export_writes_a_versioned_manifest_and_no_book_files() {
    let (_dir, api) = database();
    let source = source(&["alpha", "beta"]);
    api.scan(&source).expect("scan books");
    let alpha = book(&api, "alpha");
    let label = api.create_label("Gothic", OXBLOOD).expect("create label");
    api.attach_label(alpha.id, label.id).expect("attach label");
    api.set_reading_state(alpha.id, ReadingStatus::Reading, 0.4, Some("locator-a"))
        .expect("set reading state");
    api.add_bookmark(alpha.id, r#"{"cfi":"epubcfi(/6/2!)"}"#)
        .expect("add bookmark");
    api.enqueue_download(download_request("Downloaded Book"))
        .expect("queue download history");

    let bytes = api.export_backup().expect("export");
    let names = entry_names(&bytes);

    assert!(names.iter().any(|name| name == "manifest.json"));
    assert!(
        !names
            .iter()
            .any(|name| name.ends_with(".epub") || name.ends_with(".pdf")),
        "book files must never enter the archive: {names:?}"
    );
    assert!(
        names.iter().any(|name| name.starts_with("covers/")),
        "cached covers travel with the metadata"
    );

    let manifest = manifest(&bytes);
    assert_eq!(manifest["kind"], "pocketlibrary-backup");
    assert_eq!(manifest["schemaVersion"], BACKUP_FORMAT_VERSION);
    assert!(manifest["exportedAt"].as_i64().unwrap_or(0) > 0);
    assert_eq!(manifest["books"].as_array().expect("books").len(), 2);
    assert_eq!(manifest["labels"].as_array().expect("labels").len(), 1);
    assert_eq!(
        manifest["readingStates"].as_array().expect("states").len(),
        1
    );
    assert_eq!(
        manifest["annotations"]
            .as_array()
            .expect("annotations")
            .len(),
        1
    );
    assert_eq!(
        manifest["downloads"].as_array().expect("downloads").len(),
        1
    );
    assert_eq!(BACKUP_EXTENSION, "pocketlibrary");
}

#[test]
fn export_wipe_and_replace_restore_metadata_and_covers() {
    let (_dir, path, api) = database_at();
    let source = source(&["alpha", "beta"]);
    let before = source.bytes("alpha.epub");
    api.scan(&source).expect("scan books");
    api.set_shelf_capacity(9).expect("set capacity");

    let alpha = book(&api, "alpha");
    let label = api.create_label("Gothic", OXBLOOD).expect("create label");
    api.attach_label(alpha.id, label.id).expect("attach label");
    api.set_reading_state(alpha.id, ReadingStatus::Reading, 0.4, Some("locator-a"))
        .expect("set reading state");
    api.add_bookmark(alpha.id, r#"{"cfi":"epubcfi(/6/2!)"}"#)
        .expect("add bookmark");
    api.enqueue_download(download_request("Downloaded Book"))
        .expect("queue download history");
    let alpha_hash = alpha.content_hash.clone();

    let bytes = api.export_backup().expect("export");
    drop(api);
    drop(path);

    let (_restored_dir, restored) = database();
    let report = restored
        .import_backup(&bytes, ImportMode::Replace)
        .expect("replace import");
    assert_eq!(report.mode, ImportMode::Replace);
    assert_eq!(report.new, 2, "a fresh library has no matches");
    assert_eq!(report.matched, 0);
    assert_eq!(report.replaced, 0);

    let books = restored.list_books().expect("restored books");
    assert_eq!(
        books
            .iter()
            .map(|book| book.title.as_str())
            .collect::<Vec<_>>(),
        vec!["alpha", "beta"]
    );
    assert_eq!(restored.shelf_capacity().expect("capacity restored"), 9);
    let restored_alpha = book(&restored, "alpha");
    assert_eq!(
        restored_alpha.content_hash, alpha_hash,
        "identity is the content hash"
    );
    assert_eq!(
        restored_alpha
            .labels
            .iter()
            .map(|label| &label.name)
            .collect::<Vec<_>>(),
        vec!["Gothic"]
    );
    let state = restored.reading_state(restored_alpha.id).expect("state");
    assert_eq!(state.status, ReadingStatus::Reading);
    assert_eq!(state.progress, 0.4);
    assert_eq!(state.locator.as_deref(), Some("locator-a"));
    assert_eq!(
        restored
            .list_bookmarks(restored_alpha.id)
            .expect("bookmarks")
            .len(),
        1
    );
    assert_eq!(restored.list_downloads().expect("downloads").len(), 1);
    let detail = restored
        .get_book_detail(restored_alpha.id, None)
        .expect("detail");
    assert!(
        detail.cover_data_url.is_some(),
        "the archived cover is restored to the cache"
    );
    assert_eq!(
        source.bytes("alpha.epub"),
        before,
        "book bytes are untouched by export and restore"
    );
}

#[test]
fn merge_matches_by_hash_adds_missing_and_never_deletes() {
    let (_dir_a, path_a, api_a) = database_at();
    let source_a = source(&["alpha", "beta"]);
    api_a.scan(&source_a).expect("scan source library");
    let alpha_a = book(&api_a, "alpha");
    api_a
        .set_reading_state(alpha_a.id, ReadingStatus::Reading, 0.4, Some("archive"))
        .expect("archived position");
    set_reading_position(&path_a, &alpha_a.content_hash, 0.4, 100);
    let bytes = api_a.export_backup().expect("export");

    let (_dir_b, path_b, api_b) = database_at();
    let source_b = source(&["alpha", "gamma"]);
    api_b.scan(&source_b).expect("scan destination library");
    let alpha_b = book(&api_b, "alpha");
    api_b
        .set_reading_state(alpha_b.id, ReadingStatus::Reading, 0.7, Some("local"))
        .expect("local position");
    set_reading_position(&path_b, &alpha_b.content_hash, 0.7, 200);
    let local_label = api_b.create_label("Local", OXBLOOD).expect("local label");
    api_b
        .attach_label(alpha_b.id, local_label.id)
        .expect("local label link");

    let preview = api_b.preview_backup(&bytes).expect("preview");
    assert_eq!(preview.matched, 1, "alpha's bytes already exist");
    assert_eq!(preview.new, 1, "beta is missing");

    let report = api_b
        .import_backup(&bytes, ImportMode::Merge)
        .expect("merge import");
    assert_eq!(report.matched, 1);
    assert_eq!(report.new, 1);
    assert_eq!(report.skipped, 1, "the local position is newer");
    assert_eq!(report.replaced, 0, "merge never replaces");

    let titles = api_b
        .list_books()
        .expect("books after merge")
        .into_iter()
        .map(|book| book.title)
        .collect::<Vec<_>>();
    assert_eq!(titles, vec!["alpha", "gamma", "beta"]);
    let state = api_b.reading_state(alpha_b.id).expect("local state kept");
    assert_eq!(state.progress, 0.7);
    assert_eq!(state.locator.as_deref(), Some("local"));
    assert_eq!(
        api_b.labels_for_book(alpha_b.id).expect("labels").len(),
        1,
        "local labels survive a merge"
    );
}

#[test]
fn merge_accepts_a_newer_archived_position() {
    let (_dir_a, path_a, api_a) = database_at();
    let source_a = source(&["alpha"]);
    api_a.scan(&source_a).expect("scan source");
    let alpha_a = book(&api_a, "alpha");
    api_a
        .set_reading_state(alpha_a.id, ReadingStatus::Reading, 0.8, Some("newer"))
        .expect("archived position");
    set_reading_position(&path_a, &alpha_a.content_hash, 0.8, 300);
    let bytes = api_a.export_backup().expect("export");

    let (_dir_b, path_b, api_b) = database_at();
    api_b.scan(&source(&["alpha"])).expect("scan destination");
    let alpha_b = book(&api_b, "alpha");
    api_b
        .set_reading_state(alpha_b.id, ReadingStatus::Reading, 0.2, Some("older"))
        .expect("local position");
    set_reading_position(&path_b, &alpha_b.content_hash, 0.2, 50);

    let report = api_b
        .import_backup(&bytes, ImportMode::Merge)
        .expect("merge");
    assert_eq!(report.skipped, 0);
    let state = api_b.reading_state(alpha_b.id).expect("state");
    assert_eq!(state.progress, 0.8);
    assert_eq!(state.locator.as_deref(), Some("newer"));
}

#[test]
fn replace_clears_catalogue_extras_but_never_touches_book_files() {
    let (_dir_a, _path_a, api_a) = database_at();
    let source_a = source(&["alpha", "beta"]);
    api_a.scan(&source_a).expect("scan source");
    let alpha_a = book(&api_a, "alpha");
    let label = api_a.create_label("Gothic", OXBLOOD).expect("create label");
    api_a.attach_label(alpha_a.id, label.id).expect("attach");
    api_a.set_shelf_capacity(9).expect("source capacity");
    let bytes = api_a.export_backup().expect("export");

    let (_dir_b, _path_b, api_b) = database_at();
    let source_b = source(&["alpha", "gamma"]);
    let gamma_before = source_b.bytes("gamma.epub");
    api_b.scan(&source_b).expect("scan destination");
    let extra = api_b.create_label("Local", OXBLOOD).expect("local label");
    let alpha_b = book(&api_b, "alpha");
    api_b
        .attach_label(alpha_b.id, extra.id)
        .expect("local link");
    api_b.set_shelf_capacity(2).expect("destination capacity");
    api_b
        .set_library_folder("content://tree/local", "Local Books")
        .expect("local folder grant");

    let report = api_b
        .import_backup(&bytes, ImportMode::Replace)
        .expect("replace import");
    assert_eq!(report.matched, 1);
    assert_eq!(report.new, 1);
    assert_eq!(report.replaced, 2, "both local books were cleared");

    let titles = api_b
        .list_books()
        .expect("books after replace")
        .into_iter()
        .map(|book| book.title)
        .collect::<Vec<_>>();
    assert_eq!(titles, vec!["alpha", "beta"], "the archive wins");
    let label_names = api_b
        .list_labels()
        .expect("labels")
        .into_iter()
        .map(|label| label.name)
        .collect::<Vec<_>>();
    assert_eq!(label_names, vec!["Gothic"], "local labels are replaced");
    assert_eq!(api_b.shelf_capacity().expect("capacity"), 9);
    assert_eq!(
        api_b.library_folder().expect("folder grant"),
        Some("content://tree/local".to_owned()),
        "the device-local SAF grant survives a restore"
    );
    assert_eq!(
        source_b.bytes("gamma.epub"),
        gamma_before,
        "the removed catalogue row does not delete the file"
    );
}

#[test]
fn corrupt_older_and_wrong_schema_archives_are_rejected() {
    let (_dir, api) = database();
    api.scan(&source(&["alpha"])).expect("scan");
    let good = api.export_backup().expect("export");

    let error = api
        .import_backup(b"this is not a zip", ImportMode::Merge)
        .expect_err("corrupt archive");
    assert_eq!(error.code, "archive_corrupt");

    let error = api
        .import_backup(br#"{"kind":"pocketlibrary-backup"}"#, ImportMode::Merge)
        .expect_err("truncated manifest");
    assert_eq!(error.code, "archive_corrupt");
    let truncated = archive_with_manifest(r#"{"kind":"pocketlibrary-backup"}"#);
    let error = api
        .import_backup(&truncated, ImportMode::Merge)
        .expect_err("truncated manifest");
    assert_eq!(error.code, "archive_corrupt");

    let wrong_kind = rewrite_manifest(&good, |manifest| {
        manifest["kind"] = Value::String("some-other-app".to_owned());
    });
    let error = api
        .import_backup(&wrong_kind, ImportMode::Merge)
        .expect_err("wrong schema");
    assert_eq!(error.code, "archive_wrong_schema");

    for version in [0, 999] {
        let wrong_version = rewrite_manifest(&good, |manifest| {
            manifest["schemaVersion"] = Value::from(version);
        });
        let error = api
            .import_backup(&wrong_version, ImportMode::Merge)
            .expect_err("unsupported version");
        assert_eq!(
            error.code, "archive_unsupported_version",
            "version {version}"
        );
    }
}

#[test]
fn an_archive_without_covers_restores_the_catalogue_cleanly() {
    let (_dir, api) = database();
    api.scan(&source(&["alpha"])).expect("scan");
    let alpha = book(&api, "alpha");
    let cover_path = alpha.cover_path.expect("scan wrote a cover");
    std::fs::remove_file(&cover_path).expect("remove cached cover");

    let bytes = api.export_backup().expect("export without cover");
    assert!(
        !entry_names(&bytes)
            .iter()
            .any(|name| name.starts_with("covers/")),
        "no cover entry is written when the cache is missing"
    );
    assert!(manifest(&bytes)["books"][0]["coverFile"].is_null());

    let (_restored_dir, restored) = database();
    restored
        .import_backup(&bytes, ImportMode::Replace)
        .expect("restore without cover");
    let restored_alpha = book(&restored, "alpha");
    assert!(
        restored_alpha.cover_path.is_none(),
        "a missing optional cover restores as no cached cover"
    );
}
