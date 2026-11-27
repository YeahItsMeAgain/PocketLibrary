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
        // These cover the manual studio; automatic preparation is exercised
        // by spine-queue.spec.ts.
        spine: { queueStartPaused: true, ...nextSpine },
      };
    },
    { nextSpine: spine },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function openEdit(page: Page) {
  await page.getByTestId("detail-edit").click();
  await expect(page.getByTestId("edit-book")).toBeVisible();
}

async function generate(page: Page) {
  await openEdit(page);
  await page.getByTestId("spine-generate").click();
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-verdict"),
  ).toBeVisible();
  await expect(page.getByTestId("spine-style-grid").locator("canvas")).toHaveCount(
    3,
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
  const section = await page
    .getByTestId("edit-book")
    .getByTestId("spine-studio")
    .boundingBox();
  expect(section).not.toBeNull();
  expect(section!.width).toBeLessThanOrEqual(sizes.viewport);
}

test("the read view has no spine controls and Edit holds the one obvious action", async ({
  page,
}) => {
  await boot(page);
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await expect(page.getByTestId("spine-generate")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-grid")).toHaveCount(0);
  await expect(page.getByTestId("spine-use-cloth")).toHaveCount(0);

  await openEdit(page);
  const studio = page.getByTestId("edit-book").getByTestId("spine-studio");
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
  await expect.poll(() => statusCalls(page)).toBe(1);
  const statusAtWall = await statusCalls(page);
  await openEdit(page);
  await expect(page.getByTestId("spine-generate")).toBeVisible();
  // The wall resolves the engine once when the library is ready, but opening a
  // book must not resolve it again or run generation.
  expect(statusAtWall).toBe(1);
  expect(await statusCalls(page)).toBe(statusAtWall);
  expect(await generateCalls(page)).toBe(0);

  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-verdict")).toBeVisible();
  expect(await statusCalls(page)).toBeGreaterThan(0);
  expect(await generateCalls(page)).toBe(1);
});

test("generate shows honest progress, then a result with three style canvases", async ({
  page,
}) => {
  await boot(page, { generateDelayMs: 700 });
  await openEdit(page);
  await page.getByTestId("spine-generate").click();
  await expect(page.getByTestId("spine-generating")).toBeVisible();
  await expect(page.getByTestId("spine-generating")).toContainText(
    "Finding cover text",
  );
  const edit = page.getByTestId("edit-book");
  await expect(edit.getByTestId("spine-verdict")).toBeVisible();
  await expect(edit.getByTestId("spine-verdict")).toHaveText("Pass");
  await expect(edit.getByTestId("spine-meta")).toContainText("Mask 0.0%");
  await expect(edit.getByTestId("spine-meta")).toContainText("Route crop");
  const grid = page.getByTestId("spine-style-grid");
  await expect(grid.locator("canvas")).toHaveCount(3);
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

test("the restored prototype type fills the spine run in the studio", async ({
  page,
}) => {
  await boot(page);
  await generate(page);
  await page.getByTestId("spine-style-full-bleed").click();
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-style", "full-bleed");
  const meta = await canvas.evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      cx: Number(data.blockCx),
      titleCy: Number(data.titleCy),
      titleHeight: Number(data.titleHeight),
      titleLines: Number(data.titleLines),
      authorCy: Number(data.authorCy),
      authorHeight: Number(data.authorHeight),
      colophonY: Number(data.colophonY),
      contrast: Number(data.contrast),
      scrimAlpha: Number(data.scrimAlpha),
    };
  });
  // Both styles are centred and backed by a real smoked window.
  expect(meta.cx).toBeCloseTo(26, 0);
  expect(meta.scrimAlpha).toBeGreaterThanOrEqual(0.6);
  expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
  expect(meta.titleHeight).toBeGreaterThan(236 / 2);
  expect(meta.titleLines).toBe(1);
  expect(meta.titleCy + meta.titleHeight / 2).toBeLessThan(
    meta.authorCy - meta.authorHeight / 2,
  );
  expect(meta.authorCy + meta.authorHeight / 2).toBeLessThan(meta.colophonY);
  expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
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
  const clothMeta = await page
    .getByTestId("spine-preview-canvas")
    .evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset;
      return {
        cx: Number(data.blockCx),
        scrimAlpha: Number(data.scrimAlpha),
        contrast: Number(data.contrast),
        titleCy: Number(data.titleCy),
        titleHeight: Number(data.titleHeight),
        authorCy: Number(data.authorCy),
        authorHeight: Number(data.authorHeight),
      };
    });
  // Cloth is typographic: no scrim/art window, centred foil type and enough
  // contrast against the board.
  expect(clothMeta.cx).toBeCloseTo(26, 0);
  expect(clothMeta.scrimAlpha).toBe(0);
  expect(clothMeta.contrast).toBeGreaterThanOrEqual(4.5);
  expect(clothMeta.titleCy + clothMeta.titleHeight / 2).toBeLessThan(
    clothMeta.authorCy - clothMeta.authorHeight / 2,
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

  await page.getByTestId("edit-book-close").click();
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("book-detail")).toHaveCount(0);
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
  await openEdit(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-verdict"),
  ).toBeVisible();
  await expect(page.getByTestId("spine-style-grid").locator("canvas")).toHaveCount(
    3,
  );
  expect(await generateCalls(page)).toBe(1);
});

