// Same flow as rustwright-flow.mjs, using Playwright.
// MODE=mobile matches this repo's config (390x844 @ DPR3, mobile+touch).
// MODE=plain uses Playwright defaults.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

const { chromium } = await import(
  "file:///mnt/ssd2/Projects/PocketLibrary/node_modules/playwright/index.mjs"
);

const ITER = Number(process.env.ITER ?? "3");
const URL = process.env.URL ?? "http://localhost:1420/";
const OUT = process.env.OUT ?? "/tmp/pw-shot.png";
const MODE = process.env.MODE ?? "mobile";
const rss = () => Math.round(process.memoryUsage.rss() / 1048576);

const contextOptions =
  MODE === "mobile"
    ? {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      }
    : {};

const t0 = performance.now();
const browser = await chromium.launch({ headless: true });
const tLaunch = performance.now();
console.log(JSON.stringify({ stage: "launch", ms: +(tLaunch - t0).toFixed(1), rssMb: rss() }));

const context = await browser.newContext(contextOptions);
const page = await context.newPage();
const tPage = performance.now();
console.log(JSON.stringify({ stage: "newPage", ms: +(tPage - tLaunch).toFixed(1), rssMb: rss() }));

const runs = [];
for (let i = 0; i < ITER; i += 1) {
  const s = performance.now();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  const nav = performance.now();
  const info = {
    title: await page.title(),
    onboarding: await page.getByTestId("onboarding").isVisible(),
    wall: await page.getByTestId("library-wall").count().then((n) => n > 0),
    heading: await page.locator("h1").first().textContent(),
  };
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
  mode: MODE,
  launchMs: +(tLaunch - t0).toFixed(1),
  newPageMs: +(tPage - tLaunch).toFixed(1),
  firstFlowMs: runs[0].totalMs,
  warmFlowMs: runs.length > 1 ? +((runs.slice(1).reduce((a, r) => a + r.totalMs, 0)) / (runs.length - 1)).toFixed(1) : null,
  closeMs: +(performance.now() - tClose).toFixed(1),
  peakRssMb: rss(),
}));
writeFileSync(`${OUT}.json`, JSON.stringify(runs, null, 2));
