#!/usr/bin/env python3
"""Prepare text-free artwork for the 18 public-domain classics, and spine crops.

Sources, in order of preference:
  A. The original public-domain painting from Wikimedia Commons (15 of 18).
     This is the actual cover artwork, with no typography at all.
  B. For three titles whose exact source file was not available at high
     resolution, the un-type-set top of the Standard Ebooks cover is cropped
     above its printed title plate (no inpainting). Recorded honestly.
  C. The two modern trade covers use removed/<slug>-textless.jpg from
     remove-text.py (OCR + LaMa).

Every piece of art is cropped to a 2:3 portrait around a recorded focus point,
so the spine crop uses 33% of the artwork width (same geometry as v2).
"""
import json
import os
import shutil

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "art")
CROPS = os.path.join(ROOT, "crops")
os.makedirs(ART, exist_ok=True)
os.makedirs(CROPS, exist_ok=True)

# slug: (focus_x, focus_y, method, painter/file note)
CLASSICS = {
    "moby-dick": (0.45, 0.50, "original", "Albert Pinkham Ryder, The Flying Dutchman (1887)"),
    "jane-eyre": (0.50, 0.42, "original", "Vilhelm Hammershøi, Portrait of a Young Woman (artist's sister Anna)"),
    "pride-and-prejudice": (0.45, 0.50, "original", "Edmund Blair Leighton, A Wet Sunday Morning (1896)"),
    "frankenstein": (0.52, 0.50, "cover-crop", "Giuseppe Arcimboldo, Portrait of Adam (1578) — exact source file not found"),
    "dracula": (0.55, 0.45, "original", "Joseph Magnus Stäck, Italian Landscape of Ruins in the Moonlight (1850)"),
    "great-expectations": (0.60, 0.40, "original", "Joseph Paelinck, Self-Portrait (1812)"),
    "bleak-house": (0.50, 0.45, "original", "Thomas Eakins, The Writing Master (1882)"),
    "middlemarch": (0.56, 0.50, "original", "John Constable, The Grove, Hampstead (1821–22)"),
    "moonstone": (0.50, 0.45, "original", "Anne-Louis Girodet, Study for Portrait of an Indian (1807)"),
    "time-machine": (0.55, 0.50, "original", "Paul Cézanne, The Black Marble Clock (c. 1870)"),
    "treasure-island": (0.55, 0.45, "original", "N. C. Wyeth, One More Step, Mr. Hands (1911)"),
    "jekyll-and-hyde": (0.45, 0.45, "original", "Hans von Marées, Double Portrait of Marées and Lenbach (1863)"),
    "hound-of-the-baskervilles": (0.55, 0.50, "original", "Caspar David Friedrich, Riesengebirge Landscape with Rising Fog (1820)"),
    "dorian-gray": (0.52, 0.45, "original", "John Collier, The Garden of Armida (1899)"),
    "scarlet-letter": (0.55, 0.45, "original", "Hugues Merle, The Scarlet Letter (1861)"),
    "turn-of-the-screw": (0.62, 0.50, "cover-crop", "John Atkinson Grimshaw, A Wintry Moon (1886) — exact source file not found"),
    "alice": (0.26, 0.45, "cover-crop", "Ivan Shishkin, Amanita (1878–79) — exact source file not found"),
    "wuthering-heights": (0.55, 0.34, "original", "George Frederic Watts, Edith Villiers (1862)"),
}

TRADE = {
    "whisper-man": (0.50, 0.50),
    "rock-paper-scissors": (0.22, 0.50),
}


def crop_to_23(img, fx, fy):
    h, w = img.shape[:2]
    target = 2 / 3
    if w / h > target:
        cw = int(round(h * target))
        ch = h
    else:
        cw = w
        ch = int(round(w / target))
    x0 = int(round((w - cw) * fx))
    y0 = int(round((h - ch) * fy))
    x0 = max(0, min(w - cw, x0))
    y0 = max(0, min(h - ch, y0))
    return img[y0:y0 + ch, x0:x0 + cw], (x0, y0, cw, ch)