test("review shows the verdict without an instruction note, and the picker still selects Cloth", async ({
  page,
}) => {
  await boot(page, { verdict: "review", route: "inpaint", maskPercent: 44.1 });
  await generate(page);
  const edit = page.getByTestId("edit-book");
  await expect(edit.getByTestId("spine-verdict")).toHaveText("Review");
  await expect(edit.getByTestId("spine-meta")).toContainText("Mask 44.1%");
  await expect(edit.getByTestId("spine-meta")).toContainText("Route inpaint");
  // The picker is the only way to choose a style: no review note or inline
  // "Use Cloth" action.
  await expect(edit.getByTestId("spine-review-note")).toHaveCount(0);
  await expect(edit.getByTestId("spine-use-cloth")).toHaveCount(0);

  await page.getByTestId("spine-style-cloth").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
  expect(await generateCalls(page)).toBe(1);
});

test("fallback state previews Cloth without persisting the style", async ({
  page,
}) => {
  await boot(page, { verdict: "fallback", route: "fallback" });
  await generate(page);
  const edit = page.getByTestId("edit-book");
  await expect(edit.getByTestId("spine-verdict")).toHaveText("Fallback");
  await expect(edit.getByTestId("spine-fallback-note")).toContainText(
    "This result was rejected, so the cloth spine is shown.",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A failed result must not pin Cloth to the book: that would hide later
  // successful art behind the cloth shelf with no way to tell why.
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __POCKETLIBRARY_SPINE_STYLES__?: Record<number, string>;
          }
        ).__POCKETLIBRARY_SPINE_STYLES__?.[1],
    ),
  ).toBeUndefined();
});

test("an approximate page count labels the spine width", async ({ page }) => {
  await boot(page, { pagesApproximate: true });
  await generate(page);
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-approximate-note"),
  ).toContainText("Approximate spine width");
});

test("the picker offers exactly Wrap, Full-bleed and Cloth", async ({ page }) => {
  await boot(page);
  await generate(page);
  const grid = page.getByTestId("spine-style-grid");
  await expect(grid.getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("spine-style-wrap")).toBeVisible();
  await expect(page.getByTestId("spine-style-full-bleed")).toBeVisible();
  await expect(page.getByTestId("spine-style-cloth")).toBeVisible();
  await expect(page.getByTestId("spine-style-hybrid")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-artonly")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-editorial")).toHaveCount(0);
});

