/**
 * The three spine styles: Wrap (a full case with front, spine and back),
 * Full-bleed (the crop edge to edge) and Cloth (a sampled cloth with foil
 * type). Each returns the measured type meta for the canvas data attributes.
 */

import type { RenderBook } from "./geometry";
import {
  contrast,
  luminance,
  mix,
  paletteFor,
  panelCrop,
  SPINE_H,
  SPINE_W,
  spineScrimRect,
  wrapGeometry,
} from "./geometry";
import {
  drawArt,
  drawProvenance,
  grain,
  spineEdges,
  vignette,
} from "./draw";
import {
  drawHorizontal,
  drawSpineType,
  drawVertical,
  fitHorizontal,
  fitVertical,
  metrics,
  SANS,
  SERIF,
  setTracking,
  type RenderMeta,
} from "./text";

function provenance(book: RenderBook): "original" | "reconstructed" | "fallback" {
  if (book.verdict === "fallback") return "fallback";
  if (book.route === "inpaint") return "reconstructed";
  return "original";
}

/**
 * Paint the smoked type window before the type so the contrast guard samples
 * the real backdrop. Wrap gets a hard inset label with a cream hairline;
 * Full-bleed gets a softer, narrower scrim that leaves the art visible at both
 * edges. The type itself stays centred on the spine in both styles.
 */
export function drawSpineWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  style: "wrap" | "full-bleed",
) {
  const rect = spineScrimRect(style, width);
  ctx.save();
  if (style === "wrap") {
    ctx.fillStyle = "rgba(8,6,4,0.78)";
    ctx.fillRect(x + rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = "rgba(240,226,196,0.22)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(
      x + rect.x + 0.3,
      rect.y + 0.3,
      rect.width - 0.6,
      rect.height - 0.6,
    );
    ctx.fillStyle = "rgba(240,226,196,0.16)";
    ctx.fillRect(x + rect.x + 2.5, rect.y + 3.5, rect.width - 5, 0.6);
  } else {
    const gradient = ctx.createLinearGradient(
      x + rect.x,
      0,
      x + rect.x + rect.width,
      0,
    );
    gradient.addColorStop(0, "rgba(8,6,4,0)");
    gradient.addColorStop(0.16, "rgba(8,6,4,0.84)");
    gradient.addColorStop(0.84, "rgba(8,6,4,0.84)");
    gradient.addColorStop(1, "rgba(8,6,4,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + rect.x, rect.y, rect.width, rect.height);
  }
  ctx.restore();
}

export function drawFullBleed(
  ctx: CanvasRenderingContext2D,
  book: RenderBook,
): RenderMeta {
  drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
  vignette(ctx, SPINE_W, SPINE_H);
  spineEdges(ctx, SPINE_W, SPINE_H);
  ctx.direction = book.direction;
  drawSpineWindow(ctx, 0, SPINE_W, "full-bleed");
  const meta = drawSpineType(ctx, book, SPINE_W, 0, "full-bleed");
  grain(ctx, SPINE_W, SPINE_H, 0.03);
  return { ...meta, scrim: true, scrimAlpha: 0.84 };
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
    foilDim,
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
    scrimAlpha: 0,
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

export function drawWrap(
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

  // A framed, inset title window: the art still shows around its edges, but
  // the type never sits on raw cover copy. Full-bleed deliberately does not do
  // this, so the two styles read as different treatments.
  drawSpineWindow(ctx, spineX, geometry.spineW, "wrap");
  const typeMeta = drawSpineType(
    ctx,
    book,
    geometry.spineW,
    spineX,
    "wrap",
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
    ...typeMeta,
    scrim: true,
    scrimAlpha: 0.78,
    // The reported block is local to the spine; keep the case offset out of
    // the geometry so Wrap and Full-bleed are directly comparable.
    block: typeMeta.block,
    title: typeMeta.title,
    author: typeMeta.author,
    colophon: typeMeta.colophon,
  };
}
