import { expect, test } from "@playwright/test";

import type { Book, MockConfig } from "../../src/platform";

function mockBook(
  id: number,
  title: string,
  shelfId: number,
  slotIndex: number,
): Book {
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
    shelfId,
    slotIndex,
    readingStatus: "unread",
  };
}

async function seed(page: Parameters<typeof test>[0]["page"], config: MockConfig) {
  await page.addInitScript((nextConfig) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = nextConfig;
  }, config);
  await page.goto("/");
}

test("a new shelf offers undo and the undo removes the book and shelf", async ({
  page,
}) => {
  const first = mockBook(1, "The First Volume", 1, 0);
  const added = mockBook(0, "The Arrival", 0, 0);

  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [first],
    shelfCapacity: 1,
    scanAdds: [added],
  });

  await expect(page.getByTestId("spine")).toHaveCount(2);
  await expect(page.getByTestId("shelf")).toHaveCount(2);
  const notice = page.getByTestId("undo-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("A new shelf was added");

  await page.getByTestId("undo-placement").click();

  await expect(page.getByTestId("undo-notice")).toHaveCount(0);
  await expect(page.getByTestId("spine")).toHaveCount(1);
  await expect(page.getByTestId("shelf")).toHaveCount(1);
  await expect(page.getByTestId("library-notice")).toHaveText(
    "Removed from the library — the file stays in your folder",
  );
});

test("the wall and settings expose no shelf management controls", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "A Volume", 1, 0)],
  });

  const forbidden = /rename|reorder|add shelf|new shelf|delete shelf|remove shelf|manage shelf/i;
  await expect(
    page.getByTestId("library-wall").getByRole("button", { name: forbidden }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();

  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("shelf-capacity")).toBeVisible();
  await expect(
    page.getByTestId("settings-view").getByRole("button", { name: forbidden }),
  ).toHaveCount(0);
});

test("returning from the detail restores the same shelf and scroll position", async ({
  page,
}) => {
  const books = Array.from({ length: 60 }, (_, index) =>
    mockBook(
      index + 1,
      `Volume ${String(index + 1).padStart(2, "0")}`,
      Math.floor(index / 12) + 1,
      index % 12,
    ),
  );

  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books,
  });

  const lastSpine = page.getByTestId("spine").last();
  await lastSpine.scrollIntoViewIfNeeded();
  const shelf = lastSpine.locator("xpath=ancestor::section[1]");
  const shelfLabel = await shelf.getAttribute("aria-label");
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);

  await lastSpine.click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page.getByTestId("detail-back").click();

  await expect(page.getByTestId("book-detail")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  const restoredShelf = page.locator(`section[aria-label="${shelfLabel}"]`);
  await expect(restoredShelf).toBeVisible();
  await expect(restoredShelf.getByTestId("spine")).toHaveCount(12);
});
