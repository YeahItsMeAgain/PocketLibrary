/**
 * The canvas renderer behind the spine studio and the shelf strip. It draws
 * the three spine styles (wrap, full-bleed, cloth) from a prepared book and
 * reports the measurements the UI exposes as data attributes.
 *
 * This module is deliberately React-free so it can be exercised without a
 * component tree. Everything here is a move from `SpineStudio.tsx`.
 */

import type { SpineRoute, SpineStyle, SpineVerdict } from "../platform";

const SERIF = '"Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SPINE_W = 52;
const SPINE_H = 236;

/** The 52 x 236 shelf strip, independent of the wrap case size. */
export const SPINE_STRIP_SIZE = { width: SPINE_W, height: SPINE_H } as const;

/**
 * Where the type sits on a real-book spine. The same bands are used by Wrap
 * and Full-bleed, so switching styles moves the background only.
 *
 * The title run is centred in the upper third, the author run in the lower
 * third, and a publisher mark closes the base. The middle third is left to the
 * art, which is what makes a shelf read as books rather than posters.
 */
export const SPINE_TYPE_LAYOUT = {
  titleTop: 16,
  titleBottom: 78,
  authorTop: 158,
  authorBottom: 210,
  colophonRuleY: 217,
  colophonBaseY: 227,
} as const;

