import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.PHASE ?? "before";
mkdirSync(resolve(here, phase), { recursive: true });

const dataUrl = (p, mime = "image/jpeg") =>
  `data:${mime};base64,${readFileSync(p).toString("base64")}`;

const A = "/tmp/opencode/artifacts";
const strips = {
  rps: dataUrl(`${A}/rps/spine-2x.jpg`),
  dorian: dataUrl(`${A}/dorian/spine-2x.jpg`),
  alice: dataUrl(`${A}/alice/spine-2x.jpg`),
  cover: dataUrl(`${A}/cover/spine-2x.jpg`),
};
const art = {
  rps: dataUrl(`${A}/rps/art.jpg`),
  dorian: dataUrl(`${A}/dorian/art.jpg`),
  alice: dataUrl(`${A}/alice/art.jpg`),
  cover: dataUrl(`${A}/cover/art.jpg`),
};

const TITLES = [
  ["Dune", "Frank Herbert", "cover"],
  ["Rock Paper Scissors", "Alice Feeney", "rps"],
  ["The Picture of Dorian Gray", "Oscar Wilde", "dorian"],
  ["Alice's Adventures in Wonderland", "Lewis Carroll", "alice"],
  [
    "The Extraordinary, Long and Complicated Lighthouse Keeper's Daughter",
    "E. Marlowe",
    "cover",
  ],
  [
    "The Extraordinarily Long and Unabridged Chronicle of the Lighthouse Keeper's Daughter, Volume the Twenty-Seventh",
    "E. Marlowe",
    "cover",
  ],
];

const books = TITLES.map(([title, author, key], index) => ({
  id: index + 1,
  contentHash: `probe-${index}`,
  format: "epub",
  title,
  authors: [author],
  series: null,
  language: "English",
  description: null,
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

const artifact = (bookId, key) => ({
  bookId,
  route: "crop",
  verdict: "pass",
  maskPercent: 0,
  pagesApproximate: false,
  cropBox: { x: 1, y: 0, width: 52, height: 236 },
  artDataUrl: art[key],
  spineDataUrl: strips[key],
  fallbackDataUrl: strips[key],
  runJson: {},
  qaJson: {},
});
const artifacts = Object.fromEntries(
  books.map((b, i) => [b.id, artifact(b.id, TITLES[i][2])]),
);

const config = {
  state: "ready",
  folderName: "PocketLibrary",
  books,
  shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
  spine: { backfillPending: false, queueStartPaused: true, artifacts },
};

const measure = () =>
  [...document.querySelectorAll('[data-testid="spine"]')].map((spine) => {
    const title = spine.querySelector(".st");
    const titleRect = title.getBoundingClientRect();
    const style = getComputedStyle(title);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const text = title.firstChild;
    const chars = [];
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.data.length; i += 1) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width || rect.height) {
          chars.push({
            ch: node.data[i],
            x: +(rect.x - titleRect.x).toFixed(1),
            y: +(rect.y - titleRect.y).toFixed(1),
            w: +rect.width.toFixed(1),
            h: +rect.height.toFixed(1),
            bottom: +(rect.bottom - titleRect.y).toFixed(1),
          });
        }
      }
    }
    const first = chars[0];
    const last = chars[chars.length - 1];
    const minY = Math.min(...chars.map((c) => c.y));
    const maxY = Math.max(...chars.map((c) => c.bottom));
    const minX = Math.min(...chars.map((c) => c.x));
    const columnStarts = new Set(
      chars.map((c) => Math.round((c.x - minX) / lineHeight)),
    );
    const byColumn = new Map();
    for (const char of chars) {
      const key = Math.round((char.x - minX) / lineHeight);
      const list = byColumn.get(key) ?? [];
      list.push(char);
      byColumn.set(key, list);
    }
    const columnMetrics = [...byColumn.entries()]
      .sort(([left], [right]) => right - left)
      .map(([, list]) => {
        const top = Math.min(...list.map((c) => c.y));
        const bottom = Math.max(...list.map((c) => c.bottom));
        return {
          fill: +((bottom - top) / titleRect.height).toFixed(3),
          gap: +((titleRect.height - (bottom - top)) / titleRect.height).toFixed(3),
          top: +top.toFixed(1),
          bottom: +bottom.toFixed(1),
          text: list.map((c) => c.ch).join(""),
        };
      });
    return {
      bookId: spine.dataset.bookId,
      title: title.textContent,
      style: spine.dataset.style,
      spineW: +titleRect.width.toFixed(1),
      spineH: +spine.getBoundingClientRect().height.toFixed(1),
      font: +Number.parseFloat(style.fontSize).toFixed(2),
      letterSpacing: +Number.parseFloat(style.letterSpacing).toFixed(2),
      lsRaw: style.letterSpacing,
      styleAttr: title.getAttribute("style"),
      fitDebug: title.dataset.fitDebug ?? null,
      lastApply: title.dataset.lastApply ?? null,
      lineHeight: +lineHeight.toFixed(2),
      clientH: title.clientHeight,
      clientW: title.clientWidth,
      scrollH: title.scrollHeight,
      scrollW: title.scrollWidth,
      parentH: title.parentElement.clientHeight,
      authorH: title.parentElement.querySelector(".sa")?.getBoundingClientRect()
        .height,
      coverage: +((maxY - minY) / titleRect.height).toFixed(3),
      firstTop: first?.y,
      lastBottom: last?.bottom,
      runHeight: +titleRect.height.toFixed(1),
      columns: +((title.scrollWidth || lineHeight * 0.94) / lineHeight).toFixed(2),
      columnCount: columnStarts.size,
      columnMetrics,
      charX: chars.map((c) => c.x),
      overflowY: title.scrollHeight - title.clientHeight,
      overflowX: +(title.scrollWidth / lineHeight).toFixed(2),
      glyphOut: chars.some(
        (c) => c.y < -1 || c.bottom > titleRect.height + 1,
      ),
    };
  });

const browser = await chromium.launch();
const results = { phase, widths: {} };
for (const width of [390, 320]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    window.__POCKETLIBRARY_MOCK__ = seed;
    window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
  }, config);
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("img.spine-generated").length === 6,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(700);
  results.widths[width] = await page.evaluate(measure);
  await page.screenshot({
    path: resolve(here, phase, `shelf-${width}.png`),
  });
  const shelf = page.getByTestId("shelf");
  await shelf.screenshot({ path: resolve(here, phase, `case-${width}.png`) });
  await context.close();
}
await browser.close();
writeFileSync(
  resolve(here, phase, "report.json"),
  JSON.stringify(results, null, 2),
);
for (const w of [390, 320]) {
  console.log(`\n== ${w}`);
  for (const m of results.widths[w]) {
    console.log(
      `${m.title.slice(0, 42).padEnd(42)} font=${m.font} ls=${m.letterSpacing} fill=${(
        m.coverage * 100
      ).toFixed(1)}% cols=${m.columns} ovY=${m.overflowY} out=${m.glyphOut}`,
    );
  }
}
