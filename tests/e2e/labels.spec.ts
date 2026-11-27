import { expect, test } from "@playwright/test";

import type { Book, Label, MockConfig, ReadingStatus } from "../../src/platform";

const OXBLOOD = "#6e2630";
const FOREST = "#294735";
const MUSTARD = "#6b4d18";

function mockLabel(id: number, name: string, colour: string): Label {
  return { id, name, colour, createdAt: 1_700_000_000 + id };
}

function mockBook(
  id: number,
  title: string,
  slotIndex: number,
  status: ReadingStatus = "unread",
  labels: Label[] = [],
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
    shelfId: 1,
    slotIndex,
    readingStatus: status,
    labels,
  };
}

async function seed(
  page: Parameters<typeof test>[0]["page"],
  config: MockConfig,
) {
  await page.addInitScript((nextConfig) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = nextConfig;
  }, config);
  await page.goto("/");
}

test("creating a label, attaching it from the detail, and seeing the spine band", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "The Hollow Crown", 0), mockBook(2, "A Field Guide", 1)],
  });

  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await expect(manager).toBeVisible();
  await manager.getByTestId("label-name").fill("Gothic");
  await manager.getByRole("button", { name: "Mustard" }).click();
  await manager.getByTestId("create-label").click();

  const row = manager.getByTestId("label-row").filter({ hasText: "Gothic" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("0 books");
  await manager.getByRole("button", { name: "Close label manager" }).click();

  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-edit").click();
  await page.getByTestId("edit-add-label").click();
  await page
    .getByTestId("edit-book")
    .getByRole("menuitem", { name: "Gothic" })
    .click();
  await expect(
    page.getByTestId("edit-label-chip").filter({ hasText: "Gothic" }),
  ).toBeVisible();
  await page.getByTestId("edit-book-close").click();
  await expect(
    page.getByTestId("detail-label-chip").filter({ hasText: "Gothic" }),
  ).toBeVisible();
  await page.getByTestId("detail-back").click();

  const firstSpine = page.getByTestId("spine").first();
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveCount(1);
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveText("Gothic");
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveCSS(
    "background-color",
    "rgb(107, 77, 24)",
  );
});

test("filtering dims non-matching spines without moving them and ANDs with status", async ({
  page,
}) => {
  const gothic = mockLabel(1, "Gothic", OXBLOOD);
  const winter = mockLabel(2, "Winter", MUSTARD);
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    labels: [gothic, winter],
    books: [
      mockBook(1, "Raven Hall", 0, "reading", [gothic]),
      mockBook(2, "The Old Curiosity", 1, "unread", [gothic]),
      mockBook(3, "Snow Country", 2, "finished", [winter]),
    ],
  });

  const spines = page.getByTestId("spine");
  await expect(spines).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const before = await spines.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().left),
  );

  await page
    .getByTestId("filter-label-chip")
    .filter({ hasText: "Gothic" })
    .click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "2 of 3 books match",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(1);
  await expect(spines.nth(2)).toHaveAttribute("data-dimmed", "true");
  await expect(spines.nth(0)).not.toHaveAttribute("data-dimmed", "true");

  await page.getByTestId("filter-status-reading").click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "1 of 3 books match",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(2);

  // Clear is pinned outside the scrolling chip row and stays on screen.
  const clear = page.getByTestId("filter-clear");
  await expect(clear).toBeVisible();
  expect(
    await clear.evaluate((element) => element.closest(".fb-scroll") === null),
  ).toBe(true);
  const clearBox = await clear.boundingBox();
  expect(clearBox).not.toBeNull();
  if (clearBox) {
    expect(clearBox.x).toBeGreaterThanOrEqual(0);
    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(390);
  }

  const after = await spines.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().left),
  );
  expect(after).toEqual(before);

  await page.getByTestId("filter-clear").click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "3 books on the wall",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(0);
});

