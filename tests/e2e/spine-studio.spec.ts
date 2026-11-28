import { expect, test, type Page } from "@playwright/test";

import type { Label, MockSpineConfig, ReadingStatus } from "../../src/platform";

async function boot(
  page: Page,
  spine: MockSpineConfig = {},
  labels: Label[] = [],
  title = "Rock Paper Scissors",
  readingStatus: ReadingStatus = "unread",
) {
  await page.addInitScript(
    ({ nextSpine, nextLabels, nextTitle, nextStatus }) => {
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
            title: nextTitle,
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
            readingStatus: nextStatus,
            labels: nextLabels,
          },
        ],
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        // These cover the manual studio; automatic preparation is exercised
        // by spine-queue.spec.ts.
        spine: { queueStartPaused: true, ...nextSpine },
      };
    },
    {
      nextSpine: spine,
      nextLabels: labels,
      nextTitle: title,
      nextStatus: readingStatus,
    },
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
  await expect(page.getByTestId("spine-style-art")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "art",
  );
  await expect(page.getByTestId("spine-strip-canvas")).toBeVisible();
});

test("Art paints S1 smoked leather over a full-height strip", async ({
  page,
}) => {
  await boot(page);
  await generate(page);
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-style", "art");
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
      scrimHead: Number(data.scrimHead),
      scrimTail: Number(data.scrimTail),
      scrim: data.scrim,
      orientation: data.textOrientation,
      bandTop: data.bandTop,
      bandBottom: data.bandBottom,
      artTop: Number(data.artTop),
      artBottom: Number(data.artBottom),
      footTop: Number(data.footTop),
      footHeight: Number(data.footHeight),
      headReserve: Number(data.headReserve),
      markKind: data.markKind,
    };
  });
  // S1: full-height art under a warm 64 -> 84% scrim, no opaque bands, and a
  // deep 30% foot for the author and codes.
  expect(meta.scrim).toBe("true");
  expect(meta.scrimAlpha).toBeCloseTo(0.84, 2);
  expect(meta.scrimHead).toBeCloseTo(0.64, 2);
  expect(meta.scrimTail).toBeCloseTo(0.84, 2);
  expect(meta.bandTop).toBe("");
  expect(meta.bandBottom).toBe("");
  expect(meta.artTop).toBe(0);
  expect(meta.artBottom).toBeCloseTo(236, 0);
  expect(meta.footTop).toBeCloseTo(236 * 0.7, 0);
  expect(meta.footHeight).toBeCloseTo(236 * 0.3, 0);
  expect(meta.headReserve).toBe(10);
  expect(meta.markKind).toBe("none");
  // The title box is 10px to 70% + 4px; the run stays inside it.
  expect(meta.titleCy - meta.titleHeight / 2).toBeGreaterThanOrEqual(
    meta.headReserve,
  );
  expect(meta.titleCy + meta.titleHeight / 2).toBeLessThanOrEqual(
    meta.footTop - 3,
  );
  expect(meta.authorCy).toBeGreaterThan(meta.footTop);
  expect(meta.authorCy + meta.authorHeight / 2).toBeLessThanOrEqual(236);
  // Cream on the composited scrim: title ink and hairline are both gone.
  expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
  expect(meta.cx).toBeCloseTo(26, 0);
  expect(meta.orientation).toBe("top-down");
  expect(meta.titleLines).toBe(1);
  // Art has no cap mark, so the colophon sits at the top edge.
  expect(meta.colophonY).toBe(0);
  expect(meta.titleCy + meta.titleHeight / 2).toBeLessThan(
    meta.authorCy - meta.authorHeight / 2,
  );
});

