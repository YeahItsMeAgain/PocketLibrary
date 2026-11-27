import { expect, test } from "@playwright/test";

import type { RenderBook } from "../../src/library/spineRenderer";
import {
  artCropRect,
  contrast,
  fallbackCrop,
  readableInk,
  SPINE_STRIP_SIZE,
  spineTypeZones,
  textDirection,
  wrapGeometry,
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

test("wrapGeometry scales the spine with page count", () => {
  const wrap = wrapGeometry(320);
  expect(wrap.height).toBe(236);
  expect(wrap.bleed).toBe(6);
  expect(wrap.spineW).toBe(18);
  expect(wrap.frontW).toBeCloseTo(236 * (6 / 9), 6);
  expect(wrap.totalW).toBe(345);

  expect(wrapGeometry(0).spineW).toBe(10);
  expect(wrapGeometry(2000).spineW).toBe(40);
});

test("the restored prototype bands give the title the run, not a third", () => {
  const zones = spineTypeZones();
  const height = SPINE_STRIP_SIZE.height;
  expect(height).toBe(236);
  // Full-bleed keeps the original 20 px smoked rail, inset 2 px.
  expect(zones.rail.width).toBe(20);
  expect(zones.rail.inset).toBe(2);
  expect(zones.rail.x).toBe(30);
  expect(zones.rail.length).toBe(236 - 27 - 27);
  // The prototype's exact margins and gaps.
  expect(zones.wrap.head).toBe(25);
  expect(zones.wrap.tail).toBe(25);
  expect(zones.wrap.gap).toBe(14);
  expect(zones.fullBleed.head).toBe(27);
  expect(zones.fullBleed.tail).toBe(27);
  expect(zones.fullBleed.gap).toBe(8);
  expect(zones.wrap.titleMaxSize).toBe(7.8);
  expect(zones.fullBleed.titleMaxSize).toBe(9.4);
  // The title run is the whole span above the author, and it is most of the
  // spine rather than a single third.
  expect(zones.wrap.titleSpan).toBe(236 - 50 - 14);
  expect(zones.fullBleed.titleSpan).toBe(236 - 54 - 8);
  expect(zones.wrap.titleSpan).toBeGreaterThan(height / 2);
  expect(zones.fullBleed.titleSpan).toBeGreaterThan(height / 2);
  // The author sits below the title and never reaches the base mark.
  expect(zones.wrap.authorSpan).toBeLessThan(zones.colophonRuleY);
  expect(zones.fullBleed.authorSpan).toBeLessThan(zones.provenanceY);
  expect(zones.colophonRuleY).toBeLessThan(zones.colophonBaseY);
  expect(zones.colophonBaseY).toBeLessThan(height);
});

test("textDirection follows the first strong character", () => {
  expect(textDirection("Rock Paper Scissors")).toBe("ltr");
  expect(textDirection("שלום עולם")).toBe("rtl");
  expect(textDirection("2024 — שלום")).toBe("rtl");
  expect(textDirection("2024")).toBe("ltr");
});
