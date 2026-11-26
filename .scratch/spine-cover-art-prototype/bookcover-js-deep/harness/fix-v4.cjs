/* Re-capture each v4-wrap spine at the sample's 320-page computed width. */
const { chromium } = require('/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const V4 = 'http://127.0.0.1:4173/spine-cover-art-prototype/v4-wrap/';
const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const pngWrite = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const ids = ['whisper-man', 'rock-paper-scissors', 'moby-dick'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const p4 = await ctx.newPage();
  const visual = await ctx.newPage();
  await p4.goto(V4, { waitUntil: 'networkidle' });
  await p4.waitForFunction(() => window.PocketWrap && window.PocketWrap.ready, null, { timeout: 30000 });
  const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'results.json'), 'utf8'));
  for (const id of ids) {
    await p4.evaluate(async (id) => {
      await window.PocketWrap.setBook(id);
      await window.PocketWrap.setState({ pages: 320 });
    }, id);
    await p4.waitForTimeout(900);
    const m = await p4.evaluate(() => window.PocketWrap.getMetrics());
    const [dl] = await Promise.all([
      p4.waitForEvent('download', { timeout: 30000 }),
      p4.evaluate(() => window.PocketWrap.exportPNG()),
    ]);
    const tmp = path.join(OUT, 'v4', `${id}-wrap-320pp.png`);
    await dl.saveAs(tmp);
    const crop = await visual.evaluate(async ({ dataUrl, box, scale }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const c = document.createElement('canvas');
      c.width = Math.round(box.w * scale); c.height = Math.round(box.h * scale);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, Math.round(box.x * scale), Math.round(box.y * scale), Math.round(box.w * scale), Math.round(box.h * scale), 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }, { dataUrl: dataUri(tmp), box: { x: m.layout.spineX, y: m.layout.bleedIn, w: m.layout.spineIn, h: m.layout.trimH }, scale: 300 });
    const file = path.join(OUT, 'v4', `${id}-spine-${m.spine.spineIn.toFixed(3)}in.png`);
    pngWrite(file, crop);
    const v = results.v4.books[id];
    v.computed = m;
    v.variants[0] = { kind: 'computed', spineIn: m.spine.spineIn, file: path.relative(ROOT, file), mode: m.effectiveMode, fit: m.fit };
    console.log(id, m.spine.pages, m.spine.spineIn.toFixed(3), path.relative(ROOT, file));
  }
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})();
