#!/usr/bin/env python3
"""Focused 4x spine comparison: LaMa fp32 | MI-GAN | LaMa INT8-conv."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ["rps", "harry-potter", "hunger-games", "whisper-man"]
COLS = [
    ("LaMa fp32 199MB", "eval/lama-fp32-fixed/{b}/spine.jpg"),
    ("MI-GAN 28MB", "eval/migan/{b}/spine.jpg"),
    ("LaMa INT8 62MB", "eval/lama-conv-fixed/{b}/spine.jpg"),
]
S, PAD, LABEL = 4, 12, 24


def main() -> None:
    rows = []
    for b in BOOKS:
        ims = []
        for _, pat in COLS:
            im = Image.open(ROOT / pat.format(b=b)).convert("RGB")
            ims.append(im.resize((im.width * S, im.height * S), Image.NEAREST))
        w = sum(i.width for i in ims) + PAD * (len(ims) + 1)
        h = LABEL + ims[0].height + PAD
        row = Image.new("RGB", (w, h), (24, 18, 14))
        d = ImageDraw.Draw(row)
        d.text((PAD, 5), b, fill=(242, 227, 198))
        x = PAD
        for (name, _), im in zip(COLS, ims):
            row.paste(im, (x, LABEL))
            d.text((x, h - PAD - 2), name, fill=(201, 168, 106))
            x += im.width + PAD
        rows.append(row)
        row.save(ROOT / f"eval/spine-compare-migan-{b}.png")
    w = max(r.width for r in rows)
    sheet = Image.new("RGB", (w, sum(r.height for r in rows)), (24, 18, 14))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(ROOT / "eval/spine-compare-migan.png")
    print(ROOT / "eval/spine-compare-migan.png")


if __name__ == "__main__":
    main()
