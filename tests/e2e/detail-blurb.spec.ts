import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const LONG_BLURB = [
  "The first paragraph is deliberately long so that the blurb runs well past six lines at phone widths, which is the whole point of this fixture: it must not become an endless wall of text.",
  "",
  "The second paragraph continues at length, with enough ordinary prose to fill several more lines on a narrow screen. Paragraph breaks should survive both the clamped and the expanded state.",
  "",
  "The final paragraph closes the blurb and adds another handful of lines, ensuring the expanded state has materially more text than the six-line clamp.",
].join("\n");

const SHORT_BLURB = "A short blurb that comfortably fits in fewer than six lines.";

function book(id: number, description: string | null): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title: "The Dispossessed",
    authors: ["Ursula K. Le Guin"],
    series: null,
    language: null,
    description,
    publisher: null,
    publishedDate: "1974-05-01",
    identifier: null,
    pageCount: null,
    addedAt: 1_700_000_000 + id,
    shelfId: 1,
    slotIndex: id - 1,
    readingStatus: "unread",
    labels: [],
  };
}

async function boot(page: Page, books: Book[]) {
  await page.addInitScript(
    ({ nextBooks }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: nextBooks,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        enrichment: { mode: "off" },
      };
    },
    { nextBooks: books },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByTestId("spine").first().click();
  await expect(page.getByTestId("book-detail")).toBeVisible();
}

async function blurbLines(page: Page) {
  return page.getByTestId("detail-blurb").evaluate((el) => {
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      lineHeight,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      lines: el.clientHeight / lineHeight,
    };
  });
}

test("a long blurb is clamped to six lines and offers Read more", async ({
  page,
}) => {
  await boot(page, [book(1, LONG_BLURB)]);

  const toggle = page.getByTestId("blurb-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText("Read more");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "detail-blurb-text");

  const metrics = await blurbLines(page);
  expect(metrics.lines).toBeCloseTo(6, 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 1);

  // Paragraph breaks survive the clamp.
  expect(await page.getByTestId("detail-blurb").innerText()).toContain(
    "The second paragraph",
  );
});

test("Read more reveals the whole blurb and becomes Show less", async ({
  page,
}) => {
  await boot(page, [book(1, LONG_BLURB)]);
  const blurb = page.getByTestId("detail-blurb");
  const toggle = page.getByTestId("blurb-toggle");

  const collapsed = await blurbLines(page);
  await toggle.click();

  await expect(toggle).toHaveText("Show less");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("blurb-announcement")).toHaveText(
    "Blurb expanded.",
  );

  const expanded = await blurbLines(page);
  expect(expanded.lines).toBeGreaterThan(collapsed.lines + 1);
  expect(expanded.scrollHeight).toBeLessThanOrEqual(expanded.clientHeight + 1);
});

test("Show less re-clamps the blurb (keyboard activation included)", async ({
  page,
}) => {
  await boot(page, [book(1, LONG_BLURB)]);
  const toggle = page.getByTestId("blurb-toggle");

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveText("Show less");

  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveText("Read more");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  const metrics = await blurbLines(page);
  expect(metrics.lines).toBeCloseTo(6, 1);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 1);
});

test("a short blurb shows no toggle", async ({ page }) => {
  await boot(page, [book(1, SHORT_BLURB)]);

  await expect(page.getByTestId("detail-blurb")).toHaveText(SHORT_BLURB);
  await expect(page.getByTestId("blurb-toggle")).toHaveCount(0);
});

for (const width of [390, 320]) {
  test(`no horizontal overflow at ${width}px, collapsed or expanded`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page, [book(1, LONG_BLURB)]);
    const toggle = page.getByTestId("blurb-toggle");
    await expect(toggle).toBeVisible();

    for (const expanding of [false, true]) {
      if (expanding) {
        await toggle.click();
        await expect(toggle).toHaveText("Show less");
      }
      const overflow = await page.evaluate(() => {
        const blurb = document.querySelector<HTMLElement>(
          '[data-testid="detail-blurb"]',
        );
        const block = blurb?.closest<HTMLElement>(".blurb-block");
        return {
          document: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          blockScroll: block?.scrollWidth ?? 0,
          blockClient: block?.clientWidth ?? 0,
        };
      });
      expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
      expect(overflow.blockScroll).toBeLessThanOrEqual(
        overflow.blockClient + 1,
      );
    }
  });
}
