/**
 * Geometry, palette and crop math for the canvas spine renderer.
 *
 * Everything here is React-free and does not depend on the drawing modules, so
 * the text and style layers can share one source of truth for the spine size,
 * the measured bands and the art crop.
 */

import type { ReadingStatus, SpineRoute, SpineVerdict } from "../../platform";

export const SPINE_W = 52;
export const SPINE_H = 236;

/** The 52 x 236 shelf strip; every style previews and shelves at this size. */
export const SPINE_STRIP_SIZE = { width: SPINE_W, height: SPINE_H } as const;

/* ------------------------------------------------ S1 smoked-leather marks */

/** The Art foot: the scrim's deepest 30%, holding the author and chips. */
export const ART_FOOT_RATIO = 0.3;
export const ART_FOOT_TOP = SPINE_H * (1 - ART_FOOT_RATIO);

/** The warm near-black scrim, head to tail. No filter, no blend. */
export const ART_SCRIM = {
  head: 0.64,
  mid: 0.72,
  tail: 0.84,
} as const;

/** The title box starts under the status mark that reserves the head. */
export const ART_HEAD_RESERVE = 10;
export const ART_HEAD_RESERVE_FINISHED = 28;

/** Finished: an 8x26 brass ribbon at the head, right 3px, notched tail. */
export const GOLD_RIBBON = {
  width: 8,
  height: 26,
  right: 3,
  stops: [
    [0, "#8a6a2e"],
    [0.14, "#b08d4a"],
    [0.34, "#d2ac62"],
    [0.48, "#f0dcae"],
    [0.64, "#d2ac62"],
    [0.84, "#b08d4a"],
    [1, "#8a6a2e"],
  ] as ReadonlyArray<readonly [number, string]>,
  edge: "#3a280f",
} as const;

/**
 * Reading: the oxblood drape over the lip and board. The canvas is only
 * 52 x 236, so it paints the 4px that overlap the spine and reports the rest
 * of the geometry for the shelf's case-level layer.
 */
export const READING_DRAPE = {
  width: 8,
  spineOverlap: 4,
  overLipAndBoard: 27,
  stops: [
    [0, "#4c0a0f"],
    [0.26, "#8e1b22"],
    [0.48, "#c3353d"],
    [0.74, "#8e1b22"],
    [1, "#4c0a0f"],
  ] as ReadonlyArray<readonly [number, string]>,
} as const;

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
  /** Book identity for the title-hash palette. Optional: the preview can fall
   * back to the title and author when a caller has no catalogue row. */
  contentHash?: string;
  slotIndex?: number;
  format?: "epub" | "pdf";
  /** Labels worn by the book, for the Art foot chips. */
  labels?: ReadonlyArray<{ name: string; colour: string }>;
  /** Reading status: decides the head reserve and which mark is painted. */
  readingStatus?: ReadingStatus;
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
