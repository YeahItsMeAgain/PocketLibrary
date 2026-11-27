//! Highlights and notes through the transport-agnostic command API.
//!
//! The locator is deliberately opaque to core: these tests prove CRUD,
//! bookmark coexistence and that the backup archive carries every field the
//! reader needs to repair an anchor.

mod common;

use std::io::{Cursor, Read};

use common::{FakeDir, database};
use pocketlibrary_core::{AnnotationKind, ImportMode};
use serde_json::Value;
use zip::ZipArchive;

const LOCATOR: &str = r#"{"v":2,"href":"OEBPS/chapter1.xhtml","locations":{"fragments":["epubcfi(/6/4!/4,/2,/8/1:0)"]},"text":{"highlight":"The lamp was lit"},"selectors":{"quote":{"type":"TextQuoteSelector","exact":"The lamp was lit"},"position":{"type":"TextPositionSelector","start":0,"end":16}}}"#;

fn source() -> FakeDir {
    FakeDir::new().file("annotated.epub")
}

fn book_id(api: &pocketlibrary_core::Api) -> i64 {
    api.list_books().expect("books")[0].id
}

fn manifest(bytes: &[u8]) -> Value {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).expect("archive is a zip");
    let mut entry = archive.by_name("manifest.json").expect("manifest exists");
    let mut text = String::new();
    entry.read_to_string(&mut text).expect("read manifest");
    serde_json::from_str(&text).expect("manifest is JSON")
}

#[test]
fn highlights_and_notes_create_list_update_and_delete() {
    let (_dir, api) = database();
    api.scan(&source()).expect("scan one book");
    let id = book_id(&api);

    assert!(api.list_annotations(id).expect("empty list").is_empty());
    assert_eq!(
        api.create_annotation(id, AnnotationKind::Highlight, Some("#7f9a7a"), None, " ")
            .expect_err("empty locator")
            .code,
        "invalid_reader_locator"
    );
    assert_eq!(
        api.create_annotation(id, AnnotationKind::Bookmark, None, None, LOCATOR)
            .expect_err("bookmarks have their own route")
            .code,
        "invalid_annotation_kind"
    );

    let highlight = api
        .create_annotation(
            id,
            AnnotationKind::Highlight,
            Some("#7f9a7a"),
            None,
            LOCATOR,
        )
        .expect("create highlight");
    assert_eq!(highlight.kind, AnnotationKind::Highlight);
    assert_eq!(highlight.colour.as_deref(), Some("#7f9a7a"));
    assert_eq!(highlight.note, None);

    let note = api
        .create_annotation(
            id,
            AnnotationKind::Highlight,
            Some("#7f9a7a"),
            Some("  the rain  "),
            LOCATOR,
        )
        .expect("create note");
    assert_eq!(note.kind, AnnotationKind::Note, "note text makes a note");
    assert_eq!(note.note.as_deref(), Some("the rain"));

    let listed = api.list_annotations(id).expect("list");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, highlight.id);
    assert_eq!(listed[1].id, note.id);

    let updated = api
        .update_annotation(id, highlight.id, None, Some("a later thought"), None)
        .expect("attach a note");
    assert_eq!(updated.kind, AnnotationKind::Note);
    assert_eq!(updated.note.as_deref(), Some("a later thought"));
    assert_eq!(
        updated.colour.as_deref(),
        Some("#7f9a7a"),
        "colour is kept when not supplied"
    );

    let repaired =
        r#"{"v":2,"href":"OEBPS/chapter2.xhtml","text":{"highlight":"The lamp was lit"}}"#
            .to_string();
    let updated = api
        .update_annotation(id, highlight.id, Some("#7d91a8"), None, Some(&repaired))
        .expect("repair locator and recolour");
    assert_eq!(updated.colour.as_deref(), Some("#7d91a8"));
    assert_eq!(updated.locator, repaired);
    assert_eq!(updated.kind, AnnotationKind::Note, "repair keeps note kind");

    let cleared = api
        .update_annotation(id, highlight.id, None, Some(""), None)
        .expect("clear note");
    assert_eq!(cleared.kind, AnnotationKind::Highlight);
    assert_eq!(cleared.note, None);

    api.delete_annotation(id, note.id).expect("delete note");
    let remaining = api.list_annotations(id).expect("remaining");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, highlight.id);
    assert_eq!(
        api.delete_annotation(id, note.id)
            .expect_err("already deleted")
            .code,
        "annotation_not_found"
    );
}

#[test]
fn bookmarks_and_annotations_coexist_without_bleeding() {
    let (_dir, api) = database();
    api.scan(&source()).expect("scan one book");
    let id = book_id(&api);

    let highlight = api
        .create_annotation(
            id,
            AnnotationKind::Highlight,
            Some("#b77a7e"),
            None,
            LOCATOR,
        )
        .expect("highlight");
    let bookmark = api
        .add_bookmark(id, r#"{"v":1,"cfi":"epubcfi(/6/2!)"}"#)
        .expect("bookmark");

    assert_eq!(api.list_annotations(id).expect("annotations").len(), 1);
    assert_eq!(api.list_bookmarks(id).expect("bookmarks").len(), 1);

    api.delete_annotation(id, highlight.id)
        .expect("delete highlight");
    assert_eq!(
        api.list_bookmarks(id).expect("bookmark survives").len(),
        1,
        "deleting a highlight must not delete a bookmark"
    );

    api.delete_bookmark(id, bookmark.id)
        .expect("delete bookmark");
    assert!(api.list_annotations(id).expect("annotations").is_empty());
}

#[test]
fn backup_carries_annotations_and_restores_them() {
    let (_dir, api) = database();
    api.scan(&source()).expect("scan one book");
    let id = book_id(&api);
    let created = api
        .create_annotation(
            id,
            AnnotationKind::Note,
            Some("#7f9a7a"),
            Some("pencil in the margin"),
            LOCATOR,
        )
        .expect("create note");

    let bytes = api.export_backup().expect("export");
    let manifest = manifest(&bytes);
    let annotations = manifest["annotations"].as_array().expect("annotations");
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0]["kind"], "note");
    assert_eq!(annotations[0]["colour"], "#7f9a7a");
    assert_eq!(annotations[0]["note"], "pencil in the margin");
    assert_eq!(annotations[0]["locator"], LOCATOR);

    let (_restored_dir, restored) = database();
    restored
        .import_backup(&bytes, ImportMode::Replace)
        .expect("restore");
    let restored_id = book_id(&restored);
    let listed = restored.list_annotations(restored_id).expect("restored");
    assert_eq!(listed.len(), 1);
    assert!(listed[0].id >= 1);
    assert_eq!(listed[0].kind, AnnotationKind::Note);
    assert_eq!(listed[0].note.as_deref(), Some("pencil in the margin"));
    assert_eq!(listed[0].locator, LOCATOR);
    assert_eq!(listed[0].created_at, created.created_at);
}
