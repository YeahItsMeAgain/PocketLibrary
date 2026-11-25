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

test("a partly filled shelf packs books from the left", async ({ page }) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    shelves: [mockShelf(1, 0, 6)],
    books: [
      mockBook(1, "Alpha", 1, 0),
      mockBook(2, "Beta", 1, 1),
      mockBook(3, "Gamma", 1, 2),
      mockBook(4, "Delta", 1, 3),
      mockBook(5, "Epsilon", 1, 4),
    ],
  });

  await expect(page.getByTestId("spine")).toHaveCount(5);
  const layout = await page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(
      'section[data-shelf-id="1"] .spines',
    );
    if (!strip) throw new Error("shelf strip is missing");
    const spines = Array.from(
      strip.querySelectorAll<HTMLElement>(":scope > .spine"),
    );
    return {
      stripWidth: strip.getBoundingClientRect().width,
      spines: spines.map((spine) => ({
        left: spine.offsetLeft,
        width: spine.offsetWidth,
      })),
    };
  });

  expect(layout.spines).toHaveLength(5);
  // The first book sits against the left of the shelf, not its centre.
  expect(layout.spines[0].left).toBeLessThanOrEqual(1);
  // Spines are separated by the normal gap, not stretched over the board.
  for (let index = 1; index < layout.spines.length; index += 1) {
    const gap =
      layout.spines[index].left -
      (layout.spines[index - 1].left + layout.spines[index - 1].width);
    expect(gap).toBeLessThanOrEqual(4);
  }
  const last = layout.spines[layout.spines.length - 1];
  const emptyRight = layout.stripWidth - (last.left + last.width);
  expect(emptyRight).toBeGreaterThan(60);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("dragging a book into the middle inserts it before the next book", async ({
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
      mockBook(4, "Delta", 1, 3),
      mockBook(5, "Epsilon", 1, 4),
    ],
  });

  const spines = page.getByTestId("spine");
  await expect(spines).toHaveCount(5);
  const start = await longPress(page, spine(page, "Alpha"));

  const gammaBox = await spine(page, "Gamma").boundingBox();
  const deltaBox = await spine(page, "Delta").boundingBox();
  expect(gammaBox).not.toBeNull();
  expect(deltaBox).not.toBeNull();
  if (!gammaBox || !deltaBox) return;
  const y = gammaBox.y + gammaBox.height / 2;
  // Past Gamma's centre and before Delta's, so Alpha belongs third.
  await page.mouse.move(start.x, y, { steps: 4 });
  await page.mouse.move(deltaBox.x + 2, y, { steps: 8 });
  const expected = ["Beta", "Gamma", "Alpha", "Delta", "Epsilon"];
  await expect(spines).toHaveText(expected);

  // Follow the gap the preview opened: the dragged source still occupies its
  // new slot invisibly. Moving onto it must not flip the insertion point.
  const gap = await page
    .locator('[data-testid="spine"][data-dragging="true"]')
    .boundingBox();
  expect(gap).not.toBeNull();
  if (!gap) return;
  await page.mouse.move(gap.x + gap.width / 2, y, { steps: 4 });
  await expect(spines).toHaveText(expected);
  await page.mouse.up();

  await expect(spines).toHaveText(expected);
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
