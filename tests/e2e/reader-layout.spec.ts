import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const EPUB_BOOK: Book = {
  id: 1,
  contentHash: "sample-hash",
  format: "epub",
  title: "The Lamplighter's Test",
  authors: ["Pocket Library"],
  series: null,
  language: "en",
  description: null,
  publisher: null,
  publishedDate: null,
  identifier: null,
  pageCount: null,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: "unread",
  labels: [],
};

const PDF_BOOK: Book = {
  id: 21,
  contentHash: "sample-pdf-hash",
  format: "pdf",
  title: "The Lamplighter's PDF",
  authors: ["Pocket Library"],
  series: null,
  language: "en",
  description: null,
  publisher: null,
  publishedDate: null,
  identifier: null,
  pageCount: 3,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: "unread",
  labels: [],
};

const EPUB_SETTINGS = {
  theme: "paper",
  font: "garamond",
  size: 4,
  spacing: 2,
  margin: 0,
};

async function bootEpub(
  page: Page,
  mode: "paginated" | "scrolled",
  settings: Partial<typeof EPUB_SETTINGS> = {},
) {
  await page.addInitScript(
    ({ book, mode, settings }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: [book],
        bookFiles: { 1: "/test-assets/sample.epub" },
      };
      window.localStorage.setItem(
        "pocketlibrary.readerSettings",
        JSON.stringify({ ...settings, mode }),
      );
    },
    { book: EPUB_BOOK, mode, settings: { ...EPUB_SETTINGS, ...settings } },
  );
  await page.goto("/");
}

async function bootPdf(page: Page) {
  await page.addInitScript((book) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [book],
      bookFiles: { 21: "/test-assets/sample.pdf" },
    };
    window.localStorage.setItem(
      "pocketlibrary.readerSettings",
      JSON.stringify({ ...EPUB_SETTINGS, size: 2, spacing: 1 }),
    );
  }, PDF_BOOK);
  await page.goto("/");
}

async function openReader(page: Page) {
  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function openDesk(page: Page, tab = "type") {
  await page.getByTestId("reader-pull").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  if (tab !== "type") await page.getByTestId(`reader-desk-tab-${tab}`).click();
  // Let the 0.24s entrance finish before measuring.
  await page.waitForTimeout(320);
}

async function closeDesk(page: Page) {
  await page.getByTestId("reader-desk-close").click();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface Block {
  left: number;
  right: number;
  top: number;
  bottom: number;
  text: string;
}

interface EpubLayout {
  stage: Rect;
  dock: Rect;
  desk: Rect | null;
  sheet: Rect | null;
  body: Rect | null;
  blocks: Block[];
  scroll: { start: number; viewSize: number; size: number };
}

/** Stage, dock, desk and text block boxes, clipped to what is painted. */
async function epubLayout(page: Page): Promise<EpubLayout> {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as
      | (HTMLElement & {
          renderer?: {
            getContents(): Array<{ doc: Document }>;
            start: number;
            viewSize: number;
            size: number;
          };
        })
      | null;
    const renderer = view?.renderer;
    const doc = renderer?.getContents()[0]?.doc;
    if (!renderer || !doc) throw new Error("The EPUB is not rendered yet");
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    if (!frame) throw new Error("The EPUB iframe is missing");
    const frameRect = frame.getBoundingClientRect();
    const box = (selector: string): Rect | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const stage = box('[data-testid="reader-stage"]');
    const dock = box(".reader-dock");
    if (!stage || !dock) throw new Error("The reader chrome is missing");
    const elements = Array.from(
      doc.body.querySelectorAll("p, h1, h2, h3, h4, li, blockquote"),
    );
    const blocks = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: (element.textContent ?? "").trim().slice(0, 40),
          left: frameRect.left + rect.left,
          right: frameRect.left + rect.right,
          top: frameRect.top + rect.top,
          bottom: frameRect.top + rect.bottom,
        };
      })
      .filter((block) => block.text.length > 0);
    return {
      stage,
      dock,
      desk: box('[data-testid="reader-desk"]'),
      sheet: box(".reader-desk"),
      body: box('[data-testid="reader-desk-body"]'),
      blocks,
      scroll: {
        start: renderer.start,
        viewSize: renderer.viewSize,
        size: renderer.size,
      },
    };
  });
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

