/**
 * Type measurement, fitting and the real-book type block: the vertical title
 * and author runs, the ink guard that samples the art under the type, the
 * colophon and the RTL-aware run direction.
 */

import type { RenderBook, SpineTypeStyle } from "./geometry";
import {
  clamp,
  luminance,
  SPINE_H,
  SPINE_RAIL,
  spineTypeBands,
  spineTypeZones,
} from "./geometry";
import { drawProvenance } from "./draw";

export const SERIF = '"Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif';
export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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
    // CSS coordinates are transformed by the canvas DPR scale; getImageData
    // wants the backing-store pixels.
    const transform = ctx.getTransform();
    const scaleX = Math.abs(transform.a) || 1;
    const scaleY = Math.abs(transform.d) || 1;
    const dx = transform.e;
    const dy = transform.f;
    const sx = clamp(
      Math.floor(x * scaleX + dx),
      0,
      Math.max(0, canvas.width - 1),
    );
    const sy = clamp(
      Math.floor(y * scaleY + dy),
      0,
      Math.max(0, canvas.height - 1),
    );
    const sw = clamp(Math.ceil(width * scaleX), 1, canvas.width - sx);
    const sh = clamp(Math.ceil(height * scaleY), 1, canvas.height - sy);
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
  /** The title run filling the spine, from the head to the author. */
  title: SpineBlock;
  /** The author run below the title, or null when the book has no author. */
  author: SpineBlock | null;
  /** The rule and initials at the base. */
  colophon: { x: number; y: number; width: number; height: number };
  /** True when the title and author run down the spine. */
  vertical: boolean;
}

let measureContext: CanvasRenderingContext2D | null = null;

