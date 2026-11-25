import type { ApiError, BookFormat, SearchQuery } from "../platform";

export interface SearchForm {
  query: string;
  title: string;
  author: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  format: string;
  publisher: string;
  isbn: string;
  md5: string;
}

export const EMPTY_SEARCH_FORM: SearchForm = {
  query: "",
  title: "",
  author: "",
  yearFrom: "",
  yearTo: "",
  language: "",
  format: "",
  publisher: "",
  isbn: "",
  md5: "",
};

export const SEARCH_LANGUAGES = [
  "English",
  "French",
  "German",
  "Spanish",
  "Italian",
  "Russian",
  "Portuguese",
] as const;

export const SEARCH_FORMATS = ["epub", "pdf"] as const;

/** Pocket Library can only open EPUB and PDF; never coerce another format. */
export function supportedBookFormat(extension: string): BookFormat | null {
  const value = extension.trim().toLowerCase();
  return value === "epub" || value === "pdf" ? value : null;
}

export function searchYear(value: string): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : null;
}

export function searchQueryFrom(form: SearchForm, page: number): SearchQuery {
  return {
    query: form.query.trim(),
    title: form.title.trim(),
    author: form.author.trim(),
    yearFrom: searchYear(form.yearFrom),
    yearTo: searchYear(form.yearTo),
    language: form.language.trim(),
    format: form.format.trim().toLowerCase(),
    publisher: form.publisher.trim(),
    isbn: form.isbn.trim(),
    md5: form.md5.trim(),
    page,
  };
}

export function hasSearchTerm(form: SearchForm): boolean {
  return [form.query, form.title, form.author, form.publisher, form.isbn, form.md5]
    .map((value) => value.trim())
    .some(Boolean);
}

export function searchErrorCopy(error: ApiError): { title: string; body: string } {
  switch (error.code) {
    case "offline":
      return {
        title: "The desk is offline",
        body:
          "Libgen search needs a connection. Your shelves, books and reading progress are unaffected.",
      };
    case "all_mirrors_failed":
      return {
        title: "Every mirror refused",
        body:
          "All five Libgen mirrors timed out or refused the request. Wait a moment, then try again.",
      };
    case "mirror_format_changed":
      return {
        title: "The mirror's page changed",
        body:
          "A mirror answered, but its results could not be read. Try another search, or try again later.",
      };
    case "empty_search":
      return {
        title: "Nothing to search for",
        body: "Enter a title, author, ISBN or MD5 first.",
      };
    default:
      return {
        title: "The front desk could not answer",
        body: error.message,
      };
  }
}

