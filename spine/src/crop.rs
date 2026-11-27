//! Spine-aspect crop scan and the text-free crop route.

use anyhow::Result;
use image::{GrayImage, RgbImage};

use crate::ocr::{Ocr, OcrHit};
use crate::ops;

pub const SPINE_W: u32 = 52;
pub const SPINE_H: u32 = 236;
pub const SPINE_ASPECT: f32 = SPINE_W as f32 / SPINE_H as f32;

/// Maximum fraction of the working-image width kept clear at each cover edge.
///
/// Covers often print a publisher strip or the spine on the outer edge
/// (Rock Paper Scissors: a red band covering the rightmost ~9%). Candidate
/// windows stay on the front-cover artwork, not on that printed edge. The
/// margin grows toward this cap only when the edge itself looks printed;
/// otherwise a small guard keeps windows off the very edge without throwing
/// away cover art that runs full bleed.
pub const EDGE_MARGIN_FRAC: f32 = 0.10;
const EDGE_MIN_MARGIN_FRAC: f32 = 0.02;
const EDGE_MARGIN_BUFFER_PX: usize = 4;

/// Width of the edge strip sampled when looking for a printed band, as a
/// fraction of the working-image width, with a small pixel floor.
const EDGE_BAND_FRAC: f32 = 0.02;
const EDGE_BAND_MIN_PX: u32 = 2;

