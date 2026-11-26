#!/usr/bin/env node
/* Read the actual renderer metrics for every book and spine style. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.BASE_URL || "http://127.0.0.1:4173/spine-cover-art-prototype/app-renderers/";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__APP_RENDERERS_READY__ === true, { timeout: 20000 });
  const metrics = await page.evaluate(async () => {
    const out = {};
    for (const book of window.APP_RENDERER_BOOKS) {
      await window.PocketRenderers.loadBook(book);
      const styles = {};
      for (const style of window.PocketRenderers.STYLES) {
        const r = window.PocketRenderers.render(book, style, { dpr: 1 });
        styles[style] = Object.assign({}, r.metrics, { label: r.label });
      }
      out[book.slug] = {
        title: book.title, author: book.author, pages: book.pages,
        route: book.route, verdict: book.verdict, holdout: !!book.holdout,
        styles,
      };
    }
    return out;
  });
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, {
    route: v.route, verdict: v.verdict,
    styles: Object.fromEntries(Object.entries(v.styles).map(([s, m]) => [s, {
      titlePx: m.titlePx, fit: m.fit, contrast: m.contrast,
      spinePx: m.spinePx, spineMm: m.spineMm,
    }])),
  }])), null, 2));
})();