/** The measured bands, for tests and callers that do not want to guess. */
export function spineTypeZones() {
  const {
    titleTop,
    titleBottom,
    authorTop,
    authorBottom,
    colophonRuleY,
    colophonBaseY,
  } = SPINE_TYPE_LAYOUT;
  return {
    height: SPINE_H,
    titleTop,
    titleBottom,
    titleCenter: (titleTop + titleBottom) / 2,
    authorTop,
    authorBottom,
    authorCenter: (authorTop + authorBottom) / 2,
    colophonRuleY,
    colophonBaseY,
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

const RTL_PATTERN =
  /[\u0590-\u05ff\u0600-\u06ff\u0700-\u074f\u0750-\u077f\u0780-\u07bf\ufb1d-\ufdff\ufe70-\ufeff]/;
const LTR_PATTERN = /[A-Za-z\u00c0-\u024f\u0400-\u052f]/;

/** The direction of the first strong character, as the browser would guess. */
export function textDirection(text: string): "ltr" | "rtl" {
  for (const char of text) {
    if (RTL_PATTERN.test(char)) return "rtl";
    if (LTR_PATTERN.test(char)) return "ltr";
  }
  return "ltr";
}

const clamp = (value: number, min: number, max: number) =>
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

function mix(a: string, b: string, t: number): string {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return rgbToHex(left.map((value, index) => value + (right[index] - value) * t));
}

function luminance(hex: string): number {
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

const CREAM_INK = "#f2e6c9";
const DARK_INK = "#1a130d";
const CREAM_LUMA = luminance(CREAM_INK);
const DARK_LUMA = luminance(DARK_INK);
const MIN_CONTRAST = 4.5;

interface RegionStats {
  min: number;
  max: number;
  avg: number;
}

function contrastLuma(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function samplePixels(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): RegionStats {
  const fallback: RegionStats = { min: 0.2, max: 0.2, avg: 0.2 };
  try {
    const canvas = ctx.canvas;
    const sx = clamp(Math.floor(x), 0, Math.max(0, canvas.width - 1));
    const sy = clamp(Math.floor(y), 0, Math.max(0, canvas.height - 1));
    const sw = clamp(Math.ceil(width), 1, canvas.width - sx);
    const sh = clamp(Math.ceil(height), 1, canvas.height - sy);
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let min = 1;
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const channel = (value: number) =>
        value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      const luma = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      min = Math.min(min, luma);
      max = Math.max(max, luma);
      sum += luma;
      count += 1;
    }
    if (count === 0) return fallback;
    return { min, max, avg: sum / count };
  } catch {
    return fallback;
  }
}

/** Sample the art as it will appear in a `destW` x `destH` panel. */
function sampleArtRegion(
  book: RenderBook,
  destW: number,
  destH: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): RegionStats {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(destW));
  canvas.height = Math.max(1, Math.round(destH));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { min: 0.2, max: 0.2, avg: 0.2 };
  drawArt(ctx, book, 0, 0, canvas.width, canvas.height);
  return samplePixels(
    ctx,
    rx * (canvas.width / destW),
    ry * (canvas.height / destH),
    rw * (canvas.width / destW),
    rh * (canvas.height / destH),
  );
}

/**
 * Choose ink that clears 4.5:1 against every sampled pixel. When no single ink
 * can (the War of the Worlds bright-sky case), lay a soft gradient scrim sized
 * to the type block and use cream on top.
 */
function guardInk(
  ctx: CanvasRenderingContext2D,
  stats: RegionStats,
  scrim: { x: number; y: number; width: number; height: number },
): { ink: string; contrast: number; usedScrim: boolean } {
  const creamWorst = Math.min(
    contrastLuma(CREAM_LUMA, stats.max),
    contrastLuma(CREAM_LUMA, stats.min),
  );
  const darkWorst = Math.min(
    contrastLuma(DARK_LUMA, stats.max),
    contrastLuma(DARK_LUMA, stats.min),
  );
  const useCream = creamWorst >= darkWorst;
  const best = Math.max(creamWorst, darkWorst);
  if (best >= MIN_CONTRAST) {
    return {
      ink: useCream ? CREAM_INK : DARK_INK,
      contrast: best,
      usedScrim: false,
    };
  }
  // A scrim standardises the backdrop. Dark scrim under cream ink is the
  // house look; a light scrim only happens when the type sits on dark art.
  const darkScrim = stats.avg < 0.5;
  const solid = darkScrim ? "rgba(8,6,4,0.82)" : "rgba(244,236,218,0.88)";
  const clear = darkScrim ? "rgba(8,6,4,0)" : "rgba(244,236,218,0)";
  const gradient = ctx.createLinearGradient(
    scrim.x,
    scrim.y,
    scrim.x,
    scrim.y + scrim.height,
  );
  // Feather only just past the type: the bands above and below are sized so
  // the title, author and colophon all sit on the solid part of the scrim.
  gradient.addColorStop(0, clear);
  gradient.addColorStop(0.08, solid);
  gradient.addColorStop(0.92, solid);
  gradient.addColorStop(1, clear);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(scrim.x, scrim.y, scrim.width, scrim.height);
  ctx.restore();
  const ink = darkScrim ? CREAM_INK : DARK_INK;
  const inkLuma = darkScrim ? CREAM_LUMA : DARK_LUMA;
  const scrimLuma = darkScrim
    ? luminance("#080604")
    : luminance("#f4ecda");
  return {
    ink,
    contrast: contrastLuma(inkLuma, scrimLuma),
    usedScrim: true,
  };
}

function paletteFor(book: RenderBook): Palette {
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

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  source: [number, number, number, number],
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mirror = false,
) {
  const [sx, sy, sw, sh] = source;
  const sourceAspect = sw / sh;
  const targetAspect = dw / dh;
  let cw: number;
  let ch: number;
  let cx: number;
  let cy: number;
  if (sourceAspect > targetAspect) {
    ch = sh;
    cw = sh * targetAspect;
    cx = sx + (sw - cw) / 2;
    cy = sy;
  } else {
    cw = sw;
    ch = sw / targetAspect;
    cx = sx;
    cy = sy + (sh - ch) / 2;
  }
  ctx.save();
  if (mirror) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, dw, dh);
  } else {
    ctx.drawImage(img, cx, cy, cw, ch, dx, dy, dw, dh);
  }
  ctx.restore();
}

function drawArt(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mirror = false,
) {
  const img = book.art || book.source;
  if (!img) {
    ctx.fillStyle = paletteFor(book).avg;
    ctx.fillRect(dx, dy, dw, dh);
    return;
  }
  drawCover(ctx, img, artCropRect(book), dx, dy, dw, dh, mirror);
}

/** A wider 2:3 crop of the art, focused on the pipeline crop centre. */
function panelCrop(book: RenderBook): [number, number, number, number] {
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

/* ------------------------------------------- canvas + measured type --- */

interface TextMetrics {
  adv: number;
  ink: number;
}

/** One measured run of spine type. `height` runs down the spine. */
export interface SpineBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  fs: number;
  lines: number;
}

/** What a renderer reports for the canvas data attributes and the tests. */
export interface RenderMeta {
  direction: "ltr" | "rtl";
  scrim: boolean;
  contrast: number;
  /** The union of the title and author runs. */
  block: { x: number; y: number; width: number; height: number };
  /** The title run in the upper third. */
  title: SpineBlock;
  /** The author run in the lower third, or null when the book has no author. */
  author: SpineBlock | null;
  /** The rule and initials at the base. */
  colophon: { x: number; y: number; width: number; height: number };
  /** True when the title and author run down the spine. */
  vertical: boolean;
}

