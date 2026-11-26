const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:4173/spine-cover-art-prototype/bookcover-js-deep/harness/vendor/bookcover-js/index.html';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
  console.log('status', resp.status());
  await page.waitForSelector('#spine-cover svg');
  const info = await page.evaluate(() => {
    const svg = document.querySelector('#spine-cover svg');
    const outer = document.querySelector('#spine-cover');
    return {
      svgW: svg.getAttribute('width'),
      svgH: svg.getAttribute('height'),
      svgOverflow: svg.getAttribute('overflow'),
      viewBox: svg.getAttribute('viewBox'),
      outerBox: outer.getBoundingClientRect().toJSON(),
      html: svg.outerHTML.slice(0, 600),
      buttons: [...document.querySelectorAll('#spineCoverSection button')].map(b => b.id),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.locator('#spine-cover').screenshot({ path: __dirname + '/out/probe-spine.png' });
  await browser.close();
})();
