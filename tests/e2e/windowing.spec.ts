import { expect, test } from "@playwright/test";

import type { Book, MockConfig, Shelf } from "../../src/platform";

function mockShelf(id: number, ordinal: number, capacity: number): Shelf {
  return { id, ordinal, capacity };
}

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

function longWall(shelfCount: number): MockConfig {
  const shelves = Array.from({ length: shelfCount }, (_, index) =>
    mockShelf(index + 1, index, 6),
  );
  const books = shelves.flatMap((shelf) => [
    mockBook(shelf.id * 100 + 1, `Volume ${shelf.ordinal + 1}A`, shelf.id, 0),
    mockBook(shelf.id * 100 + 2, `Volume ${shelf.ordinal + 1}B`, shelf.id, 1),
  ]);
  return { state: "ready", folderName: "PocketLibrary", shelves, books };
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
    window.localStorage.setItem("pocketlibrary.drawerHintSeen", "1");
  }, config);
  await page.goto("/");
}

function spine(page: Parameters<typeof test>[0]["page"], title: string) {
  return page.locator('[data-testid="spine"]', { hasText: title }).first();
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

test("the wall mounts a scroll window with exact-height placeholders", async ({
  page,
}) => {
  await seed(page, longWall(30));

  const wall = page.getByTestId("library-wall");
  await expect(wall).toBeVisible();
  await expect
    .poll(async () => page.getByTestId("spine").count())
    .toBeGreaterThanOrEqual(6);
  expect(await page.getByTestId("spine").count()).toBeLessThanOrEqual(12);

  const mounted = await wall.getAttribute("data-rendered-shelves");
  expect(Number(mounted)).toBeGreaterThan(1);
  expect(Number(mounted)).toBeLessThan(8);
  expect(
    Number(
      await page.getByTestId("shelf-window").getAttribute("data-shelf-total"),
    ),
  ).toBe(30);
  await expect(page.locator("[data-shelf-placeholder]")).toHaveCount(1);

  const heightBefore = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const firstRange = await page.getByTestId("shelf-window").getAttribute(
    "data-shelf-range",
  );

  await page.evaluate(() => window.scrollTo(0, 358 * 12));
  await expect
    .poll(() =>
      page.getByTestId("shelf-window").getAttribute("data-shelf-range"),
    )
    .not.toBe(firstRange);
  await expect(page.locator('[data-shelf-index="0"]')).toHaveCount(0);
  await expect(page.locator('[data-shelf-index="12"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBe(heightBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(358 * 12);

  // Returning to the top recycles the slots but never shifts the wall.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('[data-shelf-index="0"]')).toHaveCount(1);
  await expect
    .poll(() => page.getByTestId("shelf-window").getAttribute("data-shelf-range"))
    .toBe(firstRange);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBe(heightBefore);
});

test("dragging across a recycle boundary keeps the source and lands the book", async ({
  page,
}) => {
  await seed(page, longWall(30));

  const start = await longPress(page, spine(page, "Volume 1A"));
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  await page.mouse.move(start.x, viewport.height - 14, { steps: 8 });
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: "edge auto-scroll crosses the initial window",
      timeout: 6000,
    })
    .toBeGreaterThan(500);

  // The source shelf is pinned even after it leaves the window.
  await expect(page.locator('section[data-shelf-id="1"]')).toHaveCount(1);

  const targetId = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("section[data-shelf-id]")]
      .filter((section) => section.dataset.shelfId !== "1")
      .filter((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
    return candidates.length
      ? candidates[candidates.length - 1].getAttribute("data-shelf-id")
      : null;
  });
  expect(targetId).not.toBeNull();
  if (!targetId) return;
  const target = page.locator(`section[data-shelf-id="${targetId}"]`);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(
    target.getByTestId("spine").filter({ hasText: "Volume 1A" }),
  ).toHaveCount(1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('[data-shelf-index="0"]')).toHaveCount(1);
  const sourceShelf = page.locator('section[data-shelf-id="1"]');
  await expect(sourceShelf.getByTestId("spine")).toHaveCount(1);
  await expect(
    sourceShelf.getByTestId("spine").filter({ hasText: "Volume 1A" }),
  ).toHaveCount(0);
});

test("the shelf skeleton paints while the first data request is in flight", async ({
  page,
}) => {
  await seed(page, { ...longWall(4), libraryDelayMs: 1800 });

  await expect(page.getByTestId("library-skeleton")).toBeVisible();
  await expect(page.getByTestId("library-wall")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Pocket Library" })).toBeVisible();

  await expect(page.getByTestId("library-skeleton")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("spine")).toHaveCount(8);
});
