//! PP-OCRv3 DBNet text detection through ONNX Runtime.

use anyhow::{Context, Result};
use image::RgbImage;
use ndarray::Dimension;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;

use crate::ops;

#[derive(Clone, Debug, serde::Serialize)]
pub struct TextBox {
    pub points: [[f32; 2]; 4],
    pub score: f32,
}

impl TextBox {
    pub fn bbox(&self) -> (f32, f32, f32, f32) {
        ops::bbox_of(&self.points)
    }
    pub fn angle(&self) -> f32 {
        ops::quad_angle(&self.points)
    }
}

pub struct Detector {
    session: Session,
    pub limit_side: u32,
    pub limit_type: String,
    pub thresh: f32,
    pub box_thresh: f32,
    pub unclip_ratio: f32,
    pub use_dilation: bool,
    pub max_candidates: usize,
}

impl Detector {
    pub fn new(model: &str, limit_side: u32, limit_type: &str) -> Result<Self> {
        let session = Session::builder(crate::ort_env::shared())?
            .with_execution_providers([ort::ep::CPU::default().with_arena_allocator(false).build()])
            .map_err(|e| anyhow::anyhow!("ort ep: {e}"))?
            .with_intra_threads(num_threads())
            .map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|e| anyhow::anyhow!("ort builder: {e}"))?
            .commit_from_file(model)
            .with_context(|| format!("load detector {model}"))?;
        Ok(Self {
            session,
            limit_side,
            limit_type: limit_type.to_string(),
            thresh: 0.18,
            box_thresh: 0.28,
            unclip_ratio: 1.9,
            use_dilation: true,
            max_candidates: 1000,
        })
    }

    /// Resize following PaddleOCR's `DetResizeForTest` type 0 and return
    /// `(image, resize_w, resize_h)`.
    pub fn preprocess(&self, img: &RgbImage) -> RgbImage {
        let (w, h) = img.dimensions();
        let (mut rw, mut rh) = (w as f32, h as f32);
        let ratio = if self.limit_type == "max" {
            let m = w.max(h) as f32;
            if m > self.limit_side as f32 {
                self.limit_side as f32 / m
            } else {
                1.0
            }
        } else {
            let m = w.min(h) as f32;
            if m < self.limit_side as f32 {
                self.limit_side as f32 / m
            } else {
                1.0
            }
        };
        rw *= ratio;
        rh *= ratio;
        rw = (rw / 32.0).round() * 32.0;
        rh = (rh / 32.0).round() * 32.0;
        ops::resize_rgb(
            img,
            rw.max(32.0) as u32,
            rh.max(32.0) as u32,
            image::imageops::FilterType::Triangle,
        )
    }

    pub fn run_map(&mut self, img: &RgbImage) -> Result<(Vec<f32>, usize, usize)> {
        let (w, h) = img.dimensions();
        let (w, h) = (w as usize, h as usize);
        let mut data = vec![0.0f32; 3 * w * h];
        let mean = [0.485f32, 0.456, 0.406];
        let std = [0.229f32, 0.224, 0.225];
        for (x, y, p) in img.enumerate_pixels() {
            for c in 0..3 {
                data[c * w * h + y as usize * w + x as usize] =
                    (p[c] as f32 / 255.0 - mean[c]) / std[c];
            }
        }
        let tensor = Tensor::<f32>::from_array((vec![1i64, 3, h as i64, w as i64], data))?;
        let outputs = self.session.run(ort::inputs![tensor])?;
        let (shape, vals) = outputs[0].try_extract_tensor::<f32>()?;
        let dims = shape.to_ixdyn();
        let (oh, ow) = if dims.ndim() == 4 {
            (dims[2], dims[3])
        } else {
            (h, w)
        };
        Ok((vals.to_vec(), ow, oh))
    }

    /// Full detection. Returns boxes in source-image coordinates plus elapsed
    /// seconds for the inference call only.
    pub fn detect(&mut self, img: &RgbImage) -> Result<(Vec<TextBox>, f64)> {
        let t0 = std::time::Instant::now();
        let resized = self.preprocess(img);
        let (rw, rh) = resized.dimensions();
        let (prob, pw, ph) = self.run_map(&resized)?;
        let secs = t0.elapsed().as_secs_f64();
        let _ = (rw, rh);
        debug_assert_eq!((pw, ph), (rw as usize, rh as usize));

        // binarise + 2x2 dilation (PaddleOCR `use_dilation`)
        let mut bin = vec![0u8; pw * ph];
        for i in 0..pw * ph {
            if prob[i] > self.thresh {
                bin[i] = 255;
            }
        }
        if self.use_dilation {
            let src = bin.clone();
            for y in 0..ph {
                for x in 0..pw {
                    let mut v = src[y * pw + x];
                    if y + 1 < ph {
                        v = v.max(src[(y + 1) * pw + x]);
                    }
                    if x + 1 < pw {
                        v = v.max(src[y * pw + x + 1]);
                    }
                    if x + 1 < pw && y + 1 < ph {
                        v = v.max(src[(y + 1) * pw + x + 1]);
                    }
                    bin[y * pw + x] = v;
                }
            }
        }

        let (labels, comps) = ops::connected_components(&bin, pw, ph);
        let mut boxes: Vec<TextBox> = Vec::new();
        let (src_w, src_h) = img.dimensions();
        for c in comps.iter().take(self.max_candidates) {
            let cw = (c.x1 - c.x0 + 1) as f32;
            let ch = (c.y1 - c.y0 + 1) as f32;
            if cw.min(ch) < 3.0 {
                continue;
            }
            // score: mean probability over the component's own pixels
            let mut score_sum = 0.0f64;
            let mut score_n = 0usize;
            for y in c.y0..=c.y1 {
                for x in c.x0..=c.x1 {
                    if labels[y * pw + x] == c.label {
                        score_sum += prob[y * pw + x] as f64;
                        score_n += 1;
                    }
                }
            }
            let score = if score_n == 0 {
                0.0
            } else {
                (score_sum / score_n as f64) as f32
            };
            if score < self.box_thresh {
                continue;
            }
            // Axis-aligned expansion. Book text is overwhelmingly horizontal,
            // and an axis-aligned box keeps the line grouping stable when the
            // detector only finds some glyphs in a word. (The Python reference
            // gets the same effect because OpenCV's minAreaRect usually
            // returns a near-axis-aligned box for glyph contours.)
            let distance = cw * ch * self.unclip_ratio / (2.0 * (cw + ch));
            let ex_w = cw + 2.0 * distance;
            let ex_h = ch + 2.0 * distance;
            if ex_w.min(ex_h) < 5.0 {
                continue;
            }
            let cx = (c.x0 as f32 + c.x1 as f32) * 0.5 + 0.5;
            let cy = (c.y0 as f32 + c.y1 as f32) * 0.5 + 0.5;
            let mut corners = ops::rect_corners([cx, cy], [ex_w, ex_h], 0.0);
            let sx = src_w as f32 / pw as f32;
            let sy = src_h as f32 / ph as f32;
            for p in &mut corners {
                p[0] = (p[0] * sx).clamp(0.0, src_w as f32 - 1.0);
                p[1] = (p[1] * sy).clamp(0.0, src_h as f32 - 1.0);
            }
            let ordered = ops::order_clockwise(corners.to_vec());
            let bw = (ordered[0][0] - ordered[1][0]).hypot(ordered[0][1] - ordered[1][1]);
            let bh = (ordered[0][0] - ordered[3][0]).hypot(ordered[0][1] - ordered[3][1]);
            if bw <= 3.0 || bh <= 3.0 {
                continue;
            }
            boxes.push(TextBox {
                points: ordered,
                score,
            });
        }
        // stable reading order
        boxes.sort_by(|a, b| {
            let ay = a.points[0][1];
            let by = b.points[0][1];
            ay.partial_cmp(&by)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(
                    a.points[0][0]
                        .partial_cmp(&b.points[0][0])
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
        });
        Ok((boxes, secs))
    }
}

fn num_threads() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().clamp(1, 2))
        .unwrap_or(2)
}
