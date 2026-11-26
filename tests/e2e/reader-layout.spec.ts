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

async function showChrome(page: Page) {
  const bar = page.locator(".reader-top");
  if (await bar.evaluate((element) => element.classList.contains("is-visible"))) {
    return;
  }
  const box = await page.locator(".reader-stage").boundingBox();
  if (!box) throw new Error("Reader stage has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(bar).toHaveClass(/is-visible/);
}

interface Block {
  left: number;
  right: number;
  top: number;
  bottom: number;
  text: string;
}

interface EpubGeometry {
  stage: { left: number; right: number; top: number; bottom: number };
  topBar: { top: number; bottom: number };
  bottomBar: { top: number; bottom: number };
  blocks: Block[];
  scroll: { start: number; viewSize: number; size: number };
}

/** Text block boxes in viewport coordinates, read from the foliate iframe. */
async function epubGeometry(page: Page): Promise<EpubGeometry> {
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
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const stage = rect(".reader-stage");
    const topBar = rect(".reader-top");
    const bottomBar = rect(".reader-bottom");
    const elements = Array.from(
      doc.body.querySelectorAll("p, h1, h2, h3, h4, li, blockquote"),
    );
    const blocks = elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          text: (element.textContent ?? "").trim().slice(0, 40),
          left: frameRect.left + box.left,
          right: frameRect.left + box.right,
          top: frameRect.top + box.top,
          bottom: frameRect.top + box.bottom,
        };
      })
      .filter((block) => block.text.length > 0);
    return {
      stage: {
        left: stage.left,
        right: stage.right,
        top: stage.top,
        bottom: stage.bottom,
      },
      topBar: { top: topBar.top, bottom: topBar.bottom },
      bottomBar: { top: bottomBar.top, bottom: bottomBar.bottom },
      blocks,
      scroll: {
        start: renderer.start,
        viewSize: renderer.viewSize,
        size: renderer.size,
      },
    };
  });
}

async function scrollEpubToEnd(page: Page) {
  await page.evaluate(() => {
    const view = document.querySelector("foliate-view") as
      | (HTMLElement & { renderer?: { scrollToAnchor(anchor: number): void } })
      | null;
    view?.renderer?.scrollToAnchor(1);
  });
  await page.waitForTimeout(250);
}

for (const width of [390, 320]) {
  const height = width === 320 ? 568 : 844;

  test(`EPUB scrolled mode keeps the first and last lines clear at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await bootEpub(page, "scrolled");
    await openReader(page);
    await showChrome(page);

    const atTop = await epubGeometry(page);
    const firstTop = Math.min(...atTop.blocks.map((block) => block.top));
    expect(firstTop).toBeGreaterThanOrEqual(atTop.topBar.bottom);

    await scrollEpubToEnd(page);
    const atEnd = await epubGeometry(page);
    expect(atEnd.scroll.start).toBeGreaterThan(0);
    const lastBottom = Math.max(...atEnd.blocks.map((block) => block.bottom));
    expect(lastBottom).toBeLessThanOrEqual(atEnd.bottomBar.top);
  });

  test(`EPUB paginated mode keeps the page clear of both bars at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await bootEpub(page, "paginated", { size: 2, spacing: 1 });
    await openReader(page);

    const hidden = await epubGeometry(page);
    await showChrome(page);
    const shown = await epubGeometry(page);

    // Revealing the chrome must not shift the reading surface.
    expect(shown.stage).toEqual(hidden.stage);
    expect(shown.blocks[0]?.top).toBeCloseTo(hidden.blocks[0]?.top ?? 0, 1);

    // Only the column currently visible in the stage.
    const visible = shown.blocks.filter(
      (block) =>
        block.left < shown.stage.right && block.right > shown.stage.left,
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(Math.min(...visible.map((block) => block.top))).toBeGreaterThanOrEqual(
      shown.topBar.bottom,
    );
    expect(Math.max(...visible.map((block) => block.bottom))).toBeLessThanOrEqual(
      shown.bottomBar.top,
    );
  });

  test(`PDF pages stay clear of both bars at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
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

    const stageBefore = await page
      .locator(".reader-stage")
      .evaluate((stage) => stage.getBoundingClientRect().toJSON());
    await showChrome(page);
    const stageAfter = await page
      .locator(".reader-stage")
      .evaluate((stage) => stage.getBoundingClientRect().toJSON());
    expect(stageAfter).toEqual(stageBefore);

    const geometry = () =>
      page.evaluate(() => {
        const box = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
          page: box(".pdf-page"),
          topBar: box(".reader-top"),
          bottomBar: box(".reader-bottom"),
        };
      });

    const atTop = await geometry();
    expect(atTop.page.top).toBeGreaterThanOrEqual(atTop.topBar.bottom);

    await page.getByTestId("pdf-stage").evaluate((stage) => {
      stage.scrollTop = stage.scrollHeight;
    });
    await page.waitForTimeout(150);
    const atEnd = await geometry();
    expect(atEnd.page.bottom).toBeLessThanOrEqual(atEnd.bottomBar.top);
  });
}