test("deleting a label removes its bands but leaves every book", async ({
  page,
}) => {
  const gothic = mockLabel(1, "Gothic", OXBLOOD);
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    labels: [gothic],
    books: [
      mockBook(1, "Raven Hall", 0, "unread", [gothic]),
      mockBook(2, "The Old Curiosity", 1, "unread", [gothic]),
    ],
  });

  await expect(page.getByTestId("spine-label-band")).toHaveCount(2);
  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await manager.getByRole("button", { name: "Delete Gothic" }).click();
  await expect(manager.getByTestId("manage-empty")).toBeVisible();
  await manager.getByRole("button", { name: "Close label manager" }).click();

  await expect(page.getByTestId("spine")).toHaveCount(2);
  await expect(page.getByTestId("spine-label-band")).toHaveCount(0);
  await expect(page.getByTestId("filter-strip")).toContainText("No labels yet");
});

test("the detail cover shows a paper percentage sticker and a gold sticker, with status in overflow actions", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    readingProgress: { 2: 0.37 },
    books: [
      mockBook(1, "Unopened", 0, "unread"),
      mockBook(2, "In Progress", 1, "reading"),
      mockBook(3, "Completed", 2, "finished"),
    ],
  });

  await page.getByTestId("spine").nth(1).click();
  const readingSticker = page.getByTestId("detail-sticker");
  await expect(readingSticker).toBeVisible();
  await expect(readingSticker).toHaveAttribute("data-sticker", "paper");
  await expect(readingSticker).toHaveText("37%");
  await page.getByTestId("detail-back").click();

  await page.getByTestId("spine").nth(2).click();
  await expect(page.getByTestId("detail-sticker")).toHaveAttribute(
    "data-sticker",
    "gold",
  );
  await page.getByTestId("detail-back").click();

  await page.getByTestId("spine").nth(0).click();
  await expect(page.getByTestId("detail-title")).toBeVisible();
  await expect(page.getByTestId("detail-sticker")).toHaveCount(0);
  await expect(page.getByTestId("detail-status")).toContainText("Unread");
  const detail = page.getByTestId("book-detail");
  await expect(detail.getByTestId("detail-edit")).toBeVisible();

  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-section-status")).toBeVisible();
  await page.getByTestId("edit-status-finished").click();
  await expect(page.getByTestId("edit-status-finished")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("edit-book-close").click();
  await expect(page.getByTestId("detail-status")).toContainText("Finished");
  await expect(page.getByTestId("detail-sticker")).toHaveAttribute(
    "data-sticker",
    "gold",
  );
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("spine").nth(0)).toHaveAttribute(
    "data-status",
    "finished",
  );
  await expect(
    page.getByTestId("spine").nth(0).getByTestId("spine-seal"),
  ).toBeVisible();
});

test("the read view keeps the finished seal visible and offers no cover hit layer at narrow widths", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "Completed", 0, "finished")],
  });

  for (const width of [390, 320]) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion });

      await page.getByTestId("spine").first().click();
      const detail = page.getByTestId("book-detail");
      await expect(detail).toBeVisible();
      // Let the detail frame settle so the back button is a stable target.
      await page.locator(".detail .v4d-frame").evaluate((element) =>
        Promise.all(
          element.getAnimations().map((animation) => animation.finished.catch(() => {})),
        ),
      );

      const sticker = page.getByTestId("detail-sticker");
      await expect(sticker).toHaveAttribute("data-sticker", "gold");
      await expect(sticker).toBeVisible();
      // The read view is not editable: the cover is not a change-cover hit.
      await expect(page.getByTestId("detail-cover-button")).toHaveCount(0);

      const geometry = await page.evaluate(() => {
        const seal = document.querySelector<HTMLElement>(
          '[data-testid="detail-sticker"]',
        );
        if (!seal) throw new Error("finished seal missing");
        const sealStyle = getComputedStyle(seal);
        const sealBox = seal.getBoundingClientRect();
        return {
          sealPointerEvents: sealStyle.pointerEvents,
          sealInViewport:
            sealBox.top >= 0 &&
            sealBox.left >= 0 &&
            sealBox.right <= window.innerWidth &&
            sealBox.bottom <= window.innerHeight,
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
        };
      });

      const label = `${width}px ${reducedMotion}`;
      expect(geometry.sealInViewport, `${label}: seal fully on screen`).toBe(
        true,
      );
      expect(
        geometry.sealPointerEvents,
        `${label}: seal passes taps through`,
      ).toBe("none");
      expect(geometry.document, `${label}: no horizontal overflow`).toBeLessThanOrEqual(
        geometry.viewport,
      );

      await page.getByTestId("detail-back").click();
      await expect(detail).toHaveCount(0);
    }
  }
});

