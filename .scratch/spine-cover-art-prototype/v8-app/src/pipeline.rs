//! One-cover orchestration: detect -> mask -> fill -> crop -> QA -> fallback.

use anyhow::{Context, Result};
use image::{imageops::FilterType, GrayImage, RgbImage};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::crop::{self, SPINE_H, SPINE_W};
use crate::detect::Detector;
use crate::fallback;
use crate::fill::{self, Lama};
use crate::mask;
use crate::ocr::Ocr;
use crate::ops;
use crate::qa;

pub struct Pipeline {
    pub det: Detector,
    pub ocr: Ocr,
    pub lama: Option<Lama>,
    pub max_side: u32,
    pub python_assets: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub struct BookInput {
    pub cover: PathBuf,
    pub slug: String,
    pub title: String,
    pub author: String,
    pub pages: u32,
}

impl Pipeline {
    pub fn new(
        det_model: &str,
        rec_model: &str,
        keys: &str,
        lama_model: Option<&str>,
        max_side: u32,
        det_limit: u32,
    ) -> Result<Self> {
        Ok(Self {
            det: Detector::new(det_model, det_limit, "min")?,
            ocr: Ocr::new(det_model, rec_model, keys)?,
            lama: match lama_model {
                Some(p) => Some(Lama::new(p)?),
                None => None,
            },
            max_side,
            python_assets: None,
        })
    }

    pub fn run(&mut self, input: &BookInput, out_root: &Path) -> Result<serde_json::Value> {
        let t_all = Instant::now();
        let src = image::open(&input.cover)
            .with_context(|| format!("open cover {}", input.cover.display()))?
            .to_rgb8();
        let (src_w, src_h) = src.dimensions();
        let run_dir = out_root.join(&input.slug);
        std::fs::create_dir_all(&run_dir)?;

        let t0 = Instant::now();
        let (mask_full, boxes, det_s) = mask::build_mask(&mut self.det, &src)?;
        let mask_s = t0.elapsed().as_secs_f64();

        let det_text = self.ocr.texts(&src, 0.5)?;

        // Prepare the working image once. Crop search runs before any
        // inpainting: on 4 of the 5 v8 covers a text-free crop passes, so the
        // expensive LaMa pass is skipped entirely.
        let (src_work, work_mask, (ww, wh), scale) =
            fill::prepare_work(&src, &mask_full, self.max_side)?;

        let mask_preview = mask::mask_overlay(&src, &mask_full);
        let work_preview = mask::mask_overlay(&src_work, &work_mask);

        let t0 = Instant::now();
        let (crop_opt, crop_checks) =
            crop::pick_text_free_crop(&src_work, &work_mask, &mut self.ocr, 5)?;
        let crop_s = t0.elapsed().as_secs_f64();

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

        let mut art = src_work.clone();
        let mut flat_s = 0.0f64;
        let mut lama_s = 0.0f64;
        let mut flat_pct = 0.0f32;
        let mut lama_available = false;
        let mut flat_mask_opt: Option<GrayImage> = None;
        let mut art_metrics_opt = None;
        let mut art_dec_opt = None;
        let mut visual_opt = None;
        let mut art_crop_img_opt = None;

        if crop_dec.verdict != "pass" {
            let inp = fill::inpaint(&src, &mask_full, self.max_side, self.lama.as_mut())?;
            art = inp.art;
            flat_s = inp.flat_s;
            lama_s = inp.lama_s;
            flat_pct = inp.flat_pct;
            lama_available = inp.lama_available;
            flat_mask_opt = Some(inp.flat_mask);

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

        let rank = |v: &str| match v {
            "pass" => 2,
            "review" => 1,
            _ => 0,
        };
        let (route, chosen_metrics, chosen_dec, chosen_crop, chosen_box) =
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
                        ("text-free crop", cm.clone(), crop_dec.clone(), crop_img.clone().unwrap(), crop_opt.as_ref().unwrap().box_)
                    } else if rank(&ad.verdict) > 0 {
                        ("inpaint", am, ad, aci, vis.box_)
                    } else if rank(&crop_dec.verdict) > 0 {
                        ("text-free crop", cm.clone(), crop_dec.clone(), crop_img.clone().unwrap(), crop_opt.as_ref().unwrap().box_)
                    } else {
                        ("fallback", am, qa::Decision { verdict: "fallback".into(), reasons: ad.reasons.clone() }, aci, vis.box_)
                    }
                } else if rank(&ad.verdict) > 0 {
                    ("inpaint", am, ad, aci, vis.box_)
                } else {
                    ("fallback", am, qa::Decision { verdict: "fallback".into(), reasons: ad.reasons.clone() }, aci, vis.box_)
                }
            } else {
                unreachable!("inpaint path must produce art metrics")
            };

