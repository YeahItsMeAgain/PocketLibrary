//! OCR a single image with a chosen det/rec pair, for small-spine sensitivity tests.
//!
//! Usage: ocr_eval --det D --rec R --keys K --image IMG [--scale 4]

use anyhow::Result;
use std::path::Path;
use v8_app::ocr::Ocr;
use v8_app::ops;

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let det = flag(&args, "--det").expect("--det");
    let rec = flag(&args, "--rec").expect("--rec");
    let keys = flag(&args, "--keys").expect("--keys");
    let image = flag(&args, "--image").expect("--image");
    let scale: u32 = flag(&args, "--scale").and_then(|v| v.parse().ok()).unwrap_or(4);
    let mut ocr = Ocr::new(det, rec, keys)?;
    let img = image::open(Path::new(image))?.to_rgb8();
    let big = ops::resize_rgb(&img, img.width() * scale, img.height() * scale, image::imageops::FilterType::Triangle);
    let hits = ocr.texts(&big, 0.5)?;
    let out: Vec<_> = hits
        .iter()
        .map(|h| serde_json::json!({"text": h.text, "conf": (h.conf * 1000.0).round() / 1000.0}))
        .collect();
    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
