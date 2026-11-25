import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  isApiError,
  platform,
  type Book,
  type BookDetail,
  type Label,
  type LabelUsage,
  type ReadingState,
  type ReadingStatus,
} from "../platform";
import { useLayerExit } from "../navigation";
import { STATUS_LABELS } from "./spine";

interface DetailPanelProps {
  bookId: number;
  shelfLabel: string;
  onClose: () => void;
  onRead: (book: Book) => void;
  onBookChanged: (patch: {
    id: number;
    readingStatus?: ReadingStatus;
    labels?: Label[];
  }) => void;
  onLabelsChanged: () => void;
}

export function DetailPanel({
  bookId,
  shelfLabel: shelfMarkLabel,
  onClose,
  onRead,
  onBookChanged,
  onLabelsChanged,
}: DetailPanelProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [failed, setFailed] = useState(false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);

  const refreshAvailableLabels = useCallback(async () => {
    try {
      setAvailableLabels(await platform.listLabels());
    } catch {
      // The manager surface still shows the labels already worn.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setReading(null);
    setFailed(false);
    setStatusMenu(false);
    setLabelMenu(false);
    setLabelNotice(null);
    setExternalNotice(null);
    Promise.all([
      platform.getBookDetail(bookId),
      platform.readingState(bookId),
      platform.listLabels(),
    ])
      .then(([next, state, labels]) => {
        if (!alive) return;
        setDetail(next);
        setReading(state);
        setAvailableLabels(labels);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const attachLabel = useCallback(
    async (label: Label) => {
      if (!detail) return;
      try {
        await platform.attachLabel(bookId, label.id);
        const labels = [...detail.labels, label];
        setDetail({ ...detail, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelMenu(false);
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That label could not be attached. Please try again.",
        );
      }
    },
    [
      detail,
      bookId,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const detachLabel = useCallback(
    async (label: Label) => {
      if (!detail) return;
      try {
        await platform.detachLabel(bookId, label.id);
        const labels = detail.labels.filter((worn) => worn.id !== label.id);
        setDetail({ ...detail, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That label could not be removed. Please try again.",
        );
      }
    },
    [
      detail,
      bookId,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const chooseStatus = useCallback(
    async (status: ReadingStatus) => {
      if (!detail) return;
      try {
        await platform.setReadingStatus(bookId, status);
        const state = await platform.readingState(bookId);
        setReading(state);
        setDetail({ ...detail, readingStatus: status });
        onBookChanged({ id: bookId, readingStatus: status });
        setStatusMenu(false);
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That status could not be saved. Please try again.",
        );
      }
    },
    [detail, bookId, onBookChanged],
  );

  const openExternally = useCallback(async () => {
    if (!detail) return;
    setExternalNotice(null);
    try {
      await platform.openBookExternally(bookId);
      const state = await platform.readingState(bookId);
      setReading(state);
      setDetail({ ...detail, readingStatus: state.status });
      onBookChanged({ id: bookId, readingStatus: state.status });
      setExternalNotice(
        "Handed to the Android app chooser. The book is marked reading when you return; positions made there stay in that app.",
      );
    } catch (error) {
      setExternalNotice(
        isApiError(error)
          ? error.message
          : "No other reader could be opened for this book.",
      );
    }
  }, [detail, bookId, onBookChanged]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const authors =
    detail && detail.authors.length > 0
      ? detail.authors.join(" · ")
      : "Unknown author";
  const editionYear = detail?.publishedDate?.slice(0, 4);
  const byline = [authors, editionYear, `Shelf ${shelfMarkLabel}`]
    .filter(Boolean)
    .join(" · ");
  const readLabel =
    detail?.readingStatus === "reading"
      ? "Continue reading"
      : detail?.readingStatus === "finished"
        ? "Read again"
        : "Read";
  const sticker =
    detail?.readingStatus === "finished"
      ? { kind: "gold" as const, text: "✓" }
      : detail?.readingStatus === "reading"
        ? {
            kind: "paper" as const,
            text: `${Math.round((reading?.progress ?? 0) * 100)}%`,
          }
        : null;
  const unattachedLabels = detail
    ? availableLabels.filter(
        (label) => !detail.labels.some((worn) => worn.id === label.id),
      )
    : [];

  const readingProgress = Math.round((reading?.progress ?? 0) * 100);
  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close book detail"
        onClick={close}
      />
      <section
        className="detail d3 d4 is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        data-testid="book-detail"
      >
        <button
          ref={closeRef}
          type="button"
          className="close"
          aria-label="Back to shelf"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
        <div className="d3-wrap">
          <div className="detail-stage v3d-frame v4d-frame">
            <div className="detail-toolbar">
              <button
                type="button"
                className="btn-back"
                data-testid="detail-back"
                aria-label="Back to shelf"
                onClick={close}
              >
                <span className="arrow" aria-hidden="true">←</span>
                <span>Back to shelf</span>
              </button>
              {detail ? (
                <div className="detail-actions">
                  <button
                    type="button"
                    className="detail-overflow"
                    data-testid="detail-actions"
                    aria-label="Book actions"
                    aria-haspopup="menu"
                    aria-expanded={statusMenu}
                    onClick={() => {
                      setStatusMenu((open) => !open);
                      setLabelMenu(false);
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {statusMenu ? (
                    <div
                      className="detail-status-menu"
                      role="menu"
                      aria-label="Set reading status"
                    >
                      {(
                        ["unread", "reading", "finished"] as ReadingStatus[]
                      ).map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="menuitemradio"
                          aria-checked={detail.readingStatus === status}
                          className="detail-status-option"
                          data-testid={`detail-status-option-${status}`}
                          onClick={() => chooseStatus(status)}
                        >
                          {STATUS_LABELS[status]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {failed ? (
              <div className="detail-loading">
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <h2 id="detail-title">This volume is unavailable</h2>
                <p>The book could not be opened just now.</p>
              </div>
            ) : detail === null ? (
              <div className="detail-loading" aria-busy="true">
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <h2 id="detail-title">Opening…</h2>
              </div>
            ) : (
              <>
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <div className="v3d-coverwrap v4d-coverwrap">
                  <div className="v4-cover">
                    <div className="v4-cover-art">
                      {detail.coverDataUrl ? (
                        <img
                          data-testid="detail-cover"
                          src={detail.coverDataUrl}
                          alt={`Cover of ${detail.title}`}
                          loading="eager"
                          decoding="async"
                        />
                      ) : (
                        <div className="cover cov-lg" aria-hidden="true">
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
                    <span className="v4-pages" aria-hidden="true" />
                    <span className="v4-hinge" aria-hidden="true" />
                    {sticker ? (
                      <span
                        className={`sticker sticker-${sticker.kind}`}
                        data-testid="detail-sticker"
                        data-sticker={sticker.kind}
                        aria-label={
                          sticker.kind === "gold"
                            ? "Finished"
                            : `${sticker.text} read`
                        }
                      >
                        {sticker.kind === "gold" ? (
                          <>
                            <span className="gstar" aria-hidden="true">✦</span>
                            <span className="gsub">Finished</span>
                          </>
                        ) : (
                          <>
                            <span className="pct">
                              {sticker.text.replace("%", "")}
                              <i>%</i>
                            </span>
                            <span className="psub" aria-hidden="true" />
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>

                <h2 id="detail-title" data-testid="detail-title">
                  {detail.title}
                </h2>
                <p className="byline" data-testid="detail-author">
                  {byline}
                </p>
                {detail.series ? (
                  <p className="detail-series">{detail.series}</p>
                ) : null}
                <div className="orn-rule" aria-hidden="true">❧</div>
                <p className="blurb" data-testid="detail-blurb">
                  {detail.description ?? "No blurb was printed with this edition."}
                </p>

                {detail.readingStatus === "reading" ? (
                  <div className="progress">
                    <div className="p-cap">
                      <span>Progress</span>
                      <span>{readingProgress}%</span>
                    </div>
                    <span className="bar">
                      <i style={{ width: `${readingProgress}%` }} />
                    </span>
                  </div>
                ) : null}

                <div className="detail-labels dlabels" data-testid="detail-labels">
                  {detail.labels.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      className="detail-label-chip dlabel"
                      data-testid="detail-label-chip"
                      style={
                        {
                          "--lc": label.colour,
                          "--li": "#f8edd6",
                          backgroundColor: label.colour,
                        } as CSSProperties
                      }
                      aria-label={`Remove label ${label.name}`}
                      title={`Remove ${label.name}`}
                      onClick={() => detachLabel(label)}
                    >
                      <span>{label.name}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="detail-label-add dlabel none"
                    data-testid="detail-add-label"
                    aria-haspopup="menu"
                    aria-expanded={labelMenu}
                    onClick={() => {
                      setLabelMenu((open) => !open);
                      setStatusMenu(false);
                    }}
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
                          data-testid={`label-option-${label.id}`}
                          onClick={() => attachLabel(label)}
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
                  <p className="detail-note" role="alert">
                    {labelNotice}
                  </p>
                ) : null}

                <div className="meta-strip" data-testid="detail-meta">
                  <span>
                    <em>Edition</em>
                    <b>{detail.publishedDate?.slice(0, 4) ?? "—"}</b>
                  </span>
                  <span>
                    <em>Shelf</em>
                    <b>{shelfMarkLabel}</b>
                  </span>
                  <span>
                    <em>Format</em>
                    <b>{detail.format.toUpperCase()}</b>
                  </span>
                  <span>
                    <em>Labels</em>
                    <b>{detail.labels.length}</b>
                  </span>
                </div>
                <p className="detail-fine">
                  {[
                    detail.publisher,
                    detail.language ? `Language ${detail.language}` : null,
                    detail.pageCount ? `${detail.pageCount} pages` : null,
                    detail.identifier,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Pocket Library edition"}
                </p>

                <button
                  type="button"
                  className="btn-read"
                  data-testid="detail-read"
                  onClick={() => onRead(detail)}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 4.4C8.3 3.2 6.2 2.9 3 3.1v12.1c3.2-.2 5.3.1 7 1.3 1.7-1.2 3.8-1.5 7-1.3V3.1c-3.2-.2-5.3.1-7 1.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M10 4.6v11.9" stroke="currentColor" strokeWidth="1.1" />
                  </svg>
                  <span>{readLabel}</span>
                </button>
                <button
                  type="button"
                  className="btn-return"
                  data-testid="detail-open-external"
                  onClick={() => void openExternally()}
                >
                  Open in another app
                </button>
                {externalNotice ? (
                  <p className="detail-note" role="status" data-testid="external-notice">
                    {externalNotice}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn-return"
                  data-testid="detail-return"
                  onClick={close}
                >
                  Return to shelf
                </button>
              </>
            )}
          </div>
          <p className="hint">Tap outside or press Esc to close</p>
        </div>
      </section>
    </>
  );
}

