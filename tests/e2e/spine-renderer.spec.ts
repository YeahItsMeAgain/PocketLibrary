import { expect, test } from "@playwright/test";

import type { RenderBook } from "../../src/library/spineRenderer";
import {
  ART_FOOT_TOP,
  ART_HEAD_RESERVE,
  ART_HEAD_RESERVE_FINISHED,
  ART_SCRIM,
  artCropRect,
  contrast,
  fallbackCrop,
  GOLD_RIBBON,
  READING_DRAPE,
  readableInk,
  SPINE_H,
  textDirection,
} from "../../src/library/spineRenderer";
import { spineLabelAbbr } from "../../src/library/spine";

/** The helpers only read naturalWidth/naturalHeight, so a plain object stands
 * in for a decoded image without a browser. */
function image(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

function book(
  art: HTMLImageElement,
  cropBox: [number, number, number, number] | null,
): Pick<RenderBook, "art" | "source" | "cropBox"> {
  return { art, source: art, cropBox };
}

test("artCropRect keeps a valid pipeline box and clamps it to the art", () => {
  const img = image(1000, 1200);
  expect(artCropRect(book(img, [10, 20, 300, 400]))).toEqual([
    10, 20, 300, 400,
  ]);
  expect(artCropRect(book(img, [-5, -5, 2000, 2000]))).toEqual([
    0, 0, 1000, 1200,
  ]);
});

test("artCropRect falls back to a centred 52:236 crop", () => {
  const img = image(1000, 1200);
  const [x, y, width, height] = artCropRect(book(img, null));
  expect(y).toBe(0);
  expect(height).toBe(1200);
  expect(width).toBeCloseTo(1200 * (52 / 236), 6);
  expect(x).toBeCloseTo((1000 - width) / 2, 6);
});

test("fallbackCrop centres a tall image inside the spine aspect", () => {
  const [x, y, width, height] = fallbackCrop(image(100, 1000));
  expect(x).toBe(0);
  expect(width).toBe(100);
  expect(height).toBeCloseTo(100 / (52 / 236), 6);
  expect(y).toBeCloseTo((1000 - height) / 2, 6);
});

test("contrast and readableInk pick the legible ink", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#777777", "#777777")).toBe(1);
  expect(readableInk("#ffffff")).toBe("#241a12");
  expect(readableInk("#000000")).toBe("#f2e6c9");
});

test("textDirection follows the first strong character", () => {
  expect(textDirection("Rock Paper Scissors")).toBe("ltr");
  expect(textDirection("שלום עולם")).toBe("rtl");
  expect(textDirection("2024 — שלום")).toBe("rtl");
  expect(textDirection("2024")).toBe("ltr");
});

test("S1 smoked leather uses the lab's scrim, foot and head geometry", () => {
  expect(SPINE_H).toBe(236);
  expect(ART_FOOT_TOP).toBeCloseTo(236 * 0.7, 5);
  expect(ART_SCRIM).toEqual({ head: 0.64, mid: 0.72, tail: 0.84 });
  expect(ART_HEAD_RESERVE).toBe(10);
  expect(ART_HEAD_RESERVE_FINISHED).toBe(28);
});

test("the finished ribbon is 8x26 at right 3 with a notched tail", () => {
  expect(GOLD_RIBBON.width).toBe(8);
  expect(GOLD_RIBBON.height).toBe(26);
  expect(GOLD_RIBBON.right).toBe(3);
  expect(GOLD_RIBBON.stops[0]).toEqual([0, "#8a6a2e"]);
  expect(GOLD_RIBBON.stops[1]).toEqual([0.14, "#b08d4a"]);
  expect(GOLD_RIBBON.stops[3]).toEqual([0.48, "#f0dcae"]);
  expect(GOLD_RIBBON.stops[GOLD_RIBBON.stops.length - 1]).toEqual([
    1,
    "#8a6a2e",
  ]);
  // Brass, not cream: the brightest stop is still under the cream title.
  expect(GOLD_RIBBON.edge).toBe("#3a280f");
});

test("the reading drape is 8px wide and hangs over the lip and board", () => {
  expect(READING_DRAPE.width).toBe(8);
  expect(READING_DRAPE.spineOverlap).toBe(4);
  expect(READING_DRAPE.overLipAndBoard).toBe(27);
});

test("label chips are 4-5 letter codes", () => {
  expect(spineLabelAbbr("Crime")).toBe("CRIME");
  expect(spineLabelAbbr("Gothic")).toBe("GOTH");
  expect(spineLabelAbbr("Sci-Fi")).toBe("SCIF");
  expect(spineLabelAbbr("Favourite")).toBe("FAVO");
  expect(spineLabelAbbr("Book club")).toBe("BOOK");
  expect(spineLabelAbbr("Vintage")).toBe("VINT");
  for (const name of ["Crime", "Gothic", "Favourite", "Book club", "Vintage"]) {
    expect(spineLabelAbbr(name).length).toBeGreaterThanOrEqual(4);
    expect(spineLabelAbbr(name).length).toBeLessThanOrEqual(5);
  }
});
