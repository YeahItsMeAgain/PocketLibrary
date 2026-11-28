import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const BOOK: Book = {
  id: 1,
  contentHash: "annotation-hash",
  format: "epub",
  title: "The Lamplighter's Marginalia",
  authors: ["Pocket Library"],
  series: null,
  language: "en",
  description: null,
  publisher: null,
  publishedDate: null,
  identifier: null,
  pageCount: null,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: "unread",
  labels: [],
};

const DEFAULT_SETTINGS = {
  mode: "paginated",
  theme: "paper",
  font: "garamond",
  size: 4,
  spacing: 1,
  margin: 1,
};

async function boot(page: Page) {
  await page.addInitScript(
    ({ book, settings }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: [book],
      };
      if (!window.localStorage.getItem("pocketlibrary.readerSettings")) {
        window.localStorage.setItem(
          "pocketlibrary.readerSettings",
          JSON.stringify(settings),
        );
      }
    },
    { book: BOOK, settings: DEFAULT_SETTINGS },
  );
}

async function openReader(page: Page) {
  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
}

/** Select a real range inside foliate's iframe and let the app observe it. */
async function selectPassage(page: Page, length = 48) {
  await page.evaluate((length) => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer: { getContents(): Array<{ doc: Document }> };
    };
    const doc = view.renderer.getContents()[0]?.doc;
    if (!doc) throw new Error("reader iframe is not loaded");
    const paragraph = doc.querySelector("p") ?? doc.body;
    const text = paragraph.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) {
      throw new Error("paragraph has no text node");
    }
    const range = doc.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(length, text.textContent?.length ?? 0));
    const selection = doc.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    doc.dispatchEvent(new Event("selectionchange"));
  }, length);
  await expect(page.getByTestId("reader-selection-popover")).toBeVisible();
}

async function openDesk(page: Page, tab: "contents" | "marks") {
  await page.getByTestId("reader-pull").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  await page.getByTestId(`reader-desk-tab-${tab}`).click();
}

async function openAnnotations(page: Page) {
  await openDesk(page, "marks");
  await expect(page.getByTestId("reader-annotations")).toBeVisible();
}

async function storedAnnotations(page: Page): Promise<
  Array<{ id: number; kind: string; note: string | null; locator: string }>
> {
  return page.evaluate(() => {
    const all = JSON.parse(
      window.localStorage.getItem("pocketlibrary.mock.annotations") ?? "{}",
    ) as Record<
      number,
      Array<{ id: number; kind: string; note: string | null; locator: string }>
    >;
    return all[1] ?? [];
  });
}

async function drawnHighlightCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as {
      renderer: {
        getContents(): Array<{
          overlayer?: { element?: Element };
        }>;
      };
    };
    return (
      view.renderer.getContents()[0]?.overlayer?.element?.querySelectorAll(
        "rect",
      ).length ?? 0
    );
  });
}

test("a selected passage becomes a highlight that survives reopen", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await selectPassage(page);
  await page.getByTestId("reader-highlight-sage").click();
  await expect(page.getByTestId("reader-selection-popover")).toHaveCount(0);
  await expect.poll(() => drawnHighlightCount(page)).toBeGreaterThan(0);

  await openAnnotations(page);
  await expect(page.getByTestId("reader-annotation-row")).toHaveCount(1);
  await expect(page.getByTestId("reader-annotation-row")).toContainText(
    "The lamp was lit",
  );
  await page.getByTestId("reader-annotation-jump").click();
  await expect(page.getByTestId("reader-annotations")).toHaveCount(0);

  const stored = await storedAnnotations(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].kind).toBe("highlight");
  expect(stored[0].locator).toContain('"v":2');
  expect(stored[0].locator).toContain("TextQuoteSelector");
  expect(stored[0].locator).toContain("TextPositionSelector");

  await page.reload();
  await openReader(page);
  await expect.poll(() => drawnHighlightCount(page)).toBeGreaterThan(0);
  await openAnnotations(page);
  await expect(page.getByTestId("reader-annotation-row")).toHaveCount(1);
});

test("a note attaches to a highlight, edits and deletes while bookmarks coexist", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await selectPassage(page);
  await page.getByTestId("reader-highlight-brass").click();

  // Bookmarks and highlights share the desk's single Marks list.
  await openDesk(page, "marks");
  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();
  await expect(page.getByTestId("reader-annotation-row")).toHaveCount(1);

  await page.getByTestId("reader-annotation-edit").click();
  await expect(page.getByTestId("reader-note-sheet")).toBeVisible();
  await page.getByTestId("reader-note-input").fill("The rain is the real clock.");
  await page.getByTestId("reader-note-save").click();
  await expect(page.getByTestId("reader-note-sheet")).toHaveCount(0);

  await openAnnotations(page);
  await expect(page.getByTestId("reader-annotations")).toContainText(
    "The rain is the real clock.",
  );
  await expect(
    page.getByTestId("reader-annotation-note-marker"),
  ).toHaveCount(1);

  await page.getByTestId("reader-annotation-edit").click();
  await page.getByTestId("reader-note-input").fill("The rain keeps time.");
  await page.getByTestId("reader-note-save").click();
  await openAnnotations(page);
  await expect(page.getByTestId("reader-annotations")).toContainText(
    "The rain keeps time.",
  );

  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await page.getByTestId("reader-annotation-delete").click();
  await expect(page.getByTestId("reader-annotation-row")).toHaveCount(0);
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
});

test("a stale CFI falls back to the quote and is repaired on reopen", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await selectPassage(page);
  await page.getByTestId("reader-highlight-rose").click();

  await page.evaluate(() => {
    const all = JSON.parse(
      window.localStorage.getItem("pocketlibrary.mock.annotations") ?? "{}",
    ) as Record<
      number,
      Array<{ id: number; locator: string }>
    >;
    const annotation = all[1]?.[0];
    if (!annotation) throw new Error("highlight was not saved");
    const locator = JSON.parse(annotation.locator) as {
      locations: { fragments: string[] };
    };
    locator.locations.fragments = ["epubcfi(/6/999!/4/2)"];
    annotation.locator = JSON.stringify(locator);
    window.localStorage.setItem(
      "pocketlibrary.mock.annotations",
      JSON.stringify(all),
    );
  });

  await page.reload();
  await openReader(page);
  await expect
    .poll(async () => {
      const stored = await storedAnnotations(page);
      return stored[0]?.locator.includes("/6/999!") ?? true;
    })
    .toBe(false);
  await expect.poll(() => drawnHighlightCount(page)).toBeGreaterThan(0);
  await openAnnotations(page);
  await expect(page.getByTestId("reader-annotation-row")).toHaveCount(1);
});
