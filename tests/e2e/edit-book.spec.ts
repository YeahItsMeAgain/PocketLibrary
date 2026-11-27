import { expect, test, type Page } from "@playwright/test";

import type { Book, CoverOption, Label, MockSpineConfig } from "../../src/platform";

const ALT_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#294735"/></svg>',
  );

function mockBook(id: number, overrides: Partial<Book> = {}): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title: "The Dispossessed",
    authors: ["Ursula K. Le Guin"],
    series: null,
    language: "en",
    description:
      "A quiet revolution gathers behind the palace doors, and one reader must choose a side.",
    publisher: "Harper & Row",
    publishedDate: "1974-05-01",
    identifier: "9780000000000",
    pageCount: 320,
    addedAt: 1_700_000_000 + id,
    shelfId: 1,
    slotIndex: id - 1,
    readingStatus: "unread",
    labels: [],
    ...overrides,
  };
}

interface BootOptions {
  books?: Book[];
  labels?: Label[];
  spine?: MockSpineConfig;
  fileCoverIds?: number[];
  coverCandidates?: Record<number, CoverOption[]>;
}

async function boot(page: Page, options: BootOptions = {}) {
  const books = options.books ?? [mockBook(1)];
  await page.addInitScript(
    ({ books: nextBooks, labels, spine, fileCoverIds, coverCandidates }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: nextBooks,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        labels,
        spine: { queueStartPaused: true, ...spine },
        enrichment: { fileCoverIds, coverCandidates },
      };
    },
    {
      books,
      labels: options.labels,
      spine: options.spine,
      fileCoverIds: options.fileCoverIds,
      coverCandidates: options.coverCandidates,
    },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

async function openDetail(page: Page) {
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function openEdit(page: Page) {
  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-book")).toBeVisible();
}

test("the read view offers no editable control", async ({ page }) => {
  const gothic: Label = {
    id: 1,
    name: "Gothic",
    colour: "#6e2630",
    createdAt: 1_700_000_000,
  };
  await boot(page, {
    books: [mockBook(1, { labels: [gothic] })],
    labels: [gothic],
  });
  await openDetail(page);

  const detail = page.getByTestId("book-detail");
  await expect(detail.getByTestId("detail-edit")).toBeVisible();
  await expect(detail.getByTestId("detail-title")).toBeVisible();
  await expect(detail.getByTestId("detail-blurb")).toBeVisible();
  await expect(detail.getByTestId("detail-label-chip")).toHaveText("Gothic");
  await expect(detail.getByTestId("detail-status")).toContainText("Unread");

  // Everything editable lives in the other layer.
  await expect(page.getByTestId("edit-book")).toHaveCount(0);
  await expect(page.getByTestId("blurb-editor")).toHaveCount(0);
  await expect(page.getByTestId("blurb-text")).toHaveCount(0);
  await expect(page.getByTestId("detail-cover-button")).toHaveCount(0);
  await expect(page.getByTestId("detail-actions")).toHaveCount(0);
  await expect(page.getByTestId("detail-delete")).toHaveCount(0);
  await expect(page.getByTestId("detail-add-label")).toHaveCount(0);
  await expect(page.getByTestId("spine-generate")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-grid")).toHaveCount(0);
});

test("Edit exposes the sections in order", async ({ page }) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);

  const sections = page.locator('[data-testid^="edit-section-"]');
  await expect(sections).toHaveCount(6);
  const titles = await page
    .locator('[data-testid^="edit-section-"] > h3')
    .allTextContents();
  expect(titles).toEqual([
    "Details",
    "Cover",
    "Spine",
    "Status & labels",
    "Online details",
    "Danger",
  ]);
  await expect(page.getByTestId("edit-change-cover")).toBeVisible();
  await expect(page.getByTestId("edit-status-unread")).toBeVisible();
  await expect(page.getByTestId("edit-lookup")).toBeVisible();
  await expect(page.getByTestId("detail-delete")).toBeVisible();
});

test("title, authors, pages and blurb autosave with a Saved tick", async ({
  page,
}) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);

  await page.getByTestId("edit-title").fill("The Dispossessed (revised)");
  await page.getByTestId("edit-title").blur();
  await expect(page.getByTestId("edit-title-status")).toContainText("Saved");

  await page.getByTestId("edit-authors").fill("Ursula K. Le Guin, Ada Lovelace");
  await page.getByTestId("edit-authors").blur();
  await expect(page.getByTestId("edit-authors-status")).toContainText("Saved");

  await page.getByTestId("edit-pages").fill("352");
  await page.getByTestId("edit-pages").blur();
  await expect(page.getByTestId("edit-pages-status")).toContainText("Saved");

  await page.getByTestId("edit-blurb").fill("A blurb rewritten in the edit layer.");
  await page.getByTestId("edit-blurb").blur();
  await expect(page.getByTestId("edit-blurb-status")).toContainText("Saved");

  await page.getByTestId("edit-book-close").click();
  await expect(page.getByTestId("detail-title")).toHaveText(
    "The Dispossessed (revised)",
  );
  await expect(page.getByTestId("detail-author")).toContainText(
    "Ursula K. Le Guin",
  );
  await expect(page.getByTestId("detail-author")).toContainText("Ada Lovelace");
  await expect(page.getByTestId("detail-blurb")).toHaveText(
    "A blurb rewritten in the edit layer.",
  );
});

