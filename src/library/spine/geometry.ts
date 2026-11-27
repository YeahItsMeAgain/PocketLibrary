/**
 * Geometry, palette and crop math for the canvas spine renderer.
 *
 * Everything here is React-free and does not depend on the drawing modules, so
 * the text and style layers can share one source of truth for the spine size,
 * the measured bands and the art crop.
 */

import type { SpineRoute, SpineVerdict } from "../../platform";

export const SPINE_W = 52;
export const SPINE_H = 236;

/** The 52 x 236 shelf strip, independent of the wrap case size. */
export const SPINE_STRIP_SIZE = { width: SPINE_W, height: SPINE_H } as const;

/**
 * The original app-renderer prototype geometry, restored.
 *
 * The title is not confined to a third: it gets the whole run between the head
 * and the author, and shrinks only to fit. The author sits below it and the
 * provenance/colophon mark closes the base. Both Wrap and Full-bleed centre the
 * type on the spine; Full-bleed's old fore-edge rail is retained only as a
 * reference for the rule/provenance positions.
 */
export const SPINE_RAIL = {
  width: 20,
  inset: 2,
  head: 27,
  tail: 27,
  ruleY: 20,
  borderWidth: 0.6,
} as const;

export const SPINE_TYPE_LAYOUT = {
  wrap: {
    head: 25,
    tail: 25,
    /** Extra space between the title run and the author run. */
    gap: 14,
    titleMaxSize: 7.8,
    titleMinSize: 2.6,
    authorMaxSize: 3.6,
    authorMinSize: 2.4,
  },
  fullBleed: {
    head: 27,
    tail: 27,
    gap: 8,
    titleMaxSize: 9.4,
    titleMinSize: 2.8,
    authorMaxSize: 4.2,
    authorMinSize: 2.8,
  },
} as const;

export type SpineTypeStyle = "wrap" | "full-bleed";

/**
 * The smoked type window each style paints before the type. Wrap is a hard
 * inset label (a defined title window over a framed art spine); Full-bleed is a
 * narrower, soft-edged scrim that leaves the art visible edge to edge. Both
 * cover the whole title/author run so the type never sits on raw art.
 */
export function spineScrimRect(style: SpineTypeStyle, width: number) {
  if (style === "wrap") {
    return {
      x: 2,
      y: 10,
      width: Math.max(6, width - 4),
      height: SPINE_H - 20,
    };
  }
  const scrimWidth = Math.max(12, Math.min(width - 8, 34));
  return {
    x: (width - scrimWidth) / 2,
    y: 10,
    width: scrimWidth,
    height: SPINE_H - 20,
  };
}

/**
 * The dynamic title and author bands for one spine. `authorLength` is the
 * measured author run, because the title takes every pixel the author does not
 * need. Callers should use this rather than hard-coded thirds.
 */
export function spineTypeBands(style: SpineTypeStyle, authorLength: number) {
  const spec =
    style === "wrap"
      ? SPINE_TYPE_LAYOUT.wrap
      : SPINE_TYPE_LAYOUT.fullBleed;
  const titleLength = Math.max(
    0,
    SPINE_H - spec.head - spec.tail - authorLength - spec.gap,
  );
  return {
    ...spec,
    titleTop: spec.head,
    titleLength,
    titleBottom: spec.head + titleLength,
    titleCenter: spec.head + titleLength / 2,
    authorBottom: SPINE_H - spec.tail,
    authorTop: SPINE_H - spec.tail - authorLength,
    authorCenter: SPINE_H - spec.tail - authorLength / 2,
  };
}

/**
 * The static prototype table, for tests and callers that need the reserved
 * spans without a book. `titleSpan` is the whole run available before the
 * author is measured.
 */
export function spineTypeZones() {
  const railX = SPINE_W - SPINE_RAIL.width - SPINE_RAIL.inset;
  const wrap = SPINE_TYPE_LAYOUT.wrap;
  const fullBleed = SPINE_TYPE_LAYOUT.fullBleed;
  return {
    height: SPINE_H,
    width: SPINE_W,
    rail: {
      ...SPINE_RAIL,
      x: railX,
      centerX: railX + SPINE_RAIL.width / 2,
      length: SPINE_H - SPINE_RAIL.head - SPINE_RAIL.tail,
    },
    wrap: {
      ...wrap,
      titleSpan: SPINE_H - wrap.head - wrap.tail - wrap.gap,
      authorSpan: SPINE_H - wrap.tail,
    },
    fullBleed: {
      ...fullBleed,
      titleSpan: SPINE_H - fullBleed.head - fullBleed.tail - fullBleed.gap,
      authorSpan: SPINE_H - fullBleed.tail,
    },
    /** The Wrap colophon rule and "PL" line at the base. */
    colophonRuleY: 217,
    colophonBaseY: 227,
    /** The Full-bleed provenance diamond (prototype: SPINE_H - 16). */
    provenanceY: SPINE_H - 16,
  };
}