test("no horizontal overflow at 390 or 320 px", async ({ page }) => {
  await boot(page);
  await generate(page);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("spine-style-full-bleed").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "full-bleed",
  );
  await expectNoHorizontalOverflow(page);
});

/* --------------------------------------------------------- touch taps -- */

async function hitAt(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box).not.toBeNull();
  const point = {
    x: box!.x + box!.width / 2,
    y: box!.y + box!.height / 2,
  };
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const target = hit?.closest<HTMLElement>("[data-testid]");
    const chip = hit?.closest<HTMLElement>('button[data-testid^="spine-style-"]');
    const toast = document.querySelector<HTMLElement>(
      '[data-testid="edit-undo-toast"]',
    );
    const undo = document.querySelector<HTMLElement>(
      '[data-testid="edit-undo"]',
    );
    return {
      target: target?.dataset.testid ?? null,
      chip: chip?.dataset.testid ?? null,
      tag: hit?.tagName ?? null,
      toastDisplay: toast ? getComputedStyle(toast).display : null,
      toastPointer: toast ? getComputedStyle(toast).pointerEvents : null,
      undoPointer: undo ? getComputedStyle(undo).pointerEvents : null,
    };
  }, point);
}

for (const width of [390, 320]) {
  test(`touch taps reach the style picker under the undo toast at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    await openEdit(page);
    await page.getByTestId("edit-book").getByTestId("spine-generate").tap();
    await expect(page.getByTestId("spine-style-grid")).toBeVisible();

    // Put the picker at the bottom of the sheet, where the fixed undo toast
    // sits, then choose a style so the toast appears.
    await page
      .getByTestId("spine-style-grid")
      .evaluate((element) => element.scrollIntoView({ block: "end" }));
    // The default is Wrap, so choose Full-bleed to actually create an undo
    // entry (choosing the current style is a no-op).
    await page.getByTestId("spine-style-full-bleed").tap();
    await expect(page.getByTestId("edit-undo-toast")).toBeVisible();
    await page
      .getByTestId("spine-style-grid")
      .evaluate((element) => element.scrollIntoView({ block: "end" }));

    const hit = await hitAt(page, "spine-style-cloth");
    expect(hit.toastDisplay).toBe("flex");
    // The toast body is pass-through; only its Undo button takes input.
    expect(hit.toastPointer).toBe("none");
    expect(hit.undoPointer).toBe("auto");
    expect(hit.chip).toBe("spine-style-cloth");

    await page.getByTestId("spine-style-cloth").tap();
    await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("spine-preview")).toHaveAttribute(
      "data-style",
      "cloth",
    );
    // The mock only records a style through spineSetStyle, so this proves the
    // tap reached the chip's onClick.
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __POCKETLIBRARY_SPINE_STYLES__?: Record<number, string>;
            }
          ).__POCKETLIBRARY_SPINE_STYLES__?.[1],
      ),
    ).toBe("cloth");

    // The large preview is a stage, not a control: tapping it must not change
    // the style or run the engine.
    await page.getByTestId("spine-preview-canvas").tap();
    await expect(page.getByTestId("spine-preview")).toHaveAttribute(
      "data-style",
      "cloth",
    );
    expect(await generateCalls(page)).toBe(1);
  });
}

test("touch taps reach Generate and Retry", async ({ page }) => {
  await boot(page, {
    error: { code: "spine_failed", message: "The engine stopped." },
  });
  await openEdit(page);

  await page.getByTestId("spine-generate").scrollIntoViewIfNeeded();
  const generateHit = await hitAt(page, "spine-generate");
  expect(generateHit.target).toBe("spine-generate");
  await page.getByTestId("spine-generate").tap();
  await expect(page.getByTestId("spine-error")).toBeVisible();

  await page
    .getByTestId("spine-retry")
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
  const retryHit = await hitAt(page, "spine-retry");
  expect(retryHit.target).toBe("spine-retry");
  await page.getByTestId("spine-retry").tap();
  await expect.poll(() => generateCalls(page)).toBe(2);
});
