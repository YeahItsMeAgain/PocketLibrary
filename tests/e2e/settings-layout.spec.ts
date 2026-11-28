import { expect, test, type Page } from "@playwright/test";

import type {
  Book,
  MockSpineConfig,
  SpineArtifact,
} from "../../src/platform";

const WIDTHS = [320, 390] as const;

/** Long enough to overflow a 340px card if the table is allowed to size it. */
const LONG_TITLE =
  "The Extraordinarily Long and Unabridged Chronicle of the Lighthouse Keeper's Daughter, Volume the Twenty-Seventh";
const LONG_ERROR =
  "spine_failed: the artifact check failed because the expected 52x236 strip was absent from the cache at /data/user/0/app/files/spine/cache/27/final.crop_box_work.jpg after text removal; rerun the queue when the model bundle is present";

function book(id: number): Book {
  return {
    id,
    contentHash: `settings-layout-${id}`,
    format: "epub",
    title: id === 1 ? LONG_TITLE : `Shelf Volume ${id} with a moderately long title`,
    authors: ["A Very Long Author Name Indeed"],
    series: null,
    language: "English",
    description: "A volume awaiting its spine.",
    publisher: null,
    publishedDate: "1899",
    identifier: null,
    pageCount: 320,
    addedAt: 1,
    shelfId: 1,
    slotIndex: id - 1,
    readingStatus: "unread",
    labels: [],
  };
}

function artifact(
  bookId: number,
  verdict: SpineArtifact["verdict"] = "pass",
): SpineArtifact {
  return {
    bookId,
    route: verdict === "fallback" ? "fallback" : "crop",
    verdict,
    maskPercent: 0,
    pagesApproximate: false,
    cropBox: { x: 20, y: 20, width: 260, height: 410 },
    artDataUrl: "",
    spineDataUrl: "",
    fallbackDataUrl: "",
    runJson: {},
    qaJson: {},
  };
}

function queuedIds(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_QUEUED__?: number[];
        }
      ).__POCKETLIBRARY_SPINE_QUEUED__ ?? [],
  );
}

async function bootSettings(
  page: Page,
  options: {
    width: number;
    height: number;
    books: Book[];
    spine?: MockSpineConfig;
  },
) {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.addInitScript(
    ({ books, spine }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
        spine,
      };
    },
    { books: options.books, spine: options.spine ?? {} },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

async function expectCenteredWithoutOverflow(page: Page) {
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const card = document.querySelector(".settings-card");
    const rect = card?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      documentScrollWidth: root.scrollWidth,
      documentClientWidth: root.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      cardLeft: rect?.left ?? Number.NaN,
      cardRight: rect?.right ?? Number.NaN,
      cardCenter: rect ? rect.left + rect.width / 2 : Number.NaN,
      viewportCenter: window.innerWidth / 2,
    };
  });

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(
    layout.documentClientWidth,
  );
  // `html`/`body` hide horizontal overflow, which would let the document
  // measurement pass while the card is still clipped. Check the body too.
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth);
  expect(layout.cardLeft).toBeGreaterThanOrEqual(0);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.innerWidth);
  expect(Math.abs(layout.cardCenter - layout.viewportCenter)).toBeLessThanOrEqual(
    2,
  );
}

test("Settings stays centred with long spine titles and errors at 320 and 390", async ({
  page,
}) => {
  await bootSettings(page, {
    width: 390,
    height: 844,
    books: [1, 2, 3, 4, 5].map(book),
    spine: {
      failIds: [1, 2, 3, 4, 5],
      queueStepMs: 5,
      error: { code: "spine_failed", message: LONG_ERROR },
      status: { error: LONG_ERROR },
    },
  });

  const table = page.getByTestId("spine-status-table");
  await expect(table).toContainText(LONG_TITLE);
  await expect(table).toContainText("spine_failed", { timeout: 10_000 });
  await expect(page.getByTestId("settings-spine-error")).toContainText(
    LONG_ERROR,
  );

  for (const width of WIDTHS) {
    await page.setViewportSize({
      width,
      height: width === 320 ? 568 : 844,
    });
    await expectCenteredWithoutOverflow(page);
  }
});

test("Settings stays centred in the Spine panel's empty state at 320", async ({
  page,
}) => {
  await bootSettings(page, {
    width: 320,
    height: 568,
    books: [],
  });

  await expect(page.getByTestId("spine-status-table")).toContainText(
    "No books reported.",
  );
  await expectCenteredWithoutOverflow(page);
});

test("Spine panel lists only the fallback book and keeps the full table collapsed", async ({
  page,
}) => {
  await bootSettings(page, {
    width: 390,
    height: 844,
    books: [book(1), book(2)],
    spine: {
      backfillPending: false,
      queueStepMs: 5,
      verdict: "fallback",
      artifacts: { 1: artifact(1), 2: artifact(2, "fallback") },
    },
  });

  const item = page.getByTestId("spine-attention-item");
  await expect(item).toHaveCount(1, { timeout: 10_000 });
  await expect(item).toContainText("Shelf Volume 2");
  await expect(item).toContainText("quality check rejected this spine");
  await expect(item.getByTestId("spine-attention-retry")).toBeVisible();

  // Only the fallback book is surfaced; the healthy book is not repeated here.
  await expect(item).toHaveCount(1);

  const table = page.getByTestId("spine-status-table");
  await expect(table).toBeHidden();
  await page.getByTestId("settings-spine-books-toggle").click();
  await expect(table).toBeVisible();
  await expect(page.getByTestId("spine-status-row")).toHaveCount(2);
  const fallback = page
    .getByTestId("spine-status-row")
    .filter({ hasText: "Shelf Volume 2" });
  await expect(fallback).toContainText("Present");
  await expect(fallback).toContainText("quality gate returned fallback");
  await expect(fallback).toContainText("fallback");
  const painted = page
    .getByTestId("spine-status-row")
    .filter({ hasText: LONG_TITLE });
  await expect(painted).toContainText("Paints art");
  await expect(painted).toContainText("pass");

  // The explanation and engine facts stay one tap away.
  const bundle = page.getByTestId("settings-spine-bundle");
  await expect(bundle).toBeHidden();
  await page.getByTestId("settings-spine-help-toggle").click();
  await expect(bundle).toBeVisible();
  await expect(bundle).toHaveText("spine-v1");

  for (const width of WIDTHS) {
    await page.setViewportSize({
      width,
      height: width === 320 ? 568 : 844,
    });
    await expectCenteredWithoutOverflow(page);
  }
});

test("Spine Retry enqueues the book and Copy logs still works", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
        },
      },
    });
  });
  await bootSettings(page, {
    width: 390,
    height: 844,
    books: [book(1), book(2)],
    spine: {
      backfillPending: false,
      queueStepMs: 5,
      failIds: [1],
      error: {
        code: "spine_failed",
        message: "The spine could not be generated for this book.",
      },
      artifacts: { 2: artifact(2) },
    },
  });

  const item = page.getByTestId("spine-attention-item");
  await expect(item).toContainText(LONG_TITLE, { timeout: 10_000 });
  const before = (await queuedIds(page)).filter((id) => id === 1).length;
  await item.getByTestId("spine-attention-retry").click();
  await expect
    .poll(async () => (await queuedIds(page)).filter((id) => id === 1).length)
    .toBeGreaterThan(before);

  await page.getByTestId("settings-copy-logs").click();
  await expect(page.getByTestId("copy-logs-notice")).toContainText(
    "Copied to clipboard",
  );
  const copied = await page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied,
  );
  expect(copied).toContain("PocketLibrary v0.1.18");
  expect(copied).toContain("===== spine.log =====");
});
