import type { Book, Shelf } from "../platform";

export function orderBookList(books: Book[], shelves: Shelf[]): Book[] {
  const rank = new Map(shelves.map((shelf, index) => [shelf.id, index]));
  return [...books].sort((left, right) => {
    const leftRank =
      left.shelfId === null
        ? Number.MAX_SAFE_INTEGER
        : rank.get(left.shelfId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      right.shelfId === null
        ? Number.MAX_SAFE_INTEGER
        : rank.get(right.shelfId) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const slot = (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
    return slot !== 0 ? slot : left.id - right.id;
  });
}

export function moveBookInList(
  books: Book[],
  shelves: Shelf[],
  bookId: number,
  targetShelfId: number,
  targetIndex: number,
): Book[] {
  const moving = books.find((book) => book.id === bookId);
  if (!moving || moving.shelfId === null) return books;
  const sourceShelfId = moving.shelfId;
  const sameShelf = sourceShelfId === targetShelfId;
  const bySlot = (left: Book, right: Book) =>
    (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
  const sourceBooks = books
    .filter((book) => book.shelfId === sourceShelfId)
    .sort(bySlot);
  const targetBooks = (
    sameShelf
      ? sourceBooks.filter((book) => book.id !== bookId)
      : books
          .filter((book) => book.shelfId === targetShelfId)
          .sort(bySlot)
  ).slice();
  const index = Math.max(0, Math.min(targetBooks.length, targetIndex));
  targetBooks.splice(index, 0, moving);

  const placements = new Map<
    number,
    { shelfId: number; slotIndex: number }
  >();
  targetBooks.forEach((book, slot) =>
    placements.set(book.id, { shelfId: targetShelfId, slotIndex: slot }),
  );
  if (!sameShelf) {
    sourceBooks
      .filter((book) => book.id !== bookId)
      .forEach((book, slot) =>
        placements.set(book.id, { shelfId: sourceShelfId, slotIndex: slot }),
      );
  }
  const updated = books.map((book) => {
    const placement = placements.get(book.id);
    return placement ? { ...book, ...placement } : book;
  });
  return orderBookList(updated, shelves);
}
