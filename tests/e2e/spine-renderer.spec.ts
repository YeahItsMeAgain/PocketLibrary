import { expect, test } from "@playwright/test";

import type { RenderBook } from "../../src/library/spineRenderer";
import {
  artCropRect,
  contrast,
  fallbackCrop,
  readableInk,
  textDirection,
} from "../../src/library/spineRenderer";

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
