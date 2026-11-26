#!/usr/bin/env node
/* Capture the app-renderers gallery and the APK WebView page at 390 / 320. */
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..");
const SHOTS = path.join(ROOT, "screenshots");
const BASE = process.env.BASE_URL || "http://127.0.0.1:4173/spine-cover-art-prototype/app-renderers/";
const WIDTHS = [390, 320];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function checkPage(page) {
  return page.evaluate(() => {
    const overflowEls = [...document.querySelectorAll(".rer-book, .rer-style, .rer-chain, .rer-qa, .method, .scope")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.className || el.tagName);
    const imgs = [...document.images];
    return {
      books: document.querySelectorAll(".rer-book").length,
      styles: document.querySelectorAll(".rer-style").length,
      canvasCount: document.querySelectorAll(".rer-style canvas").length,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      overflowEls,
      images: imgs.length,
      imagesLoaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      fonts: {
        garamond: document.fonts.check('12px "EB Garamond"'),
        literata: document.fonts.check('12px "Literata"'),
      },
      height: document.documentElement.scrollHeight,
      ready: !!window.__APP_RENDERERS_READY__ || !!window.__RENDERERS_READY__,
    };
  });
}

function attach(page, bucket) {
  page.on("console", (m) => { if (m.type() === "error") bucket.push("console: " + m.text()); });
  page.on("pageerror", (e) => bucket.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => bucket.push("failed: " + r.url()));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const payloadDir = path.join(os.tmpdir(), "pl-app-renderer-payloads");
  execFileSync("python3", [path.join(ROOT, "tools", "build-payloads.py"), payloadDir], { stdio: "ignore" });
  const gatsbyPayload = fs.readFileSync(path.join(payloadDir, "gatsby.json"), "utf8");

  const browser = await chromium.launch();
  const results = { generated: new Date().toISOString(), base: BASE, widths: {} };

  for (const width of WIDTHS) {
    const bucket = [];
    const page = await browser.newPage({ viewport: { width, height: 960 }, deviceScaleFactor: 2 });
    attach(page, bucket);
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__APP_RENDERERS_READY__ === true, { timeout: 20000 });
    await sleep(500);
    const gallery = await checkPage(page);
    await page.screenshot({ path: path.join(SHOTS, `gallery-${width}.png`), fullPage: true });
    await page.close();

    const apkBucket = [];
    const apkPage = await browser.newPage({ viewport: { width, height: 960 }, deviceScaleFactor: 2 });
    attach(apkPage, apkBucket);
    await apkPage.addInitScript((p) => { window.PocketBridge = { payload: () => p }; }, gatsbyPayload);
    await apkPage.goto(BASE + "android-renderer/assets/renderer/index.html", { waitUntil: "networkidle" });
    await apkPage.waitForFunction(() => window.__RENDERERS_READY__ === true, { timeout: 20000 });
    await sleep(400);
    const apk = await checkPage(apkPage);
    await apkPage.screenshot({ path: path.join(SHOTS, `apk-webview-${width}.png`), fullPage: true });
    await apkPage.close();

    results.widths[width] = { gallery, galleryErrors: bucket, apkWebview: apk, apkErrors: apkBucket };
  }

  await browser.close();
  const fails = [];
  for (const [w, r] of Object.entries(results.widths)) {
    if (r.gallery.docOverflow !== 0 || r.gallery.bodyOverflow !== 0) fails.push(`${w}: gallery overflow`);
    if (r.gallery.images !== r.gallery.imagesLoaded) fails.push(`${w}: gallery images`);
    if (r.gallery.styles !== 30) fails.push(`${w}: gallery styles`);
    if (r.galleryErrors.length) fails.push(`${w}: gallery errors`);
    if (r.apkWebview.docOverflow !== 0) fails.push(`${w}: apk overflow`);
    if (r.apkWebview.styles !== 6) fails.push(`${w}: apk styles`);
    if (r.apkErrors.length) fails.push(`${w}: apk errors`);
    if (!r.gallery.fonts.garamond) fails.push(`${w}: font not loaded`);
  }
  results.pass = fails.length === 0;
  results.failures = fails;
  fs.writeFileSync(path.join(ROOT, "audit.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: results.pass, failures: fails, widths: Object.keys(results.widths) }, null, 2));
  if (!results.pass) process.exit(1);
})();
