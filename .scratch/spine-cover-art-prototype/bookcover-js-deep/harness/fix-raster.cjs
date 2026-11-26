/* Redo the dominant-colour fallback with contrast ink instead of ink = background. */
const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const APP = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-deep/harness/vendor/bookcover-js/index.html';
async function setInput(page, sel, value) { await page.locator(sel).fill(String(value)); await page.locator(sel).dispatchEvent('change'); await page.waitForTimeout(40); }
async function setSelect(page, sel, value) { await page.selectOption(sel, String(value)); await page.waitForTimeout(40); }
(async () => {
  const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'results.json'), 'utf8'));
  const bg = results.coverStats['whisper-man'].dominant;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const visual = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#spine-cover svg');
  await setInput(page, '#coverWidthInput', 6); await setInput(page, '#coverHeightInput', 9);
  await setInput(page, '#borderGapInput', 0.25); await setInput(page, '#borderThicknessInput', 0.05);
  await setInput(page, '#spineWidthInput', 1.0);
  await setInput(page, '#titleInput', 'The Whisper Man'); await setInput(page, '#authorInput', 'Alex North');
  await setSelect(page, '#spineTextStyleInput', 2); await setSelect(page, '#spineArtStyleInput', 0);
  await setInput(page, '#spineFontSizeInput', 18);
  await page.locator('#elementColorInput').evaluate((el) => { el.value = '#f3e7cf'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#backgroundColorInput').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, bg);
  await page.evaluate(() => { document.getElementById('coverSection').style.scale = '1'; });
  await page.waitForTimeout(200);
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster', 'dominant-colour-spine.png') });
  const svg = await page.evaluate(() => new XMLSerializer().serializeToString(document.querySelector('#spine-cover svg')));
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const render = await visual.evaluate(async ({ dataUrl, bg }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const s = 6, c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, { dataUrl, bg });
  fs.writeFileSync(path.join(OUT, 'raster', 'dominant-colour-spine-render.png'), Buffer.from(render.split(',')[1], 'base64'));
  results.rasterTests.dominantColour = {
    stats: results.coverStats['whisper-man'],
    ink: '#f3e7cf',
    background: bg,
    screenshot: 'raster/dominant-colour-spine.png',
    render: 'raster/dominant-colour-spine-render.png',
    note: 'The saved SVG is transparent; the dominant colour must be supplied by the shelf/UI behind it. This render fills that colour behind the cream ink.',
  };
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})();
