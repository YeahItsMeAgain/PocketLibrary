import { expect, test, type Page } from "@playwright/test";

import type {
  Book,
  CoverOption,
  EnrichmentOutcome,
  MockEnrichmentConfig,
} from "../../src/platform";

function book(id: number, title: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title,
    authors: ["Ursula K. Le Guin"],
    series: null,
    language: null,
    description: null,
    publisher: null,
    publishedDate: "1974-05-01",
    identifier: null,
    pageCount: null,
    addedAt: 1_700_000_000 + id,
    shelfId: 1,
    slotIndex: id - 1,
    readingStatus: "unread",
    labels: [],
    ...overrides,
  };
}

const ALT_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#294735"/></svg>',
  );

const ATTRIBUTION = {
  label: "Open Library",
  url: "https://openlibrary.org/books/OL1M",
  fields: ["description", "cover"],
};

async function boot(
  page: Page,
  books: Book[],
  enrichment: MockEnrichmentConfig = {},
) {
  await page.addInitScript(
    ({ nextBooks, nextEnrichment }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: nextBooks,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        enrichment: nextEnrichment,
      };
    },
    { nextBooks: books, nextEnrichment: enrichment },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

async function openDetail(page: Page) {
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

async function openBookMenu(page: Page) {
  await page.getByTestId("detail-actions").click();
}

test("online details are off by default and name only Open Library", async ({
  page,
}) => {
  await boot(page, [book(1, "The Dispossessed")]);
  await openSettings(page);

  const section = page.getByTestId("settings-online");
  await expect(section).toBeVisible();
  await expect(section).toContainText("Open Library");
  await expect(section).toContainText("title, author and ISBN");
  await expect(section).toContainText("No account, key");
  await expect(page.getByTestId("settings-online-mode-off")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("settings-online-mode-ask").click();
  await expect(page.getByTestId("settings-online-mode-ask")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("settings-online-mode-copy")).toContainText(
    "Nothing leaves the device until you press it",
  );
});

test("a per-book lookup fills a missing blurb and generated cover", async ({
  page,
}) => {
  const applied: EnrichmentOutcome = {
    state: "applied",
    source: "open_library",
    fields: ["description", "cover"],
    attribution: ATTRIBUTION,
  };
  await boot(page, [book(1, "The Dispossessed")], {
    lookup: { 1: applied },
    appliedDescription: "A quiet revolution gathers behind the palace doors.",
    appliedCoverUrl: ALT_COVER,
  });
  await openDetail(page);
  const before = await page.getByTestId("detail-cover").getAttribute("src");
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "No blurb was printed",
  );

  await openBookMenu(page);
  await page.getByTestId("detail-lookup").click();

  await expect(page.getByTestId("detail-blurb")).toContainText(
    "A quiet revolution gathers",
  );
  await expect(page.getByTestId("detail-attribution")).toContainText(
    "Open Library",
  );
  await expect(page.getByTestId("detail-attribution")).toContainText(
    "the blurb and the cover",
  );
  await expect(page.getByTestId("detail-attribution").getByRole("link")).toHaveAttribute(
    "href",
    "https://openlibrary.org/books/OL1M",
  );
  await expect(page.getByTestId("detail-cover")).not.toHaveAttribute(
    "src",
    before ?? "",
  );
});

test("a no-match leaves the generated plate and the honest blank blurb", async ({
  page,
}) => {
  await boot(page, [book(1, "The Dispossessed")], {
    lookup: {
      1: { state: "noMatch", source: "open_library", reason: "no_result" },
    },
  });
  await openDetail(page);
  const before = await page.getByTestId("detail-cover").getAttribute("src");

  await openBookMenu(page);
  await page.getByTestId("detail-lookup").click();

  await expect(page.getByTestId("detail-enrichment-notice")).toContainText(
    "No online match found for this edition",
  );
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "No blurb was printed with this edition.",
  );
  await expect(page.getByTestId("detail-cover")).toHaveAttribute(
    "src",
    before ?? "",
  );
  await expect(page.getByTestId("detail-attribution")).toHaveCount(0);
});

test("review lists candidate editions and applies only the chosen one", async ({
  page,
}) => {
  const review: EnrichmentOutcome = {
    state: "needsReview",
    candidates: [
      {
        key: "open_library:/books/OL1M",
        source: "open_library",
        title: "The Dispossessed",
        authors: ["Ursula K. Le Guin"],
        year: 1974,
        publisher: "Harper & Row",
        hasCover: true,
        coverDataUrl: ALT_COVER,
        sourceUrl: "https://openlibrary.org/books/OL1M",
      },
      {
        key: "open_library:/books/OL2M",
        source: "open_library",
        title: "The Dispossessed",
        authors: ["Ursula K. Le Guin"],
        year: 1975,
        publisher: "Avon",
        hasCover: true,
        coverDataUrl: ALT_COVER,
        sourceUrl: "https://openlibrary.org/books/OL2M",
      },
    ],
    attribution: ATTRIBUTION,
  };
  await boot(page, [book(1, "The Dispossessed")], {
    lookup: { 1: review },
    appliedDescription: "The chosen edition's blurb.",
  });
  await openDetail(page);
  await openBookMenu(page);
  await page.getByTestId("detail-lookup").click();

  await expect(page.getByTestId("enrichment-review")).toBeVisible();
  await expect(page.getByTestId("enrichment-candidate")).toHaveCount(2);
  await expect(page.getByTestId("enrichment-accept")).toBeDisabled();
  await page.getByTestId("enrichment-candidate").nth(1).click();
  await page.getByTestId("enrichment-accept").click();

  await expect(page.getByTestId("enrichment-review")).toHaveCount(0);
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "The chosen edition's blurb.",
  );
  await expect(page.getByTestId("detail-attribution")).toContainText(
    "Open Library",
  );
});

