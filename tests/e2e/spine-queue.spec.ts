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

/** A light/dark split that survives the 52:236 cover crop, so both bands are
 * mixed luminance and no single ink clears 4.5:1 without a scrim. */
function mixedArt(): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450">` +
        `<rect width="150" height="450" fill="#f4f4f4"/>` +
        `<rect x="150" width="150" height="450" fill="#111111"/>` +
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

async function openEdit(page: Page) {
  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-book")).toBeVisible();
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

function cachedStripCalls(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_CACHED_STRIP_CALLS__?: number;
        }
      ).__POCKETLIBRARY_SPINE_CACHED_STRIP_CALLS__ ?? 0,
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
  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-book")).toBeVisible();
  await page.getByTestId("edit-change-cover").click();
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

test("Wrap and Full-bleed fill the spine run with the title and put the author below", async ({
  page,
}) => {
  await boot(page, {
    books: [book(1, { title: "The War of the Worlds", authors: ["H. G. Wells"] })],
    spine: { artifacts: { 1: artifact({ artDataUrl: mixedArt() }) } },
  });

  await page.getByTestId("spine").first().click();
  await openEdit(page);
  const edit = page.getByTestId("edit-book");
  await expect(edit.getByTestId("spine-result")).toBeVisible();
  const canvas = page.getByTestId("spine-preview-canvas");

  const readMeta = () =>
    canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const data = canvas.dataset;
      return {
        run: data.textRun,
        cx: Number(data.blockCx),
        titleCy: Number(data.titleCy),
        titleWidth: Number(data.titleWidth),
        titleHeight: Number(data.titleHeight),
        titleLines: Number(data.titleLines),
        authorCy: Number(data.authorCy),
        authorHeight: Number(data.authorHeight),
        authorLines: Number(data.authorLines),
        colophonY: Number(data.colophonY),
        contrast: Number(data.contrast),
      };
    });

  for (const style of ["full-bleed", "wrap"]) {
    await page.getByTestId(`spine-style-${style}`).click();
    await expect(canvas).toHaveAttribute("data-style", style);
    const meta = await readMeta();
    expect(meta.run).toBe("vertical");
    // Full-bleed type centres on the 20 px rail; the 320-page Wrap spine is
    // 18 px wide, so its type centres at 9.
    expect(meta.cx).toBeCloseTo(style === "full-bleed" ? 40 : 9, 0);
    // The title now occupies the majority of the 236 px run, not a third.
    expect(meta.titleHeight).toBeGreaterThan(236 / 2);
    expect(meta.titleHeight).toBeGreaterThan(meta.authorHeight * 2);
    expect(meta.titleCy - meta.titleHeight / 2).toBeGreaterThan(0);
    // The author sits below the title, above the base mark.
    expect(meta.titleCy + meta.titleHeight / 2).toBeLessThan(
      meta.authorCy - meta.authorHeight / 2,
    );
    expect(meta.authorCy).toBeGreaterThan(meta.titleCy);
    expect(meta.authorCy + meta.authorHeight / 2).toBeLessThan(
      meta.colophonY,
    );
    // The run is taller than it is wide, so it reads down the spine.
    expect(meta.titleHeight).toBeGreaterThan(meta.titleWidth);
    expect(meta.titleLines).toBeLessThanOrEqual(2);
    expect(meta.authorLines).toBe(1);
    expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
  }

  await expect(canvas).toHaveAttribute("data-scrim", "true");
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(canvas).toHaveAttribute("data-scrim", "true");
  await expect(canvas).toHaveAttribute("data-style", "wrap");
});

test("a long title settles into at most two lines inside the title band", async ({
  page,
}) => {
  await boot(page, {
    books: [
      book(1, {
        title: "The Curious Incident of the Dog in the Night-Time",
        authors: ["Mark Haddon"],
      }),
    ],
    spine: { artifacts: { 1: artifact() } },
  });

  await page.getByTestId("spine").first().click();
  await openEdit(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-result"),
  ).toBeVisible();
  await page.getByTestId("spine-style-full-bleed").click();
  const meta = await page
    .getByTestId("spine-preview-canvas")
    .evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset;
      return {
        lines: Number(data.titleLines),
        fs: Number(data.titleFontSize),
        width: Number(data.titleWidth),
        height: Number(data.titleHeight),
      };
    });
  expect(meta.lines).toBeLessThanOrEqual(2);
  expect(meta.fs).toBeGreaterThan(1);
  // The run is the whole span above the author, not a 62 px third.
  expect(meta.height).toBeLessThanOrEqual(236 - 54 - 8);
  expect(meta.height).toBeGreaterThan(90);
  expect(meta.width).toBeLessThan(52 - 8);
});

