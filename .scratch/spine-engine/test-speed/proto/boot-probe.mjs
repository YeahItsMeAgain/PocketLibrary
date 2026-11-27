// Boot-cost probe: Playwright, one browser, per-iteration fresh context.
// Measures time from goto() until the mocked app is interactive (library-wall).
// This is the floor every test pays before its own assertions.
import { performance } from "node:perf_hooks";

const { chromium } = await import(
  "file:///mnt/ssd2/Projects/PocketLibrary/node_modules/playwright/index.mjs"
);

const ITER = Number(process.env.ITER ?? "8");
const URL = process.env.URL ?? "http://localhost:1420/";
const MODE = process.env.MODE ?? "mock";
const rss = () => Math.round(process.memoryUsage.rss() / 1048576);

const browser = await chromium.launch({ headless: true });
const tLaunch = performance.now();

const results = [];
for (let i = 0; i < ITER; i += 1) {
  const tCtx = performance.now();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  if (MODE === "mock") {
    await page.addInitScript(() => {
      window.__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: [],
      };
    });
  }
  const t0 = performance.now();
  await page.goto(URL, { waitUntil: "load" });
  const tNav = performance.now();
  const selector = MODE === "mock" ? '[data-testid="library-wall"]' : '[data-testid="onboarding"]';
  await page.locator(selector).waitFor({ state: "visible", timeout: 30000 });
  const tReady = performance.now();
  await context.close();
  const tClose = performance.now();
  results.push({
    contextCreateMs: +(t0 - tCtx).toFixed(1),
    navMs: +(tNav - t0).toFixed(1),
    appReadyMs: +(tReady - tNav).toFixed(1),
    totalToReadyMs: +(tReady - t0).toFixed(1),
    contextCloseMs: +(tClose - tReady).toFixed(1),
    rssMb: rss(),
  });
}

const warm = results.slice(1);
const avg = (k) => +(warm.reduce((a, r) => a + r[k], 0) / warm.length).toFixed(1);
console.log(JSON.stringify({ mode: MODE, launchMs: +(tLaunch).toFixed(1), iterations: results, warmAvg: {
  contextCreateMs: avg("contextCreateMs"),
  navMs: avg("navMs"),
  appReadyMs: avg("appReadyMs"),
  totalToReadyMs: avg("totalToReadyMs"),
  contextCloseMs: avg("contextCloseMs"),
}, rssMb: rss() }, null, 2));
await browser.close();
