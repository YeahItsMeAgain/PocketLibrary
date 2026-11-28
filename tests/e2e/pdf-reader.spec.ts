import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const BOOK: Book = {
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

async function boot(page: Page) {
  await page.addInitScript((book) => {
    (window as unknown as { __POCKETLIBRARY_MOCK__: unknown }).__POCKETLIBRARY_MOCK__ =
      {
        state: "ready",
        folderName: "PocketLibrary",
        books: [book],
        bookFiles: { 21: "/test-assets/sample.pdf" },
      };
    window.localStorage.setItem(
      "pocketlibrary.readerSettings",
      JSON.stringify({
        mode: "paginated",
        theme: "paper",
        font: "garamond",
        size: 2,
        spacing: 1,
        margin: 0,
      }),
    );
  }, BOOK);
  await page.goto("/");
}

async function openReader(page: Page) {
  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
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
}

async function openDesk(page: Page, tab: "page" | "contents" | "marks" = "page") {
  await page.getByTestId("reader-pull").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  if (tab !== "page") {
    await page.getByTestId(`reader-desk-tab-${tab}`).click();
  }
}

async function closeDesk(page: Page) {
  await page.getByTestId("reader-desk-close").click();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
}

async function percent(page: Page): Promise<number> {
  const value = await page
    .getByTestId("reader-persistent-progress")
    .getAttribute("aria-valuenow");
  return Number(value ?? 0);
}

async function canvasWidth(page: Page): Promise<number> {
  return page
    .locator(".pdf-canvas")
    .evaluate((canvas) => (canvas as HTMLCanvasElement).getBoundingClientRect().width);
}

test("a PDF opens fit-width, jumps, themes, zooms, resumes and returns", async ({
  page,
}) => {
  await boot(page);
  await openReader(page);

  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-format",
    "pdf",
  );

  // Fit-width is the default: the canvas fills the stage's inner width.
  const stageWidth = await page.getByTestId("pdf-stage").evaluate(
    (stage) => stage.clientWidth,
  );
  const fitted = await canvasWidth(page);
  expect(fitted).toBeGreaterThan(stageWidth * 0.85);
  expect(fitted).toBeLessThanOrEqual(stageWidth);

  // The PAGE desk carries the reading position rather than a top bar.
  await openDesk(page);
  await expect(page.getByTestId("reader-desk-tab-page")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("reader-desk-meta")).toContainText("page 1 of 3");
  expect(await percent(page)).toBe(33);

  // Page-number jump. The desk readout is held at the page it opened on, so
  // the new position shows once the desk closes.
  await page.getByTestId("reader-page-input").fill("2");
  await page.getByTestId("reader-page-go").click();
  await expect
    .poll(() => page.getByTestId("reader-page-input").inputValue())
    .toBe("2");
  await closeDesk(page);
  await expect.poll(() => percent(page)).toBe(67);
  await openDesk(page);

  // Contents lists the PDF outline and jumps by outline page.
  await page.getByTestId("reader-desk-tab-contents").click();
  await expect(page.getByTestId("reader-toc-item").first()).toContainText(
    "Chapter One",
  );
  await page.getByTestId("reader-toc-item").nth(1).click();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await openDesk(page);
  await expect(page.getByTestId("reader-page-input")).toHaveValue("2");

  // Themes are a wash over the page, not a reflow: the tint layer changes and
  // the page keeps its layout.
  const widthBefore = await canvasWidth(page);
  await page.getByTestId("reader-theme-sepia").click();
  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-theme",
    "sepia",
  );
  await expect(page.getByTestId("pdf-tint")).toHaveClass(/pdf-tint-sepia/);
  expect(await canvasWidth(page)).toBeCloseTo(widthBefore, 0);

  // Zoom multiplies the fitted page and fit-width restores it.
  await expect(page.getByTestId("reader-fit-width")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("reader-zoom-in").click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("125%");
  await expect.poll(() => canvasWidth(page)).toBeGreaterThan(widthBefore * 1.2);
  await page.getByTestId("reader-fit-width").click();
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("Fit width");
  await expect.poll(() => canvasWidth(page)).toBeCloseTo(widthBefore, 0);
  await expect(page.getByTestId("reader-desk-summary")).toContainText(
    "PDF · Fit width · Sepia",
  );

  // Returning and reopening resumes on page 2.
  await closeDesk(page);
  await page.waitForTimeout(700);
  await openDesk(page);
  await page.getByTestId("reader-shelf").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "reading",
  );

  await openReader(page);
  await openDesk(page);
  await expect(page.getByTestId("reader-page-input")).toHaveValue("2");
  expect(await percent(page)).toBe(67);
});

test("PDF bookmarks add from Marks, survive relaunch, and remove", async ({
  page,
}) => {
  await boot(page);
  await openReader(page);
  await openDesk(page);
  await page.getByTestId("reader-page-input").fill("3");
  await page.getByTestId("reader-page-go").click();
  await expect
    .poll(() => page.getByTestId("reader-page-input").inputValue())
    .toBe("3");
  await closeDesk(page);
  await expect.poll(() => percent(page)).toBe(100);

  await openDesk(page, "marks");
  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();
  await closeDesk(page);

  await page.reload();
  await openReader(page);
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await openDesk(page, "marks");
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await expect(page.getByTestId("reader-bookmark-row")).toContainText("Page 3");
  await page.getByTestId("reader-bookmark-delete").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(0);
});

test("PDF's dock stays visible and the desk reports the position", async ({
  page,
}) => {
  await boot(page);
  await openReader(page);

  await expect(page.locator(".reader-bar")).toHaveCount(0);
  await expect(page.getByTestId("reader-dock")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-progress")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-percent")).toHaveText("33%");
  expect(await percent(page)).toBe(33);

  await openDesk(page);
  await expect(page.getByTestId("reader-zoom-value")).toHaveText("Fit width");
  await expect(page.getByTestId("reader-outline")).toContainText("Outline");

  await page.getByTestId("reader-desk-tab-marks").click();
  await expect(page.getByTestId("reader-bookmarks")).toBeVisible();
  await closeDesk(page);

  await openDesk(page);
  await page.getByTestId("reader-shelf").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("PDF swipe down closes the desk before the reader", async ({ page }) => {
  await boot(page);
  await openReader(page);
  await openDesk(page);

  const box = await page.getByTestId("reader-desk").boundingBox();
  if (!box) throw new Error("The desk has no box");
  const x = box.x + box.width / 2;
  const y = box.y + 22;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-pull")).toBeFocused();
});

test("PDF Escape closes the desk, then the reader", async ({ page }) => {
  await boot(page);
  await openReader(page);

  await openDesk(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("PDF browser back closes the desk, then the reader", async ({ page }) => {
  await boot(page);
  await openReader(page);

  await openDesk(page);
  await page.goBack();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toBeVisible();
});
