//! Production wrapper around the v8 pipeline: one engine, one book at a time,
//! seven files per book.
//!
//! The crop route is behaviourally identical to the proven v8 prototype. The
//! inpaint route uses MI-GAN when `Models::migan` is present and falls back to
//! the prototype's flat-ring fill when it is not.

use anyhow::{Context, Result};
use image::{imageops::FilterType, GrayImage, RgbImage};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::crop::{self, SPINE_H, SPINE_W};
use crate::detect::Detector;
use crate::fallback;
use crate::fill::{self, InpaintResult};
use crate::mask;
use crate::migan::Migan;
use crate::ocr::Ocr;
use crate::ops;
use crate::qa;

/// Working side used by the v8 app: det limit 960, work side 720.
pub const MAX_SIDE: u32 = 720;
pub const DET_LIMIT: u32 = 960;

/// Paths to the required models, plus the optional MI-GAN inpaint model.
pub struct Models {
    pub det: PathBuf,
    pub rec: PathBuf,
    pub keys: PathBuf,
    pub migan: Option<PathBuf>,
}

/// The three inputs the rest of the app knows about a book.
pub struct BookInput {
    pub cover: PathBuf,
    pub title: String,
    pub author: String,
    pub pages: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Route {
    Crop,
    Inpaint,
    Fallback,
}

impl Route {
    /// The v8 `run.json` / `qa.json` spelling. The JSON schema is unchanged on
    /// disk; only the public report uses the short contract spelling.
    pub fn as_v8(self) -> &'static str {
        match self {
            Route::Crop => "text-free crop",
            Route::Inpaint => "inpaint",
            Route::Fallback => "fallback",
        }
    }

