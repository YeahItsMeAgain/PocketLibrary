import { expect, test, type Page } from "@playwright/test";

import type {
  Book,
  MockSpineConfig,
  SpineArtifact,
  SpineStyle,
} from "../../src/platform";

function book(id: number, overrides: Partial<Book> = {}): Book {
  return {
    id,
    contentHash: `style-sync-${id}`,
    format: "epub",
    title: "The Dispossessed",
    authors: ["Ursula K. Le Guin"],
    series: null,
    language: "en",
    description: "A quiet revolution gathers behind the palace doors.",
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

function artifact(): SpineArtifact {
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
  };
}

interface BootOptions {
  books?: Book[];
  spine?: MockSpineConfig;
}

async function boot(page: Page, options: BootOptions = {}) {
  await page.addInitScript(
    ({ books, spine }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine: { queueStartPaused: true, ...spine },
      };
    },
    { books: options.books ?? [book(1)], spine: options.spine ?? {} },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

async function openDetail(page: Page) {
  await page.getByTestId("spine").first().tap();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function openEdit(page: Page) {
  await page.getByTestId("detail-edit").tap();
  await expect(page.getByTestId("edit-book")).toBeVisible();
}

async function expectResult(page: Page) {
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-result"),
  ).toBeVisible();
}

/** The selected style as stored in the mock (the app's persistence seam). */
function mockStyle(page: Page, id = 1): Promise<SpineStyle | undefined> {
  return page.evaluate(
    (bookId) =>
      (
        window as unknown as {
          __POCKETLIBRARY_SPINE_STYLES__?: Record<number, SpineStyle>;
        }
      ).__POCKETLIBRARY_SPINE_STYLES__?.[bookId],
    id,
  );
}

/** The exact `spineStyle` on the book object the wall's Spine rendered. */
async function expectWallStyle(
  page: Page,
  style: SpineStyle,
  expectStoredStyle = true,
) {
  const spine = page.locator('[data-testid="spine"][data-book-id="1"]');
  // The shelf exposes the style it actually rendered; Cloth is also proven
  // by the art being suppressed rather than just by the attribute.
  await expect(spine).toHaveAttribute("data-style", style);
  if (expectStoredStyle) {
    await expect.poll(() => mockStyle(page, 1)).toBe(style);
  }
  if (style === "cloth") {
    await expect(spine.getByTestId("spine-generated")).toHaveCount(0);
    await expect(spine).not.toHaveClass(/has-generated/);
    await expect(spine.locator(".spine-text")).toBeVisible();
  } else {
    await expect(spine.getByTestId("spine-generated")).toBeVisible();
    await expect(spine).toHaveClass(/has-generated/);
  }
}

async function chooseStyle(page: Page, style: SpineStyle) {
  await page.getByTestId(`spine-style-${style}`).tap();
  await expect(page.getByTestId(`spine-style-${style}`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    style,
  );
  await expect.poll(() => mockStyle(page, 1)).toBe(style);
}

for (const width of [390, 320]) {
  for (const style of ["wrap", "full-bleed", "cloth"] as const) {
    test(`choosing ${style} reaches the wall at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await boot(page, { spine: { artifacts: { 1: artifact() } } });
      await openDetail(page);
      await openEdit(page);
      await expectResult(page);

      if (style === "wrap") {
        // Default Wrap is not written until it differs from the stored style;
        // move away first so this exercises the Wrap transition itself.
        await chooseStyle(page, "full-bleed");
      }
      await chooseStyle(page, style);
      await page.getByTestId("edit-book-close").tap();
      await expect(page.getByTestId("book-detail")).toBeVisible();
      await expectWallStyle(page, style);

      // Reopening reads the stored detail, not a stale picker default.
      await openEdit(page);
      await expectResult(page);
      await expect(page.getByTestId(`spine-style-${style}`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByTestId("spine-preview")).toHaveAttribute(
        "data-style",
        style,
      );
    });
  }
}

for (const width of [390, 320]) {
  test(`choosing a style and closing immediately still persists at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page, { spine: { artifacts: { 1: artifact() } } });
    await openDetail(page);
    await openEdit(page);
    await expectResult(page);

    // No waits between the choice and the close: the platform write must not
    // be tied to the layer staying mounted.
    await page.getByTestId("spine-style-full-bleed").tap();
    await page.getByTestId("edit-book-close").tap();
    await expect(page.getByTestId("book-detail")).toBeVisible();
    await expectWallStyle(page, "full-bleed");

    await openEdit(page);
    await expectResult(page);
    await page.getByTestId("spine-style-cloth").tap();
    await page.getByTestId("edit-book-close").tap();
    await expectWallStyle(page, "cloth");
  });
}

test("undo restores the previous style in the picker, the wall and storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, { spine: { artifacts: { 1: artifact() } } });
  await openDetail(page);
  await openEdit(page);
  await expectResult(page);
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await chooseStyle(page, "full-bleed");
  await page.getByTestId("edit-undo").tap();
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "wrap",
  );
  await expect.poll(() => mockStyle(page, 1)).toBe("wrap");
  await expect(page.getByTestId("edit-undo-toast")).toHaveText("");

  await page.getByTestId("edit-book-close").tap();
  await expectWallStyle(page, "wrap");

  await openEdit(page);
  await expectResult(page);
  await expect(page.getByTestId("spine-style-wrap")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a persisted style from the list payload is respected by the wall and Edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // This is the shape a style set elsewhere (or restored from the database)
  // takes: the book payload carries it before this session ever opens Edit.
  await boot(page, {
    books: [book(1, { spineStyle: "cloth" })],
    spine: { artifacts: { 1: artifact() } },
  });
  await expectWallStyle(page, "cloth", false);

  await openDetail(page);
  await openEdit(page);
  await expectResult(page);
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
});

test("the mock's styles config is the same record list_books and Edit read", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  // `styles` models a style already stored in SQLite when the app launches.
  await boot(page, {
    spine: { artifacts: { 1: artifact() }, styles: { 1: "full-bleed" } },
  });
  await expectWallStyle(page, "full-bleed");

  await openDetail(page);
  await openEdit(page);
  await expectResult(page);
  await expect(page.getByTestId("spine-style-full-bleed")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "full-bleed",
  );
});

