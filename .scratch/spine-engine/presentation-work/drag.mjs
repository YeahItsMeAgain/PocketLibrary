import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.PHASE ?? "after";
const out = resolve(here, `${phase}-drag`);
mkdirSync(out, { recursive: true });

const dataUrl = (p, mime = "image/jpeg") =>
  `data:${mime};base64,${readFileSync(p).toString("base64")}`;
const A = "/tmp/opencode/artifacts/rps";
const art = dataUrl(`${A}/art.jpg`);
const strip = dataUrl(`${A}/spine-2x.jpg`);

const books = [
  {
    id: 1,
    contentHash: "drag-wrap",
    format: "epub",
    title: "Rock Paper Scissors",
    authors: ["Alice Feeney"],
    series: null,
    language: "English",
    description: null,
    publisher: null,
    publishedDate: "2021-08-01",
    identifier: null,
    pageCount: 320,
    addedAt: 1,
    shelfId: 1,
    slotIndex: 0,
    readingStatus: "unread",
    labels: [],
    spineStyle: "wrap",
  },
  {
    id: 2,
    contentHash: "drag-typography",
    format: "epub",
    title: "Dune",
    authors: ["Frank Herbert"],
    series: null,
    language: "English",
    description: null,
    publisher: null,
    publishedDate: "1965-08-01",
    identifier: null,
    pageCount: 412,
    addedAt: 1,
    shelfId: 1,
    slotIndex: 1,
    readingStatus: "unread",
    labels: [],
    spineStyle: "typography",
  },
];
const artifacts = Object.fromEntries(
  books.map((b) => [
    b.id,
    {
      bookId: b.id,
      route: "crop",
      verdict: "pass",
      maskPercent: 0,
      pagesApproximate: false,
      cropBox: { x: 1, y: 0, width: 52, height: 236 },
      artDataUrl: art,
      spineDataUrl: strip,
      fallbackDataUrl: strip,
      runJson: {},
      qaJson: {},
    },
  ]),
);
const config = {
  state: "ready",
  folderName: "PocketLibrary",
  books,
  shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
  spine: { backfillPending: false, queueStartPaused: true, artifacts },
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
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
  () => document.querySelectorAll("img.spine-generated").length === 1,
  null,
  { timeout: 10_000 },
);
await page.waitForTimeout(600);

const results = { phase };
const measureTitle = (el) => {
  const st = el.querySelector(".st");
  const style = getComputedStyle(st);
  const range = document.createRange();
  range.selectNodeContents(st);
  const tr = range.getBoundingClientRect();
  const stRect = st.getBoundingClientRect();
  return {
    font: style.fontSize,
    ls: style.letterSpacing,
    coverage: +((tr.bottom - tr.top) / stRect.height).toFixed(3),
    stH: +stRect.height.toFixed(1),
    stW: +stRect.width.toFixed(1),
    clientH: st.clientHeight,
    scrollH: st.scrollHeight,
    scrollW: st.scrollWidth,
    lineH: Number.parseFloat(style.lineHeight),
  };
};
for (const [id, expectStyle] of [
  [1, "wrap"],
  [2, "typography"],
]) {
  const spine = page.locator(`[data-testid="spine"][data-book-id="${id}"]`);
  results[`source-${expectStyle}`] = await spine.evaluate(measureTitle);
  const box = await spine.boundingBox();
  if (!box) throw new Error("no box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(460);
  await page.mouse.move(start.x + 70, start.y + 30, { steps: 6 });
  await page.waitForTimeout(160);
  const ghost = page.getByTestId("spine-drag-ghost");
  results[expectStyle] = await ghost.evaluate((el) => {
    const img = el.querySelector("img.spine-generated");
    const scrim = el.querySelector(".spine-scrim");
    const st = el.querySelector(".st");
    const source = document.querySelector(".spine.is-dragging-source");
    const ghostStyle = getComputedStyle(el);
    const titleRange = document.createRange();
    titleRange.selectNodeContents(st);
    const tr = titleRange.getBoundingClientRect();
    const stRect = st.getBoundingClientRect();
    return {
      dataStyle: el.dataset.style,
      hasGenerated: el.classList.contains("has-generated"),
      hasImg: Boolean(img),
      naturalWidth: img?.naturalWidth ?? 0,
      hasScrim: Boolean(scrim),
      scrimBg: scrim ? getComputedStyle(scrim).backgroundColor : null,
      ink: getComputedStyle(st).color,
      font: getComputedStyle(st).fontSize,
      letterSpacing: getComputedStyle(st).letterSpacing,
      titleCoverage: +((tr.bottom - tr.top) / stRect.height).toFixed(3),
      titleRect: {
        w: +stRect.width.toFixed(1),
        h: +stRect.height.toFixed(1),
      },
      sourceOpacity: source ? getComputedStyle(source).opacity : null,
      sourceStyle: source?.dataset.style ?? null,
      ghostClasses: el.className,
      ghostCss: {
        c1: ghostStyle.getPropertyValue("--c1").trim(),
        ink: ghostStyle.getPropertyValue("--spine-ink").trim(),
      },
    };
  });
  await page.screenshot({ path: resolve(out, `holding-${expectStyle}.png`) });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
writeFileSync(resolve(out, "report.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