test("choosing a style persists it through spineSetStyle", async ({ page }) => {
  await boot(page, {
    spine: { artifacts: { 1: artifact() } },
  });
  await page.getByTestId("spine").first().click();
  await openEdit(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-result"),
  ).toBeVisible();
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
  await openEdit(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-result"),
  ).toBeVisible();
  await page.getByTestId("spine-style-full-bleed").click();
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-direction", "rtl");
  await expect(canvas).toHaveAttribute("dir", "rtl");
  // Hebrew still runs down the spine; the renderer mirrors the rotation
  // rather than reversing the string.
  await expect(canvas).toHaveAttribute("data-text-run", "vertical");
  const hebrewMeta = await canvas.evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      titleCy: Number(data.titleCy),
      titleHeight: Number(data.titleHeight),
      authorCy: Number(data.authorCy),
      authorHeight: Number(data.authorHeight),
      colophonY: Number(data.colophonY),
    };
  });
  // Hebrew keeps the same long run down the spine; the title is not reversed
  // and still owns most of the type block, with the author below it.
  expect(hebrewMeta.titleHeight).toBeGreaterThan(hebrewMeta.authorHeight * 2);
  expect(hebrewMeta.titleHeight).toBeGreaterThan(236 * 0.4);
  expect(hebrewMeta.titleCy + hebrewMeta.titleHeight / 2).toBeLessThan(
    hebrewMeta.authorCy - hebrewMeta.authorHeight / 2,
  );
  expect(hebrewMeta.authorCy + hebrewMeta.authorHeight / 2).toBeLessThan(
    hebrewMeta.colophonY,
  );
  await expect(page.getByTestId("detail-title")).toHaveText(
    "המלחמה של העולמות",
  );
  const transform = await canvas.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(transform).toBe("none");
});

test("a warm cache paints the wall without queueing or generating", async ({
  page,
}) => {
  const cached = artifact({ bookId: 1 });
  await boot(page, {
    spine: {
      backfillPending: false,
      artifacts: { 1: cached },
    },
  });

  const spine = page.getByTestId("spine").first();
  const image = spine.getByTestId("spine-generated");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", cached.spineDataUrl);
  await expect(spine).toHaveAttribute("data-spine-state", "ready");
  expect(await generateCalls(page)).toBe(0);
  expect(await queuedIds(page)).toEqual([]);
  expect(await cachedStripCalls(page)).toBe(1);
});

test("a cached strip in the book payload paints the wall without hydration events", async ({
  page,
}) => {
  // The shell stamps `spineDataUrl` into `list_books`. With no artifact map and
  // no completed queue event, only that payload can paint the strip.
  const cached = spineStrip("#3b2233");
  await boot(page, {
    books: [book(1, { spineDataUrl: cached })],
    spine: { backfillPending: false, queueStartPaused: true, artifacts: {} },
  });

  const spine = page.getByTestId("spine").first();
  const image = spine.getByTestId("spine-generated");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", cached);
  await expect(spine).toHaveAttribute("data-spine-state", "waiting");

  const artifactIds = await page.evaluate(
    () =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_ARTIFACT_IDS__?: number[];
        }
      ).__POCKETLIBRARY_SPINE_ARTIFACT_IDS__ ?? [],
  );
  expect(artifactIds).toEqual([]);
  expect(await generateCalls(page)).toBe(0);
});

test("mergeCachedStrips seeds state once and never enqueues", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { mergeCachedStrips } = await import(
      "/src/library/spineActivity.tsx"
    );
    const strips = [
      {
        bookId: 1,
        verdict: "pass" as const,
        spineDataUrl: "data:image/jpeg;base64,AA==",
      },
      {
        bookId: 2,
        verdict: "fallback" as const,
        spineDataUrl: "data:image/jpeg;base64,BB==",
      },
    ];
    const first = mergeCachedStrips({}, {}, strips, new Set());
    const hydrated = new Set(first.added);
    const second = mergeCachedStrips(
      first.spines,
      first.jobs,
      strips,
      hydrated,
    );
    const refreshed = mergeCachedStrips(
      first.spines,
      first.jobs,
      [
        {
          bookId: 1,
          verdict: "pass" as const,
          spineDataUrl: "data:image/jpeg;base64,CC==",
        },
      ],
      hydrated,
      true,
    );
    return {
      added: first.added,
      passSpine: first.spines[1],
      passJob: first.jobs[1]?.state,
      fallbackSpine: first.spines[2],
      fallbackJob: first.jobs[2]?.state,
      secondAdded: second.added,
      sameSpines: second.spines === first.spines,
      sameJobs: second.jobs === first.jobs,
      refreshedSpine: refreshed.spines[1],
      refreshedAdded: refreshed.added,
    };
  });

  expect(result).toEqual({
    added: [1, 2],
    passSpine: "data:image/jpeg;base64,AA==",
    passJob: "ready",
    fallbackSpine: undefined,
    fallbackJob: "ready",
    secondAdded: [],
    sameSpines: true,
    sameJobs: true,
    refreshedSpine: "data:image/jpeg;base64,CC==",
    refreshedAdded: [1],
  });
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
  await openEdit(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-book-state"),
  ).toHaveAttribute("data-state", "needs-attention");
  await page.getByTestId("spine-generate").click();
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-verdict"),
  ).toBeVisible();
  await page.getByTestId("edit-book-close").click();
  await page.getByTestId("detail-back").click();

  await expect(
    page.getByTestId("spine").first().getByTestId("spine-failed-marker"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("spine").first().getByTestId("spine-generated"),
  ).toBeVisible();
});

