/*
 * Deep hands-on test of bookcover-js spine-only SVG/PNG export.
 *
 * Run from this directory:
 *   node capture-deep.cjs
 *
 * It drives the real upstream app (vendor/bookcover-js) and a minimally patched
 * copy (patched-bookcover-js), saves the actual downloads, screenshots the
 * panels, measures clipping, and compares against v4-wrap + v3 crops.
 */
const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const COVERS = path.resolve(ROOT, '../../v3/assets');
const V4 = 'http://127.0.0.1:4173/spine-cover-art-prototype/v4-wrap/';
const APP = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-deep/harness/vendor/bookcover-js/index.html';
const PATCHED = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-deep/harness/patched-bookcover-js/index.html';

const books = [
  {
    slug: 'whisper-man',
    title: 'The Whisper Man',
    author: 'Alex North',
    width: 1.0,
    textStyle: 2,
    artStyle: 4,
    cover: path.join(COVERS, 'whisper-man-cover.jpg'),
    v3crop: path.resolve(ROOT, '../../v3/crops/whisper-man-spine.jpg'),
    v4id: 'whisper-man',
    ink: '#f3e7cf',
    scrim: 'rgba(8,8,12,0.24)',
    tone: 'dark',
  },
  {
    slug: 'rock-paper-scissors',
    title: 'Rock Paper Scissors',
    author: 'Alice Feeney',
    width: 0.75,
    textStyle: 2,
    artStyle: 4,
    cover: path.join(COVERS, 'rock-paper-scissors-cover.jpg'),
    v3crop: path.resolve(ROOT, '../../v3/crops/rock-paper-scissors-spine.jpg'),
    v4id: 'rock-paper-scissors',
    ink: '#1b1a18',
    scrim: 'rgba(255,255,255,0.28)',
    tone: 'light',
  },
  {
    slug: 'moby-dick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    width: 1.5,
    textStyle: 2,
    artStyle: 4,
    cover: path.join(COVERS, 'classic-covers/moby-dick.jpg'),
    v3crop: path.resolve(ROOT, '../../v3/crops/moby-dick-spine.jpg'),
    v4id: 'moby-dick',
    ink: '#f3e7cf',
    scrim: 'rgba(5,8,12,0.26)',
    tone: 'dark',
  },
];

const widthSweep = [0.26, 0.3, 0.35, 0.4, 0.5, 0.6, 0.677, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 2.5];
const textStyleNames = {
  1: 'both centred (words stacked)',
  2: 'both rotated',
  3: 'title rotated',
  4: 'author top',
  5: 'centred preserve format',
};

const results = {
  generatedAt: new Date().toISOString(),
  sources: {
    app: APP,
    patched: PATCHED,
    v4: V4,
    covers: COVERS,
  },
  books: {},
  rasterTests: {},
  titleFit: {},
  comparisons: {},
  v4: {},
  patch: {
    files: ['js/main.js', 'js/penguinstyle.js', 'index.html'],
    summary: 'accept raster directly, paint it full-bleed behind the spine text, remove PNG gutters',
  },
};

fs.mkdirSync(OUT, { recursive: true });
for (const b of books) fs.mkdirSync(path.join(OUT, b.slug), { recursive: true });
fs.mkdirSync(path.join(OUT, 'raster'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'patched'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'comparisons'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'v4'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'v3'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'titlefit'), { recursive: true });

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
const svgSize = (text) => {
  const w = /<svg[^>]*\bwidth="([\d.]+)"/.exec(text);
  const h = /<svg[^>]*\bheight="([\d.]+)"/.exec(text);
  return { width: w ? +w[1] : null, height: h ? +h[1] : null };
};

async function setInput(page, sel, value) {
  const el = page.locator(sel);
  await el.fill(String(value));
  await el.dispatchEvent('change');
  await page.waitForTimeout(30);
}
async function setSelect(page, sel, value) {
  await page.selectOption(sel, String(value));
  await page.waitForTimeout(30);
}
async function setColor(page, sel, value) {
  await page.locator(sel).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForTimeout(30);
}

