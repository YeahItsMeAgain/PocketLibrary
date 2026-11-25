import { expect, test } from "@playwright/test";

import type { LibgenResult } from "../../src/platform";

function result(index: number, overrides: Partial<LibgenResult> = {}): LibgenResult {
  return {
    md5: `md5${String(index).padStart(29, "0")}`,
    title: `A Victorian Book ${index}`,
    authors: ["Ada Author"],
    publisher: "Brass & Co.",
    year: 2021,
    language: "English",
    pages: 200,
    sizeText: "3 MB",
    sizeBytes: 3_000_000,
    extension: "epub",
    fileId: 1000 + index,
    source: "libgen.li",
    mirrors: [{ label: "libgen.li", url: `https://libgen.li/ads.php?md5=md5${index}` }],
    ...overrides,
  };
}

async function boot(
  page: import("@playwright/test").Page,
  config: Record<string, unknown> = {},
) {
  await page.addInitScript((mock) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      ...mock,
    };
  }, config);
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("search-view")).toBeVisible();
}

test("basic search lists results with honest counts and a read-only detail", async ({
  page,
}) => {
  await boot(page);

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(4);
  await expect(page.getByTestId("search-counts")).toContainText("4");
  await expect(page.getByTestId("search-counts")).toContainText("libgen.li");
  await expect(page.getByTestId("search-result").first()).toContainText(
    "Rock Paper Scissors",
  );
  await expect(page.getByTestId("search-result").first()).toContainText("EPUB");
  await expect(page.getByTestId("search-result").first()).toContainText("3 MB");

  await page.getByTestId("search-result").first().click();
  const sheet = page.getByTestId("result-detail");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Alice Feeney");
  await expect(sheet).toContainText("HarperCollins Publishers");
  await expect(sheet).toContainText("a1423442916f2f3def9517a3bf4dee48");
  await expect(page.getByTestId("mirror-row")).toHaveCount(3);
  const download = page.getByTestId("result-download");
  await expect(download).toBeDisabled();
  await expect(download).toContainText("ticket 11");

  await page.getByTestId("result-detail-close").click();
  await expect(sheet).toHaveCount(0);
});

test("advanced fields filter client-side and report what was hidden", async ({
  page,
}) => {
  await boot(page);

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-advanced-toggle").click();
  await page.getByTestId("search-year-from").fill("2021");
  await page.getByTestId("search-year-to").fill("2021");
  await page.getByTestId("search-format").selectOption("pdf");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(1);
  await expect(page.getByTestId("search-result")).toContainText("PDF");
  await expect(page.getByTestId("search-counts")).toContainText(
    "hidden by your filters",
  );
});

test("paging reports 25 at a time and stops at the honest total", async ({
  page,
}) => {
  const rows = Array.from({ length: 30 }, (_, index) => result(index));
  await boot(page, { searchResults: rows, searchTotal: 30 });

  await page.getByTestId("search-query").fill("Victorian");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-result")).toHaveCount(25);
  await expect(page.getByTestId("search-page")).toHaveText("Page 1");
  await expect(page.getByTestId("search-next")).toBeEnabled();
  await page.getByTestId("search-next").click();

  await expect(page.getByTestId("search-page")).toHaveText("Page 2");
  await expect(page.getByTestId("search-result")).toHaveCount(5);
  await expect(page.getByTestId("search-next")).toBeDisabled();
  await expect(page.getByTestId("search-prev")).toBeEnabled();
  await page.getByTestId("search-prev").click();
  await expect(page.getByTestId("search-page")).toHaveText("Page 1");
});

test("a genuine no-results answer is shown as such", async ({ page }) => {
  await boot(page, { searchMode: "empty" });

  await page.getByTestId("search-query").fill("nothing at all");
  await page.getByTestId("search-submit").click();

  await expect(page.getByTestId("search-empty")).toContainText("No files found");
  await expect(page.getByTestId("search-error")).toHaveCount(0);
});

test("offline and all-mirrors-failed are distinct, retryable states", async ({
  page,
}) => {
  await boot(page, { searchMode: "offline" });

  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("search-error")).toContainText(
    "The desk is offline",
  );
  await expect(page.getByTestId("search-retry")).toBeVisible();

  await page.addInitScript(() => {
    (window as unknown as { __POCKETLIBRARY_MOCK__: unknown }).__POCKETLIBRARY_MOCK__ =
      { state: "ready", folderName: "PocketLibrary", books: [], searchMode: "allFailed" };
  });
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("search-error")).toContainText(
    "Every mirror refused",
  );
});

test("back returns to the wall", async ({ page }) => {
  await boot(page);
  await page.getByTestId("search-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("search-view")).toHaveCount(0);
});
