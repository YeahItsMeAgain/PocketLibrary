#!/usr/bin/env python3
"""Compare bundled text models with fp32: mask IoU, OCR retention, spine PSNR."""
from __future__ import annotations

import difflib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
VARIANTS = {
    "det_int8_range": "eval/out-det-dyn-range",
    "det+rec_int8_range": "eval/out-int8-range",
    "det_int8_range+rec_fp32": "eval/bench-out/text-det-range-rec-fp32-1",
    "det_int8_dynamic": "eval/out-int8-dynamic",
    "det_int8_static": "eval/out-det-static-rec-fp32",
    "det_int8_static_conv": "eval/out-det-static-conv-rec-fp32",
}


def mask(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("L"), dtype=np.uint8) > 0


def iou(a: np.ndarray, b: np.ndarray) -> float:
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 1.0


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    d = a.astype(np.float64) - b.astype(np.float64)
    mse = float(np.mean(d * d))
    return 99.0 if mse < 1e-12 else float(10 * np.log10(255 * 255 / mse))


def text_score(ref: list[str], got: list[str]) -> tuple[float, float]:
    """Mean best character similarity and recall at >=0.8 for reference lines."""
    if not ref:
        return 1.0, 1.0
    bests = []
    for r in ref:
        bests.append(max((difflib.SequenceMatcher(None, r.lower(), g.lower()).ratio() for g in got), default=0.0))
    return float(np.mean(bests)), float(np.mean([b >= 0.8 for b in bests]))


def main() -> None:
    out = []
    for name, rel in VARIANTS.items():
        print(f"\n== {name}")
        for book in BOOKS:
            base = ROOT / "eval/out-fp32" / book
            cur = ROOT / rel / book
            if not (cur / "run.json").exists():
                print(f"  {book}: MISSING {cur}")
                continue
            bd = json.loads((base / "run.json").read_text())
            cd = json.loads((cur / "run.json").read_text())
            base_mask = mask(base / "mask.png")
            cur_mask = mask(cur / "mask.png")
            ref_text = [h["text"] for h in bd["detected_text"]]
            got_text = [h["text"] for h in cd["detected_text"]]
            sim, recall = text_score(ref_text, got_text)
            a = np.asarray(Image.open(base / "spine.jpg").convert("RGB"))
            b = np.asarray(Image.open(cur / "spine.jpg").convert("RGB"))
            if a.shape != b.shape:
                b = np.asarray(Image.fromarray(b).resize((a.shape[1], a.shape[0])))
            row = {
                "variant": name,
                "book": book,
                "same_route": bd["route"] == cd["route"],
                "same_verdict": bd["verdict"] == cd["verdict"],
                "mask_iou": round(iou(base_mask, cur_mask), 4),
                "mask_cov_fp32": bd["mask"]["coverage_pct"],
                "mask_cov_variant": cd["mask"]["coverage_pct"],
                "ocr_lines_fp32": len(ref_text),
                "ocr_lines_variant": len(got_text),
                "ocr_similarity": round(sim, 3),
                "ocr_recall_at_0.8": round(recall, 3),
                "residual_spine": len(cd["qa"]["chosen"]["spine_residual_ocr"]),
                "residual_crop": len(cd["qa"]["chosen"]["crop_residual_ocr"]),
                "spine_psnr_db": round(psnr(a, b), 2),
            }
            out.append(row)
            print(f"  {book:14} route={'=' if row['same_route'] else '!'} verdict={'=' if row['same_verdict'] else '!'} "
                  f"IoU {row['mask_iou']:.3f} cov {row['mask_cov_fp32']:.1f}->{row['mask_cov_variant']:.1f} "
                  f"ocr {row['ocr_lines_fp32']}->{row['ocr_lines_variant']} sim {row['ocr_similarity']:.2f} "
                  f"spine {row['spine_psnr_db']:.1f} dB")
    (ROOT / "out/text-quality.json").write_text(json.dumps(out, indent=2))
    print("\nwrote out/text-quality.json")


if __name__ == "__main__":
    main()
