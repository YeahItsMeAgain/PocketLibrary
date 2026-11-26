#!/usr/bin/env python3
"""Build the JSON payload the Android RendererActivity hands to the WebView.

Used by the host-side WebView proof. The APK's Java code builds the same shape
at runtime from the device's run directory; this script lets us exercise the
identical assets in Chromium without an adb device.
"""
import base64
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "v8-output")
DEST = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opencode/payloads"


def jpeg_size(path):
    with open(path, "rb") as f:
        data = f.read()
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + length
    raise ValueError("no SOF in " + path)


def data_uri(path):
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")


def main():
    os.makedirs(DEST, exist_ok=True)
    for slug in sorted(os.listdir(OUT)):
        run_dir = os.path.join(OUT, slug)
        rp = os.path.join(run_dir, "run.json")
        if not os.path.exists(rp):
            continue
        with open(rp) as f:
            run = json.load(f)
        with open(os.path.join(run_dir, "qa.json")) as f:
            qa = json.load(f)
        chosen = qa.get("qa", {}).get("chosen") or {}
        spine_qa = chosen.get("spine") or {}
        art = os.path.join(run_dir, "art.jpg")
        source = os.path.join(run_dir, "source.jpg")
        aw, ah = jpeg_size(art)
        sw, sh = jpeg_size(source)
        payload = {
            "slug": run.get("slug", slug),
            "title": run["book"]["title"],
            "author": run["book"]["author"],
            "pages": run["book"]["pages"],
            "source": data_uri(source),
            "sourceNote": "on-device curated or downloaded cover",
            "art": data_uri(art),
            "artWidth": aw,
            "artHeight": ah,
            "spine": data_uri(os.path.join(run_dir, "spine-2x.jpg")),
            "fallback": data_uri(os.path.join(run_dir, "fallback-spine.jpg")),
            "route": run.get("route"),
            "verdict": run.get("verdict"),
            "reasons": run.get("decision_reasons") or [],
            "maskCoverage": run.get("mask", {}).get("coverage_pct"),
            "detectionBoxes": run.get("mask", {}).get("detection_boxes"),
            "cropBox": run.get("final", {}).get("crop_box_work"),
            "spineLumaStd": spine_qa.get("luma_std"),
            "spineEdge": spine_qa.get("edge_density"),
            "spineOcr": chosen.get("spine_residual_ocr") or [],
            "sourceWidth": sw,
            "sourceHeight": sh,
            "execution": "on-device arm64 Java + Rust/ONNX v8-app pipeline",
            "provenance": "v8-android native run; WebView receives this run directory only",
            "license": "Design reference only; cover is not redistributed outside the test APK",
            "note": "Rendered on the phone from the native pipeline's art.jpg, spine crop and run.json.",
        }
        with open(os.path.join(DEST, slug + ".json"), "w") as f:
            json.dump(payload, f)
        print(slug, os.path.getsize(os.path.join(DEST, slug + ".json")), "bytes")


if __name__ == "__main__":
    main()
