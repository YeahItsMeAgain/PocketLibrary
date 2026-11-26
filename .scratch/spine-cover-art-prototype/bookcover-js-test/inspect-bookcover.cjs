const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const APP = 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-test/bookcover-js-src/bookcover-js-main/index.html';
const OUT = path.join(__dirname, 'captures');

async function setInput(page, selector, value) {
  const el = page.locator(selector);
  await el.fill(String(value));
  await el.dispatchEvent('change');
  await page.waitForTimeout(120);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1300 } });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('#front-cover svg');
  await setInput(page, '#coverWidthInput', 6);
  await setInput(page, '#coverHeightInput', 9);
  await setInput(page, '#spineWidthInput', 1);
  await setInput(page, '#titleInput', 'The Whisper Man');
  await setInput(page, '#authorInput', 'Alex North');
  await page.selectOption('#spineTextStyleInput', '1');
  await page.selectOption('#spineArtStyleInput', '4');
  await page.evaluate(() => { document.getElementById('coverSection').style.scale = '1'; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'app-whisper-man.png') });

  const info = await page.evaluate(() => {
    const controls = [...document.querySelectorAll('input, select, textarea, button')].map((e) => ({
      tag: e.tagName.toLowerCase(), id: e.id, type: e.type, value: e.value,
      label: (document.querySelector(`label[for="${e.id}"]`) || {}).textContent || '',
    }));
    return {
      title: document.title,
      canvasCount: document.querySelectorAll('canvas').length,
      webgl: (() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); })(),
      sections: ['#back-cover', '#spine-cover', '#front-cover'].map((s) => {
        const el = document.querySelector(s);
        return { selector: s, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, svgCount: el.querySelectorAll('svg').length };
      }),
      controls,
      pageLikeControls: controls.filter((c) => /page|paper|thick|ppg|gsm|bulk/i.test(c.id + ' ' + c.label)),
      spineControls: controls.filter((c) => /spine/i.test(c.id + ' ' + c.label)),
      mediaPrint: [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((r) => r.media && String(r.media.mediaText).includes('print')).length,
    };
  });
  fs.writeFileSync(path.join(OUT, 'app-inspection.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
