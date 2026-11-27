#!/usr/bin/env node
/* Screenshot + measurement runner for the wrap-check harness.
 * Uses the repo's existing Playwright install and its own port (4180).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..");
const base = "http://127.0.0.1:4180/.scratch/spine-engine/wrap-check/";

const browser = await chromium.launch();

async function shot(url, file, { width, height = 900, dpr = 1, fullPage = true, readyFlag, resultKey = "__WRAP_CHECK__" }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction((flag) => window[flag] === true, readyFlag, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, file), fullPage });
  const results = await page.evaluate((key) => window[key] || null, resultKey);
  const err = await page.evaluate(() => window.__WRAP_CHECK_ERROR__ || null);
  await page.close();
  return { results, errors, err };
}

const tag = process.argv[2] || "run";
const r390 = await shot(base + "index.html", `shot-390${tag === "run" ? "" : "-" + tag}.png`, {
  width: 390, readyFlag: "__WRAP_CHECK_READY__",
});
const r320 = await shot(base + "index.html", `shot-320${tag === "run" ? "" : "-" + tag}.png`, {
  width: 320, readyFlag: "__WRAP_CHECK_READY__",
});
const rSheet = await shot(base + "wrap-sheets.html", "large-wrap-sheet.png", {
  width: 2100, height: 1400, dpr: 1, readyFlag: "__WRAP_SHEETS_READY__",
});
const t390 = await shot(base + "textless.html", "textless-shot-390.png", {
  width: 390, readyFlag: "__TEXTLESS_READY__", resultKey: "__TEXTLESS__",
});
const t320 = await shot(base + "textless.html", "textless-shot-320.png", {
  width: 320, readyFlag: "__TEXTLESS_READY__", resultKey: "__TEXTLESS__",
});
const tSheet = await shot(base + "textless-sheets.html", "textless-large-wrap-sheet.png", {
  width: 2100, height: 1400, dpr: 1, readyFlag: "__TEXTLESS_SHEETS_READY__", resultKey: "__TEXTLESS__",
});

await browser.close();

const errors = [...r390.errors, ...r320.errors, ...rSheet.errors, ...t390.errors, ...t320.errors, ...tSheet.errors];
const payload = {
  captured: new Date().toISOString(),
  viewports: ["390", "320"],
  errors,
  renderError: r390.err,
  results: r390.results,
};
fs.writeFileSync(path.join(dir, "measurements.json"), JSON.stringify(payload, null, 2));
fs.writeFileSync(path.join(dir, "textless-measurements.json"), JSON.stringify({
  captured: new Date().toISOString(),
  harness: "textless variant: art.jpg substituted for the front panel; renderer unchanged",
  errors: [...t390.errors, ...t320.errors, ...tSheet.errors],
  results: t390.results,
}, null, 2));
console.log(JSON.stringify({ errors, renderError: r390.err, books: r390.results?.books.length }, null, 2));
