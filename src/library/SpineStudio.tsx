import { useCallback, useEffect, useRef, useState } from "react";

import {
  isApiError,
  platform,
  type SpineArtifact,
  type SpineRoute,
  type SpineStatus,
  type SpineVerdict,
} from "../platform";

/* --------------------------------------------------------------- styles */

export type SpineStyle =
  | "wrap"
  | "hybrid"
  | "fullbleed"
  | "artonly"
  | "cloth"
  | "editorial";

export const SPINE_STYLES: ReadonlyArray<{
  id: SpineStyle;
  label: string;
  note: string;
}> = [
  {
    id: "wrap",
    label: "Wrap",
    note: "Page-count spine width. Back and spine are composed from the text-free art.",
  },
  {
    id: "hybrid",
    label: "Hybrid",
    note: "An art window beside a measured paper label.",
  },
  {
    id: "fullbleed",
    label: "Full-bleed",
    note: "The crop edge to edge with a smoked title rail.",
  },
  {
    id: "artonly",
    label: "Textless",
    note: "The crop with no typography at all.",
  },
  {
    id: "cloth",
    label: "Cloth",
    note: "Cloth colour sampled from the art, foil type, no art window.",
  },
  {
    id: "editorial",
    label: "Editorial",
    note: "Full-bleed art and a narrow type rail in one sans voice.",
  },
];

/* ------------------------------------------------ renderer (ported) ---- */

const SERIF = '"Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SPINE_W = 52;
const SPINE_H = 236;

interface Palette {
  avg: string;
  dominant: string;
  edge: string;
  light: boolean;
  luma: number;
}

interface RenderBook {
  title: string;
  author: string;
  pages: number;
  cropBox: [number, number, number, number] | null;
  art: HTMLImageElement;
  source: HTMLImageElement;
  verdict: SpineVerdict;
  route: SpineRoute;
  palette: Palette | null;
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

function contrast(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  return (
    (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
  );
}

function readableInk(background: string): string {
  const cream = "#f2e6c9";
  const dark = "#241a12";
  return contrast(background, cream) >= contrast(background, dark)
    ? cream
    : dark;
}

function paletteFor(book: RenderBook): Palette {
  if (book.palette) return book.palette;
  const fallback: Palette = {
    avg: "#4a4a4a",
    dominant: "#3b3b3b",
    edge: "#303030",
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
    const buckets = new Map<
      number,
      { n: number; r: number; g: number; b: number }
    >();
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
      sumLuma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
    const average = rgbToHex([sumR / count, sumG / count, sumB / count]);
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.n > best.n) best = bucket;
    }
    const dominant = best
      ? rgbToHex([best.r / best.n, best.g / best.n, best.b / best.n])
      : average;
    const edgeCanvas = document.createElement("canvas");
    edgeCanvas.width = 8;
    edgeCanvas.height = 32;
    const edgeCtx = edgeCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (edgeCtx) {
      edgeCtx.drawImage(
        img,
        crop[0],
        crop[1],
        Math.max(2, crop[2] * 0.1),
        crop[3],
        0,
        0,
        8,
        32,
      );
      const edgeData = edgeCtx.getImageData(0, 0, 8, 32).data;
      let er = 0;
      let eg = 0;
      let eb = 0;
      let en = 0;
      for (let index = 0; index < edgeData.length; index += 4) {
        er += edgeData[index];
        eg += edgeData[index + 1];
        eb += edgeData[index + 2];
        en += 1;
      }
      out.edge = rgbToHex([er / en, eg / en, eb / en]);
    }
    out.avg = average;
    out.dominant = dominant;
    out.luma = sumLuma / count;
    out.light = out.luma > 0.56;
  } catch {
    // A failed sample simply keeps the neutral palette.
  }
  book.palette = out;
  return out;
}

/* ------------------------------------------------------- image geometry */

