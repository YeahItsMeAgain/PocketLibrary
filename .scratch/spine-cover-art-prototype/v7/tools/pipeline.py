#!/usr/bin/env python3
"""v7 — textless reconstruction + spine-scale metrics for four popular covers.

Pipeline (CPU only):
  1. RapidOCR finds printed cover text (recall aid).
  2. Hand-drawn polygons cover display type and marketing that OCR misses.
     In-art lettering (the Hogwarts Express sign, the 9 3/4 platform sign) is
     deliberately retained: it belongs to the illustration, not the cover type.
  3. The union mask is dilated and inpainted with LaMa big-lama (CPU).
  4. OCR runs again for residual text.
  5. Spine crops at 52x236 (1x) and 104x472 (2x), plus palette metrics.

Run from the repo root:
  /tmp/opencode/v3venv/bin/python \
    .scratch/spine-cover-art-prototype/v7/tools/pipeline.py
"""
import json
import os
import time

import cv2
import numpy as np
import torch
from rapidocr_onnxruntime import RapidOCR

_orig_jit_load = torch.jit.load
torch.jit.load = lambda p, *a, **k: _orig_jit_load(p, map_location="cpu", *a, **k)
from simple_lama_inpainting import SimpleLama  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Polygons are fractions of width/height, so they survive a source change.
# Keep in-art signage out of the mask on purpose.
MANUAL = {
    "harry-potter": {
        "cover-type": [
            [[0.03, 0.015], [0.97, 0.015], [0.97, 0.245], [0.03, 0.245]],   # HARRY POTTER
            [[0.08, 0.247], [0.92, 0.247], [0.92, 0.318], [0.08, 0.318]],   # and the Philosopher's Stone
            [[0.15, 0.322], [0.85, 0.322], [0.85, 0.392], [0.15, 0.392]],   # J.K.ROWLING
        ],
        "marketing": [
            [[0.615, 0.385], [0.865, 0.385], [0.865, 0.585], [0.615, 0.585]], # 15 years badge
            [[0.02, 0.938], [0.98, 0.938], [0.98, 0.998], [0.02, 0.998]],     # Smarties band
        ],
    },
    "lord-of-the-rings": {
        "cover-type": [
            [[0.175, 0.185], [0.825, 0.185], [0.825, 0.675], [0.175, 0.675]], # title + signature
        ],
        "marketing": [],
    },
    "the-hobbit": {
        "cover-type": [
            [[0.055, 0.085], [0.945, 0.085], [0.945, 0.225], [0.055, 0.225]], # THE / HOBBIT
            [[0.10, 0.855], [0.90, 0.855], [0.90, 0.955], [0.10, 0.955]],     # J.R.R. TOLKIEN
        ],
        "marketing": [],
    },
    "the-hunger-games": {
        "cover-type": [
            [[0.035, 0.035], [0.965, 0.035], [0.965, 0.345], [0.035, 0.345]], # THE HUNGER GAMES
            [[0.50, 0.755], [0.985, 0.755], [0.985, 0.800], [0.50, 0.800]],   # NYT line
            [[0.50, 0.805], [0.985, 0.805], [0.985, 0.950], [0.50, 0.950]],   # SUZANNE COLLINS
        ],
        "marketing": [],
    },
}

FOCUS = {
    "harry-potter": (0.50, 0.50),
    "lord-of-the-rings": (0.50, 0.48),
    "the-hobbit": (0.50, 0.52),
    "the-hunger-games": (0.46, 0.50),
}


def hex_of(bgr):
    b, g, r = [int(v) for v in bgr]
    return f"#{r:02x}{g:02x}{b:02x}"


def srgb_lum(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = [lin(v) for v in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = srgb_lum(a), srgb_lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def mean_rgb(bgr):
    b, g, r = [float(v) for v in cv2.mean(bgr)[:3]]
    return [int(r), int(g), int(b)]


def structure_score(orig, art, mask):
    """Gradient correlation outside the mask: how much line/edge structure survives."""
    g1 = cv2.cvtColor(orig, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(art, cv2.COLOR_BGR2GRAY)
    e1 = cv2.Laplacian(g1, cv2.CV_32F)
    e2 = cv2.Laplacian(g2, cv2.CV_32F)
    valid = mask == 0
    a, b = e1[valid], e2[valid]
    if a.size == 0 or a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def build_mask(image, slug):
    h, w = image.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    ocr = RapidOCR()
    t0 = time.time()
    result, _ = ocr(os.path.join(ROOT, "assets", "source", f"{slug}.jpg"))
    items = []
    for box, text, conf in result or []:
        items.append({
            "text": text,
            "conf": round(float(conf), 3),
            "box": [[round(float(x), 1), round(float(y), 1)] for x, y in box],
        })
        if float(conf) < 0.30 or len(text.strip()) < 1:
            continue
        cv2.fillPoly(mask, [np.array(box, dtype=np.int32)], 255)
    ocr_seconds = time.time() - t0

    for group, polys in MANUAL[slug].items():
        for poly in polys:
            pts = np.array([[int(x * w), int(y * h)] for x, y in poly], dtype=np.int32)
            cv2.fillPoly(mask, [pts], 255)

    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)), iterations=1)
    return mask, items, ocr_seconds


