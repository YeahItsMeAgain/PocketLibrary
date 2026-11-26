// Canvas compositor for the wrap. Everything is drawn in print pixels; the same
// code renders the on-screen canvas, the 3D panel crops and the 300 dpi export.

const INK_DARK = "#1b1713";
const INK_LIGHT = "#f5ead2";
const CREAM = "#f4ecdd";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function srgbToLin(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb) {
  return (
    0.2126 * srgbToLin(rgb[0]) +
    0.7152 * srgbToLin(rgb[1]) +
    0.0722 * srgbToLin(rgb[2])
  );
}

export function contrastRatio(a, b) {
  const l1 = Math.max(a, b);
  const l2 = Math.min(a, b);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function rgbToHex(rgb) {
  return (
    "#" +
    rgb
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Measure the left 12% edge of an image: mean colour, luminance, and the
 * row-mean luminance SD. This is the Stacks edge-strip measurement, done here
 * so the typographic fallback and the fallback warning are evidence-based.
 */
export function sampleImage(img) {
  const w = 128;
  const h = Math.max(8, Math.round((w * img.height) / img.width));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const edgeW = Math.max(1, Math.round(w * 0.12));

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const rowLum = [];
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < edgeW; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      rowSum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++;
    }
    rowLum.push(rowSum / edgeW);
  }
  r /= n;
  g /= n;
  b /= n;
  const meanRow = rowLum.reduce((s, v) => s + v, 0) / rowLum.length;
  const sd = Math.sqrt(
    rowLum.reduce((s, v) => s + (v - meanRow) ** 2, 0) / rowLum.length
  );
  const rgb = [r, g, b];
  const lum = relativeLuminance(rgb);
  const lumInk = relativeLuminance([27, 23, 19]);
  const lumCream = relativeLuminance([245, 234, 210]);
  return {
    rgb,
    hex: rgbToHex(rgb),
    lum,
    sd,
    contrastInk: contrastRatio(lum, lumInk),
    contrastCream: contrastRatio(lum, lumCream),
  };
}

function fontString(px, family = '"EB Garamond"') {
  return `${px}px ${family}`;
}

function applySpacing(ctx, px, em) {
  // Chromium supports canvas letterSpacing. If it does not, the property is
  // ignored and both measure and draw stay consistent.
  ctx.letterSpacing = `${em * px}px`;
}

function measureAt(ctx, text, px, spacingEm, family) {
  ctx.save();
  ctx.font = fontString(px, family);
  applySpacing(ctx, px, spacingEm);
  const m = ctx.measureText(text);
  const result = {
    width: m.width,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    across: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
  };
  ctx.restore();
  return result;
}

/**
 * Fit vertical type by measuring real font metrics.
 *
 * The spine is vertical, so the title runs along the spine height and the
 * glyph box (ascent + descent) must fit across the rail width. Both constraints
 * are measured; the smaller resulting point size wins. No guessed font size and
 * no silent clipping: if the measured result exceeds the box, ok is false.
 */
export function fitVerticalText(ctx, text, opts) {
  const {
    acrossPx,
    lengthPx,
    pxPerIn = 300,
    minPt = 7,
    maxPt = 30,
    spacingEm = 0.02,
    family = '"EB Garamond"',
  } = opts;
  const m = measureAt(ctx, text, 100, spacingEm, family);
  const widthPerPx = Math.max(0.0001, m.width / 100);
  const acrossPerPx = Math.max(0.0001, m.across / 100);

  const ptByAcross = ((acrossPx / acrossPerPx) * 72) / pxPerIn;
  const ptByLength = ((lengthPx / widthPerPx) * 72) / pxPerIn;
  const rawPt = Math.min(maxPt, ptByAcross, ptByLength);
  let pt = Math.max(minPt, rawPt);

  // measureText's advance is not perfectly linear with size, so the first
  // analytic fit can land a fraction of a pixel over. Shrink until the real
  // measurement is inside the box rather than accepting a 0.5 px fudge.
  let actual = measureAt(ctx, text, (pt / 72) * pxPerIn, spacingEm, family);
  for (let i = 0; i < 24; i++) {
    if (actual.width <= lengthPx - 0.25 && actual.across <= acrossPx - 0.25) break;
    if (pt <= minPt) break;
    pt = Math.max(minPt, pt * 0.985);
    actual = measureAt(ctx, text, (pt / 72) * pxPerIn, spacingEm, family);
  }
  const fontPx = (pt / 72) * pxPerIn;

  const length = actual.width;
  const across = actual.across;
  const lengthRatio = length / lengthPx;
  const acrossRatio = across / acrossPx;
  const ratio = Math.max(lengthRatio, acrossRatio);
  const ok =
    rawPt >= minPt - 0.01 &&
    length <= lengthPx + 0.01 &&
    across <= acrossPx + 0.01;

  return {
    text,
    pt,
    rawPt,
    fontPx,
    lengthPx: length,
    acrossPx: across,
    availableLengthPx: lengthPx,
    availableAcrossPx: acrossPx,
    lengthRatio,
    acrossRatio,
    ratio,
    ok,
    cappedAtMax: rawPt >= maxPt - 0.01,
    minPt,
    maxPt,
  };
}

export function analyzeWrap({ book, state, layout, samples, measureCtx, pxPerIn = 300 }) {
  const spinePx = layout.spineIn * pxPerIn;
  const trimHPx = layout.trimH * pxPerIn;

  const coverRailW = spinePx * 0.46;
  const coverPad = spinePx * 0.05;
  const typeW = spinePx * 0.78;
  const typePad = spinePx * 0.11;
  const titleLength = trimHPx * 0.54;
  const authorLength = trimHPx * 0.13;

  const coverText = book.title;
  const typeText = book.title.toUpperCase();

  const coverTitle = fitVerticalText(measureCtx, coverText, {
    acrossPx: coverRailW - coverPad * 2,
    lengthPx: titleLength,
    pxPerIn,
    minPt: 7,
    maxPt: 30,
    spacingEm: 0.015,
  });
  const coverAuthor = fitVerticalText(measureCtx, book.author.toUpperCase(), {
    acrossPx: coverRailW - coverPad * 2,
    lengthPx: authorLength,
    pxPerIn,
    minPt: 5.5,
    maxPt: 12,
    spacingEm: 0.12,
  });

  const typeTitle = fitVerticalText(measureCtx, typeText, {
    acrossPx: typeW - typePad * 2,
    lengthPx: titleLength,
    pxPerIn,
    minPt: 7,
    maxPt: 34,
    spacingEm: 0.03,
  });
  const typeAuthor = fitVerticalText(measureCtx, book.author.toUpperCase(), {
    acrossPx: typeW - typePad * 2,
    lengthPx: authorLength,
    pxPerIn,
    minPt: 5.5,
    maxPt: 13,
    spacingEm: 0.14,
  });

  // The 1-inch stress test is always run on the cover rail, regardless of the
  // current mode, because 1 inch is the width bookcover-js visibly clips at.
  const stressLayout = {
    ...layout,
    spineIn: 1,
  };
  const stressSpinePx = 1 * pxPerIn;
  const stressRailW = stressSpinePx * 0.46;
  const stressPad = stressSpinePx * 0.05;
  const stressTitle = fitVerticalText(measureCtx, coverText, {
    acrossPx: stressRailW - stressPad * 2,
    lengthPx: titleLength,
    pxPerIn,
    minPt: 7,
    maxPt: 30,
    spacingEm: 0.015,
  });
  const stressAuthor = fitVerticalText(measureCtx, book.author.toUpperCase(), {
    acrossPx: stressRailW - stressPad * 2,
    lengthPx: authorLength,
    pxPerIn,
    minPt: 5.5,
    maxPt: 12,
    spacingEm: 0.12,
  });

  const sourceSample =
    state.stripSource === "cover" ? samples.front : samples.art;
  const inkSample = sourceSample || samples.front;
  const lightRail = inkSample.lum > 0.52;
  const railStyle = lightRail
    ? {
        fill: "rgba(247, 241, 229, 0.9)",
        ink: INK_DARK,
        hairline: "rgba(27, 23, 19, 0.22)",
        inkLum: relativeLuminance([27, 23, 19]),
        contrast: contrastRatio(inkSample.lum, relativeLuminance([27, 23, 19])),
      }
    : {
        fill: "rgba(18, 15, 12, 0.7)",
        ink: INK_LIGHT,
        hairline: "rgba(245, 234, 210, 0.24)",
        inkLum: relativeLuminance([245, 234, 210]),
        contrast: contrastRatio(inkSample.lum, relativeLuminance([245, 234, 210])),
      };

  const coverOk = coverTitle.ok && coverAuthor.ok;
  let effectiveMode = state.mode;
  const decisions = [];
  if (effectiveMode === "cover" && !coverOk) {
    effectiveMode = "type";
    decisions.push(
      "Cover rail could not fit the title at 7 pt; switched to the typographic fallback."
    );
  }
  if (state.mode === "cover" && book.artVerdict === "review") {
    decisions.push(
      "The textless-art study rates this reconstruction review / fail; the cover-derived strip is mostly inpainted."
    );
  }
  if (state.mode === "cover" && book.removalPct >= 30 && book.artVerdict !== "review") {
    decisions.push(
      `Textless source is ${book.removalPct.toFixed(1)}% inpainted (textless-art verdict: pass), not original pixels.`
    );
  }
  if (state.mode === "type") {
    decisions.push(
      "Typographic fallback: edge colour + fitted type, no cover pixels on the spine."
    );
    if (samples.edge && samples.edge.sd < 8) {
      decisions.push(
        "Left edge is unusually flat (row-mean SD < 8), so the generated spine relies on type and binding colour rather than texture."
      );
    }
  }

  const fit = effectiveMode === "cover" ? coverTitle : typeTitle;
  const authorFit = effectiveMode === "cover" ? coverAuthor : typeAuthor;
  const usingRail = effectiveMode === "cover";

  return {
    spinePx,
    coverRailW,
    coverPad,
    typeW,
    typePad,
    railStyle,
    lightRail,
    effectiveMode,
    usingRail,
    fit,
    authorFit,
    coverFit: coverTitle,
    coverAuthorFit: coverAuthor,
    typeFit: typeTitle,
    typeAuthorFit: typeAuthor,
    stressTitle,
    stressAuthor,
    stressOk: stressTitle.ok && stressAuthor.ok,
    decisions,
    inkSample,
    sourceSample,
  };
}

function drawCover(ctx, img, dx, dy, dw, dh, { mirror = false } = {}) {
  if (!img) return false;
  const scale = Math.max(dw / img.width, dh / img.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.save();
  if (mirror) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  ctx.restore();
  return true;
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawVignette(ctx, x, y, w, h, color, strength = 0.35) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, color.replace("ALPHA", String(strength)));
  g.addColorStop(0.22, color.replace("ALPHA", "0"));
  g.addColorStop(0.78, color.replace("ALPHA", "0"));
  g.addColorStop(1, color.replace("ALPHA", String(strength)));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function drawBack(ctx, opts) {
  const { book, layout, images, samples, pxPerIn } = opts;
  const P = pxPerIn;
  const fold = layout.backFold * P;
  const totalH = layout.totalH * P;
  const bleed = layout.bleedIn * P;
  const trimW = layout.trimW * P;
  const trimH = layout.trimH * P;

  ctx.save();
  ctx.fillStyle = samples.edge ? samples.edge.hex : "#2b2119";
  ctx.fillRect(0, 0, fold, totalH);

  // Mirror the textless art so its left edge (the fold-side edge) meets the
  // spine strip. The back then belongs to the same wrap rather than a pasted
  // rectangle with a visible join.
  drawCover(ctx, images.art, 0, 0, fold, totalH, { mirror: true });
  ctx.fillStyle = "rgba(10, 8, 6, 0.52)";
  ctx.fillRect(0, 0, fold, totalH);
  const fade = ctx.createLinearGradient(0, 0, fold, 0);
  fade.addColorStop(0, "rgba(8, 7, 6, 0.5)");
  fade.addColorStop(0.55, "rgba(8, 7, 6, 0.1)");
  fade.addColorStop(1, "rgba(8, 7, 6, 0.32)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, fold, totalH);

  // A vellum card keeps the generated blurb readable without pretending to be
  // a scanned publisher back cover.
  const cardX = bleed + 0.55 * P;
  const cardY = bleed + 0.72 * P;
  const cardW = trimW - 1.1 * P;
  const cardH = trimH - 2.0 * P;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.32)";
  ctx.shadowBlur = 0.14 * P;
  ctx.shadowOffsetY = 0.035 * P;
  ctx.fillStyle = "rgba(244, 236, 221, 0.94)";
  ctx.beginPath();
  const r = 0.045 * P;
  ctx.roundRect(cardX, cardY, cardW, cardH, r);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(27, 23, 19, 0.20)";
  ctx.lineWidth = Math.max(1, 0.006 * P);
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, r);
  ctx.stroke();

  // A very faint watermark of the fold-side art keeps the card from reading as
  // an empty rectangle without pretending to be printed publisher texture.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, r);
  ctx.clip();
  ctx.globalAlpha = 0.055;
  drawCover(
    ctx,
    images.art,
    cardX,
    cardY,
    cardW,
    cardH,
    { mirror: false }
  );
  ctx.restore();

  const pad = 0.34 * P;
  const textX = cardX + pad;
  const textW = cardW - pad * 2;
  let y = cardY + 0.36 * P;

  ctx.fillStyle = "#6b5b48";
  ctx.font = fontString(0.095 * P, '"Literata"');
  applySpacing(ctx, 0.095 * P, 0.18);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("POCKETLIBRARY WRAP STUDY · NOT PUBLISHER ART", textX, y);

  y += 0.24 * P;
  ctx.fillStyle = INK_DARK;
  ctx.font = fontString(0.25 * P, '"EB Garamond"');
  applySpacing(ctx, 0.25 * P, 0.01);
  ctx.textBaseline = "top";
  ctx.fillText(book.title, textX, y);

  y += 0.36 * P;
  ctx.fillStyle = "#6b5b48";
  ctx.font = fontString(0.095 * P, '"Literata"');
  applySpacing(ctx, 0.095 * P, 0.1);
  ctx.fillText(book.genre.toUpperCase(), textX, y);

  y += 0.24 * P;
  ctx.strokeStyle = "rgba(27, 23, 19, 0.28)";
  ctx.lineWidth = Math.max(1, 0.006 * P);
  ctx.beginPath();
  ctx.moveTo(textX, y);
  ctx.lineTo(textX + textW, y);
  ctx.stroke();

  y += 0.26 * P;
  const bodyPx = 0.132 * P;
  const leading = bodyPx * 1.52;
  const bodyBottom = cardY + cardH - 1.35 * P;
  const paragraphs = [book.blurb, book.blurb2].filter(Boolean);
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const lines = wrapLines(ctx, paragraphs[pi], textW);
    for (const line of lines) {
      if (y + leading > bodyBottom) break;
      ctx.font = fontString(bodyPx, '"Literata"');
      applySpacing(ctx, bodyPx, 0);
      ctx.fillStyle = "#2a241d";
      ctx.textBaseline = "top";
      ctx.fillText(line, textX, y);
      y += leading;
    }
    if (pi < paragraphs.length - 1) y += 0.13 * P;
  }

  // A small rule-and-diamond mark, drawn rather than typed, closes the copy.
  if (y < bodyBottom - 0.25 * P) {
    const markY = Math.min(bodyBottom, y + 0.22 * P);
    ctx.strokeStyle = "rgba(27, 23, 19, 0.24)";
    ctx.lineWidth = Math.max(1, 0.005 * P);
    ctx.beginPath();
    ctx.moveTo(textX + textW * 0.5 - 0.38 * P, markY);
    ctx.lineTo(textX + textW * 0.5 - 0.1 * P, markY);
    ctx.moveTo(textX + textW * 0.5 + 0.1 * P, markY);
    ctx.lineTo(textX + textW * 0.5 + 0.38 * P, markY);
    ctx.stroke();
    ctx.save();
    ctx.translate(textX + textW * 0.5, markY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "rgba(174, 58, 43, 0.7)";
    ctx.fillRect(-0.035 * P, -0.035 * P, 0.07 * P, 0.07 * P);
    ctx.restore();
  }

  const notePx = 0.078 * P;
  ctx.font = `italic ${notePx}px "Literata"`;
  applySpacing(ctx, notePx, 0.01);
  ctx.fillStyle = "#6b5b48";
  ctx.textBaseline = "top";
  const note = wrapLines(
    ctx,
    "Generated for a wrap study: this back panel is composed from the textless art, not a publisher back cover. The ISBN and barcode are placeholders.",
    textW
  );
  let noteY = cardY + cardH - 1.05 * P;
  for (const line of note.slice(0, 2)) {
    ctx.fillText(line, textX, noteY);
    noteY += notePx * 1.4;
  }

  const authorY = cardY + cardH - 0.42 * P;
  ctx.fillStyle = INK_DARK;
  ctx.font = fontString(0.108 * P, '"Literata"');
  applySpacing(ctx, 0.108 * P, 0.12);
  ctx.fillText(book.author.toUpperCase(), textX, authorY);

  // Barcode, drawn from the ISBN digits so it is deterministic and obviously
  // a placeholder rather than a scannable retail barcode.
  const bcW = 1.18 * P;
  const bcH = 0.72 * P;
  const bcX = bleed + trimW - 0.44 * P - bcW;
  const bcY = bleed + trimH - 0.42 * P - bcH;
  ctx.fillStyle = "#fbf7ee";
  ctx.fillRect(bcX, bcY, bcW, bcH);
  ctx.strokeStyle = "rgba(27,23,19,0.3)";
  ctx.lineWidth = Math.max(1, 0.004 * P);
  ctx.strokeRect(bcX, bcY, bcW, bcH);
  const digits = book.isbn.replace(/\D/g, "").padEnd(13, "0").slice(0, 13);
  let bx = bcX + 0.07 * P;
  const barTop = bcY + 0.07 * P;
  const barH = bcH - 0.25 * P;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    for (let k = 0; k < 4; k++) {
      const wBar = ((d + k) % 3 === 0 ? 0.022 : 0.011) * P;
      if ((d + k) % 2 === 0) {
        ctx.fillStyle = INK_DARK;
        ctx.fillRect(bx, barTop, wBar, barH);
      }
      bx += wBar + 0.007 * P;
    }
  }
  ctx.fillStyle = "#3a332b";
  ctx.font = fontString(0.07 * P, '"Literata"');
  applySpacing(ctx, 0.07 * P, 0.04);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`ISBN ${book.isbn} · PROTOTYPE`, bcX + bcW / 2, bcY + bcH - 0.13 * P);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(245,234,210,0.72)";
  ctx.font = fontString(0.088 * P, '"Literata"');
  applySpacing(ctx, 0.088 * P, 0.12);
  ctx.fillText("PL", bleed + 0.3 * P, bleed + trimH - 0.42 * P);

  ctx.restore();
}

