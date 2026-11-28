/**
 * The three spine styles: Art (the art spine with structural bands), Cloth
 * (a sampled cloth with foil type) and Typography (the original flat
 * title-hash board with type only). Each returns the measured type meta for
 * the canvas data attributes.
 */

import type { Book } from "../../platform";
import type { RenderBook } from "./geometry";
import { shelfSpineStyle, spineLabelAbbr } from "../spine";
import {
  ART_FOOT_TOP,
  ART_HEAD_RESERVE,
  ART_HEAD_RESERVE_FINISHED,
  ART_SCRIM,
  contrast,
  GOLD_RIBBON,
  luminance,
  mix,
  paletteFor,
  READING_DRAPE,
  SPINE_H,
  SPINE_W,
} from "./geometry";
import { drawArt, drawProvenance, grain, spineEdges } from "./draw";
import {
  drawHorizontal,
  drawVertical,
  drawVerticalRun,
  fitHorizontal,
  fitVertical,
  metrics,
  SANS,
  samplePixels,
  SERIF,
  setTracking,
  type RenderMeta,
  type SpineBlock,
} from "./text";

function provenance(book: RenderBook): "original" | "reconstructed" | "fallback" {
  if (book.verdict === "fallback") return "fallback";
  if (book.route === "inpaint") return "reconstructed";
  return "original";
}

const STATUS_CREAM = "#f4e6c4";
const CREAM_LUMA = luminance(STATUS_CREAM);

function ratioLuma(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function horizontalRamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  stops: ReadonlyArray<readonly [number, string]>,
  y0: number,
  y1: number,
) {
  const gradient = ctx.createLinearGradient(x, y0, x + width, y1);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  return gradient;
}

/** The finished gold head ribbon: 8 x 26 at right 3px, notched swallowtail. */
function drawGoldRibbon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const { width, height, stops, edge } = GOLD_RIBBON;
  const tail = y + height * 0.82;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width / 2, tail);
  ctx.lineTo(x, y + height);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = horizontalRamp(ctx, x, width, stops, y, y + height);
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  const sheen = ctx.createLinearGradient(x, y + 2, x, y + height - 3);
  sheen.addColorStop(0, "rgba(255,248,224,.6)");
  sheen.addColorStop(0.55, "rgba(255,248,224,.08)");
  sheen.addColorStop(1, "rgba(255,248,224,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x + 1, y + 2, 2, height - 5);
  ctx.restore();
}

/**
 * The reading drape's in-spine 4px. The rest hangs over the shelf lip and
 * board, which is outside this 52 x 236 canvas; the shelf's cue layer paints
 * it and the meta below reports its full geometry.
 */
function drawDrapeSliver(ctx: CanvasRenderingContext2D, x: number) {
  const y = SPINE_H - READING_DRAPE.spineOverlap;
  const width = READING_DRAPE.width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, SPINE_H - y);
  ctx.clip();
  ctx.fillStyle = horizontalRamp(
    ctx,
    x,
    width,
    READING_DRAPE.stops,
    y,
    SPINE_H,
  );
  ctx.fillRect(x, y, width, SPINE_H - y);
  ctx.fillStyle = "rgba(236,215,164,.55)";
  ctx.fillRect(x, y, width, 1);
  ctx.restore();
}

function drawStatusMark(ctx: CanvasRenderingContext2D, book: RenderBook) {
  if (book.readingStatus === "finished") {
    drawGoldRibbon(ctx, SPINE_W - GOLD_RIBBON.right - GOLD_RIBBON.width, 0);
  } else if (book.readingStatus === "reading") {
    drawDrapeSliver(ctx, SPINE_W - 2 - READING_DRAPE.width);
  }
}

function statusMark(book: RenderBook): RenderMeta["mark"] {
  if (book.readingStatus === "finished") {
    return {
      kind: "gold-ribbon",
      x: SPINE_W - GOLD_RIBBON.right - GOLD_RIBBON.width,
      y: 0,
      width: GOLD_RIBBON.width,
      height: GOLD_RIBBON.height,
    };
  }
  if (book.readingStatus === "reading") {
    return {
      kind: "drape",
      x: SPINE_W - 2 - READING_DRAPE.width,
      y: SPINE_H - READING_DRAPE.spineOverlap,
      width: READING_DRAPE.width,
      height: READING_DRAPE.spineOverlap + READING_DRAPE.overLipAndBoard,
    };
  }
  return undefined;
}

/** Art reserves 28px for the finished ribbon and 10px otherwise. */
function artHeadReserve(book: RenderBook): number {
  return book.readingStatus === "finished"
    ? ART_HEAD_RESERVE_FINISHED
    : ART_HEAD_RESERVE;
}

