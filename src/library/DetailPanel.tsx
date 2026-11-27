import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  isApiError,
  platform,
  type Book,
  type BookDetail,
  type EnrichmentMode,
  type EnrichmentOutcome,
  type Label,
  type ReadingStatus,
} from "../platform";
import { useLayerExit } from "../navigation";
import { useSpineActivity } from "./spineActivity";
import { STATUS_LABELS } from "./spine";

// Editing and enrichment review are not on the read path. Loading them only
// when opened keeps the first tap's chunk smaller; both are idle-prefetched
// after the detail has settled.
const EditBook = lazy(() =>
  import("./EditBook").then((module) => ({ default: module.EditBook })),
);
const EnrichmentReview = lazy(() =>
  import("./EnrichmentReview").then((module) => ({
    default: module.EnrichmentReview,
  })),
);

export interface DetailPanelProps {
  bookId: number;
  shelfLabel: string;
  onClose: () => void;
  onRead: (book: Book) => void;
  onBookChanged: (patch: {
    id: number;
    title?: string;
    authors?: string[];
    pageCount?: number | null;
    readingStatus?: ReadingStatus;
    labels?: Label[];
    spineStyle?: BookDetail["spineStyle"];
  }) => void;
  onLabelsChanged: () => void;
  onDeleted: (bookId: number) => void;
}

