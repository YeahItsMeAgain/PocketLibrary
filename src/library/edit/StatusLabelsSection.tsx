import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  platform,
  type BookDetail,
  type Label,
  type LabelUsage,
  type ReadingStatus,
} from "../../platform";
import { STATUS_LABELS } from "../spine";
import { errorMessage } from "./errors";
import { Section } from "./Section";
import type { BookPatch } from "./types";

interface StatusLabelsSectionProps {
  title: string;
  bookId: number;
  detail: BookDetail;
  applyDetail: (next: BookDetail) => void;
  onBookChanged: (patch: BookPatch) => void;
  onLabelsChanged: () => void;
}

export function StatusLabelsSection({
  title,
  bookId,
  detail,
  applyDetail,
  onBookChanged,
  onLabelsChanged,
}: StatusLabelsSectionProps) {
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const refreshAvailableLabels = useCallback(async () => {
    try {
      setAvailableLabels(await platform.listLabels());
    } catch {
      // The already-worn labels remain visible.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    platform
      .listLabels()
      .then((labels) => {
        if (alive) setAvailableLabels(labels);
      })
      .catch(() => {
        // Labels are a convenience; the fields still work.
      });
    return () => {
      alive = false;
    };
  }, []);

  const chooseStatus = useCallback(
    async (status: ReadingStatus) => {
      if (statusBusy) return;
      setStatusBusy(true);
      setStatusNotice(null);
      try {
        await platform.setReadingStatus(bookId, status);
        const reading = await platform.readingState(bookId);
        const next = { ...detailRef.current, readingStatus: reading.status };
        applyDetail(next);
        onBookChanged({ id: bookId, readingStatus: reading.status });
        setStatusNotice(`${STATUS_LABELS[reading.status]} saved.`);
      } catch (error) {
        setStatusNotice(
          errorMessage(error, "That status could not be saved. Try again."),
        );
      } finally {
        setStatusBusy(false);
      }
    },
    [bookId, applyDetail, onBookChanged, statusBusy],
  );

  const attachLabel = useCallback(
    async (label: Label) => {
      try {
        await platform.attachLabel(bookId, label.id);
        const labels = [...detailRef.current.labels, label];
        applyDetail({ ...detailRef.current, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelMenu(false);
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          errorMessage(error, "That label could not be attached. Try again."),
        );
      }
    },
    [
      bookId,
      applyDetail,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const detachLabel = useCallback(
    async (label: Label) => {
      try {
        await platform.detachLabel(bookId, label.id);
        const labels = detailRef.current.labels.filter(
          (worn) => worn.id !== label.id,
        );
        applyDetail({ ...detailRef.current, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          errorMessage(error, "That label could not be removed. Try again."),
        );
      }
    },
    [
      bookId,
      applyDetail,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const unattachedLabels = availableLabels.filter(
    (label) => !detail.labels.some((worn) => worn.id === label.id),
  );

  return (
    <Section id="status" title={title}>
      <fieldset className="edit-status-set">
        <legend>Reading status</legend>
        <div className="edit-status-options">
          {(["unread", "reading", "finished"] as ReadingStatus[]).map(
            (status) => (
              <button
                key={status}
                type="button"
                className="edit-status-choice"
                data-testid={`edit-status-${status}`}
                aria-pressed={detail.readingStatus === status}
                disabled={statusBusy}
                onClick={() => void chooseStatus(status)}
              >
                {STATUS_LABELS[status]}
              </button>
            ),
          )}
        </div>
      </fieldset>
      {statusNotice ? (
        <p className="edit-section-note" role="status">
          {statusNotice}
        </p>
      ) : null}

      <div className="edit-label-block">
        <p className="edit-label-heading">Labels</p>
        <div className="detail-labels dlabels">
          {detail.labels.map((label) => (
            <button
              key={label.id}
              type="button"
              className="detail-label-chip dlabel"
              data-testid="edit-label-chip"
              style={
                {
                  "--lc": label.colour,
                  "--li": "#f8edd6",
                  backgroundColor: label.colour,
                } as CSSProperties
              }
              aria-label={`Remove label ${label.name}`}
              title={`Remove ${label.name}`}
              onClick={() => void detachLabel(label)}
            >
              <span>{label.name}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            type="button"
            className="detail-label-add dlabel none"
            data-testid="edit-add-label"
            aria-haspopup="menu"
            aria-expanded={labelMenu}
            onClick={() => setLabelMenu((open) => !open)}
          >
            + Add label
          </button>
        </div>
        {labelMenu ? (
          <div className="detail-label-menu" role="menu" aria-label="Add a label">
            {unattachedLabels.length > 0 ? (
              unattachedLabels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  role="menuitem"
                  className="detail-label-option"
                  data-testid={`edit-label-option-${label.id}`}
                  onClick={() => void attachLabel(label)}
                >
                  <span
                    className="label-swatch"
                    style={{ backgroundColor: label.colour }}
                    aria-hidden="true"
                  />
                  {label.name}
                </button>
              ))
            ) : (
              <p className="detail-label-empty">
                No other labels yet. Manage labels on the shelf.
              </p>
            )}
          </div>
        ) : null}
        {labelNotice ? (
          <p className="edit-field-error" role="alert">
            {labelNotice}
          </p>
        ) : null}
      </div>
    </Section>
  );
}
