//! Automatic text mask: DBNet boxes -> per-box Lab colour segmentation ->
//! line-colour completion -> proportional dilation.
//!
//! No polygon is authored by hand. Every pixel selected here is derived from a
//! detection plus colour statistics of the cover itself.

use anyhow::Result;
use image::{GrayImage, Luma, RgbImage};

use crate::detect::{Detector, TextBox};
use crate::ops;

pub fn build_mask(
    det: &mut Detector,
    img: &RgbImage,
) -> Result<(GrayImage, Vec<TextBox>, f64)> {
    let (w, h) = img.dimensions();
    let (boxes, det_s) = det.detect(img)?;
    let mut mask = vec![0u8; (w * h) as usize];

    let mut heights: Vec<f32> = Vec::new();
    for b in &boxes {
        let (x0, y0, x1, y1) = b.bbox();
        let bw = (x1 - x0).max(1.0);
        let bh = (y1 - y0).max(1.0);
        heights.push(if b.angle().abs() < 45.0 { bh } else { bw });
        let m = seg_box(img, b);
        for i in 0..mask.len() {
            if m[i] > 0 {
                mask[i] = 255;
            }
        }
    }
    let horizontal: Vec<&TextBox> = boxes.iter().filter(|b| b.angle().abs() < 45.0).collect();
    let line = line_colour_mask(img, &horizontal);
    for i in 0..mask.len() {
        if line[i] > 0 {
            mask[i] = 255;
        }
    }

    let hmed = {
        let mut hs = heights.clone();
        ops::median_f32(&mut hs)
    };
    let hmed = if heights.is_empty() { 8.0 } else { hmed };
    let mut d = (hmed * 0.22).round() as i32;
    d = d.max(5);
    if d % 2 == 0 {
        d += 1;
    }
    let r = (d / 2) as usize;
    ops::close_binary(&mut mask, w as usize, h as usize, r);
    ops::dilate_binary(&mut mask, w as usize, h as usize, r);

    let out = GrayImage::from_raw(w, h, mask).expect("mask dimensions");
    Ok((out, boxes, det_s))
}

pub fn seg_box(img: &RgbImage, b: &TextBox) -> Vec<u8> {
    let (w, h) = img.dimensions();
    let (w, h) = (w as i32, h as i32);
    let (x0, y0, x1, y1) = b.bbox();
    let bw = (x1 - x0).max(1.0);
    let bh = (y1 - y0).max(1.0);
    let horiz = b.angle().abs() < 45.0;
    let (px, py) = if horiz {
        (0.35 * bh, 0.10 * bh)
    } else {
        (0.10 * bw, 0.35 * bw)
    };
    let rx0 = (x0 - px).floor().max(0.0) as i32;
    let ry0 = (y0 - py).floor().max(0.0) as i32;
    let rx1 = ((x1 + px).ceil() as i32).min(w);
    let ry1 = ((y1 + py).ceil() as i32).min(h);
    let rw = (rx1 - rx0).max(0) as usize;
    let rh = (ry1 - ry0).max(0) as usize;
    let mut out = vec![0u8; (w * h) as usize];
    if rw == 0 || rh == 0 {
        return out;
    }

    let mut lab = vec![[0.0f32; 3]; rw * rh];
    for yy in 0..rh {
        for xx in 0..rw {
            let p = img.get_pixel((rx0 + xx as i32) as u32, (ry0 + yy as i32) as u32);
            lab[yy * rw + xx] = ops::rgb_to_lab([p[0], p[1], p[2]]);
        }
    }

    let bd = if horiz {
        ((bh * 0.18) as usize).max(2)
    } else {
        ((bw * 0.18) as usize).max(2)
    };
    let mut border: Vec<[f32; 3]> = Vec::new();
    if horiz {
        let bb = bd.min(rh / 2).max(1);
        for yy in 0..bb {
            for xx in 0..rw {
                border.push(lab[yy * rw + xx]);
                border.push(lab[(rh - 1 - yy) * rw + xx]);
            }
        }
    } else {
        let bb = bd.min(rw / 2).max(1);
        for yy in 0..rh {
            for xx in 0..bb {
                border.push(lab[yy * rw + xx]);
                border.push(lab[yy * rw + (rw - 1 - xx)]);
            }
        }
    }
    let bg = channel_median(&border);

    // core polygon in ROI coordinates, then a 3x3 erosion
    let mut core = vec![0u8; rw * rh];
    let poly: Vec<[f32; 2]> = b
        .points
        .iter()
        .map(|p| [p[0] - rx0 as f32, p[1] - ry0 as f32])
        .collect();
    ops::fill_polygon(&mut core, rw, rh, &poly, 255);
    let mut core_er = core.clone();
    ops::erode3(&mut core_er, rw, rh);

    let cf: Vec<usize> = (0..rw * rh).filter(|i| core_er[*i] > 0).collect();
    if cf.len() < 20 {
        // not enough core: return the un-eroded polygon
        for yy in 0..rh {
            for xx in 0..rw {
                out[((ry0 + yy as i32) * w + (rx0 + xx as i32)) as usize] =
                    core[yy * rw + xx];
            }
        }
        return out;
    }

    let mut dist_bg = vec![0.0f32; rw * rh];
    for i in 0..rw * rh {
        let dx = lab[i][0] - bg[0];
        let dy = lab[i][1] - bg[1];
        let dz = lab[i][2] - bg[2];
        dist_bg[i] = (dx * dx + dy * dy + dz * dz).sqrt();
    }
    let mut core_dists: Vec<f32> = cf.iter().map(|i| dist_bg[*i]).collect();
    let p72 = ops::percentile_f32(&mut core_dists, 0.72);
    let text_pixels: Vec<[f32; 3]> = cf
        .iter()
        .filter(|i| dist_bg[**i] >= p72)
        .map(|i| lab[*i])
        .collect();
    let text_color = if text_pixels.is_empty() {
        channel_median(&cf.iter().map(|i| lab[*i]).collect::<Vec<_>>())
    } else {
        channel_median(&text_pixels)
    };

    let core_area = core.iter().filter(|v| **v > 0).count().max(1);
    let mut sel = vec![0u8; rw * rh];
    let mut sel_n = 0usize;
    for i in 0..rw * rh {
        let dx = lab[i][0] - text_color[0];
        let dy = lab[i][1] - text_color[1];
        let dz = lab[i][2] - text_color[2];
        let dt = (dx * dx + dy * dy + dz * dz).sqrt();
        if dt < 58.0 && dist_bg[i] > 20.0 {
            sel[i] = 255;
            sel_n += 1;
        }
    }
    if sel_n < (0.05 * core_area as f32) as usize {
        sel = core.clone();
    }
    for yy in 0..rh {
        for xx in 0..rw {
            out[((ry0 + yy as i32) * w + (rx0 + xx as i32)) as usize] = sel[yy * rw + xx];
        }
    }
    out
}