export interface Palette {
  avg: string;
  light: boolean;
  luma: number;
}

export interface RenderBook {
  title: string;
  author: string;
  pages: number;
  cropBox: [number, number, number, number] | null;
  art: HTMLImageElement;
  source: HTMLImageElement;
  verdict: SpineVerdict;
  route: SpineRoute;
  palette: Palette | null;
  direction: "ltr" | "rtl";
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function hexToRgb(hex: string): [number, number, number] {
  let value = String(hex || "#777").replace("#", "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  const number = parseInt(value, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function rgbToHex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .map((value) =>
        clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"),
      )
      .join("")
  );
}

export function mix(a: string, b: string, t: number): string {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return rgbToHex(left.map((value, index) => value + (right[index] - value) * t));
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  return (
    (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
  );
}

export function readableInk(background: string): string {
  const cream = "#f2e6c9";
  const dark = "#241a12";
  return contrast(background, cream) >= contrast(background, dark)
    ? cream
    : dark;
}

export function paletteFor(book: RenderBook): Palette {
  if (book.palette) return book.palette;
  const fallback: Palette = {
    avg: "#4a4a4a",
    light: false,
    luma: 0.28,
  };
  const img = book.art || book.source;
  if (!img) {
    book.palette = fallback;
    return fallback;
  }
  const out = { ...fallback };
  try {
    const crop = artCropRect(book);
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      book.palette = out;
      return out;
    }
    ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, 32, 48);
    const data = ctx.getImageData(0, 0, 32, 48).data;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    let sumLuma = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
      sumLuma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    const average = rgbToHex([sumR / count, sumG / count, sumB / count]);
    out.avg = average;
    out.luma = sumLuma / count;
    out.light = out.luma > 0.56;
  } catch {
    // A failed sample simply keeps the neutral palette.
  }
  book.palette = out;
  return out;
}

/* ------------------------------------------------------- image geometry */

export function fallbackCrop(
  img: HTMLImageElement,
): [number, number, number, number] {
  const aspect = SPINE_W / SPINE_H;
  const width = img.naturalHeight * aspect;
  if (width > img.naturalWidth) {
    const height = img.naturalWidth / aspect;
    return [0, (img.naturalHeight - height) / 2, img.naturalWidth, height];
  }
  return [(img.naturalWidth - width) / 2, 0, width, img.naturalHeight];
}

/** The pipeline writes `final.crop_box_work` in art.jpg coordinates. */
export function artCropRect(
  book: Pick<RenderBook, "art" | "source" | "cropBox">,
): [number, number, number, number] {
  const img = book.art || book.source;
  if (!img) return [0, 0, 10, 10];
  const box = book.cropBox;
  if (box && box[2] > 4 && box[3] > 4) {
    const x = clamp(box[0], 0, img.naturalWidth - 2);
    const y = clamp(box[1], 0, img.naturalHeight - 2);
    const width = clamp(box[2], 2, img.naturalWidth - x);
    const height = clamp(box[3], 2, img.naturalHeight - y);
    return [x, y, width, height];
  }
  return fallbackCrop(img);
}

/** A wider 2:3 crop of the art, focused on the pipeline crop centre. */
export function panelCrop(book: RenderBook): [number, number, number, number] {
  const img = book.art || book.source;
  if (!img) return [0, 0, 10, 10];
  const [x, y, width, height] = artCropRect(book);
  const focusX = x + width / 2;
  const aspect = 2 / 3;
  let sw = img.naturalHeight * aspect;
  if (sw > img.naturalWidth) sw = img.naturalWidth;
  const sh = sw / aspect;
  const sx = clamp(focusX - sw / 2, 0, img.naturalWidth - sw);
  const sy = clamp(y + height / 2 - sh / 2, 0, img.naturalHeight - sh);
  return [sx, sy, sw, sh];
}

/* ------------------------------------------------------- wrap engine --- */

export function wrapGeometry(pages: number) {
  const caliper = 0.1;
  const coverAllowance = 1.2;
  const spineMm = (Math.max(0, pages) / 2) * caliper + coverAllowance;
  const height = SPINE_H;
  const frontW = height * (6 / 9);
  const spineW = clamp(Math.round(height * (spineMm / 228.6)), 10, 40);
  const bleed = 6;
  return {
    height,
    frontW,
    spineW,
    bleed,
    totalW: Math.round(bleed * 2 + frontW * 2 + spineW),
    spineMm,
  };
}
