#!/usr/bin/env python3
"""Evaluate the 28 MB MI-GAN inpainting pipeline on the v8 sample masks.

The CardAnvil/andraniksargsyan ONNX pipeline takes uint8 NCHW image + mask.
Mask convention: 255 = keep, 0 = hole. v8 masks are the opposite (255 = text),
so they are inverted here.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def resize(img: np.ndarray, w: int, h: int, nearest: bool = False) -> np.ndarray:
    mode = Image.NEAREST if nearest else Image.BILINEAR
    return np.asarray(Image.fromarray(img).resize((w, h), mode), dtype=np.uint8)


def dilate1(m: np.ndarray) -> np.ndarray:
    p = np.pad(m, 1, mode="edge")
    out = m.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out = np.maximum(out, p[1 + dy:1 + dy + m.shape[0], 1 + dx:1 + dx + m.shape[1]])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--mask", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--crop-box", required=True)
    ap.add_argument("--max-side", type=int, default=720)
    ap.add_argument("--model", default=str(ROOT / "models/migan/migan_pipeline_v2.onnx"))
    a = ap.parse_args()

    src = np.asarray(Image.open(a.source).convert("RGB"), dtype=np.uint8)
    mask_full = np.asarray(Image.open(a.mask).convert("L"), dtype=np.uint8)
    h, w = src.shape[:2]
    scale = min(1.0, a.max_side / max(w, h))
    ww, wh = max(2, round(w * scale)), max(2, round(h * scale))
    work = resize(src, ww, wh)
    mwork = resize(mask_full, ww, wh, nearest=True)
    mwork = dilate1((mwork > 90).astype(np.uint8) * 255)

    # letterbox exactly like fill.rs
    sc = min(512.0 / ww, 512.0 / wh)
    nw, nh = max(1, min(512, round(ww * sc))), max(1, min(512, round(wh * sc)))
    canvas = np.zeros((512, 512, 3), dtype=np.uint8)
    mcanvas = np.full((512, 512), 255, dtype=np.uint8)
    ox, oy = (512 - nw) // 2, (512 - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = resize(work, nw, nh)
    hole = 255 - mwork  # text -> 0 (hole), background -> 255 (keep)
    mcanvas[oy:oy + nh, ox:ox + nw] = resize(hole, nw, nh, nearest=True)

    image = canvas.transpose(2, 0, 1)[None]
    mask = mcanvas[None, None]
    sess = ort.InferenceSession(a.model, providers=["CPUExecutionProvider"])
    t = time.perf_counter()
    out = sess.run(None, {"image": image, "mask": mask})[0]
    run_s = time.perf_counter() - t
    out = out[0].transpose(1, 2, 0)
    region = out[oy:oy + nh, ox:ox + nw]
    art = resize(region, ww, wh).copy()
    # Only replace the hole; keep known pixels exactly (pipeline should do this).
    keep = mwork == 0
    art[keep] = work[keep]

    x, y, cw, ch = map(int, a.crop_box.split(","))
    crop = art[y:y + ch, x:x + cw]
    spine = np.asarray(Image.fromarray(crop).resize((52, 236), Image.LANCZOS), dtype=np.uint8)

    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(art).save(outdir / "art.jpg", quality=92)
    Image.fromarray(crop).save(outdir / "crop-native.jpg", quality=92)
    Image.fromarray(spine).save(outdir / "spine.jpg", quality=92)
    (outdir / "run.json").write_text(json.dumps({
        "model": a.model,
        "work_size": [ww, wh],
        "crop_box": [x, y, cw, ch],
        "infer_s": round(run_s, 3),
    }, indent=2))
    print(f"{a.source} -> {outdir} infer {run_s:.2f}s")


if __name__ == "__main__":
    main()
