#!/usr/bin/env node
/*
 * App-reproducibility audit for the Popular Editions Pack.
 *
 *   node popular-app/tests/audit.cjs
 *
 * Starts a local static server, then checks first load, offline cache, matching,
 * missing/corrupt/rejected editions, rights policy, 390/320 px overflow and the
 * 1x/2x Hybrid + Art-only renders. Writes tests/results.json and screenshots.
 */

const { chromium } = require("@playwright/test");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HERE = __dirname;
const APP = path.resolve(HERE, "..");
const ROOT = path.resolve(APP, "..");
const PORT = Number(process.env.AUDIT_PORT || 4189);
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/popular-app/`;
const SHOTS = path.join(APP, "screenshots");

const results = {
  schema: "pocketlibrary.popular-editions-audit/1",
  generatedAt: new Date().toISOString(),
  url: URL,
  pack: null,
  firstLoad: null,
  simulatedDownload: null,
  offline: null,
  scenarios: [],
  matching: null,
  widths: [],
  errors: [],
  screenshots: [],
  verdict: null,
};

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
  return ok;
}

function waitForServer(url, attempts = 50) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const ping = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on("error", () => {
        if (++n >= attempts) reject(new Error(`Server did not start at ${url}`));
        else setTimeout(ping, 120);
      });
    };
    ping();
  });
}

async function readPackSize() {
  const raw = await fs.readFile(path.join(APP, "pack", "size.json"), "utf8");
  return JSON.parse(raw);
}

function setupPage(page, errors) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    // Offline checks intentionally fail requests; callers decide whether that
    // is an error. We only record unexpected failures when online.
    if (!page.__offline) errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText || ""}`);
  });
}

