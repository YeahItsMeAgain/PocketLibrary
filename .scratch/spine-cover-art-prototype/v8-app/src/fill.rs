//! Removal: flat-ring median fill first, then optional LaMa `big-lama` ONNX
//! for textured components, with a deterministic no-model substitute.

use anyhow::{Context, Result};
use image::{imageops::FilterType, GrayImage, Luma, RgbImage};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ndarray::Dimension;
use ort::value::Tensor;

use crate::ops;

pub struct InpaintResult {
    pub art: RgbImage,
    pub work_mask: GrayImage,
    pub work_size: (u32, u32),
    pub flat_mask: GrayImage,
    pub scale: f32,
    pub flat_s: f64,
    pub lama_s: f64,
    pub flat_pct: f32,
    pub lama_available: bool,
}

pub struct Lama {
    session: Session,
}

impl Lama {
    pub fn new(model: &str) -> Result<Self> {
        let session = Session::builder(crate::ort_env::shared())?
            .with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()]).map_err(|e| anyhow::anyhow!("ort ep: {e}"))?
            .with_intra_threads(1).map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::All).map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .commit_from_file(model)
            .with_context(|| format!("load LaMa {model}"))?;
        Ok(Self { session })
    }

    /// Fixed 512x512 LaMa input. The working image is letterboxed to preserve
    /// aspect ratio, then cropped back.
    fn inpaint512(&mut self, img: &RgbImage, mask: &GrayImage) -> Result<RgbImage> {
        let (w, h) = img.dimensions();
        let scale = (512.0 / w as f32).min(512.0 / h as f32);
        let nw = ((w as f32 * scale).round() as u32).clamp(1, 512);
        let nh = ((h as f32 * scale).round() as u32).clamp(1, 512);
        let scaled = ops::resize_rgb(img, nw, nh, FilterType::Triangle);
        let scaled_mask = ops::resize_gray(mask, nw, nh, FilterType::Nearest);
        let mut canvas = RgbImage::new(512, 512);
        let mut mcanvas = GrayImage::new(512, 512);
        let ox = (512 - nw) / 2;
        let oy = (512 - nh) / 2;
        image::imageops::replace(&mut canvas, &scaled, ox as i64, oy as i64);
        image::imageops::replace(&mut mcanvas, &scaled_mask, ox as i64, oy as i64);

        let mut idata = vec![0.0f32; 3 * 512 * 512];
        let mut mdata = vec![0.0f32; 512 * 512];
        for (x, y, p) in canvas.enumerate_pixels() {
            let i = y as usize * 512 + x as usize;
            idata[i] = p[0] as f32 / 255.0;
            idata[512 * 512 + i] = p[1] as f32 / 255.0;
            idata[2 * 512 * 512 + i] = p[2] as f32 / 255.0;
            mdata[i] = if mcanvas.get_pixel(x, y)[0] > 127 { 1.0 } else { 0.0 };
        }
        let image_t = Tensor::<f32>::from_array((vec![1i64, 3, 512, 512], idata))?;
        let mask_t = Tensor::<f32>::from_array((vec![1i64, 1, 512, 512], mdata))?;
        let outputs = self.session.run(ort::inputs![image_t, mask_t])?;
        let (shape, vals) = outputs[0].try_extract_tensor::<f32>()?;
        let dims = shape.to_ixdyn();
        if dims.ndim() != 4 {
            anyhow::bail!("unexpected LaMa output rank");
        }
        let oh = dims[2] as usize;
        let ow = dims[3] as usize;
        let mut full = RgbImage::new(ow as u32, oh as u32);
        for y in 0..oh {
            for x in 0..ow {
                let i = y * ow + x;
                let r = vals[i].clamp(0.0, 255.0) as u8;
                let g = vals[ow * oh + i].clamp(0.0, 255.0) as u8;
                let b = vals[2 * ow * oh + i].clamp(0.0, 255.0) as u8;
                full.put_pixel(x as u32, y as u32, image::Rgb([r, g, b]));
            }
        }
        let region = image::imageops::crop_imm(&full, ox, oy, nw, nh).to_image();
        Ok(ops::resize_rgb(&region, w, h, FilterType::Triangle))
    }
}