function drawFront(ctx, opts) {
  const { layout, images, pxPerIn } = opts;
  const P = pxPerIn;
  const x = layout.frontFold * P - 1;
  const w = (layout.totalW - layout.frontFold) * P + 1;
  drawCover(ctx, images.front, x, 0, w, layout.totalH * P);
}

function drawSpineArt(ctx, opts) {
  const { state, layout, images, pxPerIn, analysis } = opts;
  const P = pxPerIn;
  const x = layout.spineX * P - 1;
  const w = layout.spineIn * P + 2;
  const h = layout.totalH * P;
  const img = state.stripSource === "cover" ? images.front : images.art;
  const stripW = Math.min(
    img.width,
    Math.max(24, img.width * (layout.spineIn / layout.trimW))
  );
  const sx = Math.min(
    img.width - stripW,
    Math.max(0, img.width * opts.book.stripX)
  );
  ctx.drawImage(img, sx, 0, stripW, img.height, x, 0, w, h);

  // Fold-side shading is inside the spine only. It reads as a rounded fold,
  // not a gap between panels.
  drawVignette(ctx, x, 0, w, h, "rgba(0,0,0,ALPHA)", 0.28);

  if (analysis.usingRail) {
    const railW = layout.spineIn * 0.46 * P;
    const railX =
      opts.book.railSide === "left" ? x : x + w - railW;
    ctx.fillStyle = analysis.railStyle.fill;
    ctx.fillRect(railX, 0, railW, h);
    ctx.fillStyle = analysis.railStyle.hairline;
    ctx.fillRect(
      opts.book.railSide === "left" ? railX + railW - 1 : railX,
      0,
      1.5,
      h
    );
    // A short rule at the head and tail of the rail.
    ctx.fillRect(railX + railW * 0.28, 0.16 * P, railW * 0.44, 0.012 * P);
    ctx.fillRect(
      railX + railW * 0.28,
      h - 0.18 * P,
      railW * 0.44,
      0.012 * P
    );
  }
  return { x, w, h };
}

