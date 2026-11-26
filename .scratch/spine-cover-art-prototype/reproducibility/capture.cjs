/**
 * Capture the shared reproducibility test for The Hound of the Baskervilles.
 *
 * Run from the repo root while the suite is served at 127.0.0.1:4173:
 *   node .scratch/spine-cover-art-prototype/reproducibility/capture.cjs
 *
 * Outputs go to reproducibility/results/ and reproducibility/results.json.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype";
const ROOT = __dirname;
const OUT = path.join(ROOT, "results");
const BOOK_ID = 13;
const PAGES = 170;
fs.mkdirSync(OUT, { recursive: true });

const results = {
  generated: new Date().toISOString(),
  book: {
    title: "The Hound of the Baskervilles",
    author: "Arthur Conan Doyle",
    year: 1902,
    source: "Standard Ebooks",
    words: 59285,
    referencePages: PAGES,
  },
  studies: {},
  errors: [],
};

async function settleImages(page) {
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })
      )
    );
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 430, height: 1000 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => results.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") results.errors.push(`console: ${message.text()}`);
  });

  // ---- Full-bleed -------------------------------------------------------
  await page.goto(`${BASE}/v2/`, { waitUntil: "networkidle" });
  await page.click(`.film-item[data-book-id="${BOOK_ID}"]`);
  await page.waitForTimeout(500);
  await settleImages(page);
  await page.locator("#compare-card").screenshot({
    path: path.join(OUT, "full-bleed.png"),
  });
  results.studies["full-bleed"] = {
    label: "Full-bleed",
    status: "automatic",
    note: "Cover crop, focus, shelf band and title rail were generated from the downloaded cover.",
    image: "results/full-bleed.png",
  };

  // ---- Textless art -----------------------------------------------------
  await page.goto(`${BASE}/v3/`, { waitUntil: "networkidle" });
  await page.click(`.film-item[data-book-id="${BOOK_ID}"]`);
  await page.waitForTimeout(500);
  await settleImages(page);
  await page.locator("#compare-card").screenshot({
    path: path.join(OUT, "textless-art.png"),
  });
  results.studies["textless-art"] = {
    label: "Textless art",
    status: "automatic",
    note: "The cover already uses a public-domain painting (Caspar David Friedrich, 1820), so the text-free artwork is used directly.",
    image: "results/textless-art.png",
  };

  // ---- Wrap engine ------------------------------------------------------
  await page.goto(`${BASE}/v4-wrap/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.PocketWrap && window.PocketWrap.ready);
  await page.evaluate(() => window.PocketWrap.setBook("hound-of-the-baskervilles"));
  const wrapMetrics = await page.evaluate(
    (pages) => window.PocketWrap.setState({ pages }),
    PAGES
  );
  await page.waitForTimeout(500);
  await page.locator(".press").screenshot({
    path: path.join(OUT, "wrap-engine.png"),
  });
  const wrapPng = await page.evaluate(() =>
    document.getElementById("wrapCanvas").toDataURL("image/png")
  );
  fs.writeFileSync(
    path.join(OUT, "wrap-engine-full.png"),
    Buffer.from(wrapPng.split(",")[1], "base64")
  );
  results.studies["wrap-engine"] = {
    label: "Wrap engine",
    status: "automatic",
    note: "The 170-page reference extent produced a computed spine and a continuous back/spine/front wrap at 0.100 mm per leaf.",
    image: "results/wrap-engine.png",
    fullWrap: "results/wrap-engine-full.png",
    metrics: wrapMetrics,
  };

  // ---- Design system ----------------------------------------------------
  await page.goto(`${BASE}/v6/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.PocketV6 && window.PocketV6.ready);
  await page.evaluate((id) => window.PocketV6.selectBook(id), BOOK_ID);
  await page.waitForTimeout(500);
  await settleImages(page);
  await page.locator("#detail").screenshot({
    path: path.join(OUT, "design-system.png"),
  });
  results.studies["design-system"] = {
    label: "Design system",
    status: "automatic",
    note: "Hybrid shelf spine generated from the shared cover. The study's own shelf record uses 336 pp for this title; the reference extent above is separate.",

    image: "results/design-system.png",
  };

  // ---- Automatic generative ---------------------------------------------
  await page.goto(`${BASE}/v8-auto/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.PocketV8 && window.PocketV8.ready);
  await page.waitForTimeout(400);
  await settleImages(page);
  await page.locator("#repro-plate").screenshot({
    path: path.join(OUT, "automatic-generative.png"),
  });
  const v8 = await page.evaluate(() => window.PocketV8.summary);
  const v8Book = v8.books.find((book) => book.slug === "hound") || {};
  results.studies["automatic-generative"] = {
    label: "Automatic generative",
    status: "automatic",
    note: "Automatic DBNet mask plus flat fill / LaMa. The spine chooses a real text-free crop above the title band; no hand-drawn mask and no model prompt.",
    image: "results/automatic-generative.png",
    metrics: {
      route: v8Book.route,
      verdict: v8Book.verdict,
      maskCoveragePct: v8Book.mask_coverage_pct,
      residualOcrSpine: v8Book.spine_residual_ocr,
      spineLumaStd: v8Book.spine_luma_std,
      edgeDensity: v8Book.spine_edge_density,
      runtimeSeconds: v8Book.runtime_s,
      manualIntervention: 0,
      model: "PP-OCRv3 DBNet + LaMa big-lama (CPU)",
    },
  };

  // ---- Reference / bookcover-js ----------------------------------------
  await page.goto(
    `${BASE}/bookcover-js-deep/harness/vendor/bookcover-js/index.html`,
    { waitUntil: "networkidle" }
  );
  await page.waitForSelector("#spine-cover svg");
  await page.fill("#titleInput", "The Hound of the Baskervilles");
  await page.dispatchEvent("#titleInput", "input");
  await page.fill("#authorInput", "Arthur Conan Doyle");
  await page.dispatchEvent("#authorInput", "input");
  await page.fill("#spineWidthInput", "1.0");
  await page.dispatchEvent("#spineWidthInput", "change");
  await page.fill("#spineFontSizeInput", "8");
  await page.dispatchEvent("#spineFontSizeInput", "change");
  await page.waitForTimeout(400);
  await page.locator("#spine-cover").screenshot({
    path: path.join(OUT, "reference-spine.png"),
  });
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.click("#saveSpinePNG"),
    ]);
    await download.saveAs(path.join(OUT, "reference-spine-export.png"));
  } catch (error) {
    results.errors.push(`reference download: ${error.message}`);
  }
  results.studies["reference"] = {
    label: "Reference",
    status: "manual export",
    note: "Spine-only SVG/PNG export at a manually chosen 1.00 in width. Title and author were entered by hand; the cover artwork is not used and there is no page-count model.",
    image: "results/reference-spine.png",
    exported: fs.existsSync(path.join(OUT, "reference-spine-export.png"))
      ? "results/reference-spine-export.png"
      : null,
  };

  results.studies["generative-art"] = {
    label: "Generative art",
    status: "manual / generative only",
    note: "No image model is available in this run. The study is a fixed two-cover experiment, so this book has no automatic generative result.",
  };
  results.studies["popular-books"] = {
    label: "Popular books",
    status: "not applicable",
    note: "A curated popular-books shelf, not a per-cover pipeline, so the shared book is not run through it.",
  };

  fs.writeFileSync(path.join(ROOT, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.studies, null, 2));
  if (results.errors.length) console.error(results.errors);
  await browser.close();
})();