let measureContext: CanvasRenderingContext2D | null = null;

function metrics(
  text: string,
  family: string,
  weight: number,
  track: number,
): TextMetrics {
  if (!measureContext) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) {
    const length = Math.max(1, String(text).length);
    return { adv: length * 0.5 + track * length, ink: 0.8 };
  }
  measureContext.font = `${weight || 400} 100px ${family}`;
  const measured = measureContext.measureText(text);
  const ascent =
    typeof measured.actualBoundingBoxAscent === "number"
      ? measured.actualBoundingBoxAscent
      : 72;
  const descent =
    typeof measured.actualBoundingBoxDescent === "number"
      ? measured.actualBoundingBoxDescent
      : 20;
  const chars = Math.max(1, String(text).length);
  return {
    adv: measured.width / 100 + track * chars,
    ink: (ascent + descent) / 100,
  };
}

function bestSplit(text: string): { lines: [string, string]; score: number } | null {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let best: { lines: [string, string]; score: number } | null = null;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const a = metrics(first, SERIF, 400, 0);
    const b = metrics(second, SERIF, 400, 0);
    const score = Math.max(a.adv, b.adv) + Math.abs(a.adv - b.adv) * 0.15;
    if (!best || score < best.score) best = { lines: [first, second], score };
  }
  return best;
}

interface VerticalFit {
  fs: number;
  lines: string[];
  stacked: boolean;
  limiting: number;
  /** The longest line, measured down the spine. */
  length: number;
  /** The run's thickness across the spine. */
  thickness: number;
}

function fitVertical(
  text: string,
  options: {
    family: string;
    weight: number;
    track: number;
    thick: number;
    length: number;
    maxSize: number;
    minSize: number;
    stack?: boolean;
  },
): VerticalFit {
  const one = metrics(text, options.family, options.weight, options.track);
  const byThickness = (options.thick * 0.965) / Math.max(0.05, one.ink);
  const byLength = (options.length * 0.968) / Math.max(0.05, one.adv);
  let fs = Math.min(options.maxSize, byThickness, byLength);
  let lines = [text];
  let stacked = false;
  if (fs < Math.max(6.2, options.minSize + 2) && options.stack !== false) {
    const split = bestSplit(text);
    if (split) {
      const measured = split.lines.map((line) =>
        metrics(line, options.family, options.weight, options.track),
      );
      const adv = Math.max(...measured.map((entry) => entry.adv));
      const ink = Math.max(...measured.map((entry) => entry.ink));
      const next = Math.min(
        options.maxSize,
        (options.thick * 0.965) / (2 * 1.08 * ink),
        (options.length * 0.968) / adv,
      );
      if (next > fs * 1.06) {
        fs = next;
        lines = split.lines;
        stacked = true;
      }
    }
  }
  fs = Math.max(options.minSize, Math.floor(fs * 40) / 40);
  const measured = lines.map((line) =>
    metrics(line, options.family, options.weight, options.track),
  );
  const adv = Math.max(...measured.map((entry) => entry.adv)) * fs;
  const thickNeed =
    (stacked ? 2 * 1.08 : 1) *
    Math.max(...measured.map((entry) => entry.ink)) *
    fs;
  return {
    fs,
    lines,
    stacked,
    limiting: Math.max(adv / options.length, thickNeed / options.thick),
    length: adv,
    thickness: thickNeed,
  };
}

function setTracking(ctx: CanvasRenderingContext2D, value: string) {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in spaced) spaced.letterSpacing = value;
}

