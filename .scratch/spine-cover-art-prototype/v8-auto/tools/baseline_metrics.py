#!/usr/bin/env python3
"""Measure the existing manual/LaMa baselines with the same QA functions."""
import json, os, sys
import cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auto_lib as A

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.dirname(ROOT)  # .../spine-cover-art-prototype

BOOKS = {
    "hound": {
        "art": P + "/v6/assets/classics/hound-of-the-baskervilles-art.jpg",
        "spine": P + "/v6/assets/classics/hound-of-the-baskervilles-spine.jpg",
        "mask": None,
        "method": "Manual cover-plate exclusion; public-domain painting used directly.",
    },
    "rps": {
        "art": P + "/v6/assets/modern/rps-lama-art.jpg",
        "spine": P + "/v6/assets/modern/rps-lama-spine.jpg",
        "mask": None,
        "method": "Hand-drawn polygons + LaMa big-lama (v6).",
    },
    "harry-potter": {
        "art": P + "/v7/assets/art/harry-potter.jpg",
        "spine": P + "/v7/assets/spine/harry-potter.jpg",
        "mask": P + "/v7/assets/mask/harry-potter-mask.png",
        "method": "Hand-defined regions + LaMa/TELEA/sampled fill (v7).",
    },
    "hunger-games": {
        "art": P + "/v7/assets/art/the-hunger-games.jpg",
        "spine": P + "/v7/assets/spine/the-hunger-games.jpg",
        "mask": P + "/v7/assets/mask/the-hunger-games-mask.png",
        "method": "Hand-defined regions + LaMa/TELEA/sampled fill (v7).",
    },
}

out = {"generated": "baseline", "books": {}}
for slug, cfg in BOOKS.items():
    art = cv2.imread(cfg["art"])
    spine = cv2.imread(cfg["spine"])
    if art is None or spine is None:
        out["books"][slug] = {"missing": True, "method": cfg["method"]}
        continue
    spine52 = cv2.resize(spine, (A.SPINE_W, A.SPINE_H), interpolation=cv2.INTER_LANCZOS4)
    stats = A.image_stats(spine52)
    hits = A.ocr_texts(art, conf_min=0.5)
    hits = [h for h in hits if len(h["text"].strip()) >= 2]
    mask_cov = None
    if cfg["mask"] and os.path.exists(cfg["mask"]):
        m = cv2.imread(cfg["mask"], 0)
        mask_cov = round(float((m > 0).mean() * 100), 2)
    out["books"][slug] = {
        "method": cfg["method"],
        "manual_intervention": True,
        "art_size": [art.shape[1], art.shape[0]],
        "spine_size": [spine.shape[1], spine.shape[0]],
        "mask_coverage_pct": mask_cov,
        "residual_ocr": hits,
        "residual_ocr_count": len(hits),
        "spine": stats,
    }
with open(os.path.join(ROOT, "baseline.json"), "w") as f:
    json.dump(out, f, indent=2)
print(json.dumps({k: {"ocr": v.get("residual_ocr_count"), "std": v.get("spine", {}).get("luma_std")} for k, v in out["books"].items()}, indent=2))
