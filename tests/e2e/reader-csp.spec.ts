import { expect, test } from "@playwright/test";

import type { Book } from "../../src/platform";

test.use({ baseURL: "http://localhost:1421" });

const BOOK: Book = {
  id: 7,
  contentHash: "scripted-hash",
  format: "epub",
  title: "Scripted Test",
  authors: [],
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

test("the built app ships a strict CSP and a scripted EPUB cannot reach the app origin", async ({
  page,
}) => {
  await page.addInitScript((book) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [book],
      bookFiles: { 7: "/test-assets/scripted.epub" },
    };
  }, BOOK);
  await page.goto("/");

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 15_000,
  });

  // Give the inline <script> and <img onerror> inside the book iframe a chance
  // to run; the strict policy must block both.
  await page.waitForTimeout(800);
  const pwned = await page.evaluate(() => ({
    pwned: (window as unknown as { __PWNED?: string }).__PWNED ?? null,
    detail:
      (window as unknown as { __PWNED_DETAIL?: string }).__PWNED_DETAIL ?? null,
  }));
  expect(pwned).toEqual({ pwned: null, detail: null });

  // The book still renders normally under the policy.
  await page.mouse.click(195, 420);
  await expect(page.getByTestId("reader-progress")).toBeVisible();
});