function drawVertical(
  ctx: CanvasRenderingContext2D,
  fit: VerticalFit,
  cx: number,
  cy: number,
  color: string,
  options: {
    family: string;
    weight: number;
    track: number;
    lineGap?: number;
  },
) {
  const lineGap = options.lineGap ?? 1.08;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${options.weight} ${fit.fs}px ${options.family}`;
  setTracking(ctx, `${(options.track * fit.fs).toFixed(2)}px`);
  const lineHeight = fit.fs * lineGap;
  fit.lines.forEach((line, index) =>
    ctx.fillText(
      line,
      0,
      (index - (fit.lines.length - 1) / 2) * lineHeight,
    ),
  );
  ctx.restore();
}

/**
 * Draw a fitted run down the spine, first character at the top.
 *
 * LTR rotates +90 degrees (the `vertical-rl` turn): right becomes down, so the
 * logical first glyph stays at the head. RTL rotates -90 degrees with a right
 * anchor, which maps the right-to-left run onto the same top-to-bottom flow
 * without reversing the glyphs. Both keep the run centred on the spine's
 * width; `centerY` centres the measured run in its band.
 */
function drawVerticalRun(
  ctx: CanvasRenderingContext2D,
  fit: VerticalFit,
  cx: number,
  centerY: number,
  color: string,
  options: {
    family: string;
    weight: number;
    track: number;
    direction: "ltr" | "rtl";
    lineGap?: number;
  },
) {
  const lineGap = options.lineGap ?? 1.08;
  const rtl = options.direction === "rtl";
  const spacing = fit.fs * lineGap;
  ctx.save();
  ctx.direction = options.direction;
  ctx.fillStyle = color;
  ctx.font = `${options.weight} ${fit.fs}px ${options.family}`;
  setTracking(ctx, `${(options.track * fit.fs).toFixed(2)}px`);
  ctx.textAlign = rtl ? "right" : "left";
  ctx.textBaseline = "middle";
  fit.lines.forEach((line, index) => {
    const length =
      metrics(line, options.family, options.weight, options.track).adv *
      fit.fs;
    // vertical-rl stacks lines right-to-left, so the first line is the right
    // column for both LTR and RTL. Direction changes the inline run, not the
    // column order.
    const offset = (index - (fit.lines.length - 1) / 2) * spacing;
    ctx.save();
    ctx.translate(cx - offset, centerY - length / 2);
    ctx.rotate(rtl ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

interface HorizontalFit {
  fs: number;
  lines: string[];
  family: string;
  weight: number;
  track: number;
}

function fitHorizontal(
  text: string,
  options: {
    width: number;
    maxSize: number;
    minSize: number;
    maxLines?: number;
    family: string;
    weight: number;
    track?: number;
    /** Split to two lines when the one-line fit lands below this size. */
    splitBelow?: number;
  },
): HorizontalFit {
  const track = options.track ?? 0.01;
  const one = metrics(text, options.family, options.weight, track);
  let fs = Math.min(
    options.maxSize,
    (options.width * 0.96) / Math.max(0.05, one.adv),
  );
  let lines = [text];
  if (fs < (options.splitBelow ?? 13) && (options.maxLines ?? 2) > 1) {
    const split = bestSplit(text);
    if (split) {
      const measured = split.lines.map((line) =>
        metrics(line, options.family, options.weight, track),
      );
      const adv = Math.max(...measured.map((entry) => entry.adv));
      const next = Math.min(options.maxSize, (options.width * 0.96) / adv);
      if (next > fs * 1.05) {
        fs = next;
        lines = split.lines;
      }
    }
  }
  fs = Math.max(options.minSize, Math.floor(fs * 20) / 20);
  return {
    fs,
    lines,
    family: options.family,
    weight: options.weight,
    track,
  };
}

function drawHorizontal(
  ctx: CanvasRenderingContext2D,
  fit: HorizontalFit,
  x: number,
  y: number,
  color: string,
  options: { align?: CanvasTextAlign; gap?: number } = {},
) {
  const gap = options.gap ?? 1.05;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "top";
  ctx.font = `${fit.weight} ${fit.fs}px ${fit.family}`;
  setTracking(ctx, `${((fit.track || 0) * fit.fs).toFixed(2)}px`);
  fit.lines.forEach((line, index) =>
    ctx.fillText(line, x, y + index * fit.fs * gap),
  );
  ctx.restore();
}

/* ------------------------------------------------ common furniture ---- */

function spineEdges(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const horizontal = ctx.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, "rgba(0,0,0,.45)");
  horizontal.addColorStop(0.05, "rgba(0,0,0,0)");
  horizontal.addColorStop(0.95, "rgba(0,0,0,0)");
  horizontal.addColorStop(1, "rgba(0,0,0,.45)");
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, width, height);
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(0,0,0,.32)");
  vertical.addColorStop(0.09, "rgba(0,0,0,0)");
  vertical.addColorStop(0.9, "rgba(0,0,0,0)");
  vertical.addColorStop(1, "rgba(0,0,0,.30)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);
}

function grain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  amount: number,
) {
  ctx.save();
  ctx.globalAlpha = amount;
  const dots = Math.round((width * height) / 16);
  for (let index = 0; index < dots; index += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function provenance(book: RenderBook): "original" | "reconstructed" | "fallback" {
  if (book.verdict === "fallback") return "fallback";
  if (book.route === "inpaint") return "reconstructed";
  return "original";
}

function drawProvenance(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: "original" | "reconstructed" | "fallback",
) {
  const radius = 2.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(radius, 0);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius, 0);
  ctx.closePath();
  if (kind === "original") {
    ctx.fillStyle = "rgba(240,226,196,.92)";
    ctx.fill();
  } else if (kind === "reconstructed") {
    ctx.fillStyle = "rgba(240,226,196,.35)";
    ctx.fill();
    ctx.strokeStyle = "rgba(240,226,196,.95)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(240,226,196,.85)";
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }
  ctx.restore();
}

function vignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(0,0,0,.18)");
  gradient.addColorStop(0.2, "rgba(0,0,0,0)");
  gradient.addColorStop(0.82, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,.22)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/* ------------------------------------------------ real-book type block -- */

interface SpineTypeLayout {
  title: VerticalFit;
  author: VerticalFit | null;
  titleCenter: number;
  authorCenter: number;
  titleBlock: SpineBlock;
  authorBlock: SpineBlock | null;
  block: { x: number; y: number; width: number; height: number };
  /** Local scrim bands, leaving the middle third to the art. */
  titleBand: { x: number; y: number; width: number; height: number };
  authorBand: { x: number; y: number; width: number; height: number };
}

function layoutSpineType(
  book: RenderBook,
  width: number,
): SpineTypeLayout {
  const zones = spineTypeZones();
  const inner = Math.max(6, width - 8);
  const title = fitVertical(String(book.title || "Untitled"), {
    family: SERIF,
    weight: 600,
    track: 0.012,
    thick: inner,
    length: zones.titleBottom - zones.titleTop,
    maxSize: 12.5,
    minSize: 1.8,
  });
  const authorText = String(book.author || "").trim();
  // Keep the hierarchy: on a narrow Wrap spine a long title can shrink below
  // the author's cap, and the author must not come out larger than the title.
  const authorMax = Math.min(5.6, Math.max(2.6, title.fs));
  const author = authorText
    ? fitVertical(authorText, {
        family: SANS,
        weight: 500,
        track: 0.07,
        thick: inner,
        length: zones.authorBottom - zones.authorTop,
        maxSize: authorMax,
        minSize: 1.8,
        stack: false,
      })
    : null;
  const cx = width / 2;
  const titleBlock: SpineBlock = {
    x: cx,
    y: zones.titleCenter,
    width: title.thickness,
    height: title.length,
    fs: title.fs,
    lines: title.lines.length,
  };
  const authorBlock: SpineBlock | null = author
    ? {
        x: cx,
        y: zones.authorCenter,
        width: author.thickness,
        height: author.length,
        fs: author.fs,
        lines: author.lines.length,
      }
    : null;
  const top = titleBlock.y - titleBlock.height / 2;
  const bottom = authorBlock
    ? authorBlock.y + authorBlock.height / 2
    : titleBlock.y + titleBlock.height / 2;
  return {
    title,
    author,
    titleCenter: zones.titleCenter,
    authorCenter: zones.authorCenter,
    titleBlock,
    authorBlock,
    block: {
      x: cx,
      y: (top + bottom) / 2,
      width: Math.max(titleBlock.width, authorBlock?.width ?? 0),
      height: bottom - top,
    },
    titleBand: {
      x: 0,
      y: Math.max(0, zones.titleTop - 10),
      width,
      height: zones.titleBottom + 10 - Math.max(0, zones.titleTop - 10),
    },
    authorBand: {
      x: 0,
      y: Math.max(0, zones.authorTop - 10),
      width,
      height:
        zones.colophonBaseY + 8 - Math.max(0, zones.authorTop - 10),
    },
  };
}

function drawColophon(
  ctx: CanvasRenderingContext2D,
  width: number,
  ink: string,
  direction: "ltr" | "rtl",
) {
  const zones = spineTypeZones();
  const cx = width / 2;
  const ruleWidth = Math.min(24, Math.max(5, width - 14));
  ctx.save();
  ctx.direction = direction;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - ruleWidth / 2, zones.colophonRuleY);
  ctx.lineTo(cx + ruleWidth / 2, zones.colophonRuleY);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(cx, zones.colophonRuleY + 3.4);
  ctx.lineTo(cx + 1.8, zones.colophonRuleY + 5.2);
  ctx.lineTo(cx, zones.colophonRuleY + 7);
  ctx.lineTo(cx - 1.8, zones.colophonRuleY + 5.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 3.4px ${SANS}`;
  setTracking(ctx, "0.16em");
  ctx.fillText("PL", cx, zones.colophonBaseY);
  ctx.restore();
}

