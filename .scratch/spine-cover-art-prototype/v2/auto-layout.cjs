// Deterministic automatic spine-layout pass for the two new-arrival covers.
// Run from the repo root:
//   node .scratch/spine-cover-art-prototype/v2/auto-layout.cjs
//
// The script reads the local high-resolution cover, analyses a 260 px working
// copy through ffmpeg, and writes auto-layout.json. It is deliberately
// heuristic and inspectable — not a learned model.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "auto-layout.json");

const INPUTS = [
  {
    slug: "whisper-man",
    title: "The Whisper Man",
    author: "Alex North",
    spine: { w: 52, h: 236 },
    cover: "covers/source/whisper-man.jpg",
    isbn: "9781405936019",
    edition: "Penguin Books UK, 2019",
    source: "Apple Books/iTunes Search API (GB)",
    coverPage: "https://books.apple.com/gb/book/the-whisper-man/id1404088650",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/dd/15/e4/dd15e43d-c935-de16-65f7-9b20558774bf/9781405936019.jpg/2000x2000bb.jpg",
    credit: "Cover design: Penguin Books; cover image as published by Apple Books"
  },
  {
    slug: "rock-paper-scissors",
    title: "Rock Paper Scissors",
    author: "Alice Feeney",
    spine: { w: 52, h: 236 },
    cover: "covers/source/rock-paper-scissors.jpg",
    isbn: "9781250266118",
    edition: "Flatiron Books US, 2021",
    source: "Apple Books/iTunes Search API (US)",
    coverPage: "https://books.apple.com/us/book/rock-paper-scissors/id1550616355",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/b7/dd/3c/b7dd3ca0-ca75-afd1-66a4-1da048aa42ff/9781250266118.jpg/2000x2000bb.jpg",
    credit: "Cover design: Flatiron Books; cover image as published by Apple Books"
  }
];

const WORK_WIDTH = 260;
const BAND_HEIGHTS = [0.18, 0.20, 0.22, 0.24, 0.26, 0.28, 0.30];
const CREAM = [244, 231, 203];
const INK = [11, 8, 6];
const VELLUM = [247, 238, 219];
const DARK_INK = [36, 24, 15];

function ffprobe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    file
  ], { encoding: "utf8" });
  const stream = JSON.parse(out).streams[0];
  return { width: stream.width, height: stream.height };
}

function decode(file) {
  const raw = execFileSync("ffmpeg", [
    "-v", "error",
    "-i", file,
    "-vf", `scale=${WORK_WIDTH}:-2:flags=area`,
    "-frames:v", "1",
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-"
  ], { maxBuffer: 64 * 1024 * 1024 });
  const width = WORK_WIDTH;
  const height = Math.round(raw.length / (width * 3));
  return { width, height, raw };
}