for (const status of ["finished", "reading"] as const) {
  test(`the Studio shares the shelf's ${status} mark and face geometry`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page, {}, [], "The Whisper Man", status);
    await generate(page);
    const canvas = page.getByTestId("spine-preview-canvas");
    const meta = await canvas.evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset;
      return {
        scrim: data.scrim,
        footTop: Number(data.footTop),
        footHeight: Number(data.footHeight),
        headReserve: Number(data.headReserve),
        markKind: data.markKind,
        markTop: Number(data.markTop),
        markWidth: Number(data.markWidth),
        markHeight: Number(data.markHeight),
      };
    });
    const shelf = await page
      .locator('[data-testid="spine"][data-book-id="1"]')
      .evaluate((element) => {
        const spine = element as HTMLElement;
        const frame = spine.getBoundingClientRect();
        const pick = (selector: string) =>
          spine.querySelector<HTMLElement>(selector);
        const box = (node: HTMLElement | null) => {
          if (!node) return null;
          return {
            top: node.offsetTop,
            width: node.offsetWidth,
            height: node.offsetHeight,
            right: spine.clientWidth - node.offsetLeft - node.offsetWidth,
          };
        };
        const text = pick(".spine-text");
        const foot = pick(".spine-foot");
        const ribbon = pick(".gold-ribbon");
        return {
          height: frame.height,
          titleTop: text ? box(text)?.top ?? 0 : 0,
          footTop: foot ? box(foot)?.top ?? 0 : 0,
          footHeight: foot ? box(foot)?.height ?? 0 : 0,
          scrim: Boolean(pick(".spine-smoke")),
          ribbon: ribbon ? box(ribbon) : null,
        };
      });

    // Both renderers report the same scrim, 30% foot and head reserve.
    expect(meta.scrim).toBe("true");
    expect(shelf.scrim).toBe(true);
    expect(shelf.footTop / shelf.height).toBeCloseTo(0.7, 2);
    expect(meta.footTop / 236).toBeCloseTo(0.7, 2);
    expect(shelf.footHeight / shelf.height).toBeCloseTo(0.3, 2);
    expect(meta.footHeight / 236).toBeCloseTo(0.3, 2);
    expect(shelf.titleTop).toBeCloseTo(
      status === "finished" ? 28 : 10,
      0,
    );
    expect(meta.headReserve).toBe(status === "finished" ? 28 : 10);

    if (status === "finished") {
      expect(meta.markKind).toBe("gold-ribbon");
      expect(meta.markTop).toBe(0);
      expect(meta.markWidth).toBe(8);
      expect(meta.markHeight).toBe(26);
      expect(shelf.ribbon).not.toBeNull();
      expect(shelf.ribbon!.width).toBeCloseTo(8, 0);
      expect(shelf.ribbon!.height).toBeCloseTo(26, 0);
      expect(shelf.ribbon!.top).toBeCloseTo(0, 0);
      expect(shelf.ribbon!.right).toBeCloseTo(3, 0);
    } else {
      expect(meta.markKind).toBe("drape");
      expect(meta.markTop).toBeCloseTo(232, 0);
      expect(meta.markWidth).toBe(8);
      expect(meta.markHeight).toBe(31);
      expect(shelf.ribbon).toBeNull();
      await expect(
        page.locator('[data-testid="spine-drape"][data-book-id="1"]'),
      ).toHaveCount(1);
    }
  });
}

const chipLabels: Label[] = [
  { id: 1, name: "Favourite", colour: "#6e2630", createdAt: 1 },
  { id: 2, name: "Book club", colour: "#214d4c", createdAt: 1 },
];

