#!/usr/bin/env python3
"""Automatic cover-to-spine pipeline.

No hand-drawn polygons. Text regions come from PP-OCRv3 DBNet detections
(rapidocr_onnxruntime) plus automatic per-line colour analysis. Removal is
LaMa big-lama for textured areas and a sampled flat fill for flat areas.
A text-free crop search is tried before inpainting, and QA decides between
pass / review / fallback at 52 x 236.
"""
from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import torch

_orig_jit_load = torch.jit.load
torch.jit.load = lambda p, *a, **k: _orig_jit_load(p, map_location="cpu", *a, **k)

from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from rapidocr_onnxruntime import RapidOCR  # noqa: E402
from simple_lama_inpainting import SimpleLama  # noqa: E402

SPINE_W, SPINE_H = 52, 236
SPINE_ASPECT = SPINE_W / SPINE_H
DEFAULT_WORK_SIDE = 720
LAMA_MAX_SIDE = 720

# ---------------------------------------------------------------- OCR helpers

_DET = None
_OCR = None
_LAMA = None


def detector():
    global _DET
    if _DET is None:
        _DET = RapidOCR(
            det_model_path=None,
            det_limit_side_len=1600,
            det_limit_type="min",
            det_unclip_ratio=1.9,
            det_box_thresh=0.28,
            det_thresh=0.18,
            use_angle_cls=False,
        )
    return _DET


def ocr_engine():
    global _OCR
    if _OCR is None:
        _OCR = RapidOCR(
            det_model_path=None,
            det_limit_side_len=1600,
            det_limit_type="max",
            use_angle_cls=False,
        )
    return _OCR


def lama_engine():
    global _LAMA
    if _LAMA is None:
        _LAMA = SimpleLama(device="cpu")
    return _LAMA


def ocr_texts(img: np.ndarray, conf_min: float = 0.45) -> list[dict[str, Any]]:
    """Run OCR and return normalised hits. Small images are upscaled first."""
    h, w = img.shape[:2]
    if max(h, w) < 900:
        f = min(4.0, 1600.0 / max(h, w))
        if f > 1.05:
            img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    try:
        res, _ = ocr_engine()(img)
    except Exception:
        return []
    out = []
    for box, text, conf in res or []:
        text = str(text).strip()
        conf = float(conf)
        if not text or conf < conf_min:
            continue
        pts = np.array(box, np.float32)
        out.append({
            "text": text,
            "conf": round(conf, 3),
            "box": [[round(float(x), 1), round(float(y), 1)] for x, y in pts],
        })
    return out


# ------------------------------------------------------------- mask building

def _angle(box) -> float:
    b = np.array(box, np.float32)
    s = b.sum(1)
    d = np.diff(b, axis=1).ravel()
    p = np.array([b[np.argmin(s)], b[np.argmin(d)],
                  b[np.argmax(s)], b[np.argmax(d)]], np.float32)
    return math.degrees(math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]))


def _bbox(box):
    b = np.array(box)
    return b[:, 0].min(), b[:, 1].min(), b[:, 0].max(), b[:, 1].max()


def _seg_box(img: np.ndarray, box) -> np.ndarray:
    """Automatic glyph mask for one detection.

    Estimate the dominant text colour inside the detected polygon, then keep
    colour-similar components within a small ROI. The ROI expansion is what
    recovers glyphs that DBNet boxes only partly cover.
    """
    h, w = img.shape[:2]
    x0, y0, x1, y1 = _bbox(box)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    horiz = abs(_angle(box)) < 45
    px, py = (0.35 * bh, 0.10 * bh) if horiz else (0.10 * bw, 0.35 * bw)
    X0, Y0 = max(0, int(x0 - px)), max(0, int(y0 - py))
    X1, Y1 = min(w, int(x1 + px)), min(h, int(y1 + py))
    roi = img[Y0:Y1, X0:X1]
    if roi.size == 0:
        return np.zeros((h, w), np.uint8)

    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    if horiz:
        bd = max(2, int(bh * 0.18))
        border = np.concatenate([lab[:bd].reshape(-1, 3), lab[-bd:].reshape(-1, 3)])
    else:
        bd = max(2, int(bw * 0.18))
        border = np.concatenate([lab[:, :bd].reshape(-1, 3), lab[:, -bd:].reshape(-1, 3)])
    bg = np.median(border, 0)

    core = np.zeros(roi.shape[:2], np.uint8)
    poly = np.array([[x - X0, y - Y0] for x, y in box], np.int32)
    cv2.fillPoly(core, [poly], 255)
    core_er = cv2.erode(core, np.ones((3, 3), np.uint8))
    cf = core_er.reshape(-1) > 0
    pix = lab.reshape(-1, 3)
    dist_bg = np.linalg.norm(pix - bg, axis=1)
    core_dist = dist_bg[cf]
    if len(core_dist) < 20:
        m = np.zeros((h, w), np.uint8)
        m[Y0:Y1, X0:X1] = core
        return m

    text_color = np.median(pix[cf & (dist_bg >= np.percentile(core_dist, 72))], 0)
    dt = np.linalg.norm(pix - text_color, axis=1)
    sel = ((dt < 58) & (dist_bg > 20)).reshape(roi.shape[:2]).astype(np.uint8) * 255
    if int((sel > 0).sum()) < 0.05 * max(1, int(core.sum() / 255)):
        sel = core.copy()
    m = np.zeros((h, w), np.uint8)
    m[Y0:Y1, X0:X1] = sel
    return m