async function configure(page, b, opts = {}) {
  const o = {
    width: b.width,
    textStyle: b.textStyle,
    artStyle: b.artStyle,
    fontSize: 18,
    elementColor: '#27285f',
    backgroundColor: '#a6a6a6',
    imageScale: 1.25,
    ...opts,
  };
  await setInput(page, '#coverWidthInput', 6);
  await setInput(page, '#coverHeightInput', 9);
  await setInput(page, '#borderGapInput', 0.25);
  await setInput(page, '#borderThicknessInput', 0.05);
  await setInput(page, '#spineWidthInput', o.width);
  await setInput(page, '#titleInput', b.title);
  await setInput(page, '#authorInput', b.author);
  await setSelect(page, '#spineTextStyleInput', o.textStyle);
  await setSelect(page, '#spineArtStyleInput', o.artStyle);
  await setInput(page, '#spineFontSizeInput', o.fontSize);
  await setInput(page, '#imageScale', o.imageScale);
  await setColor(page, '#elementColorInput', o.elementColor);
  await setColor(page, '#backgroundColorInput', o.backgroundColor);
  await page.evaluate(() => {
    document.getElementById('coverSection').style.scale = '1';
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(120);
}

async function measureSpine(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#spine-cover svg');
    if (!svg) return { error: 'no spine svg' };
    const sr = svg.getBoundingClientRect();
    const scale = sr.width ? svg.width.baseVal.value / sr.width : 1;
    const toUser = (r) => ({
      x: +((r.left - sr.left) * scale).toFixed(2),
      y: +((r.top - sr.top) * scale).toFixed(2),
      w: +(r.width * scale).toFixed(2),
      h: +(r.height * scale).toFixed(2),
    });
    const W = svg.width.baseVal.value;
    const H = svg.height.baseVal.value;
    const texts = [...svg.querySelectorAll('text')].map((t) => {
      const bb = toUser(t.getBoundingClientRect());
      const outside = {
        left: bb.x < -0.5,
        right: bb.x + bb.w > W + 0.5,
        top: bb.y < -0.5,
        bottom: bb.y + bb.h > H + 0.5,
      };
      return {
        text: t.textContent,
        fontSize: t.getAttribute('font-size'),
        transform: t.getAttribute('transform'),
        bbox: bb,
        outside,
        clipped: Object.values(outside).some(Boolean),
        overLeft: +Math.max(0, -bb.x).toFixed(2),
        overRight: +Math.max(0, bb.x + bb.w - W).toFixed(2),
      };
    });
    return {
      svgAttrs: { width: W, height: H, overflow: svg.getAttribute('overflow'), viewBox: svg.getAttribute('viewBox') },
      borderGapPx: parseFloat(document.getElementById('borderGapInput').value) * 72,
      spineOuterPx: W + parseFloat(document.getElementById('borderGapInput').value) * 72,
      textCount: texts.length,
      texts,
      clipped: texts.some((t) => t.clipped),
      maxOver: +Math.max(0, ...texts.map((t) => Math.max(t.overLeft, t.overRight))).toFixed(2),
      hasImage: !!svg.querySelector('image'),
      hasBackgroundRect: [...svg.querySelectorAll('rect')].some((r) => r.getAttribute('fill') && r.getAttribute('fill') !== 'none'),
    };
  });
}

async function grab(page, buttonId, dest) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#' + buttonId),
  ]);
  await dl.saveAs(dest);
  return dest;
}

async function serializeSpine(page) {
  return page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('#spine-cover svg')));
}