test("blurb autosaves after the debounce without leaving the field", async ({
  page,
}) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);

  await page.getByTestId("edit-blurb").fill("Saved by the debounce alone.");
  await expect(page.getByTestId("edit-blurb-status")).toContainText("Saved");
  await page.getByTestId("edit-book-close").click();
  await expect(page.getByTestId("detail-blurb")).toHaveText(
    "Saved by the debounce alone.",
  );
});

test("undo restores the previous spine style", async ({ page }) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);
  await page.getByTestId("spine-generate").click();
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-verdict"),
  ).toBeVisible();
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("spine-style-cloth").click();
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("edit-undo-toast")).toContainText(
    "Spine style set to Cloth",
  );
  await page.getByTestId("edit-undo").click();
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("edit-undo-toast")).toHaveText("");
});

test("undo restores the previous cover", async ({ page }) => {
  const candidate: CoverOption = {
    key: "online:open_library:id:123",
    source: "open_library",
    label: "The Dispossessed",
    detail: "Ursula K. Le Guin · 1974 · Harper & Row",
    previewDataUrl: ALT_COVER,
    isCurrent: false,
    isOriginal: false,
    providerCoverKey: "id:123",
    sourceUrl: "https://openlibrary.org/books/OL1M",
  };
  await boot(page, {
    fileCoverIds: [1],
    coverCandidates: { 1: [candidate] },
  });
  await openDetail(page);
  const original = await page.getByTestId("detail-cover").getAttribute("src");
  await openEdit(page);

  await page.getByTestId("edit-change-cover").click();
  await page.getByTestId("cover-find").click();
  await page
    .getByTestId("cover-option-online-open-library-id-123")
    .click();
  await page.getByTestId("cover-use").click();
  await expect(page.getByTestId("cover-chooser")).toHaveCount(0);
  await expect(page.getByTestId("detail-cover")).not.toHaveAttribute(
    "src",
    original ?? "",
  );

  await expect(page.getByTestId("edit-undo-toast")).toContainText(
    "Cover changed.",
  );
  await page.getByTestId("edit-undo").click();
  await expect(page.getByTestId("detail-cover")).toHaveAttribute(
    "src",
    original ?? "",
  );
});

test("labels and reading status are edited in Edit and shown read-only", async ({
  page,
}) => {
  const gothic: Label = {
    id: 1,
    name: "Gothic",
    colour: "#6e2630",
    createdAt: 1_700_000_000,
  };
  await boot(page, {
    books: [mockBook(1)],
    labels: [gothic],
  });
  await openDetail(page);
  await openEdit(page);

  await page.getByTestId("edit-add-label").click();
  await page.getByTestId("edit-label-option-1").click();
  await expect(
    page.getByTestId("edit-label-chip").filter({ hasText: "Gothic" }),
  ).toBeVisible();

  await page.getByTestId("edit-status-finished").click();
  await expect(page.getByTestId("edit-status-finished")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("edit-book-close").click();
  await expect(
    page.getByTestId("detail-label-chip").filter({ hasText: "Gothic" }),
  ).toBeVisible();
  await expect(page.getByTestId("detail-status")).toContainText("Finished");
  await expect(page.getByTestId("detail-sticker")).toHaveAttribute(
    "data-sticker",
    "gold",
  );
});

test("delete exists only inside Edit", async ({ page }) => {
  await boot(page);
  await openDetail(page);
  await expect(page.getByTestId("detail-delete")).toHaveCount(0);
  await openEdit(page);
  await expect(page.getByTestId("detail-delete")).toBeVisible();
  await page.getByTestId("detail-delete").click();
  await expect(page.getByTestId("detail-delete-confirm")).toContainText(
    "Delete “The Dispossessed”",
  );
  await page.getByTestId("detail-delete-cancel").click();
  await expect(page.getByTestId("detail-delete-confirm")).toHaveCount(0);
});

test("Edit opens at the top of the layer", async ({ page }) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);

  const layer = page.getByTestId("edit-book");
  await expect.poll(() => layer.evaluate((element) => element.scrollTop)).toBe(0);

  // Closing from a scrolled position and reopening starts at the top again.
  await layer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => layer.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.getByTestId("edit-book-close").click();
  await expect(layer).toHaveCount(0);

  await openEdit(page);
  await expect.poll(() => layer.evaluate((element) => element.scrollTop)).toBe(0);
});

