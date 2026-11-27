//! The real generation → cache → shelf projection path, on a headless host.
//!
//! The previous fix was tested only with a hand-written fixture, so a wrong
//! cache root or a strip that never reached `artifact.json` could still ship.
//! This test runs the actual ONNX pipeline when the model bundle and ONNX
//! Runtime are present (the same skip pattern as `spine/tests/pipeline.rs`),
//! stores the result with the production cache helpers, then projects and
//! merges it into a real catalogue book the way `list_books` does.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Once;

use common::{FakeDir, database};
use pocketlibrary_core::SpineStyle;
use pocketlibrary_core::spine_cache::{SpineCache, cache_key};
use pocketlibrary_core::spine_strip::{
    apply_cached_strips, artifact_from_dir, cached_strips, install_artifact,
};
use pocketlibrary_spine::{BookInput, Engine, Models, SPINE_H, SPINE_W};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("core lives at <repo>/core")
        .to_path_buf()
}

fn model_bundle() -> Option<PathBuf> {
    let models = repo().join(".scratch/spine-cover-art-prototype/v8-app/models");
    (models.join("det.onnx").is_file()
        && models.join("rec.onnx").is_file()
        && models.join("keys.txt").is_file())
    .then_some(models)
}

fn migan_model() -> Option<PathBuf> {
    let path = repo().join(
        ".scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx",
    );
    path.is_file().then_some(path)
}

fn set_ort() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        if std::env::var_os("ORT_DYLIB_PATH").is_some() {
            return;
        }
        let candidates = [
            "/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0",
            "/tmp/opencode/ortlib/libonnxruntime.so",
            "/usr/lib/libonnxruntime.so",
        ];
        if let Some(found) = candidates.iter().find(|path| Path::new(path).is_file()) {
            // Test-only, before any engine is built in this process.
            unsafe { std::env::set_var("ORT_DYLIB_PATH", found) };
        }
    });
}

#[test]
fn a_real_generation_projects_a_52x236_strip_from_the_app_data_root() {
    let Some(models) = model_bundle() else {
        eprintln!("spine models missing; skipping real generation test");
        return;
    };
    set_ort();

    let temp = tempfile::tempdir().expect("tempdir");
    let app_data = temp.path().join("app-data");
    std::fs::create_dir_all(&app_data).expect("app data dir");

    // A real catalogue row, so the book arrives with the same fields the
    // `list_books` command serialises.
    let (_db_dir, api) = database();
    let source = FakeDir::new().file("the-real-path.epub");
    api.scan(&source).expect("scan the fixture book");
    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(
        book.spine_style,
        SpineStyle::Wrap,
        "a book with no stored style defaults to Wrap"
    );
    let cover = PathBuf::from(
        book.cover_path
            .as_deref()
            .expect("the scan produced a cover for generation"),
    );

    let engine = Engine::new(Models {
        det: models.join("det.onnx"),
        rec: models.join("rec.onnx"),
        keys: models.join("keys.txt"),
        migan: migan_model(),
    })
    .expect("engine with the real models");

    // The service stages `<app data>/spine/books/.<key>.tmp-<pid>` and installs
    // it as `<app data>/spine/books/<key>`. Mirror that exactly.
    let cache = SpineCache::new(&app_data);
    assert_eq!(
        cache.books_dir(),
        app_data.join("spine").join("books"),
        "generation and projection share the same app-data root"
    );
    let key = cache_key(&book.content_hash, "cover-hash", 320, "spine-v1");
    let staged = cache.staged_dir(&key);
    engine
        .generate(
            &BookInput {
                cover,
                title: book.title.clone(),
                author: book.authors.first().cloned().unwrap_or_default(),
                pages: 320,
            },
            &staged,
        )
        .expect("generate the spine");

    let artifact = artifact_from_dir(&staged, book.id).expect("artifact from runtime files");
    install_artifact(&cache, &key, &staged, &artifact).expect("install the cache entry");
    assert!(cache.entry_dir(&key).join("artifact.json").is_file());

    // A new launch only has the app-data root. It must find the entry and
    // project the 52 x 236 data URL, not an empty list.
    let report = cached_strips(cache.books_dir());
    assert_eq!(report.scanned, 1);
    assert_eq!(report.projected, 1);
    assert_eq!(report.skipped, 0);
    assert_eq!(report.strips.len(), 1);
    let strip = &report.strips[0];
    assert_eq!(strip.book_id, book.id);
    assert!(strip.spine_data_url.starts_with("data:image/jpeg;base64,"));

    // The shelf payload carries that strip with the book, exactly as
    // `list_books` merges it, so the wall never waits for hydration events.
    let mut books = vec![book];
    apply_cached_strips(&mut books, &report.strips);
    let merged = &books[0];
    assert_eq!(merged.spine_style, SpineStyle::Wrap);
    let shelf_url = merged
        .spine_data_url
        .as_deref()
        .expect("the list payload carries the cached strip");
    assert_eq!(shelf_url, strip.spine_data_url);

    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&shelf_url["data:image/jpeg;base64,".len()..])
        .expect("base64 shelf strip");
    let image = image::load_from_memory(&bytes).expect("decode shelf strip");
    assert_eq!((image.width(), image.height()), (SPINE_W, SPINE_H));
}
