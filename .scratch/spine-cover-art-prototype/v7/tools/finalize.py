#!/usr/bin/env python3
"""v7 final pass — region strategy per cover.

  HP      clone a clean sky patch over the title block, then LaMa the remaining
          author/badge/award furniture.
  LOTR    fill the flat black title block with a clean black texture; no ghost.
  Hobbit  whole title/author blocks on black; LaMa.
  Hunger  whole title and author blocks on black; LaMa.

Run:
  /tmp/opencode/v3venv/bin/python \
    .scratch/spine-cover-art-prototype/v7/tools/finalize.py
"""
import json
import os
import shutil
import time

import cv2
import numpy as np
import torch
from rapidocr_onnxruntime import RapidOCR

from simple_lama_inpainting import SimpleLama  # noqa: E402

# pipeline.py patches torch.jit.load for CPU deserialisation when imported.
from pipeline import spine_crop, mean_rgb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "source")
ART = os.path.join(ROOT, "assets", "art")
MASK = os.path.join(ROOT, "assets", "mask")


def rect_mask(shape, polys, feather=0):
    h, w = shape[:2]
    mask = np.zeros((h, w), np.uint8)
    for poly in polys:
        pts = np.array([[int(x * w), int(y * h)] for x, y in poly], np.int32)
        cv2.fillPoly(mask, [pts], 255)
    return mask


def feather_blend(base, patch, mask, blur=9):
    m = cv2.GaussianBlur(mask, (blur | 1, blur | 1), 0).astype(np.float32) / 255.0
    m = m[..., None]
    return (patch.astype(np.float32) * m + base.astype(np.float32) * (1 - m)).astype(np.uint8)


