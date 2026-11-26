import { expect, test } from "@playwright/test";

import {
  MAX_HIGHLIGHT_LENGTH,
  RELEASE_NOTES_FALLBACK,
  extractHighlights,
  parseReleaseNotes,
} from "../../src/updates/updateNotes";

test("release notes parse headings, paragraphs and wrapped bullets", () => {
  const blocks = parseReleaseNotes(
    "# PocketLibrary 0.2.0\n\n" +
      "A **quick** opening paragraph.\n\n" +
      "## Highlights\n\n" +
      "- **First** item\n" +
      "- Second `code` item\n" +
      "  continued on the next line\n",
  );

  expect(blocks).toEqual([
    { type: "heading", level: 1, text: "PocketLibrary 0.2.0" },
    { type: "paragraph", text: "A quick opening paragraph." },
    { type: "heading", level: 2, text: "Highlights" },
    {
      type: "list",
      items: ["First item", "Second code item continued on the next line"],
    },
  ]);
});

test("highlights come from the first bullet list with markers stripped", () => {
  const notes =
    "## Highlights\n\n" +
    "- **“MAN” is repaired on launch.** Existing libraries fix themselves.\n" +
    "- *PDF covers* skip the title page.\n" +
    "- **Delete book** is now offered.\n" +
    "- A fourth item is not announced in the banner.\n";

  expect(extractHighlights(notes)).toEqual([
    "“MAN” is repaired on launch. Existing libraries fix themselves.",
    "PDF covers skip the title page.",
    "Delete book is now offered.",
  ]);
});

test("long paragraphs truncate at a word boundary", () => {
  const notes = "Alpha beta gamma delta ".repeat(20).trim();
  const [highlight] = extractHighlights(notes);

  expect(highlight.endsWith("…")).toBe(true);
  expect(highlight.length).toBeLessThanOrEqual(MAX_HIGHLIGHT_LENGTH + 1);
  const stem = highlight.slice(0, -1);
  expect(notes.startsWith(stem)).toBe(true);
  expect(notes[stem.length]).toBe(" ");
});

test("notes with no usable prose fall back to the Settings sentence", () => {
  expect(extractHighlights("")).toEqual([RELEASE_NOTES_FALLBACK]);
  expect(extractHighlights(null)).toEqual([RELEASE_NOTES_FALLBACK]);
  expect(extractHighlights("## Highlights\n\n### Only headings")).toEqual([
    RELEASE_NOTES_FALLBACK,
  ]);
});

test("older plain-text notes still produce a readable paragraph", () => {
  const notes = "Fixes shelf placement.\nFaster imports.";
  expect(parseReleaseNotes(notes)).toEqual([
    { type: "paragraph", text: "Fixes shelf placement. Faster imports." },
  ]);
  expect(extractHighlights(notes)).toEqual([
    "Fixes shelf placement. Faster imports.",
  ]);
});
