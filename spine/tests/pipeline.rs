//! Host tests. The pure tests always run. The route tests load the real
//! models through ONNX Runtime when they are present (this repo's `.scratch`
//! evidence tree) and skip otherwise, so `cargo test` stays green on a clean
//! checkout without the 39 MB bundle.

use image::{GrayImage, RgbImage};
use pocketlibrary_spine::crop;
use pocketlibrary_spine::fallback;
use pocketlibrary_spine::ops;
use pocketlibrary_spine::{BookInput, Engine, Models, Route, Verdict};
use std::path::{Path, PathBuf};
use std::sync::Once;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate lives at <repo>/spine")
        .to_path_buf()
}

fn models_dir() -> PathBuf {
    repo().join(".scratch/spine-cover-art-prototype/v8-app/models")
}

fn migan_model() -> PathBuf {
    repo().join(
        ".scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx",
    )
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
        if let Some(p) = candidates.iter().find(|p| Path::new(p).is_file()) {
            std::env::set_var("ORT_DYLIB_PATH", p);
        }
    });
}

fn host_engine(with_migan: bool) -> Option<Engine> {
    let models = models_dir();
    if !models.join("det.onnx").is_file()
        || !models.join("rec.onnx").is_file()
        || !models.join("keys.txt").is_file()
    {
        eprintln!("models missing; skipping host route test");
        return None;
    }
    set_ort();
    let migan = with_migan.then(migan_model);
    if let Some(m) = &migan {
        if !m.is_file() {
            eprintln!("MI-GAN missing; skipping inpaint route test");
            return None;
        }
    }
    match Engine::new(Models {
        det: models.join("det.onnx"),
        rec: models.join("rec.onnx"),
        keys: models.join("keys.txt"),
        migan,
    }) {
        Ok(e) => Some(e),
        Err(e) => {
            eprintln!("engine unavailable ({e:#}); skipping host route test");
            None
        }
    }
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("spine-test-{tag}-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn book(cover: PathBuf, title: &str, author: &str, pages: u32) -> BookInput {
    BookInput {
        cover,
        title: title.to_string(),
        author: author.to_string(),
        pages,
    }
}

fn assert_contract_files(dir: &Path) {
    let mut got: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    got.sort();
    let want = vec![
        "art.jpg",
        "fallback-spine.jpg",
        "mask.png",
        "qa.json",
        "run.json",
        "source.jpg",
        "spine-2x.jpg",
    ];
    assert_eq!(
        got, want,
        "generate must write exactly the seven contract files"
    );

    let spine = image::open(dir.join("spine-2x.jpg")).unwrap();
    assert_eq!(spine.width(), 104);
    assert_eq!(spine.height(), 472);
    let fallback = image::open(dir.join("fallback-spine.jpg")).unwrap();
    assert_eq!((fallback.width(), fallback.height()), (52, 236));
    let mask = image::open(dir.join("mask.png")).unwrap();
    assert_eq!(mask.color(), image::ColorType::L8);

    let run: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("run.json")).unwrap()).unwrap();
    let crop = run["final"]["crop_box_work"]
        .as_array()
        .expect("run.json keeps final.crop_box_work");
    assert_eq!(crop.len(), 4);
    assert!(crop.iter().all(|v| v.as_u64().is_some()));
    let qa: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("qa.json")).unwrap()).unwrap();
    assert!(qa["decision"]["verdict"].is_string());
}

#[test]
fn lab_roundtrip_is_close() {
    for rgb in [
        [216u8, 21, 25],
        [188, 187, 185],
        [20, 80, 140],
        [0, 0, 0],
        [255, 255, 255],
    ] {
        let lab = ops::rgb_to_lab(rgb);
        let back = ops::lab_to_rgb(lab);
        for c in 0..3 {
            let d = (back[c] as i32 - rgb[c] as i32).abs();
            assert!(d <= 3, "rgb {rgb:?} -> lab {lab:?} -> {back:?} (d={d})");
        }
    }
}

#[test]
fn quad_angle_axis_aligned_is_zero() {
    let b = [[10.0, 20.0], [110.0, 20.0], [110.0, 70.0], [10.0, 70.0]];
    assert!(ops::quad_angle(&b).abs() < 0.001);
}

#[test]
fn connected_components_counts_islands() {
    let mut m = vec![0u8; 20 * 20];
    for y in 2..8 {
        for x in 2..8 {
            m[y * 20 + x] = 255;
        }
    }
    for y in 12..18 {
        for x in 12..18 {
            m[y * 20 + x] = 255;
        }
    }
    let (labels, comps) = ops::connected_components(&m, 20, 20);
    assert_eq!(comps.len(), 2);
    assert_eq!(comps.iter().map(|c| c.area).sum::<usize>(), 72);
    assert!(labels[3 * 20 + 3] > 0);
}

