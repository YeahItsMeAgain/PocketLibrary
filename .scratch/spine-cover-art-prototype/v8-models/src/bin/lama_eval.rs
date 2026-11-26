//! Run the real v8 fill path (flat-ring fill -> LaMa) on a fixed source/mask,
//! so fp32 and quantised LaMa can be compared on identical inputs.
//!
//! Usage:
//!   lama_eval --source SRC --mask MASK --lama MODEL --out DIR [--max-side 720]

use anyhow::{Context, Result};
use image::RgbImage;
use std::path::{Path, PathBuf};
use v8_app::{crop, fill, ops};

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
}

fn save_jpg(path: &Path, img: &RgbImage) -> Result<()> {
    img.save_with_format(path, image::ImageFormat::Jpeg)
        .with_context(|| format!("save {}", path.display()))
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let source = flag(&args, "--source").expect("--source");
    let mask_path = flag(&args, "--mask").expect("--mask");
    let model = flag(&args, "--lama").expect("--lama");
    let out = PathBuf::from(flag(&args, "--out").unwrap_or("out"));
    let max_side = flag(&args, "--max-side")
        .and_then(|v| v.parse().ok())
        .unwrap_or(720u32);
    let fixed_crop = flag(&args, "--crop-box").map(|s| {
        let v: Vec<u32> = s.split(',').filter_map(|p| p.trim().parse().ok()).collect();
        assert_eq!(v.len(), 4, "--crop-box expects x,y,w,h");
        [v[0], v[1], v[2], v[3]]
    });
    std::fs::create_dir_all(&out)?;

    let src = image::open(source)?.to_rgb8();
    let mask = image::open(mask_path)?.to_luma8();
    let mut lama = fill::Lama::new(model)?;
    let t = std::time::Instant::now();
    let res = fill::inpaint(&src, &mask, max_side, Some(&mut lama))?;
    let total_s = t.elapsed().as_secs_f64();

    // Same spine crop choice the pipeline would make on this art.
    let vis = crop::best_visual_crop(&res.art, None);
    let chosen = fixed_crop.unwrap_or(vis.box_);
    let art_crop = crop::crop_box(&res.art, chosen);
    let spine = ops::resize_rgb(&art_crop, crop::SPINE_W, crop::SPINE_H, image::imageops::FilterType::Lanczos3);

    save_jpg(&out.join("art.jpg"), &res.art)?;
    save_jpg(&out.join("crop-native.jpg"), &art_crop)?;
    save_jpg(&out.join("spine.jpg"), &spine)?;
    let report = serde_json::json!({
        "model": model,
        "source": source,
        "mask": mask_path,
        "max_side": max_side,
        "work_size": res.work_size,
        "flat_pct": res.flat_pct,
        "flat_s": (res.flat_s * 1000.0).round() / 1000.0,
        "lama_s": (res.lama_s * 1000.0).round() / 1000.0,
        "total_s": (total_s * 1000.0).round() / 1000.0,
        "crop_box": chosen,
        "lama_available": res.lama_available,
    });
    std::fs::write(out.join("run.json"), serde_json::to_string_pretty(&report)?)?;
    println!(
        "{} -> {} flat {:.2}s lama {:.2}s crop {:?}",
        model,
        out.display(),
        res.flat_s,
        res.lama_s,
        chosen
    );
    Ok(())
}