function srgbToLinear(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function relLum(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
function hex(rgb) {
  return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function titleSize(title) {
  const n = title.length;
  if (n > 26) return 10.3;
  if (n > 21) return 10.9;
  if (n > 18) return 11.5;
  if (n > 14) return 12.1;
  if (n > 10) return 12.8;
  return 13.5;
}
function titleColumns(title) {
  return title.length > 22 ? 2 : 1;
}
function percentile(values, p) {
  const arr = Array.from(values).sort((a, b) => a - b);
  return arr[Math.floor(clamp(p, 0, 1) * (arr.length - 1))];
}

function analyse(input) {
  const src = ffprobe(path.join(ROOT, input.cover));
  const { width: W, height: H, raw } = decode(path.join(ROOT, input.cover));
  const N = W * H;
  const r = new Float32Array(N);
  const g = new Float32Array(N);
  const b = new Float32Array(N);
  const L = new Float32Array(N);
  const sat = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const rr = raw[i * 3], gg = raw[i * 3 + 1], bb = raw[i * 3 + 2];
    r[i] = rr; g[i] = gg; b[i] = bb;
    L[i] = relLum(rr, gg, bb);
    const mx = Math.max(rr, gg, bb);
    const mn = Math.min(rr, gg, bb);
    sat[i] = mx === 0 ? 0 : (mx - mn) / mx;
  }

  // Sobel edge magnitude on relative luminance.
  const E = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const tl = L[i - W - 1], tc = L[i - W], tr = L[i - W + 1];
      const ml = L[i - 1], mr = L[i + 1];
      const bl = L[i + W - 1], bc = L[i + W], br = L[i + W + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      E[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  const edgeP = percentile(E, 0.90);
  const edgeCut = Math.max(0.24, edgeP * 0.80);

  // A pixel is "textish" when it sits on a strong edge. The row pass below
  // requires a wide horizontal extent before calling it typography.
  const textish = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (E[i] > edgeCut) textish[i] = 1;
  }

  const rowCoverage = new Float32Array(H);
  const rowExtent = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let count = 0, minX = W, maxX = -1;
    for (let x = 0; x < W; x++) {
      if (textish[y * W + x]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    rowCoverage[y] = count / W;
    rowExtent[y] = maxX < 0 ? 0 : (maxX - minX + 1) / W;
  }

  // Typography rows: enough edge pixels, and spread across at least 45% of
  // the width. That is what separates a title line from a local object.
  const isTextRow = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    if (rowCoverage[y] > 0.05 && rowExtent[y] > 0.50) isTextRow[y] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const copy = Uint8Array.from(isTextRow);
    for (let y = 1; y < H - 1; y++) {
      if (copy[y - 1] && copy[y + 1]) isTextRow[y] = 1;
    }
  }

  const bands = [];
  for (let y = 0; y < H; y++) {
    if (!isTextRow[y]) continue;
    let end = y;
    while (end + 1 < H && isTextRow[end + 1]) end++;
    if (end - y >= 2) {
      let density = 0;
      for (let yy = y; yy <= end; yy++) density += rowCoverage[yy];
      density /= (end - y + 1);
      bands.push({ top: y / H, bottom: (end + 1) / H, density });
    }
    y = end;
  }

  // Merge bands separated by less than 1.5% of the image height.
  const merged = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.top - last.bottom < 0.015) {
      last.bottom = band.bottom;
      last.density = Math.max(last.density, band.density);
    } else {
      merged.push({ ...band });
    }
  }

  // Top cap: cover the top marketing lines if they can be hidden without
  // cutting a line in half. It doubles as the "new arrival / auto" marker.
  const topBands = merged.filter((band) => band.top < 0.20);
  const capCandidates = [0.07, ...topBands.map((band) => band.bottom + 0.008), 0.10, 0.12, 0.14, 0.16]
    .map((v) => Math.min(0.16, Math.max(0.07, v)))
    .sort((a, b) => a - b);
  let topCap = 0.07;
  let topCapCovered = 0;
  for (const cap of capCandidates) {
    const straddles = topBands.some((band) => band.top < cap - 0.002 && band.bottom > cap + 0.002);
    if (straddles) continue;
    const covered = topBands.filter((band) => band.bottom <= cap + 0.002).length;
    if (covered > topCapCovered || (covered === topCapCovered && cap < topCap)) {
      topCap = cap;
      topCapCovered = covered;
    }
  }
  const topCapNote = topCapCovered === 0
    ? "no clean top band; a minimal AUTO strip is used"
    : "covers " + topCapCovered + " top marketing line" + (topCapCovered === 1 ? "" : "s") + " without cutting one";

  const aspect = src.width / src.height;
  const spineAspect = input.spine.w / input.spine.h;
  const cropFraction = spineAspect / aspect;
  const halfCrop = cropFraction / 2;
  const candidates = [];
  for (let i = 0; i <= 64; i++) {
    const focus = 0.18 + (0.64 * i) / 64;
    if (focus - halfCrop < 0 || focus + halfCrop > 1) continue;
    candidates.push(focus);
  }

  function metricsFor(focus, bandHeight) {
    const left = Math.max(0, Math.floor((focus - halfCrop) * W));
    const right = Math.min(W - 1, Math.ceil((focus + halfCrop) * W));
    const bandTop = 1 - bandHeight;
    const bandRow = Math.floor(bandTop * H);
    const visibleTop = Math.floor(topCap * H);
    let edgeSum = 0, satSum = 0, count = 0;
    let titleText = 0, titlePixels = 0, marketingText = 0, marketingPixels = 0;
    // The "title block" is the bottom half of the cover's typography. The
    // top half is usually marketing copy; it is reported separately because
    // no foot band can remove it without destroying the art.
    const titleBands = merged.filter((band) => band.bottom > 0.55);
    const marketingBands = merged.filter((band) => band.bottom <= 0.55);
    for (let y = visibleTop; y < bandRow; y++) {
      for (let x = left; x <= right; x++) {
        const i = y * W + x;
        edgeSum += E[i];
        satSum += sat[i];
        count++;
        if (isTextRow[y]) {
          const inTitle = titleBands.some((band) => y / H >= band.top && y / H <= band.bottom);
          const inMarketing = marketingBands.some((band) => y / H >= band.top && y / H <= band.bottom);
          if (inTitle) {
            titlePixels++;
            if (textish[i]) titleText++;
          } else if (inMarketing) {
            marketingPixels++;
            if (textish[i]) marketingText++;
          }
        }
      }
    }
    const totalTitleDensity = titleBands.reduce((sum, band) => sum + band.density, 0) || 1;
    const coveredDensity = titleBands.reduce((sum, band) => sum + (band.top >= bandTop - 0.005 ? band.density : 0), 0);
    const titleCoverage = coveredDensity / totalTitleDensity;
    const titleCollision = titlePixels > 0 ? titleText / titlePixels : 0;
    const marketingCollision = marketingPixels > 0 ? marketingText / marketingPixels : 0;
    let cutPenalty = 0;
    for (const band of titleBands) {
      if (bandTop > band.top + 0.01 && bandTop < band.bottom - 0.01) {
        cutPenalty += 1;
      }
    }
    const detail = edgeSum / Math.max(1, count);
    const color = satSum / Math.max(1, count);
    const centerBias = 1 - Math.abs(focus - 0.5) * 0.8;
    const bandPenalty = Math.abs(bandHeight - 0.22) * 0.35;
    const score = 1.0 * detail + 0.10 * color + 0.30 * centerBias
      - 3.6 * titleCollision - 1.0 * marketingCollision
      - 0.45 * cutPenalty + 0.55 * titleCoverage - bandPenalty;
    return {
      left, right, bandTop, detail, color, titleCollision, marketingCollision,
      titleCoverage, cutPenalty, score, edgeMean: edgeSum / Math.max(1, count)
    };
  }

  let best = null;
  const scoresByBand = {};
  for (const bandHeight of BAND_HEIGHTS) {
    const row = [];
    for (const focus of candidates) {
      const m = metricsFor(focus, bandHeight);
      row.push({ focus, ...m });
      if (!best || m.score > best.m.score) {
        best = { focus, bandHeight, m };
      }
    }
    scoresByBand[bandHeight] = row;
  }

  const chosen = best;
  const bandTop = chosen.m.bandTop;
  const bandRow = Math.floor(bandTop * H);
  const left = chosen.m.left;
  const right = chosen.m.right;

  // Sample the visible crop above the band for colour, luminance and texture.
  let lumaSum = 0, count = 0, rr = 0, gg = 0, bb = 0, texture = 0;
  let leftLum = 0, rightLum = 0, leftLumCount = 0, rightLumCount = 0;
  const lumSamples = [];
  const colTexture = new Float32Array(right - left + 1);
  const midColumn = Math.floor((right - left) / 2);
  for (let y = 0; y < bandRow; y++) {
    for (let x = left; x <= right; x++) {
      const i = y * W + x;
      lumaSum += L[i];
      lumSamples.push(L[i]);
      rr += r[i]; gg += g[i]; bb += b[i];
      texture += E[i] * E[i];
      colTexture[x - left] += E[i];
      if (x - left < midColumn) {
        leftLum += Math.abs(L[i] - 0.5);
        leftLumCount++;
      } else {
        rightLum += Math.abs(L[i] - 0.5);
        rightLumCount++;
      }
      count++;
    }
  }
  const meanLuma = lumaSum / Math.max(1, count);
  const p05 = percentile(lumSamples, 0.05);
  const p95 = percentile(lumSamples, 0.95);
  const std = Math.sqrt(texture / Math.max(1, count));
  const avg = [rr / count, gg / count, bb / count];

  const creamL = relLum(...CREAM);
  const inkL = relLum(...INK);
  const vellumL = relLum(...VELLUM);
  const darkInkL = relLum(...DARK_INK);
  const bareCream = contrast(creamL, p95);
  const bareDark = contrast(darkInkL, p05);

  // Dark ink on vellum is the fallback when the cover is too light for cream.
  const tone = (meanLuma > 0.38 && bareDark > bareCream) ? "light" : "dark";
  const railAlpha = tone === "light" ? 0.97 : 0.94;
  const railBase = tone === "light" ? vellumL : inkL;
  const railL = railAlpha * railBase + (1 - railAlpha) * (tone === "light" ? p05 : p95);
  const railContrast = tone === "light"
    ? contrast(railL, darkInkL)
    : contrast(railL, creamL);

  // Rail geometry: just enough for the title's type columns, plus a safety
  // pad when the sampled bare contrast is weak or the crop is busy.
  const columns = titleColumns(input.title);
  const fs = titleSize(input.title);
  let railWidth = columns * fs * 1.09 + (columns === 1 ? 7 : 9);
  if (tone === "light") railWidth += 3;
  if (bareCream < 4.5) railWidth += 2;
  if (std > 0.22) railWidth += 1;
  railWidth = Math.round(clamp(railWidth, 18, input.spine.w * 0.78));

  // Shift the rail a little toward the calmer half of the crop. "Calmer"
  // combines the edge profile with the luminance deviation from mid-grey, so
  // the placement is derived from both texture and tone.
  const mid = Math.floor(colTexture.length / 2);
  let leftTex = 0, rightTex = 0;
  for (let i = 0; i < mid; i++) leftTex += colTexture[i];
  for (let i = mid; i < colTexture.length; i++) rightTex += colTexture[i];
  const leftScore = (leftTex / Math.max(1, mid)) + (leftLum / Math.max(1, leftLumCount)) * 0.45;
  const rightScore = (rightTex / Math.max(1, colTexture.length - mid)) + (rightLum / Math.max(1, rightLumCount)) * 0.45;
  const railShift = Math.round(clamp(((leftScore - rightScore) / (leftScore + rightScore + 1e-6)) * 4, -2.5, 2.5) * 2) / 2;

  const titleCollision = chosen.m.titleCollision;
  const marketingCollision = chosen.m.marketingCollision;
  const titleCoverage = chosen.m.titleCoverage;
  const review = titleCollision > 0.02 || (merged.length > 0 && titleCoverage < 0.65) || chosen.m.cutPenalty > 0;
  const reasons = [];
  if (titleCollision > 0.02) reasons.push("the cover title still crosses the visible crop above the band");
  if (titleCoverage < 0.65) reasons.push("the band covers less than two thirds of the detected title block");
  if (chosen.m.cutPenalty > 0) reasons.push("the band edge cuts through a detected title line");
  if (!reasons.length) reasons.push("band covers the foot title block; the remaining visible copy is marketing only");
  if (marketingCollision > 0.015) reasons.push("marketing copy remains visible above the band (not the book title)");

  // Downsample the focus-score curve at the chosen band height for the UI.
  const curve = scoresByBand[chosen.bandHeight].filter((_, i) => i % 2 === 0);
  const minScore = Math.min(...curve.map((p) => p.score));
  const maxScore = Math.max(...curve.map((p) => p.score));
  const curveNormalised = curve.map((p) => ({
    x: Number(p.focus.toFixed(3)),
    score: Number(((p.score - minScore) / (maxScore - minScore || 1)).toFixed(3)),
    text: Number(p.titleCollision.toFixed(3))
  }));

  return {
    slug: input.slug,
    title: input.title,
    author: input.author,
    isbn: input.isbn,
    edition: input.edition,
    source: input.source,
    coverPage: input.coverPage,
    artwork: input.artwork,
    credit: input.credit,
    coverFile: input.cover,
    sourcePixels: `${src.width} × ${src.height}`,
    aspect: Number(aspect.toFixed(5)),
    spine: input.spine,
    cropPercent: Number((cropFraction * 100).toFixed(1)),
    focus: Number(chosen.focus.toFixed(3)),
    cropLeft: Number((chosen.focus - halfCrop).toFixed(3)),
    cropRight: Number((chosen.focus + halfCrop).toFixed(3)),
    bandFraction: chosen.bandHeight,
    bandTop: Number(bandTop.toFixed(3)),
    bandHeightPx: Math.round(chosen.bandHeight * input.spine.h),
    topCapFraction: Number(topCap.toFixed(3)),
    topCapPx: Math.round(topCap * input.spine.h),
    topCapCovered,
    topCapNote,
    railWidthPx: railWidth,
    railShiftPx: railShift,
    tone,
    ink: tone === "light" ? hex(DARK_INK) : hex(CREAM),
    paper: tone === "light" ? hex(VELLUM) : hex(INK),
    accent: hex(avg.map((v) => clamp(v + (255 - v) * 0.3, 0, 255))),
    meanLuma: Number(meanLuma.toFixed(3)),
    p05Luma: Number(p05.toFixed(3)),
    p95Luma: Number(p95.toFixed(3)),
    cropStd: Number(std.toFixed(3)),
    bareCreamContrast: Number(bareCream.toFixed(2)),
    bareDarkContrast: Number(bareDark.toFixed(2)),
    railContrast: Number(railContrast.toFixed(2)),
    textCollision: Number(titleCollision.toFixed(3)),
    marketingCollision: Number(marketingCollision.toFixed(3)),
    titleCoverage: Number(titleCoverage.toFixed(3)),
    cutPenalty: chosen.m.cutPenalty,
    status: review ? "review" : "pass",
    statusLabel: review ? "AUTO · REVIEW" : "AUTO · PASS",
    reasons,
    textBands: merged.map((band) => ({
      top: Number(band.top.toFixed(3)),
      bottom: Number(band.bottom.toFixed(3)),
      density: Number(band.density.toFixed(3))
    })),
    curve: curveNormalised,
    diagnostics: {
      workingPixels: `${W} × ${H}`,
      edgeThreshold: Number(edgeCut.toFixed(3)),
      candidates: candidates.length,
      detail: Number(chosen.m.detail.toFixed(4)),
      edgeMean: Number(chosen.m.edgeMean.toFixed(4)),
      colorMean: Number(chosen.m.color.toFixed(3))
    }
  };
}

const results = {};
for (const input of INPUTS) {
  results[input.slug] = analyse(input);
  console.log(input.slug, JSON.stringify({
    focus: results[input.slug].focus,
    crop: results[input.slug].cropPercent,
    band: results[input.slug].bandFraction,
    rail: results[input.slug].railWidthPx,
    tone: results[input.slug].tone,
    contrast: results[input.slug].railContrast,
    textCollision: results[input.slug].textCollision,
    marketingCollision: results[input.slug].marketingCollision,
    titleCoverage: results[input.slug].titleCoverage,
    status: results[input.slug].status,
    reasons: results[input.slug].reasons
  }, null, 2));
}
fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), inputs: results }, null, 2) + "\n");
console.log("wrote", OUT);
