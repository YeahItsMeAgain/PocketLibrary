#!/usr/bin/env python3
"""Run the fully automatic cover -> textless art -> spine pipeline for one book.

Example:
  /tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
    --cover ../reproducibility/book/cover.jpg \
    --title "The Hound of the Baskervilles" \
    --author "Arthur Conan Doyle" --pages 170 --slug hound
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auto_lib as A  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def save_img(path: str, img: np.ndarray, quality: int = 92) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, quality])


def contact_sheet(source, mask_preview, art, spine, fallback, path, title):
    H = 620
    panels = []

    def fit(im):
        h, w = im.shape[:2]
        nw = max(1, int(round(w * H / h)))
        return cv2.resize(im, (nw, H), interpolation=cv2.INTER_AREA)

    for label, im in [
        ("Original", source),
        ("Automatic mask", mask_preview),
        ("Inpainted art", art),
        ("Spine 2x", cv2.resize(spine, (A.SPINE_W * 2, A.SPINE_H * 2), interpolation=cv2.INTER_NEAREST)),
        ("Fallback", cv2.resize(fallback, (A.SPINE_W * 2, A.SPINE_H * 2), interpolation=cv2.INTER_NEAREST)),
    ]:
        panels.append((label, fit(im)))

    pad, top = 16, 44
    W = sum(p[1].shape[1] for p in panels) + pad * (len(panels) + 1)
    canvas = Image.new("RGB", (W, H + top + pad), (24, 18, 14))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
    except Exception:
        font = ImageFont.load_default()
    d.text((pad, 12), title, font=font, fill=(242, 227, 198))
    x = pad
    for label, im in panels:
        arr = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
        canvas.paste(Image.fromarray(arr), (x, top))
        d.text((x, top - 20), label, font=font, fill=(201, 168, 106))
        x += im.shape[1] + pad
    canvas.save(path, quality=92)


def run(cover: str, slug: str, title: str, author: str, pages: int,
        out_root: str, max_side: int = A.DEFAULT_WORK_SIDE) -> dict:
    t_all = time.time()
    src = cv2.imread(cover)
    if src is None:
        raise SystemExit(f"cannot read {cover}")
    h, w = src.shape[:2]
    run_dir = os.path.join(out_root, slug)
    os.makedirs(run_dir, exist_ok=True)

    t0 = time.time()
    mask, boxes, det_s = A.build_mask(src)
    mask_s = time.time() - t0

    det_text = A.ocr_texts(src, conf_min=0.5)

    inp = A.inpaint(src, mask, max_side=max_side)
    art = inp["art"]
    W, H = inp["work_size"]
    src_work = cv2.resize(src, (W, H), interpolation=cv2.INTER_AREA)
    work_mask = inp["work_mask"]

    # Overlay previews
    mask_preview = src.copy()
    red = np.zeros_like(mask_preview)
    red[:, :, 2] = 255
    m = mask > 0
    mask_preview[m] = (0.45 * mask_preview[m] + 0.55 * red[m]).astype(np.uint8)
    mask_work_preview = src_work.copy()
    mw = work_mask > 0
    red_work = np.zeros_like(mask_work_preview); red_work[:, :, 2] = 255
    mask_work_preview[mw] = (0.45 * mask_work_preview[mw] + 0.55 * red_work[mw]).astype(np.uint8)

    # Crop options
    t0 = time.time()
    crop_opt, crop_checks = A.pick_text_free_crop(src_work, work_mask)
    crop_s = time.time() - t0
    visual = A.best_visual_crop(art, None)

    def crop_from(im, box):
        x, y, ww, hh = box
        return im[y:y + hh, x:x + ww]

    crop_img = crop_from(src_work, crop_opt["box"]) if crop_opt else None
    art_crop_img = crop_from(art, visual["box"])

    # QA
    if crop_opt:
        crop_metrics = A.qa_report(src_work, art, work_mask, crop_img, crop_opt["box"], title, author)
        crop_metrics["score"] = crop_opt["score"]
        crop_dec = A.decide("crop", crop_metrics)
    else:
        crop_metrics, crop_dec = None, {"verdict": "fallback", "reasons": ["no zero-coverage crop candidate"]}
    art_metrics = A.qa_report(src_work, art, work_mask, art_crop_img, visual["box"], title, author)
    art_metrics["score"] = visual["score"]
    art_dec = A.decide("inpaint", art_metrics)

    rank = {"pass": 2, "review": 1, "fallback": 0}
    if crop_opt and rank[crop_dec["verdict"]] > rank[art_dec["verdict"]]:
        route = "text-free crop"
        chosen_metrics, chosen_dec, chosen_crop, chosen_box = crop_metrics, crop_dec, crop_img, crop_opt["box"]
    elif crop_opt and rank[crop_dec["verdict"]] == rank[art_dec["verdict"]] == 2:
        route = "text-free crop"
        chosen_metrics, chosen_dec, chosen_crop, chosen_box = crop_metrics, crop_dec, crop_img, crop_opt["box"]
    elif rank[art_dec["verdict"]] > 0:
        route = "inpaint"
        chosen_metrics, chosen_dec, chosen_crop, chosen_box = art_metrics, art_dec, art_crop_img, visual["box"]
    elif crop_opt and rank[crop_dec["verdict"]] > 0:
        route = "text-free crop"
        chosen_metrics, chosen_dec, chosen_crop, chosen_box = crop_metrics, crop_dec, crop_img, crop_opt["box"]
    else:
        route = "fallback"
        chosen_metrics, chosen_dec = art_metrics, {"verdict": "fallback", "reasons": art_dec["reasons"] or crop_dec["reasons"]}
        chosen_crop, chosen_box = art_crop_img, visual["box"]

    spine = cv2.resize(chosen_crop, (A.SPINE_W, A.SPINE_H), interpolation=cv2.INTER_LANCZOS4)
    spine2 = cv2.resize(spine, (A.SPINE_W * 2, A.SPINE_H * 2), interpolation=cv2.INTER_NEAREST)
    fallback_path = os.path.join(run_dir, "fallback-spine.jpg")
    A.fallback_spine(title, author, fallback_path)
    fallback = cv2.imread(fallback_path)

    # Write assets
    save_img(os.path.join(run_dir, "source.jpg"), src)
    cv2.imwrite(os.path.join(run_dir, "mask.png"), mask)
    save_img(os.path.join(run_dir, "mask-preview.jpg"), mask_preview)
    save_img(os.path.join(run_dir, "mask-work-preview.jpg"), mask_work_preview)
    save_img(os.path.join(run_dir, "art.jpg"), art)
    save_img(os.path.join(run_dir, "crop-native.jpg"), chosen_crop)
    save_img(os.path.join(run_dir, "spine.jpg"), spine)
    save_img(os.path.join(run_dir, "spine-2x.jpg"), spine2)
    if crop_opt:
        save_img(os.path.join(run_dir, "text-free-crop.jpg"), crop_img)
    contact_sheet(src_work, mask_work_preview, art, spine, fallback,
                  os.path.join(run_dir, "compare.jpg"), title or slug)

    manual = 0
    report = {
        "slug": slug,
        "book": {"title": title, "author": author, "pages": pages,
                 "cover": os.path.relpath(os.path.abspath(cover), ROOT)},
        "generated": datetime.now(timezone.utc).isoformat(),
        "route": route,
        "verdict": chosen_dec["verdict"],
        "decision_reasons": chosen_dec["reasons"],
        "manual_intervention": manual,
        "model": {
            "text_detector": "PP-OCRv3 DBNet (rapidocr_onnxruntime, ONNX, CPU)",
            "text_remover": "LaMa big-lama (simple-lama-inpainting, CPU) + sampled flat fill",
            "ocr_qa": "PP-OCRv3 recogniser",
            "crop_search": "integral-image spine-aspect scan + residual OCR",
            "generative_diffusion": "not used",
        },
        "runtime_s": {
            "detection": round(det_s, 2),
            "mask_total": round(mask_s, 2),
            "inpaint_flat": inp["flat_s"],
            "inpaint_lama": inp["lama_s"],
            "crop_search": round(crop_s, 2),
            "total": round(time.time() - t_all, 2),
        },
        "source": {"width": w, "height": h},
        "working": {"width": W, "height": H, "scale": round(inp["scale"], 4)},
        "mask": {
            "coverage_pct": round(float((mask > 0).mean() * 100), 2),
            "components": int(cv2.connectedComponents((mask > 0).astype(np.uint8))[0] - 1),
            "detection_boxes": len(boxes),
            "flat_fill_pct": inp["flat_pct"],
        },
        "detected_text": det_text,
        "crop_options": {
            "text_free": crop_opt,
            "text_free_ocr_checks": crop_checks,
            "inpaint_visual": visual,
        },
        "qa": {
            "chosen": chosen_metrics,
            "text_free": crop_metrics,
            "inpaint": art_metrics,
        },
        "final": {
            "route": route,
            "verdict": chosen_dec["verdict"],
            "spine": os.path.relpath(os.path.join(run_dir, "spine.jpg"), ROOT),
            "spine_2x": os.path.relpath(os.path.join(run_dir, "spine-2x.jpg"), ROOT),
            "fallback_spine": os.path.relpath(fallback_path, ROOT),
            "crop_box_work": chosen_box,
            "mask_coverage_in_crop_pct": chosen_metrics["crop_mask_coverage_pct"],
        },
    }
    with open(os.path.join(run_dir, "run.json"), "w") as f:
        json.dump(report, f, indent=2)
    with open(os.path.join(run_dir, "qa.json"), "w") as f:
        json.dump({"qa": report["qa"], "decision": {
            "route": route, "verdict": chosen_dec["verdict"],
            "reasons": chosen_dec["reasons"]}}, f, indent=2)
    print(json.dumps({
        "slug": slug, "route": route, "verdict": chosen_dec["verdict"],
        "mask_pct": report["mask"]["coverage_pct"],
        "spine_ocr": len(chosen_metrics["spine_residual_ocr"]),
        "total_s": report["runtime_s"]["total"],
    }))
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cover", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--author", default="")
    ap.add_argument("--pages", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(ROOT, "assets"))
    ap.add_argument("--max-side", type=int, default=A.DEFAULT_WORK_SIDE)
    args = ap.parse_args()
    run(args.cover, args.slug, args.title, args.author, args.pages,
        args.out, max_side=args.max_side)


if __name__ == "__main__":
    main()
