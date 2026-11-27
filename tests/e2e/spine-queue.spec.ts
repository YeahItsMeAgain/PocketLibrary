import { expect, test, type Page } from "@playwright/test";

import type {
  Book,
  MockSpineConfig,
  SpineArtifact,
} from "../../src/platform";

function book(id: number, overrides: Partial<Book> = {}): Book {
  return {
    id,
    contentHash: `spine-book-${id}`,
    format: "epub",
    title: `Shelf Volume ${id}`,
    authors: ["Victorian Author"],
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
    ...overrides,
  };
}

function svgArt(top: string, bottom: string): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450">` +
        `<rect width="300" height="225" fill="${top}"/>` +
        `<rect y="225" width="300" height="225" fill="${bottom}"/>` +
        `</svg>`,
    )
  );
}

function spineStrip(color: string): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="236">` +
        `<rect width="52" height="236" fill="${color}"/>` +
        `</svg>`,
    )
  );
}

function artifact(overrides: Partial<SpineArtifact> = {}): SpineArtifact {
  return {
    bookId: 1,
    route: "crop",
    verdict: "pass",
    maskPercent: 0,
    pagesApproximate: false,
    cropBox: { x: 20, y: 20, width: 260, height: 410 },
    artDataUrl: svgArt("#111111", "#f4f4f4"),
    spineDataUrl: spineStrip("#3b2233"),
    fallbackDataUrl: spineStrip("#333336"),
    runJson: {},
    qaJson: {},
    ...overrides,
  };
}

async function boot(
  page: Page,
  config: {
    books?: Book[];
    spine?: MockSpineConfig;
    extra?: Record<string, unknown>;
  } = {},
) {
  await page.addInitScript(
    ({ books, spine, extra }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine,
        ...extra,
      };
    },
    {
      books: config.books ?? [book(1)],
      spine: config.spine ?? {},
      extra: config.extra ?? {},
    },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
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

function pauseCalls(page: Page): Promise<boolean[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_PAUSE_CALLS__?: boolean[];
        }
      ).__POCKETLIBRARY_SPINE_PAUSE_CALLS__ ?? [],
  );
}

function queueEvents(page: Page): Promise<
  Array<{ event: "queue" | "progress"; payload: unknown }>
> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_EVENTS__?: Array<{
            event: "queue" | "progress";
            payload: unknown;
          }>;
        }
      ).__POCKETLIBRARY_SPINE_EVENTS__ ?? [],
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      doc: root.scrollWidth - root.clientWidth,
      body: body.scrollWidth - body.clientWidth,
    };
  });
  expect(sizes.doc).toBeLessThanOrEqual(1);
  expect(sizes.body).toBeLessThanOrEqual(1);
}

test("the chip reports stages and counts, then disappears when the queue is done", async ({
  page,
}) => {
  await boot(page, {
    books: [book(1), book(2)],
    spine: { queueStepMs: 350 },
  });

  const chip = page.getByTestId("spine-activity");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Preparing spines · 0 of 2");
  await expect.poll(async () => chip.getAttribute("data-stage")).toMatch(
    /art|text|check/,
  );

  await expect(chip).toContainText("Preparing spines · 1 of 2");
  await expect(chip).toHaveCount(0, { timeout: 6_000 });

  const events = await queueEvents(page);
  const progress = events
    .filter((entry) => entry.event === "progress")
    .map((entry) => entry.payload as { stage: string; index: number; total: number });
  expect(progress.some((entry) => entry.stage === "art")).toBe(true);
  expect(progress.some((entry) => entry.stage === "text")).toBe(true);
  expect(progress.some((entry) => entry.stage === "check")).toBe(true);
  expect(progress.every((entry) => entry.total === 3)).toBe(true);
});

test("Stop preparing pauses the worker and Resume lifts it", async ({ page }) => {  await boot(page, {
    books: [book(1), book(2)],
    spine: { queueStepMs: 300 },
  });

  const chip = page.getByTestId("spine-activity");
  await expect(chip).toBeVisible();
  await page.getByTestId("spine-stop").click();
  await expect(chip).toHaveAttribute("data-paused", "true");
  await expect(page.getByTestId("spine-resume")).toBeVisible();

  // Give the worker more than one stage's worth of time; nothing completes.
  await page.waitForTimeout(900);
  await expect(chip).toContainText("0 of 2");
  expect(await pauseCalls(page)).toContain(true);

  await page.getByTestId("spine-resume").click();
  await expect(chip).toHaveAttribute("data-paused", "false");
  await expect(chip).toHaveCount(0, { timeout: 8_000 });
});

test("a manual Stop survives closing the reader", async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, { spine: { queueStepMs: 2_500 } });

  const chip = page.getByTestId("spine-activity");
  await expect(chip).toBeVisible();
  await page.getByTestId("spine-stop").click();
  await expect(chip).toHaveAttribute("data-paused", "true");

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
  if (!(await page.getByTestId("reader-back").isVisible())) {
    await page.mouse.click(195, 420);
  }
  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);

  // The reader may pause and resume internally, but the last explicit state
  // must stay paused because the user asked for it.
  await expect(chip).toHaveAttribute("data-paused", "true");
  expect(await pauseCalls(page)).not.toContain(false);
});

test("opening the reader pauses preparation and closing resumes it", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await boot(page, { spine: { queueStepMs: 2_500 } });

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 20_000,
  });
  if (!(await page.getByTestId("reader-back").isVisible())) {
    await page.mouse.click(195, 420);
  }
  await expect(page.getByTestId("reader-back")).toBeVisible({
    timeout: 20_000,
  });

  // The chip hides while the reader is open.
  await expect(page.getByTestId("spine-activity")).toHaveCount(0);
  expect(await pauseCalls(page)).toContain(true);

  await page.getByTestId("reader-back").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect.poll(async () => (await pauseCalls(page)).at(-1)).toBe(false);
});

test("a completed download is queued for preparation", async ({ page }) => {
  await boot(page, { books: [] });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  await expect(page.getByTestId("search-view")).toBeVisible();
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  await expect(page.getByTestId("result-download-state")).toContainText(
    "Added to library",
    { timeout: 10_000 },
  );
  await expect
    .poll(async () => queuedIds(page), { timeout: 5_000 })
    .toContain(1);
});

test("a cover change queues the book again", async ({ page }) => {
  await boot(page, { spine: { queueStartPaused: true } });

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await page.getByTestId("detail-cover-button").click();
  await expect(page.getByTestId("cover-chooser")).toBeVisible();
  await page.getByTestId("cover-device").click();
  await expect(page.getByTestId("cover-use")).toBeEnabled();
  await page.getByTestId("cover-use").click();
  await expect(page.getByTestId("cover-chooser")).toHaveCount(0);

  // The backfill queued [1]; the cover change must add another [1].
  await expect
    .poll(async () => (await queuedIds(page)).filter((id) => id === 1).length)
    .toBeGreaterThanOrEqual(2);
});

test("full-bleed centres the type block and forces a scrim on mixed art", async ({
  page,
}) => {
  await boot(page, {
    books: [book(1, { title: "The War of the Worlds", authors: ["H. G. Wells"] })],
    spine: { artifacts: { 1: artifact() } },
  });

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("spine-result")).toBeVisible();
  await page.getByTestId("spine-style-full-bleed").click();
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-style", "full-bleed");
  await expect(canvas).toHaveAttribute("data-scrim", "true");

  const meta = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      cx: Number(canvas.dataset.blockCx),
      cy: Number(canvas.dataset.blockCy),
      contrast: Number(canvas.dataset.contrast),
      width: canvas.width,
      height: canvas.height,
    };
  });
  expect(meta.cx).toBeCloseTo(26, 0);
  expect(meta.cy).toBeCloseTo(118, 0);
  expect(meta.contrast).toBeGreaterThanOrEqual(4.5);

  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(canvas).toHaveAttribute("data-scrim", "true");
  await expect(canvas).toHaveAttribute("data-style", "full-bleed");
});

test("choosing a style persists it through spineSetStyle", async ({ page }) => {
  await boot(page, {
    spine: { artifacts: { 1: artifact() } },
  });
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("spine-result")).toBeVisible();
  await page.getByTestId("spine-style-full-bleed").click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __POCKETLIBRARY_SPINE_STYLES__?: Record<number, string>;
            }
          ).__POCKETLIBRARY_SPINE_STYLES__?.[1],
      ),
    )
    .toBe("full-bleed");
});

test("a Hebrew title sets canvas direction without mirroring the glyphs", async ({
  page,
}) => {
  await boot(page, {
    books: [
      book(1, {
        title: "המלחמה של העולמות",
        authors: ["ה. ג. ולס"],
        language: "Hebrew",
      }),
    ],
    spine: { artifacts: { 1: artifact() } },
  });

  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("spine-result")).toBeVisible();
  await page.getByTestId("spine-style-full-bleed").click();
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-direction", "rtl");
  await expect(canvas).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("detail-title")).toHaveText(
    "המלחמה של העולמות",
  );
  const transform = await canvas.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(transform).toBe("none");
});

test("the shelf swaps to the generated spine when ready", async ({ page }) => {
  await boot(page, { spine: { queueStepMs: 25 } });

  const spine = page.getByTestId("spine").first();
  await expect(spine.getByTestId("spine-generated")).toBeVisible({
    timeout: 8_000,
  });
  await expect(spine).toHaveAttribute("data-spine-state", "ready");
});

test("a fallback verdict leaves the shelf on its cloth spine", async ({
  page,
}) => {
  await boot(page, {
    spine: {
      queueStepMs: 25,
      artifacts: {
        1: artifact({ verdict: "fallback", route: "fallback" }),
      },
    },
  });

  const spine = page.getByTestId("spine").first();
  await expect(spine).toHaveAttribute("data-spine-state", "ready", {
    timeout: 8_000,
  });
  await expect(spine.getByTestId("spine-generated")).toHaveCount(0);
  await expect(spine).not.toHaveClass(/has-generated/);
});

test("the shelf shows the generated strip only for Wrap and Full-bleed", async ({
  page,
}) => {
  await boot(page, {
    books: [
      book(1, { spineStyle: "wrap" }),
      book(2, { spineStyle: "full-bleed" }),
      book(3, { spineStyle: "cloth" }),
    ],
    spine: {
      queueStepMs: 25,
      artifacts: {
        1: artifact({ bookId: 1 }),
        2: artifact({ bookId: 2 }),
        3: artifact({ bookId: 3 }),
      },
    },
  });

  const wrap = page.locator('[data-testid="spine"][data-book-id="1"]');
  const fullBleed = page.locator('[data-testid="spine"][data-book-id="2"]');
  const cloth = page.locator('[data-testid="spine"][data-book-id="3"]');

  await expect(wrap.getByTestId("spine-generated")).toBeVisible({
    timeout: 8_000,
  });
  await expect(fullBleed.getByTestId("spine-generated")).toBeVisible();
  await expect(cloth.getByTestId("spine-generated")).toHaveCount(0);
  await expect(cloth).not.toHaveClass(/has-generated/);
  await expect(cloth.locator(".spine-text")).toBeVisible();
});

test("a failed job shows a marker until a manual generation succeeds", async ({
  page,
}) => {
  await boot(page, { spine: { queueStepMs: 25, failIds: [1] } });

  const spine = page.getByTestId("spine").first();
  await expect(spine.getByTestId("spine-failed-marker")).toBeVisible({
    timeout: 8_000,
  });

  await spine.click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await expect(page.getByTestId("spine-book-state")).toHaveAttribute(
    "data-state",
    "needs-attention",
  );
  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  await page.getByTestId("detail-back").click();

  await expect(
    page.getByTestId("spine").first().getByTestId("spine-failed-marker"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("spine").first().getByTestId("spine-generated"),
  ).toBeVisible();
});
