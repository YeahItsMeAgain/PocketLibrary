// Throwaway capture + audit script for the v4 generative-fill prototype.
// Run from the repo root:
//   node .scratch/spine-cover-art-prototype/v4-generative/capture.cjs
// Expects .scratch served at http://127.0.0.1:4173/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype/v4-generative/";
const OUT = path.join(__dirname, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const audit = { widths: {}, images: {}, errors: [] };

(async () => {
  const browser = await chromium.launch();

  async function makePage(width) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
    page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
    page.on("requestfailed", (req) => errors.push("requestfailed: " + req.url()));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    return { page, errors };
  }

  async function shot(page, selector, file) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await target.screenshot({ path: path.join(OUT, file) });
  }

  for (const width of [390, 360, 320]) {
    const { page, errors } = await makePage(width);

    await page.screenshot({ path: path.join(OUT, `01-hero-${width}.png`) });
    await shot(page, "#whisper-man", `02-whisper-${width}.png`);
    await shot(page, "#rock-paper-scissors", `03-rps-${width}.png`);
    await shot(page, "#classic-control", `04-classic-${width}.png`);
    await shot(page, "#failure-modes", `05-failure-modes-${width}.png`);
    await shot(page, "#settings", `10-settings-${width}.png`);
    await shot(page, "#whisper-man .spine-compare", `08-whisper-spines-${width}.png`);
    await shot(page, "#rock-paper-scissors .spine-compare", `09-rps-spines-${width}.png`);

    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, "06-full-390.png"), fullPage: true });
    }

    const widthAudit = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      const imgs = [...document.images];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: cw,
        overflowers: [...document.querySelectorAll("*")]
          .filter((el) => {
            if (el.closest(".table-wrap")) return false; // intentionally scrollable
            const r = el.getBoundingClientRect();
            return r.right > cw + 1 || r.left < -1;
          })
          .slice(0, 10)
          .map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 70) })),
        tableScrolls: [...document.querySelectorAll(".table-wrap")].map((el) => ({
          client: el.clientWidth,
          scroll: el.scrollWidth,
          scrollable: el.scrollWidth > el.clientWidth,
        })),
        images: imgs.map((i) => ({
          src: i.getAttribute("src"),
          ok: i.complete && i.naturalWidth > 0,
          w: i.naturalWidth,
          h: i.naturalHeight,
        })),
        figures: document.querySelectorAll("figure").length,
        cases: document.querySelectorAll(".case").length,
      };
    });
    audit.widths[width] = widthAudit;
    audit.errors.push(...errors.map((e) => `${width}px ${e}`));
    await page.close();
  }

  fs.writeFileSync(path.join(__dirname, "audit.json"), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
  await browser.close();
})();
