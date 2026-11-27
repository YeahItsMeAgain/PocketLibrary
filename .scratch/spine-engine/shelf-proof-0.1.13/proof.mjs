import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strips = JSON.parse(readFileSync(resolve(here, "strips.json"), "utf8"));
const out = resolve(here, "shelf");

const titles = [
  ["The Test Book", "Test Author"],
  ["The Picture of Dorian Gray", "Oscar Wilde"],
  ["Alice's Adventures in Wonderland", "Lewis Carroll"],
];

const books = strips.map((strip, index) => ({
  id: strip.bookId,
  contentHash: `real-strip-${strip.bookId}`,
  format: "epub",
  title: titles[index]?.[0] ?? `Book ${strip.bookId}`,
  authors: [titles[index]?.[1] ?? "Author"],
  series: null,
  language: "English",
  description: "A real projected strip from the host engine.",
  publisher: null,
  publishedDate: "1899",
  identifier: null,
  pageCount: 320,
  addedAt: 1,
  shelfId: 1,
  slotIndex: index,
  readingStatus: "unread",
  labels: [],
  spineStyle: index === 2 ? null : "wrap",
}));

const artifacts = Object.fromEntries(
  strips.map((strip) => [
    strip.bookId,
    {
      bookId: strip.bookId,
      route: "crop",
      verdict: strip.verdict,
      maskPercent: 7,
      pagesApproximate: false,
      cropBox: { x: 1, y: 0, width: 126, height: 570 },
      artDataUrl: strip.spineDataUrl,
      spineDataUrl: strip.spineDataUrl,
      fallbackDataUrl: strip.spineDataUrl,
      runJson: {},
      qaJson: {},
    },
  ]),
);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
await page.addInitScript(
  ({ books, artifacts }) => {
    window.__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books,
      shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
      spine: {
        backfillPending: false,
        queueStartPaused: true,
        artifacts,
      },
    };
  },
  { books, artifacts },
);
await page.goto("http://localhost:1420/");
await page.getByTestId("library-wall").waitFor();

await page.waitForFunction(() => document.querySelectorAll('[data-testid="spine"]').length === 3);
await page.waitForTimeout(800);

const dom = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="spine"]')].map((spine) => {
    const image = spine.querySelector("img.spine-generated");
    const style = image ? getComputedStyle(image) : null;
    const rect = image ? image.getBoundingClientRect() : null;
    return {
      bookId: spine.getAttribute("data-book-id"),
      classes: spine.className,
      spineState: spine.getAttribute("data-spine-state"),
      bookSpineStyle: null,
      hasImage: Boolean(image),
      srcPrefix: image?.getAttribute("src")?.slice(0, 32) ?? null,
      complete: image?.complete ?? null,
      naturalWidth: image?.naturalWidth ?? null,
      zIndex: style?.zIndex ?? null,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    };
  }),
);
console.log(JSON.stringify(dom, null, 2));

await page.screenshot({ path: resolve(out, "shelf-390.png") });
await page.setViewportSize({ width: 320, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(out, "shelf-320.png") });

// A second launch with a real fallback artifact and a missing one, queue
// paused, so Settings shows artifact presence separately from paintability.
const diagnosticsPage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const diagnosticArtifacts = {
  1: artifacts[1],
  2: { ...artifacts[2], verdict: "fallback", route: "fallback" },
};
await diagnosticsPage.addInitScript(
  ({ books, artifacts }) => {
    window.__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books,
      shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
      spine: {
        backfillPending: false,
        queueStartPaused: true,
        artifacts,
      },
    };
  },
  { books, artifacts: diagnosticArtifacts },
);
await diagnosticsPage.goto("http://localhost:1420/");
await diagnosticsPage.getByTestId("library-wall").waitFor();
await diagnosticsPage.getByRole("button", { name: "Open navigation" }).click();
await diagnosticsPage
  .getByRole("dialog", { name: "Navigation" })
  .getByRole("button", { name: "Settings" })
  .click();
await diagnosticsPage.getByTestId("settings-view").waitFor();
await diagnosticsPage.addStyleTag({
  content: ".spine-activity { display: none !important; }",
});
const summary = await diagnosticsPage
  .getByTestId("settings-spine-summary")
  .innerText();
const rows = await diagnosticsPage
  .getByTestId("spine-status-row")
  .allInnerTexts();
console.log(JSON.stringify({ settingsSummary: summary, settingsRows: rows }, null, 2));
const panel = diagnosticsPage.getByTestId("settings-spine-status");
await panel.scrollIntoViewIfNeeded();
await panel.screenshot({ path: resolve(out, "settings-spine-panel.png") });
await diagnosticsPage.screenshot({ path: resolve(out, "settings-390.png") });

await browser.close();
