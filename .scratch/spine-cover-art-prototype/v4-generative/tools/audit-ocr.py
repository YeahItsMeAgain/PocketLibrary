#!/usr/bin/env python3
"""Residual-text audit for the v4 generative results.

Runs RapidOCR over each generative image and writes the recognised text boxes
to generative/ocr-audit.json. This is the same detector family used by v3; it
proves the text is no longer machine-readable, not that the art is original.
Run with the v3 venv:
  /tmp/opencode/v3venv/bin/python .scratch/spine-cover-art-prototype/v4-generative/tools/audit-ocr.py
"""
import json
import os
import time

from rapidocr_onnxruntime import RapidOCR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = {
    "rps-a-kontext": "generative/rps-a-kontext.jpg",
    "whisper-a-kontext": "generative/whisper-a-kontext.jpg",
    "rps-c-promptonly": "generative/rps-c-promptonly.jpg",
    "whisper-c-promptonly": "generative/whisper-c-promptonly.jpg",
}

engine = RapidOCR()
report = {}
for slug, rel in IMAGES.items():
    path = os.path.join(ROOT, rel)
    t0 = time.time()
    result, _ = engine(path)
    items = []
    for box, text, conf in (result or []):
        items.append({"text": text, "conf": round(float(conf), 3), "box": box})
    report[slug] = {
        "file": rel,
        "seconds": round(time.time() - t0, 2),
        "items": items,
    }
    print(slug, "->", [i["text"] for i in items])

with open(os.path.join(ROOT, "generative", "ocr-audit.json"), "w") as fh:
    json.dump(report, fh, indent=2)