def spine_crop(art, slug, out_w, out_h):
    h, w = art.shape[:2]
    fx, _ = FOCUS[slug]
    target_ratio = out_w / out_h
    crop_w = int(round(h * target_ratio))
    crop_w = min(crop_w, w)
    crop_h = h
    x = int(round(fx * w - crop_w / 2))
    x = max(0, min(w - crop_w, x))
    crop = art[0:crop_h, x:x + crop_w]
    return cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)


def main():
    for d in ("mask", "art", "spine", "retina"):
        os.makedirs(os.path.join(ROOT, "assets", d), exist_ok=True)

    lama = SimpleLama(device="cpu")
    report = {}

    for slug in MANUAL:
        cover_path = os.path.join(ROOT, "assets", "source", f"{slug}.jpg")
        image = cv2.imread(cover_path, cv2.IMREAD_COLOR)
        h, w = image.shape[:2]
        mask, items, ocr_seconds = build_mask(image, slug)

        wash = image.copy()
        wash[mask > 0] = (0.30 * wash[mask > 0] + 0.70 * np.array([40, 20, 255])).astype(np.uint8)
        cv2.imwrite(os.path.join(ROOT, "assets", "mask", f"{slug}-preview.jpg"), wash,
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(ROOT, "assets", "mask", f"{slug}-mask.png"), mask)

        t0 = time.time()
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        out = np.array(lama(rgb, mask))
        if out.ndim == 3 and out.shape[2] == 3:
            art = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
        else:
            art = out
        # LaMa pads to a multiple of 8; restore the source frame exactly.
        if art.shape[:2] != (h, w):
            art = cv2.resize(art, (w, h), interpolation=cv2.INTER_LANCZOS4)
        inpaint_seconds = time.time() - t0
        cv2.imwrite(os.path.join(ROOT, "assets", "art", f"{slug}.jpg"), art,
                    [cv2.IMWRITE_JPEG_QUALITY, 95])

        # Full-cover 2x of the art, so the page can show more than the spine.
        art2x = cv2.resize(art, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(os.path.join(ROOT, "assets", "art", f"{slug}-2x.jpg"), art2x,
                    [cv2.IMWRITE_JPEG_QUALITY, 92])

        spine = spine_crop(art, slug, 52, 236)
        retina = spine_crop(art, slug, 104, 472)
        cv2.imwrite(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"), spine,
                    [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ROOT, "assets", "retina", f"{slug}.jpg"), retina,
                    [cv2.IMWRITE_JPEG_QUALITY, 95])

        ocr2 = RapidOCR()
        res2, _ = ocr2(os.path.join(ROOT, "assets", "art", f"{slug}.jpg"))
        residual = [{"text": t, "conf": round(float(c), 3)}
                    for _, t, c in (res2 or []) if float(c) >= 0.30]

        avg_orig = mean_rgb(image)
        avg_art = mean_rgb(art)
        # Masked regions are deliberately different; compare outside the mask.
        valid = mask == 0
        d = np.abs(image.astype(np.float32) - art.astype(np.float32))[valid].mean(axis=0)
        delta = float(np.mean(d))

        # Spine-scale legibility: fraction of pixels that are not near-black,
        # and the standard deviation of luminance across the strip.
        spine_gray = cv2.cvtColor(spine, cv2.COLOR_BGR2GRAY)
        report[slug] = {
            "source": f"assets/source/{slug}.jpg",
            "sourcePixels": f"{w} x {h}",
            "maskPixels": int((mask > 0).sum()),
            "maskFraction": round(float((mask > 0).sum()) / (w * h), 4),
            "ocrBoxes": len(items),
            "ocrSeconds": round(ocr_seconds, 2),
            "inpaintSeconds": round(inpaint_seconds, 2),
            "engine": "LaMa big-lama (simple-lama-inpainting), CPU",
            "residualOcr": residual,
            "avgOrig": avg_orig,
            "avgArt": avg_art,
            "maskedMeanDelta": round(delta, 2),
            "structureCorr": round(structure_score(image, art, mask), 3),
            "spineLumaStd": round(float(spine_gray.std()), 2),
            "spineNonDark": round(float((spine_gray > 38).mean()), 3),
            "manual": {k: len(v) for k, v in MANUAL[slug].items()},
            "textItems": items,
        }
        print(json.dumps({k: report[slug][k] for k in (
            "sourcePixels", "maskFraction", "ocrBoxes", "ocrSeconds",
            "inpaintSeconds", "residualOcr", "structureCorr", "spineNonDark")}, indent=1))

    with open(os.path.join(ROOT, "tools", "recon-meta.json"), "w") as f:
        json.dump(report, f, indent=2)


if __name__ == "__main__":
    main()
