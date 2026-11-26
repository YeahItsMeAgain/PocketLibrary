use image::{GrayImage, RgbImage};
use v8_app::crop;
use v8_app::fallback;
use v8_app::ops;
use v8_app::pipeline::{BookInput, Pipeline};

#[test]
fn lab_roundtrip_is_close() {
    for rgb in [[216u8, 21, 25], [188, 187, 185], [20, 80, 140], [0, 0, 0], [255, 255, 255]] {
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
    assert!(c.box_[0] as u32 + c.box_[2] <= 200);
    assert!(c.box_[1] as u32 + c.box_[3] <= 400);
}

/// End-to-end host test. Run with:
/// `ORT_DYLIB_PATH=... cargo test --release -- --ignored pipeline_end_to_end`
#[test]
#[ignore]
fn pipeline_end_to_end_hound() {
    if !std::path::Path::new("models/det.onnx").exists() {
        eprintln!("models missing; skipping");
        return;
    }
    let mut p = Pipeline::new(
        "models/det.onnx",
        "models/rec.onnx",
        "models/keys.txt",
        None,
        720,
        1600,
    )
    .expect("pipeline");
    p.python_assets = Some("../v8-auto/assets".into());
    let input = BookInput {
        cover: "../reproducibility/book/cover.jpg".into(),
        slug: "test-hound".into(),
        title: "The Hound of the Baskervilles".into(),
        author: "Arthur Conan Doyle".into(),
        pages: 170,
    };
    let out = std::env::temp_dir().join("v8-app-test-out");
    let report = p.run(&input, &out).expect("run");
    assert_eq!(report["verdict"], "pass");
    assert_eq!(report["route"], "text-free crop");
    assert!(report["mask"]["coverage_pct"].as_f64().unwrap() < 20.0);
}
