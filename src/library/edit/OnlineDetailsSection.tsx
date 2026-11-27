import type { BookDetail } from "../../platform";
import { Section } from "./Section";

const COVER_SOURCE_LABELS: Record<string, string> = {
  embedded: "the book file",
  rendered: "the PDF",
  generated: "the generated plate",
  open_library: "Open Library",
  internet_archive: "a linked Internet Archive scan",
  device: "this device",
};

interface OnlineDetailsSectionProps {
  title: string;
  detail: BookDetail;
  enrichmentBusy: boolean;
  enrichmentNotice: string | null;
  externalNotice: string | null;
  onLookup: () => void;
  onRevert: () => void;
  onOpenExternally: () => void;
}

export function OnlineDetailsSection({
  title,
  detail,
  enrichmentBusy,
  enrichmentNotice,
  externalNotice,
  onLookup,
  onRevert,
  onOpenExternally,
}: OnlineDetailsSectionProps) {
  return (
    <Section
      id="online"
      title={title}
      note="Lookups only run when you ask. Nothing is uploaded."
     
    >
      <div className="edit-online-actions">
        <button
          type="button"
          className="secondary-action"
          data-testid="edit-lookup"
          disabled={enrichmentBusy}
          onClick={() => void onLookup()}
        >
          {enrichmentBusy
            ? "Looking up…"
            : detail.enrichment.hasGap
              ? "Look up details"
              : "Refresh details"}
        </button>
        {detail.enrichment.attribution ? (
          <button
            type="button"
            className="settings-back"
            data-testid="edit-revert"
            disabled={enrichmentBusy}
            onClick={() => void onRevert()}
          >
            Revert to file details
          </button>
        ) : null}
      </div>
      {detail.enrichment.attribution ? (
        <p className="detail-attribution" data-testid="edit-attribution">
          {detail.enrichment.attribution.label} supplied{" "}
          {detail.enrichment.attribution.fields
            .map((field) =>
              field === "description" ? "the blurb" : "the cover",
            )
            .join(" and ")}
          .{" "}
          <a
            href={detail.enrichment.attribution.url}
            target="_blank"
            rel="noreferrer"
          >
            View the source record
          </a>
        </p>
      ) : null}
      {detail.enrichment.descriptionSource === "manual" ||
      detail.enrichment.coverManual ? (
        <p className="detail-attribution" data-testid="edit-manual-provenance">
          {detail.enrichment.descriptionSource === "manual"
            ? "Blurb edited by you."
            : null}
          {detail.enrichment.descriptionSource === "manual" &&
          detail.enrichment.coverManual
            ? " "
            : null}
          {detail.enrichment.coverManual
            ? `Cover chosen by you from ${
                COVER_SOURCE_LABELS[detail.enrichment.coverSource ?? ""] ??
                "this device"
              } and protected from refreshes.`
            : null}
        </p>
      ) : null}
      {enrichmentNotice ? (
        <p
          className="edit-section-note"
          role="status"
          data-testid="edit-enrichment-notice"
        >
          {enrichmentNotice}
        </p>
      ) : null}
      <div className="edit-online-reader">
        <button
          type="button"
          className="secondary-action"
          data-testid="edit-open-external"
          onClick={() => void onOpenExternally()}
        >
          Open in another app
        </button>
        {externalNotice ? (
          <p className="edit-section-note" role="status">
            {externalNotice}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