        let spine = ops::resize_rgb(&chosen_crop, SPINE_W, SPINE_H, FilterType::Lanczos3);
        let spine2 = ops::resize_rgb(&spine, SPINE_W * 2, SPINE_H * 2, FilterType::Nearest);
        let fallback = fallback::fallback_spine(&input.title, &input.author);

        // Save per-book assets
        save_jpg(&run_dir.join("source.jpg"), &src, 92)?;
        save_png(&run_dir.join("mask.png"), &mask_full)?;
        save_png(&run_dir.join("mask-work.png"), &work_mask)?;
        if let Some(fm) = &flat_mask_opt {
            save_png(&run_dir.join("flat-mask.png"), fm)?;
        }
        save_jpg(&run_dir.join("mask-preview.jpg"), &mask_preview, 92)?;
        save_jpg(&run_dir.join("mask-work-preview.jpg"), &work_preview, 92)?;
        save_jpg(&run_dir.join("art.jpg"), &art, 92)?;
        save_jpg(&run_dir.join("crop-native.jpg"), &chosen_crop, 92)?;
        save_jpg(&run_dir.join("spine.jpg"), &spine, 92)?;
        save_jpg(&run_dir.join("spine-2x.jpg"), &spine2, 92)?;
        save_jpg(&run_dir.join("fallback-spine.jpg"), &fallback, 92)?;
        if let Some(ci) = &crop_img {
            save_jpg(&run_dir.join("text-free-crop.jpg"), ci, 92)?;
        }
        let filled = route == "inpaint" || route == "fallback";
        let sheet = fallback::contact_sheet(&src_work, &work_preview, &art, &spine, &fallback, &input.title, filled);
        save_jpg(&run_dir.join("compare.jpg"), &sheet, 92)?;

        // Optional comparison to the Python v8 spine at 52 x 236.
        let compare = self
            .python_assets
            .as_ref()
            .map(|root| root.join(&input.slug).join("spine.jpg"))
            .filter(|p| p.exists())
            .map(|p| compare_spines(&spine, &p))
            .transpose()?;

        let report = json!({
            "slug": input.slug,
            "engine": "rust/ort",
            "book": {
                "title": input.title,
                "author": input.author,
                "pages": input.pages,
                "cover": input.cover.display().to_string(),
            },
            "generated_epoch": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
            "route": route,
            "verdict": chosen_dec.verdict,
            "decision_reasons": chosen_dec.reasons,
            "manual_intervention": 0,
            "model": {
                "text_detector": "PP-OCRv3 DBNet (det.onnx, ONNX Runtime)",
                "text_remover": if lama_available { "LaMa big-lama ONNX + flat-ring fill" } else { "flat-ring fill + local substitute (LaMa not downloaded)" },
                "ocr_qa": "PP-OCRv3 recogniser (rec.onnx)",
                "crop_search": "integral-image spine-aspect scan + residual OCR",
            },
            "runtime_s": {
                "detection": round2(det_s),
                "mask_total": round2(mask_s),
                "inpaint_flat": round2(flat_s),
                "inpaint_lama": round2(lama_s),
                "crop_search": round2(crop_s),
                "total": round2(t_all.elapsed().as_secs_f64()),
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
                "route": route,
                "verdict": chosen_dec.verdict,
                "spine": format!("{}/spine.jpg", input.slug),
                "spine_2x": format!("{}/spine-2x.jpg", input.slug),
                "fallback_spine": format!("{}/fallback-spine.jpg", input.slug),
                "crop_box_work": chosen_box,
                "mask_coverage_in_crop_pct": chosen_metrics.crop_mask_coverage_pct,
            },
            "compare_python": compare,
        });
        std::fs::write(run_dir.join("run.json"), serde_json::to_string_pretty(&report)?)?;
        std::fs::write(
            run_dir.join("qa.json"),
            serde_json::to_string_pretty(&json!({
                "qa": report["qa"],
                "decision": {
                    "route": route,
                    "verdict": chosen_dec.verdict,
                    "reasons": chosen_dec.reasons,
                }
            }))?,
        )?;
        Ok(report)
    }
}

