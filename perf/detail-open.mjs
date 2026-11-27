#!/usr/bin/env node
/**
 * Detail-open benchmark: tap a spine on the wall and measure the ~800 ms that
 * follow. Seeds a realistic volume (long blurb, a photographic 600x900 cover,
 * and a cached 52x236 spine artifact) through the mock platform.
 *
 * Usage:
 *   PERF_LABEL=before node perf/detail-open.mjs
 *   PERF_URL=http://localhost:1439 PERF_LABEL=after node perf/detail-open.mjs
 *
 * Writes perf/results/detail-open-<label>.json and prints a summary.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(
  process.env.PERF_PORT ?? 1400 + Math.floor(Math.random() * 200),
);
const BASE_URL = process.env.PERF_URL ?? `http://localhost:${PORT}`;
const LABEL = process.env.PERF_LABEL ?? "current";
const RATE = Number(process.env.PERF_RATE ?? 4);
const DPR = Number(process.env.PERF_DPR ?? 1);
const WIDTH = Number(process.env.PERF_WIDTH ?? 390);
const HEIGHT = Number(process.env.PERF_HEIGHT ?? 844);
const WINDOW_MS = Number(process.env.PERF_WINDOW ?? 800);

/* ------------------------------------------------------------ PNG maker */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A deterministic PNG. `noise` gives incompressible photographic-detail bytes;
 * `gradient` keeps the same pixel dimensions with a realistic small file, so
 * decode and transfer costs can be separated.
 */
