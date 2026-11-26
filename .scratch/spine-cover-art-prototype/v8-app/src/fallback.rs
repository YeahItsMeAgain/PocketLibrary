//! Type-on-cloth fallback spine and the contact sheet used by the gallery.

use fontdue::{Font, FontSettings};
use image::{imageops::FilterType, RgbImage};
use std::sync::OnceLock;

use crate::crop::{SPINE_H, SPINE_W};
use crate::ops;

const SERIF: &[u8] = include_bytes!("../assets/fonts/DejaVuSerif.ttf");
const SERIF_BOLD: &[u8] = include_bytes!("../assets/fonts/DejaVuSerif-Bold.ttf");

fn serif() -> &'static Font {
    static F: OnceLock<Font> = OnceLock::new();
    F.get_or_init(|| Font::from_bytes(SERIF, FontSettings::default()).expect("font"))
}
fn serif_bold() -> &'static Font {
    static F: OnceLock<Font> = OnceLock::new();
    F.get_or_init(|| Font::from_bytes(SERIF_BOLD, FontSettings::default()).expect("font"))
}

pub fn fallback_spine(title: &str, author: &str) -> RgbImage {
    let (w, h) = (SPINE_W * 4, SPINE_H * 4);
    let mut img = RgbImage::new(w, h);
    for y in 0..h {
        let f = y as f32 / h as f32;
        let col = image::Rgb([
            (74.0 + 10.0 * f) as u8,
            (52.0 + 8.0 * f) as u8,
            (44.0 + 6.0 * f) as u8,
        ]);
        for x in 0..w {
            img.put_pixel(x, y, col);
        }
    }
    let title = if title.trim().is_empty() {
        "UNTITLED".to_string()
    } else {
        title.to_uppercase()
    };
    let author = author.to_uppercase();
    let maxw = w as f32 - 24.0;
    let bold = serif_bold();

    let mut size = 30.0f32;
    let mut lines = wrap(bold, &title, size, maxw);
    let mut chosen = size;
    for s in (8..=30).rev() {
        size = s as f32;
        lines = wrap(bold, &title, size, maxw);
        if lines.len() <= 6 && lines.iter().all(|l| measure(bold, l, size) <= maxw) {
            chosen = size;
            break;
        }
    }
    let mut y = 28.0f32;
    for line in &lines {
        let tw = measure(bold, line, chosen);
        draw_line(&mut img, bold, line, chosen, ((w as f32 - tw) * 0.5) as i32, y as i32 + chosen as i32, [238, 224, 198]);
        y += chosen + 4.0;
    }
    if !author.is_empty() {
        let reg = serif();
        let asize = 15.0f32;
        let alines = wrap(reg, &author, asize, maxw);
        let mut ay = h as f32 - 26.0 - alines.len() as f32 * 18.0;
        for line in &alines {
            let tw = measure(reg, line, asize);
            draw_line(&mut img, reg, line, asize, ((w as f32 - tw) * 0.5) as i32, ay as i32 + asize as i32, [214, 194, 162]);
            ay += 18.0;
        }
    }
    ops::resize_rgb(&img, SPINE_W, SPINE_H, FilterType::Lanczos3)
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
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn measure(font: &Font, text: &str, px: f32) -> f32 {
    let mut w = 0.0;
    for ch in text.chars() {
        let m = font.metrics(ch, px);
        w += m.advance_width;
    }
    w
}

fn draw_line(
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

/// Original -> mask -> art -> spine -> fallback contact sheet.
pub fn contact_sheet(
    source: &RgbImage,
    mask_preview: &RgbImage,
    art: &RgbImage,
    spine: &RgbImage,
    fallback: &RgbImage,
    title: &str,
    filled: bool,
) -> RgbImage {
    let target_h = 620u32;
    let mut panels: Vec<(String, RgbImage)> = Vec::new();
    let fit = |im: &RgbImage| -> RgbImage {
        let nw = ((im.width() as f32 * target_h as f32 / im.height() as f32).round() as u32).max(1);
        ops::resize_rgb(im, nw, target_h, FilterType::Triangle)
    };
    panels.push(("Original".into(), fit(source)));
    panels.push(("Automatic mask".into(), fit(mask_preview)));
    panels.push((if filled { "Inpainted art" } else { "Art (crop route)" }.into(), fit(art)));
    panels.push((
        "Spine 2x".into(),
        ops::resize_rgb(spine, SPINE_W * 2, SPINE_H * 2, FilterType::Nearest),
    ));
    panels.push((
        "Fallback".into(),
        ops::resize_rgb(fallback, SPINE_W * 2, SPINE_H * 2, FilterType::Nearest),
    ));
    let pad = 16u32;
    let top = 44u32;
    let width = panels.iter().map(|(_, p)| p.width()).sum::<u32>() + pad * (panels.len() as u32 + 1);
    let height = target_h + top + pad;
    let mut canvas = RgbImage::new(width, height);
    for p in canvas.pixels_mut() {
        *p = image::Rgb([24, 18, 14]);
    }
    let bold = serif_bold();
    draw_line(&mut canvas, bold, title, 17.0, pad as i32, 22, [242, 227, 198]);
    let mut x = pad;
    for (label, im) in panels {
        image::imageops::replace(&mut canvas, &im, x as i64, top as i64);
        draw_line(&mut canvas, bold, &label, 14.0, x as i32, (top - 15) as i32, [201, 168, 106]);
        x += im.width() + pad;
    }
    canvas
}