def stats(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l = lab[:, :, 0].astype(np.float32) / 255.0
    # approximate relative luminance from sRGB
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    contrast = lambda a, b: (max(a, b) + 0.05) / (min(a, b) + 0.05)
    cream = 0.86
    ink = 0.045
    # column busyness from Sobel, to place an optional rail on the calmer side
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    cols = gx.mean(axis=0)
    third = max(1, len(cols) // 3)
    left = float(cols[:third].mean())
    right = float(cols[-third:].mean())
    return {
        "mean_lum": round(float(lum.mean()), 3),
        "p05": round(float(np.percentile(lum, 5)), 3),
        "p95": round(float(np.percentile(lum, 95)), 3),
        "contrast_cream": round(float(contrast(cream, float(np.percentile(lum, 95)))), 1),
        "contrast_ink": round(float(contrast(ink, float(np.percentile(lum, 5)))), 1),
        "rail_side": "left" if left <= right else "right",
        "busy_left": round(left, 1),
        "busy_right": round(right, 1),
    }


def spine_crop(img):
    h, w = img.shape[:2]
    cw = max(1, int(round(h * (52 / 236))))
    x0 = max(0, (w - cw) // 2)
    crop = img[:, x0:x0 + cw]
    # 160 × 727 keeps the exact 52:236 ratio, at ~3× shelf density
    return cv2.resize(crop, (160, 727), interpolation=cv2.INTER_AREA)


def main():
    manifest = {}
    for slug, (fx, fy, method, note) in CLASSICS.items():
        if method == "original":
            src = os.path.join(ROOT, "assets", "classic-originals", f"{slug}.jpg")
            img = cv2.imread(src, cv2.IMREAD_COLOR)
        else:
            src = os.path.join(ROOT, "assets", "classic-covers", f"{slug}.jpg")
            cover = cv2.imread(src, cv2.IMREAD_COLOR)
            # Standard Ebooks plate starts around 74.5% of the height.
            img = cover[: int(round(cover.shape[0] * 0.744)), :].copy()
        if img is None:
            raise SystemExit(f"missing {src}")
        art, box = crop_to_23(img, fx, fy)
        out = os.path.join(ART, f"{slug}-art.jpg")
        cv2.imwrite(out, art, [cv2.IMWRITE_JPEG_QUALITY, 93])
        scrop = spine_crop(art)
        cv2.imwrite(os.path.join(CROPS, f"{slug}-spine.jpg"), scrop,
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        s = stats(scrop)
        manifest[slug] = {
            "method": method,
            "art": f"art/{slug}-art.jpg",
            "crop": f"crops/{slug}-spine.jpg",
            "source_file": os.path.relpath(src, ROOT),
            "source_pixels": f"{img.shape[1]} × {img.shape[0]}",
            "art_pixels": f"{art.shape[1]} × {art.shape[0]}",
            "crop_box": box,
            "focus": [fx, fy],
            "note": note,
            **s,
        }

    for slug, (fx, fy) in TRADE.items():
        src = os.path.join(ROOT, "removed", f"{slug}-textless.jpg")
        img = cv2.imread(src, cv2.IMREAD_COLOR)
        art, box = crop_to_23(img, fx, fy)
        cv2.imwrite(os.path.join(ART, f"{slug}-art.jpg"), art, [cv2.IMWRITE_JPEG_QUALITY, 93])
        scrop = spine_crop(art)
        cv2.imwrite(os.path.join(CROPS, f"{slug}-spine.jpg"), scrop,
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        s = stats(scrop)
        manifest[slug] = {
            "method": "ocr+lama",
            "art": f"art/{slug}-art.jpg",
            "crop": f"crops/{slug}-spine.jpg",
            "source_file": f"removed/{slug}-textless.jpg",
            "source_pixels": f"{img.shape[1]} × {img.shape[0]}",
            "art_pixels": f"{art.shape[1]} × {art.shape[0]}",
            "crop_box": box,
            "focus": [fx, fy],
            "note": "Textless result from RapidOCR + LaMa; see masks/.",
            **s,
        }

    with open(os.path.join(ART, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps({k: {"method": v["method"], "luminance": v["mean_lum"],
                          "rail": v["rail_side"], "c_cream": v["contrast_cream"],
                          "c_ink": v["contrast_ink"]} for k, v in manifest.items()}, indent=1))


if __name__ == "__main__":
    main()
