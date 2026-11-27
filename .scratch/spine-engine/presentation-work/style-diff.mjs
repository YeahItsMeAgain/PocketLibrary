import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.PHASE ?? "after";
const out = resolve(here, `${phase}-styles`);
mkdirSync(out, { recursive: true });

const dataUrl = (p, mime = "image/jpeg") =>
  `data:${mime};base64,${readFileSync(p).toString("base64")}`;
const A = "/tmp/opencode/artifacts/rps";
const art = dataUrl(`${A}/art.jpg`);
const strip = dataUrl(`${A}/spine-2x.jpg`);

const STYLES = ["wrap", "full-bleed", "cloth", "typography"];
const books = STYLES.map((style, index) => ({
  id: index + 1,
  // Same content hash and slot seed: only the style differs.
  contentHash: "styles-shared-cover",
  format: "epub",
  title: "Rock Paper Scissors",
  authors: ["Alice Feeney"],
  series: null,
  language: "English",
  description: null,
  publisher: "HarperCollins",
  publishedDate: "2021-08-01",
  identifier: null,
  pageCount: 320,
  addedAt: 1,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: index === 1 ? "reading" : "unread",
  labels:
    index === 0
      ? [
          { id: 1, name: "Thriller", colour: "#7a2828" },
          { id: 2, name: "Owned", colour: "#3c5a34" },
        ]
      : [],
  spineStyle: style,
}));
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
const report = { phase, widths: {} };
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
    () => document.querySelectorAll("img.spine-generated").length === 2,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(700);

  report.widths[width] = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="spine"]')].map((spine) => {
      const rect = spine.getBoundingClientRect();
      const img = spine.querySelector("img.spine-generated");
      const scrim = spine.querySelector(".spine-scrim");
      const st = spine.querySelector(".st");
      const style = getComputedStyle(spine);
      const scrimStyle = scrim ? getComputedStyle(scrim) : null;
      const imgRect = img?.getBoundingClientRect();
      return {
        style: spine.dataset.style,
        hasArt: Boolean(img),
        naturalWidth: img?.naturalWidth ?? 0,
        spineW: +rect.width.toFixed(1),
        imgInset: imgRect
          ? {
              left: +(imgRect.left - rect.left).toFixed(1),
              right: +(rect.right - imgRect.right).toFixed(1),
              top: +(imgRect.top - rect.top).toFixed(1),
              bottom: +(rect.bottom - imgRect.bottom).toFixed(1),
            }
          : null,
        scrimInset: scrimStyle
          ? {
              left: +Number.parseFloat(scrimStyle.left).toFixed(1),
              right: +Number.parseFloat(scrimStyle.right).toFixed(1),
              top: +Number.parseFloat(scrimStyle.top).toFixed(1),
              bottom: +Number.parseFloat(scrimStyle.bottom).toFixed(1),
            }
          : null,
        scrimW: +(scrim?.getBoundingClientRect().width ?? 0).toFixed(1),
        scrimBorder: scrimStyle?.boxShadow ?? "none",
        scrimBg: scrimStyle?.backgroundColor ?? "none",
        scrimImage: scrimStyle?.backgroundImage ?? "none",
        font: +Number.parseFloat(getComputedStyle(st).fontSize).toFixed(2),
        ink: getComputedStyle(st).color,
        stroke: getComputedStyle(st).getPropertyValue("-webkit-text-stroke"),
        // Flat typographic board: no repeating-gradient layer.
        boardImage: style.backgroundImage.includes("repeating-linear-gradient")
          ? "woven"
          : "flat",
      };
    }),
  );

  await page.getByTestId("shelf").screenshot({
    path: resolve(out, `styles-${width}.png`),
  });
  for (const [index, styleName] of STYLES.entries()) {
    const spine = page.getByTestId("spine").nth(index);
    await spine.screenshot({ path: resolve(out, `${styleName}-${width}.png`) });
    await spine.evaluate((el) => {
      el.style.zoom = "4";
    });
    await page.waitForTimeout(120);
    await spine.screenshot({
      path: resolve(out, `${styleName}-${width}-4x.png`),
    });
    await spine.evaluate((el) => {
      el.style.zoom = "";
    });
  }
  await context.close();
}
await browser.close();
writeFileSync(
  resolve(out, "report.json"),
  JSON.stringify(report, null, 2),
);
for (const w of [390, 320]) {
  console.log(`\n== ${w}`);
  for (const m of report.widths[w]) {
    console.log(
      `${m.style.padEnd(11)} art=${String(m.hasArt).padEnd(5)} w=${m.spineW} frameW=${m.scrimW} inset=${JSON.stringify(m.scrimInset)} img=${JSON.stringify(m.imgInset)} board=${m.boardImage} frameBg=${m.scrimBg} ink=${m.ink} stroke=${m.stroke}`,
    );
  }
}
