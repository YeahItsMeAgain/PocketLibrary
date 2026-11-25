import { expect, test } from "@playwright/test";

import {
  EMPTY_SEARCH_FORM,
  hasSearchTerm,
  searchQueryFrom,
  searchYear,
  supportedBookFormat,
} from "../../src/search/query";

test("searchYear only accepts plausible four-digit years", () => {
  expect(searchYear("1969")).toBe(1969);
  expect(searchYear("0999")).toBeNull();
  expect(searchYear("2101")).toBeNull();
  expect(searchYear("19.69")).toBeNull();
  expect(searchYear("")).toBeNull();
});

test("supportedBookFormat only admits EPUB and PDF", () => {
  expect(supportedBookFormat(" EPUB ")).toBe("epub");
  expect(supportedBookFormat("pdf")).toBe("pdf");
  expect(supportedBookFormat("mobi")).toBeNull();
  expect(supportedBookFormat("")).toBeNull();
});

test("searchQueryFrom trims fields and keeps the page", () => {
  const form = {
    ...EMPTY_SEARCH_FORM,
    query: "  Dune  ",
    author: " Frank Herbert ",
    yearFrom: "1960",
    yearTo: "1970",
    format: " EPUB ",
  };
  expect(searchQueryFrom(form, 3)).toEqual({
    query: "Dune",
    title: "",
    author: "Frank Herbert",
    yearFrom: 1960,
    yearTo: 1970,
    language: "",
    format: "epub",
    publisher: "",
    isbn: "",
    md5: "",
    page: 3,
  });
});

test("hasSearchTerm ignores blank fields and rejects pure filters", () => {
  expect(hasSearchTerm(EMPTY_SEARCH_FORM)).toBe(false);
  expect(
    hasSearchTerm({ ...EMPTY_SEARCH_FORM, format: "epub", yearFrom: "2000" }),
  ).toBe(false);
  expect(hasSearchTerm({ ...EMPTY_SEARCH_FORM, isbn: "9780" })).toBe(true);
});