pub fn line_colour_mask(img: &RgbImage, boxes: &[&TextBox]) -> Vec<u8> {
    let (w, h) = img.dimensions();
    let (w, h) = (w as i32, h as i32);
    let mut mask = vec![0u8; (w * h) as usize];
    if boxes.is_empty() {
        return mask;
    }
    struct Rect {
        r: [f32; 4],
        ang: f32,
        used: bool,
    }
    let mut rects: Vec<Rect> = boxes
        .iter()
        .map(|b| {
            let (x0, y0, x1, y1) = b.bbox();
            Rect {
                r: [x0, y0, x1, y1],
                ang: b.angle(),
                used: false,
            }
        })
        .collect();

    let mut groups: Vec<Vec<usize>> = Vec::new();
    for i in 0..rects.len() {
        if rects[i].used || rects[i].ang.abs() >= 45.0 {
            continue;
        }
        rects[i].used = true;
        let mut grp = vec![i];
        let mut changed = true;
        while changed {
            changed = false;
            let mut x0 = f32::MAX;
            let mut x1 = f32::MIN;
            let mut y0 = f32::MAX;
            let mut y1 = f32::MIN;
            for &g in &grp {
                x0 = x0.min(rects[g].r[0]);
                x1 = x1.max(rects[g].r[2]);
                y0 = y0.min(rects[g].r[1]);
                y1 = y1.max(rects[g].r[3]);
            }
            for s in 0..rects.len() {
                if rects[s].used || rects[s].ang.abs() >= 45.0 {
                    continue;
                }
                let hh = (y1 - y0).min(rects[s].r[3] - rects[s].r[1]);
                let yov = y1.min(rects[s].r[3]) - y0.max(rects[s].r[1]);
                let gap = (rects[s].r[0] - x1).max(x0 - rects[s].r[2]);
                if yov > 0.65 * hh.max(1.0) && gap < 3.0 * hh.max(1.0) {
                    grp.push(s);
                    rects[s].used = true;
                    changed = true;
                }
            }
        }
        groups.push(grp);
    }

    for grp in groups {
        let mut x0 = f32::MAX;
        let mut x1 = f32::MIN;
        let mut y0 = f32::MAX;
        let mut y1 = f32::MIN;
        for &g in &grp {
            x0 = x0.min(rects[g].r[0]);
            x1 = x1.max(rects[g].r[2]);
            y0 = y0.min(rects[g].r[1]);
            y1 = y1.max(rects[g].r[3]);
        }
        let bh = (y1 - y0).max(1.0);
        let pad = 0.06 * bh;
        let rx0 = (x0 - pad).floor().max(0.0) as i32;
        let rx1 = ((x1 + pad).ceil() as i32).min(w);
        let ry0 = (y0 - pad).floor().max(0.0) as i32;
        let ry1 = ((y1 + pad).ceil() as i32).min(h);
        let rw = (rx1 - rx0).max(0) as usize;
        let rh = (ry1 - ry0).max(0) as usize;
        if rw == 0 || rh == 0 {
            continue;
        }
        let mut roi = vec![[0.0f32; 3]; rw * rh];
        for yy in 0..rh {
            for xx in 0..rw {
                let p = img.get_pixel((rx0 + xx as i32) as u32, (ry0 + yy as i32) as u32);
                roi[yy * rw + xx] = ops::rgb_to_hsv([p[0], p[1], p[2]]);
            }
        }
        let mut samples: Vec<[f32; 3]> = Vec::new();
        for &g in &grp {
            let bx0 = rects[g].r[0].floor().max(0.0) as i32;
            let by0 = rects[g].r[1].floor().max(0.0) as i32;
            let bx1 = (rects[g].r[2].ceil() as i32).min(w);
            let by1 = (rects[g].r[3].ceil() as i32).min(h);
            if bx1 <= bx0 || by1 <= by0 {
                continue;
            }
            for yy in by0..by1 {
                for xx in bx0..bx1 {
                    let p = img.get_pixel(xx as u32, yy as u32);
                    samples.push(ops::rgb_to_hsv([p[0], p[1], p[2]]));
                }
            }
        }
        if samples.is_empty() {
            continue;
        }
        let mut sats: Vec<f32> = samples.iter().map(|s| s[1]).collect();
        let sat_p80 = ops::percentile_f32(&mut sats, 0.80);
        let mut sel = vec![0u8; rw * rh];
        if sat_p80 > 70.0 {
            // Dominant saturated hue via a circular 180-bin histogram. A plain
            // median of hue breaks across the red wrap (0/179); a histogram
            // peak does not, and it tolerates the red->orange gradients that
            // DBNet sometimes misses.
            let mut hist = [0f32; 180];
            for s in &samples {
                if s[1] > 70.0 {
                    let bin = (s[0].round() as i32).rem_euclid(180) as usize;
                    hist[bin] += s[1];
                }
            }
            let mut best_bin = 0usize;
            let mut best_v = -1.0f32;
            for b in 0..180 {
                let mut v = 0.0;
                for d in -2i32..=2 {
                    v += hist[(b as i32 + d).rem_euclid(180) as usize];
                }
                if v > best_v {
                    best_v = v;
                    best_bin = b;
                }
            }
            let text_h = best_bin as f32;
            for i in 0..rw * rh {
                let mut dh = (roi[i][0] - text_h).abs();
                dh = dh.min(180.0 - dh);
                if dh < 30.0 && roi[i][1] > 50.0 {
                    sel[i] = 255;
                }
            }
        } else {
            let mut vals: Vec<f32> = samples.iter().map(|s| s[2]).collect();
            let cut = ops::percentile_f32(&mut vals, 0.60);
            let mut vs: Vec<f32> = samples
                .iter()
                .filter(|s| s[2] > cut)
                .map(|s| s[2])
                .collect();
            let text_v = ops::median_f32(&mut vs);
            for i in 0..rw * rh {
                if (roi[i][2] - text_v).abs() < 50.0 && roi[i][1] < 100.0 {
                    sel[i] = 255;
                }
            }
        }
        for yy in 0..rh {
            for xx in 0..rw {
                let idx = ((ry0 + yy as i32) * w + (rx0 + xx as i32)) as usize;
                if sel[yy * rw + xx] > 0 {
                    mask[idx] = 255;
                }
            }
        }
    }
    mask
}

fn channel_median(colors: &[[f32; 3]]) -> [f32; 3] {
    if colors.is_empty() {
        return [0.0, 0.0, 0.0];
    }
    let mut l: Vec<f32> = colors.iter().map(|c| c[0]).collect();
    let mut a: Vec<f32> = colors.iter().map(|c| c[1]).collect();
    let mut b: Vec<f32> = colors.iter().map(|c| c[2]).collect();
    [ops::median_f32(&mut l), ops::median_f32(&mut a), ops::median_f32(&mut b)]
}

/// Overlay helper used by the gallery.
pub fn mask_overlay(src: &RgbImage, mask: &GrayImage) -> RgbImage {
    let mut out = src.clone();
    for (x, y, p) in out.enumerate_pixels_mut() {
        if mask.get_pixel(x, y)[0] > 0 {
            p[0] = ((p[0] as f32 * 0.45) + 255.0 * 0.55) as u8;
            p[1] = (p[1] as f32 * 0.45) as u8;
            p[2] = (p[2] as f32 * 0.45) as u8;
        }
    }
    let _ = Luma([0u8]);
    out
}