    pub fn from_v8(s: &str) -> Self {
        match s {
            "text-free crop" => Route::Crop,
            "inpaint" => Route::Inpaint,
            _ => Route::Fallback,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Review,
    Fallback,
}

impl Verdict {
    pub fn from_v8(s: &str) -> Self {
        match s {
            "pass" => Verdict::Pass,
            "review" => Verdict::Review,
            _ => Verdict::Fallback,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Pass => "pass",
            Verdict::Review => "review",
            Verdict::Fallback => "fallback",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Timings {
    pub detection: f64,
    pub mask_total: f64,
    pub inpaint_flat: f64,
    pub inpaint_migan: f64,
    pub crop_search: f64,
    pub qa: f64,
    pub total: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpineReport {
    pub route: Route,
    pub verdict: Verdict,
    pub mask_pct: f32,
    pub timings: Timings,
    /// The v8 `run.json` payload (includes `final.crop_box_work`).
    pub run: serde_json::Value,
    /// The v8 `qa.json` payload.
    pub qa: serde_json::Value,
}

pub struct Engine {
    models: Models,
    inner: Mutex<Inner>,
}

struct Inner {
    det: Detector,
    ocr: Ocr,
    migan: Option<Migan>,
}

impl Engine {
    /// Validate every model path, then load the detector, recogniser and (when
    /// configured) MI-GAN into one process-local engine.
    pub fn new(models: Models) -> Result<Self> {
        require_file(&models.det, "detector")?;
        require_file(&models.rec, "recogniser")?;
        require_file(&models.keys, "recognition dictionary")?;
        if let Some(m) = &models.migan {
            require_file(m, "MI-GAN")?;
        }

        let det_path = path_str(&models.det)?;
        let rec_path = path_str(&models.rec)?;
        let keys_path = path_str(&models.keys)?;
        let det = Detector::new(det_path, DET_LIMIT, "min")?;
        let ocr = Ocr::new(det_path, rec_path, keys_path)?;
        let migan = match &models.migan {
            Some(p) => Some(Migan::new(p)?),
            None => None,
        };

        Ok(Self {
            models,
            inner: Mutex::new(Inner { det, ocr, migan }),
        })
    }

    /// Run the pipeline and write the seven contract files into `out_dir`.
    pub fn generate(&self, input: &BookInput, out_dir: &Path) -> Result<SpineReport> {
        if !input.cover.is_file() {
            anyhow::bail!(
                "cover not found: {} (no spine job was started)",
                input.cover.display()
            );
        }
        std::fs::create_dir_all(out_dir)
            .with_context(|| format!("create output directory {}", out_dir.display()))?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| anyhow::anyhow!("spine engine lock poisoned"))?;
        inner.run(input, out_dir)
    }

    pub fn models(&self) -> &Models {
        &self.models
    }
}

impl Inner {
    fn run(&mut self, input: &BookInput, out_dir: &Path) -> Result<SpineReport> {
        let t_all = Instant::now();
        let src = image::open(&input.cover)
            .with_context(|| format!("open cover {}", input.cover.display()))?
            .to_rgb8();
        let (src_w, src_h) = src.dimensions();

        // --- detection + mask ------------------------------------------------
        let t0 = Instant::now();
        let (mask_full, boxes, det_s) = mask::build_mask(&mut self.det, &src)?;
        let mask_s = t0.elapsed().as_secs_f64();

        let det_text = self.ocr.texts(&src, 0.5)?;

        let (src_work, work_mask, (ww, wh), scale) =
            fill::prepare_work(&src, &mask_full, MAX_SIDE)?;

        // --- text-free crop search (before any inpainting) -------------------
        let t0 = Instant::now();
        let (crop_opt, crop_checks) =
            crop::pick_text_free_crop(&src_work, &work_mask, &mut self.ocr, 5)?;
        let crop_s = t0.elapsed().as_secs_f64();

        let qa_start = Instant::now();
        let crop_img = crop_opt.as_ref().map(|c| crop::crop_box(&src_work, c.box_));
        let crop_metrics = match &crop_img {
            Some(ci) => {
                let mut m = qa::qa_report(
                    &src_work,
                    &src_work,
                    &work_mask,
                    ci,
                    crop_opt.as_ref().unwrap().box_,
                    &mut self.ocr,
                    true,
                )?;
                m.score = crop_opt.as_ref().unwrap().score;
                Some(m)
            }
            None => None,
        };
        let crop_dec = match &crop_metrics {
            Some(m) => qa::decide("crop", m),
            None => qa::Decision {
                verdict: "fallback".into(),
                reasons: vec!["no zero-coverage crop candidate".into()],
            },
        };

        // --- inpaint route (only reached when the crop does not pass) --------
        let mut art = src_work.clone();
        let mut flat_s = 0.0f64;
        let mut migan_s = 0.0f64;
        let mut flat_pct = 0.0f32;
        let mut migan_available = false;
        let mut art_metrics_opt = None;
        let mut art_dec_opt = None;
        let mut visual_opt = None;
        let mut art_crop_img_opt = None;

        if crop_dec.verdict != "pass" {
            let InpaintResult {
                art: filled_art,
                flat_s: fs,
                migan_s: ms,
                flat_pct: fp,
                migan_available: ma,
                ..
            } = fill::inpaint(&src, &mask_full, MAX_SIDE, self.migan.as_mut())?;
            art = filled_art;
            flat_s = fs;
            migan_s = ms;
            flat_pct = fp;
            migan_available = ma;

            let visual = crop::best_visual_crop(&art, None);
            let art_crop = crop::crop_box(&art, visual.box_);
            let mut m = qa::qa_report(
                &src_work,
                &art,
                &work_mask,
                &art_crop,
                visual.box_,
                &mut self.ocr,
                false,
            )?;
            m.score = visual.score;
            art_dec_opt = Some(qa::decide("inpaint", &m));
            art_metrics_opt = Some(m);
            visual_opt = Some(visual);
            art_crop_img_opt = Some(art_crop);
        }
        let qa_s = qa_start.elapsed().as_secs_f64();

        // --- choose the route exactly as v8 does -----------------------------
        let rank = |v: &str| match v {
            "pass" => 2,
            "review" => 1,
            _ => 0,
        };
        let (v8_route, chosen_metrics, chosen_dec, chosen_crop, chosen_box) =
            if crop_dec.verdict == "pass" {
                (
                    "text-free crop",
                    crop_metrics.clone().unwrap(),
                    crop_dec.clone(),
                    crop_img.clone().unwrap(),
                    crop_opt.as_ref().unwrap().box_,
                )
            } else if let (Some(am), Some(ad), Some(vis), Some(aci)) = (
                art_metrics_opt.clone(),
                art_dec_opt.clone(),
                visual_opt.clone(),
                art_crop_img_opt.clone(),
            ) {
                if let Some(cm) = &crop_metrics {
                    if rank(&crop_dec.verdict) > rank(&ad.verdict) {
                        (
                            "text-free crop",
                            cm.clone(),
                            crop_dec.clone(),
                            crop_img.clone().unwrap(),
                            crop_opt.as_ref().unwrap().box_,
                        )
                    } else if rank(&ad.verdict) > 0 {
                        ("inpaint", am, ad, aci, vis.box_)
                    } else if rank(&crop_dec.verdict) > 0 {
                        (
                            "text-free crop",
                            cm.clone(),
                            crop_dec.clone(),
                            crop_img.clone().unwrap(),
                            crop_opt.as_ref().unwrap().box_,
                        )
                    } else {
                        (
                            "fallback",
                            am,
                            qa::Decision {
                                verdict: "fallback".into(),
                                reasons: ad.reasons.clone(),
                            },
                            aci,
                            vis.box_,
                        )
                    }
                } else if rank(&ad.verdict) > 0 {
                    ("inpaint", am, ad, aci, vis.box_)
                } else {
                    (
                        "fallback",
                        am,
                        qa::Decision {
                            verdict: "fallback".into(),
                            reasons: ad.reasons.clone(),
                        },
                        aci,
                        vis.box_,
                    )
                }
            } else {
                unreachable!("inpaint path must produce art metrics")
            };

        let route = Route::from_v8(v8_route);
        let verdict = Verdict::from_v8(&chosen_dec.verdict);

        let spine = ops::resize_rgb(&chosen_crop, SPINE_W, SPINE_H, FilterType::Lanczos3);
        let spine2 = ops::resize_rgb(&spine, SPINE_W * 2, SPINE_H * 2, FilterType::Nearest);
        let fallback = fallback::fallback_spine(&input.title, &input.author);

        // --- exactly the seven contract files --------------------------------
        save_jpg(&out_dir.join("source.jpg"), &src, 92)?;
        save_jpg(&out_dir.join("art.jpg"), &art, 92)?;
        save_jpg(&out_dir.join("spine-2x.jpg"), &spine2, 92)?;
        save_jpg(&out_dir.join("fallback-spine.jpg"), &fallback, 92)?;
        save_png(&out_dir.join("mask.png"), &mask_full)?;

        let total_s = t_all.elapsed().as_secs_f64();
        let timings = Timings {
            detection: round2(det_s),
            mask_total: round2(mask_s),
            inpaint_flat: round2(flat_s),
            inpaint_migan: round2(migan_s),
            crop_search: round2(crop_s),
            qa: round2(qa_s),
            total: round2(total_s),
        };

        let text_remover = if migan_available {
            "MI-GAN migan_pipeline_v2.onnx + flat-ring fill"
        } else if self.migan.is_some() {
            // The crop route passed, so MI-GAN was never needed.
            "MI-GAN ready (crop route; no fill needed)"
        } else {
            "flat-ring fill + local substitute (MI-GAN not configured)"
        };

        let report = json!({
            "slug": slugify(&input.title),
            "engine": "rust/ort/pocketlibrary-spine",
            "book": {
                "title": input.title,
                "author": input.author,
                "pages": input.pages,
                "cover": input.cover.display().to_string(),
            },
            "generated_epoch": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
            "route": v8_route,
            "verdict": chosen_dec.verdict,
            "decision_reasons": chosen_dec.reasons,
            "manual_intervention": 0,
            "model": {
                "text_detector": "PP-OCRv3 DBNet (det.onnx, ONNX Runtime)",
                "text_remover": text_remover,
                "ocr_qa": "PP-OCRv3 recogniser (rec.onnx)",
                "crop_search": "integral-image spine-aspect scan + residual OCR",
            },
            "runtime_s": {
                "detection": timings.detection,
                "mask_total": timings.mask_total,
                "inpaint_flat": timings.inpaint_flat,
                "inpaint_migan": timings.inpaint_migan,
                // Retained for v8-app schema compatibility; MI-GAN replaces LaMa.
                "inpaint_lama": 0.0,
                "crop_search": timings.crop_search,
                "qa": timings.qa,
                "total": timings.total,
            },
            "source": { "width": src_w, "height": src_h },
            "working": { "width": ww, "height": wh, "scale": round2(scale) },
            "mask": {
                "coverage_pct": round2(pct(mask_full.as_raw())),
                "components": count_components(&mask_full),
                "detection_boxes": boxes.len(),
                "flat_fill_pct": round2(flat_pct),
            },
            "detected_text": det_text,
            "crop_options": {
                "text_free": crop_opt,
                "text_free_ocr_checks": crop_checks,
                "inpaint_visual": visual_opt,
            },
            "qa": {
                "chosen": chosen_metrics,
                "text_free": crop_metrics,
                "inpaint": art_metrics_opt,
            },
            "final": {
                "route": v8_route,
                "verdict": chosen_dec.verdict,
                "spine": "spine-2x.jpg",
                "spine_2x": "spine-2x.jpg",
                "fallback_spine": "fallback-spine.jpg",
                "crop_box_work": chosen_box,
                "mask_coverage_in_crop_pct": chosen_metrics.crop_mask_coverage_pct,
            },
        });
        let qa = json!({
            "qa": report["qa"],
            "decision": {
                "route": v8_route,
                "verdict": chosen_dec.verdict,
                "reasons": chosen_dec.reasons,
            }
        });
        std::fs::write(
            out_dir.join("run.json"),
            serde_json::to_string_pretty(&report)?,
        )?;
        std::fs::write(out_dir.join("qa.json"), serde_json::to_string_pretty(&qa)?)?;

        Ok(SpineReport {
            route,
            verdict,
            mask_pct: pct(mask_full.as_raw()),
            timings,
            run: report,
            qa,
        })
    }
}

fn require_file(path: &Path, role: &str) -> Result<()> {
    if !path.is_file() {
        anyhow::bail!("{role} model not found: {}", path.display());
    }
    Ok(())
}

fn path_str(path: &Path) -> Result<&str> {
    path.to_str()
        .with_context(|| format!("model path is not valid UTF-8: {}", path.display()))
}

fn pct(raw: &[u8]) -> f32 {
    raw.iter().filter(|v| **v > 0).count() as f32 / raw.len().max(1) as f32 * 100.0
}

fn count_components(mask: &GrayImage) -> usize {
    let (w, h) = mask.dimensions();
    ops::connected_components(mask.as_raw(), w as usize, h as usize)
        .1
        .len()
}

fn round2(v: impl Into<f64>) -> f64 {
    let v: f64 = v.into();
    (v * 100.0).round() / 100.0
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "book".into()
    } else {
        out
    }
}

pub fn save_jpg(path: &Path, img: &RgbImage, quality: u8) -> Result<()> {
    let file = std::fs::File::create(path)?;
    let mut w = std::io::BufWriter::new(file);
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, quality);
    enc.encode_image(img)?;
    Ok(())
}

pub fn save_png(path: &Path, img: &GrayImage) -> Result<()> {
    img.save(path)?;
    Ok(())
}
