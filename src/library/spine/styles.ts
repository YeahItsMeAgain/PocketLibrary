/**
 * The three spine styles: Art (the art spine with structural bands), Cloth
 * (a sampled cloth with foil type) and Typography (the original flat
 * title-hash board with type only). Each returns the measured type meta for
 * the canvas data attributes.
 */

import type { Book } from "../../platform";
import type { RenderBook } from "./geometry";
import { shelfSpineStyle } from "../spine";
import {
  contrast,
  luminance,
  mix,
  paletteFor,
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
  guardInk,
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
  };
}

const WRAP_UMBER = "#1b140e";
const WRAP_UMBER_DEEP = "#090604";
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

const CHIP_FONT_MAX = 4.6;
const CHIP_FONT_MIN = 3.2;
const CHIP_TRACK = 0.02;
const CHIP_PADDING = 3;

/** Fit the full uppercase name, shrinking before ever truncating. */
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
 * Lay out up to two label chips side by side when both full names fit. If the
 * pair would truncate, stack them full width instead; ellipsis is the last
 * resort. A third chip is the gold `+N` overflow row.
 */
function planLabelChips(
  labels: ReadonlyArray<{ name: string; colour: string }>,
  rowWidth: number,
): ChipPlan[][] {
  const entries: ChipEntry[] = labels
    .slice(0, 2)
    .map((label) => ({
      name: label.name.toUpperCase(),
      colour: label.colour,
      more: false,
    }));
  const hidden = labels.length - entries.length;
  if (hidden > 0) {
    entries.push({ name: `+${hidden}`, colour: WRAP_GOLD, more: true });
  }
  if (entries.length === 0) return [];
  if (entries.length === 1) {
    return [
      [
        {
          x: 0,
          width: rowWidth,
          entry: entries[0],
          fit: fitChipText(entries[0].name, rowWidth),
        },
      ],
    ];
  }

  const gap = 2;
  const half = (rowWidth - gap) / 2;
  const left = fitChipText(entries[0].name, half);
  const right = fitChipText(entries[1].name, half);
  const rows: ChipPlan[][] = [];
  if (!left.truncated && !right.truncated) {
    rows.push([
      { x: 0, width: half, entry: entries[0], fit: left },
      { x: half + gap, width: half, entry: entries[1], fit: right },
    ]);
  } else {
    // Full names win over side-by-side: stack them rather than ellipsize.
    rows.push([
      {
        x: 0,
        width: rowWidth,
        entry: entries[0],
        fit: fitChipText(entries[0].name, rowWidth),
      },
    ]);
    rows.push([
      {
        x: 0,
        width: rowWidth,
        entry: entries[1],
        fit: fitChipText(entries[1].name, rowWidth),
      },
    ]);
  }
  if (entries.length > 2) {
    rows.push([
      {
        x: 0,
        width: rowWidth,
        entry: entries[2],
        fit: fitChipText(entries[2].name, rowWidth),
      },
    ]);
  }
  return rows;
}

/**
 * Art is the one art style: the art runs to the top edge, and a single foot
 * band carries the full author over two lines plus the label chips. The foot
 * is clipped away from the cover's printed base rather than overlaid. The
 * title runs down the art with adaptive ink and a hairline halo.
 */
export function drawArtSpine(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  const authorText = String(book.author || "").trim();
  const hasAuthor = Boolean(authorText);
  const labels = book.labels ?? [];
  const topH = 0;
  const bottomH =
    hasAuthor || labels.length > 0 ? Math.round(SPINE_H * 0.27) : 0;
  const artTop = topH;
  const artH = Math.max(1, SPINE_H - topH - bottomH);
  ctx.direction = book.direction;

  // The art is cropped to the middle window: it is drawn at the full spine
  // size and clipped, so the bands remove the top/bottom of the cover rather
  // than covering it with a translucent panel.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, artTop, SPINE_W, artH);
  ctx.clip();
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  ctx.restore();

  if (bottomH > 0) {
    const bandTop = SPINE_H - bottomH;
    const band = ctx.createLinearGradient(0, bandTop, 0, SPINE_H);
    band.addColorStop(0, WRAP_UMBER);
    band.addColorStop(1, WRAP_UMBER_DEEP);
    ctx.fillStyle = band;
    ctx.fillRect(0, bandTop, SPINE_W, bottomH);
    ctx.fillStyle = WRAP_GOLD;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(3, bandTop, SPINE_W - 6, 0.7);
    ctx.globalAlpha = 1;
  }

  spineEdges(ctx, SPINE_W, SPINE_H);

  const titleText = String(book.title || "Untitled").toUpperCase();
  const title = fitVertical(titleText, {
    family: SANS,
    weight: 600,
    track: 0.05,
    thick: Math.max(8, SPINE_W - 16),
    length: Math.max(20, artH - 14),
    maxSize: 9.4,
    minSize: 2.6,
  });
  const titleInk = guardInk(
    samplePixels(
      ctx,
      Math.max(0, (SPINE_W - title.thickness) / 2 - 2),
      artTop + 2,
      Math.min(SPINE_W, title.thickness + 4),
      Math.max(1, artH - 4),
    ),
  );
  drawVerticalRun(
    ctx,
    title,
    SPINE_W / 2,
    artTop + artH / 2,
    titleInk.ink,
    {
      family: SANS,
      weight: 600,
      track: 0.05,
      direction: book.direction,
      halo: {
        color: titleInk.halo,
        width: titleInk.usedHalo ? 1.5 : 1,
      },
    },
  );

  let author: SpineBlock | null = null;
  const chipTexts: string[] = [];
  if (bottomH > 0) {
    const bandTop = SPINE_H - bottomH;
    const chipH = 7;
    const chipGap = 2;
    const chipWidth = SPINE_W - 12;
    const chipRows = planLabelChips(labels, chipWidth);
    const chipsHeight =
      chipRows.length > 0
        ? chipRows.length * chipH + (chipRows.length - 1) * chipGap
        : 0;
    const authorFit = hasAuthor
      ? fitHorizontal(authorText.toUpperCase(), {
          width: SPINE_W - 8,
          maxSize: 6.8,
          minSize: 4.2,
          maxLines: 2,
          splitBelow: 8,
          family: SANS,
          weight: 600,
          track: 0.02,
        })
      : null;
    const authorHeight = authorFit
      ? authorFit.lines.length * authorFit.fs * 1.02
      : 0;
    const groupGap = authorHeight && chipsHeight ? 8 : 0;
    const groupHeight = authorHeight + groupGap + chipsHeight;
    let y = bandTop + Math.max(3, (bottomH - groupHeight) / 2);
    if (hasAuthor && authorFit) {
      ctx.save();
      drawHorizontal(ctx, authorFit, SPINE_W / 2, y, "#e8d6ae", {
        align: "center",
        gap: 1.02,
      });
      ctx.restore();
      const measured = Math.max(
        ...authorFit.lines.map(
          (line) => metrics(line, SANS, 600, 0.02).adv * authorFit.fs,
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
          6 + chip.x,
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
  }

  return {
    direction: book.direction,
    scrim: false,
    scrimAlpha: 0,
    contrast: titleInk.contrast,
    block: {
      x: SPINE_W / 2,
      y: artTop + artH / 2,
      width: title.thickness,
      height: title.length,
    },
    title: {
      x: SPINE_W / 2,
      y: artTop + artH / 2,
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
    bands: { top: topH, bottom: bottomH },
    labelChips: chipTexts,
  };
}
