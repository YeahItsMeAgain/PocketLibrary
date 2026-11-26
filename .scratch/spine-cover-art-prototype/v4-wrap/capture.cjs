#!/usr/bin/env node
/**
 * Capture + audit for the v4 wrap compositor.
 *
 * Run from the repo root:
 *   node .scratch/spine-cover-art-prototype/v4-wrap/capture.cjs
 *
 * Playwright is resolved from the PocketLibrary root node_modules, matching the
 * other prototypes in this folder. The static server is expected on port 4173.
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("/mnt/ssd2/Projects/PocketLibrary/node_modules/playwright");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype/v4-wrap/";
const OUT = path.join(__dirname, "screenshots");
const AUDIT = path.join(__dirname, "audit.json");
const VIEWPORTS = [390, 360, 320];

fs.mkdirSync(OUT, { recursive: true });

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(`Not a PNG: ${file}`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

async function waitReady(page) {
  await page.waitForFunction(
    () => window.PocketWrap && window.PocketWrap.ready === true,
    null,
    { timeout: 20000 }
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function auditPage(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const m = window.PocketWrap.getMetrics();
    const images = [...document.images].map((img) => ({
      src: img.getAttribute("src"),
      ok: img.complete && img.naturalWidth > 0,
    }));
    const canvases = {};
    for (const id of ["wrapCanvas", "compareV4", "compareV4Zoom", "faceFront", "faceBack", "faceSpine"]) {
      const c = document.getElementById(id);
      canvases[id] = c ? { width: c.width, height: c.height } : null;
    }

    const n = m.layout;
    const foldContinuity = {
      backFoldEqualsSpineX: Math.abs(n.backFold - n.spineX) < 1e-9,
      spineEndEqualsFrontFold:
        Math.abs(n.spineX + n.spineIn - n.frontFold) < 1e-9,
    };

    // Read the two fold columns of the on-screen wrap. A gap would show up as
    // transparent or bare-canvas pixels down the column.
    const c = document.getElementById("wrapCanvas");
    const ctx = c.getContext("2d");
    const pxPerIn = c.width / n.totalW;
    const columns = [
      Math.min(c.width - 1, Math.max(0, Math.round(n.backFold * pxPerIn))),
      Math.min(c.width - 1, Math.max(0, Math.round(n.frontFold * pxPerIn))),
    ];
    const foldPixels = columns.map((x) => {
      const data = ctx.getImageData(x, 0, 1, c.height).data;
      let alpha0 = 0;
      let white = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) alpha0++;
        if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) white++;
      }
      return { x, transparentPixels: alpha0, nearWhitePixels: white, total: c.height };
    });

    return {
      overflow: {
        document: doc.scrollWidth - doc.clientWidth,
        body: body.scrollWidth - doc.clientWidth,
        hasHorizontalScroll: doc.scrollWidth > doc.clientWidth,
      },
      images,
      allImagesLoaded: images.every((i) => i.ok),
      canvases,
      metrics: m,
      foldContinuity,
      foldPixels,
    };
  });
}

async function setState(page, patch) {
  await page.evaluate(async (p) => {
    await window.PocketWrap.setState(p);
  }, patch);
  await page.waitForTimeout(120);
}

async function shot(page, selector, name) {
  if (!selector) {
    await page.screenshot({
      path: path.join(OUT, name),
      animations: "disabled",
      fullPage: true,
    });
    return;
  }
  await page.locator(selector).screenshot({
    path: path.join(OUT, name),
    animations: "disabled",
  });
}

(async () => {
  const browser = await chromium.launch();
  const audit = {
    generatedAt: new Date().toISOString(),
    url: BASE,
    viewports: {},
    samples: [],
    stressAtOneInch: {},
    fallback48Pages: null,
    rpsForcedCover: null,
    export: null,
  };

  const widths = {};
  for (const width of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const failedRequests = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("requestfailed", (r) =>
      failedRequests.push(`${r.url()} · ${r.failure()?.errorText || "failed"}`)
    );

    await page.goto(BASE, { waitUntil: "networkidle" });
    await waitReady(page);

    if (width === 390) {
      await shot(page, null, "01-full-390.png");
      await shot(page, "body > .page > .hero", "02-hero-390.png");
    }

    await shot(page, "#wrap", `03-wrap-whisper-${width}.png`);
    await shot(page, "#compare", `04-compare-${width}.png`);
    await shot(page, "#three", `05-3d-${width}.png`);

    // RPS defaults to the typographic fallback.
    await setState(page, { bookId: "rock-paper-scissors", pages: 320, mode: "type" });
    if (width === 390) await shot(page, "#wrap", "06-rps-typographic-390.png");
    if (width === 320) await shot(page, "#wrap", "07-rps-typographic-320.png");

    // Classic, cover-derived.
    await setState(page, { bookId: "moby-dick", pages: 320, mode: "cover" });
    if (width === 390) await shot(page, "#wrap", "08-moby-cover-390.png");

    // 1-inch stress: set the button, then check the measured fit.
    await setState(page, { bookId: "whisper-man", pages: 320, mode: "cover" });
    await page.locator("#stressBtn").click();
    await page.waitForTimeout(500);
    const stressed = await page.evaluate(() => window.PocketWrap.getMetrics());
    if (width === 390) await shot(page, "#wrap", "09-stress-1in-390.png");
    if (width === 320) await shot(page, "#wrap", "10-stress-1in-320.png");

    // The cover-rail 1-inch fit for all three books, independent of the
    // current page count, so the test is repeatable.
    const stress = {};
    for (const id of ["whisper-man", "rock-paper-scissors", "moby-dick"]) {
      await setState(page, { bookId: id, pages: 320, mode: "cover" });
      const m = await page.evaluate(() => window.PocketWrap.getMetrics());
      stress[id] = {
        stressPt: m.stress.pt,
        stressOk: m.stress.ok,
        stressAcrossPx: m.stress.acrossPx,
        stressAvailableAcrossPx: m.stress.availableAcrossPx,
        stressLengthPx: m.stress.lengthPx,
        stressAvailableLengthPx: m.stress.availableLengthPx,
      };
    }

    // 48-page fallback: too thin for the cover rail, so it must switch.
    await setState(page, { bookId: "whisper-man", pages: 48, mode: "cover" });
    const fallback = await page.evaluate(() => window.PocketWrap.getMetrics());

    // Force a cover-derived spine on RPS to prove the warning is visible.
    await setState(page, { bookId: "rock-paper-scissors", pages: 320, mode: "cover" });
    const forced = await page.evaluate(() => window.PocketWrap.getMetrics());

    const pageAudit = await auditPage(page);
    widths[width] = {
      overflow: pageAudit.overflow,
      allImagesLoaded: pageAudit.allImagesLoaded,
      images: pageAudit.images,
      canvases: pageAudit.canvases,
      foldContinuity: pageAudit.foldContinuity,
      foldPixels: pageAudit.foldPixels,
      pageErrors,
      consoleErrors,
      failedRequests,
      fontsLoaded: pageAudit.metrics.fonts.loaded,
    };

    if (!audit.stressAtOneInch[width]) audit.stressAtOneInch[width] = stress;
    if (!audit.fallback48Pages) {
      audit.fallback48Pages = {
        spineIn: fallback.spine.spineIn,
        effectiveMode: fallback.effectiveMode,
        fitPt: fallback.fit.pt,
        fitOk: fallback.fit.ok,
        decisions: fallback.decisions,
      };
    }
    if (!audit.rpsForcedCover) {
      audit.rpsForcedCover = {
        effectiveMode: forced.effectiveMode,
        fitPt: forced.fit.pt,
        fitOk: forced.fit.ok,
        decisions: forced.decisions,
      };
    }
    if (width === 390) {
      audit.stressButton = {
        pages: stressed.spine.pages,
        spineIn: stressed.spine.spineIn,
        fitPt: stressed.fit.pt,
        fitOk: stressed.fit.ok,
        stressPt: stressed.stress.pt,
        stressOk: stressed.stress.ok,
      };
    }

    // Export from the 390 px pass, at 320 pages / cover-derived.
    if (width === 390) {
      await setState(page, { bookId: "whisper-man", pages: 320, mode: "cover" });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator("#exportBtn").click(),
      ]);
      const outFile = path.join(OUT, "17-export-whisper-320pp-300dpi.png");
      await download.saveAs(outFile);
      audit.export = {
        suggestedFilename: download.suggestedFilename(),
        savedAs: path.relative(__dirname, outFile),
        ...pngSize(outFile),
        guides: "omitted by export renderer",
      };
    }

    await context.close();
  }

  // Sample dimensions table (at 390 px, 320 pages, cream 80 gsm, 6 × 9 in).
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitReady(page);
  for (const sample of [
    { bookId: "whisper-man", mode: "cover", label: "Whisper Man · cover-derived" },
    { bookId: "whisper-man", mode: "type", label: "Whisper Man · typographic" },
    { bookId: "rock-paper-scissors", mode: "type", label: "Rock Paper Scissors · typographic" },
    { bookId: "moby-dick", mode: "cover", label: "Moby-Dick · cover-derived" },
  ]) {
    await setState(page, { ...sample, pages: 320 });
    const m = await page.evaluate(() => window.PocketWrap.getMetrics());
    audit.samples.push({
      label: sample.label,
      book: m.book.title,
      mode: m.effectiveMode,
      pages: m.spine.pages,
      spineIn: m.spine.spineIn,
      spineMm: m.spine.spineMm,
      wrapIn: [m.layout.totalW, m.layout.totalH],
      printPx: [m.print.width, m.print.height],
      fitPt: m.fit.pt,
      fitOk: m.fit.ok,
      fitRatio: m.fit.ratio,
      stressOk: m.stress.ok,
      edge: m.edge.hex,
      edgeSd: m.edge.sd,
    });
  }
  await context.close();

  audit.viewports = widths;
  fs.writeFileSync(AUDIT, JSON.stringify(audit, null, 2) + "\n");

  console.log("v4 wrap capture complete");
  console.log(`URL: ${BASE}`);
  console.log(`Audit: ${AUDIT}`);
  for (const s of audit.samples) {
    console.log(
      `${s.label}: ${s.spineIn.toFixed(3)} in spine · ${s.wrapIn[0].toFixed(3)} × ${s.wrapIn[1].toFixed(3)} in · ${s.printPx[0]}×${s.printPx[1]} px · ${s.fitPt.toFixed(1)} pt · fit ${s.fitOk} · 1-in ${s.stressOk}`
    );
  }
  console.log(
    `1-in stress button: ${audit.stressButton.pages} pp → ${audit.stressButton.spineIn.toFixed(3)} in · ${audit.stressButton.stressPt.toFixed(1)} pt · ${audit.stressButton.stressOk}`
  );
  console.log(
    `Export: ${audit.export.width}×${audit.export.height} px · ${audit.export.bytes} bytes`
  );
  for (const [w, v] of Object.entries(widths)) {
    console.log(
      `${w}px: overflow=${v.overflow.document}, images=${v.allImagesLoaded}, folds=${v.foldContinuity.backFoldEqualsSpineX && v.foldContinuity.spineEndEqualsFrontFold}, errors=${v.pageErrors.length + v.consoleErrors.length}, failed=${v.failedRequests.length}`
    );
  }

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
