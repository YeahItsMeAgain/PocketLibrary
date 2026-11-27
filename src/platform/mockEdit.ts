/**
 * Core-field edits for the browser mock.
 *
 * Kept out of `mock.ts` so the large mock module does not grow; the rules
 * mirror `core/src/service/edit.rs` and its error codes.
 */
import type { Book, BookDetail, BookEdit, BookEnrichmentState } from "./types";

const MAX_TITLE_LENGTH = 500;

export function editMockBook(
  bookId: number,
  changes: BookEdit,
  books: Book[],
  coverDataByBook: Map<number, string>,
  enrichmentFor: (book: Book) => BookEnrichmentState,
  hasGap: (book: Book, state: BookEnrichmentState) => boolean,
  fallbackCover: string,
): BookDetail {
  const book = books.find((candidate) => candidate.id === bookId);
  if (!book) {
    throw { code: "book_not_found", message: "That book could not be found." };
  }

  if (changes.title !== undefined) {
    const title = changes.title.trim();
    if (!title || [...title].length > MAX_TITLE_LENGTH) {
      throw {
        code: "invalid_title",
        message: "A book needs a title of 500 characters or fewer.",
      };
    }
    book.title = title;
  }

  if (changes.authors !== undefined) {
    book.authors = changes.authors
      .map((author) => author.trim())
      .filter((author) => author.length > 0);
  }

  if ("pageCount" in changes) {
    const pageCount = changes.pageCount ?? null;
    if (
      pageCount !== null &&
      (!Number.isInteger(pageCount) || pageCount <= 0)
    ) {
      throw {
        code: "invalid_page_count",
        message: "Page count must be greater than zero.",
      };
    }
    book.pageCount = pageCount;
  }

  const state = enrichmentFor(book);
  return {
    ...book,
    coverDataUrl: coverDataByBook.get(bookId) ?? fallbackCover,
    enrichment: { ...state, hasGap: hasGap(book, state) },
  };
}
