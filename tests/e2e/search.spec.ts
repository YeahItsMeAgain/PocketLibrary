import { expect, test } from "@playwright/test";

import type { Book, LibgenResult, Shelf } from "../../src/platform";

function book(index: number, shelfId: number, slotIndex: number): Book {
  return {
    id: index,
    contentHash: `shelf-book-${index}`,
    format: "epub",
    title: `Shelf Volume ${index}`,
    authors: ["Victorian Author"],
    series: null,
    language: "English",
    description: null,
    publisher: null,
    publishedDate: "1899",
    identifier: null,
    pageCount: 200,
    addedAt: 1,
    shelfId,
    slotIndex,
    readingStatus: "unread",
    labels: [],
  };
}

function result(index: number, overrides: Partial<LibgenResult> = {}): LibgenResult {
  return {
    md5: `md5${String(index).padStart(29, "0")}`,
    title: `A Victorian Book ${index}`,
    authors: ["Ada Author"],
    publisher: "Brass & Co.",
    year: 2021,
    language: "English",
    pages: 200,
    sizeText: "3 MB",
    sizeBytes: 3_000_000,
    extension: "epub",
    fileId: 1000 + index,
    source: "libgen.li",
    mirrors: [{ label: "libgen.li", url: `https://libgen.li/ads.php?md5=md5${index}` }],
    ...overrides,
  };
}

async function boot(
  page: import("@playwright/test").Page,
  config: Record<string, unknown> = {},
) {
  await page.addInitScript((mock) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      ...mock,
    };
  }, config);
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("search-view")).toBeVisible();
}

test("basic search lists results with honest counts and a read-only detail", async ({
  page,
}) => {
  await boot(page);

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(4);
  await expect(page.getByTestId("search-counts")).toContainText("4");
  await expect(page.getByTestId("search-counts")).toContainText("libgen.li");
  await expect(page.getByTestId("search-result").first()).toContainText(
    "Rock Paper Scissors",
  );
  await expect(page.getByTestId("search-result").first()).toContainText("EPUB");
  await expect(page.getByTestId("search-result").first()).toContainText("3 MB");

  await page.getByTestId("search-result").first().click();
  const sheet = page.getByTestId("result-detail");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Alice Feeney");
  await expect(sheet).toContainText("HarperCollins Publishers");
  await expect(sheet).toContainText("a1423442916f2f3def9517a3bf4dee48");
  await expect(page.getByTestId("mirror-row")).toHaveCount(3);
  const download = page.getByTestId("result-download");
  await expect(download).toBeEnabled();
  await expect(download).toContainText("Download to library");

  await page.getByTestId("result-detail-close").click();
  await expect(sheet).toHaveCount(0);

  // Scrolling to the end leaves the last result above the fixed pull.
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const pull = await page
    .getByRole("button", { name: "Open navigation" })
    .boundingBox();
  const lastResult = await page.getByTestId("search-result").last().boundingBox();
  expect(pull).not.toBeNull();
  expect(lastResult).not.toBeNull();
  if (!pull || !lastResult) return;
  expect(pull.y).toBeGreaterThanOrEqual(lastResult.y + lastResult.height);
});

test("browser back closes the result detail before the Search view", async ({
  page,
}) => {
  await boot(page);

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await expect(page.getByTestId("result-detail")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("result-detail")).toHaveCount(0);
  await expect(page.getByTestId("search-view")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("search-view")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("advanced fields filter client-side and report what was hidden", async ({
  page,
}) => {
  await boot(page);

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-advanced-toggle").click();
  await page.getByTestId("search-year-from").fill("2021");
  await page.getByTestId("search-year-to").fill("2021");
  await page.getByTestId("search-format").selectOption("pdf");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(1);
  await expect(page.getByTestId("search-result")).toContainText("PDF");
  await expect(page.getByTestId("search-counts")).toContainText(
    "hidden by your filters",
  );
});

test("paging reports 25 at a time and stops at the honest total", async ({
  page,
}) => {
  const rows = Array.from({ length: 30 }, (_, index) => result(index));
  await boot(page, { searchResults: rows, searchTotal: 30 });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(25);
  await expect(page.getByTestId("search-page")).toHaveText("Page 1");
  await expect(page.getByTestId("search-next")).toBeEnabled();
  await page.getByTestId("search-next").click();

  await expect(page.getByTestId("search-page")).toHaveText("Page 2");
  await expect(page.getByTestId("search-result")).toHaveCount(5);
  await expect(page.getByTestId("search-next")).toBeDisabled();
  await expect(page.getByTestId("search-prev")).toBeEnabled();
  await page.getByTestId("search-prev").click();
  await expect(page.getByTestId("search-page")).toHaveText("Page 1");
});

test("a page fully hidden by filters still pages forward", async ({ page }) => {
  const rows = Array.from({ length: 30 }, (_, index) =>
    result(index, { extension: "pdf" }),
  );
  await boot(page, { searchResults: rows, searchTotal: 30 });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-advanced-toggle").click();
  await page.getByTestId("search-format").selectOption("epub");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(0);
  await expect(page.getByTestId("search-empty")).toContainText(
    "0 matches on this page",
  );
  await expect(page.getByTestId("search-clear-filters")).toBeVisible();
  await expect(page.getByTestId("search-next")).toBeEnabled();
  await page.getByTestId("search-next").click();

  await expect(page.getByTestId("search-page")).toHaveText("Page 2");
  await expect(page.getByTestId("search-prev")).toBeEnabled();
  await expect(page.getByTestId("search-next")).toBeDisabled();
});

test("rows dropped as non-EPUB/PDF are reported instead of silently vanishing", async ({
  page,
}) => {
  const rows = Array.from({ length: 18 }, (_, index) => result(index));
  await boot(page, {
    searchResults: rows,
    searchTotal: 43,
    searchRowsReturned: 25,
    searchUnsupportedRows: 7,
  });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(18);
  await expect(page.getByTestId("search-counts")).toContainText(
    "7 non-EPUB/PDF hidden",
  );
});

test("a page with no supported files explains why and still pages forward", async ({
  page,
}) => {
  await boot(page, {
    searchResults: [],
    searchTotal: 43,
    searchOnPageBeforeFilters: 0,
    searchRowsReturned: 25,
    searchUnsupportedRows: 25,
  });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-empty")).toContainText(
    "No EPUB or PDF on this page",
  );
  await expect(page.getByTestId("search-empty")).toContainText(
    "25 of 25 rows on this page are not EPUB or PDF",
  );
  await expect(page.getByTestId("search-next")).toBeEnabled();
});

test("an inexact total keeps paging while the mirror returns a full row set", async ({
  page,
}) => {
  const rows = Array.from({ length: 8 }, (_, index) => result(index));
  await boot(page, {
    searchResults: rows,
    searchTotal: 8,
    searchTotalIsExact: false,
    searchRowsReturned: 25,
    searchUnsupportedRows: 17,
  });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(8);
  await expect(page.getByTestId("search-counts")).toContainText("or more files");
  await expect(page.getByTestId("search-next")).toBeEnabled();
});

test("a genuine no-results answer is shown as such", async ({ page }) => {
  await boot(page, { searchMode: "empty" });

  await page.getByTestId("search-query").fill("nothing at all");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-empty")).toContainText("No files found");
  await expect(page.getByTestId("search-error")).toHaveCount(0);
});

test("offline and all-mirrors-failed are distinct, retryable states", async ({
  page,
}) => {
  await boot(page, { searchMode: "offline" });

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("search-error")).toContainText(
    "The desk is offline",
  );
  await expect(page.getByTestId("search-retry")).toBeVisible();

  await page.addInitScript(() => {
    (window as unknown as { __POCKETLIBRARY_MOCK__: unknown }).__POCKETLIBRARY_MOCK__ =
      { state: "ready", folderName: "PocketLibrary", books: [], searchMode: "allFailed" };
  });
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("search-error")).toContainText(
    "Every mirror refused",
  );
});

