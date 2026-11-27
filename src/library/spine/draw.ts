/**
 * Shared canvas primitives used by every spine style: art placement, the edge
 * shading, grain, the vignette and the provenance mark.
 */

import type { RenderBook } from "./geometry";
import { artCropRect, paletteFor } from "./geometry";

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

export function drawArt(
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

/* ------------------------------------------------ common furniture ---- */

export function spineEdges(
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

export function grain(
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

export function drawProvenance(
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

export function vignette(
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