function drawSpineType(ctx, opts, spineBox) {
  const { book, layout, analysis, pxPerIn } = opts;
  const P = pxPerIn;
  const spineW = layout.spineIn * P;
  const usingRail = analysis.usingRail;
  const railW = usingRail ? spineW * 0.46 : spineW * 0.78;
  const railX = usingRail
    ? book.railSide === "left"
      ? spineBox.x
      : spineBox.x + spineBox.w - railW
    : spineBox.x + (spineBox.w - railW) / 2;
  const cx = railX + railW / 2;
  const ink = analysis.railStyle.ink;
  const titleFit = analysis.fit;
  const authorFit = analysis.authorFit;
  const titleFontPx = (titleFit.pt / 72) * P;
  const authorFontPx = (authorFit.pt / 72) * P;
  const titleCy = (layout.bleedIn + layout.trimH * 0.4) * P;
  const authorCy = (layout.bleedIn + layout.trimH * 0.865) * P;

  // Tiny publisher colophon at the head of the rail.
  ctx.save();
  ctx.translate(cx, (layout.bleedIn + layout.trimH * 0.115) * P);
  ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, 0.009 * P);
  const s = 0.05 * P;
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();

  const drawVertical = (text, cy, fontPx, spacingEm, alpha = 1) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 2);
    ctx.font = fontString(fontPx, '"EB Garamond"');
    applySpacing(ctx, fontPx, spacingEm);
    ctx.fillStyle = ink;
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  drawVertical(titleFit.text, titleCy, titleFontPx, usingRail ? 0.015 : 0.03);
  drawVertical(
    book.author.toUpperCase(),
    authorCy,
    authorFontPx,
    0.12,
    0.92
  );

  if (usingRail) {
    // Thin rule between title and author.
    ctx.save();
    ctx.translate(cx, (layout.bleedIn + layout.trimH * 0.745) * P);
    ctx.rotate(Math.PI / 2);
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(1, 0.008 * P);
    ctx.beginPath();
    ctx.moveTo(-0.16 * P, 0);
    ctx.lineTo(0.16 * P, 0);
    ctx.stroke();
    ctx.restore();
  }
}

