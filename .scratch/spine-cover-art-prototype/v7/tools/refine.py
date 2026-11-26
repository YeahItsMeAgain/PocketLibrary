#!/usr/bin/env python3
"""v7 refine pass — glyph-shaped masks instead of big rectangles.

The first pass (pipeline.py) masked whole title blocks. LaMa smeared the large
HP sky area. This pass builds masks from the pixels that actually carry type,
inside hand-defined regions, so the surrounding illustration remains as context.

Run:
  /tmp/opencode/v3venv/bin/python \
    .scratch/spine-cover-art-prototype/v7/tools/refine.py
"""
import json
import os
import time

import cv2
import numpy as np
import torch
from rapidocr_onnxruntime import RapidOCR

from simple_lama_inpainting import SimpleLama  # noqa: E402

# pipeline.py patches torch.jit.load for CPU deserialisation when imported.
from pipeline import FOCUS, spine_crop, mean_rgb, structure_score  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source")
ART = os.path.join(ROOT, "assets", "art")
MASK = os.path.join(ROOT, "assets", "mask")


def region_mask(shape, poly, test=None):
    h, w = shape[:2]
    roi = np.zeros((h, w), dtype=np.uint8)
    pts = np.array([[int(x * w), int(y * h)] for x, y in poly], dtype=np.int32)
    cv2.fillPoly(roi, [pts], 255)
    return roi


def mask_harry(img):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    mask = np.zeros((h, w), np.uint8)

    # Yellow/gold display title over magenta. Stars are included; that is fine,
    # LaMa rebuilds them from the surrounding sky.
    roi = region_mask(img.shape, [[0.01, 0.005], [0.99, 0.005], [0.99, 0.248], [0.01, 0.248]])
    gold = ((r.astype(int) > 145) & (g.astype(int) > 95) & (g.astype(int) - b.astype(int) > 25))
    mask[(roi > 0) & gold] = 255

    # Cream subtitle.
    roi = region_mask(img.shape, [[0.05, 0.244], [0.95, 0.244], [0.95, 0.320], [0.05, 0.320]])
    cream = ((r.astype(int) > 175) & (g.astype(int) > 145) & (b.astype(int) > 115))
    mask[(roi > 0) & cream] = 255

    # Dark lettering on the orange author band: keep the band, remove the type.
    roi = region_mask(img.shape, [[0.14, 0.318], [0.86, 0.318], [0.86, 0.397], [0.14, 0.397]])
    dark = (r.astype(int) + g.astype(int) + b.astype(int)) < 330
    mask[(roi > 0) & dark] = 255

    # Anniversary badge: whole circle. There is no honest way to keep a
    # 15-years sticker on a textless cover.
    roi = region_mask(img.shape, [[0.605, 0.378], [0.875, 0.378], [0.875, 0.600], [0.605, 0.600]])
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = int(0.742 * w), int(0.487 * h)
    rr = int(0.105 * h)
    mask[(roi > 0) & (((xx - cx) ** 2 + (yy - cy) ** 2) < rr ** 2)] = 255

    # Smarties award band.
    mask[int(0.935 * h):, :] = 255
    return mask


def mask_lotr(img):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mask = np.zeros((h, w), np.uint8)

    # White title inside the ring: mask light strokes, not the ring or field.
    roi = region_mask(img.shape, [[0.17, 0.17], [0.83, 0.17], [0.83, 0.70], [0.17, 0.70]])
    mask[(roi > 0) & (lum > 95)] = 255

    # Dark-red author signature sits between the title lines. Restrict tightly.
    roi = region_mask(img.shape, [[0.26, 0.415], [0.74, 0.415], [0.74, 0.505], [0.26, 0.505]])
    sig = ((r.astype(int) > 80) & (r.astype(int) - g.astype(int) > 28) &
           (r.astype(int) - b.astype(int) > 28) & (lum < 150))
    mask[(roi > 0) & sig] = 255
    return mask


def mask_hobbit(img):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mask = np.zeros((h, w), np.uint8)

    roi = region_mask(img.shape, [[0.03, 0.07], [0.97, 0.07], [0.97, 0.235], [0.03, 0.235]])
    mask[(roi > 0) & (lum > 90)] = 255

    roi = region_mask(img.shape, [[0.06, 0.845], [0.94, 0.845], [0.94, 0.965], [0.06, 0.965]])
    mask[(roi > 0) & (lum > 90)] = 255
    return mask


