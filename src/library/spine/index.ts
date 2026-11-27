/**
 * Public API of the canvas spine renderer: the studio preview, the shelf
 * strip, the measured bands and the helpers the tests exercise.
 *
 * This module is deliberately React-free so it can be exercised without a
 * component tree.
 */

import type { SpineStyle } from "../../platform";
import type { RenderBook } from "./geometry";
import { paletteFor, SPINE_H, SPINE_W } from "./geometry";
import { type RenderMeta } from "./text";
import { drawArtSpine, drawCloth, drawTypography } from "./styles";

export {
  artCropRect,
  contrast,
  fallbackCrop,
  mix,
  readableInk,
  SPINE_STRIP_SIZE,
} from "./geometry";
export type { Palette, RenderBook } from "./geometry";
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
    case "art":
      return drawArtSpine(ctx, book);
    case "cloth":
      return drawCloth(ctx, book);
    case "typography":
      return drawTypography(ctx, book);
  }
}

/** The logical canvas size for a studio preview: a 52 x 236 spine. */
export function spineStyleSize(_style: SpineStyle, _book: RenderBook) {
  return { width: SPINE_W, height: SPINE_H };
}

/** The shelf strip is the same 52 x 236 spine the studio previews. */
export function renderSpineStrip(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  style: SpineStyle,
): RenderMeta {
  return renderSpineStyle(ctx, book, style);
}