export function metrics(
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

export function fitVertical(
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

export function setTracking(ctx: CanvasRenderingContext2D, value: string) {
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in spaced) spaced.letterSpacing = value;
}

export function drawVertical(
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

export function fitHorizontal(
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

export function drawHorizontal(
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

/* ------------------------------------------------ real-book type block -- */

interface SpineTypeLayout {
  title: VerticalFit;
  author: VerticalFit | null;
  titleCenter: number;
  authorCenter: number;
  titleBlock: SpineBlock;
  authorBlock: SpineBlock | null;
  block: { x: number; y: number; width: number; height: number };
  /** The scrim band behind the title; inside the rail for Full-bleed. */
  titleBand: { x: number; y: number; width: number; height: number };
  /** The scrim band behind the author and the base mark. */
  authorBand: { x: number; y: number; width: number; height: number };
}

/**
 * The prototype voice: a tracked sans title on both styles, with the author in
 * a lighter sans below it. Full-bleed gets the slightly wider track of the
 * smoked rail; Wrap is a touch tighter.
 */
function typeVoice(style: SpineTypeStyle) {
  return style === "full-bleed"
    ? {
        title: { family: SANS, weight: 600, track: 0.06 },
        author: { family: SANS, weight: 500, track: 0.1 },
      }
    : {
        title: { family: SANS, weight: 600, track: 0.05 },
        author: { family: SANS, weight: 500, track: 0.12 },
      };
}

function layoutSpineType(
  book: RenderBook,
  width: number,
  style: SpineTypeStyle,
): SpineTypeLayout {
  const voice = typeVoice(style);
  const fullBleed = style === "full-bleed";
  const spec = fullBleed
    ? spineTypeZones().fullBleed
    : spineTypeZones().wrap;
  // Full-bleed type owns the rail; Wrap type centres on the spine.
  const cx = fullBleed ? spineTypeZones().rail.centerX : width / 2;
  const titleThick = fullBleed ? SPINE_RAIL.width - 3.4 : width - 3;
  const authorThick = fullBleed ? SPINE_RAIL.width - 4 : width - 3;

  const authorText = String(book.author || "").trim();
  const author = authorText
    ? fitVertical(authorText, {
        family: voice.author.family,
        weight: voice.author.weight,
        track: voice.author.track,
        thick: authorThick,
        length: 48,
        maxSize: spec.authorMaxSize,
        minSize: spec.authorMinSize,
        stack: false,
      })
    : null;
  const authorLength =
    (author
      ? Math.max(
          ...author.lines.map(
            (line) =>
              metrics(
                line,
                voice.author.family,
                voice.author.weight,
                voice.author.track,
              ).adv,
          ),
        ) * author.fs
      : 0);

  // The title takes every pixel the author does not need (prototype:
  // H - 50 - authorLen - 14 for Wrap; H - 54 - authorLen - 8 for Full-bleed).
  const bands = spineTypeBands(style, authorLength);
  const title = fitVertical(
    String(book.title || "Untitled").toUpperCase(),
    {
      family: voice.title.family,
      weight: voice.title.weight,
      track: voice.title.track,
      thick: titleThick,
      length: bands.titleLength,
      maxSize: spec.titleMaxSize,
      minSize: spec.titleMinSize,
    },
  );

  const titleBlock: SpineBlock = {
    x: cx,
    y: bands.titleCenter,
    width: title.thickness,
    height: title.length,
    fs: title.fs,
    lines: title.lines.length,
  };
  const authorBlock: SpineBlock | null = author
    ? {
        x: cx,
        y: bands.authorCenter,
        width: author.thickness,
        height: authorLength,
        fs: author.fs,
        lines: author.lines.length,
      }
    : null;
  const top = titleBlock.y - titleBlock.height / 2;
  const bottom = authorBlock
    ? authorBlock.y + authorBlock.height / 2
    : titleBlock.y + titleBlock.height / 2;
  const bandX = fullBleed ? spineTypeZones().rail.x + 1 : 0;
  const bandWidth = fullBleed ? SPINE_RAIL.width - 2 : width;
  const railTop = SPINE_RAIL.head;
  const railBottom = SPINE_H - SPINE_RAIL.tail;
  const titleRunTop = bands.titleCenter - title.length / 2;
  const titleBandTop = Math.max(fullBleed ? railTop + 1 : 0, titleRunTop - 2);
  const titleBandBottom = Math.min(
    fullBleed ? railBottom - 1 : SPINE_H,
    titleRunTop + title.length + 2,
  );
  const authorBandTop = Math.max(fullBleed ? railTop + 1 : 0, bands.authorTop - 2);
  const authorBandBottom = fullBleed
    ? railBottom - 1
    : spineTypeZones().colophonBaseY + 8;
  return {
    title,
    author,
    titleCenter: bands.titleCenter,
    authorCenter: bands.authorCenter,
    titleBlock,
    authorBlock,
    block: {
      x: cx,
      y: (top + bottom) / 2,
      width: Math.max(titleBlock.width, authorBlock?.width ?? 0),
      height: bottom - top,
    },
    titleBand: {
      x: bandX,
      y: titleBandTop,
      width: bandWidth,
      height: titleBandBottom - titleBandTop,
    },
    authorBand: {
      x: bandX,
      y: authorBandTop,
      width: bandWidth,
      height: authorBandBottom - authorBandTop,
    },
  };
}

function drawColophon(
  ctx: CanvasRenderingContext2D,
  width: number,
  ink: string,
  direction: "ltr" | "rtl",
  style: SpineTypeStyle,
  kind: "original" | "reconstructed" | "fallback",
) {
  const zones = spineTypeZones();
  if (style === "full-bleed") {
    // Prototype: a rule under the head and a provenance diamond at the base.
    const railX = zones.rail.x;
    ctx.save();
    ctx.direction = direction;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(railX + 4, SPINE_RAIL.ruleY, SPINE_RAIL.width - 8, 0.7);
    ctx.restore();
    drawProvenance(ctx, zones.rail.centerX, zones.provenanceY, kind);
    return;
  }
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
 * untouched; only the measured ink and the scrim behind it are added. The
 * Full-bleed rail must already be painted by the style so the guard samples
 * the rail composite rather than the uncovered art.
 */
export function drawSpineType(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
  width: number,
  offsetX: number,
  style: SpineTypeStyle = "wrap",
): RenderMeta {
  const layout = layoutSpineType(book, width, style);
  const voice = typeVoice(style);
  type Band = { x: number; y: number; width: number; height: number };
  const sample = (band: Band) =>
    samplePixels(
      ctx,
      offsetX + band.x,
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
  // Two local guards: one band carries the title, the other the author and the
  // base mark. On Full-bleed both bands sit inside the smoked rail, so a scrim
  // only ever darkens the rail and never the art.
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
      family: voice.title.family,
      weight: voice.title.weight,
      track: voice.title.track,
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
        family: voice.author.family,
        weight: voice.author.weight,
        track: voice.author.track,
        direction: book.direction,
      },
    );
    ctx.restore();
  }
  ctx.save();
  ctx.translate(offsetX, 0);
  drawColophon(
    ctx,
    width,
    authorGuard.ink,
    book.direction,
    style,
    book.verdict === "fallback"
      ? "fallback"
      : book.route === "inpaint"
        ? "reconstructed"
        : "original",
  );
  ctx.restore();
  const zones = spineTypeZones();
  const fullBleed = style === "full-bleed";
  return {
    direction: book.direction,
    scrim: titleGuard.usedScrim || authorGuard.usedScrim,
    contrast: Math.min(titleGuard.contrast, authorGuard.contrast),
    block: layout.block,
    title: layout.titleBlock,
    author: layout.authorBlock,
    colophon: fullBleed
      ? {
          x: zones.rail.centerX,
          y: zones.provenanceY,
          width: 4.4,
          height: 4.4,
        }
      : {
          x: width / 2,
          y: zones.colophonRuleY,
          width: Math.min(24, Math.max(5, width - 14)),
          height: zones.colophonBaseY - zones.colophonRuleY + 4,
        },
    vertical: true,
  };
}
