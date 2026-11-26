const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:4174/';
const OUT = path.join(__dirname, 'comparables', 'book-3d-harness', 'captures');
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  ['whisper-man', 1, 'whisper-man-1sheet'],
  ['whisper-man', 12, 'whisper-man-12sheets'],
  ['whisper-man', 40, 'whisper-man-40sheets'],
  ['rock-paper-scissors', 12, 'rock-paper-scissors-12sheets'],
  ['moby-dick', 12, 'moby-dick-12sheets'],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const results = [];
  for (const [cover, sheets, slug] of cases) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    try {
      await page.goto(`${BASE}?cover=${cover}&pages=${sheets}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('canvas', { timeout: 20000 });
      await page.waitForTimeout(6000);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? { w: c.width, h: c.height } : null;
      });
      await page.screenshot({ path: path.join(OUT, `${slug}.png`), timeout: 60000 });
      results.push({ cover, sheets, slug, canvas, errors, ok: true });
    } catch (e) {
      results.push({ cover, sheets, slug, errors, ok: false, error: String(e).slice(0, 300) });
    }
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
