#!/usr/bin/env python3
"""Score quantised inpainted art against fp32 on the full art and 52x236 spine."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
VARIANTS = ["dynamic", "static", "conv"]


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)


def metrics(a: np.ndarray, b: np.ndarray) -> dict:
    d = a - b
    mae = float(np.mean(np.abs(d)))
    mse = float(np.mean(d * d))
    psnr = 99.0 if mse < 1e-12 else float(10.0 * np.log10(255.0 * 255.0 / mse))
    # grayscale, 7x7 uniform-window SSIM (sufficient for a monotonic comparison)
    ga = a.mean(axis=2)
    gb = b.mean(axis=2)
    win = 7
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    def box(x):
        k = np.ones(win) / win
        y = np.apply_along_axis(lambda r: np.convolve(r, k, mode="valid"), 1, x)
        return np.apply_along_axis(lambda c: np.convolve(c, k, mode="valid"), 0, y)

    ma, mb = box(ga), box(gb)
    va = box(ga * ga) - ma * ma
    vb = box(gb * gb) - mb * mb
    cov = box(ga * gb) - ma * mb
    ssim = float(np.mean(((2 * ma * mb + c1) * (2 * cov + c2)) /
                         ((ma * ma + mb * mb + c1) * (va + vb + c2))))
    return {"mae": round(mae, 2), "psnr_db": round(psnr, 2), "ssim": round(ssim, 4)}


def main() -> None:
    rows = []
    for book in BOOKS:
        ref_art = load(ROOT / f"eval/lama-fp32-fixed/{book}/art.jpg")
        ref_spine = load(ROOT / f"eval/lama-fp32-fixed/{book}/spine.jpg")
        for v in VARIANTS:
            art = load(ROOT / f"eval/lama-{v}-fixed/{book}/art.jpg")
            spine = load(ROOT / f"eval/lama-{v}-fixed/{book}/spine.jpg")
            row = {
                "book": book,
                "variant": v,
                "art": metrics(ref_art, art),
                "spine": metrics(ref_spine, spine),
            }
            rows.append(row)
            print(f"{book:14} {v:8} art PSNR {row['art']['psnr_db']:6.2f} SSIM {row['art']['ssim']:.4f} | "
                  f"spine PSNR {row['spine']['psnr_db']:6.2f} SSIM {row['spine']['ssim']:.4f}")
    (ROOT / "out/lama-quality.json").write_text(json.dumps(rows, indent=2))
    for v in VARIANTS:
        sp = [r["spine"] for r in rows if r["variant"] == v]
        art = [r["art"] for r in rows if r["variant"] == v]
        print(f"MEAN {v:8} art PSNR {np.mean([x['psnr_db'] for x in art]):.2f} "
              f"SSIM {np.mean([x['ssim'] for x in art]):.4f} | "
              f"spine PSNR {np.mean([x['psnr_db'] for x in sp]):.2f} "
              f"SSIM {np.mean([x['ssim'] for x in sp]):.4f}")


if __name__ == "__main__":
    main()
