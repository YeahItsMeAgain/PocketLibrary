/**
 * Presentation repro: real Rock Paper Scissors host artifact on the shelf and
 * in Edit → Spine, at 390 and 320, with touch. Writes before/after screenshots
 * and a JSON report next to this script.
 *
 * Usage: PHASE=before|after node repro.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.PHASE ?? "before";
const out = resolve(here);
mkdirSync(out, { recursive: true });

const dataUrl = (path, mime = "image/jpeg") =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;

const art = dataUrl("/tmp/opencode/rps-repro/art.jpg");
const source = dataUrl("/tmp/opencode/rps-repro/source.jpg");
const spine2x = dataUrl("/tmp/opencode/rps-repro/spine-2x.jpg");
const fallback = dataUrl("/tmp/opencode/rps-repro/fallback-spine.jpg");

const book = (id, style) => ({
  id,
  contentHash: `rps-${id}`,
  format: "epub",
  title: "Rock Paper Scissors",
  authors: ["Alice Feeney"],
  series: null,
  language: "English",
  description: "A quiet house, a sudden storm, and a marriage under glass.",
  publisher: "HarperCollins",
  publishedDate: "2021-08-01",
  identifier: "9780000000000",
  pageCount: 320,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: id - 1,
  readingStatus: "unread",
  labels: [],
  spineStyle: style,
});

const artifact = (bookId) => ({
  bookId,
  route: "inpaint",
  verdict: "review",
  maskPercent: 44.1,
  pagesApproximate: false,
  cropBox: { x: 298, y: 0, width: 159, height: 720 },
  artDataUrl: art,
  spineDataUrl: spine2x,
  fallbackDataUrl: fallback,
  runJson: {},
  qaJson: {},
});

const books = [book(1, "wrap"), book(2, "full-bleed"), book(3, "cloth")];
const artifacts = {
  1: artifact(1),
  2: artifact(2),
  3: artifact(3),
};
const config = {
  state: "ready",
  folderName: "PocketLibrary",
  coverDataUrl: source,
  books,
  shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
  spine: {
    backfillPending: false,
    queueStartPaused: true,
    styles: { 1: "wrap", 2: "full-bleed", 3: "cloth" },
    artifacts,
  },
};

const results = { phase, screenshots: [], measurements: {}, taps: {} };

async function boot(page) {
  await page.addInitScript((seed) => {
    window.__POCKETLIBRARY_MOCK__ = seed;
  }, config);
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("img.spine-generated").length === 2,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(700);
}

async function shelfMeasure(page, width) {
  return page.evaluate(() => {
    const parse = (value) => Number(value);
    const spines = [...document.querySelectorAll('[data-testid="spine"]')];
    return spines.map((spine) => {
      const rect = spine.getBoundingClientRect();
      const style = spine.getAttribute("data-style") ?? "unknown";
      const img = spine.querySelector("img.spine-generated");
      const text = spine.querySelector(".spine-text");
      const title = spine.querySelector(".st");
      const author = spine.querySelector(".sa");
      const scrim = spine.querySelector(".spine-scrim");
      const titleRect = title?.getBoundingClientRect();
      const authorRect = author?.getBoundingClientRect();
      const textRect = text?.getBoundingClientRect();
      const styleProp = (element) =>
        element ? getComputedStyle(element) : null;
      return {
        bookId: spine.getAttribute("data-book-id"),
        style,
        width: +rect.width.toFixed(1),
        height: +rect.height.toFixed(1),
        hasArt: Boolean(img),
        artZ: img ? styleProp(img)?.zIndex : null,
        textZ: text ? styleProp(text)?.zIndex : null,
        scrim: scrim
          ? {
              opacity: styleProp(scrim)?.opacity,
              background: styleProp(scrim)?.backgroundColor,
            }
          : null,
        titleFont: title ? parseFloat(styleProp(title)?.fontSize ?? "0") : null,
        titleOverflow: title
          ? {
              scrollHeight: title.scrollHeight,
              clientHeight: title.clientHeight,
              scrollWidth: title.scrollWidth,
              clientWidth: title.clientWidth,
              textOverflow: styleProp(title)?.textOverflow,
              whiteSpace: styleProp(title)?.whiteSpace,
            }
          : null,
        authorFont: author
          ? parseFloat(styleProp(author)?.fontSize ?? "0")
          : null,
        // Vertical runs: x is across the spine, y down it.
        titleCx: titleRect
          ? +(titleRect.x + titleRect.width / 2 - rect.x).toFixed(2)
          : null,
        authorCx: authorRect
          ? +(authorRect.x + authorRect.width / 2 - rect.x).toFixed(2)
          : null,
        spineCx: +(rect.width / 2).toFixed(2),
        // Overlap in the along-spine axis: title bottom vs author top.
        titleBottom: titleRect ? +(titleRect.bottom - rect.y).toFixed(2) : null,
        authorTop: authorRect ? +(authorRect.top - rect.y).toFixed(2) : null,
        textTop: textRect ? +(textRect.top - rect.y).toFixed(2) : null,
        textBottom: textRect ? +(textRect.bottom - rect.y).toFixed(2) : null,
        titleText: title?.textContent,
        authorText: author?.textContent,
      };
    });
  });
}

async function openSpineEdit(page, index) {
  const spine = page.getByTestId("spine").nth(index);
  await spine.tap();
  await page.getByTestId("book-detail").waitFor();
  await page.getByTestId("detail-edit").tap();
  await page.getByTestId("edit-book").waitFor();
  const spineSection = page
    .getByTestId("edit-book")
    .getByTestId("spine-studio");
  await spineSection.scrollIntoViewIfNeeded();
  return spineSection;
}

async function tapProbe(page, selector) {
  return page.evaluate((sel) => {
    const element =
      sel.startsWith("testid:")
        ? document.querySelector(`[data-testid="${sel.slice(7)}"]`)
        : document.querySelector(sel);
    if (!element) return { found: false };
    const rect = element.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    let node = hit;
    while (node && chain.length < 6) {
      const cs = getComputedStyle(node);
      chain.push({
        tag: node.tagName,
        id: node.id || null,
        cls: typeof node.className === "string" ? node.className : null,
        testid: node.getAttribute?.("data-testid") ?? null,
        z: cs.zIndex,
        pointer: cs.pointerEvents,
        position: cs.position,
      });
      node = node.parentElement;
    }
    return {
      found: true,
      rect: {
        x: +rect.x.toFixed(1),
        y: +rect.y.toFixed(1),
        w: +rect.width.toFixed(1),
        h: +rect.height.toFixed(1),
      },
      target: {
        tag: hit?.tagName ?? null,
        cls: typeof hit?.className === "string" ? hit.className : null,
        testid: hit?.getAttribute?.("data-testid") ?? null,
      },
      chain,
    };
  }, selector);
}

const browser = await chromium.launch();

for (const width of [390, 320]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await boot(page);

  const shot = async (name) => {
    const path = resolve(out, `${phase}-${name}.png`);
    await page.screenshot({ path });
    results.screenshots.push(path.replace(`${here}/`, ""));
  };

  await shot(`shelf-${width}`);
  results.measurements[`shelf${width}`] = await shelfMeasure(page, width);

  // Edit → Spine for each style, one book each.
  for (const [index, style] of [
    [0, "wrap"],
    [1, "full-bleed"],
    [2, "cloth"],
  ]) {
    await openSpineEdit(page, index);
    await page.waitForTimeout(400);
    const preview = page.getByTestId("spine-preview");
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot(`edit-${style}-${width}`);
    results.measurements[`edit${style}${width}`] = await page.evaluate(
      (styleName) => {
        const canvasFor = (id) =>
          document.querySelector(`[data-testid="${id}"]`);
        const read = (canvas) => {
          if (!canvas) return null;
          const d = canvas.dataset;
          const rect = canvas.getBoundingClientRect();
          return {
            style: d.style,
            direction: d.direction,
            scrim: d.scrim,
            contrast: Number(d.contrast),
            blockCx: Number(d.blockCx),
            canvasWidth: +(canvas.width / (window.devicePixelRatio || 1)).toFixed(2),
            blockCy: Number(d.blockCy),
            titleCy: Number(d.titleCy),
            titleHeight: Number(d.titleHeight),
            titleWidth: Number(d.titleWidth),
            titleFontSize: Number(d.titleFontSize),
            titleLines: Number(d.titleLines),
            authorCy: d.authorCy ? Number(d.authorCy) : null,
            authorHeight: d.authorHeight ? Number(d.authorHeight) : null,
            authorFontSize: d.authorFontSize
              ? Number(d.authorFontSize)
              : null,
            authorLines: d.authorLines ? Number(d.authorLines) : null,
            cssWidth: +rect.width.toFixed(1),
            cssHeight: +rect.height.toFixed(1),
          };
        };
        const previewCanvas = canvasFor("spine-preview-canvas");
        return {
          previewStyle: previewCanvas?.dataset.style ?? null,
          preview: read(previewCanvas),
          pickers: {
            wrap: read(canvasFor("spine-canvas-wrap")),
            fullBleed: read(canvasFor("spine-canvas-full-bleed")),
            cloth: read(canvasFor("spine-canvas-cloth")),
          },
        };
      },
      style,
    );

    // Touch tap the three chips and verify the handler fires (mock style map).
    const tapReport = {};
    for (const target of ["wrap", "full-bleed", "cloth"]) {
      const probe = await tapProbe(page, `testid:spine-style-${target}`);
      const before = await page.evaluate(() => ({
        styles: { ...(window.__POCKETLIBRARY_SPINE_STYLES__ ?? {}) },
      }));
      const chip = page.getByTestId(`spine-style-${target}`);
      await chip.tap({ force: false }).catch((error) => {
        tapReport[target] = { tapError: String(error) };
      });
      await page.waitForTimeout(250);
      const after = await page.evaluate((name) => ({
        styles: { ...(window.__POCKETLIBRARY_SPINE_STYLES__ ?? {}) },
        pressed: document
          .querySelector(`[data-testid="spine-style-${name}"]`)
          ?.getAttribute("aria-pressed"),
        previewStyle: document
          .querySelector('[data-testid="spine-preview"]')
          ?.getAttribute("data-style"),
      }), target);
      tapReport[target] = {
        ...tapReport[target],
        probe,
        before: before.styles,
        after: after.styles,
        pressed: after.pressed,
        previewStyle: after.previewStyle,
      };
    }
    const previewProbe = await tapProbe(page, "testid:spine-preview");
    tapReport.preview = { probe: previewProbe };
    const generateProbe = await tapProbe(page, "testid:spine-generate");
    tapReport.generate = { probe: generateProbe };
    const retryProbe = await tapProbe(page, "testid:spine-retry");
    tapReport.retry = { probe: retryProbe };
    results.taps[`${style}-${width}`] = tapReport;

    await page.getByTestId("edit-book-close").tap();
    await page.getByTestId("detail-back").tap();
    await page.getByTestId("library-wall").waitFor();
    await page.waitForTimeout(300);
  }

  await context.close();
}

await browser.close();
writeFileSync(
  resolve(out, `${phase}-report.json`),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