test("a chosen style survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, { spine: { artifacts: { 1: artifact() } } });
  await openDetail(page);
  await openEdit(page);
  await expectResult(page);
  await chooseStyle(page, "cloth");
  await page.getByTestId("edit-book-close").tap();
  await expectWallStyle(page, "cloth");

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expectWallStyle(page, "cloth");

  await openDetail(page);
  await openEdit(page);
  await expectResult(page);
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
});

test("touch taps on the style row are not swallowed by the undo toast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await boot(page, { spine: { artifacts: { 1: artifact() } } });
  await openDetail(page);
  await openEdit(page);
  await expectResult(page);

  await page.getByTestId("spine-style-full-bleed").tap();
  await expect(page.getByTestId("edit-undo-toast")).toContainText(
    "Spine style set to Full-bleed",
  );

  // Scroll the style row under the fixed toast. A real finger has no
  // scroll-into-view, so tap the coordinates directly rather than letting the
  // locator move the page first.
  await page
    .getByTestId("spine-style-grid")
    .evaluate((element) => element.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(150);
  const box = await page.getByTestId("spine-style-cloth").boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByTestId("spine-style-cloth")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("spine-preview")).toHaveAttribute(
    "data-style",
    "cloth",
  );
});

test("Generate and Retry accept a real touch tap", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await boot(page, {
    spine: {
      error: { code: "spine_failed", message: "The engine stopped." },
    },
  });
  await openDetail(page);
  await openEdit(page);

  const generate = page.getByTestId("spine-generate");
  await generate.tap();
  await expect(page.getByTestId("spine-error")).toBeVisible();
  const retry = page.getByTestId("spine-retry");
  await expect(retry).toBeVisible();

  // Let the second attempt succeed, then tap Retry.
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __POCKETLIBRARY_MOCK__?: { spine?: { error?: unknown } };
      }
    ).__POCKETLIBRARY_MOCK__;
    if (mock?.spine) delete mock.spine.error;
  });
  await retry.tap();
  await expect(
    page.getByTestId("edit-book").getByTestId("spine-verdict"),
  ).toBeVisible();
});
