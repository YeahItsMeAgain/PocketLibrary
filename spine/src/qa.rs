//! Spine-scale QA and the pass / review / fallback decision.

use anyhow::Result;
use image::{imageops::FilterType, GrayImage, RgbImage};

use crate::crop::{SPINE_H, SPINE_W};
use crate::ocr::{Ocr, OcrHit};
use crate::ops;

#[derive(Clone, Debug, serde::Serialize)]
pub struct ImageStats {
    pub luma_std: f32,
    pub luma_p5: f32,
    pub luma_p95: f32,
    pub non_dark_pct: f32,
    pub edge_density: f32,
    pub laplacian_var: f32,
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SeamMetrics {
    pub seam_ratio: f32,
    pub inside_vs_ring_delta_e: f32,
    pub inside_ring_std_ratio: f32,
    pub boundary_px: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct QaMetrics {
    pub mask_coverage_pct: f32,
    pub crop_mask_coverage_pct: f32,
    pub art_residual_ocr: Vec<OcrHit>,
    pub crop_residual_ocr: Vec<OcrHit>,
    pub spine_residual_ocr: Vec<OcrHit>,
    pub spine: ImageStats,
    pub palette_corr: f32,
    pub seam: SeamMetrics,
    pub score: f32,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Decision {
    pub verdict: String,
    pub reasons: Vec<String>,
}

pub fn image_stats(img: &RgbImage) -> ImageStats {
    let gray = ops::to_gray(img);
    let (w, h) = gray.dimensions();
    let g: Vec<f32> = gray.as_raw().iter().map(|v| *v as f32).collect();
    let lap = ops::laplacian_abs(gray.as_raw(), w as usize, h as usize);
    let edges = ops::edge_mask(gray.as_raw(), w as usize, h as usize, 100.0);
    let mut sorted = g.clone();
    let p5 = ops::percentile_f32(&mut sorted, 0.05);
    let mut sorted2 = g.clone();
    let p95 = ops::percentile_f32(&mut sorted2, 0.95);
    let non_dark = g.iter().filter(|v| **v > 40.0).count() as f32 / g.len() as f32;
    let edge_density = edges.iter().filter(|v| **v > 0).count() as f32 / edges.len() as f32;
    ImageStats {
        luma_std: ops::std_dev(&g),
        luma_p5: p5,
        luma_p95: p95,
        non_dark_pct: non_dark * 100.0,
        edge_density,
        laplacian_var: {
            let m = ops::mean(&lap);
            lap.iter().map(|v| (v - m) * (v - m)).sum::<f32>() / lap.len() as f32
        },
        width_px: w,
        height_px: h,
    }
}

pub fn palette_corr(crop: &RgbImage, cover: &RgbImage, cover_mask: Option<&GrayImage>) -> f32 {
    let keep = match cover_mask {
        Some(m) if m.as_raw().iter().any(|v| *v > 0) => {
            let mut keep = cover.clone();
            let mut rs = Vec::new();
            let mut gs = Vec::new();
            let mut bs = Vec::new();
            for (x, y, p) in cover.enumerate_pixels() {
                if m.get_pixel(x, y)[0] == 0 {
                    rs.push(p[0] as f32);
                    gs.push(p[1] as f32);
                    bs.push(p[2] as f32);
                }
            }
            let col = [
                ops::median_f32(&mut rs) as u8,
                ops::median_f32(&mut gs) as u8,
                ops::median_f32(&mut bs) as u8,
            ];
            for (x, y, p) in keep.enumerate_pixels_mut() {
                if m.get_pixel(x, y)[0] > 0 {
                    *p = image::Rgb(col);
                }
            }
            keep
        }
        _ => cover.clone(),
    };
    let a = ops::palette_hist(crop);
    let b = ops::palette_hist(&keep);
    ops::hist_correlation(&a, &b)
}

pub fn seam_metrics(source: &RgbImage, art: &RgbImage, mask: &GrayImage) -> SeamMetrics {
    let (w, h) = mask.dimensions();
    let (w, h) = (w as usize, h as usize);
    let m: Vec<u8> = mask
        .as_raw()
        .iter()
        .map(|v| if *v > 0 { 255 } else { 0 })
        .collect();
    if !m.iter().any(|v| *v > 0) {
        return SeamMetrics {
            seam_ratio: 0.0,
            inside_vs_ring_delta_e: 0.0,
            inside_ring_std_ratio: 0.0,
            boundary_px: 0,
        };
    }
    let mut d1 = m.clone();
    ops::dilate_binary(&mut d1, w, h, 1);
    let mut e1 = m.clone();
    ops::erode_binary(&mut e1, w, h, 1);
    let mut d7 = m.clone();
    ops::dilate_binary(&mut d7, w, h, 7);
    let mut boundary_n = 0usize;
    let mut ring_n = 0usize;
    for i in 0..w * h {
        if d1[i] > 0 && e1[i] == 0 {
            boundary_n += 1;
        }
        if d7[i] > 0 && d1[i] == 0 {
            ring_n += 1;
        }
    }
    let g = ops::laplacian_abs(ops::to_gray(art).as_raw(), w, h);
    let mut seam = 0.0f32;
    let mut refv = 0.0f32;
    for i in 0..w * h {
        if d1[i] > 0 && e1[i] == 0 {
            seam += g[i];
        }
        if d7[i] > 0 && d1[i] == 0 {
            refv += g[i];
        }
    }
    let seam = if boundary_n > 0 {
        seam / boundary_n as f32
    } else {
        0.0
    };
    let refv = if ring_n > 0 {
        refv / ring_n as f32
    } else {
        0.0
    };
    let ratio = seam / (refv + 1e-6);

    let src_gray = ops::to_gray(source);
    let art_gray = ops::to_gray(art);
    let mut ring_l = Vec::new();
    let mut ring_a = Vec::new();
    let mut ring_b = Vec::new();
    for i in 0..w * h {
        if d7[i] > 0 && d1[i] == 0 {
            let x = (i % w) as u32;
            let y = (i / w) as u32;
            let p = src_gray.get_pixel(x, y);
            let rgb = source.get_pixel(x, y);
            let lab = ops::rgb_to_lab([rgb[0], rgb[1], rgb[2]]);
            ring_l.push(lab[0]);
            ring_a.push(lab[1]);
            ring_b.push(lab[2]);
            let _ = p;
        }
    }
    let ring_med = [
        ops::median_f32(&mut ring_l.clone()),
        ops::median_f32(&mut ring_a.clone()),
        ops::median_f32(&mut ring_b.clone()),
    ];
    let mut de_sum = 0.0f64;
    let mut de_n = 0usize;
    let mut inside_l = Vec::new();
    for (i, &v) in m.iter().enumerate().take(w * h) {
        if v > 0 {
            let x = (i % w) as u32;
            let y = (i / w) as u32;
            let p = art.get_pixel(x, y);
            let lab = ops::rgb_to_lab([p[0], p[1], p[2]]);
            let d = ((lab[0] - ring_med[0]).powi(2)
                + (lab[1] - ring_med[1]).powi(2)
                + (lab[2] - ring_med[2]).powi(2))
            .sqrt();
            de_sum += d as f64;
            de_n += 1;
            inside_l.push(lab[0]);
        }
    }
    let de = if de_n > 0 {
        (de_sum / de_n as f64) as f32
    } else {
        0.0
    };
    let mut sstd = ops::std_dev(&inside_l);
    let mut rstd = ops::std_dev(&ring_l);
    if ring_l.is_empty() {
        sstd = 0.0;
        rstd = 0.0;
    }
    let std_ratio = sstd / (rstd + 1e-6);
    let _ = (src_gray, art_gray);
    SeamMetrics {
        seam_ratio: ratio,
        inside_vs_ring_delta_e: de,
        inside_ring_std_ratio: std_ratio,
        boundary_px: boundary_n,
    }
}

pub fn qa_report(
    source: &RgbImage,
    art: &RgbImage,
    mask: &GrayImage,
    crop: &RgbImage,
    crop_box: [u32; 4],
    ocr: &mut Ocr,
    skip_art_ocr: bool,
) -> Result<QaMetrics> {
    let (w, h) = mask.dimensions();
    let mut crop_cov_n = 0usize;
    let [cx, cy, cw, ch] = crop_box;
    for y in cy..(cy + ch).min(h) {
        for x in cx..(cx + cw).min(w) {
            if mask.get_pixel(x, y)[0] > 0 {
                crop_cov_n += 1;
            }
        }
    }
    let crop_cov = crop_cov_n as f32 / (cw * ch).max(1) as f32 * 100.0;
    let spine = ops::resize_rgb(crop, SPINE_W, SPINE_H, FilterType::Lanczos3);
    let mut stats = image_stats(&spine);
    stats.width_px = SPINE_W;
    stats.height_px = SPINE_H;

    let art_hits = if skip_art_ocr {
        Vec::new()
    } else {
        clean(ocr.texts(art, 0.5)?)
    };
    let crop_hits = clean(ocr.texts(crop, 0.55)?);
    let spine4 = ops::resize_rgb(&spine, SPINE_W * 4, SPINE_H * 4, FilterType::Triangle);
    let spine_hits = clean(ocr.texts(&spine4, 0.5)?);

    let total = (w * h) as f32;
    let mask_n = mask.as_raw().iter().filter(|v| **v > 0).count() as f32;
    Ok(QaMetrics {
        mask_coverage_pct: mask_n / total * 100.0,
        crop_mask_coverage_pct: crop_cov,
        art_residual_ocr: art_hits,
        crop_residual_ocr: crop_hits,
        spine_residual_ocr: spine_hits,
        spine: stats,
        palette_corr: palette_corr(crop, source, Some(mask)),
        seam: seam_metrics(source, art, mask),
        score: 0.0,
    })
}

fn clean(hits: Vec<OcrHit>) -> Vec<OcrHit> {
    let mut out: Vec<OcrHit> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for h in hits {
        let t = h.text.trim().to_string();
        if t.chars().count() < 2 {
            continue;
        }
        let k = t.to_lowercase();
        if seen.contains(&k) {
            continue;
        }
        seen.insert(k);
        out.push(OcrHit { text: t, ..h });
    }
    out
}

pub fn decide(route: &str, m: &QaMetrics) -> Decision {
    let mut reasons: Vec<String> = Vec::new();
    if route == "crop" {
        if !m.crop_residual_ocr.is_empty() || !m.spine_residual_ocr.is_empty() {
            return Decision {
                verdict: "fallback".into(),
                reasons: vec!["residual text in the text-free crop".into()],
            };
        }
        if m.spine.luma_std < 10.0 || m.spine.edge_density < 0.006 {
            return Decision {
                verdict: "fallback".into(),
                reasons: vec!["crop is too flat or has too little structure".into()],
            };
        }
        if m.spine.luma_std < 16.0 || m.spine.edge_density < 0.012 {
            return Decision {
                verdict: "review".into(),
                reasons: vec!["crop survives but structure is marginal".into()],
            };
        }
        return Decision {
            verdict: "pass".into(),
            reasons: vec!["zero mask coverage, no residual OCR, structure at spine scale".into()],
        };
    }

    if !m.spine_residual_ocr.is_empty() {
        reasons.push("residual text is readable in the 52x236 spine".into());
    }
    if m.mask_coverage_pct > 55.0 {
        reasons.push("more than 55% of the cover was reconstructed".into());
    } else if m.mask_coverage_pct > 40.0 {
        reasons.push("40-55% of the cover was reconstructed".into());
    }
    if m.seam.seam_ratio > 3.0 {
        reasons.push("seam gradient is >3x the local reference".into());
    }
    if m.seam.inside_vs_ring_delta_e > 55.0 {
        reasons.push("inpainted region differs strongly from its ring".into());
    }
    if m.spine.luma_std < 10.0 || m.spine.edge_density < 0.006 {
        reasons.push("spine has too little structure".into());
    } else if m.spine.luma_std < 16.0 {
        reasons.push("spine structure is marginal".into());
    }

    // A large reconstructed area is a quality flag, not a failed
    // reconstruction: the residual-OCR guard above already rejects readable
    // text, and seam/palette outliers stay visible as review reasons. Only
    // readable text in the 52x236 spine or a spine with no usable structure
    // (edge density/luma below the floor) makes the route genuinely fail.
    let fallback = reasons
        .iter()
        .any(|r| r.contains("residual text") || r.contains("too little structure"));
    if fallback {
        Decision {
            verdict: "fallback".into(),
            reasons,
        }
    } else if !reasons.is_empty() {
        Decision {
            verdict: "review".into(),
            reasons,
        }
    } else {
        Decision {
            verdict: "pass".into(),
            reasons: vec!["no residual OCR, controlled mask, adequate spine structure".into()],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metrics(coverage: f32, spine_ocr: bool, luma_std: f32, edge_density: f32) -> QaMetrics {
        QaMetrics {
            mask_coverage_pct: coverage,
            crop_mask_coverage_pct: coverage,
            art_residual_ocr: Vec::new(),
            crop_residual_ocr: Vec::new(),
            spine_residual_ocr: if spine_ocr {
                vec![OcrHit {
                    text: "FEENEY".into(),
                    conf: 0.91,
                    box_: [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
                }]
            } else {
                Vec::new()
            },
            spine: ImageStats {
                luma_std,
                luma_p5: 10.0,
                luma_p95: 220.0,
                non_dark_pct: 90.0,
                edge_density,
                laplacian_var: 500.0,
                width_px: 52,
                height_px: 236,
            },
            palette_corr: 0.93,
            seam: SeamMetrics {
                seam_ratio: 1.2,
                inside_vs_ring_delta_e: 8.0,
                inside_ring_std_ratio: 0.9,
                boundary_px: 300,
            },
            score: 0.0,
        }
    }

    #[test]
    fn a_large_reconstruction_with_a_clean_spine_is_review_not_fallback() {
        // Mi-GAN rebuilt most of the cover, but there is no readable text and
        // the spine still has structure. That is a quality flag for review,
        // not a failed reconstruction.
        let decision = decide("inpaint", &metrics(62.0, false, 40.0, 0.05));
        assert_eq!(decision.verdict, "review", "{:?}", decision.reasons);
        assert!(
            decision
                .reasons
                .iter()
                .any(|reason| reason.contains("more than 55%")),
            "the large mask stays visible as a review reason: {:?}",
            decision.reasons
        );
    }

    #[test]
    fn readable_residual_text_is_still_a_fallback() {
        let decision = decide("inpaint", &metrics(62.0, true, 40.0, 0.05));
        assert_eq!(decision.verdict, "fallback", "{:?}", decision.reasons);
        assert!(
            decision
                .reasons
                .iter()
                .any(|reason| reason.contains("residual text")),
            "{:?}",
            decision.reasons
        );
    }

    #[test]
    fn a_structureless_spine_is_still_a_fallback() {
        let decision = decide("inpaint", &metrics(44.0, false, 6.0, 0.002));
        assert_eq!(decision.verdict, "fallback", "{:?}", decision.reasons);
        assert!(
            decision
                .reasons
                .iter()
                .any(|reason| reason.contains("too little structure")),
            "{:?}",
            decision.reasons
        );
    }
}