/**
 * Draw the real-book type for Wrap and Full-bleed. The art and its crop are
 * untouched; only the measured ink and the scrim behind it are added.
 */
function drawSpineType(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  width: number,
  offsetX: number,
): RenderMeta {
  const layout = layoutSpineType(book, width);
  type Band = { x: number; y: number; width: number; height: number };
  const sample = (band: Band) =>
    sampleArtRegion(
      book,
      width,
      SPINE_H,
      band.x,
      band.y,
      band.width,
      band.height,
    );
  const scrim = (band: Band) => ({
    x: offsetX + band.x,
    y: band.y,
    width: band.width,
    height: band.height,
  });
  // Two guards keep the middle third of the art visible: one band carries the
  // title, the other the author and the publisher mark.
  const titleGuard = guardInk(
    ctx,
    sample(layout.titleBand),
    scrim(layout.titleBand),
  );
  drawVerticalRun(
    ctx,
    layout.title,
    layout.block.x + offsetX,
    layout.titleCenter,
    titleGuard.ink,
    {
      family: SERIF,
      weight: 600,
      track: 0.012,
      direction: book.direction,
    },
  );
  const authorGuard = guardInk(
    ctx,
    sample(layout.authorBand),
    scrim(layout.authorBand),
  );
  if (layout.author && layout.authorBlock) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    drawVerticalRun(
      ctx,
      layout.author,
      layout.authorBlock.x + offsetX,
      layout.authorCenter,
      authorGuard.ink,
      {
        family: SANS,
        weight: 500,
        track: 0.07,
        direction: book.direction,
      },
    );
    ctx.restore();
  }
  ctx.save();
  ctx.translate(offsetX, 0);
  drawColophon(ctx, width, authorGuard.ink, book.direction);
  ctx.restore();
  const zones = spineTypeZones();
  return {
    direction: book.direction,
    scrim: titleGuard.usedScrim || authorGuard.usedScrim,
    contrast: Math.min(titleGuard.contrast, authorGuard.contrast),
    block: layout.block,
    title: layout.titleBlock,
    author: layout.authorBlock,
    colophon: {
      x: width / 2,
      y: zones.colophonRuleY,
      width: Math.min(24, Math.max(5, width - 14)),
      height: zones.colophonBaseY - zones.colophonRuleY + 4,
    },
    vertical: true,
  };
}