export function drawCloth(ctx: CanvasRenderingContext2D, book: RenderBook): RenderMeta {
  const palette = paletteFor(book);
  // The cloth is derived from the sampled jacket palette, then pulled towards a
  // dyed book cloth so it never reads as a flat grey. It is always dark enough
  // for warm foil; a light jacket does not produce a washed-out board.
  let cloth = palette.light
    ? mix(palette.avg, "#231610", 0.68)
    : mix(palette.avg, "#100b08", 0.6);
  if (luminance(cloth) > 0.2) cloth = mix(cloth, "#0b0907", 0.4);
  const foil = "#ecd7a4";
  const foilDim = "#c9b07a";
  ctx.direction = book.direction;

  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);
  ctx.save();
  // A woven cloth grain: fine vertical warp and a slower weft.
  ctx.globalAlpha = 0.1;
  for (let x = 0; x < SPINE_W; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? "#fff" : "#000";
    ctx.fillRect(x, 0, 0.5, SPINE_H);
  }
  ctx.globalAlpha = 0.05;
  for (let y = 0; y < SPINE_H; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? "#fff" : "#000";
    ctx.fillRect(0, y, SPINE_W, 0.5);
  }
  ctx.restore();
  const look = {
    x: SPINE_W / 2,
    thick: Math.min(SPINE_W - 12, 30),
    head: 36,
    tail: 22,
    ornY: 16,
    ornSize: 10,
  };
  // Double foil rules at the head and tail, plus a shadowed board edge.
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.fillRect(0, 27, SPINE_W, 0.8);
  ctx.fillRect(0, SPINE_H - 27, SPINE_W, 0.8);
  ctx.fillStyle = foil;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(9, 12, SPINE_W - 18, 0.7);
  ctx.fillRect(9, 15, SPINE_W - 18, 0.4);
  ctx.fillRect(9, SPINE_H - 12, SPINE_W - 18, 0.7);
  ctx.fillRect(9, SPINE_H - 15, SPINE_W - 18, 0.4);
  ctx.globalAlpha = 1;

  const margin = 28;
  const gap = 7;
  const authorText = String(book.author || "").trim();
  const authorFit = authorText
    ? fitVertical(authorText, {
        family: SERIF,
        weight: 400,
        track: 0.02,
        thick: look.thick,
        length: SPINE_H * 0.28,
        maxSize: 4.6,
        minSize: 2.8,
        stack: false,
      })
    : null;
  const authorLength = authorFit
    ? Math.max(
        ...authorFit.lines.map(
          (line) => metrics(line, SERIF, 400, 0.02).adv,
        ),
      ) * authorFit.fs
    : 0;
  const titleArea = Math.max(
    20,
    SPINE_H - margin * 2 - authorLength - (authorLength ? gap : 0),
  );
  const title = fitVertical(String(book.title || ""), {
    family: SERIF,
    weight: 400,
    track: 0.01,
    thick: look.thick,
    length: titleArea,
    maxSize: 11.2,
    minSize: 2.8,
  });
  const blockHeight = title.length + (authorLength ? gap + authorLength : 0);
  const blockTop = (SPINE_H - blockHeight) / 2;
  const titleCenter = blockTop + title.length / 2;
  const authorCenter = blockTop + title.length + gap + authorLength / 2;
  drawVertical(ctx, title, look.x, titleCenter, foil, {
    family: SERIF,
    weight: 400,
    track: 0.01,
  });
  if (authorFit) {
    drawVertical(ctx, authorFit, look.x, authorCenter, foilDim, {
      family: SERIF,
      weight: 400,
      track: 0.02,
      lineGap: 1.1,
    });
  }
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
  drawStatusMark(ctx, book);
  return {
    direction: book.direction,
    scrim: false,
    scrimAlpha: 0,
    contrast: contrast(foil, cloth),
    block: {
      x: look.x,
      y: SPINE_H / 2,
      width: look.thick,
      height: blockHeight,
    },
    title: {
      x: look.x,
      y: titleCenter,
      width: title.thickness,
      height: title.length,
      fs: title.fs,
      lines: title.lines.length,
    },
    author: authorFit
      ? {
          x: look.x,
          y: authorCenter,
          width: authorFit.thickness,
          height: authorLength,
          fs: authorFit.fs,
          lines: authorFit.lines.length,
        }
      : null,
    colophon: {
      x: look.x,
      y: SPINE_H - 9,
      width: 4.4,
      height: 4.4,
    },
    vertical: true,
    textOrientation: "bottom-up",
    headReserve: book.readingStatus === "finished" ? 28 : 24,
    mark: statusMark(book),
  };
}