async function renderPng(visual, { dataUrl, width, height, background = null, targetHeight = null }) {
  return visual.evaluate(async ({ dataUrl, width, height, background, targetHeight }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    let w = width || img.naturalWidth;
    let h = height || img.naturalHeight;
    if (targetHeight) { h = targetHeight; w = Math.round((img.naturalWidth / img.naturalHeight) * h); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  }, { dataUrl, width, height, background, targetHeight });
}

async function cropPng(visual, { dataUrl, box, scale = 1 }) {
  return visual.evaluate(async ({ dataUrl, box, scale }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(box.w * scale));
    c.height = Math.max(2, Math.round(box.h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, Math.round(box.x * scale), Math.round(box.y * scale),
      Math.round(box.w * scale), Math.round(box.h * scale), 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, { dataUrl, box, scale });
}

async function shotCard(visual, html, dest, width = null) {
  await visual.setContent(`<!doctype html><meta charset="utf-8">
    <style>
      :root { color-scheme: dark; }
      body { margin:0; background:#12141a; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
      .card { display:inline-block; padding:18px 20px 16px; background:#181b23; color:#e8e3d7; }
      h3 { margin:0 0 4px; font:600 15px/1.25 ui-sans-serif,system-ui,sans-serif; color:#f3dfa9; }
      p { margin:0 0 12px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; color:#a9adb8; }
      .row { display:flex; gap:16px; align-items:flex-end; }
      .item { text-align:center; }
      .item img { display:block; background:
        linear-gradient(45deg,#2a2e38 25%,transparent 25%,transparent 75%,#2a2e38 75%),
        linear-gradient(45deg,#2a2e38 25%,#20232b 25%,#20232b 75%,#2a2e38 75%);
        background-size:16px 16px; background-position:0 0,8px 8px; }
      .cap { margin-top:7px; font:11px/1.3 ui-monospace,monospace; color:#b9bdc7; max-width:200px; }
      .badge { display:inline-block; padding:2px 6px; border-radius:999px; font:11px/1.4 ui-monospace,monospace; }
      .ok { background:#1f4d34; color:#b7f0c8; } .bad { background:#57222a; color:#ffc2cb; }
    </style><div class="card">${html}</div>`);
  await visual.waitForTimeout(120);
  const loc = visual.locator('.card');
  await loc.screenshot({ path: dest });
  return dest;
}

const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const svgUri = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
const pngWrite = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

async function analyzeCover(visual, dataUrl) {
  return visual.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas');
    c.width = 64; c.height = 96;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const buckets = new Map();
    let r = 0, g = 0, b = 0, n = 0;
    let er = 0, eg = 0, eb = 0, en = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        r += R; g += G; b += B; n++;
        if (x < 9) { er += R; eg += G; eb += B; en++; }
        const key = `${R >> 5},${G >> 5},${B >> 5}`;
        const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        cur.n++; cur.r += R; cur.g += G; cur.b += B;
        buckets.set(key, cur);
      }
    }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const hex = (R, G, B) => '#' + [R, G, B].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const avg = hex(r / n, g / n, b / n);
    const dominant = hex(top.r / top.n, top.g / top.n, top.b / top.n);
    const edge = hex(er / en, eg / en, eb / en);
    const lum = (h) => {
      const v = h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    return { avg, dominant, edge, dominantShare: +(top.n / n).toFixed(3), edgeLum: +lum(edge).toFixed(3), avgLum: +lum(avg).toFixed(3) };
  }, dataUrl);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const visual = await context.newPage();
  await visual.setViewportSize({ width: 1400, height: 1100 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spine-cover svg');

  // ---------------------------------------------------------------------
  // 1. Natural spine-only outputs: SVG + PNG for the three real covers.
  // ---------------------------------------------------------------------
  for (const b of books) {
    console.log('natural export', b.slug);
    await configure(page, b);
    const appShot = path.join(OUT, b.slug, 'app-spine.png');
    await page.locator('#spine-cover').screenshot({ path: appShot });
    await page.screenshot({ path: path.join(OUT, b.slug, 'app-full.png'), fullPage: false });

    const svgFile = path.join(OUT, b.slug, `${b.slug}-spine.svg`);
    const pngFile = path.join(OUT, b.slug, `${b.slug}-spine.png`);
    await grab(page, 'saveSpineSVG', svgFile);
    await grab(page, 'saveSpinePNG', pngFile);

    const svgText = fs.readFileSync(svgFile, 'utf8');
    const pngBuf = fs.readFileSync(pngFile);
    const metrics = await measureSpine(page);
    const dims = svgSize(svgText);
    const [pw, ph] = pngSize(pngBuf);

    // A clean 10x render of the SVG (no padding), for the shelf comparison.
    const clean10 = await renderPng(visual, { dataUrl: svgUri(svgText), width: Math.round(dims.width * 10), height: Math.round(dims.height * 10) });
    pngWrite(path.join(OUT, b.slug, `${b.slug}-clean-10x.png`), clean10);
    const preview = await renderPng(visual, { dataUrl: svgUri(svgText), targetHeight: 1000 });
    pngWrite(path.join(OUT, b.slug, `${b.slug}-preview.png`), preview);
    const pngPreview = await renderPng(visual, { dataUrl: dataUri(pngFile, 'image/png'), targetHeight: 1000 });
    pngWrite(path.join(OUT, b.slug, `${b.slug}-png-preview.png`), pngPreview);

    results.books[b.slug] = {
      meta: { title: b.title, author: b.author, widthIn: b.width, textStyle: b.textStyle, artStyle: b.artStyle },
      svg: { file: path.relative(ROOT, svgFile), width: dims.width, height: dims.height, bytes: fs.statSync(svgFile).size },
      png: { file: path.relative(ROOT, pngFile), width: pw, height: ph, bytes: pngBuf.length },
      expectedPng: {
        width: Math.round(dims.width * 10 + 2 * (metrics.borderGapPx / 2) * 10),
        height: Math.round(dims.height * 10 + 2 * metrics.borderGapPx * 10),
        padX: Math.round((metrics.borderGapPx / 2) * 10),
        padY: Math.round(metrics.borderGapPx * 10),
      },
      clean10: { file: path.relative(ROOT, path.join(OUT, b.slug, `${b.slug}-clean-10x.png`)), width: Math.round(dims.width * 10), height: Math.round(dims.height * 10) },
      outerWidthPx: metrics.spineOuterPx,
      metrics,
      appShot: path.relative(ROOT, appShot),
    };

    // A card for the gallery: actual export, clean render, app panel.
    await shotCard(visual, `
      <h3>${b.title} · ${b.width.toFixed(2)} in spine</h3>
      <p>app panel ${metrics.spineOuterPx.toFixed(1)} × ${metrics.svgAttrs.height} px · exported SVG ${dims.width} × ${dims.height} · exported PNG ${pw} × ${ph}</p>
      <div class="row">
        <div class="item"><img src="${dataUri(appShot, 'image/png')}" style="height:520px"><div class="cap">live app panel</div></div>
        <div class="item"><img src="${preview}" style="height:520px"><div class="cap">SVG export, rendered (${dims.width}×${dims.height})</div></div>
        <div class="item"><img src="${pngPreview}" style="height:520px"><div class="cap">PNG export, 10× + gutters (${pw}×${ph})</div></div>
      </div>`, path.join(OUT, b.slug, 'card-natural.png'));
  }

  // ---------------------------------------------------------------------
  // 1b. No auto-fit exists upstream. Find the largest font that fits and save
  //     a manually fitted RPS spine (its natural 0.75 in spine clips at 18 px),
  //     plus the fit at v4-wrap's 0.677 in computed spine.
  // ---------------------------------------------------------------------
  async function findFittingFont(b, width, style = 2, artStyle = 0) {
    // Across-spine extent grows with font size, so search downward from 18 px.
    let lo = 6, hi = 18;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      await configure(page, b, { width, textStyle: style, artStyle, fontSize: +mid.toFixed(2) });
      const m = await measureSpine(page);
      if (m.clipped) hi = mid; else lo = mid;
    }
    return +lo.toFixed(2);
  }
  results.fitted = { at0677: {}, rps075: {} };
  for (const b of books) {
    const fs = await findFittingFont(b, 0.677, 2, 0);
    await configure(page, b, { width: 0.677, textStyle: 2, artStyle: 0, fontSize: fs });
    const m = await measureSpine(page);
    results.fitted.at0677[b.slug] = { fontPx: fs, clipped: m.clipped, maxOver: m.maxOver, svgWidth: m.svgAttrs.width };
  }
  const rps = books[1];
  const rpsFont = await findFittingFont(rps, 0.75, 2, 0);
  await configure(page, rps, { width: 0.75, textStyle: 2, artStyle: 0, fontSize: rpsFont });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'rock-paper-scissors', 'fitted-app.png') });
  const fitSvgFile = path.join(OUT, 'rock-paper-scissors', 'rock-paper-scissors-fitted.svg');
  const fitPngFile = path.join(OUT, 'rock-paper-scissors', 'rock-paper-scissors-fitted.png');
  await grab(page, 'saveSpineSVG', fitSvgFile);
  await grab(page, 'saveSpinePNG', fitPngFile);
  const fitSvgText = fs.readFileSync(fitSvgFile, 'utf8');
  const fitDims = svgSize(fitSvgText);
  const [fitPw, fitPh] = pngSize(fs.readFileSync(fitPngFile));
  const fitPrev = await renderPng(visual, { dataUrl: svgUri(fitSvgText), targetHeight: 1000 });
  pngWrite(path.join(OUT, 'rock-paper-scissors', 'rock-paper-scissors-fitted-preview.png'), fitPrev);
  results.fitted.rps075 = {
    widthIn: 0.75,
    fontPx: rpsFont,
    svg: { file: path.relative(ROOT, fitSvgFile), width: fitDims.width, height: fitDims.height },
    png: { file: path.relative(ROOT, fitPngFile), width: fitPw, height: fitPh },
    metrics: await measureSpine(page),
    preview: 'rock-paper-scissors/rock-paper-scissors-fitted-preview.png',
  };
  await shotCard(visual, `<h3>Rock Paper Scissors — 0.75 in, manually fitted</h3>
    <p>Upstream has no auto-fit. At 18 px style 2 clips by 8 px; the largest fitting size is <b>${rpsFont} px</b>.</p>
    <div class="row"><div class="item"><img src="${dataUri(path.join(OUT, 'rock-paper-scissors', 'fitted-app.png'), 'image/png')}" style="height:560px"><div class="cap">fitted in app</div></div>
    <div class="item"><img src="${fitPrev}" style="height:560px"><div class="cap">fitted SVG export ${fitDims.width}×${fitDims.height}</div></div></div>`,
    path.join(OUT, 'rock-paper-scissors', 'card-fitted.png'));

  // ---------------------------------------------------------------------
  // 2. Exact dimensions / clean rectangle check at a few widths.
  // ---------------------------------------------------------------------
  results.dimensions = [];
  for (const w of [0.4, 0.677, 1.0, 1.5, 2.0]) {
    await configure(page, books[0], { width: w, artStyle: 0, textStyle: 2 });
    const m = await measureSpine(page);
    results.dimensions.push({
      widthIn: w,
      outerPx: m.spineOuterPx,
      svgWidth: m.svgAttrs.width,
      svgHeight: m.svgAttrs.height,
      borderGapPx: m.borderGapPx,
      pngWidth: Math.round(m.svgAttrs.width * 10 + m.borderGapPx * 10),
      pngHeight: Math.round(m.svgAttrs.height * 10 + 2 * m.borderGapPx * 10),
      cleanWidth: Math.round(m.svgAttrs.width * 10),
      cleanHeight: Math.round(m.svgAttrs.height * 10),
    });
  }

  // ---------------------------------------------------------------------
  // 3. Title-fit matrix: 3 books × 5 text styles × width sweep.
  // ---------------------------------------------------------------------
  for (const b of books) {
    results.titleFit[b.slug] = {};
    for (const style of [1, 2, 3, 4, 5]) {
      const row = [];
      for (const w of widthSweep) {
        await configure(page, b, { width: w, textStyle: style, artStyle: 0, fontSize: 18, elementColor: '#27285f' });
        const m = await measureSpine(page);
        row.push({ widthIn: w, clipped: m.clipped, maxOver: m.maxOver, svgWidth: m.svgAttrs.width, clips: m.texts.filter((t) => t.clipped).map((t) => ({ text: t.text, overLeft: t.overLeft, overRight: t.overRight })) });
      }
      // First tested width that does not clip.
      const first = row.find((r) => !r.clipped);
      let minWidth = null;
      if (first) {
        const idx = row.indexOf(first);
        let lo = idx > 0 ? row[idx - 1].widthIn : first.widthIn - 0.05;
        let hi = first.widthIn;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          await configure(page, b, { width: mid, textStyle: style, artStyle: 0, fontSize: 18, elementColor: '#27285f' });
          const m = await measureSpine(page);
          if (m.clipped) lo = mid; else hi = mid;
        }
        minWidth = +hi.toFixed(2);
      }
      results.titleFit[b.slug][style] = {
        name: textStyleNames[style],
        sweep: row,
        firstFitTested: first ? first.widthIn : null,
        minOuterWidthIn: minWidth,
      };
      console.log('fit', b.slug, style, 'min', minWidth);
    }
  }

  // Contact sheet for the two useful styles at thin/thick widths.
  const contactWidths = [0.4, 0.5, 0.6, 0.677, 0.75, 1.0, 1.5, 2.0];
  for (const style of [1, 2]) {
    const items = [];
    for (const b of books) {
      for (const w of contactWidths) {
        await configure(page, b, { width: w, textStyle: style, artStyle: 0, fontSize: 18, elementColor: '#27285f' });
        const m = await measureSpine(page);
        const svgText = await serializeSpine(page);
        const prev = await renderPng(visual, { dataUrl: svgUri(svgText), targetHeight: 460 });
        items.push({
          html: `<div class="item"><img src="${prev}" style="height:230px"><div class="cap">${b.title}<br>${w.toFixed(3)} in · ${m.clipped ? '<span class="badge bad">CLIP +' + m.maxOver + 'px</span>' : '<span class="badge ok">fits</span>'}</div></div>`,
          key: `${b.slug}@${w}`,
        });
      }
    }
    const file = path.join(OUT, 'titlefit', `style-${style}-contact.png`);
    await shotCard(visual, `<h3>Spine text style ${style} — ${textStyleNames[style]}</h3>
      <p>18 px font · 0.25 in border gap · art off. Red badge shows measured glyph overflow past the saved SVG edge.</p>
      <div class="row" style="flex-wrap:wrap;gap:12px;max-width:1320px">${items.map((i) => i.html).join('')}</div>`,
      file, 1320);
    results.titleFit[`contact-${style}`] = path.relative(ROOT, file);
  }

  // ---------------------------------------------------------------------
  // 4. Real raster covers: direct upload + raster-in-SVG wrapper.
  // ---------------------------------------------------------------------
  const whisper = books[0];
  const whisperData = dataUri(whisper.cover, 'image/jpeg');
  const coverStats = {};
  for (const b of books) coverStats[b.slug] = await analyzeCover(visual, dataUri(b.cover, 'image/jpeg'));

  // 4a. Direct JPEG upload to the unpatched app.
  await configure(page, whisper, { artStyle: 4, textStyle: 2 });
  const directErrors = [];
  page.on('pageerror', (e) => directErrors.push(e.message));
  let directUpload = { attempted: true };
  try {
    await page.setInputFiles('#fileInput', whisper.cover);
    await page.waitForTimeout(700);
    await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster', 'direct-jpg-spine.png') });
    await page.locator('#front-cover').screenshot({ path: path.join(OUT, 'raster', 'direct-jpg-front.png') });
    directUpload = {
      attempted: true,
      errors: directErrors,
      spine: await measureSpine(page),
      appPanel: 'raster/direct-jpg-spine.png',
      frontPanel: 'raster/direct-jpg-front.png',
    };
  } catch (e) {
    directUpload = { attempted: true, failed: true, error: String(e), errors: directErrors };
  }
  results.rasterTests.directJpeg = directUpload;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#spine-cover svg');

  // 4b. JPEG embedded in an SVG wrapper, uploaded as SVG (the closest supported path).
  const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="1303" height="2000" viewBox="0 0 1303 2000"><image href="${whisperData}" width="1303" height="2000"/></svg>`;
  const wrapperFile = path.join(OUT, 'raster', 'whisper-man-wrapper.svg');
  fs.writeFileSync(wrapperFile, wrapper);
  await page.setInputFiles('#fileInput', wrapperFile);
  await page.waitForTimeout(500);
  await configure(page, whisper, { artStyle: 5, textStyle: 2, imageScale: 8 });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster', 'raster-in-svg-spine-scale8.png') });
  const rasterSvgMetrics = await measureSpine(page);
  // Also prove the uploaded image is ignored when art is off.
  await configure(page, whisper, { artStyle: 0, textStyle: 2, imageScale: 8 });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster', 'raster-in-svg-artoff-spine.png') });
  results.rasterTests.rasterInSvg = {
    wrapperFile: path.relative(ROOT, wrapperFile),
    artScale8: { metrics: rasterSvgMetrics, screenshot: 'raster/raster-in-svg-spine-scale8.png' },
    artOff: { metrics: await measureSpine(page), screenshot: 'raster/raster-in-svg-artoff-spine.png' },
    note: 'Accepted, but the wrapper becomes a tiled/cropped ornament; it is never used as a full-bleed spine or front cover.',
  };

  // 4c. Dominant-colour typographic fallback, unpatched.
  await configure(page, whisper, { artStyle: 0, textStyle: 2, elementColor: coverStats[whisper.slug].dominant, backgroundColor: coverStats[whisper.slug].dominant });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster', 'dominant-colour-spine.png') });
  const domSvg = await serializeSpine(page);
  const domPng = await renderPng(visual, { dataUrl: svgUri(domSvg), width: Math.round((await measureSpine(page)).svgAttrs.width * 6), height: Math.round((await measureSpine(page)).svgAttrs.height * 6), background: coverStats[whisper.slug].dominant });
  pngWrite(path.join(OUT, 'raster', 'dominant-colour-spine-render.png'), domPng);
  results.rasterTests.dominantColour = {
    stats: coverStats[whisper.slug],
    screenshot: 'raster/dominant-colour-spine.png',
    render: 'raster/dominant-colour-spine-render.png',
    note: 'The saved SVG is transparent; the cover colour must be supplied by the shelf/UI behind it. Only the ink is in the export.',
  };

  // ---------------------------------------------------------------------
  // 5. Patched direct-raster spine: full-bleed cover crop + fitted rail.
  // ---------------------------------------------------------------------
  const patched = await context.newPage();
  await patched.setViewportSize({ width: 1500, height: 1100 });
  const patchedErrors = [];
  patched.on('pageerror', (e) => patchedErrors.push(e.message));
  patched.on('console', (m) => { if (m.type() === 'error') patchedErrors.push(m.text()); });
  await patched.goto(PATCHED, { waitUntil: 'networkidle' });
  await patched.waitForSelector('#spine-cover svg');

  results.patched = { books: {}, errors: patchedErrors };
  for (const b of books) {
    const patchedFont = b.slug === 'rock-paper-scissors' ? results.fitted.rps075.fontPx : 18;
    await configure(patched, b, { artStyle: 0, textStyle: 2, fontSize: patchedFont, elementColor: b.ink, backgroundColor: coverStats[b.slug].edge });
    await patched.setInputFiles('#fileInput', b.cover);
    await patched.waitForTimeout(500);
    // The patch stores the data URL; set the scrim through the same page context.
    await patched.evaluate((scrim) => {
      // `Cover` is module-scoped; the public UI has no scrim control, so drive it
      // by patching the generated SVG's first rect after the image.
      const svg = document.querySelector('#spine-cover svg');
      const img = svg.querySelector('image');
      if (img) {
        const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', 0); r.setAttribute('y', 0);
        r.setAttribute('width', svg.getAttribute('width'));
        r.setAttribute('height', svg.getAttribute('height'));
        r.setAttribute('fill', scrim);
        img.after(r);
      }
    }, b.scrim);
    await patched.locator('#spine-cover').screenshot({ path: path.join(OUT, 'patched', `${b.slug}-app.png`) });
    const svgFile = path.join(OUT, 'patched', `${b.slug}-spine.svg`);
    const pngFile = path.join(OUT, 'patched', `${b.slug}-spine.png`);
    await grab(patched, 'saveSpineSVG', svgFile);
    await grab(patched, 'saveSpinePNG', pngFile);
    const svgText = fs.readFileSync(svgFile, 'utf8');
    const pngBuf = fs.readFileSync(pngFile);
    const dims = svgSize(svgText);
    const [pw, ph] = pngSize(pngBuf);
    const prev = await renderPng(visual, { dataUrl: svgUri(svgText), targetHeight: 1000 });
    pngWrite(path.join(OUT, 'patched', `${b.slug}-preview.png`), prev);
    results.patched.books[b.slug] = {
      svg: { file: path.relative(ROOT, svgFile), width: dims.width, height: dims.height, bytes: fs.statSync(svgFile).size },
      png: { file: path.relative(ROOT, pngFile), width: pw, height: ph, bytes: pngBuf.length },
      metrics: await measureSpine(patched),
      app: `patched/${b.slug}-app.png`,
      preview: `patched/${b.slug}-preview.png`,
    };
    await shotCard(visual, `<h3>Patched: ${b.title}</h3>
      <p>direct JPEG upload → full-bleed xMinYMid slice · SVG ${dims.width}×${dims.height} · PNG ${pw}×${ph} · no gutters</p>
      <div class="row"><div class="item"><img src="${dataUri(path.join(OUT, 'patched', `${b.slug}-app.png`), 'image/png')}" style="height:560px"><div class="cap">patched app</div></div>
      <div class="item"><img src="${prev}" style="height:560px"><div class="cap">exported SVG render</div></div></div>`,
      path.join(OUT, 'patched', `${b.slug}-card.png`));
  }

  // ---------------------------------------------------------------------
  // 6. v4-wrap 2D spine slices (computed 0.677 in and 1.00 in stress).
  // ---------------------------------------------------------------------
  const p4 = await context.newPage();
  await p4.setViewportSize({ width: 1300, height: 1000 });
  await p4.goto(V4, { waitUntil: 'networkidle' });
  await p4.waitForFunction(() => window.PocketWrap && window.PocketWrap.ready, null, { timeout: 30000 });
  results.v4 = { books: {} };
  for (const b of books) {
    await p4.evaluate((id) => window.PocketWrap.setBook(id), b.v4id);
    await p4.waitForTimeout(600);
    const variants = [];
    // Computed 320-page spine.
    const m1 = await p4.evaluate(() => window.PocketWrap.getMetrics());
    const dl1 = await Promise.all([
      p4.waitForEvent('download', { timeout: 30000 }),
      p4.evaluate(() => window.PocketWrap.exportPNG()),
    ]);
    const tmp1 = path.join(OUT, 'v4', `${b.slug}-wrap-${m1.spine.pages}pp.png`);
    await dl1[0].saveAs(tmp1);
    const crop1 = await cropPng(visual, {
      dataUrl: dataUri(tmp1, 'image/png'),
      box: { x: m1.layout.spineX, y: m1.layout.bleedIn, w: m1.layout.spineIn, h: m1.layout.trimH },
      scale: 300,
    });
    const spine1 = path.join(OUT, 'v4', `${b.slug}-spine-${m1.spine.spineIn.toFixed(3)}in.png`);
    pngWrite(spine1, crop1);
    variants.push({ kind: 'computed', spineIn: m1.spine.spineIn, file: path.relative(ROOT, spine1), mode: m1.effectiveMode, fit: m1.fit });

    // 1.00 in stress.
    await p4.evaluate(() => window.PocketWrap.stressOneInch());
    await p4.waitForTimeout(900);
    const m2 = await p4.evaluate(() => window.PocketWrap.getMetrics());
    const dl2 = await Promise.all([
      p4.waitForEvent('download', { timeout: 30000 }),
      p4.evaluate(() => window.PocketWrap.exportPNG()),
    ]);
    const tmp2 = path.join(OUT, 'v4', `${b.slug}-wrap-1in.png`);
    await dl2[0].saveAs(tmp2);
    const crop2 = await cropPng(visual, {
      dataUrl: dataUri(tmp2, 'image/png'),
      box: { x: m2.layout.spineX, y: m2.layout.bleedIn, w: m2.layout.spineIn, h: m2.layout.trimH },
      scale: 300,
    });
    const spine2 = path.join(OUT, 'v4', `${b.slug}-spine-1.000in.png`);
    pngWrite(spine2, crop2);
    variants.push({ kind: '1in', spineIn: m2.spine.spineIn, file: path.relative(ROOT, spine2), mode: m2.effectiveMode, fit: m2.fit });
    results.v4.books[b.slug] = { variants, computed: m1, stress: m2 };
    // reset to the book's recommended 320 pages for the next loop
    await p4.evaluate(async (id) => { await window.PocketWrap.setBook(id); }, b.v4id);
    await p4.waitForTimeout(500);
  }

  // Copy v3 art-only spines into the harness output.
  for (const b of books) {
    const dest = path.join(OUT, 'v3', `${b.slug}-art-only.jpg`);
    fs.copyFileSync(b.v3crop, dest);
    results.books[b.slug].v3 = { file: path.relative(ROOT, dest), width: 160, height: 727 };
  }

  // ---------------------------------------------------------------------
  // 7. Side-by-side comparison cards.
  // ---------------------------------------------------------------------
  results.comparisons = {};
  for (const b of books) {
    const bjPreview = path.join(OUT, b.slug, `${b.slug}-preview.png`);
    const bjClean = path.join(OUT, b.slug, `${b.slug}-clean-10x.png`);
    const v4One = path.join(OUT, 'v4', `${b.slug}-spine-1.000in.png`);
    const v3 = path.join(OUT, 'v3', `${b.slug}-art-only.jpg`);
    const card = path.join(OUT, 'comparisons', `${b.slug}-bookcover-vs-v4-vs-v3.png`);
    const html = `
      <h3>${b.title} — spine-only outputs at the same displayed height</h3>
      <p>bookcover-js: clean SVG at 1.00 in · v4-wrap: 300 dpi crop at 1.000 in stress · v3: fixed 160 × 727 art-only crop</p>
      <div class="row">
        <div class="item"><img src="${dataUri(bjPreview, 'image/png')}" style="height:720px"><div class="cap">bookcover-js<br>${b.slug} · ${(b.width * 72).toFixed(0)} px outer / SVG ${results.books[b.slug].svg.width}×${results.books[b.slug].svg.height}<br>text style ${b.textStyle}, ship ornament</div></div>
        <div class="item"><img src="${dataUri(v4One, 'image/png')}" style="height:720px"><div class="cap">v4-wrap 2D slice<br>1.000 in · 300 px wide · ${results.v4.books[b.slug].stress.effectiveMode}</div></div>
        <div class="item"><img src="${dataUri(v3, 'image/jpeg')}" style="height:720px"><div class="cap">v3 art-only crop<br>160 × 727 · no thickness arithmetic</div></div>
      </div>`;
    await shotCard(visual, html, card, 1100);
    results.comparisons[b.slug] = path.relative(ROOT, card);
  }

  // A single "typographic 1 inch" strip for all three, plus v4's stress fit.
  const stripHtml = books.map((b) => {
    const p = path.join(OUT, b.slug, `${b.slug}-preview.png`);
    return `<div class="item"><img src="${dataUri(p, 'image/png')}" style="height:500px"><div class="cap">${b.title}<br>spine ${b.width.toFixed(2)} in · ${results.books[b.slug].svg.width}×${results.books[b.slug].svg.height} SVG</div></div>`;
  }).join('');
  await shotCard(visual, `<h3>bookcover-js spine-only exports, natural spine widths</h3>
    <p>SVG is exactly the inner spine rectangle; PNG is the same render at 10× with transparent gutters.</p>
    <div class="row">${stripHtml}</div>`, path.join(OUT, 'comparisons', 'all-three-natural.png'), 900);

  // ---------------------------------------------------------------------
  // 8. Persist results.
  // ---------------------------------------------------------------------
  results.coverStats = coverStats;
  results.errorCount = errors.length;
  results.errors = [...new Set(errors)];
  results.patched.errorCount = patchedErrors.length;
  results.patched.errors = [...new Set(patchedErrors)];
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(results, null, 2));
  console.log('wrote results.json');

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
