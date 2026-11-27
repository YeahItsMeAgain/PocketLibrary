// Same real flow as rw-real-node.mjs, driven by Playwright (the repo's current tool).
// launch -> goto dev server -> onboarding -> click "Choose library folder"
//       -> wait for [data-testid="library-wall"] -> screenshot.
import { performance } from "node:perf_hooks";

const { chromium } = await import(
  "file:///mnt/ssd2/Projects/PocketLibrary/node_modules/playwright/index.mjs"
);

const URL = process.env.URL ?? "http://localhost:1420/";
const OUT = process.env.OUT ?? "/tmp/opencode/pw-real-shot.png";
const t0 = performance.now();
const marks = {};

const browser = await chromium.launch({ headless: true });
marks.launchMs = +(performance.now() - t0).toFixed(1);

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
marks.newPageMs = +(performance.now() - (t0 + marks.launchMs)).toFixed(1);

marks.gotoStart = performance.now();
await page.goto(URL, { waitUntil: "load", timeout: 30000 });
marks.gotoMs = +(performance.now() - marks.gotoStart).toFixed(1);

const api = {
  addInitScript: typeof page.addInitScript,
  getByTestId: typeof page.getByTestId,
  locator: typeof page.locator,
  setViewportSize: typeof page.setViewportSize,
  evaluate: typeof page.evaluate,
  click: typeof page.click,
  screenshot: typeof page.screenshot,
  newContext: typeof browser.newContext,
};

const onboardingBefore = await page
  .getByTestId("onboarding")
  .textContent()
  .catch(() => null);

marks.clickStart = performance.now();
await page
  .getByTestId("onboarding")
  .getByRole("button", { name: "Choose library folder" })
  .click({ timeout: 10000 });
marks.clickMs = +(performance.now() - marks.clickStart).toFixed(1);

marks.waitStart = performance.now();
await page.getByTestId("library-wall").waitFor({ state: "visible", timeout: 10000 });
marks.waitWallMs = +(performance.now() - marks.waitStart).toFixed(1);

const wallText = (await page.getByTestId("library-wall").textContent()) ?? "";
const spineCount = await page.getByTestId("spine").count();
const bodyText = (await page.locator("body").textContent()) ?? "";

marks.screenshotStart = performance.now();
const shot = await page.screenshot({ path: OUT });
marks.screenshotMs = +(performance.now() - marks.screenshotStart).toFixed(1);

marks.closeStart = performance.now();
await browser.close();
marks.closeMs = +(performance.now() - marks.closeStart).toFixed(1);
marks.totalMs = +(performance.now() - t0).toFixed(1);

console.log(JSON.stringify({
  engine: "playwright",
  url: URL,
  api,
  onboardingBefore: onboardingBefore && onboardingBefore.trim().slice(0, 80),
  wallVisible: true,
  spineCount,
  wallText: wallText.slice(0, 80),
  bodyPreview: bodyText.slice(0, 80),
  shotBytes: shot.length,
  marks,
}, null, 2));