test("back returns to the wall", async ({ page }) => {
  await boot(page);
  await page.getByTestId("search-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("search-view")).toHaveCount(0);
});


test("a download shows queue progress and can be cancelled", async ({
  page,
}) => {
  await boot(page, { downloadStepMs: 1500 });
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  await expect(page.getByTestId("download-queue")).toBeVisible();
  await expect(page.getByTestId("download-badge")).toContainText("1 active");
  await expect(page.getByTestId("download-status").first()).toContainText(
    /Queued|Downloading/,
  );
  await expect(page.getByTestId("result-download-state")).toContainText(
    /Queued|Downloading/,
  );

  await page.getByTestId("result-download-cancel").click();
  await expect(page.getByTestId("download-status").first()).toContainText(
    "Cancelled",
  );
  await expect(page.getByTestId("download-retry")).toBeVisible();
});

test("a completed download says Added to library and the wall shows a new spine", async ({
  page,
}) => {
  await boot(page);
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  await expect(page.getByTestId("download-status").first()).toContainText(
    "Added to library",
    { timeout: 5000 },
  );
  await expect(page.getByTestId("result-download-state")).toContainText(
    "Added to library",
  );

  await page.getByTestId("result-detail-close").click();
  await page.getByTestId("search-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(
    page.getByTestId("spine").filter({ hasText: "Rock Paper Scissors" }),
  ).toHaveCount(1);
});

test("a running download shows the transient mirror failover note", async ({
  page,
}) => {
  await boot(page, { downloadStepMs: 900, downloadFailover: true });
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  await expect(page.getByTestId("download-status").first()).toContainText(
    "Trying another mirror…",
    { timeout: 5000 },
  );
  await expect(page.getByTestId("result-download-state")).toContainText(
    "Trying another mirror…",
  );
  await expect(page.getByTestId("download-cancel")).toBeVisible();
});

test("a failed download shows the reason and a retry action", async ({
  page,
}) => {
  await boot(page, { downloadFail: true, downloadFailCode: "mirror_failed" });
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  await expect(page.getByTestId("download-status").first()).toContainText(
    "mirror refused",
    { timeout: 5000 },
  );
  await expect(page.getByTestId("download-retry")).toBeVisible();
  await expect(page.getByTestId("result-download-retry")).toBeVisible();
});

test("a download finishing after leaving search refreshes and scrolls the wall", async ({
  page,
}) => {
  const shelves: Shelf[] = [1, 2, 3, 4].map((id, ordinal) => ({
    id,
    ordinal,
    capacity: 12,
  }));
  const books: Book[] = [];
  let nextId = 1;
  for (const shelfId of [1, 2, 3]) {
    for (let slotIndex = 0; slotIndex < 12; slotIndex += 1) {
      books.push(book(nextId++, shelfId, slotIndex));
    }
  }
  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    books.push(book(nextId++, 4, slotIndex));
  }

  await boot(page, { books, shelves, downloadStepMs: 220 });
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();
  await page.getByTestId("result-detail-close").click();
  await page.getByTestId("search-back").click();

  await expect(
    page.getByTestId("spine").filter({ hasText: "Rock Paper Scissors" }),
  ).toHaveCount(1, { timeout: 10_000 });
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 })
    .toBeGreaterThan(0);
});