for (const width of [390, 320]) {
  test(`Art label chips paint 4-5 letter codes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page, {}, chipLabels);
    await generate(page);
    await expect(page.getByTestId("spine-preview")).toHaveAttribute(
      "data-style",
      "art",
    );
    const chips = await page
      .getByTestId("spine-preview-canvas")
      .getAttribute("data-label-chips");
    expect(chips).not.toBeNull();
    const texts = (chips ?? "").split("|");
    expect(texts).toEqual(["FAVO", "BOOK"]);
    for (const text of texts) {
      expect(text.length).toBeGreaterThanOrEqual(4);
      expect(text.length).toBeLessThanOrEqual(5);
    }
    expect(texts).not.toContain("FAVOURITE");
    expect(texts).not.toContain("BOOK CLUB");
    expect(texts.some((text) => text.includes("…"))).toBe(false);
  });
}

for (const width of [390, 320]) {
  test(`Cloth and Typography centre the whole type block at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(
      page,
      {},
      [],
      "The Extraordinarily Long and Unabridged Chronicle of the Lighthouse Keeper's Daughter",
    );
    await generate(page);
    for (const style of ["cloth", "typography"] as const) {
      await page.getByTestId(`spine-style-${style}`).click();
      await expect(page.getByTestId("spine-preview")).toHaveAttribute(
        "data-style",
        style,
      );
      const meta = await page
        .getByTestId("spine-preview-canvas")
        .evaluate((element) => {
          const data = (element as HTMLCanvasElement).dataset;
          return {
            blockCy: Number(data.blockCy),
            titleCy: Number(data.titleCy),
            titleHeight: Number(data.titleHeight),
            authorCy: Number(data.authorCy),
            authorHeight: Number(data.authorHeight),
          };
        });
      const top = meta.titleCy - meta.titleHeight / 2;
      const bottom = meta.authorCy + meta.authorHeight / 2;
      expect(meta.blockCy).toBeCloseTo(118, 0);
      expect(Math.abs((top + bottom) / 2 - 118)).toBeLessThanOrEqual(2);
      expect(top).toBeGreaterThanOrEqual(20);
      expect(bottom).toBeLessThanOrEqual(216);
      expect(meta.titleHeight).toBeGreaterThan(0);
      expect(meta.authorHeight).toBeGreaterThan(0);
    }
  });
}


test("changing the reading status updates the Studio mark live", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, {}, [], "The Whisper Man", "reading");
  await generate(page);
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-mark-kind", "drape");

  // The status section lives below the spine section in the same Edit sheet.
  // Changing it must reach the canvas without closing or remounting the studio.
  await page
    .getByTestId("edit-section-status")
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.getByTestId("edit-status-finished").click();
  await expect(page.getByTestId("edit-status-finished")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(canvas).toHaveAttribute("data-mark-kind", "gold-ribbon");
  await expect(canvas).toHaveAttribute("data-head-reserve", "28.00");

  await page.getByTestId("edit-status-unread").click();
  await expect(page.getByTestId("edit-status-unread")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(canvas).toHaveAttribute("data-mark-kind", "none");
  await expect(canvas).toHaveAttribute("data-head-reserve", "10.00");

  await page.getByTestId("edit-status-reading").click();
  await expect(page.getByTestId("edit-status-reading")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(canvas).toHaveAttribute("data-mark-kind", "drape");
});

test("a single long word stays inside the canvas title box", async ({
  page,
}) => {
  await boot(page, {}, [], "CharacteristicallyUncharacteristically");
  await generate(page);
  const meta = await page
    .getByTestId("spine-preview-canvas")
    .evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset;
      return {
        titleCy: Number(data.titleCy),
        titleHeight: Number(data.titleHeight),
        titleLines: Number(data.titleLines),
        titleFontSize: Number(data.titleFontSize),
        headReserve: Number(data.headReserve),
        footTop: Number(data.footTop),
      };
    });
  expect(meta.titleLines).toBe(1);
  expect(meta.titleFontSize).toBeGreaterThanOrEqual(2.8);
  expect(meta.titleCy - meta.titleHeight / 2).toBeGreaterThanOrEqual(
    meta.headReserve - 0.5,
  );
  expect(meta.titleCy + meta.titleHeight / 2).toBeLessThanOrEqual(
    meta.footTop - 3,
  );
});

test("switching Art and Cloth re-renders the preview without generating again", async ({
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

  await page.getByTestId("spine-style-art").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "art",
  );
  await expect(page.getByTestId("spine-generating")).toHaveCount(0);
  expect(await generateCalls(page)).toBe(1);
});

