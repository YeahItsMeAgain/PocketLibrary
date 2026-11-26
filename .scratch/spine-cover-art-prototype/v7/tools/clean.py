#!/usr/bin/env python3
"""v7 HP recovery + clean flat-field fills for the other three covers.

HP's display title is too large for LaMa. TELEA propagates the magenta sky
through the glyph mask; the remaining furniture is removed with targeted
colour masks. The badge is blurred out but is outside the chosen spine crop.
Flat black covers are filled with a sampled clean dark field, never with a
patch that might contain type.

Run:
  /tmp/opencode/v3venv/bin/python \
    .scratch/spine-cover-art-prototype/v7/tools/clean.py
"""
import json
import os
import time

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

from pipeline import mean_rgb, spine_crop

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source")
ART = os.path.join(ROOT, "assets", "art")
MASK = os.path.join(ROOT, "assets", "mask")

FOCUS = {
    "harry-potter": (0.36, 0.5),
    "lord-of-the-rings": (0.5, 0.48),
    "the-hobbit": (0.5, 0.52),
    "the-hunger-games": (0.46, 0.5),
}


def crop(art, slug, w, h):
    # Local copy of spine_crop with the HP focus override. HP's title block is
    # unrecoverable, so its spine uses a detail crop that starts below it; the
    # full-cover record keeps the failure visible.
    ah, aw = art.shape[:2]
    fx = FOCUS[slug][0]
    y0, y1 = (0.30, 0.96) if slug == "harry-potter" else (0.0, 1.0)
    top, bottom = int(y0 * ah), int(y1 * ah)
    ch = bottom - top
    cw = min(aw, int(round(ch * (w / h))))
    x = max(0, min(aw - cw, int(round(fx * aw - cw / 2))))
    return cv2.resize(art[top:bottom, x:x + cw], (w, h), interpolation=cv2.INTER_LANCZOS4)


