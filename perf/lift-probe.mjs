#!/usr/bin/env node
/**
 * Ticket 16 lift probe: measures the app's real measureWall() path on lift.
 *
 * The production build is served, 2,000 books are seeded, CPU is throttled 4x,
 * and a long-press lift is performed. The app emits a
 * `pocketlibrary:measure-wall` performance entry for each geometry sweep.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PERF_PORT ?? 1445);
const BASE_URL = `http://localhost:${PORT}`;
const BOOK_COUNT = Number(process.env.PERF_BOOKS ?? 2000);
const SHELF_CAPACITY = 11;

function config() {
  const shelves = [];
  const books = [];
  const labels = [
    { id: 1, name: "Gothic", colour: "#6e2630", createdAt: 1 },
    { id: 2, name: "Nature", colour: "#294735", createdAt: 2 },
    { id: 3, name: "History", colour: "#6b4d18", createdAt: 3 },
  ];
  for (let i = 0; i < BOOK_COUNT; i += 1) {
    books.push({
      id: i + 1,
      contentHash: `lift-${i + 1}`,
      format: i % 9 === 0 ? "pdf" : "epub",
      title: `Volume ${i + 1} of the Shelves`,
      authors: ["A. Merrow"],
      series: null,
      language: "en",
      description: "A generated volume used only by the lift probe.",
      publisher: "Pocket Library Press",
      publishedDate: "1901-01-01",
      identifier: `lift-${i + 1}`,
      pageCount: 240,
      addedAt: 1_700_000_000 + i,
      shelfId: Math.floor(i / SHELF_CAPACITY) + 1,
      slotIndex: i % SHELF_CAPACITY,
      readingStatus: ["unread", "reading", "finished"][i % 3],
      labels: i % 7 === 0 ? [labels[i % 3]] : [],
    });
  }
  for (let s = 1; s <= Math.ceil(BOOK_COUNT / SHELF_CAPACITY); s += 1) {
    shelves.push({ id: s, ordinal: s - 1, capacity: SHELF_CAPACITY });
  }
  return { state: "ready", folderName: "PocketLibrary", shelves, books, labels };
}

const build = spawnSync(
  "npx",
  ["vite", "build", "--outDir", "perf/.build", "--emptyOutDir", "--logLevel", "warn"],
  { cwd: ROOT, stdio: "inherit" },
);
if (build.status !== 0) throw new Error("vite build failed");
const server = spawn(
  "npx",
  ["vite", "preview", "--outDir", "perf/.build", "--port", String(PORT), "--strictPort", "--logLevel", "warn"],
  { cwd: ROOT, stdio: "ignore", detached: true },
);
const stop = () => {
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    server.kill("SIGKILL");
  }
};
process.on("exit", stop);

for (let i = 0; i < 80; i += 1) {
  try {
    if ((await fetch(BASE_URL)).ok) break;
  } catch {
    // Still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript((seed) => {
  window.__POCKETLIBRARY_MOCK__ = seed;
  localStorage.setItem("pocketlibrary.dragHintSeen", "1");
  localStorage.setItem("pocketlibrary.drawerHintSeen", "1");
}, config());
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="spine"]');
await page.evaluate(() => performance.clearMeasures("pocketlibrary:measure-wall"));
const box = await page.locator('[data-testid="spine"]').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(460);
const measures = await page.evaluate(() =>
  performance
    .getEntriesByName("pocketlibrary:measure-wall")
    .map((entry) => +entry.duration.toFixed(2)),
);
await page.mouse.up();
console.log(
  `measureWall lift sweeps (${measures.length}): ${measures.join(", ")} ms`,
);
await browser.close();
stop();