test("Typography previews as a flat type-only board", async ({ page }) => {
  await boot(page);
  await generate(page);
  await page.getByTestId("spine-style-typography").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "typography",
  );
  const canvas = page.getByTestId("spine-preview-canvas");
  await expect(canvas).toHaveAttribute("data-style", "typography");
  const meta = await canvas.evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      cx: Number(data.blockCx),
      scrimAlpha: Number(data.scrimAlpha),
      contrast: Number(data.contrast),
      titleCy: Number(data.titleCy),
      titleHeight: Number(data.titleHeight),
      authorCy: Number(data.authorCy),
      authorHeight: Number(data.authorHeight),
      width: element.width,
      height: element.height,
      direction: data.direction,
      textRun: data.textRun,
      textOrientation: data.textOrientation,
      canvasDir: element.getAttribute("dir"),
    };
  });
  const cloth = await page.getByTestId("spine-canvas-cloth").evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    return {
      direction: data.direction,
      textRun: data.textRun,
      canvasDir: element.getAttribute("dir"),
    };
  });
  // Portrait 52 x 236 (scaled for DPR), no generated art window and flat,
  // cream-on-board type. The run must face the same way as the shelf face:
  // top-to-bottom with upright glyphs, never the old bottom-up mirror.
  expect(meta.cx).toBeCloseTo(26, 0);
  expect(meta.scrimAlpha).toBe(0);
  expect(meta.contrast).toBeGreaterThanOrEqual(4.5);
  expect(meta.height).toBeGreaterThan(meta.width);
  expect(meta.direction).toBe(cloth.direction);
  expect(meta.textRun).toBe(cloth.textRun);
  expect(meta.canvasDir).toBe(cloth.canvasDir);
  expect(meta.direction).toBe("ltr");
  expect(meta.textRun).toBe("vertical");
  expect(meta.textOrientation).toBe("top-down");
  expect(meta.titleCy + meta.titleHeight / 2).toBeLessThan(
    meta.authorCy - meta.authorHeight / 2,
  );
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

test("the picker offers exactly Art, Cloth and Typography", async ({
  page,
}) => {
  await boot(page);
  await generate(page);
  const grid = page.getByTestId("spine-style-grid");
  await expect(grid.getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("spine-style-art")).toBeVisible();
  await expect(page.getByTestId("spine-style-art")).toContainText("Art");
  await expect(page.getByTestId("spine-style-art")).not.toContainText("Wrap");
  await expect(page.getByTestId("spine-style-cloth")).toBeVisible();
  await expect(page.getByTestId("spine-style-typography")).toBeVisible();
  await expect(page.getByTestId("spine-style-full-bleed")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-hybrid")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-artonly")).toHaveCount(0);
  await expect(page.getByTestId("spine-style-editorial")).toHaveCount(0);
});

async function expectStyleGridFits(page: Page) {
  const grid = page.getByTestId("spine-style-grid");
  await expect(grid.getByRole("button")).toHaveCount(3);
  const metrics = await grid.evaluate((element) => {
    const tiles = [
      ...element.querySelectorAll<HTMLElement>(
        'button[data-testid^="spine-style-"]',
      ),
    ].map((tile) => {
      const rect = tile.getBoundingClientRect();
      const label = tile.querySelector<HTMLElement>(".spine-style-label");
      return {
        width: rect.width,
        height: rect.height,
        labelOverflowX: label ? label.scrollWidth - label.clientWidth : 0,
        labelOverflowY: label ? label.scrollHeight - label.clientHeight : 0,
      };
    });
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      tiles,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  for (const tile of metrics.tiles) {
    expect(tile.width).toBeGreaterThanOrEqual(44);
    expect(tile.height).toBeGreaterThanOrEqual(44);
    expect(tile.labelOverflowX).toBeLessThanOrEqual(1);
    expect(tile.labelOverflowY).toBeLessThanOrEqual(1);
  }
}

test("no horizontal overflow at 390 or 320 px", async ({ page }) => {
  await boot(page);
  await generate(page);
  await expectNoHorizontalOverflow(page);
  await expectStyleGridFits(page);

  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expectStyleGridFits(page);
  await page.getByTestId("spine-style-cloth").click();
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
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
    // The default is Art, so choose Typography to actually create an undo
    // entry (choosing the current style is a no-op).
    await page.getByTestId("spine-style-typography").tap();
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
