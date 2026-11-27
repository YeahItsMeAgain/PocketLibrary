// Real Rustwright trial: Node binding built from /tmp/opencode/rustwright @ 0.3.1.
// Flow: launch -> goto dev server -> onboarding -> click "Choose library folder"
//       -> wait for [data-testid="library-wall"] -> screenshot.
// No init script is available in the Node binding, so a seeded book/spine is not
// possible; this reaches the empty wall and reports that limitation explicitly.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/tmp/opencode/rustwright/node/index.cjs");

const URL = process.env.URL ?? "http://localhost:1420/";
const OUT = process.env.OUT ?? "/tmp/opencode/rw-real-shot.png";
const t0 = performance.now();
const marks = {};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RUSTWRIGHT_CHROMIUM,
  userDataDir: process.env.RW_PROFILE,
  args: [
    "--no-sandbox",
    "--window-size=390,844",
    "--force-device-scale-factor=3",
  ],
});
marks.launchMs = +(performance.now() - t0).toFixed(1);

const page = await browser.newPage();
marks.newPageMs = +(performance.now() - (t0 + marks.launchMs)).toFixed(1);

marks.gotoStart = performance.now();
await page.goto(URL, { waitUntil: "load", timeout: 30000 });
marks.gotoMs = +(performance.now() - marks.gotoStart).toFixed(1);

// Capability probe on the JS wrapper (not the page).
const api = {
  addInitScript: typeof page.addInitScript,
  getByTestId: typeof page.getByTestId,
  locator: typeof page.locator,
  setViewportSize: typeof page.setViewportSize,
  evaluate: typeof page.evaluate,
  click: typeof page.click,
  screenshot: typeof page.screenshot,
  newContext: typeof browser.newContext,
  pages: typeof browser.contexts === "function" ? "contexts()" : "none",
};

const read = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || "").trim().slice(0, 120) : null;
  }, sel);

const onboardingBefore = await read('[data-testid="onboarding"]');

marks.clickStart = performance.now();
await page.click('[data-testid="onboarding"] button.primary-action', { timeout: 10000 });
marks.clickMs = +(performance.now() - marks.clickStart).toFixed(1);

// No locator/expect API: poll the DOM by hand.
const waitStart = performance.now();
let wallVisible = false;
let polls = 0;
for (; polls < 200; polls += 1) {
  const ok = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="library-wall"]');
    return Boolean(el) && el.getBoundingClientRect().width > 0;
  });
  if (ok) { wallVisible = true; break; }
  await new Promise((r) => setTimeout(r, 50));
}
marks.waitWallMs = +(performance.now() - waitStart).toFixed(1);
marks.polls = polls;

const wallText = await read('[data-testid="library-wall"]');
const spineCount = await page.evaluate(
  () => document.querySelectorAll('[data-testid="spine"]').length,
);
const bodyText = await read("body");

marks.screenshotStart = performance.now();
const shot = await page.screenshot({ path: OUT });
marks.screenshotMs = +(performance.now() - marks.screenshotStart).toFixed(1);

marks.closeStart = performance.now();
await browser.close();
marks.closeMs = +(performance.now() - marks.closeStart).toFixed(1);
marks.totalMs = +(performance.now() - t0).toFixed(1);

console.log(JSON.stringify({
  engine: "rustwright-node",
  version: require("/tmp/opencode/rustwright/node/package.json").version,
  url: URL,
  api,
  onboardingBefore,
  wallVisible,
  spineCount,
  wallText: wallText && wallText.slice(0, 80),
  bodyPreview: bodyText && bodyText.slice(0, 80),
  shotBytes: shot.length,
  marks,
}, null, 2));
writeFileSync(`${OUT}.json`, JSON.stringify({ api, wallVisible, spineCount, marks }, null, 2));
