import { expect, test, type Page } from "@playwright/test";

import type { MockSpineConfig } from "../../src/platform";

async function boot(page: Page, spine: MockSpineConfig = {}) {
  await page.addInitScript(
    ({ nextSpine }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: [
          {
            id: 1,
            contentHash: "hash-1",
            format: "epub",
            title: "Rock Paper Scissors",
            authors: ["Alice Feeney"],
            series: null,
            language: "English",
            description:
              "A quiet house, a sudden storm, and a marriage under glass.",
            publisher: "HarperCollins",
            publishedDate: "2021-08-01",
            identifier: "9780000000000",
            pageCount: 320,
            addedAt: 1_700_000_000,
            shelfId: 1,
            slotIndex: 0,
            readingStatus: "unread",
            labels: [],
          },
        ],
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine: nextSpine,
      };
    },
    { nextSpine: spine },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function generate(page: Page) {
  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  await expect(page.getByTestId("spine-style-grid").locator("canvas")).toHaveCount(
    6,
  );
}

function generateCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_GENERATE_CALLS__?: number;
        }
      ).__POCKETLIBRARY_SPINE_GENERATE_CALLS__ ?? 0,
  );
}

function statusCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_STATUS_CALLS__?: number;
        }
      ).__POCKETLIBRARY_SPINE_STATUS_CALLS__ ?? 0,
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      doc: root.scrollWidth - root.clientWidth,
      body: body.scrollWidth - body.clientWidth,
      viewport: window.innerWidth,
    };
  });
  expect(sizes.doc).toBeLessThanOrEqual(1);
  expect(sizes.body).toBeLessThanOrEqual(1);
  const section = await page.getByTestId("spine-studio").boundingBox();
  expect(section).not.toBeNull();
  expect(section!.width).toBeLessThanOrEqual(sizes.viewport);
}

test("opening a book shows the Spine section with one obvious action", async ({
  page,
}) => {
  await boot(page);
  const studio = page.getByTestId("spine-studio");
  await expect(studio).toBeVisible();
  await expect(studio).toContainText("Spine");
  await expect(page.getByTestId("spine-generate")).toBeVisible();
  await expect(page.getByTestId("spine-generate")).toBeEnabled();
  await expect(page.getByTestId("spine-generate")).toHaveText(
    "Generate spine",
  );
  await expect(page.getByTestId("spine-verdict")).toHaveCount(0);
});

test("opening a book does not resolve the engine or run status", async ({
  page,
}) => {
  await boot(page);
  await expect(page.getByTestId("spine-generate")).toBeVisible();
  // Mount may read the artifact cache, but never status/models/JNI.
  expect(await statusCalls(page)).toBe(0);
  expect(await generateCalls(page)).toBe(0);

  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  expect(await statusCalls(page)).toBeGreaterThan(0);
  expect(await generateCalls(page)).toBe(1);
});

test("generate shows honest progress, then a result with six style canvases", async ({
  page,
}) => {
  await boot(page, { generateDelayMs: 700 });
  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-generating")).toBeVisible();
  await expect(page.getByTestId("spine-generating")).toContainText(
    "Finding cover text",
  );
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  await expect(page.getByTestId("spine-verdict")).toHaveText("Pass");
  await expect(page.getByTestId("spine-meta")).toContainText("Mask 0.0%");
  await expect(page.getByTestId("spine-meta")).toContainText("Route crop");
  const grid = page.getByTestId("spine-style-grid");
  await expect(grid.locator("canvas")).toHaveCount(6);
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "wrap",
  );
  await expect(page.getByTestId("spine-strip-canvas")).toBeVisible();
});

test("switching Wrap and Cloth re-renders the preview without generating again", async ({
  page,
}) => {
  await boot(page);
  await generate(page);
  expect(await generateCalls(page)).toBe(1);

  await page.getByTestId("spine-style-cloth").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("spine-style-wrap").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "wrap",
  );
  await expect(page.getByTestId("spine-generating")).toHaveCount(0);
  expect(await generateCalls(page)).toBe(1);
});

test("reopening a book loads the saved result without generating again", async ({
  page,
}) => {
  await boot(page);
  await generate(page);
  expect(await generateCalls(page)).toBe(1);

  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  await expect(page.getByTestId("spine-style-grid").locator("canvas")).toHaveCount(
    6,
  );
  expect(await generateCalls(page)).toBe(1);
});

test("review state offers Use Cloth and applies it instantly", async ({
  page,
}) => {
  await boot(page, { verdict: "review", route: "inpaint", maskPercent: 44.1 });
  await generate(page);
  await expect(page.getByTestId("spine-verdict")).toHaveText("Review");
  await expect(page.getByTestId("spine-meta")).toContainText("Mask 44.1%");
  await expect(page.getByTestId("spine-meta")).toContainText("Route inpaint");
  await expect(page.getByTestId("spine-review-note")).toBeVisible();
  await expect(page.getByTestId("spine-use-cloth")).toBeVisible();

  await page.getByTestId("spine-use-cloth").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
  expect(await generateCalls(page)).toBe(1);
});

test("fallback state applies Cloth automatically", async ({ page }) => {
  await boot(page, { verdict: "fallback", route: "fallback" });
  await generate(page);
  await expect(page.getByTestId("spine-verdict")).toHaveText("Fallback");
  await expect(page.getByTestId("spine-fallback-note")).toContainText(
    "Cloth applied automatically",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("no horizontal overflow at 390 or 320 px", async ({ page }) => {
  await boot(page);
  await generate(page);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("spine-style-editorial").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "editorial",
  );
  await expectNoHorizontalOverflow(page);
});