def mask_hunger(img):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mask = np.zeros((h, w), np.uint8)

    roi = region_mask(img.shape, [[0.02, 0.02], [0.98, 0.02], [0.98, 0.36], [0.02, 0.36]])
    mask[(roi > 0) & (lum > 70)] = 255

    # Author block: white name, red NYT line, plus any anti-aliased edges.
    roi = region_mask(img.shape, [[0.46, 0.735], [0.995, 0.735], [0.995, 0.965], [0.46, 0.965]])
    mask[(roi > 0) & (lum > 55)] = 255
    red = ((r.astype(int) > 95) & (r.astype(int) - g.astype(int) > 22) &
           (r.astype(int) - b.astype(int) > 22))
    mask[(roi > 0) & red] = 255
    return mask


MASKS = {
    "harry-potter": mask_harry,
    "lord-of-the-rings": mask_lotr,
    "the-hobbit": mask_hobbit,
    "the-hunger-games": mask_hunger,
}


def main():
    lama = SimpleLama(device="cpu")
    report = {}
    old = {}
    meta_path = os.path.join(ROOT, "tools", "recon-meta.json")
    if os.path.exists(meta_path):
        old = json.load(open(meta_path))

    for slug, fn in MASKS.items():
        img = cv2.imread(os.path.join(SRC, f"{slug}.jpg"), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        mask = fn(img)
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)), iterations=1)

        wash = img.copy()
        wash[mask > 0] = (0.32 * wash[mask > 0] + 0.68 * np.array([40, 20, 255])).astype(np.uint8)
        cv2.imwrite(os.path.join(MASK, f"{slug}-preview.jpg"), wash, [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(MASK, f"{slug}-mask.png"), mask)

        t0 = time.time()
        out = np.array(lama(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), mask))
        art = cv2.cvtColor(out, cv2.COLOR_RGB2BGR) if out.ndim == 3 else out
        if art.shape[:2] != (h, w):
            art = cv2.resize(art, (w, h), interpolation=cv2.INTER_LANCZOS4)
        secs = time.time() - t0

        cv2.imwrite(os.path.join(ART, f"{slug}.jpg"), art, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ART, f"{slug}-2x.jpg"),
                    cv2.resize(art, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"),
                    spine_crop(art, slug, 52, 236), [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ROOT, "assets", "retina", f"{slug}.jpg"),
                    spine_crop(art, slug, 104, 472), [cv2.IMWRITE_JPEG_QUALITY, 95])

        ocr = RapidOCR()
        res, _ = ocr(os.path.join(ART, f"{slug}.jpg"))
        residual = [{"text": t, "conf": round(float(c), 3)}
                    for _, t, c in (res or []) if float(c) >= 0.30]

        valid = mask == 0
        d = np.abs(img.astype(np.float32) - art.astype(np.float32))[valid].mean(axis=0)
        spine = cv2.imread(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"))
        sg = cv2.cvtColor(spine, cv2.COLOR_BGR2GRAY)
        prev = old.get(slug, {})
        report[slug] = {
            **prev,
            "source": f"assets/source/{slug}.jpg",
            "sourcePixels": f"{w} x {h}",
            "maskPixels": int((mask > 0).sum()),
            "maskFraction": round(float((mask > 0).sum()) / (w * h), 4),
            "inpaintSeconds": round(secs, 2),
            "engine": "LaMa big-lama (simple-lama-inpainting), CPU; glyph-shaped masks",
            "residualOcr": residual,
            "avgOrig": mean_rgb(img),
            "avgArt": mean_rgb(art),
            "maskedMeanDelta": round(float(np.mean(d)), 2),
            "structureCorr": round(structure_score(img, art, mask), 3),
            "spineLumaStd": round(float(sg.std()), 2),
            "spineNonDark": round(float((sg > 38).mean()), 3),
        }
        print(json.dumps({k: report[slug][k] for k in (
            "maskFraction", "residualOcr", "structureCorr", "spineLumaStd",
            "spineNonDark", "inpaintSeconds")}, indent=1))

    json.dump(report, open(meta_path, "w"), indent=2)


if __name__ == "__main__":
    main()