function drawTypographic(ctx, opts) {
  const { book, layout, images, samples, pxPerIn, analysis } = opts;
  const P = pxPerIn;
  const x = layout.spineX * P - 1;
  const w = layout.spineIn * P + 2;
  const h = layout.totalH * P;
  const base = samples.edge || { hex: "#2b2119", lum: 0.16 };

  ctx.fillStyle = base.hex;
  ctx.fillRect(x, 0, w, h);

  // Pattern: the fold-adjacent art strip, blurred hard and laid over the solid
  // edge colour. It is a colour/texture cue, not cover pixels pretending to be
  // a spine image.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, 0, w, h);
  ctx.clip();
  ctx.globalAlpha = 0.3;
  ctx.filter = `blur(${Math.max(1, 0.03 * P)}px)`;
  const img = images.art || images.front;
  if (img) {
    const stripW = Math.min(img.width, img.width * (layout.spineIn / layout.trimW));
    ctx.drawImage(
      img,
      Math.max(0, img.width * book.stripX),
      0,
      stripW,
      img.height,
      x - w * 0.1,
      0,
      w * 1.2,
      h
    );
  }
  ctx.restore();

  drawVignette(ctx, x, 0, w, h, "rgba(0,0,0,ALPHA)", 0.24);

  // A faint horizontal weave, deterministic rather than random so screenshots
  // stay stable.
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = analysis.railStyle.ink;
  ctx.lineWidth = 1;
  for (let yy = 0.2 * P; yy < h; yy += 0.085 * P) {
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  ctx.restore();

  drawSpineType(ctx, opts, { x, w, h });
}

function drawGuides(ctx, opts) {
  const { layout, pxPerIn } = opts;
  const P = pxPerIn;
  const lw = Math.max(1, 0.008 * P);
  ctx.save();
  ctx.lineWidth = lw;

  // Trim outline.
  ctx.strokeStyle = "rgba(255, 241, 196, 0.92)";
  ctx.setLineDash([0.09 * P, 0.055 * P]);
  ctx.strokeRect(
    layout.bleedIn * P,
    layout.bleedIn * P,
    (layout.totalW - layout.bleedIn * 2) * P,
    (layout.totalH - layout.bleedIn * 2) * P
  );

  // Folds.
  ctx.strokeStyle = "rgba(255, 104, 76, 0.96)";
  ctx.setLineDash([0.14 * P, 0.05 * P]);
  for (const fx of [layout.backFold, layout.frontFold]) {
    ctx.beginPath();
    ctx.moveTo(fx * P, 0);
    ctx.lineTo(fx * P, layout.totalH * P);
    ctx.stroke();
  }

  // Outer bleed edge.
  ctx.strokeStyle = "rgba(121, 206, 255, 0.9)";
  ctx.setLineDash([0.04 * P, 0.04 * P]);
  ctx.strokeRect(
    lw / 2,
    lw / 2,
    layout.totalW * P - lw,
    layout.totalH * P - lw
  );

  // Labels in a sans face so they do not get mistaken for book typography.
  const fs = 0.088 * P;
  ctx.font = `${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const label = (text, x, y) => {
    const pad = 0.035 * P;
    const tw = ctx.measureText(text).width + pad * 2;
    ctx.fillStyle = "rgba(12, 10, 8, 0.72)";
    ctx.fillRect(x, y, tw, fs * 1.55);
    ctx.fillStyle = "#fbf5e6";
    ctx.fillText(text, x + pad, y + fs * 0.18);
  };
  label("BACK", layout.bleedIn * P + 0.16 * P, layout.bleedIn * P + 0.16 * P);
  label(
    "SPINE",
    layout.spineX * P + Math.max(0.06 * P, (layout.spineIn * P) / 2 - 0.32 * P),
    layout.bleedIn * P + 0.16 * P
  );
  label(
    "FRONT",
    layout.frontFold * P + 0.16 * P,
    layout.bleedIn * P + 0.16 * P
  );
  label(
    `BLEED ${layout.bleedIn} in`,
    0.14 * P,
    (layout.totalH - 0.24 * P)
  );
  ctx.restore();
}

export function renderWrap(canvas, opts) {
  const { layout, pxPerIn, analysis, state } = opts;
  canvas.width = Math.max(2, Math.round(layout.totalW * pxPerIn));
  canvas.height = Math.max(2, Math.round(layout.totalH * pxPerIn));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw order matters: the spine is painted last so its 1 px overlap covers
  // the fold seam on both sides.
  drawBack(ctx, opts);
  drawFront(ctx, opts);
  const spineBox = drawSpineArt(ctx, opts);
  if (analysis.effectiveMode === "type") {
    drawTypographic(ctx, opts);
  } else {
    drawSpineType(ctx, opts, spineBox);
  }
  if (opts.guides) drawGuides(ctx, opts);

  return {
    width: canvas.width,
    height: canvas.height,
    mode: analysis.effectiveMode,
    fit: analysis.fit,
    stressOk: analysis.stressOk,
  };
}

export function renderCrop(canvas, { source, pxPerIn, box }) {
  canvas.width = Math.max(2, Math.round(box.w * pxPerIn));
  canvas.height = Math.max(2, Math.round(box.h * pxPerIn));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    Math.round(box.x * pxPerIn),
    Math.round(box.y * pxPerIn),
    Math.round(box.w * pxPerIn),
    Math.round(box.h * pxPerIn),
    0,
    0,
    canvas.width,
    canvas.height
  );
}

export function renderPanel(canvas, opts, panel) {  // Render one trim panel from a freshly composed wrap. Used by the 3D mock
  // and the v4 side of the compare strip.
  const { layout, pxPerIn } = opts;
  let x = 0;
  let y = layout.bleedIn;
  let w = layout.trimW;
  let h = layout.trimH;
  if (panel === "back") x = layout.backTrimX;
  if (panel === "front") x = layout.frontFold;
  if (panel === "spine") {
    x = layout.spineX;
    w = layout.spineIn;
  }

  canvas.width = Math.max(2, Math.round(w * pxPerIn));
  canvas.height = Math.max(2, Math.round(h * pxPerIn));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    opts.source,
    Math.round(x * pxPerIn),
    Math.round(y * pxPerIn),
    Math.round(w * pxPerIn),
    Math.round(h * pxPerIn),
    0,
    0,
    canvas.width,
    canvas.height
  );
}

export function formatContrast(analysis) {
  return `${analysis.railStyle.contrast.toFixed(1)}:1`;
}
