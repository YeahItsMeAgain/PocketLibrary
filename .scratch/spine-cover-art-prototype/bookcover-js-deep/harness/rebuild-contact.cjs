/* Rebuild readable per-book title-fit contact sheets and clipping close-ups. */
const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const COVERS = path.resolve(ROOT, '../../v3/assets');
const APP = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-deep/harness/vendor/bookcover-js/index.html';
const books = [
  { slug: 'whisper-man', title: 'The Whisper Man', author: 'Alex North' },
  { slug: 'rock-paper-scissors', title: 'Rock Paper Scissors', author: 'Alice Feeney' },
  { slug: 'moby-dick', title: 'Moby-Dick', author: 'Herman Melville' },
];
const widths = [0.4, 0.5, 0.6, 0.677, 0.75, 1.0, 1.5, 2.0];
const styleNames = { 1: 'both centred (words stacked)', 2: 'both rotated' };

async function setInput(page, sel, value) { await page.locator(sel).fill(String(value)); await page.locator(sel).dispatchEvent('change'); await page.waitForTimeout(25); }
async function setSelect(page, sel, value) { await page.selectOption(sel, String(value)); await page.waitForTimeout(25); }
async function configure(page, b, w, style, font = 18, artStyle = 0) {
  await setInput(page, '#coverWidthInput', 6);
  await setInput(page, '#coverHeightInput', 9);
  await setInput(page, '#borderGapInput', 0.25);
  await setInput(page, '#borderThicknessInput', 0.05);
  await setInput(page, '#spineWidthInput', w);
  await setInput(page, '#titleInput', b.title);
  await setInput(page, '#authorInput', b.author);
  await setSelect(page, '#spineTextStyleInput', style);
  await setSelect(page, '#spineArtStyleInput', artStyle);
  await setInput(page, '#spineFontSizeInput', font);
  await page.locator('#elementColorInput').evaluate((el) => { el.value = '#27285f'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => { document.getElementById('coverSection').style.scale = '1'; });
  await page.waitForTimeout(80);
}
async function measure(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#spine-cover svg');
    const sr = svg.getBoundingClientRect();
    const scale = svg.width.baseVal.value / sr.width;
    const W = svg.width.baseVal.value, H = svg.height.baseVal.value;
    const texts = [...svg.querySelectorAll('text')].map((t) => {
      const r = t.getBoundingClientRect();
      const x = (r.left - sr.left) * scale, y = (r.top - sr.top) * scale;
      const w = r.width * scale, h = r.height * scale;
      return { text: t.textContent, x, y, w, h, overLeft: Math.max(0, -x), overRight: Math.max(0, x + w - W) };
    });
    return { W, H, texts, clipped: texts.some((t) => t.overLeft > 0.5 || t.overRight > 0.5), maxOver: +Math.max(0, ...texts.map((t) => Math.max(t.overLeft, t.overRight))).toFixed(2) };
  });
}
const svgUri = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
const pngWrite = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