fn compare_spines(rust: &RgbImage, python_path: &Path) -> Result<serde_json::Value> {
    let py = image::open(python_path)?.to_rgb8();
    let py = ops::resize_rgb(&py, SPINE_W, SPINE_H, FilterType::Lanczos3);
    let a = rust.as_raw();
    let b = py.as_raw();
    let mut mae = 0.0f64;
    let mut mse = 0.0f64;
    let mut dot = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..a.len() {
        let d = a[i] as f64 - b[i] as f64;
        mae += d.abs();
        mse += d * d;
        dot += a[i] as f64 * b[i] as f64;
        na += (a[i] as f64).powi(2);
        nb += (b[i] as f64).powi(2);
    }
    let n = a.len() as f64;
    let mae = mae / n;
    let mse = mse / n;
    let psnr = if mse <= 1e-9 { 99.0 } else { 10.0 * (255.0f64 * 255.0 / mse).log10() };
    Ok(json!({
        "python_spine": python_path.display().to_string(),
        "mae": round2(mae as f32),
        "psnr_db": round2(psnr as f32),
        "correlation": round2((dot / (na.sqrt() * nb.sqrt() + 1e-9)) as f32),
        "size": [SPINE_W, SPINE_H],
    }))
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

/// Build the self-contained gallery at v8-app/index.html.
pub fn build_gallery(out_root: &Path, python_root: &Path) -> Result<usize> {
    let mut runs: Vec<serde_json::Value> = Vec::new();
    for entry in std::fs::read_dir(out_root)? {
        let p = entry?.path();
        let rj = p.join("run.json");
        if rj.exists() {
            let txt = std::fs::read_to_string(&rj)?;
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                runs.push(v);
            }
        }
    }
    let order = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"];
    runs.sort_by_key(|r| {
        let slug = r["slug"].as_str().unwrap_or("");
        order.iter().position(|s| *s == slug).unwrap_or(usize::MAX)
    });
    let mut cards = String::new();
    for r in &runs {
        let slug = r["slug"].as_str().unwrap_or("");
        let title = r["book"]["title"].as_str().unwrap_or(slug);
        let author = r["book"]["author"].as_str().unwrap_or("");
        let route = r["route"].as_str().unwrap_or("");
        let verdict = r["verdict"].as_str().unwrap_or("");
        let mask_pct = r["mask"]["coverage_pct"].as_f64().unwrap_or(0.0);
        let total = r["runtime_s"]["total"].as_f64().unwrap_or(0.0);
        let det = r["runtime_s"]["detection"].as_f64().unwrap_or(0.0);
        let python_spine = python_root.join(slug).join("spine.jpg");
        let py_ref = if python_spine.exists() {
            format!("<figure><img src=\"../v8-auto/assets/{slug}/spine.jpg\" alt=\"Python v8 spine\" loading=\"lazy\"><figcaption>Python v8</figcaption></figure>")
        } else {
            String::new()
        };
        let cmp = &r["compare_python"];
        let cmp_html = if cmp.is_null() {
            String::new()
        } else {
            format!(
                "<p class=\"cmp\">vs Python v8: MAE {} · PSNR {} dB · corr {}</p>",
                cmp["mae"], cmp["psnr_db"], cmp["correlation"]
            )
        };
        let reasons = r["decision_reasons"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join("; "))
            .unwrap_or_default();
        let fill_label = if route == "text-free crop" { "Art (no fill)" } else { "Fill" };
        let sq = &r["qa"]["chosen"]["spine"];
        let qa_html = format!(
            "QA: spine luma σ {:.1} · edge {:.3} · seam {:.2} · palette corr {:.2}",
            sq["luma_std"].as_f64().unwrap_or(0.0),
            sq["edge_density"].as_f64().unwrap_or(0.0),
            r["qa"]["chosen"]["seam"]["seam_ratio"].as_f64().unwrap_or(0.0),
            r["qa"]["chosen"]["palette_corr"].as_f64().unwrap_or(0.0)
        );
        let lama = r["runtime_s"]["inpaint_lama"].as_f64().unwrap_or(0.0);
        let fill_note = if lama > 0.0 { format!("LaMa {lama:.1} s") } else { "no LaMa".to_string() };
        cards.push_str(&format!(
            r#"<article class="book {verdict}">
  <header><h2>{title}</h2><p>{author}</p>
  <p class="tags"><span class="route">{route}</span><span class="verdict {verdict}">{verdict}</span>
  <span class="metric">mask {mask_pct:.1}%</span><span class="metric">{total:.1} s</span><span class="metric">det {det:.1} s</span><span class="metric">{fill_note}</span></p></header>
  <div class="strip">
    <figure><img src="out/{slug}/source.jpg" alt="original" loading="lazy"><figcaption>Original</figcaption></figure>
    <figure><img src="out/{slug}/mask-work-preview.jpg" alt="mask" loading="lazy"><figcaption>Mask</figcaption></figure>
    <figure><img src="out/{slug}/art.jpg" alt="fill" loading="lazy"><figcaption>{fill_label}</figcaption></figure>
    <figure><img src="out/{slug}/crop-native.jpg" alt="chosen crop" loading="lazy"><figcaption>Chosen crop</figcaption></figure>
    <figure class="spine"><img src="out/{slug}/spine-2x.jpg" alt="spine" loading="lazy"><figcaption>Spine 2×</figcaption></figure>
    <figure class="spine"><img src="out/{slug}/fallback-spine.jpg" alt="fallback" loading="lazy"><figcaption>Fallback</figcaption></figure>
    {py_ref}
  </div>
  <p class="why">{reasons}</p>
  <p class="cmp">{qa_html}</p>{cmp_html}
  <p class="links"><a href="out/{slug}/compare.jpg">contact sheet</a> · <a href="out/{slug}/run.json">run.json</a> · <a href="out/{slug}/qa.json">qa.json</a></p>
</article>"#
        ));
    }
    let html = format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>v8 app — automatic generative spine (Rust/ORT)</title>
<style>
:root{{--bg:#160f18;--panel:#221927;--ink:#f2e3c6;--muted:#b7a58a;--gold:#c9a86a;--pass:#8fbf8f;--review:#d9b45b;--fallback:#cf8a7a}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(circle at 20% 0%,#2a1f30,#120d15 70%);color:var(--ink);font:15px/1.5 ui-serif,Georgia,serif}}
main{{max-width:1180px;margin:0 auto;padding:28px 16px 120px}}
h1{{font-size:clamp(22px,4vw,34px);margin:.2em 0}}a{{color:var(--gold)}}
.lede{{color:var(--muted);max-width:72ch}}.book{{background:var(--panel);border:1px solid #3a2c40;border-radius:14px;padding:16px;margin:18px 0}}
header h2{{margin:0;font-size:20px}}header p{{margin:.15em 0;color:var(--muted)}}
.tags{{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}}.tags span{{font:12px/1 ui-sans-serif,system-ui;padding:5px 9px;border-radius:999px;background:#302436;border:1px solid #46344e}}
.verdict.pass{{color:var(--pass)}}.verdict.review{{color:var(--review)}}.verdict.fallback{{color:var(--fallback)}}
.strip{{display:flex;gap:12px;overflow-x:auto;padding:12px 2px}}
figure{{margin:0;flex:0 0 auto}}figure img{{display:block;height:236px;width:auto;border-radius:6px;border:1px solid #3a2c40;background:#0d0910}}
figure.spine img{{height:236px;width:52px;image-rendering:pixelated}}figcaption{{font:11px/1.4 ui-sans-serif,system-ui;color:var(--muted);text-align:center;margin-top:4px}}
.why{{color:var(--muted);font-size:13px}}.cmp{{color:var(--gold);font-size:13px}}
.links{{font:12px ui-sans-serif,system-ui;margin:.2em 0 0}}code{{background:#302436;padding:1px 5px;border-radius:4px}}
</style></head><body><main>
<h1>v8 app — automatic generative spine</h1>
<p class="lede">Rust + ONNX Runtime port of the v8 automatic route. Original → automatic mask → fill → 52 × 236 spine → QA, with the Python v8 spine alongside for comparison. No hand-drawn masks, no API key, no hosted service.</p>
<p class="lede">Host run on x86-64. Timings are single shared-host runs and fluctuate with load: crop routes measured 2.4–13.8 s (typically 3–6 s), the optional LaMa pass 31–57 s. Peak RSS is stable at ~450–500 MB for crop routes and ~1.0 GB with LaMa. Android cross-compile and model/runtime sizes are documented in the README. The shared study dock is wired by the audit agent; this gallery is self-contained.</p>
{cards}
</main>
<script src="/spine-cover-art-prototype/study-nav.js"></script>
</body></html>"#
    );
    std::fs::write(out_root.parent().unwrap().join("index.html"), html)?;
    Ok(runs.len())
}
