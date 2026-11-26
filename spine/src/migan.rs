//! MI-GAN text removal (`migan_pipeline_v2.onnx`).
//!
//! The shipped model takes **uint8** NCHW tensors:
//!
//! * `image` `[N, 3, H, W]`
//! * `mask`  `[N, 1, H, W]` with **255 = keep / known, 0 = hole**
//!
//! The pipeline mask uses the opposite convention (255 = text), so it is
//! inverted here. Both tensors are letterboxed into a fixed 512 x 512 canvas
//! with black padding (and 255 "keep" padding in the mask), then the result is
//! cropped back to the working image. This mirrors the proven Python
//! evaluation and the LaMa path in the v8 prototype.

use anyhow::{Context, Result};
use image::{imageops::FilterType, GrayImage, Rgb, RgbImage};
use ndarray::Dimension;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use sha2::{Digest, Sha256};

use crate::ops;

/// Size the app pins the dynamic graph to.
pub const MIGAN_SIZE: u32 = 512;

/// SHA-256 of the shipped `migan_pipeline_v2.onnx` (28,079,181 bytes).
pub const MIGAN_SHA256: &str = "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b";

pub struct Migan {
    session: Session,
}

impl Migan {
    /// Load and verify the MI-GAN model. A partial or corrupt download is
    /// rejected before the graph is built.
    pub fn new(model: &std::path::Path) -> Result<Self> {
        verify_sha256(model, MIGAN_SHA256)?;
        let session = Session::builder(crate::ort_env::shared())?
            .with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()])
            .map_err(|e| anyhow::anyhow!("ort ep: {e}"))?
            .with_intra_threads(
                std::thread::available_parallelism()
                    .map(|n| n.get().clamp(1, 4))
                    .unwrap_or(2),
            )
            .map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .commit_from_file(model)
            .with_context(|| format!("load MI-GAN {}", model.display()))?;
        Ok(Self { session })
    }

    /// Fill `hole_mask` (255 = hole) in `img`. The returned image has the same
    /// dimensions; callers normally copy back only the hole pixels.
    pub fn inpaint(&mut self, img: &RgbImage, hole_mask: &GrayImage) -> Result<RgbImage> {
        let (w, h) = img.dimensions();
        let scale = (MIGAN_SIZE as f32 / w as f32).min(MIGAN_SIZE as f32 / h as f32);
        let nw = ((w as f32 * scale).round() as u32).clamp(1, MIGAN_SIZE);
        let nh = ((h as f32 * scale).round() as u32).clamp(1, MIGAN_SIZE);
        let scaled = ops::resize_rgb(img, nw, nh, FilterType::Triangle);
        let scaled_holes = ops::resize_gray(hole_mask, nw, nh, FilterType::Nearest);

        let mut canvas = RgbImage::new(MIGAN_SIZE, MIGAN_SIZE);
        let mut mcanvas = GrayImage::from_pixel(MIGAN_SIZE, MIGAN_SIZE, image::Luma([255]));
        let ox = (MIGAN_SIZE - nw) / 2;
        let oy = (MIGAN_SIZE - nh) / 2;
        image::imageops::replace(&mut canvas, &scaled, ox as i64, oy as i64);
        image::imageops::replace(&mut mcanvas, &scaled_holes, ox as i64, oy as i64);

        let side = (MIGAN_SIZE * MIGAN_SIZE) as usize;
        let mut idata = vec![0u8; 3 * side];
        let mut mdata = vec![255u8; side];
        for (x, y, p) in canvas.enumerate_pixels() {
            let i = y as usize * MIGAN_SIZE as usize + x as usize;
            idata[i] = p[0];
            idata[side + i] = p[1];
            idata[2 * side + i] = p[2];
            // v8 mask: 255 = hole. MI-GAN: 255 = keep, so invert.
            mdata[i] = 255 - mcanvas.get_pixel(x, y)[0];
        }

        let image_t =
            Tensor::<u8>::from_array((vec![1i64, 3, MIGAN_SIZE as i64, MIGAN_SIZE as i64], idata))?;
        let mask_t =
            Tensor::<u8>::from_array((vec![1i64, 1, MIGAN_SIZE as i64, MIGAN_SIZE as i64], mdata))?;
        let outputs = self.session.run(ort::inputs![image_t, mask_t])?;
        let (shape, vals) = outputs[0].try_extract_tensor::<u8>()?;
        let dims = shape.to_ixdyn();
        if dims.ndim() != 4 {
            anyhow::bail!("unexpected MI-GAN output rank {}", dims.ndim());
        }
        let oh = dims[2] as usize;
        let ow = dims[3] as usize;
        let mut full = RgbImage::new(ow as u32, oh as u32);
        for y in 0..oh {
            for x in 0..ow {
                let i = y * ow + x;
                let r = vals[i];
                let g = vals[oh * ow + i];
                let b = vals[2 * oh * ow + i];
                full.put_pixel(x as u32, y as u32, Rgb([r, g, b]));
            }
        }
        let region = image::imageops::crop_imm(&full, ox, oy, nw, nh).to_image();
        Ok(ops::resize_rgb(&region, w, h, FilterType::Triangle))
    }
}

/// Verify a file against an expected lowercase hex SHA-256.
pub fn verify_sha256(path: &std::path::Path, expected: &str) -> Result<()> {
    let bytes = std::fs::read(path).with_context(|| format!("read model {}", path.display()))?;
    let digest = Sha256::digest(&bytes);
    let mut got = String::with_capacity(64);
    for b in digest {
        got.push_str(&format!("{b:02x}"));
    }
    if !got.eq_ignore_ascii_case(expected) {
        anyhow::bail!(
            "model {} failed SHA-256 verification (expected {expected}, got {got})",
            path.display()
        );
    }
    Ok(())
}