test("Escape closes only the Edit layer", async ({ page }) => {
  await boot(page);
  await openDetail(page);
  await openEdit(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("edit-book")).toHaveCount(0);
  await expect(page.getByTestId("book-detail")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
});

for (const width of [390, 320]) {
  test(`switching spine styles never moves the page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openDetail(page);
    await openEdit(page);
    await page.getByTestId("spine-generate").click();
    await expect(
      page.getByTestId("edit-book").getByTestId("spine-verdict"),
    ).toBeVisible();
    await expect(
      page.getByTestId("spine-style-grid").locator("canvas"),
    ).toHaveCount(3);

    // Put the whole stage and the style row in view so a click never needs to
    // scroll anything into view first.
    await page
      .getByTestId("spine-preview")
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(150);

    const read = () =>
      page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>(
          '[data-testid="edit-book"]',
        );
        const box = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        };
        return {
          windowScrollY: window.scrollY,
          layerScrollTop: layer?.scrollTop ?? -1,
          documentScrollHeight: document.documentElement.scrollHeight,
          layerScrollHeight: layer?.scrollHeight ?? -1,
          stage: box('[data-testid="spine-preview"]'),
          heading: box("#spine-studio-title"),
          grid: box('[data-testid="spine-style-grid"]'),
          studioHeight:
            document
              .querySelector<HTMLElement>('[data-testid="spine-studio"]')
              ?.getBoundingClientRect().height ?? -1,
          chipTops: Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid^="spine-style-"]',
            ),
          )
            .filter((element) => element.tagName === "BUTTON")
            .map((element) => element.getBoundingClientRect().top),
        };
      });

    const baseline = await read();
    expect(baseline.stage).not.toBeNull();
    expect(baseline.heading).not.toBeNull();
    expect(baseline.grid).not.toBeNull();
    // Wrap, Full-bleed and Cloth stay on one row.
    expect(new Set(baseline.chipTops).size).toBe(1);

    for (const style of ["full-bleed", "cloth", "wrap"]) {
      // Sample every frame: the old regression collapsed the whole studio to
      // its loading placeholder for a few frames after each choice, which a
      // settled-state assertion would miss.
      await page.evaluate(() => {
        const layer = document.querySelector<HTMLElement>(
          '[data-testid="edit-book"]',
        );
        const studio = document.querySelector<HTMLElement>(
          '[data-testid="spine-studio"]',
        );
        const store = window as unknown as {
          __spineJumpSamples?: Array<{
            scrollTop: number;
            studioHeight: number;
          }>;
          __stopSpineJumpSampling?: () => void;
        };
        const samples: Array<{ scrollTop: number; studioHeight: number }> = [];
        store.__spineJumpSamples = samples;
        let active = true;
        store.__stopSpineJumpSampling = () => {
          active = false;
        };
        const tick = () => {
          if (!active) return;
          samples.push({
            scrollTop: layer?.scrollTop ?? -1,
            studioHeight: studio?.getBoundingClientRect().height ?? -1,
          });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await page.getByTestId(`spine-style-${style}`).click();
      await expect(page.getByTestId("spine-preview")).toHaveAttribute(
        "data-style",
        style,
      );
      await page.waitForTimeout(400);
      const samples = await page.evaluate(() => {
        const store = window as unknown as {
          __spineJumpSamples?: Array<{
            scrollTop: number;
            studioHeight: number;
          }>;
          __stopSpineJumpSampling?: () => void;
        };
        store.__stopSpineJumpSampling?.();
        return store.__spineJumpSamples ?? [];
      });
      expect(samples.length).toBeGreaterThan(5);
      for (const sample of samples) {
        expect(sample.scrollTop).toBe(baseline.layerScrollTop);
        expect(
          Math.abs(sample.studioHeight - baseline.studioHeight),
        ).toBeLessThanOrEqual(1);
      }

      const next = await read();

      expect(next.windowScrollY).toBe(0);
      expect(next.layerScrollTop).toBe(baseline.layerScrollTop);
      expect(next.documentScrollHeight).toBe(baseline.documentScrollHeight);
      expect(next.layerScrollHeight).toBe(baseline.layerScrollHeight);
      expect(Math.abs(next.stage!.top - baseline.stage!.top)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(next.stage!.height - baseline.stage!.height),
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(next.heading!.top - baseline.heading!.top),
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(next.grid!.top - baseline.grid!.top)).toBeLessThanOrEqual(
        1,
      );
      expect(new Set(next.chipTops).size).toBe(1);
    }
  });
}

for (const width of [390, 320]) {
  test(`the read and edit layers do not overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openDetail(page);

    const readSizes = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(readSizes.document).toBeLessThanOrEqual(readSizes.viewport);

    await openEdit(page);
    const editSizes = await page.evaluate(() => {
      const edit = document.querySelector<HTMLElement>(
        '[data-testid="edit-book"]',
      );
      return {
        document: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        edit: edit?.scrollWidth ?? 0,
        editClient: edit?.clientWidth ?? 0,
      };
    });
    expect(editSizes.document).toBeLessThanOrEqual(editSizes.viewport);
    expect(editSizes.edit).toBeLessThanOrEqual(editSizes.editClient + 1);
  });
}
