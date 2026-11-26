const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-test/comparables/3d-book-css/book.html';
const OUT = path.join(__dirname, 'comparables', '3d-book-css', 'captures');
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  ['whisper-man', 50, 30, 'whisper-man-1in'],
  ['whisper-man', 25, 30, 'whisper-man-05in'],
  ['whisper-man', 75, 30, 'whisper-man-15in'],
  ['whisper-man', 50, 0, 'whisper-man-1in-rotate0'],
  ['rock-paper-scissors', 50, 30, 'rock-paper-scissors-1in'],
  ['moby-dick', 50, 30, 'moby-dick-1in'],
  ['whisper-man', 50, 10, 'whisper-man-1in-rotate10'],
  ['whisper-man', 50, -30, 'whisper-man-1in-rotate-30'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 820, height: 650 }, deviceScaleFactor: 2 });
  const results = [];
  for (const [cover, thickness, rotate, slug] of cases) {
    await page.goto(`${BASE}?cover=${cover}&thickness=${thickness}&rotate=${rotate}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    const info = await page.evaluate(() => {
      const book = document.querySelector('.book');
      const cs = getComputedStyle(book);
      const before = getComputedStyle(book, '::before');
      const after = getComputedStyle(book, '::after');
      return {
        bookTransform: cs.transform,
        frontZ: getComputedStyle(book.firstElementChild).transform,
        beforeTransform: before.transform,
        afterTransform: after.transform,
        spineElements: [...book.querySelectorAll('*')].filter((e) => e !== book.firstElementChild).length,
        text: book.textContent.trim(),
        assets: [...book.querySelectorAll('img')].map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })),
      };
    });
    results.push({ cover, thickness, rotate, slug, info });
  }
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.map((r) => ({ slug: r.slug, spineElements: r.info.spineElements, text: r.info.text })), null, 2));
  await browser.close();
})();
