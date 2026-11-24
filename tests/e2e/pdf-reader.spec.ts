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

async function showChrome(page: Page) {
  const bar = page.locator(".reader-top");
  if (await bar.evaluate((element) => element.classList.contains("is-visible"))) {
    return;
  }
  await page.mouse.click(195, 420);
  await expect(bar).toHaveClass(/is-visible/);
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

  await showChrome(page);
  expect(await page.getByTestId("reader-progress").textContent()).toBe("33%");

  // Page-number jump.
  await page.getByTestId("reader-page-input").fill("2");
  await page.getByTestId("reader-page-go").click();
  await expect(page.getByTestId("reader-page-input")).toHaveValue("2");
  await expect
    .poll(() => page.getByTestId("reader-progress").textContent())
    .toBe("67%");

  // Contents lists the PDF outline and jumps by outline page.
  await showChrome(page);
  await page.getByTestId("reader-contents").click();
  await expect(page.getByTestId("reader-toc-item").first()).toContainText(
    "Chapter One",
  );
  await page.getByTestId("reader-toc-item").nth(1).click();
  await expect(page.getByTestId("reader-page-input")).toHaveValue("2");

  // Themes are a wash over the page, not a reflow: the tint layer changes and
  // the page keeps its layout.
  await showChrome(page);
  const widthBefore = await canvasWidth(page);
  await page.getByTestId("reader-theme").click();
  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-theme",
    "sepia",
  );
  await expect(page.getByTestId("pdf-tint")).toHaveClass(/pdf-tint-sepia/);
  expect(await canvasWidth(page)).toBeCloseTo(widthBefore, 0);

  // Zoom multiplies the fitted page and fit-width restores it.
  await page.getByTestId("reader-zoom").click();
  await expect(page.getByTestId("reader-zoom-sheet")).toBeVisible();
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
  await page.getByRole("button", { name: "Close zoom settings" }).click();

  // Returning and reopening resumes on page 2.
  await page.waitForTimeout(700);
  await showChrome(page);
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "reading",
  );

  await openReader(page);
  await showChrome(page);
  await expect(page.getByTestId("reader-page-input")).toHaveValue("2");
  expect(await page.getByTestId("reader-progress").textContent()).toBe("67%");
});

test("PDF bookmarks add from a page, survive relaunch, and remove", async ({
  page,
}) => {  await boot(page);
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-page-input").fill("3");
  await page.getByTestId("reader-page-go").click();
  await expect(page.getByTestId("reader-progress")).toHaveText("100%");

  await showChrome(page);
  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await page.reload();
  await openReader(page);
  await showChrome(page);
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await page.getByTestId("reader-contents").click();
  await page.getByTestId("reader-tab-bookmarks").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await expect(page.getByTestId("reader-bookmark-row")).toContainText("Page 3");
  await page.getByTestId("reader-bookmark-delete").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(0);
});

async function persistentProgress(page: Page): Promise<number> {
  const value = await page
    .getByTestId("reader-persistent-progress")
    .getAttribute("aria-valuenow");
  return Number(value ?? 0);
}

test("PDF persistent controls stay visible and return to the wall", async ({
  page,
}) => {
  await boot(page);
  await openReader(page);

  await expect(page.locator(".reader-top")).not.toHaveClass(/is-visible/);
  await expect(page.getByTestId("reader-persistent-back")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-progress")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-percent")).toContainText(
    "1/3",
  );
  expect(await persistentProgress(page)).toBe(33);

  await page.getByTestId("reader-persistent-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("PDF Escape closes the reader", async ({ page }) => {
  await boot(page);
  await openReader(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("PDF browser back closes the reader instead of leaving the app", async ({
  page,
}) => {
  await boot(page);
  await openReader(page);

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toBeVisible();
});