function makePng(width, height, mode = "noise") {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 0x9e3779b9;
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let r;
      let g;
      let b;
      const tint = Math.round(20 + 40 * Math.sin((x / width) * Math.PI));
      if (mode === "gradient") {
        const wave = Math.sin(x / 37 + y / 53) * 26;
        r = 58 + (y / height) * 70 + wave;
        g = 31 + (x / width) * 42 + wave * 0.6;
        b = 44 + (y / height) * 88 - wave * 0.4;
      } else {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        r = ((seed >>> 16) & 0xff) * 0.4 + tint;
        g = ((seed >>> 8) & 0xff) * 0.3 + tint * 0.7;
        b = (seed & 0xff) * 0.3 + tint * 0.4;
      }
      raw[row + 1 + x * 3] = Math.max(0, Math.min(255, Math.round(r)));
      raw[row + 2 + x * 3] = Math.max(0, Math.min(255, Math.round(g)));
      raw[row + 3 + x * 3] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
const coverWidth = Number(process.env.PERF_COVER_W ?? 600);
const coverHeight = Number(process.env.PERF_COVER_H ?? 900);
const coverMode = process.env.PERF_COVER_STYLE ?? "noise";
const coverFile =
  process.env.PERF_COVER_FILE ??
  resolve(ROOT, "prototype/design/covers/jane-eyre.jpg");
const coverUrl =
  process.env.PERF_COVER_FILE === "generated" || !existsSync(coverFile)
    ? pngUrl(makePng(coverWidth, coverHeight, coverMode))
    : `data:image/jpeg;base64,${readFileSync(coverFile).toString("base64")}`;
const artUrl = pngUrl(makePng(300, 450, "gradient"));
const stripUrl = pngUrl(makePng(52, 236, "gradient"));
const useCover = process.env.PERF_COVER !== "0";

const longBlurb = `${"The house remembers every hand that ever turned its key. ".repeat(
  2,
)}In the winter of the long silence a cartographer returns to the valley with a map that should not exist, and the archive begins to rearrange itself around her. ${"What follows is a slow argument between memory and evidence, conducted in margins. ".repeat(
  3,
)}She finds a ledger in her mother's hand, a catalogue of doors that open only once, and a room whose walls are lined with the faces of everyone who has ever left. To read it is to be read. To close it is to be catalogued.`;

const book = {
  id: 1,
  contentHash: "perf-detail-hash",
  format: "epub",
  title: "The Ledger of Small Doors",
  authors: ["Ada Lovelace", "Bram Vale"],
  series: "The Crown Papers",
  language: "en",
  description: longBlurb,
  publisher: "Harrow & Row",
  publishedDate: "1974-05-01",
  identifier: "9780000000001",
  pageCount: 428,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: "reading",
  labels: [],
};

const artifact = {
  bookId: 1,
  route: "crop",
  verdict: "pass",
  maskPercent: 0,
  pagesApproximate: false,
  cropBox: { x: 92, y: 44, width: 116, height: 362 },
  artDataUrl: artUrl,
  spineDataUrl: stripUrl,
  fallbackDataUrl: stripUrl,
  runJson: { final: { crop_box_work: [92, 44, 116, 362] }, route: "crop", verdict: "pass" },
  qaJson: { verdict: "pass", route: "crop", mask_pct: 0, residual_text: false },
};

function startServer() {
  const build = spawnSync(
    "npx",
    ["vite", "build", "--outDir", "perf/.build", "--emptyOutDir", "--logLevel", "warn"],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (build.status !== 0) throw new Error("vite build failed");
  return spawn(
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
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stats(values) {
  if (values.length === 0) return { count: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return {
    count: values.length,
    p50: +at(50).toFixed(1),
    p95: +at(95).toFixed(1),
    max: +Math.max(...values).toFixed(1),
  };
}

async function main() {
  const usingExternal = Boolean(process.env.PERF_URL);
  const server = usingExternal ? null : startServer();
  const stop = () => {
    if (!server || server.killed) return;
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  try {
    await waitForServer(BASE_URL);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: RATE }).catch(() => {});

    await page.addInitScript(
      ({ seed, windowMs, noAnim, extraCss }) => {
        window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
        window.__POCKETLIBRARY_MOCK__ = seed;
        window.__DETAIL_NO_ANIM__ = noAnim;
        if (noAnim || extraCss) {
          const inject = () => {
            const style = document.createElement("style");
            style.textContent = noAnim
              ? ".detail .v4d-frame{animation:none!important;will-change:auto!important}" +
                ".detail-scrim{animation:none!important}" +
                (extraCss ?? "")
              : extraCss;
            const parent = document.head ?? document.documentElement;
            if (parent) parent.appendChild(style);
            else requestAnimationFrame(inject);
          };
          inject();
        }
        const perf = (window.__DETAIL_PERF__ = {
          longTasks: [],
          loaf: [],
          frames: [],
          beforeClick: 0,
          clickAt: 0,
          detailMountedAt: 0,
          titleAt: 0,
          coverReadyAt: 0,
          spinePreviewAt: 0,
          endAt: 0,
        });
        const observe = (type, target) => {
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                target.push({
                  start: +entry.startTime.toFixed(1),
                  duration: +entry.duration.toFixed(1),
                  blocking: entry.blockingDuration == null ? null : +entry.blockingDuration.toFixed(1),
                  renderStart: entry.renderStart == null ? null : +entry.renderStart.toFixed(1),
                  styleAndLayoutStart:
                    entry.styleAndLayoutStart == null
                      ? null
                      : +entry.styleAndLayoutStart.toFixed(1),
                });
              }
            }).observe({ type, buffered: true });
          } catch {
            // Observer unsupported; other numbers still stand.
          }
        };
        observe("longtask", perf.longTasks);
        observe("long-animation-frame", perf.loaf);

        const waitDetail = () => {
          const detail = document.querySelector('[data-testid="book-detail"]');
          if (detail && !perf.detailMountedAt) {
            perf.detailMountedAt = performance.now();
          }
          const title = document.querySelector('[data-testid="detail-title"]');
          if (
            title &&
            !perf.titleAt &&
            title.textContent &&
            title.textContent.trim() !== "Opening…"
          ) {
            perf.titleAt = performance.now();
          }
          const cover = document.querySelector('[data-testid="detail-cover"]');
          if (cover && !perf.coverReadyAt && cover.complete && cover.naturalWidth > 0) {
            perf.coverReadyAt = performance.now();
          }
          const preview = document.querySelector(
            '[data-testid="spine-static-preview"]',
          );
          if (preview && !perf.spinePreviewAt) {
            perf.spinePreviewAt = performance.now();
          }
          if (!perf.endAt) requestAnimationFrame(waitDetail);
        };

        let last = 0;
        const frame = (now) => {
          if (perf.clickAt) {
            if (last) perf.frames.push(+(now - last).toFixed(1));
            last = now;
            if (now - perf.clickAt < windowMs) {
              requestAnimationFrame(frame);
            } else if (!perf.endAt) {
              perf.endAt = now;
            }
          } else {
            requestAnimationFrame(frame);
          }
        };

        // Arm the probe, then let the benchmark click. Frames before the click
        // are not recorded, so idle scheduling cannot pollute the budget.
        window.__DETAIL_START__ = () => {
          perf.beforeClick = performance.now();
          requestAnimationFrame(waitDetail);
          requestAnimationFrame(frame);
        };
      },
      {
        seed: {
          state: "ready",
          folderName: "PocketLibrary",
          books: [book],
          shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
          spine:
            process.env.PERF_SPINE === "0"
              ? { queueStartPaused: true }
              : { artifacts: { 1: artifact }, queueStartPaused: true },
          coverDataUrl: useCover ? coverUrl : undefined,
        },
        windowMs: WINDOW_MS,
        noAnim: process.env.PERF_NOANIM === "1",
        extraCss: process.env.PERF_CSS ?? "",
      },
    );

    await page.goto(BASE_URL);
    await page.waitForSelector('[data-testid="spine"]');
    if (process.env.PERF_WARM === "1") {
      // Load the lazy DetailPanel chunk and warm the platform once, then close.
      await page.getByTestId("spine").first().click();
      await page.waitForSelector('[data-testid="detail-read"]');
      await page.getByTestId("detail-back").click();
      await page.waitForSelector('[data-testid="book-detail"]', {
        state: "detached",
      });
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.__DETAIL_START__());
    await page.waitForTimeout(100);
    const tracing = process.env.PERF_TRACE === "1";
    if (tracing) {
      await client.send("Tracing.start", {
        categories:
          "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,loading,latencyInfo,v8.execute,disabled-by-default-devtools.timeline.frame",
        transferMode: "ReturnAsStream",
      });
    }
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="spine"]');
      window.__DETAIL_PERF__.clickAt = performance.now();
      performance.mark("detail-click");
      target.click();
    });
    await page.waitForFunction(
      () => window.__DETAIL_PERF__.endAt > 0,
      null,
      { timeout: 10_000 },
    );
    if (tracing) {
      const streamPromise = new Promise((resolve) => {
        client.once("Tracing.tracingComplete", resolve);
      });
      await client.send("Tracing.end");
      const { stream } = await streamPromise;
      const chunks = [];
      for (;;) {
        const { data, base64Encoded, eof } = await client.send(
          "IO.read",
          { handle: stream },
        );
        chunks.push(Buffer.from(data, base64Encoded ? "base64" : "utf8"));
        if (eof) break;
      }
      await client.send("IO.close", { handle: stream });
      writeFileSync(
        resolve(ROOT, `perf/results/detail-open-${LABEL}.trace.json`),
        Buffer.concat(chunks),
      );
    }
    const perf = await page.evaluate(() => window.__DETAIL_PERF__);
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("DetailPanel"))
        .map((entry) => ({
          name: entry.name.split("/").pop(),
          startTime: +entry.startTime.toFixed(1),
          duration: +entry.duration.toFixed(1),
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        })),
    );
    const detailText = await page.evaluate(() => ({
      title: document.querySelector('[data-testid="detail-title"]')?.textContent ?? null,
      preview: Boolean(document.querySelector('[data-testid="spine-static-preview"]')),
      canvas: Boolean(document.querySelector('[data-testid="spine-static-canvas"]')),
      cover: (() => {
        const img = document.querySelector('[data-testid="detail-cover"]');
        return img ? { complete: img.complete, width: img.naturalWidth } : null;
      })(),
    }));

    const openToTitle =
      perf.titleAt && perf.clickAt ? perf.titleAt - perf.clickAt : null;
    const openToInteractive =
      perf.coverReadyAt && perf.clickAt ? perf.coverReadyAt - perf.clickAt : null;
    const openToPreview =
      perf.spinePreviewAt && perf.clickAt ? perf.spinePreviewAt - perf.clickAt : null;
    const relevantLong = perf.longTasks.filter(
      (task) => task.start + task.duration >= perf.clickAt && task.start <= perf.endAt,
    );
    const relevantLoaf = perf.loaf.filter(
      (task) => task.start + task.duration >= perf.clickAt && task.start <= perf.endAt,
    );
    const afterFrames = perf.frames.slice();
    const dropped = afterFrames.filter((delta) => delta > 20).length;
    const result = {
      label: LABEL,
      generatedAt: new Date().toISOString(),
      environment: {
        viewport: `${WIDTH}x${HEIGHT}`,
        deviceScaleFactor: DPR,
        cpuThrottle: RATE,
        browser: `Chromium ${browser.version()}`,
      },
      assetBytes: {
        cover: Math.round(coverUrl.length * 0.75),
        art: Math.round(artUrl.length * 0.75),
        strip: Math.round(stripUrl.length * 0.75),
      },
      timings: {
        clickAtMs: +perf.clickAt.toFixed(1),
        detailMountedAtMs: perf.detailMountedAt ? +perf.detailMountedAt.toFixed(1) : null,
        clickToDetailMs: perf.clickAt ? +(perf.detailMountedAt - perf.clickAt).toFixed(1) : null,
        clickToTitleMs: openToTitle == null ? null : +openToTitle.toFixed(1),
        openToInteractiveMs: openToInteractive == null ? null : +openToInteractive.toFixed(1),
        openToSpinePreviewMs: openToPreview == null ? null : +openToPreview.toFixed(1),
        windowMs: perf.endAt && perf.clickAt ? +(perf.endAt - perf.clickAt).toFixed(1) : null,
      },
      longTasks: relevantLong
        .map((task) => ({
          ...task,
          offset: +(task.start - perf.clickAt).toFixed(1),
        }))
        .sort((a, b) => b.duration - a.duration),
      loaf: relevantLoaf
        .map((task) => ({ ...task, offset: +(task.start - perf.clickAt).toFixed(1) }))
        .sort((a, b) => b.duration - a.duration),
      resources,
      frames: {
        ...stats(afterFrames),
        droppedOver20ms: dropped,
        droppedOver33ms: afterFrames.filter((value) => value > 33).length,
        raw: afterFrames,
      },
      detailText,
    };
    const outDir = resolve(ROOT, "perf/results");
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, `detail-open-${LABEL}.json`);
    writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

    console.log(`\nDetail-open benchmark — ${LABEL}`);
    console.log(
      `${result.environment.viewport} @${DPR}x · CPU ${RATE}x · cover ${result.assetBytes.cover} B · art ${result.assetBytes.art} B`,
    );
    console.log(
      [
        `click → detail     ${result.timings.clickToDetailMs} ms`,
        `click → title      ${result.timings.clickToTitleMs} ms`,
        `open → interactive ${result.timings.openToInteractiveMs} ms (cover decoded/painted)`,
        `open → spine preview ${result.timings.openToSpinePreviewMs} ms`,
        `longest task       ${
          result.longTasks.length ? result.longTasks[0].duration : 0
        } ms (${result.longTasks.filter((task) => task.duration > 50).length} over 50 ms)`,
        `frames             p50 ${result.frames.p50} / p95 ${result.frames.p95} / max ${result.frames.max} ms`,
        `dropped frames     ${result.frames.droppedOver20ms} over 20 ms, ${result.frames.droppedOver33ms} over 33 ms`,
      ].join("\n"),
    );
    console.log(`\nWrote ${outFile}`);
    await browser.close();
    stop();
  } finally {
    stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