function fallbackCrop(
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
function artCropRect(
  book: RenderBook,
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
  },
): HorizontalFit {
  const track = options.track ?? 0.01;
  const one = metrics(text, options.family, options.weight, track);
  let fs = Math.min(
    options.maxSize,
    (options.width * 0.96) / Math.max(0.05, one.adv),
  );
  let lines = [text];
  if (fs < 13 && (options.maxLines ?? 2) > 1) {
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

function drawFullBleed(ctx: CanvasRenderingContext2D, book: RenderBook) {
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  vignette(ctx, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  const palette = paletteFor(book);
  const railW = 20;
  const railX = SPINE_W - railW - 2;
  ctx.fillStyle = mix("#0c0d10", palette.avg, 0.1);
  ctx.globalAlpha = 0.88;
  ctx.fillRect(railX, 27, railW, SPINE_H - 54);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(240,226,196,.24)";
  ctx.lineWidth = 0.6;
  ctx.strokeRect(railX + 0.3, 27.3, railW - 0.6, SPINE_H - 54.6);
  const ink = "#f2e8d4";
  const authorFit = fitVertical(book.author || "", {
    family: SANS,
    weight: 500,
    track: 0.1,
    thick: railW - 4,
    length: 48,
    maxSize: 4.2,
    minSize: 2.8,
    stack: false,
  });
  const authorLength =
    Math.max(
      ...authorFit.lines.map((line) => metrics(line, SANS, 500, 0.1).adv),
    ) * authorFit.fs;
  const titleArea = SPINE_H - 54 - authorLength - 8;
  const title = fitVertical(String(book.title || "").toUpperCase(), {
    family: SANS,
    weight: 600,
    track: 0.06,
    thick: railW - 3.4,
    length: titleArea,
    maxSize: 9.4,
    minSize: 2.8,
  });
  drawVertical(ctx, title, railX + railW / 2, 27 + titleArea / 2, ink, {
    family: SANS,
    weight: 600,
    track: 0.06,
  });
  drawVertical(
    ctx,
    authorFit,
    railX + railW / 2,
    SPINE_H - 27 - authorLength / 2,
    "rgba(242,232,212,.86)",
    { family: SANS, weight: 500, track: 0.1 },
  );
  ctx.fillStyle = "rgba(242,232,212,.55)";
  ctx.fillRect(railX + 4, 20, railW - 8, 0.7);
  drawProvenance(ctx, railX + railW / 2, SPINE_H - 16, provenance(book));
  grain(ctx, SPINE_W, SPINE_H, 0.035);
}

function drawArtOnly(ctx: CanvasRenderingContext2D, book: RenderBook) {
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  vignette(ctx, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  grain(ctx, SPINE_W, SPINE_H, 0.03);
}

function drawDesign(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  kind: "hybrid" | "cloth" | "editorial",
) {
  const palette = paletteFor(book);
  let cloth = palette.light
    ? mix(palette.avg, "#1c1611", 0.68)
    : mix(palette.avg, "#0d0b09", 0.58);
  if (luminance(cloth) > 0.24) cloth = mix(cloth, "#0b0907", 0.35);
  const paper = mix("#ece2ca", cloth, 0.055);
  const foil = readableInk(cloth) === "#f2e6c9" ? "#e8d3a1" : "#2b2018";
  let ink: string;
  let look: {
    x: number;
    thick: number;
    head: number;
    tail: number;
    ornY: number;
    ornSize: number;
    serif: boolean;
  };

  if (kind === "editorial") {
    drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
    vignette(ctx, SPINE_W, SPINE_H);
    spineEdges(ctx, SPINE_W, SPINE_H);
    const railW = 23.1;
    const railX = SPINE_W - railW;
    ctx.fillStyle = "rgba(9,10,12,.80)";
    ctx.fillRect(railX, 0, railW, SPINE_H);
    ctx.fillStyle = "rgba(242,232,212,.22)";
    ctx.fillRect(railX, 0, 0.6, SPINE_H);
    ink = "#f2e8d4";
    look = {
      x: railX + railW / 2,
      thick: railW - 4,
      head: 18,
      tail: 20,
      ornY: 11,
      ornSize: 7,
      serif: false,
    };
  } else if (kind === "cloth") {
    ctx.fillStyle = cloth;
    ctx.fillRect(0, 0, SPINE_W, SPINE_H);
    ctx.save();
    ctx.globalAlpha = 0.09;
    for (let x = 0; x < SPINE_W; x += 2) {
      ctx.fillStyle = x % 4 === 0 ? "#fff" : "#000";
      ctx.fillRect(x, 0, 0.5, SPINE_H);
    }
    ctx.restore();
    ink = foil;
    look = {
      x: SPINE_W / 2,
      thick: SPINE_W - 10,
      head: 34,
      tail: 20,
      ornY: 15,
      ornSize: 10,
      serif: true,
    };
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(0, 27, SPINE_W, 0.8);
    ctx.fillRect(0, SPINE_H - 27, SPINE_W, 0.8);
    ctx.fillStyle = foil;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(9, 12, SPINE_W - 18, 0.7);
    ctx.fillRect(9, SPINE_H - 12, SPINE_W - 18, 0.7);
    ctx.globalAlpha = 1;
  } else {
    const paperW = SPINE_W * 0.565;
    const artW = SPINE_W - paperW;
    drawArt(ctx, book, 0, 0, artW, SPINE_H);
    spineEdges(ctx, SPINE_W, SPINE_H);
    ctx.fillStyle = paper;
    ctx.fillRect(artW, 0, paperW, SPINE_H);
    ctx.fillStyle = "rgba(40,30,20,.30)";
    ctx.fillRect(artW, 0, 0.8, SPINE_H);
    ctx.fillStyle = "rgba(40,30,20,.12)";
    ctx.fillRect(artW + 3, 0, 0.6, SPINE_H);
    ink = "#2c2118";
    look = {
      x: artW + paperW / 2,
      thick: paperW - 7,
      head: 24,
      tail: 18,
      ornY: 12,
      ornSize: 7,
      serif: true,
    };
  }

  const authorFamily = look.serif ? SERIF : SANS;
  const titleFamily = look.serif ? SERIF : SANS;
  const authorFit = fitVertical(book.author || "", {
    family: authorFamily,
    weight: look.serif ? 400 : 500,
    track: look.serif ? 0.02 : 0.1,
    thick: look.thick,
    length: SPINE_H * 0.3,
    maxSize: 4.6,
    minSize: 2.8,
    stack: false,
  });
  const authorLength =
    Math.max(
      ...authorFit.lines.map(
        (line) =>
          metrics(
            line,
            authorFamily,
            look.serif ? 400 : 500,
            look.serif ? 0.02 : 0.1,
          ).adv,
      ),
    ) * authorFit.fs;
  const titleArea = SPINE_H - look.head - look.tail - authorLength - 7;
  const title = fitVertical(String(book.title || ""), {
    family: titleFamily,
    weight: look.serif ? 400 : 700,
    track: look.serif ? 0.01 : 0.07,
    thick: look.thick,
    length: titleArea,
    maxSize: look.serif ? 11.2 : 9.2,
    minSize: 2.8,
  });
  drawVertical(ctx, title, look.x, look.head + titleArea / 2, ink, {
    family: titleFamily,
    weight: look.serif ? 400 : 700,
    track: look.serif ? 0.01 : 0.07,
  });
  drawVertical(
    ctx,
    authorFit,
    look.x,
    SPINE_H - look.tail - authorLength / 2,
    ink,
    {
      family: authorFamily,
      weight: look.serif ? 400 : 500,
      track: look.serif ? 0.02 : 0.1,
      lineGap: 1.1,
    },
  );
  ctx.save();
  ctx.translate(look.x, look.ornY);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 0.9;
  if (kind === "editorial") {
    ctx.fillRect(-3.2, -0.35, 6.4, 0.7);
  } else {
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
  }
  ctx.restore();
  drawProvenance(ctx, look.x, SPINE_H - 9, provenance(book));
  grain(ctx, SPINE_W, SPINE_H, kind === "cloth" ? 0.07 : 0.025);
}

/* ------------------------------------------------------- wrap engine --- */

function wrapGeometry(pages: number) {
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

function drawWrap(ctx: CanvasRenderingContext2D, book: RenderBook) {
  const geometry = wrapGeometry(book.pages || 320);
  const palette = paletteFor(book);
  const frontX = geometry.bleed + geometry.frontW + geometry.spineW;
  const spineX = geometry.bleed + geometry.frontW;
  const panel = panelCrop(book);

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

  const spineInk = readableInk(palette.avg);
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
  drawHorizontal(ctx, backTitle, cardX + 8, cardY + 10, "#2c2118", {
    gap: 1,
  });
  ctx.font = `500 5.4px ${SANS}`;
  setTracking(ctx, "0.10em");
  ctx.fillStyle = "#6a5b45";
  ctx.fillText(
    String(book.author || "").toUpperCase(),
    cardX + 8,
    cardY + 14 + backTitle.lines.length * backTitle.fs,
  );
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
}

/* ------------------------------------------------------- dispatchers --- */

function drawStyle(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  style: SpineStyle,
) {
  switch (style) {
    case "wrap":
      drawWrap(ctx, book);
      break;
    case "fullbleed":
      drawFullBleed(ctx, book);
      break;
    case "artonly":
      drawArtOnly(ctx, book);
      break;
    case "hybrid":
    case "cloth":
    case "editorial":
      drawDesign(ctx, book, style);
      break;
  }
}

function styleSize(style: SpineStyle, book: RenderBook) {
  if (style === "wrap") {
    const geometry = wrapGeometry(book.pages || 320);
    return { width: geometry.totalW, height: geometry.height };
  }
  return { width: SPINE_W, height: SPINE_H };
}

/** The shelf strip shows the 52 x 236 spine, cropped from the wrap case. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  style: SpineStyle,
) {
  if (style !== "wrap") {
    drawStyle(ctx, book, style);
    return;
  }
  // The shelf strip is the wrap's spine at 52 x 236, not a scaled crop of the
  // whole case: the case spine is only ~18 px wide, so cropping it up would
  // magnify the type far past what a shelf shows.
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  ctx.fillStyle = "rgba(0,0,0,.16)";
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  const ink = readableInk(paletteFor(book).avg);
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
  drawVertical(ctx, title, SPINE_W / 2, 25 + titleArea / 2, ink, {
    family: SANS,
    weight: 600,
    track: 0.05,
  });
  drawVertical(
    ctx,
    authorFit,
    SPINE_W / 2,
    SPINE_H - 25 - authorLength / 2,
    ink,
    { family: SANS, weight: 500, track: 0.12 },
  );
}

/* --------------------------------------------------------- small views */

function SpineCanvas({
  book,
  style,
  strip = false,
  testId,
}: {
  book: RenderBook;
  style: SpineStyle;
  strip?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = strip
      ? { width: SPINE_W, height: SPINE_H }
      : styleSize(style, book);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, size.width, size.height);
    if (strip) drawStrip(ctx, book, style);
    else drawStyle(ctx, book, style);
  }, [book, style, strip]);
  return <canvas ref={ref} data-testid={testId} />;
}

/* ------------------------------------------------------------ studio -- */

interface StudioProps {
  bookId: number;
  title: string;
  author: string;
  pages: number | null;
  /** The published cover, used for the wrap front; art alone if absent. */
  coverDataUrl?: string | null;
}

type StudioState =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "result"; artifact: SpineArtifact }
  | { kind: "error"; heading: string; message: string };

const VERDICT_LABELS: Record<SpineVerdict, string> = {
  pass: "Pass",
  review: "Review",
  fallback: "Fallback",
};

function engineLabel(status: SpineStatus): string {
  switch (status.models) {
    case "ready":
      return "Engine ready";
    case "bundled":
      return "Engine bundled";
    case "missing":
      return "Models missing";
    case "error":
      return "Engine error";
  }
}

function describeError(error: unknown): { heading: string; message: string } {
  if (isApiError(error)) {
    switch (error.code) {
      case "spine_models_missing":
      case "engine_models_missing":
      case "models_missing":
        return {
          heading: "Spine engine not installed",
          message:
            "The 41.2 MB model bundle is required for art spines. Install it from Settings → Spine, then try again. The cloth spine is unchanged.",
        };
      case "book_not_found":
        return {
          heading: "Book not available",
          message:
            "This book is no longer in the library, so there is nothing to work from.",
        };
      case "cover_missing":
        return {
          heading: "No cover to work from",
          message:
            "Add a cover for this book first. The spine is built from the cover art.",
        };
      default:
        return { heading: "Spine could not be generated", message: error.message };
    }
  }
  return {
    heading: "Spine could not be generated",
    message:
      "The on-device engine stopped before it finished. The cloth spine is unchanged; try again.",
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function cropTuple(
  artifact: SpineArtifact,
): [number, number, number, number] | null {
  const box = artifact.cropBox;
  if (!box) return null;
  return [box.x, box.y, box.width, box.height];
}

export function SpineStudio({
  bookId,
  title,
  author,
  pages,
  coverDataUrl,
}: StudioProps) {
  const [state, setState] = useState<StudioState>({ kind: "loading" });
  const [status, setStatus] = useState<SpineStatus | null>(null);
  const [style, setStyle] = useState<SpineStyle>("wrap");
  const [prepared, setPrepared] = useState<RenderBook | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setPrepared(null);
    setStyle("wrap");
    setStatus(null);
    // Opening a book must do zero engine work: only read the cache. Model
    // resolution (JNI asset extraction, ONNX Runtime) waits for Generate.
    platform
      .spineArtifact(bookId)
      .then((artifact) => {
        if (!alive) return;
        if (artifact) {
          setState({ kind: "result", artifact });
          setStyle(artifact.verdict === "fallback" ? "cloth" : "wrap");
        } else {
          setState({ kind: "idle" });
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const described = describeError(error);
        setState({
          kind: "error",
          heading: described.heading,
          message: described.message,
        });
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    if (state.kind !== "result") {
      setPrepared(null);
      return;
    }
    let alive = true;
    const artifact = state.artifact;
    void (async () => {
      const [loadedArt, loadedCover] = await Promise.all([
        loadImage(artifact.artDataUrl),
        coverDataUrl ? loadImage(coverDataUrl) : Promise.resolve(null),
      ]);
      const art =
        loadedArt ??
        loadedCover ??
        (await loadImage(artifact.fallbackDataUrl));
      if (!alive) return;
      if (!art) {
        setState({
          kind: "error",
          heading: "Spine preview unavailable",
          message:
            "The generated art could not be decoded. Generate the spine again.",
        });
        return;
      }
      const book: RenderBook = {
        title,
        author,
        pages: pages && pages > 0 ? pages : 320,
        cropBox: cropTuple(artifact),
        art,
        source: loadedCover ?? art,
        verdict: artifact.verdict,
        route: artifact.route,
        palette: null,
      };
      paletteFor(book);
      setPrepared(book);
    })();
    return () => {
      alive = false;
    };
  }, [state, title, author, pages, coverDataUrl]);

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setState({ kind: "generating" });
    try {
      // Status/model resolution is allowed here (never on mount). Running it
      // beside generation is safe because the backend resolves models
      // single-flight; a status failure must not block generation.
      const [artifact, nextStatus] = await Promise.all([
        platform.spineGenerate(bookId),
        platform.spineStatus().catch(() => null),
      ]);
      if (nextStatus) setStatus(nextStatus);
      setStyle(artifact.verdict === "fallback" ? "cloth" : "wrap");
      setState({ kind: "result", artifact });
    } catch (error) {
      const described = describeError(error);
      setState({
        kind: "error",
        heading: described.heading,
        message: described.message,
      });
    } finally {
      setBusy(false);
    }
  }, [bookId, busy]);

  const engineReady =
    status === null ||
    status.models === "ready" ||
    status.models === "bundled";
  const engineProblem =
    status?.models === "missing"
      ? "The engine models are not installed yet. Install them from Settings → Spine. Until then the shelf keeps its cloth spines."
      : status?.models === "error"
        ? (status.error ??
          "The engine models could not be loaded. Reinstall the bundle from Settings → Spine.")
        : null;

  return (
    <section
      className="spine-studio"
      data-testid="spine-studio"
      aria-labelledby="spine-studio-title"
    >
      <header className="spine-studio-head">
        <h3 id="spine-studio-title">Spine</h3>
        {status ? (
          <span className="spine-engine" data-testid="spine-engine">
            {engineLabel(status)}
          </span>
        ) : null}
      </header>

      {state.kind === "loading" ? (
        <p className="spine-fine" role="status">
          Checking for an existing spine…
        </p>
      ) : null}

      {state.kind === "idle" ? (
        <div className="spine-intro">
          <p>
            Turn this cover into a text-free spine on the device. Six styles
            render from the same result; nothing is uploaded.
          </p>
          {engineProblem ? (
            <p className="spine-problem" role="status">
              {engineProblem}
            </p>
          ) : null}
          <button
            type="button"
            className="spine-generate"
            data-testid="spine-generate"
            disabled={!engineReady}
            onClick={() => void generate()}
          >
            Generate spine
          </button>
          <p className="spine-fine">
            Runs locally · 5–20 s on a phone · the shelf keeps its cloth spine
            meanwhile.
          </p>
        </div>
      ) : null}

      {state.kind === "generating" ? (
        <div
          className="spine-generating"
          data-testid="spine-generating"
          role="status"
          aria-live="polite"
        >
          <span className="spine-progress" aria-hidden="true">
            <i />
          </span>
          <p className="spine-generating-title">Working on the spine…</p>
          <p className="spine-fine">
            Finding cover text · Removing text · Checking result
          </p>
          <p className="spine-fine">
            This runs on your device. It takes 5–20 s on a phone; the shelf
            keeps its cloth spine until the result lands.
          </p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div
          className="spine-error"
          data-testid="spine-error"
          role="alert"
        >
          <p className="spine-error-title">{state.heading}</p>
          <p>{state.message}</p>
          <button
            type="button"
            className="spine-generate"
            data-testid="spine-retry"
            disabled={busy || !engineReady}
            onClick={() => void generate()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {state.kind === "result" ? (
        <div className="spine-result" data-testid="spine-result">
          <div className="spine-verdict-row">
            <span
              className={`spine-pill spine-pill--${state.artifact.verdict}`}
              data-testid="spine-verdict"
              data-verdict={state.artifact.verdict}
            >
              {VERDICT_LABELS[state.artifact.verdict]}
            </span>
            <span className="spine-meta" data-testid="spine-meta">
              Mask {state.artifact.maskPercent.toFixed(1)}% · Route{" "}
              {state.artifact.route}
            </span>
          </div>

          {state.artifact.verdict === "review" ? (
            <p className="spine-note" data-testid="spine-review-note">
              The check found art it cannot vouch for. Inspect the spine, then
              use Cloth if it reads as cover copy.{" "}
              <button
                type="button"
                className="spine-inline-action"
                data-testid="spine-use-cloth"
                onClick={() => setStyle("cloth")}
              >
                Use Cloth
              </button>
            </p>
          ) : state.artifact.verdict === "fallback" ? (
            <p className="spine-note" data-testid="spine-fallback-note">
              Cloth applied automatically. The wrap stays available as a
              preview below.
            </p>
          ) : (
            <p className="spine-fine" data-testid="spine-pass-note">
              Passed the on-device check. Wrap is applied by default.
            </p>
          )}

          {prepared ? (
            <>
              <div
                className={`spine-preview${style === "wrap" ? " is-wrap" : ""}`}
                data-testid="spine-preview"
                data-style={style}
              >
                <SpineCanvas
                  book={prepared}
                  style={style}
                  testId="spine-preview-canvas"
                />
              </div>
              <p className="spine-preview-caption">
                {SPINE_STYLES.find((entry) => entry.id === style)?.note}
              </p>
              <div
                className="spine-style-grid"
                data-testid="spine-style-grid"
                role="group"
                aria-label="Spine style"
              >
                {SPINE_STYLES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="spine-style"
                    data-testid={`spine-style-${entry.id}`}
                    aria-pressed={style === entry.id}
                    onClick={() => setStyle(entry.id)}
                  >
                    <span className="spine-style-art">
                      <SpineCanvas
                        book={prepared}
                        style={entry.id}
                        testId={`spine-canvas-${entry.id}`}
                      />
                    </span>
                    <span className="spine-style-label">{entry.label}</span>
                  </button>
                ))}
              </div>
              <div className="spine-shelf" data-testid="spine-shelf">
                <div className="spine-shelf-art">
                  <SpineCanvas
                    book={prepared}
                    style={style}
                    strip
                    testId="spine-strip-canvas"
                  />
                </div>
                <p className="spine-shelf-copy">
                  <b>At shelf size</b>
                  33 px spine · the shelf keeps the wrap strip
                </p>
              </div>
              <p className="spine-fine">
                Switching styles re-renders the cached art; it does not run the
                engine again.
              </p>
            </>
          ) : (
            <p className="spine-fine" role="status">
              Preparing the spine preview…
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
