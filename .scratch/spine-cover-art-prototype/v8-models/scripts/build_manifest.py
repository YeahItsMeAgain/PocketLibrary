#!/usr/bin/env python3
"""Build MANIFEST.json from the staged dist/ files and the measured study."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def entry(path: Path, **kw) -> dict:
    return {
        "path": str(path.relative_to(ROOT)),
        "bytes": path.stat().st_size,
        "mib": round(path.stat().st_size / (1024 * 1024), 2),
        "sha256": sha(path),
        **kw,
    }


def main() -> None:
    det = ROOT / "dist/text-bundled/det.onnx"
    rec_fp32 = ROOT / "dist/text-bundled/rec.onnx"
    keys = ROOT / "dist/text-bundled/keys.txt"
    rec_int8 = ROOT / "dist/text-min/rec.onnx"
    migan = ROOT / "dist/inpaint-migan/migan_pipeline_v2.onnx"
    lama8 = ROOT / "dist/inpaint-lama-int8/lama.onnx"
    lama32 = ROOT / "dist/inpaint-lama-fp32/lama_fp32.onnx"

    det_contract = {
        "inputs": {"x": {"dtype": "float32", "shape": ["N", 3, "H", "W"],
                          "layout": "NCHW", "normalise": "(p/255 - [0.485,0.456,0.406]) / [0.229,0.224,0.225]"}},
        "outputs": {"sigmoid_0.tmp_0": {"dtype": "float32", "shape": ["N", 1, "H", "W"],
                                         "meaning": "text probability map"}},
        "postprocess": "threshold 0.18, box score 0.28, unclip 1.9, 2x2 dilation, resize max/min side 960",
        "opset": 12,
    }
    rec_contract = {
        "inputs": {"x": {"dtype": "float32", "shape": ["N", 3, 48, "W"],
                          "layout": "NCHW", "normalise": "(p/255 - 0.5) / 0.5",
                          "width": "round(48 * crop_w / crop_h), clamp 2..2048"}},
        "outputs": {"softmax_5.tmp_0": {"dtype": "float32", "shape": ["N", "T", 6625],
                                         "meaning": "per-timestep character logits; argmax, collapse repeats, drop blank"}},
        "keys": "keys.txt: one character per line, 6624 entries, index 0 is CTC blank, a space is appended",
        "opset": 12,
    }
    migan_contract = {
        "inputs": {
            "image": {"dtype": "uint8", "shape": ["N", 3, "H", "W"], "layout": "NCHW", "range": "0..255"},
            "mask": {"dtype": "uint8", "shape": ["N", 1, "H", "W"], "range": "0..255",
                      "convention": "255 = keep/known, 0 = hole to inpaint (invert v8-app mask.png before use)"},
        },
        "outputs": {"result": {"dtype": "uint8", "shape": ["N", 3, "H", "W"], "range": "0..255"}},
        "recommended_use": "letterbox image and inverted mask into 512x512, run, crop back; tested 512x512",
        "opset": 17,
    }
    lama_contract = {
        "inputs": {
            "image": {"dtype": "float32", "shape": [1, 3, 512, 512], "range": "0..1", "layout": "NCHW"},
            "mask": {"dtype": "float32", "shape": [1, 1, 512, 512], "range": "0 or 1", "convention": "1 = hole to inpaint"},
        },
        "outputs": {"output": {"dtype": "float32", "shape": [1, 3, 512, 512], "range": "0..255"}},
        "recommended_use": "letterbox the v8 work image and mask into 512x512, run, crop back",
        "opset": 17,
    }

    def bfile(path: Path) -> dict:
        return {"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size, "sha256": sha(path)}

    manifest = {
        "schema": 1,
        "study": "v8-models",
        "generated": "2026-11-26",
        "host": {"cpu": "x86-64, 6 threads", "onnxruntime": "1.32.0 CPUExecutionProvider",
                  "note": "No Android device or emulator was available; phone figures are estimates only."},
        "recommendation": {
            "bundled_text": "text-bundled (11.48 MB): det INT8 dynamic reduce_range + rec FP32. "
                            "Same routes/verdicts as FP32 on all five samples; rec stays accurate for QA.",
            "smallest_text": "text-detect-only (0.79 MB): detection only. Tested detector-only residual text "
                             "on all five 52x236 fallback spines; requires the app to accept detector-only QA.",
            "avoid": "text-min (3.74 MB) is small but rec INT8 returns no text on every 52x236 text spine; "
                      "do not use it as the only residual-text gate.",
            "optional_inpaint": "inpaint-migan (28.08 MB): recommended optional download. ~2.4 s and ~500 MB "
                                 "peak on host, no worse residual text than LaMa on the five samples.",
            "rejected_inpaint": "inpaint-lama-int8 (62.2 MB): ~1.4x faster than FP32 but visible chroma/scar "
                                 "artifacts at 52x236. Keep LaMa FP32 only as a quality reference.",
            "fallback": "flat ring-median + smoothing, 0 MB, already in v8-app.",
        },
        "models": [
            entry(det,
                  id="ppocrv3-det-int8-dynamic-range",
                  role="text detection / residual-text gate",
                  license="Apache-2.0 (PaddleOCR / Baidu; RapidOCR packaging)",
                  source="converted from v8-app/models/det.onnx",
                  quantisation="ONNX Runtime quantize_dynamic, QInt8 weights, per-channel, reduce_range=True; "
                               "Constant weights hoisted to initializers first",
                  contract=det_contract,
                  measured={"detection_median_s": 2.81, "pipeline_peak_rss_mb": 568,
                            "route_verdict_match_5": "5/5", "mask_iou_vs_fp32": [0.856, 0.942, 0.981, 0.925, 0.932],
                            "ocr_text_similarity": [1.0, 1.0, 1.0, 0.84, 0.99],
                            "small_spine_text_boxes": [6, 3, 4, 3, 3],
                            "verdict": "recommended for bundled detection"}),
            entry(rec_fp32,
                  id="ppocrv3-rec-fp32",
                  role="text recognition / QA",
                  license="Apache-2.0 (PaddleOCR / Baidu; RapidOCR packaging)",
                  source="v8-app/models/rec.onnx (unchanged)",
                  quantisation="none",
                  contract=rec_contract,
                  measured={"small_spine_text_lines": [5, 4, 5, 3, 3], "verdict": "recommended with det INT8"}),
            entry(rec_int8,
                  id="ppocrv3-rec-int8-dynamic-range",
                  role="smallest recognition (evaluated, not recommended)",
                  license="Apache-2.0 (PaddleOCR / Baidu; RapidOCR packaging)",
                  source="converted from v8-app/models/rec.onnx",
                  quantisation="ONNX Runtime quantize_dynamic, QInt8 weights, per-channel, reduce_range=True",
                  contract=rec_contract,
                  measured={"small_spine_text_lines": [0, 0, 0, 0, 0],
                            "ocr_text_similarity": [0.96, 0.80, 0.59, 0.81, 0.83],
                            "verdict": "reject as sole residual-text gate; false negatives on 52x236 spines"}),
            entry(migan,
                  id="migan-pipeline-v2-uint8",
                  role="optional inpainting (download on demand)",
                  license="MIT (Picsart AI Research / PAIR; ONNX export andraniksargsyan, mirror CardAnvilModels)",
                  source="https://huggingface.co/CardAnvilModels/MI-GAN-ONNX/resolve/main/migan_pipeline_v2.onnx",
                  quantisation="none (published fp16 model with uint8 I/O; 28.08 MB)",
                  contract=migan_contract,
                  measured={"infer_s": [1.88, 2.33, 1.91, 1.94, 1.86], "wall_s_mean": 2.43,
                            "peak_rss_mb": 500, "spine_psnr_vs_lama_fp32_db": [35.9, 20.4, 22.8, 32.4, 31.8],
                            "spine_ssim_vs_lama_fp32": [0.934, 0.720, 0.869, 0.965, 0.952],
                            "residual_ocr_on_art": [0, 0, 0, 0, 0],
                            "verdict": "recommended optional inpainting"}),
            entry(lama8,
                  id="lama-big-int8-qoperator-conv",
                  role="optional inpainting (evaluated, not recommended)",
                  license="Apache-2.0 (SAIC-MDAL; ONNX port Carve/LaMa-ONNX)",
                  source="converted from v8-app/models/lama_fp32.onnx (Carve/LaMa-ONNX)",
                  quantisation="ONNX Runtime quantize_static QOperator, Conv only, QUInt8 activations, QInt8 per-channel weights",
                  contract=lama_contract,
                  measured={"lama_s": [0.0, 20.1, 19.8, 19.8, 18.0], "peak_rss_mb": 1381,
                            "spine_psnr_vs_fp32_db": [99.0, 17.95, 19.90, 19.68, 99.0],
                            "spine_ssim_vs_fp32": [1.0, 0.716, 0.905, 0.897, 1.0],
                            "verdict": "reject: visible chroma/color artifacts in filled regions"}),
            entry(lama32,
                  id="lama-big-fp32-reference",
                  role="optional inpainting (quality reference, 208 MB)",
                  license="Apache-2.0 (SAIC-MDAL; ONNX port Carve/LaMa-ONNX)",
                  source="https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
                  quantisation="none",
                  contract=lama_contract,
                  measured={"lama_s": [0.0, 23.95, 24.00, 24.26, 24.51], "peak_rss_mb": 1105,
                            "verdict": "quality reference only; too large for optional download unless quality is paramount"}),
        ],
        "bundles": {
            "text-detect-only": {
                "files": [bfile(ROOT / "dist/text-detect-only/det.onnx")],
                "bytes": det.stat().st_size,
                "note": "smallest text gate; app runs detection only on candidate spines (no rec)",
            },
            "text-bundled": {
                "files": [bfile(det), bfile(rec_fp32), bfile(keys)],
                "bytes": det.stat().st_size + rec_fp32.stat().st_size + keys.stat().st_size,
                "note": "works with the existing v8-app Ocr contract; recommended default",
            },
            "text-min": {
                "files": [bfile(ROOT / "dist/text-min/det.onnx"), bfile(rec_int8), bfile(ROOT / "dist/text-min/keys.txt")],
                "bytes": det.stat().st_size + rec_int8.stat().st_size + keys.stat().st_size,
                "note": "smallest det+rec pair; rec fails small-spine text QA; not recommended",
            },
            "inpaint-migan": {
                "files": [bfile(migan)],
                "bytes": migan.stat().st_size,
                "note": "recommended optional download; not bundled in the APK",
            },
            "inpaint-lama-int8": {
                "files": [bfile(lama8)],
                "bytes": lama8.stat().st_size,
                "note": "evaluated alternative; not recommended on quality",
            },
            "inpaint-lama-fp32": {
                "files": [bfile(lama32)],
                "bytes": lama32.stat().st_size,
                "note": "quality reference; optional only",
            },
        },
        "verification": {
            "bundled": "APK signature is the trust anchor; optionally verify SHA-256 at first run.",
            "download": [
                "Fetch over HTTPS from a pinned URL; pin the SHA-256 below, not the URL response.",
                "Write to <filesDir>/models/download/<id>.part; resume with Range if supported.",
                "Stream SHA-256 while writing; on mismatch delete the .part file.",
                "fsync, rename to <filesDir>/models/<id>/<file>; verify size and hash again on first load.",
                "Keep the previous known-good file until the new one verifies; record a version in SharedPreferences/DB.",
                "Gate MI-GAN on >=100 MB free space and Wi-Fi; it is 28.08 MB, not 208 MB.",
            ],
        },
        "licenses": {
            "PP-OCRv3": "Apache-2.0",
            "LaMa big-lama": "Apache-2.0",
            "MI-GAN": "MIT",
            "ONNX Runtime": "MIT",
        },
    }
    (ROOT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("wrote MANIFEST.json")
    for b, v in manifest["bundles"].items():
        print(f"  {b:22} {v['bytes']/1e6:8.2f} MB ({v['bytes']/1048576:7.2f} MiB)")


if __name__ == "__main__":
    main()
