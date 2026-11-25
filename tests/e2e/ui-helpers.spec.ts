import { expect, test } from "@playwright/test";

import type { Book, Download } from "../../src/platform";
import { downloadPercent, downloadStatusText } from "../../src/downloads/format";
import { shelfMark, spineStyle } from "../../src/library/spine";

function book(id: number, overrides: Partial<Book> = {}): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title: `Book ${id}`,
    authors: ["Ursula K. Le Guin"],
    series: null,
    language: null,
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
    ...overrides,
  };
}

function download(overrides: Partial<Download> = {}): Download {
  return {
    id: 1,
    md5: "md5",
    title: "A Wizard of Earthsea",
    authors: ["Ursula K. Le Guin"],
    year: 1968,
    format: "epub",
    source: "libgen.li",
    mirrorUrls: [],
    state: "queued",
    mirror: null,
    bytes: 0,
    totalBytes: null,
    error: null,
    errorCode: null,
    bookId: null,
    filename: null,
    createdAt: 1,
    finishedAt: null,
    ...overrides,
  };
}

test("shelfMark uses Roman numerals and falls back past twelve", () => {
  expect(shelfMark(0)).toBe("I");
  expect(shelfMark(11)).toBe("XII");
  expect(shelfMark(12)).toBe("13");
});

test("spineStyle is deterministic and only depends on the book", () => {
  const first = book(1);
  expect(spineStyle(first)).toEqual(spineStyle({ ...first }));
  expect(spineStyle(book(2, { contentHash: "other" }))).not.toEqual(
    spineStyle(first),
  );
});

test("downloadPercent clamps progress and completes at 100", () => {
  expect(downloadPercent(download({ state: "completed" }))).toBe(100);
  expect(downloadPercent(download({ state: "running", bytes: 50, totalBytes: 200 }))).toBe(25);
  expect(downloadPercent(download({ state: "running", bytes: 300, totalBytes: 200 }))).toBe(100);
  expect(downloadPercent(download({ state: "running", bytes: 1, totalBytes: null }))).toBe(0);
});

test("downloadStatusText names each state without inventing success", () => {
  expect(downloadStatusText(download({ state: "queued" }))).toBe("Queued");
  expect(downloadStatusText(download({ state: "running", bytes: 1, totalBytes: 4 }))).toBe(
    "Downloading 25%",
  );
  expect(downloadStatusText(download({ state: "completed" }))).toBe(
    "Added to library",
  );
  expect(
    downloadStatusText(download({ state: "completed", errorCode: "duplicate" })),
  ).toBe("Already in your library");
  expect(downloadStatusText(download({ state: "failed", error: "Truncated" }))).toBe(
    "Truncated",
  );
  expect(downloadStatusText(download({ state: "cancelled" }))).toBe("Cancelled");
});