async function chromeReport(page: Page) {
  return page.evaluate(() => {
    const small: Array<{ label: string; width: number; height: number }> = [];
    for (const element of document.querySelectorAll(
      ".reader-dock button, .reader-desk button, .reader-desk input",
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 44 || rect.height < 44) {
        small.push({
          label:
            element.getAttribute("aria-label") ??
            (element.textContent ?? "").trim().slice(0, 24) ??
            element.tagName,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    }
    return {
      small,
      overflow:
        document.documentElement.scrollWidth - (window.innerWidth || 0),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

const SIZES: Array<[number, number]> = [
  [390, 844],
  [320, 568],
  [430, 932],
];

for (const [width, height] of SIZES) {
  test(`EPUB closed: the page sits above the dock at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await bootEpub(page, "paginated", { size: 2, spacing: 1 });
    await openReader(page);

    const layout = await epubLayout(page);
    expect(layout.desk).toBeNull();
    expect(layout.dock.top).toBeGreaterThan(0);
    expect(Math.abs(layout.stage.bottom - layout.dock.top)).toBeLessThanOrEqual(
      0.5,
    );
    expect(layout.dock.height).toBeGreaterThanOrEqual(44);

    const visible = layout.blocks.filter(
      (block) =>
        block.right > layout.stage.left &&
        block.left < layout.stage.right &&
        block.bottom > layout.stage.top &&
        block.top < layout.stage.bottom,
    );
    expect(visible.length).toBeGreaterThan(0);
    for (const block of visible) {
      expect(overlap(block, layout.dock)).toBe(0);
    }

    const report = await chromeReport(page);
    expect(report.small).toEqual([]);
    expect(report.overflow).toBeLessThanOrEqual(0);
  });

  test(`EPUB open: the desk docks below the stage at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await bootEpub(page, "paginated", { size: 2, spacing: 1 });
    await openReader(page);
    const closed = await epubLayout(page);
    await openDesk(page);
    await page.waitForTimeout(400);

    const layout = await epubLayout(page);
    if (!layout.desk || !layout.sheet || !layout.body) {
      throw new Error("The desk is not laid out");
    }

    // 48dvh sheet, dock band, then the reflowed stage. No layer overlaps the
    // other, and the page is genuinely shorter.
    expect(Math.abs(layout.sheet.height - height * 0.48)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.sheet.bottom - height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(layout.dock.bottom - layout.sheet.top)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(layout.stage.bottom - layout.dock.top)).toBeLessThanOrEqual(
      0.5,
    );
    expect(layout.stage.height).toBeLessThan(closed.stage.height - 100);
    expect(layout.body.height).toBeGreaterThan(0);

    const visible = layout.blocks.filter(
      (block) =>
        block.right > layout.stage.left &&
        block.left < layout.stage.right &&
        block.bottom > layout.stage.top &&
        block.top < layout.stage.bottom,
    );
    expect(visible.length).toBeGreaterThan(0);
    for (const block of visible) {
      expect(overlap(block, layout.dock)).toBe(0);
      expect(overlap(block, layout.sheet)).toBe(0);
    }

    const report = await chromeReport(page);
    expect(report.small).toEqual([]);
    expect(report.overflow).toBeLessThanOrEqual(0);
  });

  test(`EPUB scrolled: the desk overlays without reflowing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await bootEpub(page, "scrolled", { size: 2, spacing: 1 });
    await openReader(page);
    // Let the scrolled document settle before taking the baseline.
    await page.waitForTimeout(500);

    const closed = await epubLayout(page);
    await openDesk(page);
    await page.waitForTimeout(300);
    const opened = await epubLayout(page);
    await closeDesk(page);
    await page.waitForTimeout(300);
    const after = await epubLayout(page);

    expect(opened.stage.height).toBeCloseTo(closed.stage.height, 0);
    expect(Math.abs(opened.scroll.start - closed.scroll.start)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(opened.scroll.size - closed.scroll.size)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(after.scroll.start - closed.scroll.start)).toBeLessThanOrEqual(
      1,
    );
    // The text box itself did not move: overlay, not a re-wrap.
    if (closed.blocks[0] && opened.blocks[0]) {
      expect(opened.blocks[0].top).toBeCloseTo(closed.blocks[0].top, 0);
      expect(opened.blocks[0].left).toBeCloseTo(closed.blocks[0].left, 0);
    }

    // Overlay hides the lower page, it does not repaint it above the desk.
    if (!opened.desk || !opened.sheet) throw new Error("The desk is missing");
    expect(opened.stage.bottom).toBeGreaterThan(opened.desk.top);
  });
}

test("PDF: the desk overlays and never repaginates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootPdf(page);
  await openReader(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector(
          ".pdf-canvas",
        ) as HTMLCanvasElement | null;
        return canvas?.width ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  const before = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    return {
      page: box(".pdf-page"),
      stage: box('[data-testid="pdf-stage"]'),
      dock: box(".reader-dock"),
      canvasWidth: (
        document.querySelector(".pdf-canvas") as HTMLCanvasElement
      ).getBoundingClientRect().width,
      scrollTop: document.querySelector('[data-testid="pdf-stage"]')!.scrollTop,
    };
  });
  expect(before.page.bottom).toBeLessThanOrEqual(before.dock.top + 0.5);

  await openDesk(page, "page");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width };
    };
    return {
      page: box(".pdf-page"),
      stage: box('[data-testid="pdf-stage"]'),
      sheet: box(".reader-desk"),
      canvasWidth: (
        document.querySelector(".pdf-canvas") as HTMLCanvasElement
      ).getBoundingClientRect().width,
      scrollTop: document.querySelector('[data-testid="pdf-stage"]')!.scrollTop,
    };
  });

  expect(after.stage.width).toBeCloseTo(before.stage.width, 0);
  expect(after.canvasWidth).toBeCloseTo(before.canvasWidth, 0);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.page.top).toBeCloseTo(before.page.top, 0);
  expect(Math.abs(after.sheet.bottom - 844)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.sheet.top - (844 - 844 * 0.48))).toBeLessThanOrEqual(1);

  const report = await chromeReport(page);
  expect(report.small).toEqual([]);
  expect(report.overflow).toBeLessThanOrEqual(0);
});

test("320px: the primary type controls are above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await bootEpub(page, "paginated", { size: 2, spacing: 1 });
  await openReader(page);
  await openDesk(page);

  const body = await page.getByTestId("reader-desk-body").boundingBox();
  if (!body) throw new Error("The desk body has no box");
  for (const id of [
    "reader-mode-paginated",
    "reader-mode-scrolled",
    "reader-size-down",
    "reader-size-up",
    "reader-theme-paper",
    "reader-theme-night",
  ]) {
    const box = await page.getByTestId(id).boundingBox();
    if (!box) throw new Error(`${id} has no box`);
    expect(box.y).toBeGreaterThanOrEqual(body.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(body.y + body.height + 0.5);
  }
  // The summary footer is visible without scrolling the sheet.
  await expect(page.getByTestId("reader-desk-summary")).toBeVisible();
});