#[test]
fn integral_sum_matches_manual() {
    let src: Vec<f32> = (0..100).map(|i| i as f32).collect();
    let ii = ops::Integral::new(&src, 10, 10);
    let got = ii.sum(2, 3, 6, 7);
    let mut want = 0.0;
    for y in 3..7 {
        for x in 2..6 {
            want += src[y * 10 + x];
        }
    }
    assert!((got - want as f64).abs() < 1e-9);
}

#[test]
fn fallback_spine_is_52x236() {
    let s = fallback::fallback_spine("The Hound of the Baskervilles", "Arthur Conan Doyle");
    assert_eq!(s.dimensions(), (52, 236));
}

#[test]
fn crop_search_finds_in_bounds_windows() {
    let mut img = RgbImage::new(200, 400);
    for (x, y, p) in img.enumerate_pixels_mut() {
        let v = ((x * 3 + y) % 255) as u8;
        *p = image::Rgb([v, v / 2, 255 - v]);
    }
    let mask = GrayImage::new(200, 400);
    let cands = crop::find_crops(&img, Some(&mask), 0.55);
    assert!(!cands.is_empty());
    let c = &cands[0];
    assert!(c.box_[0] + c.box_[2] <= 200);
    assert!(c.box_[1] + c.box_[3] <= 400);
}

#[test]
fn missing_model_is_an_error() {
    let missing = std::env::temp_dir().join("definitely-not-a-spine-model.onnx");
    let err = Engine::new(Models {
        det: missing.clone(),
        rec: missing.clone(),
        keys: missing.clone(),
        migan: None,
    })
    .err()
    .expect("missing det model must fail");
    assert!(format!("{err:#}").contains("not found"), "{err:#}");
}

#[test]
fn missing_cover_is_an_error() {
    let Some(engine) = host_engine(false) else {
        return;
    };
    let out = TempDir::new("missing-cover");
    let err = engine
        .generate(
            &book(
                out.path().join("no-such-cover.jpg"),
                "Missing",
                "Nobody",
                100,
            ),
            out.path(),
        )
        .expect_err("missing cover must fail");
    assert!(format!("{err:#}").contains("cover not found"), "{err:#}");
}

#[test]
fn crop_route_end_to_end() {
    let Some(engine) = host_engine(false) else {
        return;
    };
    let cover = repo().join(".scratch/spine-cover-art-prototype/reproducibility/book/cover.jpg");
    if !cover.is_file() {
        eprintln!("crop cover missing; skipping");
        return;
    }
    let out = TempDir::new("crop");
    let report = engine
        .generate(
            &book(
                cover,
                "The Hound of the Baskervilles",
                "Arthur Conan Doyle",
                170,
            ),
            out.path(),
        )
        .expect("crop route");
    assert_eq!(report.route, Route::Crop);
    assert_eq!(report.verdict, Verdict::Pass);
    assert!(report.mask_pct < 20.0, "mask {}%", report.mask_pct);
    assert_eq!(report.timings.inpaint_migan, 0.0);
    assert!(report.run["final"]["crop_box_work"].is_array());
    assert_contract_files(out.path());
}

#[test]
fn inpaint_route_end_to_end_uses_migan() {
    let Some(engine) = host_engine(true) else {
        return;
    };
    let cover = repo().join(".scratch/spine-cover-art-prototype/v6/assets/modern/rps-cover.jpg");
    if !cover.is_file() {
        eprintln!("inpaint cover missing; skipping");
        return;
    }
    let out = TempDir::new("inpaint");
    let report = engine
        .generate(
            &book(cover, "Rock Paper Scissors", "Alice Feeney", 320),
            out.path(),
        )
        .expect("inpaint route");
    assert_eq!(report.route, Route::Inpaint);
    assert!(report.mask_pct > 20.0, "mask {}%", report.mask_pct);
    assert!(
        report.timings.inpaint_migan > 0.0,
        "MI-GAN did not run: {:?}",
        report.timings
    );
    assert_eq!(report.verdict, Verdict::Review);
    assert_contract_files(out.path());
}

#[test]
fn inpaint_route_without_migan_still_writes_seven_files() {
    let Some(engine) = host_engine(false) else {
        return;
    };
    let cover = repo().join(".scratch/spine-cover-art-prototype/v6/assets/modern/rps-cover.jpg");
    if !cover.is_file() {
        eprintln!("inpaint cover missing; skipping");
        return;
    }
    let out = TempDir::new("inpaint-flat");
    let report = engine
        .generate(
            &book(cover, "Rock Paper Scissors", "Alice Feeney", 320),
            out.path(),
        )
        .expect("flat inpaint route");
    assert_eq!(report.route, Route::Inpaint);
    assert_eq!(report.timings.inpaint_migan, 0.0);
    assert_contract_files(out.path());
}