/**
 * Typography is the original pre-engine spine: a flat, untextured two-tone
 * board from the book's title-hash palette, with cream and gold type only.
 * It never samples the art and never paints a weave.
 */
export function drawTypography(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  const hashBook = {
    contentHash: book.contentHash ?? `${book.title}|${book.author}`,
    title: book.title,
    authors: book.author ? [book.author] : [],
    slotIndex: book.slotIndex ?? 0,
    format: book.format ?? "epub",
  } as Book;
  const board = shelfSpineStyle(hashBook);
  const cream = "#f4e6c4";
  const gold = "#d8b976";
  ctx.direction = book.direction;

  const gradient = ctx.createLinearGradient(0, 0, 0, SPINE_H);
  gradient.addColorStop(0, board.c1);
  gradient.addColorStop(1, board.c2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);

  const look = {
    x: SPINE_W / 2,
    thick: Math.min(SPINE_W - 12, 30),
    head: 36,
    tail: 22,
    ornY: 16,
    ornSize: 10,
  };
  // Thin rules at head and tail, in gold, are the only furniture on the board.
  ctx.fillStyle = gold;
  ctx.globalAlpha = 0.66;
  ctx.fillRect(9, 12, SPINE_W - 18, 0.7);
  ctx.fillRect(9, 15, SPINE_W - 18, 0.4);
  ctx.fillRect(9, SPINE_H - 12, SPINE_W - 18, 0.7);
  ctx.fillRect(9, SPINE_H - 15, SPINE_W - 18, 0.4);
  ctx.globalAlpha = 1;

  const margin = 28;
  const gap = 7;
  const authorText = String(book.author || "").trim();
  const authorFit = authorText
    ? fitVertical(authorText, {
        family: SERIF,
        weight: 400,
        track: 0.02,
        thick: look.thick,
        length: SPINE_H * 0.28,
        maxSize: 4.6,
        minSize: 2.8,
        stack: false,
      })
    : null;
  const authorLength = authorFit
    ? Math.max(
        ...authorFit.lines.map(
          (line) => metrics(line, SERIF, 400, 0.02).adv,
        ),
      ) * authorFit.fs
    : 0;
  const titleArea = Math.max(
    20,
    SPINE_H - margin * 2 - authorLength - (authorLength ? gap : 0),
  );
  const title = fitVertical(String(book.title || ""), {
    family: SERIF,
    weight: 400,
    track: 0.01,
    thick: look.thick,
    length: titleArea,
    maxSize: 11.2,
    minSize: 2.8,
  });
  const blockHeight = title.length + (authorLength ? gap + authorLength : 0);
  const blockTop = (SPINE_H - blockHeight) / 2;
  const titleCenter = blockTop + title.length / 2;
  const authorCenter = blockTop + title.length + gap + authorLength / 2;
  drawVerticalRun(ctx, title, look.x, titleCenter, cream, {
    family: SERIF,
    weight: 400,
    track: 0.01,
    direction: book.direction,
  });
  if (authorFit) {
    drawVerticalRun(ctx, authorFit, look.x, authorCenter, gold, {
      family: SERIF,
      weight: 400,
      track: 0.02,
      lineGap: 1.1,
      direction: book.direction,
    });
  }
  // The seal: a small diamond and dot at the head, as on the original spine.
  ctx.save();
  ctx.translate(look.x, look.ornY);
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
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
  drawStatusMark(ctx, book);
  return {
    direction: book.direction,
    scrim: false,
    scrimAlpha: 0,
    contrast: Math.min(contrast(cream, board.c1), contrast(cream, board.c2)),
    block: {
      x: look.x,
      y: SPINE_H / 2,
      width: look.thick,
      height: blockHeight,
    },
    title: {
      x: look.x,
      y: titleCenter,
      width: title.thickness,
      height: title.length,
      fs: title.fs,
      lines: title.lines.length,
    },
    author: authorFit
      ? {
          x: look.x,
          y: authorCenter,
          width: authorFit.thickness,
          height: authorLength,
          fs: authorFit.fs,
          lines: authorFit.lines.length,
        }
      : null,
    colophon: {
      x: look.x,
      y: SPINE_H - 9,
      width: 4.4,
      height: 4.4,
    },
    vertical: true,
    textOrientation: "top-down",
    headReserve: book.readingStatus === "finished" ? 28 : 24,
    mark: statusMark(book),
  };
}

const WRAP_GOLD = "#d8b976";