def dark_field(img, mask, seed=7):
    """Replace masked pixels with the sampled dark field + matched grain."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clean = (gray < 42) & (mask == 0)
    if clean.sum() < 50:
        clean = gray < 60
    base = np.median(img[clean], axis=0)
    std = float(np.std(gray[clean])) or 2.0
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, min(std, 4.0), (h, w, 1))
    fill = np.clip(base[None, None, :] + noise, 0, 255).astype(np.uint8)
    m = cv2.GaussianBlur(mask, (15, 15), 0).astype(np.float32)[..., None] / 255.0
    return (fill.astype(np.float32) * m + img.astype(np.float32) * (1 - m)).astype(np.uint8)


def hp_clean(img):
    h, w = img.shape[:2]
    b, g, r = cv2.split(img)
    out = img.copy()

    # 1. Gold title: classical propagation through the glyphs.
    roi = np.zeros((h, w), np.uint8)
    cv2.rectangle(roi, (0, 0), (w, int(0.255 * h)), 255, -1)
    gold = ((r.astype(int) > 140) & (g.astype(int) > 85) &
            (g.astype(int) - b.astype(int) > 20))
    tm = np.zeros((h, w), np.uint8)
    tm[(roi > 0) & gold] = 255
    tm = cv2.dilate(tm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)), 1)
    out = cv2.inpaint(out, tm, 17, cv2.INPAINT_TELEA)

    # 2. Cream subtitle. OCR box: y 0.233–0.271.
    roi = np.zeros((h, w), np.uint8)
    cv2.rectangle(roi, (0, int(0.228 * h)), (w, int(0.278 * h)), 255, -1)
    cream = ((r.astype(int) > 180) & (g.astype(int) > 150) & (b.astype(int) > 120))
    sm = np.zeros((h, w), np.uint8)
    sm[(roi > 0) & cream] = 255
    sm = cv2.dilate(sm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), 1)
    out = cv2.inpaint(out, sm, 9, cv2.INPAINT_TELEA)

    # 3. Dark letters in the orange author band. OCR box: y 0.285–0.312;
    # the band itself is roughly 0.274–0.325.
    band = np.zeros((h, w), np.uint8)
    cv2.rectangle(band, (int(0.10 * w), int(0.272 * h)),
                  (int(0.90 * w), int(0.328 * h)), 255, -1)
    dark = ((r.astype(int) + g.astype(int) + b.astype(int)) < 420)
    am = np.zeros((h, w), np.uint8)
    am[(band > 0) & dark] = 255
    am = cv2.dilate(am, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), 1)
    out = cv2.inpaint(out, am, 5, cv2.INPAINT_TELEA)

    # 3b. Remove the orange author band itself, not just its letters. Behind it
    # is sky; tile the clean left-sky strip across the band.
    band = np.zeros((h, w), np.uint8)
    cv2.rectangle(band, (0, int(0.266 * h)), (w, int(0.334 * h)), 255, -1)
    patch = out[int(0.267 * h):int(0.333 * h), int(0.01 * w):int(0.11 * w)]
    fill = cv2.resize(patch, (w, int(0.068 * h)), interpolation=cv2.INTER_LANCZOS4)
    fill_full = np.zeros_like(out)
    fill_full[int(0.266 * h):int(0.334 * h), :] = fill
    m = cv2.GaussianBlur(band, (15, 15), 0).astype(np.float32)[..., None] / 255.0
    out = (fill_full.astype(np.float32) * m + out.astype(np.float32) * (1 - m)).astype(np.uint8)

    # 4. Badge: whole disc. It is not in the spine crop, so a soft removal is
    # enough; the full-cover record still marks this as an artifact.
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = int(0.742 * w), int(0.487 * h)
    rr = int(0.112 * h)
    bm = np.zeros((h, w), np.uint8)
    bm[((xx - cx) ** 2 + (yy - cy) ** 2) < rr ** 2] = 255
    bm = cv2.GaussianBlur(bm, (9, 9), 0)
    bm = (bm > 40).astype(np.uint8) * 255
    out = cv2.inpaint(out, bm, 25, cv2.INPAINT_TELEA)

    # 5. Smarties band. OCR box: y 0.958–0.979.
    band = np.zeros((h, w), np.uint8)
    cv2.rectangle(band, (0, int(0.945 * h)), (w, h), 255, -1)
    out = dark_field(out, band, seed=11)
    return out, tm | sm | am | bm


def flat_clean(img, blocks, seed=7):
    mask = np.zeros(img.shape[:2], np.uint8)
    h, w = img.shape[:2]
    for x0, y0, x1, y1 in blocks:
        cv2.rectangle(mask, (int(x0 * w), int(y0 * h)), (int(x1 * w), int(y1 * h)), 255, -1)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), 1)
    return dark_field(img, mask, seed=seed), mask


def main():
    report = json.load(open(os.path.join(ROOT, "tools", "recon-meta.json")))

    hp_src = cv2.imread(os.path.join(SRC, "harry-potter.jpg"))
    hp_art, hp_mask = hp_clean(hp_src)

    lo_src = cv2.imread(os.path.join(SRC, "lord-of-the-rings.jpg"))
    # OCR boxes: THE y 0.240–0.322 ... RINGS 0.654–0.734; signature below.
    lo_art, lo_mask = flat_clean(lo_src, [(0.165, 0.165, 0.835, 0.755)], seed=3)

    hb_src = cv2.imread(os.path.join(SRC, "the-hobbit.jpg"))
    # OCR boxes: HOBBIT 0.126–0.302 (not 0.245), author 0.774–0.840.
    hb_art, hb_mask = flat_clean(hb_src, [(0.02, 0.10, 0.98, 0.315),
                                          (0.05, 0.755, 0.95, 0.855)], seed=5)

    hg_src = cv2.imread(os.path.join(SRC, "the-hunger-games.jpg"))
    # OCR boxes: title 0.034–0.288, author 0.730–0.874; the small red NYT
    # line sits above the name, around 0.695.
    hg_art, hg_mask = flat_clean(hg_src, [(0.02, 0.02, 0.98, 0.315),
                                          (0.50, 0.680, 0.995, 0.895)], seed=9)

    finals = {
        "harry-potter": (hp_src, hp_art, hp_mask),
        "lord-of-the-rings": (lo_src, lo_art, lo_mask),
        "the-hobbit": (hb_src, hb_art, hb_mask),
        "the-hunger-games": (hg_src, hg_art, hg_mask),
    }

    for slug, (orig, art, mask) in finals.items():
        h, w = orig.shape[:2]
        wash = orig.copy()
        wash[mask > 0] = (0.32 * wash[mask > 0] + 0.68 * np.array([40, 20, 255])).astype(np.uint8)
        cv2.imwrite(os.path.join(MASK, f"{slug}-preview.jpg"), wash, [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(MASK, f"{slug}-mask.png"), mask)
        cv2.imwrite(os.path.join(ART, f"{slug}.jpg"), art, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ART, f"{slug}-2x.jpg"),
                    cv2.resize(art, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4),
                    [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"),
                    crop(art, slug, 52, 236), [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ROOT, "assets", "retina", f"{slug}.jpg"),
                    crop(art, slug, 104, 472), [cv2.IMWRITE_JPEG_QUALITY, 95])

        ocr = RapidOCR()
        res, _ = ocr(os.path.join(ART, f"{slug}.jpg"))
        residual = [{"text": t, "conf": round(float(c), 3)}
                    for _, t, c in (res or []) if float(c) >= 0.30]
        spine = cv2.imread(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"))
        sg = cv2.cvtColor(spine, cv2.COLOR_BGR2GRAY)
        report[slug].update({
            "maskFraction": round(float((mask > 0).sum()) / (w * h), 4),
            "engine": "TELEA glyph propagation (HP) / sampled dark-field fill (flat covers)",
            "residualOcr": residual,
            "avgOrig": mean_rgb(orig),
            "avgArt": mean_rgb(art),
            "spineLumaStd": round(float(sg.std()), 2),
            "spineNonDark": round(float((sg > 38).mean()), 3),
        })
        print(slug, "residual", residual, "mask", report[slug]["maskFraction"])

    json.dump(report, open(os.path.join(ROOT, "tools", "recon-meta.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
