/**
 * Capture the v8 automatic generative gallery at 390 / 360 / 320 px.
 * Run from the repo root with the suite served at 127.0.0.1:4173:
 *   node .scratch/spine-cover-art-prototype/v8-auto/capture.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype/v8-auto/";
const ROOT = __dirname;
const OUT = path.join(ROOT, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const audit = { generated: new Date().toISOString(), widths: {}, errors: [] };

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const width of [390, 360, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => audit.errors.push(`pageerror ${width}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") audit.errors.push(`console ${width}: ${m.text()}`);
    });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map((img) =>
        img.complete ? Promise.resolve() : new Promise((res) => {
          img.addEventListener("load", res, { once: true });
          img.addEventListener("error", res, { once: true });
        })
      ));
    });
    await page.waitForTimeout(350);
    await page.addStyleTag({ content: ".study-dock,.study-dock__spacer,.study-dock__landing{display:none!important}" });

    const data = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      images: Array.from(document.images).map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })),
      fonts: document.fonts.status,
      cases: document.querySelectorAll(".case").length,
      passes: document.querySelectorAll(".badge.pass").length,
      reviews: document.querySelectorAll(".badge.review").length,
      dock: !!document.querySelector(".study-dock"),
      v8: window.PocketV8?.summary || null,
    }));
    audit.widths[width] = data;
    await page.screenshot({ path: path.join(OUT, `full-${width}.png`), fullPage: true });
    if (width === 390) {
      await page.screenshot({ path: path.join(OUT, "00-hero-390.png") });
      await page.locator("#case-hound").screenshot({ path: path.join(OUT, "01-case-hound-390.png") });
      await page.locator("#case-rps").screenshot({ path: path.join(OUT, "02-case-rps-390.png") });
      await page.locator("#case-harry-potter").screenshot({ path: path.join(OUT, "03-case-harry-potter-390.png") });
      await page.locator("#case-hunger-games").screenshot({ path: path.join(OUT, "04-case-hunger-games-390.png") });
      await page.locator("#case-whisper-man").screenshot({ path: path.join(OUT, "05-case-whisper-man-390.png") });
      await page.locator("#repro-plate").screenshot({ path: path.join(OUT, "06-plate-390.png") });
    }
    await context.close();
  }
  fs.writeFileSync(path.join(ROOT, "audit-screens.json"), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit.widths, null, 2));
  await browser.close();
})();