export function DetailPanel({
  bookId,
  shelfLabel: shelfMarkLabel,
  onClose,
  onRead,
  onBookChanged,
  onLabelsChanged,
  onDeleted,
}: DetailPanelProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [reading, setReading] = useState<Awaited<
    ReturnType<typeof platform.readingState>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<EnrichmentMode>("off");
  const [enrichmentNotice, setEnrichmentNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Extract<
    EnrichmentOutcome,
    { state: "needsReview" }
  > | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [blurbExpanded, setBlurbExpanded] = useState(false);
  const [blurbOverflowing, setBlurbOverflowing] = useState(false);
  const [blurbAnnouncement, setBlurbAnnouncement] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const blurbRef = useRef<HTMLParagraphElement>(null);
  const autoLookupDone = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);
  const { enqueue: enqueueSpine } = useSpineActivity();

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setReading(null);
    setFailed(false);
    setEnrichmentNotice(null);
    setReview(null);
    setReviewNotice(null);
    setBlurbExpanded(false);
    setBlurbOverflowing(false);
    setBlurbAnnouncement("");
    setEditOpen(false);
    autoLookupDone.current = null;
    Promise.all([
      platform.getBookDetail(bookId),
      platform.readingState(bookId),
      platform.enrichmentSettings(),
    ])
      .then(([next, state, settings]) => {
        if (!alive) return;
        setDetail(next);
        setReading(state);
        setMode(settings.mode);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      // Leaving the Flip invalidates any in-flight lookup; a late result
      // writes nothing and cannot appear on another volume.
      void platform.cancelEnrichment(bookId).catch(() => {});
    };
  }, [bookId]);

  useEffect(() => {
    setBlurbExpanded(false);
  }, [detail?.description]);

  useLayoutEffect(() => {
    const el = blurbRef.current;
    if (!el || blurbExpanded) return;
    const measure = () => {
      setBlurbOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [detail?.description, blurbExpanded]);

  const toggleBlurb = useCallback(() => {
    setBlurbExpanded((expanded) => {
      setBlurbAnnouncement(expanded ? "Blurb collapsed." : "Blurb expanded.");
      return !expanded;
    });
  }, []);

  const openEdit = useCallback(() => {
    setEditOpen(true);
  }, []);

  const closeEdit = useCallback(() => {
    setEditOpen(false);
    requestAnimationFrame(() => editRef.current?.focus());
  }, []);

  const handleDetailChanged = useCallback((next: BookDetail) => {
    setDetail(next);
    setReading((current) =>
      current ? { ...current, status: next.readingStatus } : current,
    );
  }, []);

  const runLookup = useCallback(
    async (force: boolean) => {
      setEnrichmentNotice(null);
      try {
        const outcome = await platform.lookupEnrichment(bookId, force);
        if (outcome.state === "applied") {
          const next = await platform.getBookDetail(bookId);
          setDetail(next);
          enqueueSpine([bookId]);
          setEnrichmentNotice(
            `Added ${outcome.fields
              .map((field) => (field === "description" ? "blurb" : "cover"))
              .join(" and ")}.`,
          );
        } else if (outcome.state === "needsReview") {
          setReview(outcome);
          setReviewNotice(null);
        } else if (outcome.state === "noMatch") {
          setEnrichmentNotice(
            outcome.reason === "nothing_missing" ||
              outcome.reason === "nothing_changed"
              ? "Nothing was missing; the file's details are unchanged."
              : "No online match found for this edition.",
          );
        } else if (outcome.state === "unavailable") {
          setEnrichmentNotice(outcome.message);
        }
      } catch (error) {
        setEnrichmentNotice(
          isApiError(error)
            ? error.message
            : "The online source could not answer just now. The book is unchanged.",
        );
      }
    },
    [bookId, enqueueSpine],
  );

  useEffect(() => {
    if (
      !detail ||
      mode !== "automatic" ||
      !detail.enrichment.hasGap ||
      autoLookupDone.current === bookId
    ) {
      return;
    }
    // The entrance animation owns the first half second. An online lookup can
    // resolve with a new cover (and a spine job) mid-flight; wait until the
    // frame has settled so that work never lands on an animating layer.
    autoLookupDone.current = bookId;
    const timer = window.setTimeout(() => {
      void runLookup(false);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [detail, mode, bookId, runLookup]);

  useEffect(() => {
    if (!detail) return;
    // Editing and review are not on the read path; warm their chunks once the
    // open has settled, so the first Edit tap is still instant.
    const timer = window.setTimeout(() => {
      void import("./EditBook");
      void import("./EnrichmentReview");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [detail]);

  const acceptCandidate = useCallback(
    async (candidateKey: string) => {
      setReviewBusy(true);
      setReviewNotice(null);
      try {
        const outcome = await platform.acceptEnrichmentCandidate(
          bookId,
          candidateKey,
        );
        if (outcome.state === "applied") {
          setDetail(await platform.getBookDetail(bookId));
          setReview(null);
          setEnrichmentNotice("The chosen edition was applied.");
          enqueueSpine([bookId]);
        } else if (outcome.state === "noMatch") {
          setReviewNotice("Nothing was missing for that edition.");
        } else if (outcome.state === "unavailable") {
          setReviewNotice(outcome.message);
        }
      } catch (error) {
        setReviewNotice(
          isApiError(error)
            ? error.message
            : "That match could not be applied. Nothing changed.",
        );
      } finally {
        setReviewBusy(false);
      }
    },
    [bookId, enqueueSpine],
  );

  useEffect(() => {
    // The frame mounts with its data, so focus moves at the same moment the
    // entrance animation starts rather than onto a transient shell.
    if (detail || failed) closeRef.current?.focus();
  }, [detail, failed]);

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

  const readingProgress = Math.round((reading?.progress ?? 0) * 100);
  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close book detail"
        onClick={close}
      />
      {failed || detail ? (
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
                <button
                  ref={editRef}
                  type="button"
                  className="detail-edit-action"
                  data-testid="detail-edit"
                  aria-haspopup="dialog"
                  onClick={() => openEdit()}
                >
                  Edit
                </button>
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

                <div className="blurb-block">
                  <div
                    className={`blurb-clamp${
                      blurbExpanded ? " is-expanded" : ""
                    }${blurbOverflowing ? " has-overflow" : ""}`}
                  >
                    <p
                      id="detail-blurb-text"
                      ref={blurbRef}
                      className="blurb"
                      data-testid="detail-blurb"
                    >
                      {detail.description ??
                        "No blurb was printed with this edition."}
                    </p>
                  </div>
                  {blurbOverflowing ? (
                    <button
                      type="button"
                      className="blurb-toggle"
                      data-testid="blurb-toggle"
                      aria-expanded={blurbExpanded}
                      aria-controls="detail-blurb-text"
                      onClick={toggleBlurb}
                    >
                      {blurbExpanded ? "Show less" : "Read more"}
                    </button>
                  ) : null}
                  <span
                    className="visually-hidden"
                    role="status"
                    aria-live="polite"
                    data-testid="blurb-announcement"
                  >
                    {blurbAnnouncement}
                  </span>
                </div>

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

                <p className="detail-status-line" data-testid="detail-status">
                  <span>Status</span>
                  <b>{STATUS_LABELS[detail.readingStatus]}</b>
                </p>

                <div
                  className="detail-labels dlabels"
                  data-testid="detail-labels"
                >
                  {detail.labels.length > 0 ? (
                    detail.labels.map((label) => (
                      <span
                        key={label.id}
                        className="detail-label-chip dlabel is-static"
                        data-testid="detail-label-chip"
                        style={
                          {
                            "--lc": label.colour,
                            "--li": "#f8edd6",
                            backgroundColor: label.colour,
                          } as CSSProperties
                        }
                      >
                        {label.name}
                      </span>
                    ))
                  ) : (
                    <span className="detail-label-none">No labels</span>
                  )}
                </div>
                {enrichmentNotice ? (
                  <p
                    className="detail-note"
                    role="status"
                    data-testid="detail-enrichment-notice"
                  >
                    {enrichmentNotice}
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
      ) : null}
      <Suspense fallback={null}>
        {editOpen && detail ? (
          <EditBook
            bookId={bookId}
            initialDetail={detail}
            onClose={closeEdit}
            onDetailChanged={handleDetailChanged}
            onBookChanged={onBookChanged}
            onLabelsChanged={onLabelsChanged}
            onDeleted={onDeleted}
          />
        ) : null}
        {review ? (
          <EnrichmentReview
            candidates={review.candidates}
            attribution={review.attribution}
            busy={reviewBusy}
            notice={reviewNotice}
            onChoose={(candidate) => void acceptCandidate(candidate.key)}
            onClose={() => {
              setReview(null);
              setReviewNotice(null);
            }}
          />
        ) : null}
      </Suspense>
    </>
  );
}