test("the cover chooser previews an online cover, applies it, and resets", async ({
  page,
}) => {
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
  await boot(
    page,
    [
      book(1, "The Dispossessed", {
        description: "File blurb.",
      }),
    ],
    {
      fileCoverIds: [1],
      coverCandidates: { 1: [candidate] },
    },
  );
  await openDetail(page);
  const original = await page.getByTestId("detail-cover").getAttribute("src");

  await page.getByTestId("detail-cover-button").click();
  await expect(page.getByTestId("cover-chooser")).toBeVisible();
  await expect(page.getByTestId("cover-preview")).toBeVisible();
  // Opening the sheet makes no request and shows no online candidate yet.
  await expect(page.getByTestId("cover-find")).toBeVisible();

  await page.getByTestId("cover-find").click();
  await expect(page.getByTestId("cover-option-online-open-library-id-123")).toBeVisible();
  await page
    .getByTestId("cover-option-online-open-library-id-123")
    .click();
  await page.getByTestId("cover-use").click();

  await expect(page.getByTestId("cover-chooser")).toHaveCount(0);
  await expect(page.getByTestId("detail-cover")).not.toHaveAttribute(
    "src",
    original ?? "",
  );
  await expect(page.getByTestId("detail-attribution")).toContainText(
    "Open Library",
  );

  await page.getByTestId("detail-cover-button").click();
  await page.getByTestId("cover-reset").click();
  await expect(page.getByTestId("cover-chooser")).toHaveCount(0);
  await expect(page.getByTestId("detail-cover")).toHaveAttribute(
    "src",
    original ?? "",
  );
  await expect(page.getByTestId("detail-attribution")).toHaveCount(0);
});