test("a warm cache with a missing strip enqueues that book automatically", async ({
  page,
}) => {
  // `backfillPending: false` is the stale-flag case: the shell's one-time
  // backfill already ran, but this book never got art. The launch repair must
  // still queue it once instead of leaving the shelf empty.
  await boot(page, {
    spine: { backfillPending: false, queueStepMs: 25 },
  });

  await expect
    .poll(() => queuedIds(page), { timeout: 8_000 })
    .toContain(1);
  await expect(
    page.getByTestId("spine").first().getByTestId("spine-generated"),
  ).toBeVisible({ timeout: 8_000 });
});

test("Wrap and Full-bleed show generated art while Cloth keeps the face", async ({
  page,
}) => {
  await boot(page, {
    books: [
      book(1, { spineStyle: "wrap" }),
      book(2, { spineStyle: "full-bleed" }),
      book(3, { spineStyle: "cloth" }),
    ],
    spine: {
      backfillPending: false,
      artifacts: {
        1: artifact({ bookId: 1 }),
        2: artifact({ bookId: 2 }),
        3: artifact({ bookId: 3 }),
      },
    },
  });

  const spines = page.getByTestId("spine");
  await expect(spines.nth(0).getByTestId("spine-generated")).toBeVisible();
  await expect(spines.nth(1).getByTestId("spine-generated")).toBeVisible();
  await expect(spines.nth(2).getByTestId("spine-generated")).toHaveCount(0);
  await expect(spines.nth(2).locator(".spine-text")).toBeVisible();
});

test("the generated strip stays visible at 390 and 320 wide", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await boot(page, {
      spine: {
        backfillPending: false,
        artifacts: { 1: artifact({ bookId: 1 }) },
      },
    });
    const image = page.getByTestId("spine-generated");
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);
    await page.goto("about:blank");
  }
});


async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("a failed job stays in the snapshot, chip and shelf marker until retried", async ({
  page,
}) => {
  await boot(page, { spine: { queueStepMs: 15, failIds: [1] } });

  const chip = page.getByTestId("spine-activity");
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await expect(chip).toContainText("1 spine needs attention");
  await expect(chip.getByTestId("spine-retry-all")).toBeVisible();
  await expect(
    page.getByTestId("spine").first().getByTestId("spine-failed-marker"),
  ).toBeVisible({ timeout: 8_000 });

  const events = await queueEvents(page);
  const snapshots = events
    .filter((entry) => entry.event === "queue")
    .map(
      (entry) =>
        entry.payload as {
          failed: number;
          attention: Array<{
            bookId: number;
            state: string;
            error: string;
            attempts: number;
          }>;
        },
    );
  const failedSnapshot = snapshots.find(
    (snapshot) => snapshot.failed === 1 && snapshot.attention.length === 1,
  );
  expect(failedSnapshot?.attention[0].bookId).toBe(1);
  expect(failedSnapshot?.attention[0].state).toBe("needs-attention");
  expect(failedSnapshot?.attention[0].error).toContain("could not be generated");
  expect(failedSnapshot?.attention[0].attempts).toBe(1);

  const before = (await queuedIds(page)).filter((id) => id === 1).length;
  await chip.getByTestId("spine-retry-all").click();
  await expect
    .poll(async () => (await queuedIds(page)).filter((id) => id === 1).length)
    .toBeGreaterThan(before);
});

test("the Settings spine panel renders and Retry all enqueues failures", async ({
  page,
}) => {
  await boot(page, {
    books: [book(1), book(2)],
    spine: {
      queueStepMs: 15,
      failIds: [1],
      missingCoverIds: [1],
    },
  });
  await expect(
    page.getByTestId("spine").first().getByTestId("spine-failed-marker"),
  ).toBeVisible({ timeout: 8_000 });

  await openSettings(page);
  await expect(page.getByTestId("settings-spine-status")).toBeVisible();
  await expect(page.getByTestId("settings-spine-engine")).toContainText(
    "Engine ready",
  );
  await expect(page.getByTestId("settings-spine-bundle")).toContainText(
    "spine-v1",
  );
  await expect(page.getByTestId("settings-spine-model-path")).toContainText(
    "present",
  );
  await expect(page.getByTestId("settings-spine-queue")).toContainText(
    "needing attention",
  );
  const table = page.getByTestId("spine-status-table");
  await expect(table).toContainText("Shelf Volume 1");
  await expect(table).toContainText("Missing");
  await expect(table).toContainText("spine_failed");

  const before = (await queuedIds(page)).filter((id) => id === 1).length;
  await page.getByTestId("settings-spine-retry-all").click();
  await expect
    .poll(async () => (await queuedIds(page)).filter((id) => id === 1).length)
    .toBeGreaterThan(before);
});
