import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

function mockBook(id: number, title: string, slotIndex: number): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title,
    authors: [],
    series: null,
    language: null,
    description: null,
    publisher: null,
    publishedDate: null,
    identifier: null,
    pageCount: null,
    addedAt: 1_700_000_000,
    shelfId: 1,
    slotIndex,
    readingStatus: "unread",
    labels: [],
  };
}

const BOOKS = [
  mockBook(1, "The Hollow Crown", 0),
  mockBook(2, "A Quiet Ledger", 1),
];

async function boot(page: Page, mock: Record<string, unknown> = {}) {
  await page.addInitScript(
    ({ books, extra }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
        ...extra,
      };
    },
    { books: BOOKS, extra: mock },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

/** Record any request for a book payload so the test can prove none happened. */
function watchBookRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\.(epub|pdf)(\?|$)/i.test(request.url())) requests.push(request.url());
  });
  return requests;
}

test("export writes one archive and reports what it covered", async ({
  page,
}) => {
  const bookRequests = watchBookRequests(page);
  await boot(page, {
    backupExport: {
      fileName: "my-shelf.pocketlibrary",
      bytes: 20_480,
      books: 2,
    },
  });

  await page.getByTestId("settings-export").click();

  const notice = page.getByTestId("backup-notice");
  await expect(notice).toContainText("Exported 2 books");
  await expect(notice).toContainText("20 KB");
  await expect(notice).toContainText("my-shelf.pocketlibrary");
  await expect(notice).toContainText("Book files were not copied");
  expect(bookRequests).toEqual([]);
});

test("import previews an archive and merges by default", async ({ page }) => {
  const bookRequests = watchBookRequests(page);
  await boot(page, {
    backupPreview: { matched: 5, new: 2 },
    backupMergeReport: {
      mode: "merge",
      matched: 5,
      new: 2,
      skipped: 1,
      replaced: 0,
    },
  });

  await page.getByTestId("settings-import").click();

  const preview = page.getByTestId("backup-preview");
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("backup-preview-matched")).toHaveText("5");
  await expect(page.getByTestId("backup-preview-new")).toHaveText("2");
  await expect(page.getByTestId("backup-merge")).toBeVisible();

  await page.getByTestId("backup-merge").click();

  await expect(page.getByTestId("backup-preview")).toHaveCount(0);
  await expect(page.getByTestId("backup-notice")).toContainText(
    "Merge complete: 2 new, 5 matched, 1 newer reading position kept",
  );
  await expect(page.getByTestId("backup-notice")).toContainText(
    "Nothing was deleted",
  );
  expect(bookRequests).toEqual([]);
});

test("replace requires an explicit confirmation", async ({ page }) => {
  const bookRequests = watchBookRequests(page);
  await boot(page, {
    backupPreview: { matched: 1, new: 6 },
    backupReplaceReport: {
      mode: "replace",
      matched: 1,
      new: 6,
      skipped: 0,
      replaced: 2,
    },
  });

  await page.getByTestId("settings-import").click();
  await expect(page.getByTestId("backup-preview")).toBeVisible();

  await page.getByTestId("backup-replace").click();
  await expect(page.getByTestId("backup-replace-confirm")).toBeVisible();
  // Nothing has been applied yet: the acknowledgement is still pending.
  await expect(page.getByTestId("backup-notice")).toHaveCount(0);

  await page.getByTestId("backup-replace-cancel").click();
  await expect(page.getByTestId("backup-replace-confirm")).toHaveCount(0);
  await expect(page.getByTestId("backup-preview")).toBeVisible();

  await page.getByTestId("backup-replace").click();
  await page.getByTestId("backup-replace-confirm").click();

  await expect(page.getByTestId("backup-preview")).toHaveCount(0);
  await expect(page.getByTestId("backup-notice")).toContainText(
    "Library data replaced: 6 new, 1 matched, 2 previous books cleared",
  );
  await expect(page.getByTestId("backup-notice")).toContainText(
    "No book files were moved",
  );
  expect(bookRequests).toEqual([]);
});

test("a corrupt archive is rejected with a clear reason", async ({ page }) => {
  await boot(page, {
    backupError: {
      code: "archive_corrupt",
      message: "That backup file is damaged and cannot be restored.",
    },
  });

  await page.getByTestId("settings-import").click();

  await expect(page.getByTestId("backup-error")).toContainText(
    "damaged and cannot be restored",
  );
  await expect(page.getByTestId("backup-preview")).toHaveCount(0);
  await expect(page.getByTestId("backup-merge")).toHaveCount(0);
});

test("import runs a rescan and reports the books it linked or added", async ({
  page,
}) => {
  const imported = mockBook(3, "The Returned Volume", 0);
  const linked = mockBook(4, "A File With A Path", 1);
  await boot(page, {
    backupPreview: { matched: 1, new: 1 },
    backupMergeReport: {
      mode: "merge",
      matched: 1,
      new: 1,
      skipped: 0,
      replaced: 0,
    },
    // The mock import runs the same rescan seam as the native shell: a new
    // file is added and a known book is re-linked to the file it matches.
    backupScanAdds: [imported, { ...linked, contentHash: BOOKS[0].contentHash }],
  });

  await page.getByTestId("settings-import").click();
  await page.getByTestId("backup-merge").click();

  const notice = page.getByTestId("backup-notice");
  await expect(notice).toContainText("Merge complete");
  await expect(notice).toContainText("Rescan after import:");
  await expect(notice).toContainText("1 imported book linked to its file");
  await expect(notice).toContainText("1 new book found");
  await expect(page.getByTestId("backup-preview")).toHaveCount(0);
});
