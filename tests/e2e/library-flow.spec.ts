import { expect, test } from "@playwright/test";

import type { Book } from "../../src/platform";

function mockBook(
  id: number,
  title: string,
  format: Book["format"],
  slotIndex: number,
): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    quickKey: null,
    format,
    title,
    authors: [],
    series: null,
    language: null,
    description: null,
    publisher: null,
    publishedDate: null,
    identifier: null,
    addedAt: 1_700_000_000,
    shelfId: 1,
    slotIndex,
    readingStatus: "unread",
  };
}

const BOOKS = [
  mockBook(1, "The Hollow Crown", "epub", 0),
  mockBook(2, "A Field Guide to Birds", "pdf", 1),
];

test("first run explains the folder and choosing one opens the wall", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("onboarding")).toBeVisible();
  await expect(page.getByText("Documents/PocketLibrary")).toBeVisible();

  await page
    .getByRole("button", { name: "Choose library folder" })
    .click();

  await expect(page.getByTestId("onboarding")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("empty-shelf")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add books" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find a book" })).toBeVisible();
});

test("a scan result renders book spines on the shelf", async ({ page }) => {
  await page.addInitScript((books) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books,
    };
  }, BOOKS);

  await page.goto("/");

  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine")).toHaveCount(2);
  await expect(page.getByTestId("spine").first()).toHaveText(
    "The Hollow Crown",
  );
  await expect(page.getByTestId("spine").nth(1)).toHaveText(
    "A Field Guide to Birds",
  );
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "unread",
  );
});

test("a revoked grant shows reconnect instead of an empty wall", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "disconnected",
      folderName: "PocketLibrary",
      books: [],
    };
  });

  await page.goto("/");

  await expect(page.getByTestId("reconnect")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reconnect library folder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reconnect library folder" }),
  ).toBeVisible();
  await expect(page.getByTestId("library-wall")).toHaveCount(0);
  await expect(page.getByTestId("empty-shelf")).toHaveCount(0);
});
