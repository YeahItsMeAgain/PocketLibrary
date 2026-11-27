import type { BookDetail, SpineStyle } from "../../platform";
import { SpineStudio } from "../SpineStudio";
import { Section } from "./Section";

interface SpineSectionProps {
  title: string;
  bookId: number;
  detail: BookDetail;
  spineStyle: SpineStyle;
  onStyleChange: (next: SpineStyle, previous: SpineStyle) => void;
}

export function SpineSection({
  title,
  bookId,
  detail,
  spineStyle,
  onStyleChange,
}: SpineSectionProps) {
  return (
    <Section id="spine" title={title}>
      <SpineStudio
        bookId={bookId}
        title={detail.title}
        author={detail.authors.join(" · ")}
        pages={detail.pageCount}
        coverDataUrl={detail.coverDataUrl}
        initialStyle={detail.spineStyle}
        style={spineStyle}
        onStyleChange={onStyleChange}
      />
    </Section>
  );
}
