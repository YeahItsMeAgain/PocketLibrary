/*
 * Renders bookcover-js variants with real PocketLibrary cover metadata and
 * captures front/spine/back panels, combined exports, metrics and edge cases.
 *
 * Run: node capture-bookcover.cjs
 */
const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'captures');
const APP = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-test/bookcover-js-src/bookcover-js-main/index.html';
const COVERS = path.resolve(ROOT, '../v3/assets');
fs.mkdirSync(OUT, { recursive: true });

const books = [
  {
    slug: 'whisper-man',
    title: 'The Whisper Man',
    author: 'Alex North',
    spine: 1.0,
    textStyle: '1',
    artStyle: '4',
    frontSource: path.join(COVERS, 'whisper-man-cover.jpg'),
  },
  {
    slug: 'rock-paper-scissors',
    title: 'Rock Paper Scissors',
    author: 'Alice Feeney',
    spine: 0.75,
    textStyle: '2',
    artStyle: '4',
    frontSource: path.join(COVERS, 'rock-paper-scissors-cover.jpg'),
  },
  {
    slug: 'moby-dick',
    title: 'Moby-Dick',
    author: 'Herman Melville',
    spine: 1.5,
    textStyle: '3',
    artStyle: '7',
    frontSource: path.join(COVERS, 'classic-covers/moby-dick.jpg'),
  },
];

const widths = [
  { slug: 'whisper-man-spine-040', title: 'The Whisper Man', author: 'Alex North', spine: 0.4, textStyle: '1', artStyle: '4' },
  { slug: 'whisper-man-spine-080', title: 'The Whisper Man', author: 'Alex North', spine: 0.8, textStyle: '1', artStyle: '4' },
  { slug: 'whisper-man-spine-150', title: 'The Whisper Man', author: 'Alex North', spine: 1.5, textStyle: '1', artStyle: '4' },
];

async function setInput(page, selector, value) {
  const el = page.locator(selector);
  await el.fill(String(value));
  await el.dispatchEvent('change');
  await page.waitForTimeout(120);
}

async function setSelect(page, selector, value) {
  await page.selectOption(selector, String(value));
  await page.waitForTimeout(120);
}

async function configure(page, b) {
  await setInput(page, '#coverWidthInput', 6);
  await setInput(page, '#coverHeightInput', 9);
  await setInput(page, '#spineWidthInput', b.spine);
  await setInput(page, '#titleInput', b.title);
  await setInput(page, '#authorInput', b.author);
  await setSelect(page, '#spineTextStyleInput', b.textStyle);
  await setSelect(page, '#spineArtStyleInput', b.artStyle);
  await page.locator('#elementColorInput').evaluate((el) => { el.value = '#c9a227'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#backgroundColorInput').evaluate((el) => { el.value = '#14342b'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await setInput(page, '#coverFontSizeInput', 26);
  await setInput(page, '#spineFontSizeInput', 18);
  await page.waitForSelector('#front-cover svg');
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.getElementById('coverSection').style.scale = '1'; });
}

async function spineMetrics(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#spine-cover svg');
    const rect = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll('text')].map((t) => {
      const b = t.getBoundingClientRect();
      return {
        text: t.textContent,
        fontSize: t.getAttribute('font-size'),
        transform: t.getAttribute('transform'),
        bboxClient: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
        outside: b.left < rect.left - 0.5 || b.right > rect.right + 0.5 || b.top < rect.top - 0.5 || b.bottom > rect.bottom + 0.5,
      };
    });
    return {
      spineSvgWidth: +svg.getAttribute('width'),
      spineSvgHeight: +svg.getAttribute('height'),
      spineElementWidth: document.querySelector('#spine-cover').getBoundingClientRect().width,
      textCount: texts.length,
      texts,
      outsideCount: texts.filter((t) => t.outside).length,
      inputs: [...document.querySelectorAll('#settingsSection input, #settingsSection select')].map((i) => ({ id: i.id, type: i.type || i.tagName, value: i.value })),
    };
  });
}

async function captureBook(page, b) {
  await configure(page, b);
  const m = await spineMetrics(page);
  await page.locator('#front-cover').screenshot({ path: path.join(OUT, `${b.slug}-front.png`) });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, `${b.slug}-spine.png`) });
  await page.locator('#back-cover').screenshot({ path: path.join(OUT, `${b.slug}-back.png`) });

  // Three-panel strip.
  await page.evaluate(() => window.scrollTo(0, 0));
  const boxes = await Promise.all(['#back-cover', '#spine-cover', '#front-cover'].map((s) => page.locator(s).boundingBox()));
  const minX = Math.min(...boxes.map((x) => x.x)) - 4;
  const minY = Math.min(...boxes.map((x) => x.y)) - 4;
  const maxX = Math.max(...boxes.map((x) => x.x + x.width)) + 4;
  const maxY = Math.max(...boxes.map((x) => x.y + x.height)) + 4;
  await page.screenshot({ path: path.join(OUT, `${b.slug}-wrap.png`), clip: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } });

  // Combined SVG export.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#saveCombinedSVG'),
  ]);
  await dl.saveAs(path.join(OUT, `${b.slug}-combined.svg`));
  await page.waitForTimeout(200);

  return m;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 }, acceptDownloads: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#front-cover svg');
  const results = { app: APP, generatedAt: new Date().toISOString(), books: {}, widths: {}, rasterUpload: {}, errors };

  // Overview screenshot with controls.
  await page.screenshot({ path: path.join(OUT, 'app-overview.png'), fullPage: false });

  for (const b of books) {
    results.books[b.slug] = { meta: b, metrics: await captureBook(page, b) };
  }

  for (const w of widths) {
    await configure(page, w);
    results.widths[w.slug] = { meta: w, metrics: await spineMetrics(page) };
    await page.locator('#spine-cover').screenshot({ path: path.join(OUT, `${w.slug}.png`) });
  }

  // Combined PNG export (once, at 10x) to test print/bitmap output.
  await configure(page, books[0]);
  const [png] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.click('#saveCombinedPNG'),
  ]);
  await png.saveAs(path.join(OUT, 'whisper-man-combined-10x.png'));

  // Text-style behaviour on a narrow 0.5in spine with a long title (before the
  // raster upload changes the art tile).
  await configure(page, { title: 'The Whisper Man', author: 'Alex North', spine: 0.5, textStyle: '1', artStyle: '4' });
  results.narrowLongTitle = await spineMetrics(page);
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'narrow-long-title-style1.png') });

  // Raster-in-SVG upload: bookcover-js only accepts SVG art. Embed the real
  // front cover in an SVG wrapper to see what it does with a photographic cover.
  const b64 = fs.readFileSync(books[0].frontSource).toString('base64');
  const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1303 2000" width="1303" height="2000"><image width="1303" height="2000" xlink:href="data:image/jpeg;base64,${b64}"/></svg>`;
  const wrapperPath = path.join(OUT, 'whisper-man-embedded.svg');
  fs.writeFileSync(wrapperPath, wrapper);

  await configure(page, books[0]);
  await page.setInputFiles('#fileInput', wrapperPath);
  await page.waitForTimeout(1800);
  results.rasterUpload = {
    note: 'The only art input accepts .svg; this embeds the real JPEG inside an SVG wrapper.',
    metrics: await spineMetrics(page),
  };
  await page.locator('#front-cover').screenshot({ path: path.join(OUT, 'raster-upload-front.png') });
  await page.locator('#spine-cover').screenshot({ path: path.join(OUT, 'raster-upload-spine.png') });

  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ outputs: fs.readdirSync(OUT).sort(), errors }, null, 2));
  await browser.close();
})();
