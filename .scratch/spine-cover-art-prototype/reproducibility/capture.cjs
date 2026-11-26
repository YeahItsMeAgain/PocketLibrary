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

// Strict rule: the APK itself must create the spine for a random downloadable
// book, end-to-end. v8-app and App renderers are user-verified on real devices.
const STRICT_META = {
  "full-bleed": {
    desktopStatus: "Automatic",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — via App renderers, user-verified on device",
    strictEvidence: "The user tested the App renderers APK on a real device. This renderer is part of that verified APK.",
    needs: "Strict proof exists. Production Tauri/shelf integration is separate work.",
  },
  "textless-art": {
    desktopStatus: "Automatic for this book",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — via App renderers, user-verified on device",
    strictEvidence: "The user tested the App renderers APK on a real device. The art-only route is part of that verified APK.",
    needs: "Strict proof exists. Production Tauri/shelf integration is separate work.",
  },
  "wrap-engine": {
    desktopStatus: "Automatic",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — via App renderers, user-verified on device",
    strictEvidence: "The user tested the App renderers APK on a real device. The wrap route is part of that verified APK.",
    needs: "Strict proof exists. Production Tauri/shelf integration is separate work.",
  },
  "design-system": {
    desktopStatus: "Automatic",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — via App renderers, user-verified on device",
    strictEvidence: "The user tested the App renderers APK on a real device. Hybrid, Cloth and Editorial are part of that verified APK.",
    needs: "Strict proof exists. Production Tauri/shelf integration is separate work.",
  },
  "generative-art": {
    desktopStatus: "Manual only",
    strictStatus: "superseded",
    strictLabel: "Superseded by v8-app",
    strictEvidence: "Hosted FLUX/Pollinations is a design record. v8-app runs the automatic route on-device and is user-verified.",
    needs: "Use v8-app. No separate strict route is needed.",
  },
  "popular-books": {
    desktopStatus: "N/A",
    strictStatus: "pending-integration",
    strictLabel: "Via Popular app route — pending integration",
    strictEvidence: "Popular app route uses v8-app outputs in a WebView gallery. The renderer is not separately APK-verified.",
    needs: "Next gap: integrate the renderer into the app and verify on a device. v8-app and App renderers are already device-verified.",
  },
  "automatic-generative": {
    desktopStatus: "Automatic (desktop)",
    strictStatus: "superseded",
    strictLabel: "Superseded by v8-app",
    strictEvidence: "Desktop Python/torch/LaMa CLI. v8-app is the on-device pipeline and is user-verified.",
    needs: "No action; kept as a record. Use v8-app.",
  },
  reference: {
    desktopStatus: "Manual export",
    strictStatus: "not-a-route",
    strictLabel: "Not a route",
    strictEvidence: "Manual browser spine tool with hand-entered width/type. It does not turn a random cover into a spine.",
    needs: "Design-only reference. Not counted as reproducibility.",
  },
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

  for (const [id, meta] of Object.entries(STRICT_META)) {
    if (results.studies[id]) Object.assign(results.studies[id], meta);
  }
  results.studies["textless-art-pack"] = {
    label: "Textless Art Pack",
    status: "pack only",
    desktopStatus: "Pack (WebView)",
    strictStatus: "bonus",
    strictLabel: "Bonus — not strict",
    strictEvidence: "18 curated public-domain spines. Useful fast path for pack books only.",
    needs: "Bonus feature. v8-app is the random-book route.",
  };
  results.studies["popular-editions-pack"] = {
    label: "Popular Editions Pack",
    status: "pack only",
    desktopStatus: "Pack (WebView)",
    strictStatus: "bonus",
    strictLabel: "Bonus — not strict",
    strictEvidence: "Six curated editions, four reference-only. Useful fast path for pack books only.",
    needs: "Bonus feature. Popular app route uses v8-app for arbitrary covers.",
  };
  results.studies["app-renderers"] = {
    label: "App renderers",
    status: "user-verified",
    desktopStatus: "User-verified on device",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — user-verified on device",
    strictEvidence: "The user tested v8-renderers-arm64-v8a.apk on a real device and reports it works.",
    needs: "Strict proof exists. Next gap: Popular app route / Tauri integration.",
    apk: {
      name: "v8-renderers-arm64-v8a.apk",
      bytes: 21182173,
      sha256: "e0efbef0b3d382834954a8abd0e1739fb2ac2a765980a99667520a9bdc238f58",
      abi: "arm64-v8a",
      deviceTested: true,
    },
  };
  results.studies["popular-app-route"] = {
    label: "Popular app route",
    status: "webview gallery",
    desktopStatus: "WebView gallery",
    strictStatus: "pending-integration",
    strictLabel: "App-compatible — pending integration",
    strictEvidence: "Uses v8-app outputs for five popular covers and two generative cases: Dune unseen passes, LOTR falls back, RPS reviews. No separate APK.",
    needs: "Next gap: Tauri integration and a device run for this renderer. The v8-app pipeline and App renderers APK are already user-verified.",
  };
  results.studies["v8-app"] = {
    label: "v8-app",
    status: "user-verified",
    desktopStatus: "User-verified on device",
    strictStatus: "strict-reproducible",
    strictLabel: "Yes — user-verified on device",
    strictEvidence: "The user tested the v8 Android APK on a real device and reports it works. This session did not independently reproduce the device run.",
    needs: "No further proof for the pipeline. Strict proof also exists for App renderers.",
    verifiedBy: "User device test (reported 2026-11-26)",
  };
  results.rubric = {
    "strict-reproducible": "The APK takes a random downloadable book and creates the spine end-to-end. v8-app and App renderers are user-verified on real devices; the four renderer studies are verified through App renderers.",
    "pending-integration": "The route uses v8-app output and is app-compatible, but the renderer is not integrated into Tauri and not separately device-verified.",
    bonus: "A curated pack. Useful fast path for pack books, not a random-book route.",
    superseded: "An older route replaced by v8-app or the app renderer route. Kept as a design record.",
    "not-a-route": "A manual design reference. It does not turn a random cover into a spine.",
  };
  const counts = { strictReproducible: 0, pendingDeviceVerification: 0, pendingIntegration: 0, bonusNotStrict: 0, superseded: 0, notARoute: 0 };
  for (const study of Object.values(results.studies)) {
    if (study.strictStatus === "strict-reproducible") counts.strictReproducible += 1;
    else if (study.strictStatus === "pending-device-verification") counts.pendingDeviceVerification += 1;
    else if (study.strictStatus === "pending-integration") counts.pendingIntegration += 1;
    else if (study.strictStatus === "bonus") counts.bonusNotStrict += 1;
    else if (study.strictStatus === "superseded") counts.superseded += 1;
    else if (study.strictStatus === "not-a-route") counts.notARoute += 1;
  }
  results.summary = {
    ...counts,
    note: "6 yes: v8-app and App renderers are user-verified on device; Full-bleed, Textless, Wrap and Design system are verified through App renderers. 0 pending device proof. 2 pending integration (Popular books, Popular app route). 5 not strict (2 bonus packs, 2 superseded, 1 reference).",
  };
  fs.writeFileSync(path.join(ROOT, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results.studies, null, 2));
  if (results.errors.length) console.error(results.errors);
  await browser.close();
})();
