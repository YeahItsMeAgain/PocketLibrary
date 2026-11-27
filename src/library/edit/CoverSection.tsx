import type { BookDetail } from "../../platform";
import { Section } from "./Section";

interface CoverSectionProps {
  title: string;
  detail: BookDetail;
  onOpenCover: () => void;
}

export function CoverSection({
  title,
  detail,
  onOpenCover,
}: CoverSectionProps) {
  return (
    <Section id="cover" title={title}>
      <div className="edit-cover-row">
        <div className="edit-cover-art">
          {detail.coverDataUrl ? (
            <img src={detail.coverDataUrl} alt={`Cover of ${detail.title}`} />
          ) : (
            <div className="cover" aria-hidden="true">
              <span className="cov-frame" />
              <span className="cov-title">{detail.title}</span>
              <span className="cov-orn">❦</span>
              <span className="cov-author">
                {detail.authors.join(" · ") || "Unknown"}
              </span>
              <span className="cov-imprint">Pocket Library</span>
            </div>
          )}
        </div>
        <div className="edit-cover-copy">
          <p>
            {detail.enrichment.coverManual
              ? "Your chosen cover is protected from refreshes."
              : "The cover shown on the shelf and in the read view."}
          </p>
          <button
            type="button"
            className="secondary-action"
            data-testid="edit-change-cover"
            onClick={() => void onOpenCover()}
          >
            Change cover…
          </button>
        </div>
      </div>
    </Section>
  );
}
