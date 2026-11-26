#!/usr/bin/env python3
"""Build 4x spine comparison sheets: fp32 | INT8 dynamic | INT8 static."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ["hound", "rps", "harry-potter", "hunger-games", "whisper-man"]
VARIANTS = ["fp32", "dynamic", "static", "conv"]
S = 4
PAD = 12
LABEL = 22


def panel(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    return im.resize((im.width * S, im.height * S), Image.NEAREST)


def main() -> None:
    rows = []
    for book in BOOKS:
        ims = [panel(ROOT / f"eval/lama-{v}-fixed/{book}/spine.jpg") for v in VARIANTS]
        w = sum(i.width for i in ims) + PAD * (len(ims) + 1)
        h = LABEL + ims[0].height + PAD
        row = Image.new("RGB", (w, h), (24, 18, 14))
        d = ImageDraw.Draw(row)
        d.text((PAD, 5), book, fill=(242, 227, 198))
        x = PAD
        for name, im in zip(VARIANTS, ims):
            row.paste(im, (x, LABEL))
            d.text((x, h - PAD - 2), name, fill=(201, 168, 106))
            x += im.width + PAD
        rows.append(row)
        row.save(ROOT / f"eval/spine-compare-{book}.png")

    w = max(r.width for r in rows)
    h = sum(r.height for r in rows)
    sheet = Image.new("RGB", (w, h), (24, 18, 14))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(ROOT / "eval/spine-compare.png")
    print(ROOT / "eval/spine-compare.png")


if __name__ == "__main__":
    main()
