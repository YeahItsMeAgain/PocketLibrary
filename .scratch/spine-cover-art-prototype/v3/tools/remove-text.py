#!/usr/bin/env python3
"""Build textless cover art for the v3 spine prototype.

Pipeline (CPU only):
  1. RapidOCR (PaddleOCR detection/recognition models via ONNX Runtime) finds
     printed text and gives boxes + confidence.
  2. A small, explicit list of hand-drawn polygons covers display typography the
     detector misses (very large condensed title letters) and marketing
     furniture (badges, quote stickers, the RPS red band). This is deliberate:
     OCR is a recall aid, not a magic eraser.
  3. The union mask is dilated and inpainted with LaMa (big-lama, CPU).
  4. OCR is run again on the result to measure residual text; that number is
     reported in masks/<slug>.json and on the v3 page.

Everything is local. Models download on first run to the PyTorch cache.
Run from the repo root:
  /tmp/opencode/v3venv/bin/python .scratch/spine-cover-art-prototype/v3/tools/remove-text.py
"""
import json
import os
import time

import cv2
import numpy as np
import torch
from rapidocr_onnxruntime import RapidOCR

# The big-lama TorchScript checkpoint was serialised on CUDA. Force CPU
# deserialisation so it also runs on this GPU-less machine.
_orig_jit_load = torch.jit.load
torch.jit.load = lambda p, *a, **k: _orig_jit_load(p, map_location="cpu", *a, **k)
from simple_lama_inpainting import SimpleLama  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Hand-drawn supplements. Coordinates are fractions of image width/height so
# they survive a change of source resolution. Each entry is a polygon.
MANUAL = {
    "whisper-man": {
        "title": [
            [[0.03, 0.805], [0.97, 0.805], [0.97, 0.955], [0.03, 0.955]],
        ],
        "marketing": [
            # top strapline + penguin colophon + stray white glyph at right edge
            [[0.10, 0.025], [0.93, 0.025], [0.93, 0.080], [0.10, 0.080]],
            [[0.885, 0.018], [0.965, 0.018], [0.965, 0.083], [0.885, 0.083]],
            [[0.955, 0.095], [1.0, 0.095], [1.0, 0.145], [0.955, 0.145]],
            # quote lines above the door
            [[0.24, 0.078], [0.81, 0.078], [0.81, 0.140], [0.24, 0.140]],
            # Netflix badge / sticker
            [[0.075, 0.185], [0.385, 0.185], [0.385, 0.355], [0.075, 0.355]],
            # right-hand quote sticker
            [[0.625, 0.175], [0.925, 0.175], [0.925, 0.365], [0.625, 0.365]],
        ],
    },
    "rock-paper-scissors": {
        "title": [
            [[0.10, 0.078], [0.84, 0.078], [0.84, 0.222], [0.10, 0.222]],   # ALICE
            [[0.015, 0.232], [0.91, 0.232], [0.91, 0.372], [0.015, 0.372]], # FEENEY
            [[0.11, 0.532], [0.62, 0.532], [0.62, 0.642], [0.11, 0.642]],   # ROCK
            [[0.30, 0.675], [0.89, 0.675], [0.89, 0.792], [0.30, 0.792]],   # PAPER
            [[0.035, 0.818], [0.87, 0.818], [0.87, 0.938], [0.035, 0.938]], # SCISSORS
            [[0.12, 0.936], [0.33, 0.936], [0.33, 0.978], [0.12, 0.978]],   # A NOVEL
        ],
        "marketing": [
            [[0.18, 0.045], [0.73, 0.045], [0.73, 0.080], [0.18, 0.080]],   # NYT line
            [[0.40, 0.372], [0.90, 0.372], [0.90, 0.470], [0.40, 0.470]],   # Real Simple quote
            [[0.905, 0.0], [1.0, 0.0], [1.0, 1.0], [0.905, 1.0]],           # red marketing band
        ],
    },
}


def rbox_to_poly(box):
    return np.array(box, dtype=np.int32)


