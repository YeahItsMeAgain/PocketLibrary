import { expect, test } from "@playwright/test";

import type { Book, MockConfig, Shelf } from "../../src/platform";

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
    labels: [],
  };
}

function mockShelf(id: number, ordinal: number, capacity: number): Shelf {
  return { id, ordinal, capacity };
}

async function seed(
  page: Parameters<typeof test>[0]["page"],
  config: MockConfig,
) {
  await page.addInitScript((nextConfig) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = nextConfig;
    window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
  }, config);
  await page.goto("/");
}

function spine(page: Parameters<typeof test>[0]["page"], title: string) {
  return page.locator(`[data-testid="spine"]`, { hasText: title }).first();
}

async function longPress(
  page: Parameters<typeof test>[0]["page"],
  target: ReturnType<typeof spine>,
) {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("spine has no box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(460);
  await expect(page.locator(".spine.is-dragging-source")).toHaveCount(1);
  return start;
}

test("long-press dragging within a shelf reorders and persists in the wall", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [mockShelf(1, 0, 6)],
    books: [
      mockBook(1, "Alpha", 1, 0),
      mockBook(2, "Beta", 1, 1),
      mockBook(3, "Gamma", 1, 2),
    ],
  });

  const spines = page.getByTestId("spine");
  await expect(spines).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const start = await longPress(page, spine(page, "Alpha"));

  const gammaBox = await spine(page, "Gamma").boundingBox();
  expect(gammaBox).not.toBeNull();
  if (!gammaBox) return;
  await page.mouse.move(start.x, gammaBox.y + gammaBox.height / 2, {
    steps: 6,
  });
  await page.mouse.move(
    gammaBox.x + gammaBox.width + 4,
    gammaBox.y + gammaBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();

  await expect(spines.nth(0)).toHaveText("Beta");
  await expect(spines.nth(1)).toHaveText("Gamma");
  await expect(spines.nth(2)).toHaveText("Alpha");
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
});

test("cross-shelf drag with edge auto-scroll lands on the next shelf", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [
      mockShelf(1, 0, 4),
      mockShelf(2, 1, 4),
      mockShelf(3, 2, 4),
    ],
    books: [
      mockBook(1, "Alpha", 1, 0),
      mockBook(2, "Beta", 1, 1),
      mockBook(3, "Delta", 2, 0),
      mockBook(4, "Epsilon", 2, 1),
      mockBook(5, "Zeta", 3, 0),
    ],
  });

  const start = await longPress(page, spine(page, "Alpha"));
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  await page.mouse.move(start.x, viewport.height - 16, { steps: 8 });
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), {
      message: "holding at the edge scrolls the wall",
      timeout: 3000,
    })
    .toBeGreaterThan(0);

  const nextShelf = page.locator('section[data-shelf-id="2"]');
  const nextBox = await nextShelf.boundingBox();
  expect(nextBox).not.toBeNull();
  if (!nextBox) return;
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2, {
    steps: 8,
  });
  await page.waitForTimeout(80);
  await page.mouse.up();

  await expect(nextShelf.getByTestId("spine")).toHaveCount(3);
  await expect(nextShelf.getByTestId("spine").filter({ hasText: "Alpha" })).toHaveCount(1);
  await expect(
    page.locator('section[data-shelf-id="1"]').getByTestId("spine"),
  ).toHaveCount(1);
});

test("a short tap still opens the book detail", async ({ page }) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [mockShelf(1, 0, 6)],
    books: [mockBook(1, "Alpha", 1, 0)],
  });

  await spine(page, "Alpha").click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await expect(page.getByTestId("detail-title")).toHaveText("Alpha");
});

test("the drag hint appears once and stays dismissed", async ({ page }) => {
  await page.addInitScript((nextConfig) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = nextConfig;
  }, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [mockShelf(1, 0, 6)],
    books: [mockBook(1, "Alpha", 1, 0)],
  } satisfies MockConfig);
  await page.goto("/");

  const hint = page.getByTestId("drag-hint");
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(hint).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("drag-hint")).toHaveCount(0);
});

test("dropping outside a shelf returns the book to its original slot", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [mockShelf(1, 0, 6), mockShelf(2, 1, 6)],
    books: [
      mockBook(1, "Alpha", 1, 0),
      mockBook(2, "Beta", 1, 1),
      mockBook(3, "Gamma", 2, 0),
    ],
  });

  await expect(page.getByTestId("spine")).toHaveCount(3);
  const before = await page.getByTestId("spine").allTextContents();
  const start = await longPress(page, spine(page, "Alpha"));
  await page.mouse.move(start.x, 6, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(260);

  await expect(page.getByTestId("spine").nth(0)).toHaveText("Alpha");
  await expect(page.getByTestId("spine").nth(1)).toHaveText("Beta");
  expect(await page.getByTestId("spine").allTextContents()).toEqual(before);
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
});