/// A flat, strongly saturated outer strip is treated as a printed edge band.
/// The red RPS band measures sat ~= 223/255, sat coverage 1.0, luma std ~= 0.4
/// in its outer three columns; cover artwork is either less saturated or has
/// more luma structure.
const PRINTED_EDGE_MIN_SAT: f32 = 160.0;
const PRINTED_EDGE_MIN_SAT_FRAC: f32 = 0.80;
const PRINTED_EDGE_MAX_LUMA_STD: f32 = 12.0;
/// A column below this mean saturation ends a printed colour band.
const EDGE_BAND_INNER_SAT: f32 = 80.0;

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
    let sal: Vec<f32> = gray
        .iter()
        .zip(blur.iter())
        .map(|(a, b)| (a - b).abs())
        .collect();
    let m: Vec<f32> = match mask {
        Some(g) => g
            .as_raw()
            .iter()
            .map(|v| if *v > 0 { 1.0 } else { 0.0 })
            .collect(),
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
    // Keep one margin clear on each cover edge so printed spine/publisher
    // strips never land in a window. The margin is wider only where the edge
    // itself is a flat saturated band. Covers narrower than five margins would
    // leave no room, so shrink the margin rather than emit no candidates.
    let (left_margin, right_margin) = edge_margins(art);
    let mut cands = Vec::new();
    for ch in heights {
        let cw = (ch as f32 * SPINE_ASPECT).round() as usize;
        if cw < 18 || cw + left_margin + right_margin > w {
            continue;
        }
        let xs = linspace(left_margin as f32, (w - right_margin - cw) as f32, 26);
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
    // The margin handles the usual printed edge. As a cheap second guard,
    // drop candidates whose own outer columns are still a flat saturated
    // band, so the chosen crop cannot carry a residue of that edge.
    if let Some(first_clean) = cands
        .iter()
        .position(|c| !outer_band_is_printed_edge(art, c.box_))
    {
        cands.drain(..first_clean);
    }
    cands
}

/// Horizontal guards for the left and right cover edges. Both start at the
/// small baseline; a side widens toward `EDGE_MARGIN_FRAC` only when its outer
/// strip is a flat saturated printed band.
fn edge_margins(art: &RgbImage) -> (usize, usize) {
    let (w, h) = art.dimensions();
    let (w, h) = (w as usize, h as usize);
    let cap = ((w as f32 * EDGE_MARGIN_FRAC).round() as usize)
        .min(w / 5)
        .max(1);
    let base = ((w as f32 * EDGE_MIN_MARGIN_FRAC).round() as usize)
        .min(cap)
        .max(1);
    let left = printed_edge_margin(art, w, h, true, base, cap);
    let right = printed_edge_margin(art, w, h, false, base, cap);
    (left, right)
}

fn printed_edge_margin(
    art: &RgbImage,
    w: usize,
    h: usize,
    left: bool,
    base: usize,
    cap: usize,
) -> usize {
    let probe = ((w as f32 * EDGE_BAND_FRAC).round() as usize)
        .max(EDGE_BAND_MIN_PX as usize)
        .min(cap.max(1));
    let outer_x = if left { 0 } else { w - probe };
    if !edge_strip_is_printed_band(art, outer_x as u32, 0, probe as u32, h as u32) {
        return base;
    }
    // Walk inward until the saturated band gives way to artwork.
    for d in 0..cap {
        let x = if left { d } else { w - 1 - d };
        let (mean_sat, _, _) = edge_strip_stats(art, x as u32, 0, 1, h as u32);
        if mean_sat < EDGE_BAND_INNER_SAT {
            return (d + EDGE_MARGIN_BUFFER_PX).min(cap);
        }
    }
    cap
}

/// A printed band may carry white lettering, so the margin scan only requires
/// strong, dominant saturation; the stricter flatness test is reserved for
/// verifying a candidate's own outer columns.
fn edge_strip_is_printed_band(art: &RgbImage, x: u32, y: u32, w: u32, h: u32) -> bool {
    let (mean_sat, sat_frac, _) = edge_strip_stats(art, x, y, w, h);
    mean_sat >= PRINTED_EDGE_MIN_SAT && sat_frac >= PRINTED_EDGE_MIN_SAT_FRAC
}

/// True when either sample strip along the candidate's outer columns looks
/// like a printed colour band rather than artwork.
fn outer_band_is_printed_edge(art: &RgbImage, box_: [u32; 4]) -> bool {
    let [x, y, w, h] = box_;
    let band = ((w as f32 * EDGE_BAND_FRAC).round() as u32)
        .max(EDGE_BAND_MIN_PX)
        .min((w / 4).max(1));
    edge_strip_is_flat_saturated(art, x, y, band, h)
        || edge_strip_is_flat_saturated(art, x + w - band, y, band, h)
}

fn edge_strip_is_flat_saturated(art: &RgbImage, x: u32, y: u32, w: u32, h: u32) -> bool {
    let (mean_sat, sat_frac, luma_std) = edge_strip_stats(art, x, y, w, h);
    mean_sat >= PRINTED_EDGE_MIN_SAT
        && sat_frac >= PRINTED_EDGE_MIN_SAT_FRAC
        && luma_std <= PRINTED_EDGE_MAX_LUMA_STD
}

/// Mean HSV saturation, saturated-pixel fraction, and luma standard deviation
/// across a rectangular strip.
fn edge_strip_stats(art: &RgbImage, x: u32, y: u32, w: u32, h: u32) -> (f32, f32, f32) {
    let mut sat_sum = 0.0f32;
    let mut saturated = 0usize;
    let mut luma_sum = 0.0f32;
    let mut luma_sq_sum = 0.0f32;
    let mut n = 0usize;
    for yy in y..y + h {
        for xx in x..x + w {
            let p = art.get_pixel(xx, yy);
            let rgb = [p[0], p[1], p[2]];
            let sat = ops::rgb_to_hsv(rgb)[1];
            let luma = ops::luma(rgb) as f32;
            sat_sum += sat;
            if sat > 100.0 {
                saturated += 1;
            }
            luma_sum += luma;
            luma_sq_sum += luma * luma;
            n += 1;
        }
    }
    if n == 0 {
        return (0.0, 0.0, 0.0);
    }
    let nf = n as f32;
    let mean_sat = sat_sum / nf;
    let sat_frac = saturated as f32 / nf;
    let mean_luma = luma_sum / nf;
    let luma_std = (luma_sq_sum / nf - mean_luma * mean_luma).max(0.0).sqrt();
    (mean_sat, sat_frac, luma_std)
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