test("a device image can be previewed and applied without leaving the app", async ({
  page,
}) => {
  await boot(page, [book(1, "The Dispossessed")], {
    fileCoverIds: [1],
  });
  await openDetail(page);
  await openBookMenu(page);
  await page.getByTestId("detail-change-cover").click();
  await expect(page.getByTestId("cover-chooser")).toBeVisible();

  await page.getByTestId("cover-device").click();
  await expect(
    page.getByTestId("cover-option-device-device-1-1"),
  ).toBeVisible();
  await page.getByTestId("cover-use").click();

  await expect(page.getByTestId("cover-chooser")).toHaveCount(0);
  await expect(page.getByTestId("detail-manual-provenance")).toContainText(
    "Cover chosen by you",
  );
});

test("automatic mode looks up a gap when the Flip opens", async ({ page }) => {
  await boot(page, [book(1, "The Dispossessed")], {
    mode: "automatic",
    lookup: {
      1: {
        state: "applied",
        source: "open_library",
        fields: ["description"],
        attribution: { ...ATTRIBUTION, fields: ["description"] },
      },
    },
    appliedDescription: "Added automatically for a gap.",
  });
  await openDetail(page);

  await expect(page.getByTestId("detail-blurb")).toContainText(
    "Added automatically for a gap.",
  );
  await expect(page.getByTestId("detail-attribution")).toContainText(
    "the blurb",
  );
});

test("the foreground queue is capped, reported, and can be filled", async ({
  page,
}) => {
  const applied = (id: number): EnrichmentOutcome => ({
    state: "applied",
    source: "open_library",
    fields: ["description", "cover"],
    attribution: ATTRIBUTION,
  });
  await boot(
    page,
    [book(1, "A Gap"), book(2, "Another Gap")],
    {
      lookup: { 1: applied(1), 2: applied(2) },
      appliedDescription: "Filled in a foreground batch.",
    },
  );
  await openSettings(page);
  await expect(page.getByTestId("settings-online-queue")).toContainText(
    "2 books are missing",
  );
  await expect(page.getByTestId("settings-online-fill")).toContainText(
    "Fill missing details… (2)",
  );

  await page.getByTestId("settings-online-fill").click();
  await expect(page.getByTestId("settings-online-notice")).toContainText(
    "Finished 2 books; 2 were filled",
  );
  await expect(page.getByTestId("settings-online-queue")).toContainText(
    "No book is missing",
  );
});

test("a blurb edited by the reader survives a refresh", async ({ page }) => {
  await boot(page, [book(1, "The Dispossessed")], {
    lookup: {
      1: {
        state: "applied",
        source: "open_library",
        fields: ["description"],
        attribution: { ...ATTRIBUTION, fields: ["description"] },
      },
    },
    appliedDescription: "A catalogue blurb.",
  });
  await openDetail(page);
  await openBookMenu(page);
  await page.getByTestId("detail-lookup").click();
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "A catalogue blurb.",
  );

  await openBookMenu(page);
  await page.getByTestId("detail-edit-blurb").click();
  await page.getByTestId("blurb-text").fill("My own note about this edition.");
  await page.getByTestId("blurb-save").click();
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "My own note about this edition.",
  );
  await expect(page.getByTestId("detail-manual-provenance")).toContainText(
    "Blurb edited by you",
  );

  await openBookMenu(page);
  await page.getByTestId("detail-lookup").click();
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "My own note about this edition.",
  );
});

test("revert removes online details and restores the file's blank", async ({
  page,
}) => {
  await boot(page, [book(1, "The Dispossessed")], {
    mode: "automatic",
    lookup: {
      1: {
        state: "applied",
        source: "open_library",
        fields: ["description", "cover"],
        attribution: ATTRIBUTION,
      },
    },
    appliedDescription: "Temporary online blurb.",
    appliedCoverUrl: ALT_COVER,
  });
  await openDetail(page);
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "Temporary online blurb.",
  );

  await openBookMenu(page);
  await page.getByTestId("detail-revert").click();
  await expect(page.getByTestId("detail-blurb")).toContainText(
    "No blurb was printed with this edition.",
  );
  await expect(page.getByTestId("detail-attribution")).toHaveCount(0);
});