def tiled_patch(img, src_rect, dst_shape):
    x0, y0, x1, y1 = [int(v) for v in src_rect]
    tile = img[y0:y1, x0:x1]
    th, tw = tile.shape[:2]
    dh, dw = dst_shape[:2]
    rows = []
    for y in range(0, dh, th):
        row = []
        for x in range(0, dw, tw):
            t = tile if (x // tw + y // th) % 2 == 0 else cv2.flip(tile, 1)
            row.append(t)
        rows.append(np.hstack(row)[:dw])
    out = np.vstack(rows)[:dh]
    if out.shape[1] != dw or out.shape[0] != dh:
        out = cv2.resize(out, (dw, dh), interpolation=cv2.INTER_LANCZOS4)
    return out


def black_fill(img, mask):
    """Fill masked pixels with a clean dark texture sampled from inside the ring."""
    h, w = img.shape[:2]
    patch = img[int(0.55 * h):int(0.63 * h), int(0.18 * w):int(0.26 * w)]
    fill = tiled_patch(patch, (0, 0, patch.shape[1], patch.shape[0]), (h, w))
    out = feather_blend(img, fill, mask, 7)
    return out


def main():
    lama = SimpleLama(device="cpu")
    report = json.load(open(os.path.join(ROOT, "tools", "recon-meta.json")))
    os.makedirs(os.path.join(ART, "firstpass"), exist_ok=True)

    # HP: clone sky over the title block.
    hp = cv2.imread(os.path.join(SRC, "harry-potter.jpg"))
    h, w = hp.shape[:2]
    shutil.copyfile(os.path.join(ART, "harry-potter.jpg"),
                    os.path.join(ART, "firstpass", "harry-potter-refine.jpg"))

    title = rect_mask(hp.shape, [[[0.0, 0.0], [1.0, 0.0], [1.0, 0.253], [0.0, 0.253]]])
    src_rect = (int(0.78 * w), int(0.01 * h), w, int(0.255 * h))
    patch = tiled_patch(hp, src_rect, (h, w))
    hp2 = feather_blend(hp, patch, title, 21)

    rest = rect_mask(hp.shape, [
        [[0.03, 0.245], [0.97, 0.245], [0.97, 0.405], [0.03, 0.405]],  # subtitle + author band
        [[0.02, 0.935], [0.98, 0.935], [0.98, 1.0], [0.02, 1.0]],      # Smarties band
    ])
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = int(0.742 * w), int(0.487 * h)
    rr = int(0.112 * h)
    rest[((xx - cx) ** 2 + (yy - cy) ** 2) < rr ** 2] = 255
    rest = cv2.dilate(rest, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)), 1)

    t0 = time.time()
    out = np.array(lama(cv2.cvtColor(hp2, cv2.COLOR_BGR2RGB), rest))
    hp_art = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if hp_art.shape[:2] != (h, w):
        hp_art = cv2.resize(hp_art, (w, h), interpolation=cv2.INTER_LANCZOS4)
    hp_secs = time.time() - t0

    # LOTR: flat black fill, not LaMa.
    lo = cv2.imread(os.path.join(SRC, "lord-of-the-rings.jpg"))
    h, w = lo.shape[:2]
    shutil.copyfile(os.path.join(ART, "lord-of-the-rings.jpg"),
                    os.path.join(ART, "firstpass", "lord-of-the-rings-refine.jpg"))
    lo_mask = rect_mask(lo.shape, [[[0.165, 0.165], [0.835, 0.165], [0.835, 0.69], [0.165, 0.69]]])
    lo_art = black_fill(lo, lo_mask)

    # Hobbit: whole blocks (glyph threshold missed the lower half of the white type).
    hb = cv2.imread(os.path.join(SRC, "the-hobbit.jpg"))
    h, w = hb.shape[:2]
    shutil.copyfile(os.path.join(ART, "the-hobbit.jpg"),
                    os.path.join(ART, "firstpass", "the-hobbit-refine.jpg"))
    hb_mask = rect_mask(hb.shape, [
        [[0.02, 0.07], [0.98, 0.07], [0.98, 0.245], [0.02, 0.245]],
        [[0.04, 0.835], [0.96, 0.835], [0.96, 0.975], [0.04, 0.975]],
    ])
    hb_mask = cv2.dilate(hb_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), 1)
    t0 = time.time()
    out = np.array(lama(cv2.cvtColor(hb, cv2.COLOR_BGR2RGB), hb_mask))
    hb_art = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if hb_art.shape[:2] != (h, w):
        hb_art = cv2.resize(hb_art, (w, h), interpolation=cv2.INTER_LANCZOS4)
    hb_secs = time.time() - t0

    # Hunger Games: title + author + NYT line as whole blocks.
    hg = cv2.imread(os.path.join(SRC, "the-hunger-games.jpg"))
    h, w = hg.shape[:2]
    shutil.copyfile(os.path.join(ART, "the-hunger-games.jpg"),
                    os.path.join(ART, "firstpass", "the-hunger-games-refine.jpg"))
    hg_mask = rect_mask(hg.shape, [
        [[0.02, 0.02], [0.98, 0.02], [0.98, 0.36], [0.02, 0.36]],
        [[0.44, 0.725], [0.995, 0.725], [0.995, 0.975], [0.44, 0.975]],
    ])
    hg_mask = cv2.dilate(hg_mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), 1)
    t0 = time.time()
    out = np.array(lama(cv2.cvtColor(hg, cv2.COLOR_BGR2RGB), hg_mask))
    hg_art = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if hg_art.shape[:2] != (h, w):
        hg_art = cv2.resize(hg_art, (w, h), interpolation=cv2.INTER_LANCZOS4)
    hg_secs = time.time() - t0

    finals = {
        "harry-potter": (hp, hp_art, rest, hp_secs),
        "lord-of-the-rings": (lo, lo_art, lo_mask, 0.0),
        "the-hobbit": (hb, hb_art, hb_mask, hb_secs),
        "the-hunger-games": (hg, hg_art, hg_mask, hg_secs),
    }
    for slug, (orig, art, mask, secs) in finals.items():
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
                    spine_crop(art, slug, 52, 236), [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(ROOT, "assets", "retina", f"{slug}.jpg"),
                    spine_crop(art, slug, 104, 472), [cv2.IMWRITE_JPEG_QUALITY, 95])

        ocr = RapidOCR()
        res, _ = ocr(os.path.join(ART, f"{slug}.jpg"))
        residual = [{"text": t, "conf": round(float(c), 3)}
                    for _, t, c in (res or []) if float(c) >= 0.30]
        spine = cv2.imread(os.path.join(ROOT, "assets", "spine", f"{slug}.jpg"))
        sg = cv2.cvtColor(spine, cv2.COLOR_BGR2GRAY)
        report[slug].update({
            "maskFraction": round(float((mask > 0).sum()) / (w * h), 4),
            "inpaintSeconds": round(secs, 2),
            "engine": "LaMa big-lama + clean-patch fill, CPU; final region masks",
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
