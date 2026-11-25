import { expect, test } from "@playwright/test";

import type { Book, Shelf } from "../../src/platform";
import { moveBookInList, orderBookList } from "../../src/library/placement";

function book(id: number, shelfId: number | null, slotIndex: number | null): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title: `Book ${id}`,
    authors: [],
    series: null,
    language: null,
    description: null,
    publisher: null,
    publishedDate: null,
    identifier: null,
    pageCount: null,
    addedAt: 1_700_000_000,
    shelfId,
    slotIndex,
    readingStatus: "unread",
    labels: [],
  };
}

const shelves: Shelf[] = [
  { id: 10, ordinal: 0, capacity: 6 },
  { id: 20, ordinal: 1, capacity: 6 },
];

function placement(books: Book[]) {
  return books.map((entry) => [entry.id, entry.shelfId, entry.slotIndex]);
}

test("orderBookList orders by shelf ordinal, then slot, then id", () => {
  const ordered = orderBookList(
    [
      book(4, null, null),
      book(3, 20, 0),
      book(2, 10, 1),
      book(1, 10, 0),
      book(5, 10, 1),
    ],
    shelves,
  );
  expect(placement(ordered)).toEqual([
    [1, 10, 0],
    [2, 10, 1],
    [5, 10, 1],
    [3, 20, 0],
    [4, null, null],
  ]);
});

test("moveBookInList reorders within a shelf and rewrites every slot", () => {
  const moved = moveBookInList(
    [book(1, 10, 0), book(2, 10, 1), book(3, 10, 2)],
    shelves,
    3,
    10,
    0,
  );
  expect(placement(moved)).toEqual([
    [3, 10, 0],
    [1, 10, 1],
    [2, 10, 2],
  ]);
});

test("moveBookInList moves across shelves and compacts the source", () => {
  const moved = moveBookInList(
    [book(1, 10, 0), book(2, 10, 1), book(3, 10, 2), book(4, 20, 0)],
    shelves,
    2,
    20,
    1,
  );
  expect(placement(moved)).toEqual([
    [1, 10, 0],
    [3, 10, 1],
    [4, 20, 0],
    [2, 20, 1],
  ]);
});
