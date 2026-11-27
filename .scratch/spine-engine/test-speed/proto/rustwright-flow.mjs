// Throwaway prototype: Rustwright Node 0.3.0, basic Playwright-shaped surface.
// Measures cold launch, navigation, DOM assertion via evaluate, screenshot, close.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("rustwright");

const ITER = Number(process.env.ITER ?? "3");
const URL = process.env.URL ?? "http://localhost:1420/";
const OUT = process.env.OUT ?? "/tmp/rw-shot.png";
const rss = () => Math.round(process.memoryUsage.rss() / 1048576);

const t0 = performance.now();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RUSTWRIGHT_CHROMIUM,
  args: ["--no-sandbox", "--window-size=390,844", "--force-device-scale-factor=3"],
});
const tLaunch = performance.now();
console.log(JSON.stringify({ stage: "launch", ms: +(tLaunch - t0).toFixed(1), rssMb: rss() }));

const page = await browser.newPage();
const tPage = performance.now();
console.log(JSON.stringify({ stage: "newPage", ms: +(tPage - tLaunch).toFixed(1), rssMb: rss() }));

const runs = [];
for (let i = 0; i < ITER; i += 1) {
  const s = performance.now();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  const nav = performance.now();
  const info = await page.evaluate(() => ({
    title: document.title,
    onboarding: Boolean(document.querySelector('[data-testid="onboarding"]')),
    wall: Boolean(document.querySelector('[data-testid="library-wall"]')),
    heading: document.querySelector("h1")?.textContent ?? null,
  }));
  const expr = performance.now();
  const shot = await page.screenshot({ path: i === 0 ? OUT : undefined });
  const done = performance.now();
  runs.push({
    iter: i,
    navMs: +(nav - s).toFixed(1),
    evalMs: +(expr - nav).toFixed(1),
    screenshotMs: +(done - expr).toFixed(1),
    totalMs: +(done - s).toFixed(1),
    pngBytes: shot.length,
    ...info,
  });
  console.log(JSON.stringify({ stage: "flow", ...runs.at(-1), rssMb: rss() }));
}

const tClose = performance.now();
await browser.close();
console.log(JSON.stringify({
  stage: "summary",
  launchMs: +(tLaunch - t0).toFixed(1),
  newPageMs: +(tPage - tLaunch).toFixed(1),
  firstFlowMs: runs[0].totalMs,
  warmFlowMs: runs.length > 1 ? +((runs.slice(1).reduce((a, r) => a + r.totalMs, 0)) / (runs.length - 1)).toFixed(1) : null,
  closeMs: +(performance.now() - tClose).toFixed(1),
  peakRssMb: rss(),
}));
writeFileSync(`${OUT}.json`, JSON.stringify(runs, null, 2));
