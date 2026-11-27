import { useCallback } from "react";

import { platform, type BookDetail } from "../../platform";
import { AutoSaveField } from "./AutoSaveField";
import { Section } from "./Section";
import type { BookPatch } from "./types";

interface DetailsSectionProps {
  title: string;
  bookId: number;
  detail: BookDetail;
  applyDetail: (next: BookDetail) => void;
  onBookChanged: (patch: BookPatch) => void;
}

export function DetailsSection({
  title,
  bookId,
  detail,
  applyDetail,
  onBookChanged,
}: DetailsSectionProps) {
  const saveTitle = useCallback(
    async (raw: string) => {
      const next = await platform.editBook(bookId, { title: raw });
      applyDetail(next);
      onBookChanged({
        id: bookId,
        title: next.title,
        authors: next.authors,
        pageCount: next.pageCount,
        spineStyle: next.spineStyle,
      });
    },
    [bookId, applyDetail, onBookChanged],
  );

  const saveAuthors = useCallback(
    async (raw: string) => {
      const authors = raw
        .split(",")
        .map((author) => author.trim())
        .filter(Boolean);
      const next = await platform.editBook(bookId, { authors });
      applyDetail(next);
      onBookChanged({
        id: bookId,
        title: next.title,
        authors: next.authors,
        pageCount: next.pageCount,
        spineStyle: next.spineStyle,
      });
    },
    [bookId, applyDetail, onBookChanged],
  );

  const savePageCount = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      const pageCount = trimmed === "" ? null : Number(trimmed);
      const next = await platform.editBook(bookId, { pageCount });
      applyDetail(next);
      onBookChanged({
        id: bookId,
        title: next.title,
        authors: next.authors,
        pageCount: next.pageCount,
        spineStyle: next.spineStyle,
      });
    },
    [bookId, applyDetail, onBookChanged],
  );

  const saveBlurb = useCallback(
    async (raw: string) => {
      await platform.editBlurb(bookId, raw.trim() ? raw : null);
      const next = await platform.getBookDetail(bookId);
      applyDetail(next);
    },
    [bookId, applyDetail],
  );

  return (
    <Section id="details" title={title}>
      <AutoSaveField
        id="edit-title-field"
        name="title"
        label="Title"
        initial={detail.title}
        maxLength={500}
        save={saveTitle}
        validate={(raw) => (raw.trim() ? null : "A book needs a title.")}
      />
      <AutoSaveField
        id="edit-authors-field"
        name="authors"
        label="Authors"
        initial={detail.authors.join(", ")}
        hint="Separate multiple authors with commas."
        save={saveAuthors}
      />
      <AutoSaveField
        id="edit-pages-field"
        name="pages"
        label="Page count"
        initial={detail.pageCount?.toString() ?? ""}
        inputMode="numeric"
        save={savePageCount}
        validate={(raw) => {
          const trimmed = raw.trim();
          if (trimmed === "") return null;
          if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
            return "Page count must be a whole number greater than zero.";
          }
          return null;
        }}
      />
      <AutoSaveField
        id="edit-blurb-field"
        name="blurb"
        label="Blurb"
        initial={detail.description ?? ""}
        multiline
        maxLength={4000}
        save={saveBlurb}
        hint="Leave empty to clear the blurb."
      />
    </Section>
  );
}
