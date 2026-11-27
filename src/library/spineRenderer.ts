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
  gradient.addColorStop(0, clear);
  gradient.addColorStop(0.22, solid);
  gradient.addColorStop(0.78, solid);
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

/** What a renderer reports for the canvas data attributes and the tests. */
export interface RenderMeta {
  direction: "ltr" | "rtl";
  scrim: boolean;
  contrast: number;
  block: { x: number; y: number; width: number; height: number };
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

/* ----------------------------------------------------- spine renderers */

function drawFullBleed(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  vignette(ctx, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  ctx.direction = book.direction;

  const maxWidth = SPINE_W - 10;
  const title = fitHorizontal(String(book.title || "Untitled"), {
    width: maxWidth,
    maxSize: 10.5,
    minSize: 3.2,
    maxLines: 2,
    splitBelow: 9.6,
    family: SERIF,
    weight: 600,
    track: 0.01,
  });
  const author = fitHorizontal(book.author || "", {
    width: maxWidth,
    maxSize: 4.8,
    minSize: 2.4,
    maxLines: 1,
    family: SANS,
    weight: 500,
    track: 0.08,
  });
  const titleLineHeight = title.fs * 1.12;
  const titleHeight = title.lines.length * titleLineHeight;
  const authorHeight = book.author ? author.fs + 3.2 : 0;
  const blockHeight = titleHeight + authorHeight;
  const blockTop = (SPINE_H - blockHeight) / 2;
  const widest = Math.max(
    ...title.lines.map(
      (line) => metrics(line, SERIF, 600, 0.01).adv * title.fs,
    ),
    book.author
      ? metrics(book.author, SANS, 500, 0.08).adv * author.fs
      : 0,
  );
  const scrim = {
    x: (SPINE_W - widest) / 2 - 5,
    y: blockTop - 6,
    width: widest + 10,
    height: blockHeight + 12,
  };
  const stats = sampleArtRegion(
    book,
    SPINE_W,
    SPINE_H,
    Math.max(0, scrim.x),
    Math.max(0, scrim.y),
    Math.min(SPINE_W, scrim.width),
    Math.min(SPINE_H, scrim.height),
  );
  const guard = guardInk(ctx, stats, scrim);

  ctx.save();
  ctx.direction = book.direction;
  ctx.fillStyle = guard.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${title.fs}px ${SERIF}`;
  setTracking(ctx, `${(0.01 * title.fs).toFixed(2)}px`);
  title.lines.forEach((line, index) =>
    ctx.fillText(
      line,
      SPINE_W / 2,
      blockTop + index * titleLineHeight,
    ),
  );
  if (book.author) {
    ctx.globalAlpha = 0.9;
    ctx.font = `500 ${author.fs}px ${SANS}`;
    setTracking(ctx, `${(0.08 * author.fs).toFixed(2)}px`);
    ctx.fillText(
      author.lines[0],
      SPINE_W / 2,
      blockTop + titleHeight + 3.2,
    );
  }
  ctx.restore();
  grain(ctx, SPINE_W, SPINE_H, 0.03);
  return {
    direction: book.direction,
    scrim: guard.usedScrim,
    contrast: guard.contrast,
    block: {
      x: SPINE_W / 2,
      y: blockTop + blockHeight / 2,
      width: widest,
      height: blockHeight,
    },
  };
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

  const authorFit = fitVertical(book.author || "", {
    family: SANS,
    weight: 500,
    track: 0.12,
    thick: geometry.spineW - 3,
    length: 48,
    maxSize: 3.6,
    minSize: 2.4,
    stack: false,
  });
  const authorLength =
    Math.max(
      ...authorFit.lines.map((line) => metrics(line, SANS, 500, 0.12).adv),
    ) * authorFit.fs;
  const titleArea = geometry.height - 50 - authorLength - 14;
  const title = fitVertical(String(book.title || "").toUpperCase(), {
    family: SANS,
    weight: 600,
    track: 0.05,
    thick: geometry.spineW - 3,
    length: titleArea,
    maxSize: 7.8,
    minSize: 2.6,
  });
  // The rail ink is chosen from the pixels under the type, not the whole art
  // average. If no ink clears 4.5:1, a soft scrim sits behind the type only;
  // the wrap's geometry is untouched.
  const titleStats = sampleArtRegion(
    book,
    geometry.spineW,
    geometry.height,
    0,
    20,
    geometry.spineW,
    Math.max(12, titleArea + 10),
  );
  const titleGuard = guardInk(ctx, titleStats, {
    x: spineX,
    y: 18,
    width: geometry.spineW,
    height: Math.max(14, titleArea + 14),
  });
  const spineInk = titleGuard.ink;
  drawVertical(
    ctx,
    title,
    spineX + geometry.spineW / 2,
    25 + titleArea / 2,
    spineInk,
    { family: SANS, weight: 600, track: 0.05 },
  );
  drawVertical(
    ctx,
    authorFit,
    spineX + geometry.spineW / 2,
    geometry.height - 25 - authorLength / 2,
    spineInk,
    { family: SANS, weight: 500, track: 0.12 },
  );

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
    direction: book.direction,
    scrim: titleGuard.usedScrim,
    contrast: titleGuard.contrast,
    block: {
      x: spineX + geometry.spineW / 2,
      y: 25 + titleArea / 2,
      width: geometry.spineW,
      height: titleArea,
    },
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
  const authorFit = fitVertical(book.author || "", {
    family: SANS,
    weight: 500,
    track: 0.12,
    thick: SPINE_W - 3,
    length: 48,
    maxSize: 3.6,
    minSize: 2.4,
    stack: false,
  });
  const authorLength =
    Math.max(
      ...authorFit.lines.map((line) => metrics(line, SANS, 500, 0.12).adv),
    ) * authorFit.fs;
  const titleArea = SPINE_H - 50 - authorLength - 14;
  const title = fitVertical(String(book.title || "").toUpperCase(), {
    family: SANS,
    weight: 600,
    track: 0.05,
    thick: SPINE_W - 3,
    length: titleArea,
    maxSize: 7.8,
    minSize: 2.6,
  });
  const stats = sampleArtRegion(
    book,
    SPINE_W,
    SPINE_H,
    0,
    18,
    SPINE_W,
    Math.max(14, titleArea + 14),
  );
  const guard = guardInk(ctx, stats, {
    x: 0,
    y: 18,
    width: SPINE_W,
    height: Math.max(14, titleArea + 14),
  });
  drawVertical(ctx, title, SPINE_W / 2, 25 + titleArea / 2, guard.ink, {
    family: SANS,
    weight: 600,
    track: 0.05,
  });
  drawVertical(
    ctx,
    authorFit,
    SPINE_W / 2,
    SPINE_H - 25 - authorLength / 2,
    guard.ink,
    { family: SANS, weight: 500, track: 0.12 },
  );
  return {
    direction: book.direction,
    scrim: guard.usedScrim,
    contrast: guard.contrast,
    block: {
      x: SPINE_W / 2,
      y: 25 + titleArea / 2,
      width: SPINE_W,
      height: titleArea,
    },
  };
}
