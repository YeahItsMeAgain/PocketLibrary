import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const BOOK: Book = {
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

const DEFAULT_SETTINGS = {
  mode: "paginated",
  theme: "paper",
  font: "garamond",
  size: 4,
  spacing: 1,
  margin: 1,
};

async function boot(
  page: Page,
  options: {
    books?: Book[];
    bookFiles?: Record<number, string>;
    settings?: Partial<typeof DEFAULT_SETTINGS>;
  } = {},
) {
  const books = options.books ?? [BOOK];
  await page.addInitScript(
    ({ books, bookFiles, settings }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        bookFiles,
      };
      if (!window.localStorage.getItem("pocketlibrary.readerSettings")) {
        window.localStorage.setItem(
          "pocketlibrary.readerSettings",
          JSON.stringify(settings),
        );
      }
    },
    {
      books,
      bookFiles: options.bookFiles,
      settings: { ...DEFAULT_SETTINGS, ...options.settings },
    },
  );
}

async function openReader(page: Page) {
  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
}

async function showChrome(page: Page) {
  if (await page.getByTestId("reader-progress").isVisible()) return;
  await page.mouse.click(195, 420);
  await expect(page.getByTestId("reader-progress")).toBeVisible();
}

async function progress(page: Page): Promise<number> {
  const text = await page.getByTestId("reader-progress").textContent();
  return Number((text ?? "0%").replace("%", ""));
}

test("an EPUB opens, tap zones page, and back returns to the shelf", async ({
  page,
}) => {
  // Loose spacing gives the sample enough pages to sit between first and last.
  await boot(page, { settings: { spacing: 2 } });
  await page.goto("/");
  await openReader(page);

  await showChrome(page);
  expect(await progress(page)).toBe(0);

  // The first page's left zone is a no-op.
  await page.mouse.click(40, 500);
  expect(await progress(page)).toBe(0);

  // The right third advances; the left third returns.
  await page.mouse.click(350, 500);
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  const advanced = await progress(page);
  await page.waitForTimeout(450);
  await page.mouse.click(40, 500);
  await expect.poll(() => progress(page)).toBeLessThan(advanced);

  await showChrome(page);
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "reading",
  );
});

test("Contents lists chapters with the current one highlighted", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-contents").click();
  const sheet = page.getByTestId("reader-contents-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("reader-tab-chapters")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const chapter = page.getByTestId("reader-toc-item").first();
  await expect(chapter).toContainText("Chapter One");
  await expect(chapter).toHaveAttribute("data-current", "true");
  await chapter.click();
  await expect(sheet).toHaveCount(0);
});

test("browser back closes an open reader sheet before the reader", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-contents").click();
  const contents = page.getByTestId("reader-contents-sheet");
  await expect(contents).toBeVisible();

  await page.goBack();
  await expect(contents).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();

  await showChrome(page);
  await page.getByTestId("reader-type").click();
  await expect(page.getByTestId("reader-type-sheet")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("reader-type-sheet")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("typography, theme and scroll mode apply and are remembered", async ({
  page,
}) => {
  await boot(page, { settings: { size: 2, margin: 0 } });
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-type").click();
  const sheet = page.getByTestId("reader-type-sheet");
  await expect(sheet).toBeVisible();

  await page.getByTestId("reader-size-0").click();
  await page.getByTestId("reader-font-literata").click();
  await page.getByTestId("reader-theme-night").click();
  await page.getByTestId("reader-mode-scrolled").click();

  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-theme",
    "night",
  );
  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-mode",
    "scrolled",
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as
          | (HTMLElement & {
              renderer?: {
                getContents(): Array<{ doc: Document }>;
              };
            })
          | null;
        const doc = view?.renderer?.getContents()[0]?.doc;
        if (!doc) return null;
        const style = doc.defaultView?.getComputedStyle(doc.body);
        return { size: style?.fontSize, family: style?.fontFamily };
      }),
    )
    .toMatchObject({ size: "15px" });

  const stored = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem("pocketlibrary.readerSettings") ?? "{}",
    ),
  );
  expect(stored).toMatchObject({
    size: 0,
    font: "literata",
    theme: "night",
    mode: "scrolled",
  });

  // Settings survive a relaunch (reload) and reach the Settings screen.
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-reader-scrolled")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("bookmarks add, survive relaunch, and remove", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await page.getByTestId("reader-contents").click();
  await page.getByTestId("reader-tab-bookmarks").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Close contents" }).click();

  await page.reload();
  await openReader(page);
  await showChrome(page);
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await page.getByTestId("reader-contents").click();
  await page.getByTestId("reader-tab-bookmarks").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await page.getByTestId("reader-bookmark-delete").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(0);
});

test("reading position resumes after reopen", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.mouse.click(350, 500);
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  const saved = await progress(page);
  await page.waitForTimeout(900);

  await showChrome(page);
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);

  await openReader(page);
  await showChrome(page);
  expect(await progress(page)).toBe(saved);
});

test("reaching the end marks the book finished", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  for (let turn = 0; turn < 12; turn += 1) {
    await page.mouse.click(350, 500);
    await page.waitForTimeout(120);
  }
  await expect.poll(() => progress(page)).toBeGreaterThanOrEqual(98);
  const last = await progress(page);

  // The last page's right zone is a no-op.
  await page.mouse.click(350, 500);
  expect(await progress(page)).toBe(last);

  await page.waitForTimeout(900);
  await showChrome(page);
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "finished",
  );
});

test("open in another app reports the real platform route", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await showChrome(page);

  await page.getByTestId("reader-external").click();
  await expect(page.getByTestId("reader-external-note")).toContainText(
    "needs the Android build",
  );
});

async function persistentProgress(page: Page): Promise<number> {
  const value = await page
    .getByTestId("reader-persistent-progress")
    .getAttribute("aria-valuenow");
  return Number(value ?? 0);
}

test("persistent progress stays visible without chrome", async ({
  page,
}) => {
  await boot(page, { settings: { spacing: 2 } });
  await page.goto("/");
  await openReader(page);

  await expect(page.locator(".reader-top")).not.toHaveClass(/is-visible/);
  await expect(page.getByTestId("reader-persistent-back")).toHaveCount(0);
  await expect(page.getByTestId("reader-persistent-progress")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-percent")).toBeVisible();
  expect(await persistentProgress(page)).toBe(0);

  await page.mouse.click(350, 500);
  await expect.poll(() => persistentProgress(page)).toBeGreaterThan(0);
  await expect(page.locator(".reader-top")).not.toHaveClass(/is-visible/);

  await showChrome(page);
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("Escape closes the reader", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("browser back closes the reader instead of leaving the app", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toBeVisible();
});