function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
  text: string,
  fontSize: number,
  more = false,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = more ? WRAP_GOLD : colour;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(201,168,106,0.55)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.25, y + 0.25, width - 0.5, height - 0.5);
  if (text) {
    ctx.fillStyle = more ? "#241420" : "#f8edd6";
    ctx.font = `700 ${fontSize}px ${SANS}`;
    setTracking(ctx, "0.02em");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + width / 2, y + height / 2 + 0.3);
  }
  ctx.restore();
}

const CHIP_FONT_MAX = 5;
const CHIP_FONT_MIN = 3.2;
const CHIP_TRACK = 0.02;
const CHIP_PADDING = 3;

/** Fit a 4-5 letter code, shrinking before ever truncating. */
function fitChipText(
  text: string,
  width: number,
): { text: string; fs: number; truncated: boolean } {
  for (let fs = CHIP_FONT_MAX; fs >= CHIP_FONT_MIN - 0.001; fs -= 0.2) {
    if (metrics(text, SANS, 700, CHIP_TRACK).adv * fs <= width - CHIP_PADDING) {
      return { text, fs, truncated: false };
    }
  }
  const fs = CHIP_FONT_MIN;
  let clipped = text;
  while (
    clipped.length > 1 &&
    metrics(`${clipped}…`, SANS, 700, CHIP_TRACK).adv * fs > width - CHIP_PADDING
  ) {
    clipped = clipped.slice(0, -1);
  }
  return { text: `${clipped}…`, fs, truncated: true };
}

interface ChipEntry {
  name: string;
  colour: string;
  more: boolean;
}
interface ChipPlan {
  x: number;
  width: number;
  entry: ChipEntry;
  fit: { text: string; fs: number; truncated: boolean };
}

/**
 * Every chip is a full-width row, as on the shelf: up to two 4-5 letter codes
 * and a gold `+N` overflow row. Ellipsis is the last resort.
 */
function planLabelChips(
  labels: ReadonlyArray<{ name: string; colour: string }>,
  rowWidth: number,
): ChipPlan[][] {
  const entries: ChipEntry[] = labels
    .slice(0, 2)
    .map((label) => ({
      name: spineLabelAbbr(label.name),
      colour: label.colour,
      more: false,
    }));
  const hidden = labels.length - entries.length;
  if (hidden > 0) {
    entries.push({ name: `+${hidden}`, colour: WRAP_GOLD, more: true });
  }
  return entries.map((entry) => [
    {
      x: 0,
      width: rowWidth,
      entry,
      fit: fitChipText(entry.name, rowWidth),
    },
  ]);
}

/**
 * Art is S1 smoked leather: full-height art under a warm near-black scrim,
 * gold hairlines at head and tail, no foot band. The scrim's darkest 30% holds
 * the full author over two lines above 4-5 letter label codes, and the title
 * runs from a 10px (or 28px finished) head to 70%.
 */
