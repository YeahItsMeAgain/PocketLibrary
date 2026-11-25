import type { Book, ReadingStatus } from "../platform";

/**
 * Books that stay lit under the current filter. Filtering is a pure data pass:
 * the wall never re-renders, and only mounted spines receive a `data-dimmed`
 * attribute.
 */
export function matchingBookIds(
  books: Book[],
  selected: number[],
  status: ReadingStatus | null,
): Set<number> {
  const matching = new Set<number>();
  if (selected.length === 0 && status === null) return matching;
  for (const book of books) {
    const worn = book.labels ?? [];
    if (
      selected.every((labelId) =>
        worn.some((label) => label.id === labelId),
      ) &&
      (status === null || book.readingStatus === status)
    ) {
      matching.add(book.id);
    }
  }
  return matching;
}

export function matchesBook(
  book: Book,
  selected: number[],
  status: ReadingStatus | null,
): boolean {
  if (selected.length === 0 && status === null) return true;
  const worn = book.labels ?? [];
  return (
    selected.every((labelId) => worn.some((label) => label.id === labelId)) &&
    (status === null || book.readingStatus === status)
  );
}
