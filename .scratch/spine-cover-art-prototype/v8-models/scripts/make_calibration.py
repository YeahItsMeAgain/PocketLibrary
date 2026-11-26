#!/usr/bin/env python3
"""Build deterministic calibration tensors for det/rec/LaMa INT8 quantisation.

Inputs are read-only: the five v8 sample covers and the automatic masks already
produced by v8-app. Nothing here writes outside v8-models/.

Outputs:
  calib/det/det-XX.npz   image = float32 [1,3,H,W], ImageNet-normalised
  calib/rec/rec-XX.npz   image = float32 [1,3,48,W], (p/255-0.5)/0.5
  calib/lama/lama-XX.npz image = float32 [1,3,512,512] in 0..1, mask = float32
                         [1,1,512,512] binary, letterboxed exactly like fill.rs
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
V8 = ROOT.parent / "v8-app"
OUT = ROOT / "calib"
BOOKS = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def resize_rgb(img: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.asarray(Image.fromarray(img).resize((w, h), Image.BILINEAR), dtype=np.uint8)


def resize_gray(img: np.ndarray, w: int, h: int) -> np.ndarray:
    return np.asarray(Image.fromarray(img).resize((w, h), Image.NEAREST), dtype=np.uint8)


def nchw(img: np.ndarray) -> np.ndarray:
    return np.transpose(img, (2, 0, 1)).astype(np.float32)


def det_preprocess(img: np.ndarray, limit_side: int = 960) -> np.ndarray:
    """Mirror detect.rs `preprocess` with limit_type='min'."""
    h, w = img.shape[:2]
    ratio = limit_side / float(min(w, h)) if min(w, h) < limit_side else 1.0
    rw = max(32, int(round((w * ratio) / 32.0) * 32))
    rh = max(32, int(round((h * ratio) / 32.0) * 32))
    small = resize_rgb(img, rw, rh)
    x = nchw(small) / 255.0
    return ((x - MEAN[:, None, None]) / STD[:, None, None])[None]


def rec_preprocess(crop: np.ndarray) -> np.ndarray:
    h, w = crop.shape[:2]
    target_h = 48
    target_w = int(np.clip(np.ceil(target_h * w / h), 2, 2048))
    small = resize_rgb(crop, target_w, target_h)
    return ((nchw(small) / 255.0 - 0.5) / 0.5)[None]


def letterbox512(img: np.ndarray, mask: np.ndarray):
    h, w = img.shape[:2]
    scale = min(512.0 / w, 512.0 / h)
    nw = int(np.clip(round(w * scale), 1, 512))
    nh = int(np.clip(round(h * scale), 1, 512))
    small = resize_rgb(img, nw, nh)
    msmall = resize_gray(mask, nw, nh)
    canvas = np.zeros((512, 512, 3), dtype=np.uint8)
    mcanvas = np.zeros((512, 512), dtype=np.uint8)
    ox, oy = (512 - nw) // 2, (512 - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = small
    mcanvas[oy:oy + nh, ox:ox + nw] = msmall
    x = np.transpose(canvas.astype(np.float32) / 255.0, (2, 0, 1))[None]
    m = (mcanvas > 127).astype(np.float32)[None, None]
    return x, m


def main() -> None:
    for sub in ("det", "rec", "lama"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    det_n = rec_n = lama_n = 0
    for slug in BOOKS:
        run_dir = V8 / "out" / slug
        img = rgb(run_dir / "source.jpg")
        mask = np.asarray(Image.open(run_dir / "mask.png").convert("L"), dtype=np.uint8)

        np.savez_compressed(OUT / "det" / f"det-{slug}.npz", x=det_preprocess(img))
        det_n += 1

        li, lm = letterbox512(img, mask)
        np.savez_compressed(OUT / "lama" / f"lama-{slug}.npz", image=li, mask=lm)
        lama_n += 1

        run = json.loads((run_dir / "run.json").read_text())
        for i, hit in enumerate(run.get("detected_text", [])):
            xs = [p[0] for p in hit["box_"]]
            ys = [p[1] for p in hit["box_"]]
            x0 = max(0, int(min(xs)) - 2)
            y0 = max(0, int(min(ys)) - 2)
            x1 = min(img.shape[1], int(max(xs)) + 2)
            y1 = min(img.shape[0], int(max(ys)) + 2)
            if x1 - x0 < 4 or y1 - y0 < 6:
                continue
            crop = img[y0:y1, x0:x1]
            np.savez_compressed(
                OUT / "rec" / f"rec-{slug}-{i:02d}.npz", x=rec_preprocess(crop)
            )
            rec_n += 1

    print(f"det={det_n} rec={rec_n} lama={lama_n} -> {OUT}")


if __name__ == "__main__":
    main()
