/**
 * Public API of the canvas spine renderer: the studio preview, the shelf
 * strip, the measured bands and the helpers the tests exercise.
 *
 * This module is deliberately React-free so it can be exercised without a
 * component tree.
 */

import type { SpineStyle } from "../../platform";
import type { RenderBook } from "./geometry";
import {
  paletteFor,
  SPINE_H,
  SPINE_W,
  wrapGeometry,
} from "./geometry";
import { drawArt, spineEdges } from "./draw";
import { drawSpineType, type RenderMeta } from "./text";
import { drawCloth, drawFullBleed, drawWrap } from "./styles";

export {
  artCropRect,
  contrast,
  fallbackCrop,
  readableInk,
  SPINE_RAIL,
  SPINE_STRIP_SIZE,
  SPINE_TYPE_LAYOUT,
  spineTypeBands,
  spineTypeZones,
  wrapGeometry,
} from "./geometry";
export type { Palette, RenderBook, SpineTypeStyle } from "./geometry";
export { textDirection } from "./text";
export type { RenderMeta, SpineBlock } from "./text";

/** Warm the cached palette before the first canvas draw. */
export function prepareSpinePalette(book: RenderBook): void {
  paletteFor(book);
}

/** Draw a full studio preview for the given style. */
export function renderSpineStyle(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  style: SpineStyle,
): RenderMeta {
  switch (style) {
    case "wrap":
      return drawWrap(ctx, book);
    case "full-bleed":
      return drawFullBleed(ctx, book);
    case "cloth":
      return drawCloth(ctx, book);
  }
}

/** The logical canvas size for a studio preview. */
export function spineStyleSize(style: SpineStyle, book: RenderBook) {
  if (style === "wrap") {
    const geometry = wrapGeometry(book.pages || 320);
    return { width: geometry.totalW, height: geometry.height };
  }
  return { width: SPINE_W, height: SPINE_H };
}

/** The shelf strip shows the 52 x 236 spine, cropped from the wrap case. */
export function renderSpineStrip(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  style: SpineStyle,
): RenderMeta {
  if (style !== "wrap") {
    return renderSpineStyle(ctx, book, style);
  }
  // The shelf strip is the wrap's spine at 52 x 236, not a scaled crop of the
  // whole case: the case spine is only ~18 px wide, so cropping it up would
  // magnify the type far past what a shelf shows.
  ctx.direction = book.direction;
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  ctx.fillStyle = "rgba(0,0,0,.16)";
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  return drawSpineType(ctx, book, SPINE_W, 0, "wrap");
}
