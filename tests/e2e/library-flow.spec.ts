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
    format,
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

test("finished spines show the gold head ribbon and reading spines the drape", async ({
  page,
}) => {
  const books: Book[] = [
    { ...mockBook(3, "A Finished Volume", "epub", 0), readingStatus: "finished" },
    { ...mockBook(4, "A Volume in Progress", "pdf", 1), readingStatus: "reading" },
  ];

  await page.addInitScript((nextBooks) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: nextBooks,
    };
  }, books);

  await page.goto("/");

  const finished = page.locator('[data-testid="spine"][data-status="finished"]');
  const reading = page.locator('[data-testid="spine"][data-status="reading"]');
  await expect(finished).toHaveCount(1);
  await expect(reading).toHaveCount(1);

  // Finished: the gold head ribbon inside the spine, clear of the title box.
  await expect(finished.getByTestId("spine-gold-ribbon")).toBeVisible();
  await expect(finished).toHaveAttribute("aria-label", /Finished/);
  await expect(finished.locator(".spine-drape")).toHaveCount(0);

  // Reading: the oxblood drape lives in the case-level cue layer, past the
  // cavity's clip, so it is not a descendant of the spine.
  const drape = page.getByTestId("spine-drape");
  await expect(drape).toHaveCount(1);
  await expect(reading.getByTestId("spine-gold-ribbon")).toHaveCount(0);
  await expect(reading).toHaveAttribute("aria-label", /Reading/);
  const readingId = await reading.getAttribute("data-book-id");
  await expect(drape).toHaveAttribute("data-book-id", readingId ?? "");

  const finishedBox = await finished.boundingBox();
  const readingBox = await reading.boundingBox();
  const ribbonBox = await finished.getByTestId("spine-gold-ribbon").boundingBox();
  const titleBox = await finished.locator(".spine-text").boundingBox();
  const drapeBox = await drape.boundingBox();
  for (const box of [finishedBox, readingBox, ribbonBox, titleBox, drapeBox]) {
    expect(box).not.toBeNull();
  }
  if (finishedBox && readingBox && ribbonBox && titleBox && drapeBox) {
    // The ribbon is 8x26 at the head, inside the spine, above the title.
    expect(ribbonBox.width).toBeCloseTo(8, 0);
    expect(ribbonBox.height).toBeCloseTo(26, 0);
    expect(ribbonBox.y).toBeCloseTo(finishedBox.y, 0);
    expect(ribbonBox.x).toBeGreaterThanOrEqual(finishedBox.x);
    expect(ribbonBox.x + ribbonBox.width).toBeLessThanOrEqual(
      finishedBox.x + finishedBox.width + 1,
    );
    expect(ribbonBox.y + ribbonBox.height).toBeLessThanOrEqual(titleBox.y - 1);
    // The drape starts at the reading book's foot and hangs over the lip and
    // board, so its bottom passes the spine and reaches the board.
    const board = await page.locator(".v4-board").boundingBox();
    expect(board).not.toBeNull();
    expect(drapeBox.y).toBeCloseTo(
      readingBox.y + readingBox.height - 4,
      0,
    );
    expect(drapeBox.y + drapeBox.height).toBeGreaterThan(
      readingBox.y + readingBox.height + 9,
    );
    if (board) {
      expect(drapeBox.y + drapeBox.height).toBeCloseTo(
        board.y + board.height,
        0,
      );
    }
    expect(
      Math.abs(
        finishedBox.y + finishedBox.height - (readingBox.y + readingBox.height),
      ),
    ).toBeLessThanOrEqual(1);
  }
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

test("tapping a spine opens the framed detail and Back returns to the wall", async ({
  page,
}) => {
  const books: Book[] = [
    {
      ...mockBook(9, "The Hollow Crown", "epub", 0),
      authors: ["Ada Lovelace"],
      description:
        "A quiet revolution gathers behind the palace doors, and one reader must choose a side.",
      publisher: "Harrow & Row",
      publishedDate: "1974-05-01",
      series: "The Crown Papers",
      language: "en",
      readingStatus: "reading",
    },
  ];

  await page.addInitScript((nextBooks) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: nextBooks,
    };
  }, books);

  await page.goto("/");

  const wall = page.getByTestId("library-wall");
  await expect(wall).toBeVisible();
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await page.getByTestId("spine").first().click();

  const detail = page.getByTestId("book-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByTestId("detail-cover")).toBeVisible();
  await expect(page.getByTestId("detail-cover")).toHaveAttribute(
    "src",
    /^data:image/,
  );
  await expect(page.getByTestId("detail-title")).toHaveText(
    "The Hollow Crown",
  );
  await expect(page.getByTestId("detail-author")).toHaveText(
    "Ada Lovelace · 1974 · Shelf I",
  );
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "A quiet revolution",
  );
  await expect(page.getByTestId("detail-read")).toHaveText(
    "Continue reading",
  );

  await page.getByTestId("detail-back").click();

  await expect(detail).toHaveCount(0);
  await expect(wall).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

test("a book can be deleted from the library after confirmation", async ({
  page,
}) => {
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
  await expect(page.getByTestId("spine")).toHaveCount(2);

  await page.getByTestId("spine").first().click();
  const detail = page.getByTestId("book-detail");
  await expect(detail).toBeVisible();
  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-book")).toBeVisible();
  await page.getByTestId("detail-delete").click();

  const confirm = page.getByTestId("detail-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Delete “The Hollow Crown”");
  await page.getByTestId("detail-delete-confirm-button").click();

  await expect(detail).toHaveCount(0);
  await expect(page.getByTestId("spine")).toHaveCount(1);
  await expect(page.getByTestId("spine").first()).toHaveText(
    "A Field Guide to Birds",
  );
});

test("Escape and the scrim close the detail panel", async ({ page }) => {
  await page.addInitScript((nextBooks) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: nextBooks,
    };
  }, BOOKS);

  await page.goto("/");
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("book-detail")).toHaveCount(0);

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page
    .getByRole("button", { name: "Close book detail" })
    .click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
});