def build_mask(shape, slug):
    h, w = shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    ocr = RapidOCR()
    t0 = time.time()
    result, _ = ocr(os.path.join(ROOT, "assets", f"{slug}-cover.jpg"))
    text_items = []
    for box, text, conf in result or []:
        text_items.append({"text": text, "conf": round(float(conf), 3),
                           "box": [[round(float(x), 1), round(float(y), 1)] for x, y in box]})
        if float(conf) < 0.30 or len(text.strip()) < 1:
            continue
        poly = rbox_to_poly(box)
        cv2.fillPoly(mask, [poly], 255)
    ocr_seconds = time.time() - t0

    manual = MANUAL[slug]
    for group, polys in manual.items():
        for poly in polys:
            pts = np.array([[int(x * w), int(y * h)] for x, y in poly], dtype=np.int32)
            cv2.fillPoly(mask, [pts], 255)

    # Generous dilation: glyphs have shadows/glows and OCR boxes hug the stems.
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)), iterations=1)
    return mask, text_items, ocr_seconds


def main():
    os.makedirs(os.path.join(ROOT, "masks"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "removed"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "art"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "crops"), exist_ok=True)

    only = os.environ.get("ONLY")
    slugs = [only] if only else list(MANUAL)
    lama = SimpleLama(device="cpu")
    for slug in slugs:
        cover_path = os.path.join(ROOT, "assets", f"{slug}-cover.jpg")
        image = cv2.imread(cover_path, cv2.IMREAD_COLOR)
        h, w = image.shape[:2]
        mask, text_items, ocr_seconds = build_mask(image.shape, slug)

        # Mask preview: magenta wash over the original + white-on-black binary.
        wash = image.copy()
        wash[mask > 0] = (0.35 * wash[mask > 0] + 0.65 * np.array([40, 20, 255])).astype(np.uint8)
        cv2.imwrite(os.path.join(ROOT, "masks", f"{slug}-mask-preview.jpg"), wash)
        cv2.imwrite(os.path.join(ROOT, "masks", f"{slug}-mask.png"), mask)

        t0 = time.time()
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        out = lama(rgb, mask)
        out = np.array(out)
        if out.ndim == 3 and out.shape[2] == 3:
            out_bgr = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        else:
            out_bgr = out
        inpaint_seconds = time.time() - t0
        cv2.imwrite(os.path.join(ROOT, "removed", f"{slug}-textless.jpg"), out_bgr,
                    [cv2.IMWRITE_JPEG_QUALITY, 94])

        # Second OCR pass: how much text is still machine-readable?
        ocr2 = RapidOCR()
        res2, _ = ocr2(os.path.join(ROOT, "removed", f"{slug}-textless.jpg"))
        residual = [{"text": t, "conf": round(float(c), 3)} for _, t, c in (res2 or []) if float(c) >= 0.30]

        meta = {
            "slug": slug,
            "source": f"assets/{slug}-cover.jpg",
            "source_pixels": f"{w} × {h}",
            "mask_pixels": int((mask > 0).sum()),
            "mask_fraction": round(float((mask > 0).sum()) / (w * h), 4),
            "ocr_boxes": len(text_items),
            "ocr_seconds": round(ocr_seconds, 2),
            "inpaint_seconds": round(inpaint_seconds, 2),
            "engine": "RapidOCR + LaMa big-lama (simple-lama-inpainting), CPU",
            "residual_ocr": residual,
            "manual_supplements": {k: len(v) for k, v in MANUAL[slug].items()},
            "text_items": text_items,
        }
        with open(os.path.join(ROOT, "masks", f"{slug}.json"), "w") as f:
            json.dump(meta, f, indent=2)
        print(json.dumps({k: meta[k] for k in
                          ("slug", "mask_fraction", "ocr_boxes", "ocr_seconds",
                           "inpaint_seconds", "residual_ocr")}, indent=1))


if __name__ == "__main__":
    main()
