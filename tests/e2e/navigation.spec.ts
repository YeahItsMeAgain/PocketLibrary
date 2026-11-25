import { expect, test } from "@playwright/test";

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

const BOOKS = [mockBook(1, "The Hollow Crown", 0)];

async function boot(page: import("@playwright/test").Page) {
  await page.addInitScript((books) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books,
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
    };
  }, BOOKS);
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

function drawer(page: import("@playwright/test").Page) {
  return page.getByRole("dialog", { name: "Navigation" });
}

async function openDrawer(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(drawer(page)).toBeVisible();
}

async function choose(
  page: import("@playwright/test").Page,
  name: "Library" | "Search" | "Settings",
) {
  await openDrawer(page);
  await drawer(page).getByRole("button", { name }).click();
  await expect(drawer(page)).toBeHidden();
}

async function watchRailAnimations(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const state = window as unknown as { __railAnimations?: number };
    state.__railAnimations = 0;
    document.addEventListener(
      "animationstart",
      (event) => {
        const target = event.target as Element | null;
        if (
          target?.classList?.contains("drawer-rail") &&
          (event as AnimationEvent).animationName === "drawer-rail-in"
        ) {
          state.__railAnimations = (state.__railAnimations ?? 0) + 1;
        }
      },
      true,
    );
  });
}

function railAnimations(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __railAnimations?: number }).__railAnimations ?? 0,
  );
}

test("a tap opens the drawer once, with one entrance animation", async ({
  page,
}) => {
  await boot(page);
  await watchRailAnimations(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(drawer(page)).toBeVisible();

  const rail = page.locator(".drawer-rail");
  await expect(rail).toHaveCount(1);
  await expect(rail).toHaveClass(/is-opening/);
  await expect.poll(() => railAnimations(page)).toBe(1);

  await expect(rail).not.toHaveClass(/is-opening/, { timeout: 2_000 });
  expect(await railAnimations(page)).toBe(1);
});

test("an upward drag opens without replaying the entrance animation", async ({
  page,
}) => {
  await boot(page);
  await watchRailAnimations(page);

  const pull = await page
    .getByRole("button", { name: "Open navigation" })
    .boundingBox();
  expect(pull).not.toBeNull();
  if (!pull) return;
  const x = pull.x + pull.width / 2;
  const y = pull.y + pull.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 140, { steps: 10 });
  await page.mouse.up();

  await expect(drawer(page)).toBeVisible();
  const rail = page.locator(".drawer-rail");
  await expect(rail).not.toHaveClass(/is-opening/);
  await expect(rail).not.toHaveClass(/is-dragging/);
  await page.waitForTimeout(550);
  expect(await railAnimations(page)).toBe(0);
});

test("a downward drag that snaps back does not replay or flicker", async ({
  page,
}) => {
  await boot(page);
  await openDrawer(page);
  await page.waitForTimeout(500);
  await watchRailAnimations(page);

  const rail = page.locator(".drawer-rail");
  const box = await rail.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const x = box.x + box.width / 2;
  const handleY = box.y + 18;

  await page.mouse.move(x, handleY);
  await page.mouse.down();
  await page.waitForTimeout(30);
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(x, handleY + step * 5);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();

  await expect(drawer(page)).toBeVisible();
  await expect(rail).not.toHaveClass(/is-dragging/);
  await expect(rail).not.toHaveClass(/is-opening/);
  await page.waitForTimeout(550);
  expect(await railAnimations(page)).toBe(0);
});

test("the drawer opens by tap and by a synthetic upward drag", async ({
  page,
}) => {
  await boot(page);

  await openDrawer(page);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();

  const pull = await page
    .getByRole("button", { name: "Open navigation" })
    .boundingBox();
  expect(pull).not.toBeNull();
  if (!pull) return;
  const x = pull.x + pull.width / 2;
  const y = pull.y + pull.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 140, { steps: 10 });
  await page.mouse.up();

  await expect(drawer(page)).toBeVisible();
});