pub fn prepare_work(
    img: &RgbImage,
    mask: &GrayImage,
    max_side: u32,
) -> Result<(RgbImage, GrayImage, (u32, u32), f32)> {
    let (w, h) = img.dimensions();
    let scale = (max_side as f32 / w.max(h) as f32).min(1.0);
    let ww = ((w as f32 * scale).round() as u32).max(2);
    let wh = ((h as f32 * scale).round() as u32).max(2);
    let work = ops::resize_rgb(img, ww, wh, FilterType::Triangle);
    let mut small = ops::resize_gray(mask, ww, wh, FilterType::Nearest);
    for p in small.pixels_mut() {
        p[0] = if p[0] > 90 { 255 } else { 0 };
    }
    {
        let mut data = small.as_raw().clone();
        ops::dilate_binary(&mut data, ww as usize, wh as usize, 1);
        small = GrayImage::from_raw(ww, wh, data).unwrap();
    }
    Ok((work, small, (ww, wh), scale))
}

pub fn inpaint(
    img: &RgbImage,
    mask: &GrayImage,
    max_side: u32,
    lama: Option<&mut Lama>,
) -> Result<InpaintResult> {
    let (work, small, (ww, wh), scale) = prepare_work(img, mask, max_side)?;

    let t0 = std::time::Instant::now();
    let (mut flat_img, flat) = flat_fill(&work, &small);
    let flat_s = t0.elapsed().as_secs_f64();

    let mut remaining = small.as_raw().clone();
    for i in 0..remaining.len() {
        if flat[i] > 0 {
            remaining[i] = 0;
        }
    }
    let remaining_img = GrayImage::from_raw(ww, wh, remaining.clone()).unwrap();
    let flat_mask = GrayImage::from_raw(ww, wh, flat).unwrap();

    let mut lama_s = 0.0f64;
    let mut lama_available = false;
    if remaining.iter().any(|v| *v > 0) {
        if let Some(lama) = lama {
            lama_available = true;
            let t = std::time::Instant::now();
            let filled = lama.inpaint512(&flat_img, &remaining_img)?;
            lama_s = t.elapsed().as_secs_f64();
            for (x, y, p) in flat_img.enumerate_pixels_mut() {
                if remaining_img.get_pixel(x, y)[0] > 0 {
                    *p = *filled.get_pixel(x, y);
                }
            }
        } else {
            // Documented app-capable substitute when the 208 MB LaMa model has
            // not been downloaded: ring-median fill + masked smoothing.
            let mut data = flat_img.as_raw().clone();
            substitute_inpaint(&mut data, &remaining, ww as usize, wh as usize);
            flat_img = RgbImage::from_raw(ww, wh, data).unwrap();
        }
    }
    let flat_pct = (flat_mask.as_raw().iter().filter(|v| **v > 0).count() as f32
        / (ww * wh) as f32)
        * 100.0;
    Ok(InpaintResult {
        art: flat_img,
        work_mask: small,
        work_size: (ww, wh),
        flat_mask,
        scale,
        flat_s,
        lama_s,
        flat_pct,
        lama_available,
    })
}

