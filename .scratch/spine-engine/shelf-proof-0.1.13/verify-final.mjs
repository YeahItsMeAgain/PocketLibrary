import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strips = JSON.parse(readFileSync(resolve(here, "strips.json"), "utf8"));
const out = resolve(here, "final");
mkdirSync(out, { recursive: true });

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
  spineStyle: "wrap",
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
const diagnosticArtifacts = {
  1: artifacts[1],
  2: { ...artifacts[2], verdict: "fallback", route: "fallback" },
};

const browser = await chromium.launch();
const results = {};

for (const width of [390, 320]) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
  });
  await page.addInitScript(
    ({ books, artifacts }) => {
      window.__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine: { backfillPending: false, queueStartPaused: true, artifacts },
      };
    },
    { books, artifacts },
  );
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("img.spine-generated").length === 3,
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, `shelf-${width}.png`) });
  results[`shelf${width}`] = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="spine"]')].map((spine) => {
      const image = spine.querySelector("img.spine-generated");
      const rect = image?.getBoundingClientRect();
      return {
        bookId: spine.getAttribute("data-book-id"),
        state: spine.getAttribute("data-spine-state"),
        painted: Boolean(image),
        naturalWidth: image?.naturalWidth ?? null,
        rect: rect
          ? { x: +rect.x.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) }
          : null,
      };
    }),
  );
  await page.close();
}

for (const width of [390, 320]) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
  });
  await page.addInitScript(
    ({ books, artifacts }) => {
      window.__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine: { backfillPending: false, queueStartPaused: true, artifacts },
      };
    },
    { books, artifacts: diagnosticArtifacts },
  );
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByTestId("settings-view").waitFor();
  await page.addStyleTag({ content: ".spine-activity { display: none !important; }" });
  const panel = page.getByTestId("settings-spine-status");
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const measurements = await page.evaluate(() => {
    const card = document.querySelector(".settings-card").getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      cardLeft: +card.left.toFixed(1),
      cardRight: +card.right.toFixed(1),
      cardCentre: +((card.left + card.right) / 2).toFixed(1),
      viewportCentre: window.innerWidth / 2,
    };
  });
  await page.screenshot({ path: resolve(out, `settings-${width}.png`), fullPage: false });
  await panel.screenshot({ path: resolve(out, `spine-panel-${width}.png`) });
  results[`settings${width}`] = measurements;
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();