test("manage labels can rename and recolour without a free colour picker", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "Raven Hall", 0)],
  });

  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await manager.getByTestId("label-name").fill("Gothic");
  await manager.getByTestId("create-label").click();

  const row = manager.getByTestId("label-row").filter({ hasText: "Gothic" });
  await row.getByRole("button", { name: "Gothic", exact: true }).click();
  const rename = manager.getByTestId("rename-label");
  await expect(rename).toBeVisible();
  await rename.fill("Weird Tales");
  await manager.getByRole("button", { name: "Save" }).click();

  const renamed = manager.getByTestId("label-row").filter({
    hasText: "Weird Tales",
  });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Forest" }).click();
  await expect(
    renamed.getByRole("button", { name: "Forest" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    manager.getByRole("button", { name: "Teal" }).first(),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "Indigo" }),
  ).toHaveCount(0);
});

test("filtering only touches data attributes; the wall and spines do not re-render", async ({
  page,
}) => {
  const gothic = mockLabel(1, "Gothic", OXBLOOD);
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    labels: [gothic],
    books: [
      mockBook(1, "Raven Hall", 0, "unread", [gothic]),
      mockBook(2, "The Old Curiosity", 1, "unread"),
      mockBook(3, "Snow Country", 2, "unread", [gothic]),
      mockBook(4, "A Winter Tale", 3, "unread"),
    ],
  });

  const spines = page.getByTestId("spine");
  await expect(spines).toHaveCount(4);
  const before = await spines.evaluateAll((elements) =>
    elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      top: element.getBoundingClientRect().top,
    })),
  );

  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>(
      '[data-testid="spine"][data-book-id="2"]',
    );
    const wall = document.querySelector<HTMLElement>(
      '[data-testid="library-wall"]',
    );
    const state = {
      mutations: 0,
      target: target,
      wall: wall,
      observer: null as MutationObserver | null,
    };
    state.observer = new MutationObserver((records) => {
      state.mutations += records.filter(
        (record) =>
          record.type === "childList" || record.type === "characterData",
      ).length;
    });
    if (target) {
      state.observer.observe(target, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    (
      window as unknown as { __filterProbe: typeof state }
    ).__filterProbe = state;
  });

  await page
    .getByTestId("filter-label-chip")
    .filter({ hasText: "Gothic" })
    .click();
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(2);

  const probe = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __filterProbe: {
          mutations: number;
          target: HTMLElement | null;
          wall: HTMLElement | null;
          observer: MutationObserver;
        };
      }
    ).__filterProbe;
    state.observer.disconnect();
    return {
      mutations: state.mutations,
      sameTarget:
        state.target ===
        document.querySelector('[data-testid="spine"][data-book-id="2"]'),
      sameWall:
        state.wall === document.querySelector('[data-testid="library-wall"]'),
    };
  });
  expect(probe).toEqual({
    mutations: 0,
    sameTarget: true,
    sameWall: true,
  });

  const after = await spines.evaluateAll((elements) =>
    elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      top: element.getBoundingClientRect().top,
    })),
  );
  expect(after).toEqual(before);
});