def _line_colour_mask(img: np.ndarray, boxes: list) -> np.ndarray:
    """Fill under-covered line gaps using the line's own colour model.

    DBNet sometimes misses a glyph inside an otherwise detected word. Group
    horizontal detections into lines, then select pixels whose hue/value matches
    the line's typography. This is automatic and colour-driven, not a polygon.
    """
    h, w = img.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    if not boxes:
        return mask
    rects = []
    for b in boxes:
        x0, y0, x1, y1 = _bbox(b)
        rects.append({"r": [x0, y0, x1, y1], "ang": _angle(b), "used": False})
    lines = []
    for r in rects:
        if r["used"] or abs(r["ang"]) >= 45:
            continue
        r["used"] = True
        grp = [r]
        changed = True
        while changed:
            changed = False
            x0 = min(s["r"][0] for s in grp)
            x1 = max(s["r"][2] for s in grp)
            y0 = min(s["r"][1] for s in grp)
            y1 = max(s["r"][3] for s in grp)
            for s in rects:
                if s["used"] or abs(s["ang"]) >= 45:
                    continue
                hh = min(y1 - y0, s["r"][3] - s["r"][1])
                yov = min(y1, s["r"][3]) - max(y0, s["r"][1])
                gap = max(s["r"][0] - x1, x0 - s["r"][2])
                if yov > 0.65 * max(1, hh) and gap < 1.5 * max(1, hh):
                    grp.append(s)
                    s["used"] = True
                    changed = True
        lines.append(grp)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    for grp in lines:
        x0 = min(s["r"][0] for s in grp)
        x1 = max(s["r"][2] for s in grp)
        y0 = min(s["r"][1] for s in grp)
        y1 = max(s["r"][3] for s in grp)
        bh = max(1, y1 - y0)
        pad = 0.06 * bh
        X0, X1 = max(0, int(x0 - pad)), min(w, int(x1 + pad))
        Y0, Y1 = max(0, int(y0 - pad)), min(h, int(y1 + pad))
        samples = []
        for s in grp:
            bx0, by0, bx1, by1 = [int(v) for v in s["r"]]
            if bx1 > bx0 and by1 > by0:
                samples.append(hsv[by0:by1, bx0:bx1].reshape(-1, 3))
        if not samples:
            continue
        samples = np.concatenate(samples)
        sat = samples[:, 1].astype(float)
        val = samples[:, 2].astype(float)
        roi = hsv[Y0:Y1, X0:X1].astype(float)
        if np.percentile(sat, 80) > 70:
            text_h = float(np.median(samples[sat > np.percentile(sat, 70), 0]))
            dh = np.abs(roi[:, :, 0] - text_h)
            dh = np.minimum(dh, 180 - dh)
            sel = ((dh < 22) & (roi[:, :, 1] > 50)).astype(np.uint8) * 255
        else:
            text_v = float(np.median(samples[val > np.percentile(val, 60), 2]))
            sel = ((np.abs(roi[:, :, 2] - text_v) < 50) &
                   (roi[:, :, 1] < 100)).astype(np.uint8) * 255
        mask[Y0:Y1, X0:X1] = np.maximum(mask[Y0:Y1, X0:X1], sel)
    return mask


