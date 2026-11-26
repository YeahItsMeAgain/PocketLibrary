//! PaddleOCR PP-OCRv3 recognition used for residual-text QA.

use anyhow::{Context, Result};
use image::{imageops::FilterType, RgbImage};
use ort::session::{builder::GraphOptimizationLevel, Session};
use ndarray::Dimension;
use ort::value::Tensor;

use crate::detect::{Detector, TextBox};
use crate::ops;

#[derive(Clone, Debug, serde::Serialize)]
pub struct OcrHit {
    pub text: String,
    pub conf: f32,
    pub box_: [[f32; 2]; 4],
}

pub struct Recognizer {
    session: Session,
    chars: Vec<char>,
}

impl Recognizer {
    pub fn new(model: &str, keys: &str) -> Result<Self> {
        let session = Session::builder(crate::ort_env::shared())?
            .with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()]).map_err(|e| anyhow::anyhow!("ort ep: {e}"))?
            .with_intra_threads(1).map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::All).map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .commit_from_file(model)
            .with_context(|| format!("load recogniser {model}"))?;
        let raw = std::fs::read_to_string(keys).with_context(|| format!("read {keys}"))?;
        let mut chars: Vec<char> = raw
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.chars().next().unwrap_or(' '))
            .collect();
        // RapidOCR appends a space after the model dictionary.
        chars.push(' ');
        Ok(Self {
            session,
            chars,
        })
    }

    pub fn recognize(&mut self, crop: &RgbImage) -> Result<(String, f32)> {
        let (w, h) = crop.dimensions();
        if h < 6 || w < 2 {
            return Ok((String::new(), 0.0));
        }
        let target_h = 48u32;
        let ratio = w as f32 / h as f32;
        let target_w = ((target_h as f32 * ratio).ceil() as u32).clamp(2, 2048);
        let resized = ops::resize_rgb(crop, target_w, target_h, FilterType::Triangle);
        let (rw, rh) = (target_w as usize, target_h as usize);
        let mut data = vec![0.0f32; 3 * rw * rh];
        for (x, y, p) in resized.enumerate_pixels() {
            for c in 0..3 {
                data[c * rw * rh + y as usize * rw + x as usize] =
                    (p[c] as f32 / 255.0 - 0.5) / 0.5;
            }
        }
        let tensor = Tensor::<f32>::from_array((vec![1i64, 3, rh as i64, rw as i64], data))?;
        let outputs = self.session.run(ort::inputs![tensor])?;
        let (shape, vals) = outputs[0].try_extract_tensor::<f32>()?;
        let dims = shape.to_ixdyn();
        if dims.ndim() != 3 {
            return Ok((String::new(), 0.0));
        }
        let steps = dims[1] as usize;
        let classes = dims[2] as usize;
        let mut text = String::new();
        let mut prev = usize::MAX;
        let mut probs: Vec<f32> = Vec::new();
        for t in 0..steps {
            let base = t * classes;
            let mut best = 0usize;
            let mut best_p = f32::MIN;
            for c in 0..classes {
                let v = vals[base + c];
                if v > best_p {
                    best_p = v;
                    best = c;
                }
            }
            if best == 0 {
                prev = best;
                continue;
            }
            if best == prev {
                continue;
            }
            prev = best;
            let ch = if best <= self.chars.len() {
                self.chars[best - 1]
            } else {
                ' '
            };
            text.push(ch);
            probs.push(best_p);
        }
        let conf = if probs.is_empty() {
            0.0
        } else {
            probs.iter().sum::<f32>() / probs.len() as f32
        };
        Ok((text.trim().to_string(), conf))
    }
}

pub struct Ocr {
    pub det: Detector,
    pub rec: Recognizer,
}

impl Ocr {
    /// OCR engine configured like the reference `ocr_engine()`:
    /// detection limited by the *max* side, recognition on each box.
    pub fn new(det_model: &str, rec_model: &str, keys: &str) -> Result<Self> {
        Ok(Self {
            det: Detector::new(det_model, 960, "max")?,
            rec: Recognizer::new(rec_model, keys)?,
        })
    }

    /// Run OCR on an image, upscaling small inputs like the Python helper.
    /// Returned boxes are in the input image's coordinate space.
    pub fn texts(&mut self, img: &RgbImage, conf_min: f32) -> Result<Vec<OcrHit>> {
        let (w, h) = img.dimensions();
        let mut scale = 1.0f32;
        let mut work = img.clone();
        if w.max(h) < 900 {
            let f = (1600.0 / w.max(h) as f32).min(4.0);
            if f > 1.05 {
                scale = f;
                work = ops::resize_rgb(
                    img,
                    (w as f32 * f) as u32,
                    (h as f32 * f) as u32,
                    FilterType::Triangle,
                );
            }
        }
        let (boxes, _) = self.det.detect(&work)?;
        let mut out = Vec::new();
        for b in &boxes {
            let (x0, y0, x1, y1) = b.bbox();
            let bx0 = x0.floor().max(0.0) as u32;
            let by0 = y0.floor().max(0.0) as u32;
            let bx1 = (x1.ceil() as u32).min(work.width().saturating_sub(1));
            let by1 = (y1.ceil() as u32).min(work.height().saturating_sub(1));
            if bx1 <= bx0 + 1 || by1 <= by0 + 1 {
                continue;
            }
            let crop = image::imageops::crop_imm(&work, bx0, by0, bx1 - bx0, by1 - by0).to_image();
            let (text, conf) = self.rec.recognize(&crop)?;
            if text.chars().count() < 1 || conf < conf_min {
                continue;
            }
            let mut pts = b.points;
            for p in &mut pts {
                p[0] /= scale;
                p[1] /= scale;
            }
            out.push(OcrHit {
                text,
                conf,
                box_: pts,
            });
        }
        Ok(out)
    }
}

/// Convenience for tests / callers that already have a detector and boxes.
pub fn crop_box(img: &RgbImage, b: &TextBox) -> RgbImage {
    let (x0, y0, x1, y1) = b.bbox();
    let bx0 = x0.floor().max(0.0) as u32;
    let by0 = y0.floor().max(0.0) as u32;
    let bx1 = (x1.ceil() as u32).min(img.width().saturating_sub(1));
    let by1 = (y1.ceil() as u32).min(img.height().saturating_sub(1));
    let w = (bx1.saturating_sub(bx0)).max(1);
    let h = (by1.saturating_sub(by0)).max(1);
    image::imageops::crop_imm(img, bx0, by0, w, h).to_image()
}
