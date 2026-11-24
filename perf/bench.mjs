#!/usr/bin/env node
/**
 * Reproducible shelf benchmark for PocketLibrary ticket 13.
 *
 * Builds the real production bundle, serves it with `vite preview`, and drives
 * the actual wall UI with 2,000 generated books at a 390x844 phone viewport
 * under 4x CPU throttling. Numbers are a Chromium proxy for Android System
 * WebView; see docs/perf-shelf-benchmark.md for the method and caveats.
 *
 * Usage:
 *   node perf/bench.mjs                     # label defaults to "current"
 *   PERF_LABEL=before node perf/bench.mjs
 *   PERF_RATE=6 PERF_DPR=1 node perf/bench.mjs
 *   PERF_URL=http://localhost:1420 node perf/bench.mjs  # reuse a server
 *
 * Writes perf/results/<label>.json and prints a table.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_DIR = resolve(ROOT, "perf/.build");
const PORT = Number(process.env.PERF_PORT ?? 1439);
const BASE_URL = process.env.PERF_URL ?? `http://localhost:${PORT}`;
const LABEL = process.env.PERF_LABEL ?? "current";
const RATE = Number(process.env.PERF_RATE ?? 4);
const DPR = Number(process.env.PERF_DPR ?? 1);
const BOOK_COUNT = Number(process.env.PERF_BOOKS ?? 2000);
const BASELINE_CSS = process.env.PERF_BASELINE_CSS === "1";
const SHELF_CAPACITY = 11; // the 10-11 volumes/shelf from the research note
const SCROLL_FRAMES = 240;
const SCROLL_STEP = 14; // ~9.4 shelves per pass at 264 px/shelf

const LABEL_COLOURS = ["#6e2630", "#294735", "#6b4d18", "#2d3f6a", "#5a2f6d"];
const WORDS = [
  "Hollow", "Crown", "Lantern", "Winter", "Archive", "Garden", "Silent",
  "Atlas", "Ash", "Briar", "Clockwork", "Drowned", "Elegy", "Fox", "Glass",
  "Heretic", "Iron", "Juniper", "Kestrel", "Ledger", "Moth", "Nightingale",
  "Owl", "Pale", "Quiet", "Raven", "Salt", "Thorn", "Umber", "Vesper",
];
const AUTHORS = [
  "A. Merrow", "B. Vale", "C. Ashdown", "D. Wren", "E. Larkspur",
  "F. Osgood", "G. Thistle", "H. Marlow",
];

function makeConfig() {
  const shelves = [];
  const books = [];
  for (let i = 0; i < BOOK_COUNT; i += 1) {
    const shelfId = Math.floor(i / SHELF_CAPACITY) + 1;
    const slotIndex = i % SHELF_CAPACITY;
    const labelCount = i % 7 === 0 ? 1 + (i % 3) : 0;
    const labels = Array.from({ length: labelCount }, (_, n) => {
      const id = ((i + n) % LABEL_COLOURS.length) + 1;
      return {
        id,
        name: ["Gothic", "Nature", "History", "Travel", "Poetry"][id - 1],
        colour: LABEL_COLOURS[id - 1],
        createdAt: 1_700_000_000 + id,
      };
    });
    const title = `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]}`;
    const statuses = ["unread", "reading", "finished"];
    books.push({
      id: i + 1,
      contentHash: `bench-${i + 1}`,
      format: "epub",
      title,
      authors: [AUTHORS[i % AUTHORS.length]],
      series: i % 11 === 0 ? "The Bench Chronicles" : null,
      language: "en",
      description: "A generated volume used only by the shelf benchmark.",
      publisher: "Pocket Library Press",
      publishedDate: String(1900 + (i % 120)),
      identifier: `bench-${i + 1}`,
      pageCount: 200 + (i % 400),
      addedAt: 1_700_000_000 + i,
      shelfId,
      slotIndex,
      readingStatus: statuses[i % statuses.length],
      labels,
    });
  }
  for (let s = 1; s <= Math.ceil(BOOK_COUNT / SHELF_CAPACITY); s += 1) {
    shelves.push({ id: s, ordinal: s - 1, capacity: SHELF_CAPACITY });
  }
  return {
    state: "ready",
    folderName: "PocketLibrary",
    shelves,
    books,
    labels: LABEL_COLOURS.map((colour, index) => ({
      id: index + 1,
      name: ["Gothic", "Nature", "History", "Travel", "Poetry"][index],
      colour,
      createdAt: 1_700_000_000 + index,
    })),
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function stats(values) {
  return {
    count: values.length,
    p50: +percentile(values, 50).toFixed(1),
    p95: +percentile(values, 95).toFixed(1),
    p99: +percentile(values, 99).toFixed(1),
    max: +Math.max(0, ...values).toFixed(1),
  };
}

function round(value, digits = 1) {
  return typeof value === "number" ? +value.toFixed(digits) : value;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server still starting.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startServer() {
  const build = spawnSync(
    "npx",
    [
      "vite",
      "build",
      "--outDir",
      "perf/.build",
      "--emptyOutDir",
      "--logLevel",
      "warn",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (build.status !== 0) throw new Error("vite build failed");
  const server = spawn(
    "npx",
    [
      "vite",
      "preview",
      "--outDir",
      "perf/.build",
      "--port",
      String(PORT),
      "--strictPort",
      "--logLevel",
      "warn",
    ],
    { cwd: ROOT, stdio: "inherit", detached: true },
  );
  return server;
}

async function run() {
  const config = makeConfig();
  const shelfCount = Math.ceil(BOOK_COUNT / SHELF_CAPACITY);
  const usingExternalServer = Boolean(process.env.PERF_URL);
  const server = usingExternalServer ? null : startServer();
  const stopServer = () => {
    if (!server || server.killed) return;
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  };
  process.on("exit", stopServer);
  process.on("SIGINT", () => {
    stopServer();
    process.exit(130);
  });

  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable").catch(() => {});
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });

    await page.addInitScript(({ seed, baselineCss }) => {
      if (baselineCss) {
        // Reproduce the pre-hardening stylesheet without checking out old code:
        // CV off for shelf sections, and the old per-spine dimming filter.
        const inject = () => {
          const head = document.head ?? document.documentElement;
          if (!head) {
            setTimeout(inject, 0);
            return;
          }
          const style = document.createElement("style");
          style.textContent =
            ".v4-shelf{content-visibility:visible!important;contain-intrinsic-size:none!important}" +
            ".spine.is-dimmed{filter:saturate(0.55)!important}";
          head.appendChild(style);
        };
        inject();
      }
      window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
      window.__POCKETLIBRARY_MOCK__ = seed;
      window.__PERF__ = {
        phase: "load",
        longTasks: [],
        loaf: [],
        deltas: {},
        filter: {},
      };
      const record = (entry) => {
        window.__PERF__.longTasks.push({
          start: +entry.startTime.toFixed(1),
          duration: +entry.duration.toFixed(1),
          phase: window.__PERF__.phase,
        });
      };
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(record)).observe(
          { type: "longtask", buffered: true },
        );
      } catch {
        // longtask is not implemented everywhere; the bench still runs.
      }
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            window.__PERF__.loaf.push({
              start: +entry.startTime.toFixed(1),
              duration: +entry.duration.toFixed(1),
              blocking: +(entry.blockingDuration ?? 0).toFixed(1),
              phase: window.__PERF__.phase,
            });
          });
        }).observe({ type: "long-animation-frame", buffered: true });
      } catch {
        // Optional diagnostic.
      }

      // First shelf painted and hit-testable, from navigation time origin.
      let settled = false;
      const firstFrame = () => {
        if (settled) return;
        const shelf = document.querySelector('[data-testid="shelf"]');
        const spine = shelf?.querySelector('[data-testid="spine"]');
        if (shelf && spine) {
          const rect = shelf.getBoundingClientRect();
          if (rect.height > 0) {
            settled = true;
            requestAnimationFrame(() => {
              window.__PERF__.firstShelf = +performance.now().toFixed(1);
              requestAnimationFrame(() => {
                const spineRect = spine.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  spineRect.left + Math.min(8, spineRect.width / 2),
                  spineRect.top + Math.min(8, spineRect.height / 2),
                );
                window.__PERF__.firstInteractive = +performance.now().toFixed(1);
                window.__PERF__.firstHit = Boolean(
                  hit && (spine === hit || spine.contains(hit)),
                );
              });
            });
            return;
          }
        }
        requestAnimationFrame(firstFrame);
      };
      requestAnimationFrame(firstFrame);
    }, { seed: config, baselineCss: BASELINE_CSS });

    const startedAt = Date.now();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__PERF__?.firstShelf != null, null, {
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => window.__PERF__?.firstInteractive != null,
      null,
      { timeout: 60_000 },
    );
    const loadWallMs = Date.now() - startedAt;

    const ready = await page.evaluate(() => ({
      shelves: document.querySelectorAll('[data-testid="shelf"]').length,
      spines: document.querySelectorAll('[data-testid="spine"]').length,
      paintFcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      paintFp: performance.getEntriesByName("first-paint")[0]?.startTime ?? null,
      docHeight: document.documentElement.scrollHeight,
    }));

    // Two scroll passes: cold (first paint cache) then warm (steady state).
    const scrollPass = async (name) => {
      await page.evaluate(() => {
        window.__PERF__.phase = "scroll";
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(250);
      const deltas = await page.evaluate(
        async ({ frames, step }) => {
          const out = [];
          let last = performance.now();
          for (let i = 0; i < frames; i += 1) {
            await new Promise((resolve) => {
              requestAnimationFrame(() => {
                const now = performance.now();
                out.push(now - last);
                last = now;
                window.scrollBy(0, step);
                resolve();
              });
            });
          }
          return out;
        },
        { frames: SCROLL_FRAMES, step: SCROLL_STEP },
      );
      return deltas.map((value) => +value.toFixed(1));
    };

    const coldDeltas = await scrollPass("cold");
    const warmDeltas = await scrollPass("warm");

    // Filter apply/clear at the top of the wall, using the real chip button.
    await page.evaluate(() => {
      window.__PERF__.phase = "filter";
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(250);
    const filterResult = await page.evaluate(async () => {
      const chip = document.querySelector('[data-testid="filter-label-chip"]');
      if (!chip) return { error: "no label chip" };
      const t0 = performance.now();
      chip.click();
      void document.body.offsetHeight; // force style + layout flush
      const applySync = performance.now() - t0;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const applySettled = performance.now() - t0;
      const clear = document.querySelector('[data-testid="filter-clear"]');
      const t1 = performance.now();
      clear.click();
      void document.body.offsetHeight;
      const clearSync = performance.now() - t1;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const clearSettled = performance.now() - t1;
      return {
        applySync: +applySync.toFixed(1),
        applySettled: +applySettled.toFixed(1),
        clearSync: +clearSync.toFixed(1),
        clearSettled: +clearSettled.toFixed(1),
      };
    });

    // A drag-like per-pointer-move probe: with the wall at rest, read the
    // cached geometry path once. This is not a full gesture; it reports the
    // cost of one layout-forcing sweep that the product does on lift.
    const metrics = await cdp.send("Performance.getMetrics").catch(() => null);
    const heap = await cdp
      .send("Runtime.getHeapUsage")
      .catch(() => ({ embedderHeapUsedSize: null, usedSize: null }));
    const domCounters = await cdp
      .send("Memory.getDOMCounters")
      .catch(() => ({ nodes: null, documents: null, jsEventListeners: null }));

    // Cached geometry path once. This is not a full gesture; it reports the
    // cost of one layout-forcing sweep that the product does on lift. Run it
    // after the memory read so forcing every skipped shelf to lay out does not
    // inflate the renderer-DOM number.
    const dragProbe = await page.evaluate(async () => {
      window.__PERF__.phase = "drag";
      const wall = document.querySelector('[data-testid="library-wall"]');
      const sections = [...wall.querySelectorAll("section[data-shelf-id]")];
      const t0 = performance.now();
      sections.forEach((section) => section.getBoundingClientRect());
      const sectionSweep = performance.now() - t0;
      const t1 = performance.now();
      let spines = 0;
      sections.forEach((section) => {
        section.querySelectorAll(".spines > .spine").forEach((spine) => {
          spines += 1;
          spine.getBoundingClientRect();
        });
      });
      const spineSweep = performance.now() - t1;
      return {
        sectionSweepMs: +sectionSweep.toFixed(1),
        spineSweepMs: +spineSweep.toFixed(1),
        spines,
      };
    });

    const longTasks = await page.evaluate(() => window.__PERF__.longTasks);
    const loaf = await page.evaluate(() => window.__PERF__.loaf);
    const perf = await page.evaluate(() => window.__PERF__);

    const longTaskOver50 = longTasks.filter((task) => task.duration > 50);
    const result = {
      label: LABEL,
      generatedAt: new Date().toISOString(),
      baselineCss: BASELINE_CSS,
      environment: {
        baseUrl: BASE_URL,
        viewport: "390x844",
        deviceScaleFactor: DPR,
        cpuThrottle: RATE,
        browser: `Chromium ${browser.version()}`,
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
      data: {
        books: BOOK_COUNT,
        shelves: shelfCount,
        renderedShelves: ready.shelves,
        renderedSpines: ready.spines,
        wallHeightPx: ready.docHeight,
      },
      timings: {
        firstShelfMs: +perf.firstShelf.toFixed(1),
        firstInteractiveMs: +perf.firstInteractive.toFixed(1),
        firstSpineHit: perf.firstHit,
        firstPaintMs: ready.paintFp == null ? null : +ready.paintFp.toFixed(1),
        firstContentfulPaintMs:
          ready.paintFcp == null ? null : +ready.paintFcp.toFixed(1),
        playwrightWaitMs: loadWallMs,
      },
      scroll: {
        cold: stats(coldDeltas),
        warm: stats(warmDeltas),
        coldRaw: coldDeltas,
        warmRaw: warmDeltas,
        framesOver50: warmDeltas.filter((value) => value > 50).length,
      },
      longTasks: {
        total: longTasks.length,
        over50: longTaskOver50.length,
        over50List: longTaskOver50,
        byPhase: longTasks.reduce((acc, task) => {
          if (task.duration > 50) acc[task.phase] = (acc[task.phase] ?? 0) + 1;
          return acc;
        }, {}),
        loafOver50: loaf.filter((entry) => entry.blocking > 50).length,
      },
      filter: filterResult,
      dragProbe,
      memory: {
        embedderHeapUsedBytes: heap.embedderHeapUsedSize ?? null,
        embedderHeapUsedMb:
          heap.embedderHeapUsedSize == null
            ? null
            : round(heap.embedderHeapUsedSize / 1024 / 1024),
        jsHeapUsedMb: heap.usedSize == null ? null : round(heap.usedSize / 1024 / 1024),
        domNodes: domCounters.nodes ?? null,
        documents: domCounters.documents ?? null,
        jsEventListeners: domCounters.jsEventListeners ?? null,
        performanceMetrics: metrics
          ? Object.fromEntries(metrics.metrics.map((m) => [m.name, m.value]))
          : null,
      },
    };

    const outDir = resolve(ROOT, "perf/results");
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, `${LABEL}.json`);
    writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

    console.log(`\nPocketLibrary shelf benchmark — ${LABEL}`);
    console.log(
      `Chromium ${browser.version()} · 390x844 @${DPR}x · CPU ${RATE}x · ${BOOK_COUNT} books / ${shelfCount} shelves`,
    );
    console.log(
      [
        `first shelf        ${result.timings.firstShelfMs} ms (interactive ${result.timings.firstInteractiveMs} ms)`,
        `scroll warm        p95 ${result.scroll.warm.p95} ms / p99 ${result.scroll.warm.p99} ms (max ${result.scroll.warm.max})`,
        `scroll cold        p95 ${result.scroll.cold.p95} ms / p99 ${result.scroll.cold.p99} ms (max ${result.scroll.cold.max})`,
        `long tasks >50 ms  ${result.longTasks.over50}`,
        `renderer DOM       ${result.memory.embedderHeapUsedMb} MB · ${result.memory.domNodes} nodes`,
        `filter apply       ${result.filter.applySync} ms sync / ${result.filter.applySettled} ms settled`,
        `filter clear       ${result.filter.clearSync} ms sync / ${result.filter.clearSettled} ms settled`,
        `shelf rect sweep   ${result.dragProbe.sectionSweepMs} ms sections / ${result.dragProbe.spineSweepMs} ms including spines (lift-time layout cost)`,
      ].join("\n"),
    );
    console.log(`\nWrote ${outFile}`);

    const budget = {
      firstShelfMs: result.timings.firstShelfMs,
      scrollP95: result.scroll.warm.p95,
      scrollP99: result.scroll.warm.p99,
      longTasksOver50: result.longTasks.over50,
      domMb: result.memory.embedderHeapUsedMb,
      filterMs: result.filter.applySettled,
    };
    const pass =
      budget.firstShelfMs < 400 &&
      budget.scrollP95 <= 20 &&
      budget.scrollP99 <= 33 &&
      budget.longTasksOver50 === 0 &&
      budget.domMb < 15 &&
      budget.filterMs < 50;
    console.log(`Budgets: ${pass ? "PASS" : "MISS"} (see docs/perf-shelf-benchmark.md)`);

    await browser.close();
    stopServer();
    process.exit(pass ? 0 : 1);
  } finally {
    stopServer();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
