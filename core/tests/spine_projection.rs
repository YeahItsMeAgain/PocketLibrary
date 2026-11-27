//! The real generation → cache → shelf projection path, on a headless host.
//!
//! The previous fix was tested only with a hand-written fixture, so a wrong
//! cache root or a strip that never reached `artifact.json` could still ship.
//! This test runs the actual ONNX pipeline when the model bundle and ONNX
//! Runtime are present (the same skip pattern as `spine/tests/pipeline.rs`),
//! stores the result with the production cache helpers, then projects it from
//! the app-data root a launch would scan.

use std::path::{Path, PathBuf};
use std::sync::Once;

use pocketlibrary_core::spine_cache::{SpineCache, cache_key};
use pocketlibrary_core::spine_strip::{artifact_from_dir, cached_strips, install_artifact};
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

/// A cover with real structure (bands, a light window) so the engine has text
/// and edges to work with rather than a flat colour.
fn write_cover(path: &Path) {
    let mut image = image::RgbImage::new(600, 900);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let stripe = (x / 40) % 2 == 0;
        let band = y < 120 || (240..300).contains(&y) || (600..660).contains(&y);
        *pixel = if band {
            image::Rgb([32, 18, 40])
        } else if stripe {
            image::Rgb([176, 92, 58])
        } else {
            image::Rgb([204, 150, 92])
        };
    }
    image::save_buffer(
        path,
        image.as_raw(),
        image.width(),
        image.height(),
        image::ColorType::Rgb8,
    )
    .expect("write cover");
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

    let cover = temp.path().join("cover.jpg");
    write_cover(&cover);

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
    let key = cache_key("content-hash", "cover-hash", 320, "spine-v1");
    let staged = cache.staged_dir(&key);
    engine
        .generate(
            &BookInput {
                cover,
                title: "The Real Path".to_owned(),
                author: "A. Tester".to_owned(),
                pages: 320,
            },
            &staged,
        )
        .expect("generate the spine");

    let artifact = artifact_from_dir(&staged, 42).expect("artifact from runtime files");
    assert_eq!(artifact.book_id, 42);
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
    assert_eq!(strip.book_id, 42);
    assert!(strip.spine_data_url.starts_with("data:image/jpeg;base64,"));

    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&strip.spine_data_url["data:image/jpeg;base64,".len()..])
        .expect("base64 strip");
    let image = image::load_from_memory(&bytes).expect("decode strip");
    assert_eq!((image.width(), image.height()), (SPINE_W, SPINE_H));
}
