//! Project real engine output through the production cache helpers.
//!
//! `spine-host run` writes the seven runtime files. This test feeds those
//! directories through the same `artifact_from_dir` / `install_artifact` /
//! `cached_strips` path the app uses, so a projection bug cannot hide behind a
//! hand-written fixture.
//!
//! Set `SPINE_REPRO_DIR` to a directory of `spine-host` outputs (one
//! subdirectory per book) to run it. Without the variable the test is a no-op.

use std::path::{Path, PathBuf};

use pocketlibrary_core::spine_cache::SpineCache;
use pocketlibrary_core::spine_strip::{
    apply_cached_strips, artifact_book_ids, artifact_from_dir, cached_strips, install_artifact,
    shelf_book_ids,
};

fn raw_root() -> Option<PathBuf> {
    let root = std::env::var_os("SPINE_REPRO_DIR").map(PathBuf::from)?;
    root.is_dir().then_some(root)
}

fn book_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<_> = std::fs::read_dir(root)
        .expect("read repro dir")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.join("run.json").is_file())
        .collect();
    dirs.sort();
    dirs
}

#[test]
fn real_engine_output_projects_through_the_production_cache() {
    let Some(root) = raw_root() else {
        eprintln!("SPINE_REPRO_DIR not set; skipping the real projection test");
        return;
    };
    let temp = tempfile::tempdir().expect("tempdir");
    let cache = SpineCache::with_limit(temp.path().join("spine/books"), u64::MAX);
    let mut expected = Vec::new();

    for (index, dir) in book_dirs(&root).into_iter().enumerate() {
        let book_id = index as i64 + 1;
        let artifact = artifact_from_dir(&dir, book_id).expect("artifact from engine files");
        let key = format!("repro-{book_id}");
        let staged = cache.staged_dir(&key);
        std::fs::create_dir_all(&staged).expect("staged dir");
        for entry in std::fs::read_dir(&dir).expect("read engine output") {
            let entry = entry.expect("engine file");
            if entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
            {
                std::fs::copy(entry.path(), staged.join(entry.file_name()))
                    .expect("stage engine file");
            }
        }
        install_artifact(&cache, &key, &staged, &artifact).expect("install into the real cache");
        expected.push((book_id, artifact));
    }
    assert!(!expected.is_empty(), "the repro directory had no books");

    let report = cached_strips(cache.books_dir());
    println!(
        "projection: scanned={} projected={} skipped={} strips={}",
        report.scanned,
        report.projected,
        report.skipped,
        report.strips.len()
    );
    for strip in &report.strips {
        println!(
            "  book {} verdict={} bytes={}",
            strip.book_id,
            strip.verdict,
            strip.spine_data_url.len()
        );
    }
    // Ask the production artifact/shelf definitions too: a real pass artifact
    // is both present and shelf-eligible.
    println!(
        "artifacts: {:?} shelf: {:?}",
        artifact_book_ids(cache.books_dir()),
        shelf_book_ids(cache.books_dir())
    );

    assert_eq!(report.scanned, expected.len());
    assert_eq!(
        report.projected,
        expected.len(),
        "every real entry projects"
    );
    assert_eq!(report.skipped, 0);

    if let Some(path) = std::env::var_os("SPINE_REPRO_STRIPS") {
        let strips: Vec<_> = report
            .strips
            .iter()
            .map(|strip| {
                serde_json::json!({
                    "bookId": strip.book_id,
                    "verdict": strip.verdict,
                    "spineDataUrl": strip.spine_data_url,
                })
            })
            .collect();
        std::fs::write(
            path,
            serde_json::to_vec_pretty(&strips).expect("serialise strips"),
        )
        .expect("write strips");
    }

    // And the list_books merge: a pass/review strip reaches the payload.
    let mut books: Vec<pocketlibrary_core::Book> = report
        .strips
        .iter()
        .map(|strip| pocketlibrary_core::Book {
            id: strip.book_id,
            content_hash: String::new(),
            quick_key: None,
            path: String::new(),
            format: pocketlibrary_core::BookFormat::Epub,
            title: String::new(),
            authors: Vec::new(),
            series: None,
            language: None,
            description: None,
            publisher: None,
            published_date: None,
            identifier: None,
            page_count: None,
            spine_style: pocketlibrary_core::SpineStyle::Wrap,
            spine_data_url: None,
            cover_path: None,
            cover_source: None,
            file_cover_path: None,
            file_cover_source: None,
            file_description: None,
            added_at: 0,
            shelf_id: None,
            slot_index: None,
            reading_status: pocketlibrary_core::ReadingStatus::Unread,
            labels: Vec::new(),
        })
        .collect();
    apply_cached_strips(&mut books, &report.strips);
    for book in &books {
        let verdict = report
            .strips
            .iter()
            .find(|strip| strip.book_id == book.id)
            .map(|strip| strip.verdict.as_str())
            .unwrap_or("");
        if verdict == "fallback" {
            assert!(book.spine_data_url.is_none());
        } else {
            assert!(
                book.spine_data_url.is_some(),
                "book {} has a strip",
                book.id
            );
        }
    }
}