async function renderPng(visual, dataUrl, targetHeight) {
  return visual.evaluate(async ({ dataUrl, targetHeight }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const h = targetHeight, w = Math.max(2, Math.round((img.naturalWidth / img.naturalHeight) * h));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  }, { dataUrl, targetHeight });
}
async function zoomBand(visual, dataUrl, band = 0.26, scale = 4) {
  return visual.evaluate(async ({ dataUrl, band, scale }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const y = Math.round(sh * (0.5 - band / 2));
    const c = document.createElement('canvas'); c.width = sw * scale; c.height = Math.round(sh * band) * scale;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, y, sw, Math.round(sh * band), 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, { dataUrl, band, scale });
}
async function shotCard(visual, html, dest, cardWidth) {
  await visual.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#12141a;font-family:ui-sans-serif,system-ui,sans-serif;color:#e8e3d7}
    .card{display:inline-block;padding:18px 20px 16px;background:#181b23;width:${cardWidth ? cardWidth - 40 : 1000}px}
    h3{margin:0 0 4px;font:600 15px/1.25 ui-sans-serif;color:#f3dfa9}
    p{margin:0 0 12px;font:12px/1.45 ui-monospace,monospace;color:#a9adb8}
    .row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
    .item{text-align:center}.item img{display:block;background:#20232b}
    .cap{margin-top:6px;font:11px/1.3 ui-monospace,monospace;color:#b9bdc7}
    .badge{display:inline-block;padding:1px 5px;border-radius:999px;font:10px/1.4 ui-monospace}
    .ok{background:#1f4d34;color:#b7f0c8}.bad{background:#57222a;color:#ffc2cb}
  </style><div class="card">${html}</div>`);
  await visual.waitForTimeout(100);
  await visual.locator('.card').screenshot({ path: dest });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const visual = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spine-cover svg');
  const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'results.json'), 'utf8'));

  for (const b of books) {
    for (const style of [1, 2]) {
      const items = [];
      for (const w of widths) {
        await configure(page, b, w, style);
        const m = await measure(page);
        const svg = await page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('#spine-cover svg')));
        const prev = await renderPng(visual, svgUri(svg), 620);
        items.push(`<div class="item"><img src="${prev}" style="height:620px"><div class="cap">${w.toFixed(3)} in · ${m.W.toFixed(1)} px<br>${m.clipped ? `<span class="badge bad">CLIP +${m.maxOver}px</span>` : '<span class="badge ok">fits</span>'}</div></div>`);
      }
      const dest = path.join(OUT, 'titlefit', `${b.slug}-style-${style}.png`);
      await shotCard(visual, `<h3>${b.title} — text style ${style}: ${styleNames[style]}</h3>
        <p>18 px font, 0.25 in border gap, art off. Red badge = measured glyph overflow past the saved SVG edge.</p>
        <div class="row">${items.join('')}</div>`, dest, 1160);
      results.titleFit[`sheet-${b.slug}-${style}`] = path.relative(ROOT, dest);
      console.log(dest);
    }
  }

  // Close-up: RPS 0.75 in at 18 px (clips) vs 13 px (fits).
  const rps = books[1];
  const rpsShots = [];
  for (const font of [18, 13]) {
    await configure(page, rps, 0.75, 2, font);
    const m = await measure(page);
    const svg = await page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('#spine-cover svg')));
    const zoom = await zoomBand(visual, svgUri(svg), 0.24, 4);
    rpsShots.push({ font, m, zoom });
  }
  const rpsDest = path.join(OUT, 'titlefit', 'clip-detail-rps-075.png');
  await shotCard(visual, `<h3>Rock Paper Scissors · 0.75 in — why fit matters</h3>
    <p>Style 2, same spine, same SVG rectangle. At 18 px the rotated title is cut at the right edge and the author at the left; 13 px clears it.</p>
    <div class="row">${rpsShots.map((s) => `<div class="item"><img src="${s.zoom}" style="height:360px"><div class="cap">${s.font} px · <span class="badge ${s.m.clipped ? 'bad' : 'ok'}">${s.m.clipped ? 'CLIP +' + s.m.maxOver + 'px' : 'fits'}</span></div></div>`).join('')}</div>`, rpsDest, 760);
  results.titleFit['clip-detail-rps-075'] = path.relative(ROOT, rpsDest);

  // Close-up: Whisper at 1.00 in, style 1 (words stacked) vs style 2 (rotated).
  const whisper = books[0];
  const wShots = [];
  for (const style of [1, 2]) {
    await configure(page, whisper, 1.0, style);
    const m = await measure(page);
    const svg = await page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('#spine-cover svg')));
    const zoom = await zoomBand(visual, svgUri(svg), 0.3, 4);
    wShots.push({ style, m, zoom });
  }
  const wDest = path.join(OUT, 'titlefit', 'clip-detail-whisper-1in.png');
  await shotCard(visual, `<h3>The Whisper Man · 1.00 in — style choice, not just width</h3>
    <p>The earlier “clips at 1 in” result was style 1. Style 1 stacks every word across a 54 px inner spine and cuts “Whisper”; style 2 rotates the same 18 px type and fits.</p>
    <div class="row">${wShots.map((s) => `<div class="item"><img src="${s.zoom}" style="height:360px"><div class="cap">style ${s.style} · <span class="badge ${s.m.clipped ? 'bad' : 'ok'}">${s.m.clipped ? 'CLIP +' + s.m.maxOver + 'px' : 'fits'}</span></div></div>`).join('')}</div>`, wDest, 760);
  results.titleFit['clip-detail-whisper-1in'] = path.relative(ROOT, wDest);

  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})();
