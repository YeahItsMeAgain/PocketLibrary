//! Detect-only probe for small-spine text sensitivity.
//! Usage: det_eval --det D --image IMG [--scale 4] [--limit 960] [--type max]

use anyhow::Result;
use std::path::Path;
use v8_app::detect::Detector;
use v8_app::ops;

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let model = flag(&args, "--det").expect("--det");
    let image = flag(&args, "--image").expect("--image");
    let scale: u32 = flag(&args, "--scale").and_then(|v| v.parse().ok()).unwrap_or(4);
    let limit: u32 = flag(&args, "--limit").and_then(|v| v.parse().ok()).unwrap_or(960);
    let typ = flag(&args, "--type").unwrap_or("max");
    let mut det = Detector::new(model, limit, typ)?;
    let img = image::open(Path::new(image))?.to_rgb8();
    let big = ops::resize_rgb(&img, img.width() * scale, img.height() * scale, image::imageops::FilterType::Triangle);
    let (boxes, secs) = det.detect(&big)?;
    let out: Vec<_> = boxes.iter().map(|b| serde_json::json!({"score": (b.score*1000.0).round()/1000.0, "bbox": b.bbox()})).collect();
    println!("{}", serde_json::json!({"boxes": out, "seconds": (secs*1000.0).round()/1000.0}));
    Ok(())
}
