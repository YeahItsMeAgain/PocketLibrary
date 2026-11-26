//! Spine-aspect crop scan and the text-free crop route.

use anyhow::Result;
use image::{GrayImage, RgbImage};

use crate::ocr::{Ocr, OcrHit};
use crate::ops;

pub const SPINE_W: u32 = 52;
pub const SPINE_H: u32 = 236;
pub const SPINE_ASPECT: f32 = SPINE_W as f32 / SPINE_H as f32;

#[derive(Clone, Debug, serde::Serialize)]
pub struct CropCand {
    pub box_: [u32; 4],
    pub coverage: f32,
    pub luma_std: f32,
    pub edge_density: f32,
    pub non_dark: f32,
    pub salience: f32,
    pub score: f32,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub ocr: Vec<OcrHit>,
}

pub fn find_crops(art: &RgbImage, mask: Option<&GrayImage>, min_h_frac: f32) -> Vec<CropCand> {
    let (w, h) = art.dimensions();
    let (w, h) = (w as usize, h as usize);
    let gray_img = ops::to_gray(art);
    let gray: Vec<f32> = gray_img.as_raw().iter().map(|v| *v as f32).collect();
    let edges: Vec<f32> = ops::edge_mask(gray_img.as_raw(), w, h, 100.0)
        .into_iter()
        .map(|v| v as f32)
        .collect();
    let non_dark: Vec<f32> = gray_img
        .as_raw()
        .iter()
        .map(|v| if *v > 40 { 1.0 } else { 0.0 })
        .collect();
    let blur = ops::box_blur(&gray, w, h, 9);
    let sal: Vec<f32> = gray.iter().zip(blur.iter()).map(|(a, b)| (a - b).abs()).collect();
    let m: Vec<f32> = match mask {
        Some(g) => g.as_raw().iter().map(|v| if *v > 0 { 1.0 } else { 0.0 }).collect(),
        None => vec![0.0; w * h],
    };
    let ii_m = ops::Integral::new(&m, w, h);
    let ii_g = ops::Integral::new(&gray, w, h);
    let g2: Vec<f32> = gray.iter().map(|v| v * v).collect();
    let ii_g2 = ops::Integral::new(&g2, w, h);
    let ii_e = ops::Integral::new(&edges, w, h);
    let ii_nd = ops::Integral::new(&non_dark, w, h);
    let ii_s = ops::Integral::new(&sal, w, h);

    let heights: Vec<usize> = linspace(h as f32 * min_h_frac, h as f32, 14)
        .into_iter()
        .map(|v| v.round() as usize)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut cands = Vec::new();
    for ch in heights {
        let cw = (ch as f32 * SPINE_ASPECT).round() as usize;
        if cw < 18 || cw > w {
            continue;
        }
        let xs = linspace(0.0, (w - cw) as f32, 26);
        let ys = linspace(0.0, (h - ch) as f32, 26);
        for yv in &ys {
            for xv in &xs {
                let x0 = xv.round() as usize;
                let y0 = yv.round() as usize;
                let x1 = x0 + cw;
                let y1 = y0 + ch;
                let area = (cw * ch) as f64;
                let cov = ii_m.sum(x0, y0, x1, y1) / area;
                let mean = ii_g.sum(x0, y0, x1, y1) / area;
                let var = (ii_g2.sum(x0, y0, x1, y1) / area) - mean * mean;
                let std = var.max(0.0).sqrt();
                let edge = ii_e.sum(x0, y0, x1, y1) / area;
                let nd = ii_nd.sum(x0, y0, x1, y1) / area;
                let salience = ii_s.sum(x0, y0, x1, y1) / area;
                let size = ch as f64 / h as f64;
                let score = -8.0 * cov
                    + 1.25 * (std / 45.0).min(1.0)
                    + 1.0 * (edge / 0.06).min(1.0)
                    + 0.45 * (salience / 18.0).min(1.0)
                    + 0.35 * size
                    + 0.3 * (nd / 0.5).min(1.0);
                cands.push(CropCand {
                    box_: [x0 as u32, y0 as u32, cw as u32, ch as u32],
                    coverage: cov as f32,
                    luma_std: std as f32,
                    edge_density: edge as f32,
                    non_dark: nd as f32,
                    salience: salience as f32,
                    score: score as f32,
                    ocr: Vec::new(),
                });
            }
        }
    }
    cands.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                a.coverage
                    .partial_cmp(&b.coverage)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    cands
}

pub fn pick_text_free_crop(
    art: &RgbImage,
    mask: &GrayImage,
    ocr: &mut Ocr,
    max_checks: usize,
) -> Result<(Option<CropCand>, Vec<CropCand>)> {
    let cands: Vec<CropCand> = find_crops(art, Some(mask), 0.55)
        .into_iter()
        .filter(|c| c.coverage <= 0.002)
        .collect();
    let mut checked = Vec::new();
    for mut c in cands {
        if checked.len() >= max_checks {
            break;
        }
        let [x, y, ww, hh] = c.box_;
        let crop = image::imageops::crop_imm(art, x, y, ww, hh).to_image();
        let hits: Vec<OcrHit> = ocr
            .texts(&crop, 0.55)?
            .into_iter()
            .filter(|h| h.text.chars().count() >= 2)
            .collect();
        c.ocr = hits.clone();
        checked.push(c.clone());
        if hits.is_empty() {
            return Ok((Some(c), checked));
        }
    }
    Ok((None, checked))
}

pub fn best_visual_crop(art: &RgbImage, mask: Option<&GrayImage>) -> CropCand {
    find_crops(art, mask, 0.55)
        .into_iter()
        .next()
        .expect("at least one crop candidate")
}

pub fn crop_box(img: &RgbImage, b: [u32; 4]) -> RgbImage {
    let [x, y, w, h] = b;
    image::imageops::crop_imm(img, x, y, w, h).to_image()
}

fn linspace(a: f32, b: f32, n: usize) -> Vec<f32> {
    if n <= 1 {
        return vec![a];
    }
    (0..n)
        .map(|i| a + (b - a) * i as f32 / (n - 1) as f32)
        .collect()
}