def build_mask(img: np.ndarray) -> tuple[np.ndarray, list, float]:
    """Automatic text mask. Returns mask, detector boxes, detection seconds."""
    h, w = img.shape[:2]
    t0 = time.time()
    boxes, _ = detector().text_detector(img)
    det_s = time.time() - t0
    boxes = [] if boxes is None else list(boxes)
    mask = np.zeros((h, w), np.uint8)
    heights = []
    for b in boxes:
        x0, y0, x1, y1 = _bbox(b)
        bw, bh = max(1, x1 - x0), max(1, y1 - y0)
        heights.append(bh if abs(_angle(b)) < 45 else bw)
        mask |= _seg_box(img, b)
    mask |= _line_colour_mask(img, [b for b in boxes if abs(_angle(b)) < 45])

    hmed = float(np.median(heights)) if heights else 8.0
    d = int(max(5, round(hmed * 0.22)))
    d = d if d % 2 else d + 1
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d)),
    )
    mask = cv2.dilate(
        mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d)),
    )
    return mask, boxes, det_s


# ---------------------------------------------------------------- inpainting

def _flat_fill(img: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Fill mask components whose surrounding ring is genuinely flat."""
    out = img.copy()
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        (mask > 127).astype(np.uint8), 8,
    )
    flat = np.zeros_like(mask)
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area < 8 or area > 0.28 * img.shape[0] * img.shape[1]:
            continue
        comp = (labels == i).astype(np.uint8)
        ring = (cv2.dilate(comp, np.ones((9, 9), np.uint8)) > 0) & (comp == 0)
        if ring.sum() < 12:
            continue
        vals = lab[ring]
        if vals[:, 0].std() < 8 and np.abs(vals[:, 1:].astype(float) - 128).std() < 8:
            col = np.median(vals, 0).astype(np.uint8).reshape(1, 1, 3)
            out[comp > 0] = cv2.cvtColor(col, cv2.COLOR_LAB2BGR).reshape(3)
            flat[comp > 0] = 255
    return out, flat


def inpaint(img: np.ndarray, mask: np.ndarray,
            max_side: int = DEFAULT_WORK_SIDE) -> dict[str, Any]:
    """Downscale, flat-fill, then LaMa the remaining mask."""
    h, w = img.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    W, H = max(2, int(round(w * scale))), max(2, int(round(h * scale)))
    work = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    small = cv2.resize(mask, (W, H), interpolation=cv2.INTER_NEAREST)
    small = (small > 90).astype(np.uint8) * 255
    small = cv2.dilate(small, np.ones((3, 3), np.uint8))

    t0 = time.time()
    flat_img, flat = _flat_fill(work, small)
    flat_s = time.time() - t0

    remaining = small.copy()
    remaining[flat > 0] = 0
    lama_s = 0.0
    if int(remaining.sum()) > 0:
        t0 = time.time()
        out = lama_engine()(
            Image.fromarray(cv2.cvtColor(flat_img, cv2.COLOR_BGR2RGB)),
            Image.fromarray(remaining),
        )
        lama_s = time.time() - t0
        lama = cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)
        if lama.shape[0] < H or lama.shape[1] < W:
            lama = cv2.copyMakeBorder(
                lama, 0, max(0, H - lama.shape[0]), 0, max(0, W - lama.shape[1]),
                cv2.BORDER_REPLICATE,
            )
        lama = lama[:H, :W]
        comp = flat_img.copy()
        m = remaining > 0
        comp[m] = lama[m]
    else:
        comp = flat_img

    return {
        "art": comp,
        "work_mask": small,
        "flat_mask": flat,
        "work_size": [W, H],
        "scale": scale,
        "flat_s": round(flat_s, 2),
        "lama_s": round(lama_s, 2),
        "flat_pct": round(float((flat > 0).mean() * 100), 1),
    }


# ---------------------------------------------------------------- crop search

def _integral(a: np.ndarray) -> np.ndarray:
    return cv2.integral(a.astype(np.float64))


def _rsum(ii: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    return float(ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0])


def find_crops(art: np.ndarray, mask: np.ndarray | None,
               min_h_frac: float = 0.55) -> list[dict[str, Any]]:
    """Score spine-aspect crop windows. Pure integral-image scan."""
    h, w = art.shape[:2]
    gray = cv2.cvtColor(art, cv2.COLOR_BGR2GRAY)
    edges = (cv2.Canny(gray, 60, 160) > 0).astype(np.uint8)
    non_dark = (gray > 40).astype(np.uint8)
    blur = cv2.GaussianBlur(gray, (0, 0), 9)
    sal = np.abs(gray.astype(np.float32) - blur)
    m = np.zeros((h, w), np.uint8) if mask is None else (mask > 0).astype(np.uint8)
    ii_m = _integral(m)
    ii_g = _integral(gray)
    ii_g2 = _integral(gray.astype(np.float64) ** 2)
    ii_e = _integral(edges)
    ii_nd = _integral(non_dark)
    ii_s = _integral(sal)

    heights = sorted({int(round(v)) for v in np.linspace(h * min_h_frac, h, 14)})
    cands = []
    for ch in heights:
        cw = int(round(ch * SPINE_ASPECT))
        if cw < 18 or cw > w:
            continue
        xs = np.linspace(0, w - cw, 26)
        ys = np.linspace(0, h - ch, 26)
        for y in ys:
            for x in xs:
                x0, y0 = int(round(x)), int(round(y))
                x1, y1 = x0 + cw, y0 + ch
                area = cw * ch
                cov = _rsum(ii_m, x0, y0, x1, y1) / area
                mean = _rsum(ii_g, x0, y0, x1, y1) / area
                var = _rsum(ii_g2, x0, y0, x1, y1) / area - mean * mean
                std = math.sqrt(max(0.0, var))
                edge = _rsum(ii_e, x0, y0, x1, y1) / area
                nd = _rsum(ii_nd, x0, y0, x1, y1) / area
                salience = _rsum(ii_s, x0, y0, x1, y1) / area
                size = ch / h
                score = (
                    -8.0 * cov
                    + 1.25 * min(std / 45.0, 1.0)
                    + 1.0 * min(edge / 0.06, 1.0)
                    + 0.45 * min(salience / 18.0, 1.0)
                    + 0.35 * size
                    + 0.3 * min(nd / 0.5, 1.0)
                )
                cands.append({
                    "box": [x0, y0, cw, ch],
                    "coverage": round(float(cov), 5),
                    "luma_std": round(std, 2),
                    "edge_density": round(float(edge), 4),
                    "non_dark": round(float(nd), 3),
                    "salience": round(float(salience), 2),
                    "score": round(float(score), 4),
                })
    cands.sort(key=lambda c: (-c["score"], c["coverage"]))
    return cands


def pick_text_free_crop(art: np.ndarray, mask: np.ndarray,
                        max_checks: int = 5) -> tuple[dict[str, Any] | None, list]:
    """Pick a zero-coverage crop that also passes residual OCR."""
    cands = [c for c in find_crops(art, mask) if c["coverage"] <= 0.002]
    checked = []
    for c in cands:
        if len(checked) >= max_checks:
            break
        x, y, ww, hh = c["box"]
        crop = art[y:y + hh, x:x + ww]
        hits = ocr_texts(crop, conf_min=0.55)
        hits = [h for h in hits if len(h["text"]) >= 2]
        checked.append({"box": c["box"], "ocr": hits})
        if not hits:
            c = dict(c)
            c["ocr"] = []
            return c, checked
    return None, checked


def best_visual_crop(art: np.ndarray, mask: np.ndarray | None = None) -> dict[str, Any]:
    cands = find_crops(art, mask)
    return cands[0]


# ---------------------------------------------------------------- metrics/QA

def _luma(rgb_bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb_bgr, cv2.COLOR_BGR2GRAY)


def image_stats(img: np.ndarray) -> dict[str, Any]:
    g = _luma(img)
    lap = cv2.Laplacian(g, cv2.CV_32F)
    edges = (cv2.Canny(g, 60, 160) > 0)
    p5, p95 = np.percentile(g, [5, 95])
    return {
        "luma_std": round(float(g.std()), 2),
        "luma_p5": round(float(p5), 1),
        "luma_p95": round(float(p95), 1),
        "non_dark_pct": round(float((g > 40).mean() * 100), 1),
        "edge_density": round(float(edges.mean()), 4),
        "laplacian_var": round(float(lap.var()), 1),
    }


def palette_corr(crop: np.ndarray, cover: np.ndarray,
                 cover_mask: np.ndarray | None = None) -> float:
    def hist(im):
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
        return h
    if cover_mask is not None and (cover_mask > 0).any():
        keep = cover.copy()
        # neutralise masked text so palette is measured on artwork only
        keep[cover_mask > 0] = np.median(
            keep[cover_mask == 0].reshape(-1, 3), 0
        ).astype(np.uint8)
    else:
        keep = cover
    return round(float(cv2.compareHist(hist(crop), hist(keep), cv2.HISTCMP_CORREL)), 3)


def seam_metrics(source: np.ndarray, art: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    m = (mask > 0).astype(np.uint8)
    if int(m.sum()) == 0:
        return {"seam_ratio": 0.0, "inside_vs_ring_delta_e": 0.0,
                "inside_ring_std_ratio": 0.0, "boundary_px": 0}
    k3 = np.ones((3, 3), np.uint8)
    k15 = np.ones((15, 15), np.uint8)
    boundary = (cv2.dilate(m, k3) > 0) & (cv2.erode(m, k3) == 0)
    ring = (cv2.dilate(m, k15) > 0) & (cv2.dilate(m, k3) == 0)
    g = cv2.Laplacian(_luma(art), cv2.CV_32F)
    seam = float(np.abs(g[boundary]).mean()) if boundary.any() else 0.0
    ref = float(np.abs(g[ring]).mean()) if ring.any() else 0.0
    ratio = round(seam / (ref + 1e-6), 2)

    lab_s = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_a = cv2.cvtColor(art, cv2.COLOR_BGR2LAB).astype(np.float32)
    inside = m > 0
    if ring.any() and inside.any():
        ring_med = np.median(lab_s[ring], 0)
        de = float(np.linalg.norm(lab_a[inside] - ring_med, axis=1).mean())
        sstd = float(lab_a[inside, 0].std())
        rstd = float(lab_s[ring, 0].std())
        std_ratio = round(sstd / (rstd + 1e-6), 2)
    else:
        de, std_ratio = 0.0, 0.0
    return {
        "seam_ratio": ratio,
        "inside_vs_ring_delta_e": round(de, 1),
        "inside_ring_std_ratio": std_ratio,
        "boundary_px": int(boundary.sum()),
    }


def qa_report(source: np.ndarray, art: np.ndarray, mask: np.ndarray,
              crop: np.ndarray, crop_box: list[int],
              title: str = "", author: str = "") -> dict[str, Any]:
    h, w = source.shape[:2]
    crop_area = crop.shape[0] * crop.shape[1]
    y0, y1 = crop_box[1], crop_box[1] + crop_box[3]
    x0, x1 = crop_box[0], crop_box[0] + crop_box[2]
    crop_mask_cov = float((mask[y0:y1, x0:x1] > 0).mean() * 100) if mask.size else 0.0
    spine = cv2.resize(crop, (SPINE_W, SPINE_H), interpolation=cv2.INTER_LANCZOS4)
    stats = image_stats(spine)
    art_hits = ocr_texts(art, conf_min=0.5)
    crop_hits = ocr_texts(crop, conf_min=0.55)
    spine_hits = ocr_texts(
        cv2.resize(spine, (SPINE_W * 4, SPINE_H * 4), interpolation=cv2.INTER_CUBIC),
        conf_min=0.5,
    )
    # De-duplicate by normalised text.
    def clean(hits):
        out, seen = [], set()
        for h in hits:
            t = h["text"].strip()
            if len(t) < 2:
                continue
            k = t.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(h)
        return out
    art_hits, crop_hits, spine_hits = clean(art_hits), clean(crop_hits), clean(spine_hits)
    metrics = {
        "mask_coverage_pct": round(float((mask > 0).mean() * 100), 2),
        "crop_mask_coverage_pct": round(crop_mask_cov, 3),
        "art_residual_ocr": art_hits,
        "crop_residual_ocr": crop_hits,
        "spine_residual_ocr": spine_hits,
        "spine": stats,
        "palette_corr": palette_corr(crop, source, mask),
        "seam": seam_metrics(source, art, mask),
    }
    metrics["spine"]["width_px"] = SPINE_W
    metrics["spine"]["height_px"] = SPINE_H
    return metrics


# ---------------------------------------------------------------- decisions

def decide(route: str, m: dict[str, Any]) -> dict[str, Any]:
    reasons = []
    if route == "crop":
        if m["crop_residual_ocr"] or m["spine_residual_ocr"]:
            return {"verdict": "fallback", "reasons": ["residual text in the text-free crop"]}
        if m["spine"]["luma_std"] < 10 or m["spine"]["edge_density"] < 0.006:
            return {"verdict": "fallback", "reasons": ["crop is too flat or has too little structure"]}
        if m["spine"]["luma_std"] < 16 or m["spine"]["edge_density"] < 0.012:
            return {"verdict": "review", "reasons": ["crop survives but structure is marginal"]}
        return {"verdict": "pass", "reasons": ["zero mask coverage, no residual OCR, structure at spine scale"]}

    if m["spine_residual_ocr"]:
        reasons.append("residual text is readable in the 52x236 spine")
    if m["mask_coverage_pct"] > 55:
        reasons.append("more than 55% of the cover was reconstructed")
    elif m["mask_coverage_pct"] > 40:
        reasons.append("40-55% of the cover was reconstructed")
    if m["seam"]["seam_ratio"] > 3.0:
        reasons.append("seam gradient is >3x the local reference")
    if m["seam"]["inside_vs_ring_delta_e"] > 55:
        reasons.append("inpainted region differs strongly from its ring")
    if m["spine"]["luma_std"] < 10 or m["spine"]["edge_density"] < 0.006:
        reasons.append("spine has too little structure")
    elif m["spine"]["luma_std"] < 16:
        reasons.append("spine structure is marginal")

    if any("residual text" in r or "more than 55%" in r or "too little structure" in r for r in reasons):
        return {"verdict": "fallback", "reasons": reasons}
    if reasons:
        return {"verdict": "review", "reasons": reasons}
    return {"verdict": "pass", "reasons": ["no residual OCR, controlled mask, adequate spine structure"]}


# ---------------------------------------------------------------- fallback art

def fallback_spine(title: str, author: str, path: str) -> None:
    W, H = SPINE_W * 4, SPINE_H * 4
    img = Image.new("RGB", (W, H), (74, 52, 44))
    d = ImageDraw.Draw(img)
    for y in range(H):
        f = y / H
        d.line([(0, y), (W, y)], fill=(int(74 + 10 * f), int(52 + 8 * f), int(44 + 6 * f)))
    serif = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
    serif_b = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
    title = (title or "Untitled").upper()
    author = (author or "").upper()

    def wrap(text, font, maxw, split_long=False):
        words, lines, cur = text.split(), [], ""
        for word in words:
            if split_long and d.textlength(word, font=font) > maxw and len(word) > 1:
                while d.textlength(word, font=font) > maxw and len(word) > 1:
                    cut = len(word)
                    while cut > 1 and d.textlength(word[:cut], font=font) > maxw:
                        cut -= 1
                    if cur:
                        lines.append(cur)
                        cur = ""
                    lines.append(word[:cut])
                    word = word[cut:]
            test = (cur + " " + word).strip()
            if d.textlength(test, font=font) <= maxw or not cur:
                cur = test
            else:
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines

    font = ImageFont.truetype(serif_b, 30)
    lines, size = [], 30
    for size in range(30, 7, -1):
        font = ImageFont.truetype(serif_b, size)
        lines = wrap(title, font, W - 24, split_long=False)
        if (len(lines) <= 6
                and all(d.textlength(line, font=font) <= W - 24 for line in lines)):
            break
    else:
        size = 9
        font = ImageFont.truetype(serif_b, size)
        lines = wrap(title, font, W - 24, split_long=True)
    y = 28
    for line in lines:
        tw = d.textlength(line, font=font)
        d.text(((W - tw) / 2, y), line, font=font, fill=(238, 224, 198))
        y += size + 4
    if author:
        font2 = ImageFont.truetype(serif, 15)
        lines2 = wrap(author, font2, W - 24)
        y = H - 26 - len(lines2) * 18
        for line in lines2:
            tw = d.textlength(line, font=font2)
            d.text(((W - tw) / 2, y), line, font=font2, fill=(214, 194, 162))
            y += 18
    img.resize((SPINE_W, SPINE_H), Image.LANCZOS).save(path, quality=94)
