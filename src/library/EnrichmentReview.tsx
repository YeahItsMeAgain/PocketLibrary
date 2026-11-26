import { useState } from "react";

import type { EnrichmentAttribution, EnrichmentCandidate } from "../platform";
import { useLayerExit } from "../navigation";

interface EnrichmentReviewProps {
  candidates: EnrichmentCandidate[];
  attribution: EnrichmentAttribution;
  busy: boolean;
  notice: string | null;
  onChoose: (candidate: EnrichmentCandidate) => void;
  onClose: () => void;
}

function candidateDetail(candidate: EnrichmentCandidate): string {
  return [
    candidate.authors.join(" · "),
    candidate.year ? String(candidate.year) : null,
    candidate.publisher,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function EnrichmentReview({
  candidates,
  attribution,
  busy,
  notice,
  onChoose,
  onClose,
}: EnrichmentReviewProps) {
  const close = useLayerExit(true, onClose);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = candidates.find((candidate) => candidate.key === chosen);

  return (
    <>
      <button
        type="button"
        className="enrichment-review-scrim"
        aria-label="Close match review"
        onClick={close}
      />
      <section
        className="enrichment-review"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrichment-review-title"
        data-testid="enrichment-review"
      >
        <div className="enrichment-review-head">
          <div>
            <p className="enrichment-kicker">A second opinion</p>
            <h2 id="enrichment-review-title">More than one edition might match</h2>
          </div>
          <button
            type="button"
            className="cover-sheet-close"
            aria-label="Close match review"
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="enrichment-review-copy">
          Choose the record that belongs to your copy. Nothing is written until
          you choose.
        </p>
        <div className="enrichment-candidates">
          {candidates.map((candidate) => (
            <button
              key={candidate.key}
              type="button"
              className={`enrichment-candidate${
                chosen === candidate.key ? " is-selected" : ""
              }`}
              aria-pressed={chosen === candidate.key}
              aria-label={`Review ${candidate.title}${candidate.year ? `, ${candidate.year}` : ""}`}
              data-testid="enrichment-candidate"
              onClick={() => setChosen(candidate.key)}
            >
              <span className="enrichment-candidate-art">
                {candidate.coverDataUrl ? (
                  <img src={candidate.coverDataUrl} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden="true">✦</span>
                )}
              </span>
              <span className="enrichment-candidate-meta">
                <span className="enrichment-candidate-title">
                  {candidate.title}
                </span>
                <span className="enrichment-candidate-detail">
                  {candidateDetail(candidate) || "Edition details unavailable"}
                </span>
              </span>
            </button>
          ))}
        </div>
        {notice ? (
          <p className="enrichment-review-notice" role="status">
            {notice}
          </p>
        ) : null}
        <div className="enrichment-review-actions">
          <button
            type="button"
            className="primary-action"
            data-testid="enrichment-accept"
            disabled={!selected || busy}
            onClick={() => {
              if (selected) onChoose(selected);
            }}
          >
            {busy ? "Applying…" : "Use this edition"}
          </button>
          <button
            type="button"
            className="settings-back"
            data-testid="enrichment-review-cancel"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <p className="enrichment-review-source">
            Matches from{" "}
            <a
              href={attribution.url}
              target="_blank"
              rel="noreferrer"
            >
              {attribution.label}
            </a>
            . Nothing is applied automatically.
          </p>
        </div>
      </section>
    </>
  );
}
