#!/usr/bin/env node
/**
 * Textless Art Pack — browser verification.
 *
 * Prerequisite: the static host from the repo root, e.g.
 *   python3 -m http.server 4173 --bind 0.0.0.0 --directory .scratch
 *
 * Run:
 *   node .scratch/spine-cover-art-prototype/textless-app/tests/run.cjs
 *
 * Env:
 *   BASE_URL  override the gallery URL
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.resolve(__dirname, "../../../..", "node_modules/playwright"));

const APP = path.resolve(__dirname, "..");
const SHOTS = path.join(APP, "screenshots");
const RESULTS = path.join(__dirname, "results.json");
const BASE = process.env.BASE_URL || "http://127.0.0.1:4173/spine-cover-art-prototype/textless-app/";

const checks = [];
const timings = [];
const consoleEvents = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function bytesOf(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? bytesOf(p) : fs.statSync(p).size;
  }
  return total;
}

async function waitReady(page) {
  await page.waitForFunction(
    () => window.__textless && window.__textless.getState().rendered === true,
    null,
    { timeout: 45000 },
  );
}

async function open(browser, { width, height = 844, query = "", offlineReload = false, shot = null }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const events = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") events.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    events.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });

  const started = Date.now();
  await page.goto(new URL(query, BASE).href, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  const wallMs = Date.now() - started;

  if (offlineReload) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    if (!controlled) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(page);
    }
    await context.setOffline(true);
    const offlineStarted = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady(page);
    events.offlineWallMs = Date.now() - offlineStarted;
  }

  await page.waitForTimeout(120);
  const state = await page.evaluate(() => window.__textless.getState());
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector(".spine-canvas");
    const rect = canvas?.getBoundingClientRect();
    const stage = document.querySelector(".stage")?.getBoundingClientRect();
    const style = canvas ? getComputedStyle(canvas) : null;
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      stageWidth: stage ? stage.width : null,
      canvasCss: style ? { width: style.width, height: style.height } : null,
      canvasRect: rect ? { width: rect.width, height: rect.height } : null,
      canvasBacking: canvas ? { width: canvas.width, height: canvas.height } : null,
      cards: document.querySelectorAll(".book-card").length,
      selected: document.querySelector(".book-card[data-selected='true']")?.dataset.id || null,
    };
  });

  if (shot) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true, scale: "css" });
  }

  timings.push({ width, query: query || "(none)", offlineReload, wallMs, state: state.timings, offlineWallMs: events.offlineWallMs || null });
  consoleEvents.push({ width, query: query || "(none)", offlineReload, ...events });
  return { context, page, state, layout, events };
}

async function expectClean(name, events) {
  check(`${name}: no console errors`, events.consoleErrors.length === 0, events.consoleErrors.join(" | "));
  check(`${name}: no page errors`, events.pageErrors.length === 0, events.pageErrors.join(" | "));
  check(`${name}: no failed requests`, events.failedRequests.length === 0, events.failedRequests.join(" | "));
}

async function expectNoOverflow(name, layout) {
  const pageOk = layout.docScrollWidth <= layout.innerWidth && layout.bodyScrollWidth <= layout.innerWidth;
  check(
    `${name}: no page overflow`,
    pageOk,
    `doc ${layout.docScrollWidth} / body ${layout.bodyScrollWidth} / viewport ${layout.innerWidth}`,
  );
  check(
    `${name}: spine canvas is 52x236 CSS with 104x472 backing`,
    layout.canvasCss?.width === "52px" &&
      layout.canvasCss?.height === "236px" &&
      layout.canvasBacking?.width === 104 &&
      layout.canvasBacking?.height === 472,
    `${JSON.stringify(layout.canvasCss)} / ${JSON.stringify(layout.canvasBacking)}`,
  );
}

(async () => {
  const summary = JSON.parse(fs.readFileSync(path.join(APP, "pack-summary.json"), "utf8"));
  const lock = JSON.parse(
    fs
      .readFileSync(path.join(APP, "pack-lock.js"), "utf8")
      .replace(/^[\s\S]*?Object\.freeze\(/, "")
      .replace(/\);\s*$/, ""),
  );
  const actualPackBytes = bytesOf(path.join(APP, "pack"));

  console.log(`\nTextless Art Pack verification\n${BASE}\n`);
  check("pack-summary matches the pack on disk", summary.packBytes === actualPackBytes, `${actualPackBytes} bytes`);
  check(
    "lock matches the built manifest",
    lock.manifestBytes === summary.manifestBytes && lock.manifestSha256 === summary.manifestSha256,
    `${lock.manifestSha256.slice(0, 12)}…`,
  );
  check(
    "pack is small enough to ship or download",
    actualPackBytes < 2 * 1024 * 1024,
    `${(actualPackBytes / 1048576).toFixed(3)} MiB, ${summary.available} art books`,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    // 1. first load, 390
    const first = await open(browser, { width: 390, shot: "01-first-load-390.png" });
    check(
      "first load: 18 art spines and 2 licence fallbacks",
      first.state.counts.ready === 18 && first.state.counts.unavailable === 2 && first.state.counts.art === 18 && first.state.counts.fallback === 2,
      JSON.stringify(first.state.counts),
    );
    check("first load: manifest source is network", first.state.manifestSource === "network", first.state.manifestSource);
    check("first load: manifest matches lock", first.state.manifestSha256 === lock.manifestSha256);
    check("first load: all 36 assets verified", first.state.counters.verified === 36 && first.state.counters.total === 36, JSON.stringify(first.state.counters));
    check("first load: 20 catalog books rendered", first.layout.cards === 20, String(first.layout.cards));
    await expectNoOverflow("first load 390", first.layout);
    await expectClean("first load 390", first.events);
    const lookups = await first.page.evaluate(() => window.__textless.runLookupChecks());
    check("lookups: content hash → ISBN → title+author → unknown", lookups.length === 4 && lookups.every((r) => r.ok), JSON.stringify(lookups.map((r) => `${r.label}:${r.got}`)));
    await first.page.click('.book-card[data-id="alice"] .spine-btn');
    await first.page.waitForFunction(
      () => document.querySelector("#detail .detail-title")?.textContent.includes("Alice"),
      null,
      { timeout: 5000 },
    );
    const detail = await first.page.evaluate(() => {
      const canvas = document.querySelector("#detail-canvas");
      return {
        title: document.querySelector("#detail .detail-title")?.textContent,
        backing: canvas ? { width: canvas.width, height: canvas.height } : null,
        selected: document.querySelector(".book-card[data-selected='true']")?.dataset.id,
      };
    });
    check(
      "selection: click updates the detail and selects the card",
      detail.title?.includes("Alice") && detail.selected === "alice" && detail.backing?.width === 208 && detail.backing?.height === 944,
      JSON.stringify(detail),
    );
    check(
      "selection: no console/page errors after click",
      first.events.consoleErrors.length === 0 && first.events.pageErrors.length === 0,
      [...first.events.consoleErrors, ...first.events.pageErrors].join(" | "),
    );
    const [download] = await Promise.all([
      first.page.waitForEvent("download", { timeout: 15000 }),
      first.page.click("#btn-2x"),
    ]);
    check(
      "export: 2× PNG downloads at 104×472",
      /-spine-104x472\.png$/.test(download.suggestedFilename()),
      download.suggestedFilename(),
    );
    await first.context.close();

    // 2. first load, 320
    const narrow = await open(browser, { width: 320, shot: "02-first-load-320.png" });
    check("320: 18 art spines", narrow.state.counts.ready === 18, JSON.stringify(narrow.state.counts));
    await expectNoOverflow("first load 320", narrow.layout);
    await expectClean("first load 320", narrow.events);
    await narrow.context.close();

    // 3. offline reload
    const offline = await open(browser, { width: 390, offlineReload: true, shot: "03-offline-reload-390.png" });
    check("offline reload: manifest came from IndexedDB", offline.state.manifestSource === "cache", offline.state.manifestSource);
    check(
      "offline reload: same 18 art spines",
      offline.state.counts.ready === 18 && offline.state.counts.art === 18,
      JSON.stringify(offline.state.counts),
    );
    check(
      "offline reload: all 36 assets verified from cache",
      offline.state.counters.verified === 36 && offline.state.counters.downloads === 0,
      JSON.stringify(offline.state.counters),
    );
    check("offline reload: shell was cached", typeof offline.events.offlineWallMs === "number", `${offline.events.offlineWallMs} ms`);
    await expectNoOverflow("offline 390", offline.layout);
    await expectClean("offline reload", offline.events);
    await offline.context.close();

    // 4. missing pack
    const missing = await open(browser, { width: 390, query: "?fixture=missing", shot: "04-missing-pack-390.png" });
    check("missing pack: source is missing", missing.state.manifestSource === "missing", missing.state.manifestSource);
    check(
      "missing pack: all 20 books fall back",
      missing.state.counts.missing === 20 && missing.state.counts.art === 0 && missing.state.counts.fallback === 20,
      JSON.stringify(missing.state.counts),
    );
    check("missing pack: 20 generated plates rendered", missing.layout.cards === 20, String(missing.layout.cards));
    await expectNoOverflow("missing 390", missing.layout);
    await expectClean("missing pack", missing.events);
    await missing.context.close();

    const missing320 = await open(browser, { width: 320, query: "?fixture=missing" });
    await expectNoOverflow("missing 320", missing320.layout);
    await expectClean("missing 320", missing320.events);
    await missing320.context.close();

    // 5. corrupt hash
    const corrupt = await open(browser, { width: 390, query: "?fixture=corrupt", shot: "05-corrupt-hash-390.png" });
    check(
      "corrupt hash: one book rejected, 17 art remain",
      corrupt.state.counts.corrupt === 1 && corrupt.state.counts.ready === 17 && corrupt.state.counts.art === 17,
      JSON.stringify(corrupt.state.counts),
    );
    const corruptCard = await corrupt.page.evaluate(() => {
      const card = document.querySelector(".book-card[data-id='moby-dick']");
      return card ? { status: card.dataset.status, label: card.querySelector(".book-state")?.textContent } : null;
    });
    check(
      "corrupt hash: the corrupted item fell back",
      corruptCard?.status === "corrupt" && corruptCard?.label === "corrupt",
      JSON.stringify(corruptCard),
    );
    await expectNoOverflow("corrupt 390", corrupt.layout);
    await expectClean("corrupt hash", corrupt.events);
    await corrupt.context.close();

    const corrupt320 = await open(browser, { width: 320, query: "?fixture=corrupt" });
    await expectNoOverflow("corrupt 320", corrupt320.layout);
    await expectClean("corrupt 320", corrupt320.events);
    await corrupt320.context.close();

    // 6. unknown book
    const unknown = await open(browser, { width: 390, query: "?fixture=unknown", shot: "06-unknown-book-390.png" });
    check(
      "unknown book: 18 art + 1 unknown fallback",
      unknown.state.counts.unknown === 1 && unknown.state.counts.ready === 18 && unknown.state.counts.art === 18,
      JSON.stringify(unknown.state.counts),
    );
    check("unknown book: 21 cards rendered", unknown.layout.cards === 21, String(unknown.layout.cards));
    const unknownCard = await unknown.page.evaluate(() => {
      const card = document.querySelector(".book-card[data-id='probe-unknown']");
      return card ? { status: card.dataset.status, label: card.querySelector(".book-state")?.textContent } : null;
    });
    check("unknown book: reports unknown", unknownCard?.status === "unknown", JSON.stringify(unknownCard));
    await expectNoOverflow("unknown 390", unknown.layout);
    await expectClean("unknown book", unknown.events);
    await unknown.context.close();

    const unknown320 = await open(browser, { width: 320, query: "?fixture=unknown" });
    await expectNoOverflow("unknown 320", unknown320.layout);
    await expectClean("unknown 320", unknown320.events);
    await unknown320.context.close();

    // 7. load-time samples, fresh contexts
    for (let i = 1; i <= 3; i += 1) {
      const sample = await open(browser, { width: 390 });
      check(`load sample ${i}: rendered`, sample.state.rendered === true, `${sample.state.timings.readyMs.toFixed(1)} ms in-page`);
      await sample.context.close();
    }
  } finally {
    await browser.close();
  }

  const readySamples = timings
    .filter((t) => !t.query.startsWith("?fixture="))
    .map((t) => t.state.readyMs)
    .sort((a, b) => a - b);
  const medianReady = readySamples.length ? readySamples[Math.floor(readySamples.length / 2)] : 0;
  const wallSamples = timings
    .filter((t) => t.query === "(none)" && !t.offlineReload)
    .map((t) => t.wallMs)
    .sort((a, b) => a - b);
  const medianWall = wallSamples.length ? wallSamples[Math.floor(wallSamples.length / 2)] : 0;
  const offlineSample = timings.find((t) => t.offlineReload);

  const failures = checks.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    pack: {
      bytes: actualPackBytes,
      mib: +(actualPackBytes / 1048576).toFixed(3),
      manifestBytes: summary.manifestBytes,
      availableBooks: summary.available,
      excludedBooks: summary.excluded,
      spineBytes: summary.spineBytes,
      artBytes: summary.artBytes,
      manifestSha256: summary.manifestSha256,
    },
    timings: {
      samples: timings,
      medianReadyMs: +medianReady.toFixed(1),
      medianWallMs: medianWall,
      offlineReloadMs: offlineSample?.offlineWallMs ?? null,
    },
    checks,
    summary: { total: checks.length, passed: checks.length - failures.length, failed: failures.length },
    screenshots: fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).sort() : [],
    consoleEvents,
  };
  fs.writeFileSync(RESULTS, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nPack: ${report.pack.mib} MiB (${actualPackBytes} bytes), ${summary.available} art books + ${summary.excluded} metadata-only records`);
  console.log(`Median ready: ${report.timings.medianReadyMs} ms in-page · ${medianWall} ms wall (fresh context, local static host)`);
  console.log(`Offline reload: ${report.timings.offlineReloadMs} ms`);
  console.log(`Checks: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.failed} failed`);
  console.log(`Report: ${path.relative(process.cwd(), RESULTS)}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