test("a drag down past the threshold closes the drawer", async ({ page }) => {
  await boot(page);
  await openDrawer(page);
  // Let the rail finish its opening animation before grabbing it.
  await page.waitForTimeout(500);

  const rail = await page.locator(".drawer-rail").boundingBox();
  expect(rail).not.toBeNull();
  if (!rail) return;
  const x = rail.x + rail.width / 2;
  const handleY = rail.y + 18;

  await page.mouse.move(x, handleY);
  await page.mouse.down();
  await page.waitForTimeout(30);
  for (let step = 1; step <= 11; step += 1) {
    await page.mouse.move(x, handleY + step * 20);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await expect(drawer(page)).toBeHidden();
});

test("the drawer pull sits below the end of the wall", async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );

  const pull = await page
    .getByRole("button", { name: "Open navigation" })
    .boundingBox();
  const lastShelf = await page
    .locator('[data-testid="shelf"], [data-testid="empty-shelf"]')
    .last()
    .boundingBox();
  expect(pull).not.toBeNull();
  expect(lastShelf).not.toBeNull();
  if (!pull || !lastShelf) return;
  expect(pull.y).toBeGreaterThanOrEqual(lastShelf.y + lastShelf.height);
});

test("a short drag snaps the drawer back open", async ({ page }) => {
  await boot(page);
  await openDrawer(page);
  await page.waitForTimeout(500);

  const rail = await page.locator(".drawer-rail").boundingBox();
  expect(rail).not.toBeNull();
  if (!rail) return;
  const x = rail.x + rail.width / 2;
  const handleY = rail.y + 18;

  await page.mouse.move(x, handleY);
  await page.mouse.down();
  await page.waitForTimeout(30);
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(x, handleY + step * 5);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await expect(drawer(page)).toBeVisible();
});

test("scrim, Escape and browser back each close only the drawer", async ({
  page,
}) => {
  await boot(page);

  await openDrawer(page);
  await page.getByRole("button", { name: "Close navigation" }).click();
  await expect(drawer(page)).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (history.state as { __pocketLibraryLayer?: string } | null)
            ?.__pocketLibraryLayer,
        ),
      ),
    )
    .toBe(false);

  await openDrawer(page);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (history.state as { __pocketLibraryLayer?: string } | null)
            ?.__pocketLibraryLayer,
        ),
      ),
    )
    .toBe(false);

  await openDrawer(page);
  await page.goBack();
  await expect(drawer(page)).toBeHidden();
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("Search and Settings are real screens with visible back paths", async ({
  page,
}) => {
  await boot(page);

  await choose(page, "Search");
  await expect(page.getByTestId("search-view")).toContainText("Search Libgen");
  await page.getByTestId("search-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();

  await choose(page, "Settings");
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();

  await choose(page, "Settings");
  await page.goBack();
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("Library from the drawer returns to the wall from every destination", async ({
  page,
}) => {
  await boot(page);

  await choose(page, "Search");
  await choose(page, "Library");
  await expect(page.getByTestId("library-wall")).toBeVisible();

  await choose(page, "Settings");
  await choose(page, "Library");
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("browser back closes book detail to the wall", async ({ page }) => {
  await boot(page);
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("reader default changes persist and are used by the reader", async ({
  page,
}) => {
  await boot(page);
  await choose(page, "Settings");

  await page.getByTestId("settings-reader-theme-sepia").click();
  await page.getByTestId("settings-reader-size-4").click();
  await page.getByTestId("settings-reader-scrolled").click();

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await choose(page, "Settings");

  await expect(page.getByTestId("settings-reader-theme-sepia")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("settings-reader-size-4")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("settings-reader-scrolled")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const stored = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem("pocketlibrary.readerSettings") ?? "{}",
    ),
  );
  expect(stored.theme).toBe("sepia");
  expect(stored.size).toBe(4);
  expect(stored.mode).toBe("scrolled");
});

test("the drawer hint appears once and never returns", async ({ page }) => {
  await boot(page);

  const hint = page.getByText("Swipe up to open the drawer");
  await expect(hint).toBeVisible({ timeout: 4_000 });
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByText("Swipe up to open the drawer")).toHaveCount(0);
});

test("the wall carries no debug version text and Settings carries About", async ({
  page,
}) => {
  await boot(page);

  await expect(page.getByTestId("app-info")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await choose(page, "Settings");
  await expect(page.getByTestId("app-info")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.getByTestId("settings-version")).toContainText("v0.1.5");
  await expect(page.getByTestId("settings-schema")).toContainText("3");
  await expect(page.getByTestId("settings-view")).toContainText(
    "SIL Open Font License",
  );
  await expect(page.getByTestId("settings-download")).toContainText(
    "{author}",
  );
  await expect(page.getByTestId("download-naming")).toHaveValue(
    "{author} - {title} ({year})",
  );
  await expect(page.getByTestId("settings-export")).toBeEnabled();
  await expect(page.getByTestId("settings-import")).toBeEnabled();
});
