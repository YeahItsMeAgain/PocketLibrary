//! Host harness for the spine engine: one book, a batch manifest, or a
//! contact sheet built from a batch output directory.
//!
//! Set `ORT_DYLIB_PATH` to a host `libonnxruntime.so` before running.
//!
//! ```text
//! spine-host run   --cover C --title T --author A --pages N --out DIR --models DIR [--migan PATH]
//! spine-host batch --manifest books.json --out DIR --models DIR [--migan PATH]
//! spine-host sheet --dir DIR --out contact-sheet.png
//! ```

use anyhow::{Context, Result};
use fontdue::{Font, FontSettings};
use image::{imageops::FilterType, Rgb, RgbImage};
use pocketlibrary_spine::{BookInput, Engine, Models};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str).unwrap_or("help") {
        "run" => run_one(&args[2..]),
        "batch" => run_batch(&args[2..]),
        "sheet" => sheet(&args[2..]),
        _ => {
            eprintln!(
                "spine-host — PocketLibrary spine engine host harness\n\
                 \nUSAGE:\n\
                 \x20 spine-host run   --cover C --title T --author A --pages N --out DIR --models DIR [--migan PATH]\n\
                 \x20 spine-host batch --manifest books.json --out DIR --models DIR [--migan PATH]\n\
                 \x20 spine-host sheet --dir DIR --out contact-sheet.png\n\
                 \nSet ORT_DYLIB_PATH to libonnxruntime.so on the host."
            );
            Ok(())
        }
    }
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn flag_or(args: &[String], name: &str, default: &str) -> String {
    flag(args, name).unwrap_or(default).to_string()
}

fn engine(args: &[String]) -> Result<Engine> {
    let models_dir = PathBuf::from(flag_or(args, "--models", "models"));
    let migan = flag(args, "--migan").map(PathBuf::from);
    Engine::new(Models {
        det: models_dir.join("det.onnx"),
        rec: models_dir.join("rec.onnx"),
        keys: models_dir.join("keys.txt"),
        migan,
    })
}