async function ready(page) {
  await page.waitForFunction(() => window.PopularApp && window.PopularApp.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.PopularApp.ready);
  await page.waitForTimeout(120);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const size = await readPackSize();
  results.pack = {
    id: size.packId,
    version: size.version,
    entries: size.entryCount,
    files: size.fileCount,
    totalBytes: size.totalBytes,
    totalKiB: size.totalKiB,
    zipBytes: size.zipBytes,
    zipKiB: size.zipKiB,
    manifestBytes: size.manifestBytes,
  };

  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const shutdown = () => { try { server.kill("SIGTERM"); } catch {} };
  process.on("exit", shutdown);

  try {
    await waitForServer(URL);
    const browser = await chromium.launch();

    /* ---------- functional pass at 390 --------------------------------- */
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      setupPage(page, errors);

      await page.goto(URL, { waitUntil: "load" });
      await ready(page);

      let state = await page.evaluate(() => window.PopularApp.getState());
      results.firstLoad = {
        source: state.source,
        version: state.version,
        loadMs: state.stats.loadMs,
        verifyMs: state.stats.verifyMs,
        verifiedFiles: state.stats.verifiedFiles,
        files: state.stats.files,
        entries: state.stats.entries,
        acceptedEntries: state.stats.acceptedEntries,
        cacheFiles: state.cache.files,
        cacheBytes: state.cache.bytes,
      };
      check(state.ok, "pack did not load");
      check(state.stats.verifiedFiles === state.stats.files && state.stats.files === 18, "not all 18 files verified on first load");
      check(state.cache.files === 18, "first load did not cache 18 files");
      check(state.stats.entries === 6, "expected 6 pack entries");
      check(state.overflow.overflow === false, "page overflow on first load");
      check(state.stats.loadMs < 5000, "first load over 5 s");

      await page.locator("#shelves").screenshot({ path: path.join(SHOTS, "audit-390-shelf.png") });
      await page.locator("#detail").screenshot({ path: path.join(SHOTS, "audit-390-detail.png") });
      results.screenshots.push("screenshots/audit-390-shelf.png", "screenshots/audit-390-detail.png");

      // Matching: ISBN, content hash, title+author, and an ISBN conflict.
      results.matching = await page.evaluate(async () => {
        const lib = await (await fetch("library.json")).json();
        const moby = lib.books.find((b) => b.id === "moby-dick");
        const byIsbn = window.PopularApp.match({ isbn: "9780747532699", title: "x", author: "y" });
        const byHash = window.PopularApp.match({ isbn: null, title: "x", author: "y", contentHash: moby.contentHash });
        const byTitle = window.PopularApp.match({ isbn: null, title: "the hobbit", author: "J.R.R. Tolkien", contentHash: null });
        const conflict = window.PopularApp.match({ isbn: "9999999999999", title: "The Hobbit", author: "J.R.R. Tolkien", contentHash: null });
        const norm = (v) => String(v || "").replace(/[^0-9Xx]/g, "");
        return {
          isbn: byIsbn && { entry: byIsbn.entry.id, reason: byIsbn.reason, confidence: byIsbn.confidence },
          contentHash: byHash && { entry: byHash.entry.id, reason: byHash.reason, confidence: byHash.confidence },
          titleAuthor: byTitle && { entry: byTitle.entry.id, reason: byTitle.reason, confidence: byTitle.confidence },
          isbnConflict: conflict ? { entry: conflict.entry.id, reason: conflict.reason } : null,
          normalizedIsbn: norm("978-0-7475-3269-9"),
          normalized: true,
        };
      });
      check(results.matching.isbn && results.matching.isbn.reason === "isbn", "ISBN match failed");
      check(results.matching.contentHash && results.matching.contentHash.reason === "content-hash", "content-hash match failed");
      check(results.matching.titleAuthor && results.matching.titleAuthor.reason === "title+author", "title+author match failed");
      check(results.matching.isbnConflict === null, "conflicting ISBN should block title+author match");

      // Deliberate failure modes.
      for (const name of ["first-load", "download", "offline-reload", "missing-edition", "corrupt-asset", "rejected-art"]) {
        const r = await page.evaluate((n) => window.PopularApp.runScenario(n), name);
        results.scenarios.push({ name, ok: r.ok, detail: r.detail, stats: r.stats || null, reason: r.reason || null, entryStatus: r.entryStatus || null });
        check(r.ok, `scenario ${name} failed: ${r.detail}`);
        check(r.overflow.overflow === false, `scenario ${name} overflowed`);
        if (name === "first-load" || name === "download") {
          const summary = {
            source: r.source || (r.stats && r.stats.source) || null,
            loadMs: r.stats ? r.stats.loadMs : null,
            verifyMs: r.stats ? r.stats.verifyMs : null,
            verifiedFiles: r.stats ? r.stats.verifiedFiles : null,
            files: r.stats ? r.stats.files : null,
          };
          if (name === "first-load") results.firstLoad = { ...results.firstLoad, ...summary };
          else results.simulatedDownload = summary;
        }
        if (name === "corrupt-asset") {
          const entry = await page.evaluate(() => window.PopularApp.getEntry("the-hobbit"));
          const resolved = await page.evaluate(() => window.PopularApp.resolve("the-hobbit"));
          check(entry && entry.status !== "verified", "corrupt asset was not rejected");
          check(resolved && resolved.mode === "fallback", "corrupt asset did not fall back");
        }
        if (name === "rejected-art") {
          const entry = await page.evaluate(() => window.PopularApp.getEntry("lord-of-the-rings"));
          const resolved = await page.evaluate(() => window.PopularApp.resolve("lord-of-the-rings"));
          check(entry && entry.quality.status === "reject", "Lord of the Rings is not marked rejected");
          check(resolved && resolved.mode === "fallback" && resolved.reason === "quality-reject", "rejected art did not fall back");
        }
        if (name === "missing-edition") {
          const resolved = await page.evaluate(() => window.PopularApp.resolve("project-hail-mary"));
          check(resolved && resolved.mode === "fallback" && resolved.reason === "no-edition-match", "missing edition did not fall back");
        }
      }

      // Real network-off reload: the shell comes from the gallery service
      // worker, the pack comes from IndexedDB, and every cached blob is re-hashed.
      await page.evaluate(() => window.PopularApp.load({ mode: "bundled" }));
      const swReady = await page.evaluate(() => window.PopularApp.swReady);
      check(swReady, "gallery shell service worker was not ready");
      page.__offline = true;
      await context.setOffline(true);
      await page.reload({ waitUntil: "load" });
      await ready(page);
      const offlineState = await page.evaluate(() => window.PopularApp.getState());
      const offline = await page.evaluate(() => window.PopularApp.load({ mode: "offline" }));
      results.offline = {
        reloaded: true,
        shellFromServiceWorker: Boolean(swReady),
        ok: offlineState.ok,
        source: offlineState.source,
        loadMs: offline.stats ? offline.stats.loadMs : null,
        verifiedFiles: offline.stats ? offline.stats.verifiedFiles : null,
        files: offline.stats ? offline.stats.files : null,
        networkFiles: offline.stats ? offline.stats.networkFiles : null,
        cachedFiles: offline.stats ? offline.stats.cachedFiles : null,
        cacheFiles: offlineState.cache.files,
        stateStats: offlineState.stats,
      };
      check(offlineState.ok, "offline page reload did not render the pack");
      check(offlineState.stats && offlineState.stats.verifiedFiles === 18, "offline page reload did not verify all files");
      check(offline.ok, "offline cache-only load failed");
      check(offline.source === "cache", `offline load used ${offline.source}, expected cache`);
      check(offline.stats && offline.stats.networkFiles === 0, "offline load touched the network");
      check(offline.stats && offline.stats.verifiedFiles === 18, "offline load did not verify all files");
      await context.setOffline(false);
      page.__offline = false;

      // Rights gate last, then restore study mode.
      const rights = await page.evaluate(() => window.PopularApp.runScenario("rights-gate"));
      results.scenarios.push({ name: "rights-gate", ok: rights.ok, detail: rights.detail, stats: rights.stats || null, reason: rights.reason || null });
      check(rights.ok, `rights gate failed: ${rights.detail}`);
      check(rights.stats && rights.stats.acceptedEntries === 2, "release mode should accept only the 2 cleared entries");
      await page.evaluate(() => window.PopularApp.setPolicy("study"));
      await page.evaluate(() => window.PopularApp.load({ mode: "bundled" }));

      results.errors.push(...errors);
      check(errors.length === 0, `console/page errors: ${errors.join(" | ")}`);
      await context.close();
    }

    /* ---------- width + render matrix -------------------------------- */
    for (const width of [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      setupPage(page, errors);
      await page.goto(URL, { waitUntil: "load" });
      await ready(page);

      const widthResult = { width, overflow: false, consoleErrors: 0, modes: [], scrollWidth: width };
      for (const mode of ["hybrid", "artonly"]) {
        for (const scale of [1, 2]) {
          await page.evaluate(({ m, s }) => { window.PopularApp.setMode(m); window.PopularApp.setScale(s); }, { m: mode, s: scale });
          await page.waitForTimeout(80);
          const measurement = await page.evaluate(() => {
            const spines = Array.from(document.querySelectorAll("#shelves .spine")).map((s) => {
              const r = s.getBoundingClientRect();
              return {
                id: s.dataset.bookId,
                mode: s.dataset.mode,
                reason: s.dataset.reason,
                width: Math.round(r.width),
                height: Math.round(r.height),
                fit: Number(s.dataset.fit),
              };
            });
            return { overflow: window.PopularApp.measureOverflow(), spines, state: window.PopularApp.getState() };
          });
          const expectedW = 52 * scale;
          const expectedH = 236 * scale;
          const artSpines = measurement.spines.filter((s) => s.mode !== "fallback");
          const fallbackSpines = measurement.spines.filter((s) => s.mode === "fallback");
          const sizesOk = measurement.spines.every((s) => s.width === expectedW && s.height === expectedH);
          const fitOk = measurement.spines.every((s) => !Number.isFinite(s.fit) || s.fit <= 1.001);
          check(!measurement.overflow.overflow, `${width}/${mode}/${scale} overflowed: ${JSON.stringify(measurement.overflow.offenders.slice(0, 3))}`);
          check(sizesOk, `${width}/${mode}/${scale} spine size mismatch`);
          check(fitOk, `${width}/${mode}/${scale} type does not fit`);
          check(artSpines.length === 5, `${width}/${mode}/${scale} expected 5 art-eligible spines, got ${artSpines.length}`);
          check(fallbackSpines.length === 2, `${width}/${mode}/${scale} expected 2 fallbacks, got ${fallbackSpines.length}`);
          widthResult.modes.push({
            mode,
            scale,
            overflow: measurement.overflow.overflow,
            scrollWidth: measurement.overflow.scrollWidth,
            spines: measurement.spines.map((s) => ({ id: s.id, mode: s.mode, reason: s.reason, width: s.width, height: s.height, fit: s.fit })),
            artSpines: artSpines.length,
            fallbackSpines: fallbackSpines.length,
          });
        }
      }
      const finalOverflow = await page.evaluate(() => window.PopularApp.measureOverflow());
      widthResult.overflow = finalOverflow.overflow;
      widthResult.scrollWidth = finalOverflow.scrollWidth;
      widthResult.consoleErrors = errors.length;
      results.widths.push(widthResult);
      results.errors.push(...errors.map((e) => `${width}px: ${e}`));
      check(!finalOverflow.overflow, `${width}px page overflow`);
      check(errors.length === 0, `${width}px console/page errors: ${errors.join(" | ")}`);

      await page.evaluate(() => { window.PopularApp.setMode("hybrid"); window.PopularApp.setScale(1); window.PopularApp.selectBook("harry-potter"); });
      await page.waitForTimeout(80);
      const full = path.join(SHOTS, `audit-${width}-hybrid-1x.png`);
      await page.screenshot({ path: full, fullPage: true });
      results.screenshots.push(`screenshots/audit-${width}-hybrid-1x.png`);
      await page.evaluate(() => { window.PopularApp.setMode("artonly"); window.PopularApp.setScale(2); });
      await page.waitForTimeout(80);
      const art2 = path.join(SHOTS, `audit-${width}-artonly-2x.png`);
      await page.screenshot({ path: art2, fullPage: true });
      results.screenshots.push(`screenshots/audit-${width}-artonly-2x.png`);
      await context.close();
    }

    await browser.close();
  } finally {
    shutdown();
  }

  results.verdict = failures.length === 0 ? "app-reproducible" : "failing";
  results.failures = failures;
  results.summary = {
    firstLoadMs: results.firstLoad && results.firstLoad.loadMs,
    simulatedDownloadMs: results.simulatedDownload && results.simulatedDownload.loadMs,
    offlineSource: results.offline && results.offline.source,
    packKiB: results.pack && results.pack.totalKiB,
    zipKiB: results.pack && results.pack.zipKiB,
    scenarios: results.scenarios.length,
    scenariosPassed: results.scenarios.filter((s) => s.ok).length,
    widths: results.widths.map((w) => w.width),
    consoleErrors: results.errors.length,
  };
  await fs.writeFile(path.join(HERE, "results.json"), JSON.stringify(results, null, 2) + "\n");

  console.log(JSON.stringify(results.summary, null, 2));
  if (failures.length) {
    console.error("FAILURES:");
    for (const f of failures) console.error(" - " + f);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
