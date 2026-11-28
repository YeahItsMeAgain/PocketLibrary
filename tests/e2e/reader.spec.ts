import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

const BOOK: Book = {
  id: 1,
  contentHash: "sample-hash",
  format: "epub",
  title: "The Lamplighter's Test",
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

async function boot(
  page: Page,
  options: {
    books?: Book[];
    bookFiles?: Record<number, string>;
    settings?: Partial<typeof DEFAULT_SETTINGS>;
  } = {},
) {
  const books = options.books ?? [BOOK];
  await page.addInitScript(
    ({ books, bookFiles, settings }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books,
        bookFiles,
      };
      if (!window.localStorage.getItem("pocketlibrary.readerSettings")) {
        window.localStorage.setItem(
          "pocketlibrary.readerSettings",
          JSON.stringify(settings),
        );
      }
    },
    {
      books,
      bookFiles: options.bookFiles,
      settings: { ...DEFAULT_SETTINGS, ...options.settings },
    },
  );
}

async function openReader(page: Page) {
  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-read").click();
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
}

async function openDesk(
  page: Page,
  tab: "type" | "contents" | "marks" = "type",
) {
  await page.getByTestId("reader-pull").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  if (tab !== "type") {
    await page.getByTestId(`reader-desk-tab-${tab}`).click();
    await expect(page.getByTestId(`reader-desk-tab-${tab}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
}

async function closeDesk(page: Page) {
  await page.getByTestId("reader-desk-close").click();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
}

async function percent(page: Page): Promise<number> {
  const value = await page
    .getByTestId("reader-persistent-progress")
    .getAttribute("aria-valuenow");
  return Number(value ?? 0);
}

/** Drag on the desk with the mouse. */
async function mouseDrag(page: Page, fromY: number, distance: number, slow = false) {
  const box = await page.getByTestId("reader-desk").boundingBox();
  if (!box) throw new Error("The desk has no box");
  const x = box.x + box.width / 2;
  const y = box.y + fromY;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (slow) {
    const steps = 5;
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(x, y + (distance / steps) * step);
      await page.waitForTimeout(70);
    }
    await page.waitForTimeout(220);
  } else {
    await page.mouse.move(x, y + distance, { steps: 10 });
  }
  await page.mouse.up();
}

/** A trusted touch drag through Chromium's input pipeline. */
async function touchDrag(page: Page, x: number, y: number, distance: number) {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let step = 1; step <= 10; step += 1) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (distance / 10) * step, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("an EPUB opens, tap zones page, and the desk's Shelf returns to the shelf", async ({
  page,
}) => {
  // Loose spacing gives the sample enough pages to sit between first and last.
  await boot(page, { settings: { spacing: 2 } });
  await page.goto("/");
  await openReader(page);

  expect(await percent(page)).toBe(0);

  // The first page's left zone is a no-op.
  await page.mouse.click(40, 500);
  expect(await percent(page)).toBe(0);

  // The right third advances; the left third returns.
  await page.mouse.click(350, 500);
  await expect.poll(() => percent(page)).toBeGreaterThan(0);
  const advanced = await percent(page);
  await page.waitForTimeout(450);
  await page.mouse.click(40, 500);
  await expect.poll(() => percent(page)).toBeLessThan(advanced);

  await openDesk(page);
  await page.getByTestId("reader-shelf").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "reading",
  );
});

test("only the brass pull and the percentage open the desk", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  // The old bars are gone from the DOM entirely.
  await expect(page.locator(".reader-bar")).toHaveCount(0);
  await expect(page.locator(".reader-top")).toHaveCount(0);
  await expect(page.locator(".reader-bottom")).toHaveCount(0);
  await expect(page.getByTestId("reader-type")).toHaveCount(0);
  await expect(page.getByTestId("reader-contents")).toHaveCount(0);

  // A centre tap turns nothing on.
  await page.mouse.click(195, 420);
  await page.waitForTimeout(150);
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);

  // Two entries, nothing else.
  await expect(page.locator(".reader-dock button")).toHaveCount(2);
  await expect(page.getByTestId("reader-pull")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-percent")).toBeVisible();

  await page.getByTestId("reader-persistent-percent").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  await closeDesk(page);

  await page.getByTestId("reader-pull").click();
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  await expect(page.getByTestId("reader-pull")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("Contents lists chapters with the current one highlighted", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page, "contents");

  const chapters = page.getByTestId("reader-toc-item");
  await expect(chapters.first()).toContainText("Chapter One");
  await expect(chapters.first()).toHaveAttribute("data-current", "true");
  await expect(chapters).toHaveCount(2);

  // Jumping closes the desk and keeps the jumped-to chapter current even
  // though the closing stage reflows the book.
  await chapters.nth(1).click();
  // The jump loads the chapter section before the desk closes.
  await expect(page.getByTestId("reader-desk")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("reader")).toBeVisible();
  await openDesk(page, "contents");
  await expect(page.getByTestId("reader-toc-item").nth(1)).toHaveAttribute(
    "data-current",
    "true",
  );
});

test("browser back closes the desk, then the reader, then returns to the wall", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await openDesk(page);
  await page.goBack();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-pull")).toBeFocused();

  await openDesk(page, "marks");
  await page.goBack();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("typography, theme and scroll mode apply and are remembered", async ({
  page,
}) => {
  await boot(page, { settings: { size: 2, margin: 0 } });
  await page.goto("/");
  await openReader(page);
  await openDesk(page);

  await page.getByTestId("reader-size-down").click();
  await expect(page.getByTestId("reader-size-px")).toHaveText("17 px");
  await page.getByTestId("reader-font-literata").click();
  await page.getByTestId("reader-theme-night").click();
  await page.getByTestId("reader-mode-scrolled").click();

  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-theme",
    "night",
  );
  await expect(page.getByTestId("reader")).toHaveAttribute(
    "data-mode",
    "scrolled",
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = document.querySelector("foliate-view") as
          | (HTMLElement & {
              renderer?: {
                getContents(): Array<{ doc: Document }>;
              };
            })
          | null;
        const doc = view?.renderer?.getContents()[0]?.doc;
        if (!doc) return null;
        const style = doc.defaultView?.getComputedStyle(doc.body);
        return { size: style?.fontSize, family: style?.fontFamily };
      }),
    )
    .toMatchObject({ size: "17px" });

  const stored = await page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem("pocketlibrary.readerSettings") ?? "{}",
    ),
  );
  expect(stored).toMatchObject({
    size: 1,
    font: "literata",
    theme: "night",
    mode: "scrolled",
  });

  // Settings survive a relaunch (reload) and reach the Settings screen.
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-reader-scrolled")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("bookmarks add from Marks, survive relaunch, and remove", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await openDesk(page, "marks");
  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await closeDesk(page);

  await page.reload();
  await openReader(page);
  await expect(page.getByTestId("reader-bookmark-ribbon")).toBeVisible();

  await openDesk(page, "marks");
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await page.getByTestId("reader-bookmark-delete").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(0);
  await expect(page.getByTestId("reader-bookmark-ribbon")).toHaveCount(0);
});

test("reading position resumes after reopen", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await page.mouse.click(350, 500);
  await expect.poll(() => percent(page)).toBeGreaterThan(0);
  const saved = await percent(page);
  await page.waitForTimeout(900);

  await openDesk(page);
  await page.getByTestId("reader-shelf").click();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await openReader(page);
  await expect.poll(() => percent(page)).toBe(saved);
});

test("reaching the end marks the book finished", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  for (let turn = 0; turn < 12; turn += 1) {
    await page.mouse.click(350, 500);
    await page.waitForTimeout(120);
  }
  await expect.poll(() => percent(page)).toBeGreaterThanOrEqual(98);
  const last = await percent(page);

  // The last page's right zone is a no-op.
  await page.mouse.click(350, 500);
  expect(await percent(page)).toBe(last);

  await page.waitForTimeout(900);
  await openDesk(page);
  await page.getByTestId("reader-shelf").click();
  await expect(page.getByTestId("spine").first()).toHaveAttribute(
    "data-status",
    "finished",
  );
});

test("open in another app reports the real platform route", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);

  await page.getByTestId("reader-external").click();
  await expect(page.getByTestId("reader-external-note")).toContainText(
    "needs the Android build",
  );
});

test("the closed reader keeps the hairline and percentage, not bars", async ({
  page,
}) => {
  await boot(page, { settings: { spacing: 2 } });
  await page.goto("/");
  await openReader(page);

  await expect(page.getByTestId("reader-dock")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-progress")).toBeVisible();
  await expect(page.getByTestId("reader-persistent-percent")).toBeVisible();
  expect(await percent(page)).toBe(0);

  await page.mouse.click(350, 500);
  await expect.poll(() => percent(page)).toBeGreaterThan(0);
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
});

test("Escape and the scrim close the desk and return focus to the pull", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await openDesk(page);
  await expect(page.getByTestId("reader-desk-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader")).toBeVisible();
  await expect(page.getByTestId("reader-pull")).toBeFocused();

  await openDesk(page);
  await page.getByTestId("reader-desk-scrim").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader-pull")).toBeFocused();
});

test("a 100px drag down on the header dismisses the desk", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);
  await expect(page.getByTestId("reader-desk-hint")).not.toHaveClass(/is-gone/);

  const box = await page.getByTestId("reader-desk").boundingBox();
  if (!box) throw new Error("The desk has no box");
  const x = box.x + box.width / 2;
  const y = box.y + 22;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 100, { steps: 10 });
  // The sheet follows at 0.85x, not one-to-one.
  const transform = await page
    .getByTestId("reader-desk")
    .evaluate((element) => getComputedStyle(element).transform);
  expect(transform).toContain("85");
  await page.mouse.up();

  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect(page.getByTestId("reader-pull")).toBeFocused();

  // The hint retires for the rest of the session.
  await openDesk(page);
  await expect(page.getByTestId("reader-desk-hint")).toHaveClass(/is-gone/);
});

test("reduced motion collapses the desk animation but swipe still closes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);

  const duration = await page
    .getByTestId("reader-desk")
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001);

  await mouseDrag(page, 22, 100);
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
});

test("a 30px slow drag springs the desk back open", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);

  await mouseDrag(page, 22, 30, true);
  await expect(page.getByTestId("reader-desk")).toBeVisible();
  await page.waitForTimeout(400);
  const drag = await page
    .getByTestId("reader-desk")
    .evaluate((element) => element.style.getPropertyValue("--reader-drag"));
  expect(drag).toBe("");
});

test("a 100px touch drag down the body at its top dismisses the desk", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page, "marks");

  const body = await page.getByTestId("reader-desk-body").boundingBox();
  if (!body) throw new Error("The desk body has no box");
  expect(
    await page
      .getByTestId("reader-desk-body")
      .evaluate((element) => element.scrollTop),
  ).toBe(0);

  await touchDrag(page, body.x + 20, body.y + 6, 100);
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
});

test("dragging a scrolled desk body scrolls instead of dismissing", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);
  await page
    .getByTestId("reader-desk-body")
    .evaluate((element) => {
      element.scrollTop = 40;
    });
  await page.waitForTimeout(100);
  expect(
    await page
      .getByTestId("reader-desk-body")
      .evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  const box = await page.getByTestId("reader-desk").boundingBox();
  if (!box) throw new Error("The desk has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("reader-desk")).toBeVisible();
});

test("opening the desk reflows a paginated EPUB and preserves the position", async ({
  page,
}) => {
  await boot(page, { settings: { size: 2, spacing: 2 } });
  await page.goto("/");
  await openReader(page);
  for (let turn = 0; turn < 3; turn += 1) {
    await page.mouse.click(350, 500);
    await page.waitForTimeout(150);
  }
  const before = await percent(page);
  const stageBefore = await page
    .getByTestId("reader-stage")
    .evaluate((element) => element.getBoundingClientRect().height);

  await openDesk(page);
  await expect
    .poll(() =>
      page
        .getByTestId("reader-stage")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeLessThan(stageBefore - 200);

  await closeDesk(page);
  await expect
    .poll(() =>
      page
        .getByTestId("reader-stage")
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeCloseTo(stageBefore, 0);
  await page.waitForTimeout(400);
  expect(Math.abs((await percent(page)) - before)).toBeLessThanOrEqual(1);
});

test("the desk readout is frozen while open and restored on close", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  // The sample's second page starts a new section: this is where the reflow
  // behind the sheet used to rewrite 50% as 33%.
  await page.mouse.click(350, 500);
  await expect.poll(() => percent(page)).toBeGreaterThan(0);
  const before = await percent(page);

  await openDesk(page);
  const openPercent = await percent(page);
  const openMeta = await page.getByTestId("reader-desk-meta").textContent();
  expect(openPercent).toBe(before);
  expect(openMeta).toContain(`${before}%`);

  // Let the reflow relocations land; the readout must not move.
  await page.waitForTimeout(900);
  expect(await percent(page)).toBe(openPercent);
  expect(await page.getByTestId("reader-desk-meta").textContent()).toBe(
    openMeta,
  );

  await closeDesk(page);
  await expect.poll(() => percent(page)).toBe(before);
  await openDesk(page);
  expect(await page.getByTestId("reader-desk-meta").textContent()).toBe(
    openMeta,
  );
});

test("a Marks jump closes the desk and the readout follows it", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await openDesk(page, "marks");
  await page.getByTestId("reader-bookmark").click();
  await expect(page.getByTestId("reader-bookmark-row")).toHaveCount(1);
  await closeDesk(page);
  // The close restore settles before a page turn is accepted.
  await page.waitForTimeout(500);

  await page.mouse.click(350, 500);
  await expect.poll(() => percent(page)).toBeGreaterThan(0);

  await openDesk(page, "marks");
  await page
    .getByTestId("reader-bookmark-row")
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  await expect.poll(() => percent(page)).toBe(0);

  await openDesk(page);
  await expect(page.getByTestId("reader-desk-meta")).toContainText("0%");
});

test("opening, applying type and swiping the desk logs no errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await boot(page);
  await page.goto("/");
  await openReader(page);
  await openDesk(page);
  await page.getByTestId("reader-theme-sepia").click();
  await page.getByTestId("reader-size-down").click();
  await page.getByTestId("reader-font-source-serif").click();
  await page.getByTestId("reader-desk-tab-contents").click();
  await page.getByTestId("reader-desk-tab-type").click();
  await mouseDrag(page, 22, 100);
  await expect(page.getByTestId("reader-desk")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Escape closes the reader", async ({ page }) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
});

test("browser back closes the reader instead of leaving the app", async ({
  page,
}) => {
  await boot(page);
  await page.goto("/");
  await openReader(page);

  await page.goBack();
  await expect(page.getByTestId("reader")).toHaveCount(0);
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine").first()).toBeVisible();
});