#[derive(Debug, Deserialize)]
struct ManifestBook {
    slug: String,
    cover: PathBuf,
    title: String,
    author: String,
    pages: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct SummaryRow {
    slug: String,
    title: String,
    author: String,
    route: pocketlibrary_spine::Route,
    verdict: pocketlibrary_spine::Verdict,
    mask_pct: f32,
    timings: pocketlibrary_spine::Timings,
    crop_box_work: Option<[u32; 4]>,
}

fn run_one(args: &[String]) -> Result<()> {
    let engine = engine(args)?;
    let out = flag_or(args, "--out", "out");
    let input = BookInput {
        cover: PathBuf::from(flag(args, "--cover").context("--cover is required")?),
        title: flag_or(args, "--title", ""),
        author: flag_or(args, "--author", ""),
        pages: flag(args, "--pages")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    };
    let report = engine.generate(&input, Path::new(&out))?;
    println!(
        "{} route={:?} verdict={:?} mask={:.2}% total={:.2}s",
        input.title, report.route, report.verdict, report.mask_pct, report.timings.total
    );
    Ok(())
}

fn run_batch(args: &[String]) -> Result<()> {
    let manifest = flag(args, "--manifest").context("--manifest is required")?;
    let out_root = PathBuf::from(flag_or(args, "--out", "out"));
    let books: Vec<ManifestBook> = serde_json::from_str(
        &std::fs::read_to_string(manifest).with_context(|| format!("read manifest {manifest}"))?,
    )?;
    std::fs::create_dir_all(&out_root)?;
    let engine = engine(args)?;
    let mut rows = Vec::new();
    for book in books {
        let dir = out_root.join(&book.slug);
        let input = BookInput {
            cover: book.cover,
            title: book.title.clone(),
            author: book.author.clone(),
            pages: book.pages,
        };
        match engine.generate(&input, &dir) {
            Ok(report) => {
                let crop_box_work = report.run["final"]["crop_box_work"].as_array().map(|a| {
                    [
                        a[0].as_u64().unwrap_or(0) as u32,
                        a[1].as_u64().unwrap_or(0) as u32,
                        a[2].as_u64().unwrap_or(0) as u32,
                        a[3].as_u64().unwrap_or(0) as u32,
                    ]
                });
                println!(
                    "{} route={:?} verdict={:?} mask={:.2}% det={:.2}s crop={:.2}s migan={:.2}s total={:.2}s",
                    book.slug,
                    report.route,
                    report.verdict,
                    report.mask_pct,
                    report.timings.detection,
                    report.timings.crop_search,
                    report.timings.inpaint_migan,
                    report.timings.total
                );
                rows.push(SummaryRow {
                    slug: book.slug,
                    title: book.title,
                    author: book.author,
                    route: report.route,
                    verdict: report.verdict,
                    mask_pct: (report.mask_pct * 100.0).round() / 100.0,
                    timings: report.timings,
                    crop_box_work,
                });
            }
            Err(e) => {
                eprintln!("{} failed: {e:#}", book.slug);
                rows.push(SummaryRow {
                    slug: book.slug,
                    title: book.title,
                    author: book.author,
                    route: pocketlibrary_spine::Route::Fallback,
                    verdict: pocketlibrary_spine::Verdict::Fallback,
                    mask_pct: 0.0,
                    timings: pocketlibrary_spine::Timings {
                        detection: 0.0,
                        mask_total: 0.0,
                        inpaint_flat: 0.0,
                        inpaint_migan: 0.0,
                        crop_search: 0.0,
                        qa: 0.0,
                        total: 0.0,
                    },
                    crop_box_work: None,
                });
            }
        }
    }
    std::fs::write(
        out_root.join("summary.json"),
        serde_json::to_string_pretty(&rows)?,
    )?;
    Ok(())
}

/// Compose fallback / spine / full art for every book in a batch output
/// directory. Spines are shown at the natural 2x size (104 x 472); the full
/// art is fitted to the same height.
fn sheet(args: &[String]) -> Result<()> {
    let dir = PathBuf::from(flag(args, "--dir").context("--dir is required")?);
    let out = PathBuf::from(flag_or(args, "--out", "contact-sheet.png"));
    let rows: Vec<SummaryRow> = serde_json::from_str(
        &std::fs::read_to_string(dir.join("summary.json"))
            .with_context(|| format!("read {}/summary.json", dir.display()))?,
    )?;

    let font = Font::from_bytes(
        include_bytes!("../../assets/fonts/DejaVuSerif.ttf") as &[u8],
        FontSettings::default(),
    )
    .expect("embedded font");
    let bold = Font::from_bytes(
        include_bytes!("../../assets/fonts/DejaVuSerif-Bold.ttf") as &[u8],
        FontSettings::default(),
    )
    .expect("embedded font");

    let row_h = 472u32;
    let label_w = 210u32;
    let spine_w = 104u32;
    let pad = 16u32;
    let header_h = 58u32;

    let mut panels: Vec<(String, String, RgbImage, RgbImage, RgbImage)> = Vec::new();
    let mut art_w_max = 0u32;
    for row in &rows {
        let book_dir = dir.join(&row.slug);
        let spine = image::open(book_dir.join("spine-2x.jpg"))?.to_rgb8();
        let fallback = image::open(book_dir.join("fallback-spine.jpg"))?.to_rgb8();
        let art_src = image::open(book_dir.join("art.jpg"))?.to_rgb8();
        let art_w = ((art_src.width() as f32 * row_h as f32 / art_src.height() as f32).round()
            as u32)
            .max(1);
        let art = image::imageops::resize(&art_src, art_w, row_h, FilterType::Triangle);
        art_w_max = art_w_max.max(art_w);
        let subtitle = format!("{:?} · {:?} · {:.1}%", row.route, row.verdict, row.mask_pct);
        panels.push((row.title.clone(), subtitle, fallback, spine, art));
    }

    let width = pad + label_w + pad + spine_w + pad + spine_w + pad + art_w_max + pad;
    let height = header_h + (row_h + pad) * panels.len() as u32 + pad;
    let mut canvas = RgbImage::from_pixel(width, height, Rgb([22, 17, 20]));

    draw_text(
        &mut canvas,
        &bold,
        "PocketLibrary spine engine — fallback / spine / full art",
        16.0,
        pad as i32,
        30,
        [242, 227, 198],
    );

    let col_y = header_h - 8;
    draw_text(
        &mut canvas,
        &bold,
        "fallback",
        11.0,
        (pad + label_w + pad) as i32,
        col_y as i32,
        [201, 168, 106],
    );
    draw_text(
        &mut canvas,
        &bold,
        "spine 2x",
        11.0,
        (pad + label_w + pad + spine_w + pad) as i32,
        col_y as i32,
        [201, 168, 106],
    );
    draw_text(
        &mut canvas,
        &bold,
        "full art",
        11.0,
        (pad + label_w + pad + spine_w + pad + spine_w + pad) as i32,
        col_y as i32,
        [201, 168, 106],
    );

    for (i, (title, subtitle, fallback, spine, art)) in panels.iter().enumerate() {
        let y = header_h + pad + i as u32 * (row_h + pad);
        let mut ty = y + 20;
        for line in wrap(&bold, title, 14.0, label_w as f32) {
            draw_text(
                &mut canvas,
                &bold,
                &line,
                14.0,
                pad as i32,
                ty as i32,
                [238, 224, 198],
            );
            ty += 18;
        }
        ty += 4;
        for line in wrap(&font, subtitle, 11.0, label_w as f32) {
            draw_text(
                &mut canvas,
                &font,
                &line,
                11.0,
                pad as i32,
                ty as i32,
                [183, 165, 138],
            );
            ty += 15;
        }

        let mut x = pad + label_w + pad;
        image::imageops::replace(&mut canvas, fallback, x as i64, y as i64);
        x += spine_w + pad;
        image::imageops::replace(&mut canvas, spine, x as i64, y as i64);
        x += spine_w + pad;
        image::imageops::replace(&mut canvas, art, x as i64, y as i64);
    }

    canvas.save(&out)?;
    println!("contact sheet: {} ({} books)", out.display(), panels.len());
    Ok(())
}

fn wrap(font: &Font, text: &str, px: f32, maxw: f32) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    for word in text.split_whitespace() {
        let test = if cur.is_empty() {
            word.to_string()
        } else {
            format!("{cur} {word}")
        };
        if measure(font, &test, px) <= maxw || cur.is_empty() {
            cur = test;
        } else {
            lines.push(cur);
            cur = word.to_string();
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

fn measure(font: &Font, text: &str, px: f32) -> f32 {
    text.chars()
        .map(|ch| font.metrics(ch, px).advance_width)
        .sum()
}

fn draw_text(
    img: &mut RgbImage,
    font: &Font,
    text: &str,
    px: f32,
    x: i32,
    baseline: i32,
    color: [u8; 3],
) {
    let mut pen = x as f32;
    for ch in text.chars() {
        let (m, bitmap) = font.rasterize(ch, px);
        let gx = (pen + m.xmin as f32).round() as i32;
        let gy = baseline - (m.height as f32 + m.ymin as f32).round() as i32;
        for by in 0..m.height {
            for bx in 0..m.width {
                let cov = bitmap[by * m.width + bx] as f32 / 255.0;
                if cov <= 0.0 {
                    continue;
                }
                let xx = gx + bx as i32;
                let yy = gy + by as i32;
                if xx < 0 || yy < 0 || xx >= img.width() as i32 || yy >= img.height() as i32 {
                    continue;
                }
                let p = img.get_pixel_mut(xx as u32, yy as u32);
                for c in 0..3 {
                    p[c] = (p[c] as f32 * (1.0 - cov) + color[c] as f32 * cov) as u8;
                }
            }
        }
        pen += m.advance_width;
    }
}