export function drawArtSpine(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  const authorText = String(book.author || "").trim();
  const hasAuthor = Boolean(authorText);
  const labels = book.labels ?? [];
  const head = artHeadReserve(book);
  const titleBottom = ART_FOOT_TOP - 4;
  const titleArea = Math.max(20, titleBottom - head);
  ctx.direction = book.direction;

  // Full-height art, unchanged, then the warm scrim over all of it.
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  const scrim = ctx.createLinearGradient(0, 0, 0, SPINE_H);
  scrim.addColorStop(0, `rgba(22,13,8,${ART_SCRIM.head})`);
  scrim.addColorStop(0.45, `rgba(20,12,7,${ART_SCRIM.mid})`);
  scrim.addColorStop(1, `rgba(14,8,4,${ART_SCRIM.tail})`);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);

  // Gold hairlines at 7-8px and 3-4px above the tail, above the scrim.
  ctx.fillStyle = "rgba(236,215,164,.72)";
  ctx.fillRect(0, 7, SPINE_W, 1);
  ctx.fillStyle = "rgba(236,215,164,.55)";
  ctx.fillRect(0, SPINE_H - 4, SPINE_W, 1);
  // A narrow darkening of both side edges, as the CSS face does.
  const edge = ctx.createLinearGradient(0, 0, SPINE_W, 0);
  edge.addColorStop(0, "rgba(0,0,0,.56)");
  edge.addColorStop(0.08, "rgba(0,0,0,0)");
  edge.addColorStop(0.88, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, SPINE_W, SPINE_H);

  const title = fitVertical(String(book.title || "Untitled"), {
    family: SERIF,
    weight: 600,
    track: 0.012,
    thick: SPINE_W - 4,
    length: titleArea,
    maxSize: 11.8,
    minSize: 2.8,
  });
  const titleCenter = head + titleArea / 2;

  // Contrast is measured against the real composited pixels behind the title,
  // before the cream glyphs are painted over them.
  const stats = samplePixels(
    ctx,
    2,
    head,
    SPINE_W - 4,
    Math.max(1, titleArea),
  );
  const titleContrast = Math.min(
    ratioLuma(CREAM_LUMA, stats.min),
    ratioLuma(CREAM_LUMA, stats.max),
  );

  // The title sits on the scrim with a soft shadow, not a halo.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  drawVerticalRun(ctx, title, SPINE_W / 2, titleCenter, STATUS_CREAM, {
    family: SERIF,
    weight: 600,
    track: 0.012,
    direction: book.direction,
  });
  ctx.restore();

  // The foot: author above the codes, both on the scrim's deepest part.
  let author: SpineBlock | null = null;
  const chipTexts: string[] = [];
  const footHeight = SPINE_H - ART_FOOT_TOP;
  const chipH = 9;
  const chipGap = 1;
  const chipWidth = SPINE_W - 8;
  const chipRows = planLabelChips(labels, chipWidth);
  const chipsHeight =
    chipRows.length > 0
      ? chipRows.length * chipH + (chipRows.length - 1) * chipGap
      : 0;
  const authorFit = hasAuthor
    ? fitHorizontal(authorText.toUpperCase(), {
        width: SPINE_W - 6,
        maxSize: 6.2,
        minSize: 3.4,
        maxLines: 2,
        // The shelf always balances a multi-word author over two lines.
        forceSplit: true,
        family: SERIF,
        weight: 500,
        track: 0.02,
      })
    : null;
  const authorHeight = authorFit
    ? authorFit.lines.length * authorFit.fs * 1.02
    : 0;
  const groupGap = authorHeight && chipsHeight ? 2 : 0;
  const groupHeight = authorHeight + groupGap + chipsHeight;
  let y = ART_FOOT_TOP + Math.max(4, (footHeight - groupHeight) / 2);
  if (authorFit) {
    ctx.save();
    drawHorizontal(ctx, authorFit, SPINE_W / 2, y, "#e8d4a6", {
      align: "center",
      gap: 1.02,
    });
    ctx.restore();
    const measured = Math.max(
      ...authorFit.lines.map(
        (line) => metrics(line, SERIF, 500, 0.02).adv * authorFit.fs,
      ),
    );
    author = {
      x: SPINE_W / 2,
      y: y + authorHeight / 2,
      width: Math.min(SPINE_W - 6, measured),
      height: authorHeight,
      fs: authorFit.fs,
      lines: authorFit.lines.length,
    };
    y += authorHeight + groupGap;
  }
  for (const row of chipRows) {
    for (const chip of row) {
      drawLabelChip(
        ctx,
        4 + chip.x,
        y,
        chip.width,
        chipH,
        chip.entry.colour,
        chip.fit.text,
        chip.fit.fs,
        chip.entry.more,
      );
      chipTexts.push(chip.fit.text);
    }
    y += chipH + chipGap;
  }

  drawStatusMark(ctx, book);

  const titleTop = titleCenter - title.length / 2;
  const titleLower = titleCenter + title.length / 2;
  const blockTop = Math.min(titleTop, author ? author.y - author.height / 2 : titleLower);
  const blockBottom = Math.max(
    titleLower,
    author ? author.y + author.height / 2 : titleTop,
  );
  return {
    direction: book.direction,
    scrim: true,
    scrimAlpha: ART_SCRIM.tail,
    scrimHead: ART_SCRIM.head,
    scrimTail: ART_SCRIM.tail,
    contrast: titleContrast,
    block: {
      x: SPINE_W / 2,
      y: (blockTop + blockBottom) / 2,
      width: SPINE_W - 4,
      height: blockBottom - blockTop,
    },
    title: {
      x: SPINE_W / 2,
      y: titleCenter,
      width: title.thickness,
      height: title.length,
      fs: title.fs,
      lines: title.lines.length,
    },
    author,
    // Art has no cap band, so there is no colophon mark.
    colophon: { x: SPINE_W / 2, y: 0, width: 0, height: 0 },
    vertical: true,
    textOrientation: "top-down",
    foot: { top: ART_FOOT_TOP, bottom: SPINE_H },
    art: { top: 0, bottom: SPINE_H },
    headReserve: head,
    mark: statusMark(book),
    labelChips: chipTexts,
  };
}
