#!/usr/bin/env python3
"""Run fp32 / INT8-dynamic / INT8-static / Conv-only INT8 LaMa on the same crop."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V8 = ROOT.parent / "v8-app" / "out"
PY = sys.executable
EXE = ROOT / "target" / "release" / "lama_eval"
BOOKS = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
VARIANTS = {
    "fp32": ROOT / "models/fp32/lama_fp32.onnx",
    "dynamic": ROOT / "models/lama-int8-dynamic/lama.onnx",
    "static": ROOT / "models/lama-int8-qoperator/lama.onnx",
    "conv": ROOT / "models/lama-int8-qoperator-conv/lama.onnx",
}


def run(book: str, variant: str, model: Path, crop: str | None, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    cmd = [
        PY, str(ROOT / "scripts/run_measure.py"),
        "--out", str(ROOT / f"logs/lama-{variant}-fixed-{book}.json"),
        "--", str(EXE),
        "--source", str(V8 / book / "source.jpg"),
        "--mask", str(V8 / book / "mask.png"),
        "--lama", str(model),
        "--out", str(out),
    ]
    if crop:
        cmd += ["--crop-box", crop]
    subprocess.run(cmd, check=True)


def main() -> None:
    # First pass: fp32 chooses a crop box per book. Every variant is then
    # scored on that exact 52x236 region.
    boxes = {}
    for book in BOOKS:
        base = ROOT / f"eval/lama-fp32/{book}"
        if not (base / "run.json").exists():
            run(book, "fp32", VARIANTS["fp32"], None, base)
        boxes[book] = json.loads((base / "run.json").read_text())["crop_box"]

    for variant, model in VARIANTS.items():
        if not model.exists():
            print(f"skip {variant}: {model} missing")
            continue
        for book in BOOKS:
            run(book, variant, model, ",".join(map(str, boxes[book])),
                ROOT / f"eval/lama-{variant}-fixed/{book}")


if __name__ == "__main__":
    main()
