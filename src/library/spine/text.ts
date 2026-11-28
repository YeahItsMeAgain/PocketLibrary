/**
 * Type measurement, fitting and the vertical/horizontal run primitives: the
 * ink guard that samples the art under the type and the RTL-aware run
 * direction.
 */

import { clamp, luminance } from "./geometry";

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

export interface RegionStats {
  min: number;
  max: number;
  avg: number;
}

function contrastLuma(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function samplePixels(
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
 * Choose ink and a hairline halo from the pixels behind the type. The ink is
 * whichever of cream or dark clears the better worst-case contrast; when the
 * art is mid-tone and no raw ink clears 4.5:1, the opposite extreme becomes a
 * thin halo around the glyphs. Nothing is filled behind the type.
 */
export function guardInk(stats: RegionStats): {
  ink: string;
  halo: string;
  contrast: number;
  usedHalo: boolean;
} {
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
  const inkLuma = useCream ? CREAM_LUMA : DARK_LUMA;
  const haloLuma = useCream ? DARK_LUMA : CREAM_LUMA;
  const haloContrast = contrastLuma(inkLuma, haloLuma);
  // A mid-tone backdrop cannot give either raw ink 4.5:1, so the halo carries
  // the contrast. Light and dark art still report their measured raw contrast.
  const usedHalo = best < MIN_CONTRAST;
  return {
    ink: useCream ? CREAM_INK : DARK_INK,
    halo: useCream ? DARK_INK : CREAM_INK,
    contrast: usedHalo ? haloContrast : best,
    usedHalo,
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
  /** The deepest painted scrim alpha, 0 when none. */
  scrimAlpha: number;
  /** The scrim's head and tail alphas, when it is a gradient. */
  scrimHead?: number;
  scrimTail?: number;
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
  /**
   * The Art foot zone: the scrim's deepest portion that holds the author and
   * chips. It is not an opaque band.
   */
  foot?: { top: number; bottom: number };
  /** The art's painted bounds (full height on S1), 0 when no art is painted. */
  art?: { top: number; bottom: number };
  /** The clear head band reserved by the status mark at the head. */
  headReserve?: number;
  /** The status mark, when the book has one and the face can paint it. */
  mark?: {
    kind: "gold-ribbon" | "drape";
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * Which way the glyphs face down the spine. Typography uses the shelf face
   * (`top-down`); the older cloth treatment reads `bottom-up`.
   */
  textOrientation?: "top-down" | "bottom-up";
  /** The exact text painted in the Art label chips, in paint order. */
  labelChips?: string[];
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
  let measured = lines.map((line) =>
    metrics(line, options.family, options.weight, options.track),
  );
  let adv = Math.max(...measured.map((entry) => entry.adv)) * fs;
  // The floor is a legibility goal, not a licence to clip: if a single long
  // word still overflows at the minimum, shrink it until the run fits.
  for (let attempt = 0; attempt < 24 && adv > options.length * 0.999; attempt += 1) {
    fs *= 0.96;
    measured = lines.map((line) =>
      metrics(line, options.family, options.weight, options.track),
    );
    adv = Math.max(...measured.map((entry) => entry.adv)) * fs;
  }
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
export function drawVerticalRun(
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
    /** A hairline outline drawn under the fill, never a block. */
    halo?: { color: string; width: number };
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
    if (options.halo) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = options.halo.width;
      ctx.strokeStyle = options.halo.color;
      ctx.strokeText(line, 0, 0);
      ctx.restore();
    }
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
    /** Split a multi-word run even when the one-line fit already succeeds. */
    forceSplit?: boolean;
  },
): HorizontalFit {
  const track = options.track ?? 0.01;
  const one = metrics(text, options.family, options.weight, track);
  let fs = Math.min(
    options.maxSize,
    (options.width * 0.96) / Math.max(0.05, one.adv),
  );
  let lines = [text];
  if (
    (options.forceSplit || fs < (options.splitBelow ?? 13)) &&
    (options.maxLines ?? 2) > 1
  ) {
    const split = bestSplit(text);
    if (split) {
      const measured = split.lines.map((line) =>
        metrics(line, options.family, options.weight, track),
      );
      const adv = Math.max(...measured.map((entry) => entry.adv));
      const next = Math.min(options.maxSize, (options.width * 0.96) / adv);
      if (options.forceSplit || next > fs * 1.05) {
        fs = next;
        lines = split.lines;
      }
    }
  }
  fs = Math.max(options.minSize, Math.round(fs * 10) / 10);
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