fn flat_fill(img: &RgbImage, mask: &GrayImage) -> (RgbImage, Vec<u8>) {
    let (w, h) = img.dimensions();
    let (w, h) = (w as usize, h as usize);
    let mut out = img.clone();
    let mut flat = vec![0u8; w * h];
    let (labels, comps) = ops::connected_components(mask.as_raw(), w, h);
    for c in &comps {
        let area = c.area;
        if area < 8 || area as f32 > 0.28 * (w * h) as f32 {
            continue;
        }
        let mut comp = vec![0u8; w * h];
        for y in c.y0..=c.y1 {
            for x in c.x0..=c.x1 {
                if labels[y * w + x] == c.label {
                    comp[y * w + x] = 255;
                }
            }
        }
        let mut ring = comp.clone();
        ops::dilate9(&mut ring, w, h);
        for i in 0..w * h {
            ring[i] = if ring[i] > 0 && comp[i] == 0 { 255 } else { 0 };
        }
        let ring_n = ring.iter().filter(|v| **v > 0).count();
        if ring_n < 12 {
            continue;
        }
        let mut l = Vec::with_capacity(ring_n);
        let mut chroma = Vec::with_capacity(ring_n * 2);
        for y in c.y0.saturating_sub(4)..=(c.y1 + 4).min(h - 1) {
            for x in c.x0.saturating_sub(4)..=(c.x1 + 4).min(w - 1) {
                let i = y * w + x;
                if ring[i] == 0 {
                    continue;
                }
                let p = out.get_pixel(x as u32, y as u32);
                let lab = ops::rgb_to_lab([p[0], p[1], p[2]]);
                l.push(lab[0]);
                chroma.push(lab[1] - 128.0);
                chroma.push(lab[2] - 128.0);
            }
        }
        if ops::std_dev(&l) >= 8.0 || ops::std_dev(&chroma) >= 8.0 {
            continue;
        }
        let mut ls = l.clone();
        let mut cs: Vec<f32> = chroma.clone();
        let med = [
            ops::median_f32(&mut ls),
            ops::median_f32(&mut cs) * 0.5 + 128.0,
            {
                let mut it = cs.clone();
                ops::median_f32(&mut it) * 0.5 + 128.0
            },
        ];
        // median a/b independently is more faithful than the split above
        let mut a: Vec<f32> = chroma.iter().step_by(2).map(|v| *v + 128.0).collect();
        let mut b: Vec<f32> = chroma.iter().skip(1).step_by(2).map(|v| *v + 128.0).collect();
        let med = [med[0], ops::median_f32(&mut a), ops::median_f32(&mut b)];
        let rgb = ops::lab_to_rgb(med);
        for y in c.y0..=c.y1 {
            for x in c.x0..=c.x1 {
                let i = y * w + x;
                if comp[i] > 0 {
                    out.put_pixel(x as u32, y as u32, image::Rgb(rgb));
                    flat[i] = 255;
                }
            }
        }
    }
    (out, flat)
}

fn substitute_inpaint(data: &mut [u8], mask: &[u8], w: usize, h: usize) {
    // ring-median seed
    let (labels, comps) = ops::connected_components(mask, w, h);
    for c in &comps {
        let mut comp = vec![0u8; w * h];
        for y in c.y0..=c.y1 {
            for x in c.x0..=c.x1 {
                if labels[y * w + x] == c.label {
                    comp[y * w + x] = 255;
                }
            }
        }
        let mut ring = comp.clone();
        ops::dilate9(&mut ring, w, h);
        let cols: Vec<[u8; 3]> = (0..w * h)
            .filter(|i| ring[*i] > 0 && comp[*i] == 0)
            .map(|i| {
                let o = i * 3;
                [data[o], data[o + 1], data[o + 2]]
            })
            .collect();
        if cols.is_empty() {
            continue;
        }
        let mut r: Vec<f32> = cols.iter().map(|c| c[0] as f32).collect();
        let mut g: Vec<f32> = cols.iter().map(|c| c[1] as f32).collect();
        let mut b: Vec<f32> = cols.iter().map(|c| c[2] as f32).collect();
        let col = [
            ops::median_f32(&mut r) as u8,
            ops::median_f32(&mut g) as u8,
            ops::median_f32(&mut b) as u8,
        ];
        for y in c.y0..=c.y1 {
            for x in c.x0..=c.x1 {
                if comp[y * w + x] > 0 {
                    let o = (y * w + x) * 3;
                    data[o..o + 3].copy_from_slice(&col);
                }
            }
        }
    }
    // masked box smoothing
    for _ in 0..4 {
        let src = data.to_vec();
        for y in 1..h.saturating_sub(1) {
            for x in 1..w.saturating_sub(1) {
                let i = y * w + x;
                if mask[i] == 0 {
                    continue;
                }
                for c in 0..3 {
                    let mut s = 0u32;
                    let mut n = 0u32;
                    for dy in -1i32..=1 {
                        for dx in -1i32..=1 {
                            let ni = ((y as i32 + dy) as usize * w + (x as i32 + dx) as usize) * 3 + c;
                            s += src[ni] as u32;
                            n += 1;
                        }
                    }
                    data[i * 3 + c] = (s / n) as u8;
                }
            }
        }
    }
    let _ = Luma([0u8]);
}