/* ----------------------------------------------------- spine renderers */

function drawFullBleed(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  vignette(ctx, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  ctx.direction = book.direction;
  const meta = drawSpineType(ctx, book, SPINE_W, 0);
  grain(ctx, SPINE_W, SPINE_H, 0.03);
  return meta;
}

function drawCloth(ctx: CanvasRenderingContext2D, book: RenderBook): RenderMeta {
  const palette = paletteFor(book);
  let cloth = palette.light
    ? mix(palette.avg, "#1c1611", 0.68)
    : mix(palette.avg, "#0d0b09", 0.58);
  if (luminance(cloth) > 0.24) cloth = mix(cloth, "#0b0907", 0.35);
  const foil = readableInk(cloth) === "#f2e6c9" ? "#e8d3a1" : "#2b2018";
  ctx.direction = book.direction;

  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);
  ctx.save();
  ctx.globalAlpha = 0.09;
  for (let x = 0; x < SPINE_W; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? "#fff" : "#000";
    ctx.fillRect(x, 0, 0.5, SPINE_H);
  }
  ctx.restore();
  const look = {
    x: SPINE_W / 2,
    thick: SPINE_W - 10,
    head: 34,
    tail: 20,
    ornY: 15,
    ornSize: 10,
  };
  ctx.fillStyle = "rgba(0,0,0,.28)";
  ctx.fillRect(0, 27, SPINE_W, 0.8);
  ctx.fillRect(0, SPINE_H - 27, SPINE_W, 0.8);
  ctx.fillStyle = foil;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(9, 12, SPINE_W - 18, 0.7);
  ctx.fillRect(9, SPINE_H - 12, SPINE_W - 18, 0.7);
  ctx.globalAlpha = 1;

  const authorFit = fitVertical(book.author || "", {
    family: SERIF,
    weight: 400,
    track: 0.02,
    thick: look.thick,
    length: SPINE_H * 0.3,
    maxSize: 4.6,
    minSize: 2.8,
    stack: false,
  });
  const authorLength =
    Math.max(
      ...authorFit.lines.map(
        (line) => metrics(line, SERIF, 400, 0.02).adv,
      ),
    ) * authorFit.fs;
  const titleArea = SPINE_H - look.head - look.tail - authorLength - 7;
  const title = fitVertical(String(book.title || ""), {
    family: SERIF,
    weight: 400,
    track: 0.01,
    thick: look.thick,
    length: titleArea,
    maxSize: 11.2,
    minSize: 2.8,
  });
  drawVertical(ctx, title, look.x, look.head + titleArea / 2, foil, {
    family: SERIF,
    weight: 400,
    track: 0.01,
  });
  drawVertical(
    ctx,
    authorFit,
    look.x,
    SPINE_H - look.tail - authorLength / 2,
    foil,
    {
      family: SERIF,
      weight: 400,
      track: 0.02,
      lineGap: 1.1,
    },
  );
  ctx.save();
  ctx.translate(look.x, look.ornY);
  ctx.strokeStyle = foil;
  ctx.fillStyle = foil;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, -look.ornSize / 2);
  ctx.lineTo(look.ornSize / 2, 0);
  ctx.lineTo(0, look.ornSize / 2);
  ctx.lineTo(-look.ornSize / 2, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, look.ornSize * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawProvenance(ctx, look.x, SPINE_H - 9, provenance(book));
  grain(ctx, SPINE_W, SPINE_H, 0.07);
  return {
    direction: book.direction,
    scrim: false,
    contrast: contrast(foil, cloth),
    block: {
      x: look.x,
      y: SPINE_H / 2,
      width: look.thick,
      height: SPINE_H - look.head - look.tail,
    },
    title: {
      x: look.x,
      y: look.head + titleArea / 2,
      width: title.thickness,
      height: title.length,
      fs: title.fs,
      lines: title.lines.length,
    },
    author: {
      x: look.x,
      y: SPINE_H - look.tail - authorLength / 2,
      width: authorFit.thickness,
      height: authorLength,
      fs: authorFit.fs,
      lines: authorFit.lines.length,
    },
    colophon: {
      x: look.x,
      y: SPINE_H - 9,
      width: 4.4,
      height: 4.4,
    },
    vertical: true,
  };
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

function drawWrap(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  const geometry = wrapGeometry(book.pages || 320);
  const palette = paletteFor(book);
  const frontX = geometry.bleed + geometry.frontW + geometry.spineW;
  const spineX = geometry.bleed + geometry.frontW;
  const panel = panelCrop(book);
  ctx.direction = book.direction;

  ctx.fillStyle = mix(palette.avg, "#0b0908", 0.55);
  ctx.fillRect(0, 0, geometry.totalW, geometry.height);

  const art = book.art || book.source;
  const tiny = document.createElement("canvas");
  tiny.width = 24;
  tiny.height = 34;
  const tinyCtx = tiny.getContext("2d");
  if (tinyCtx) {
    tinyCtx.drawImage(
      art,
      panel[0],
      panel[1],
      panel[2],
      panel[3],
      0,
      0,
      24,
      34,
    );
  }
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.drawImage(tiny, geometry.bleed, 0, geometry.frontW, geometry.height);
  ctx.restore();
  ctx.fillStyle = "rgba(10,8,7,.55)";
  ctx.fillRect(geometry.bleed, 0, geometry.frontW, geometry.height);

  drawArt(
    ctx,
    book,
    spineX,
    0,
    geometry.spineW,
    geometry.height,
  );
  ctx.fillStyle = "rgba(0,0,0,.16)";
  ctx.fillRect(spineX, 0, geometry.spineW, geometry.height);
  spineEdges(ctx, geometry.totalW, geometry.height);

  const source = book.source || art;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.drawImage(tiny, frontX, 0, geometry.frontW, geometry.height);
  ctx.restore();
  ctx.fillStyle = "rgba(10,8,7,.42)";
  ctx.fillRect(frontX, 0, geometry.frontW, geometry.height);
  const sourceAspect = source.naturalWidth / source.naturalHeight;
  const targetAspect = geometry.frontW / geometry.height;
  let dw: number;
  let dh: number;
  if (sourceAspect > targetAspect) {
    dw = geometry.frontW;
    dh = geometry.frontW / sourceAspect;
  } else {
    dh = geometry.height;
    dw = geometry.height * sourceAspect;
  }
  const dx = frontX + (geometry.frontW - dw) / 2;
  const dy = (geometry.height - dh) / 2;
  ctx.drawImage(
    source,
    0,
    0,
    source.naturalWidth,
    source.naturalHeight,
    dx,
    dy,
    dw,
    dh,
  );
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 0.6;
  ctx.strokeRect(dx + 0.3, dy + 0.3, dw - 0.6, dh - 0.6);
  ctx.fillStyle = "rgba(8,7,6,.55)";
  ctx.fillRect(
    frontX + geometry.frontW - 45,
    geometry.height - 13,
    39,
    10,
  );
  ctx.fillStyle = "rgba(244,234,210,.72)";
  ctx.font = `500 4.4px ${SANS}`;
  setTracking(ctx, "0.12em");
  ctx.textAlign = "right";
  ctx.fillText(
    "POCKET / WRAP",
    frontX + geometry.frontW - 8,
    geometry.height - 5.6,
  );
  ctx.textAlign = "left";

  // Wrap and Full-bleed share one type layout; only the art treatment around
  // it differs. The ink is chosen from the pixels under the type, not the
  // whole art average, and the scrim stays inside the spine.
  const typeMeta = drawSpineType(ctx, book, geometry.spineW, spineX);

  const cardX = geometry.bleed + geometry.frontW * 0.12;
  const cardY = geometry.height * 0.13;
  const cardW = geometry.frontW * 0.76;
  const cardH = geometry.height * 0.74;
  ctx.fillStyle = "rgba(236,226,202,.94)";
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeStyle = "rgba(40,30,20,.22)";
  ctx.lineWidth = 0.6;
  ctx.strokeRect(cardX + 0.3, cardY + 0.3, cardW - 0.6, cardH - 0.6);
  const backTitle = fitHorizontal(book.title || "", {
    width: cardW - 16,
    maxSize: 12,
    minSize: 6,
    maxLines: 2,
    family: SERIF,
    weight: 400,
  });
  const backTextX = book.direction === "rtl" ? cardX + cardW - 8 : cardX + 8;
  drawHorizontal(ctx, backTitle, backTextX, cardY + 10, "#2c2118", {
    gap: 1,
    align: book.direction === "rtl" ? "right" : "left",
  });
  ctx.font = `500 5.4px ${SANS}`;
  setTracking(ctx, "0.10em");
  ctx.textAlign = book.direction === "rtl" ? "right" : "left";
  ctx.fillStyle = "#6a5b45";
  ctx.fillText(
    String(book.author || "").toUpperCase(),
    backTextX,
    cardY + 14 + backTitle.lines.length * backTitle.fs,
  );
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(44,33,24,.30)";
  ctx.fillRect(
    cardX + 8,
    cardY + 30 + backTitle.lines.length * backTitle.fs,
    cardW - 16,
    0.6,
  );
  ctx.font = `400 4.4px ${SERIF}`;
  setTracking(ctx, "0px");
  ctx.fillStyle = "#4d4132";
  const lines = [
    "A PocketLibrary study compositing",
    "the textless art into a single",
    "continuous case. Back cover and",
    "copy are generated for the study,",
    "not publisher artwork.",
    "",
    "Spine width is derived from the",
    "page count and a paper caliper.",
  ];
  lines.forEach((line, index) =>
    ctx.fillText(
      line,
      cardX + 8,
      cardY + 40 + backTitle.lines.length * backTitle.fs + index * 6.2,
    ),
  );
  const bx = cardX + cardW - 30;
  const by = cardY + cardH - 22;
  let seed = 7;
  for (let index = 0; index < 22; index += 1) {
    seed = (seed * 9301 + 49297) % 233280;
    ctx.fillStyle = index % 2 ? "#f3ead4" : "#221a12";
    ctx.fillRect(bx + index * 1.05, by, index % 2 ? 0.5 : 0.75, 15);
  }
  ctx.fillStyle = "#5f513d";
  ctx.font = `400 3.4px ${SANS}`;
  ctx.textAlign = "center";
  ctx.fillText("978-0-00-000000-0", bx + 11.5, by + 18.5);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(spineX - 0.4, 0, 0.8, geometry.height);
  ctx.fillRect(frontX - 0.4, 0, 0.8, geometry.height);
  return {
    ...typeMeta,
    // The reported block is local to the spine; keep the case offset out of
    // the geometry so Wrap and Full-bleed are directly comparable.
    block: typeMeta.block,
    title: typeMeta.title,
    author: typeMeta.author,
    colophon: typeMeta.colophon,
  };
}

/* ------------------------------------------------------- dispatchers --- */

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
  return drawSpineType(ctx, book, SPINE_W, 0);
}
