import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import type { Book } from "../../src/platform";

// The production bundle, like the perf benchmark: the dev server injects React
// Refresh and leaves modules unbundled, which would make the frame budget
// meaningless.
test.use({ baseURL: "http://localhost:1421" });

const cover = `data:image/jpeg;base64,${readFileSync(
  new URL("../../test-assets/cover.jpg", import.meta.url),
).toString("base64")}`;

const LONG_BLURB =
  "The house remembers every hand that ever turned its key. In the winter of " +
  "the long silence a cartographer returns to the valley with a map that " +
  "should not exist, and the archive begins to rearrange itself around her. " +
  "What follows is a slow argument between memory and evidence, conducted in " +
  "margins. She finds a ledger in her mother's hand, a catalogue of doors " +
  "that open only once, and a room whose walls are lined with the faces of " +
  "everyone who has ever left. To read it is to be read. To close it is to be " +
  "catalogued.";

const BOOK: Book = {
  id: 1,
  contentHash: "detail-open-perf",
  format: "epub",
  title: "The Ledger of Small Doors",
  authors: ["Ada Lovelace", "Bram Vale"],
  series: "The Crown Papers",
  language: "en",
  description: LONG_BLURB,
  publisher: "Harrow & Row",
  publishedDate: "1974-05-01",
  identifier: "9780000000001",
  pageCount: 428,
  addedAt: 1_700_000_000,
  shelfId: 1,
  slotIndex: 0,
  readingStatus: "reading",
  labels: [],
};

interface OpenMetrics {
  clickToContentMs: number;
  longestTaskMs: number;
  longTasksOver50: number;
  droppedOver33: number;
  frames: number[];
}

async function measureOpen(page: Page): Promise<OpenMetrics> {
  return page.evaluate<OpenMetrics>(async () => {
    const longTasks: number[] = [];
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask" });
    } catch {
      // Older Chromium: the latency budget still stands.
    }

    const titleText = () =>
      document
        .querySelector('[data-testid="detail-title"]')
        ?.textContent?.trim() ?? "";

    const start = performance.now();
    const frames: number[] = [];
    let firstContent = 0;
    let last = start;
    (
      document.querySelector('[data-testid="spine"]') as HTMLElement
    ).click();

    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frames.push(+(now - last).toFixed(1));
        last = now;
        const text = titleText();
        if (!firstContent && text && text !== "Opening…") firstContent = now;
        if (now - start < 700) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    observer?.disconnect();

    return {
      clickToContentMs: +(firstContent - start).toFixed(1),
      longestTaskMs: longTasks.length ? +Math.max(...longTasks).toFixed(1) : 0,
      longTasksOver50: longTasks.filter((duration) => duration > 50).length,
      droppedOver33: frames.filter((delta) => delta > 33).length,
      frames,
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

test("opening a volume stays inside the phone open budget", async ({
  page,
  context,
}) => {
  await page.addInitScript(
    ({ book, coverDataUrl }) => {
      window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: [book],
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        // A cached strip must not be needed for the read view to open fast.
        spine: { queueStartPaused: true },
        coverDataUrl,
      };
    },
    { book: BOOK, coverDataUrl: cover },
  );

  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("spine")).toHaveCount(1);

  // The wall idle-prefetches the detail chunk; let that settle so this measures
  // the open, not a cold module fetch that CI's local server would hide.
  await page.waitForTimeout(400);

  const client = await context.newCDPSession(page);
  await client
    .send("Emulation.setCPUThrottlingRate", { rate: 4 })
    .catch(() => {});

  // Three opens, median each metric: one GC pause or a noisy CI neighbour
  // cannot turn the budget red.
  const runs: OpenMetrics[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    runs.push(await measureOpen(page));
    // The real content is present and interactive by the end of the window.
    await expect(page.getByTestId("detail-title")).toHaveText(
      "The Ledger of Small Doors",
    );
    await expect(page.getByTestId("detail-blurb")).toContainText(
      "The house remembers",
    );
    await expect(page.getByTestId("detail-read")).toBeVisible();
    await page.getByTestId("detail-back").click();
    await expect(page.getByTestId("book-detail")).toHaveCount(0);
    await page.waitForTimeout(120);
  }

  const metrics = {
    clickToContentMs: median(runs.map((run) => run.clickToContentMs)),
    longestTaskMs: median(runs.map((run) => run.longestTaskMs)),
    longTasksOver50: median(runs.map((run) => run.longTasksOver50)),
    droppedOver33: median(runs.map((run) => run.droppedOver33)),
  };
  const summary = `runs: ${JSON.stringify(runs)}; medians: ${JSON.stringify(metrics)}`;

  // The entrance may translate and fade, but never scale: scaling a tall,
  // content-filled layer forces a re-raster every frame on a phone.
  const animationCss = await page.evaluate(() => {
    const rules: string[] = [];
    for (const sheet of document.styleSheets) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of cssRules) {
        if (rule.cssText.includes("@keyframes detail-in")) {
          rules.push(rule.cssText);
        }
      }
    }
    return rules.join("\n");
  });
  expect(animationCss, "detail-in keyframes not found").not.toBe("");
  expect(animationCss).not.toContain("scale(");

  // Budgets are deliberately loose for CI noise, but the old lazy+Suspense
  // retry (≈600 ms at 4x on this phone viewport) and the scale animation both
  // miss them. See perf/detail-open.mjs for the full benchmark.
  expect(metrics.clickToContentMs, summary).toBeLessThan(500);
  expect(metrics.longestTaskMs, summary).toBeLessThan(250);
  expect(metrics.droppedOver33, summary).toBeLessThanOrEqual(5);
});
