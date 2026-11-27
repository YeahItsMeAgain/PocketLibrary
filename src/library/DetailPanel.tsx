import {
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
  type LabelUsage,
  type ReadingState,
  type ReadingStatus,
} from "../platform";
import { useLayerExit } from "../navigation";
import { CoverChooser } from "./CoverChooser";
import { EnrichmentReview } from "./EnrichmentReview";
import { SpineStudio } from "./SpineStudio";
import { useSpineActivity } from "./spineActivity";
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
  onDeleted: (bookId: number) => void;
}

const COVER_SOURCE_LABELS: Record<string, string> = {
  embedded: "the book file",
  rendered: "the PDF",
  generated: "the generated plate",
  open_library: "Open Library",
  internet_archive: "a linked Internet Archive scan",
  device: "this device",
};

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
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [failed, setFailed] = useState(false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<EnrichmentMode>("off");
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [enrichmentNotice, setEnrichmentNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Extract<
    EnrichmentOutcome,
    { state: "needsReview" }
  > | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [blurbEditing, setBlurbEditing] = useState(false);
  const [blurbDraft, setBlurbDraft] = useState("");
  const [blurbBusy, setBlurbBusy] = useState(false);
  const [blurbExpanded, setBlurbExpanded] = useState(false);
  const [blurbOverflowing, setBlurbOverflowing] = useState(false);
  const [blurbAnnouncement, setBlurbAnnouncement] = useState("");
  const blurbRef = useRef<HTMLParagraphElement>(null);
  const autoLookupDone = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);
  const { enqueue: enqueueSpine } = useSpineActivity();

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
    setConfirmDelete(false);
    setDeleteBusy(false);
    setDeleteNotice(null);
    setEnrichmentBusy(false);
    setEnrichmentNotice(null);
    setReview(null);
    setReviewNotice(null);
    setCoverOpen(false);
    setBlurbEditing(false);
    setBlurbDraft("");
    setBlurbExpanded(false);
    setBlurbOverflowing(false);
    setBlurbAnnouncement("");
    autoLookupDone.current = null;
    Promise.all([
      platform.getBookDetail(bookId),
      platform.readingState(bookId),
      platform.listLabels(),
      platform.enrichmentSettings(),
    ])
      .then(([next, state, labels, settings]) => {
        if (!alive) return;
        setDetail(next);
        setReading(state);
        setAvailableLabels(labels);
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
  }, [detail?.description, blurbEditing, blurbExpanded]);

  const toggleBlurb = useCallback(() => {
    setBlurbExpanded((expanded) => {
      setBlurbAnnouncement(expanded ? "Blurb collapsed." : "Blurb expanded.");
      return !expanded;
    });
  }, []);

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

  const runLookup = useCallback(
    async (force: boolean) => {
      if (enrichmentBusy) return;
      setEnrichmentBusy(true);
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
      } finally {
        setEnrichmentBusy(false);
      }
    },
    [bookId, enrichmentBusy, enqueueSpine],
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
    autoLookupDone.current = bookId;
    void runLookup(false);
  }, [detail, mode, bookId, runLookup]);

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

  const saveBlurb = useCallback(
    async (text: string | null) => {
      setBlurbBusy(true);
      setEnrichmentNotice(null);
      try {
        await platform.editBlurb(bookId, text);
        setDetail(await platform.getBookDetail(bookId));
        setBlurbEditing(false);
      } catch (error) {
        setEnrichmentNotice(
          isApiError(error)
            ? error.message
            : "That blurb could not be saved. Please try again.",
        );
      } finally {
        setBlurbBusy(false);
      }
    },
    [bookId],
  );

  const revertDetails = useCallback(async () => {
    setEnrichmentBusy(true);
    setEnrichmentNotice(null);
    try {
      await platform.revertEnrichment(bookId);
      setDetail(await platform.getBookDetail(bookId));
      setEnrichmentNotice("Reverted to the file's own details.");
      enqueueSpine([bookId]);
    } catch (error) {
      setEnrichmentNotice(
        isApiError(error)
          ? error.message
          : "The file's details could not be restored just now.",
      );
    } finally {
      setEnrichmentBusy(false);
    }
  }, [bookId, enqueueSpine]);

  const handleCoverChanged = useCallback(
    (next: BookDetail) => {
      setDetail(next);
      setEnrichmentNotice("Cover updated.");
      // The cache key changes with the cover, so queue a fresh job.
      enqueueSpine([bookId]);
    },
    [bookId, enqueueSpine],
  );

  const deleteBook = useCallback(async () => {
    if (!detail) return;
    setDeleteBusy(true);
    setDeleteNotice(null);
    try {
      await platform.deleteBook(bookId, true);
      onDeleted(bookId);
      close();
    } catch (error) {
      setDeleteNotice(
        isApiError(error)
          ? error.message
          : "That book could not be deleted. Please try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [detail, bookId, onDeleted, close]);

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
                      <span className="detail-menu-rule" aria-hidden="true" />
                      <button
                        type="button"
                        role="menuitem"
                        className="detail-enrich-trigger"
                        data-testid="detail-lookup"
                        disabled={enrichmentBusy}
                        onClick={() => {
                          setStatusMenu(false);
                          void runLookup(false);
                        }}
                      >
                        {enrichmentBusy
                          ? "Looking up…"
                          : detail.enrichment.hasGap
                            ? "Look up details"
                            : "Refresh details"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="detail-enrich-trigger"
                        data-testid="detail-edit-blurb"
                        onClick={() => {
                          setStatusMenu(false);
                          setBlurbDraft(detail.description ?? "");
                          setBlurbEditing(true);
                        }}
                      >
                        Edit blurb…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="detail-enrich-trigger"
                        data-testid="detail-change-cover"
                        onClick={() => {
                          setStatusMenu(false);
                          setCoverOpen(true);
                        }}
                      >
                        Change cover…
                      </button>
                      {detail.enrichment.attribution ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="detail-enrich-trigger"
                          data-testid="detail-revert"
                          disabled={enrichmentBusy}
                          onClick={() => {
                            setStatusMenu(false);
                            void revertDetails();
                          }}
                        >
                          Revert to file details
                        </button>
                      ) : null}
                      <span className="detail-menu-rule" aria-hidden="true" />
                      <button
                        type="button"
                        role="menuitem"
                        className="detail-delete-trigger"
                        data-testid="detail-delete"
                        onClick={() => {
                          setStatusMenu(false);
                          setConfirmDelete(true);
                          setDeleteNotice(null);
                        }}
                      >
                        Delete book…
                      </button>
                    </div>
                  ) : null}
                  {confirmDelete ? (
                    <div
                      className="detail-delete-confirm"
                      role="alertdialog"
                      aria-label="Confirm deleting this book"
                      data-testid="detail-delete-confirm"
                    >
                      <p>
                        Delete “{detail.title}” from your library folder? The
                        file will be removed too. This cannot be undone.
                      </p>
                      {deleteNotice ? (
                        <p
                          className="detail-delete-error"
                          role="status"
                          data-testid="detail-delete-error"
                        >
                          {deleteNotice}
                        </p>
                      ) : null}
                      <div className="detail-delete-buttons">
                        <button
                          type="button"
                          className="danger-action"
                          data-testid="detail-delete-confirm-button"
                          disabled={deleteBusy}
                          onClick={() => void deleteBook()}
                        >
                          {deleteBusy ? "Deleting…" : "Delete book and file"}
                        </button>
                        <button
                          type="button"
                          className="secondary-action"
                          data-testid="detail-delete-cancel"
                          disabled={deleteBusy}
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </button>
                      </div>
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
                    <button
                      type="button"
                      className="v4-cover-hit"
                      data-testid="detail-cover-button"
                      aria-label={`Change cover for ${detail.title}`}
                      onClick={() => setCoverOpen(true)}
                    >
                      <span className="v4-cover-hit-label">Change cover</span>
                    </button>
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
                {blurbEditing ? (
                  <form
                    className="blurb-editor"
                    data-testid="blurb-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!blurbBusy) void saveBlurb(blurbDraft);
                    }}
                  >
                    <label htmlFor="blurb-text">Blurb for this edition</label>
                    <textarea
                      id="blurb-text"
                      data-testid="blurb-text"
                      value={blurbDraft}
                      rows={6}
                      maxLength={4000}
                      onChange={(event) => setBlurbDraft(event.target.value)}
                      disabled={blurbBusy}
                    />
                    <div className="blurb-editor-actions">
                      <button
                        type="submit"
                        className="secondary-action"
                        data-testid="blurb-save"
                        disabled={blurbBusy}
                      >
                        {blurbBusy ? "Saving…" : "Save blurb"}
                      </button>
                      <button
                        type="button"
                        className="settings-back"
                        data-testid="blurb-clear"
                        disabled={blurbBusy}
                        onClick={() => void saveBlurb(null)}
                      >
                        Clear blurb
                      </button>
                      <button
                        type="button"
                        className="settings-back"
                        data-testid="blurb-cancel"
                        disabled={blurbBusy}
                        onClick={() => setBlurbEditing(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
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
                )}
                {detail.enrichment.attribution ? (
                  <p
                    className="detail-attribution"
                    data-testid="detail-attribution"
                  >
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
                  <p
                    className="detail-attribution"
                    data-testid="detail-manual-provenance"
                  >
                    {detail.enrichment.descriptionSource === "manual"
                      ? "Blurb edited by you."
                      : null}
                    {detail.enrichment.descriptionSource === "manual" &&
                    detail.enrichment.coverManual
                      ? " "
                      : null}
                    {detail.enrichment.coverManual
                      ? `Cover chosen by you from ${
                          COVER_SOURCE_LABELS[
                            detail.enrichment.coverSource ?? ""
                          ] ?? "this device"
                        } and protected from refreshes.`
                      : null}
                  </p>
                ) : null}
                {enrichmentNotice ? (
                  <p
                    className="detail-note"
                    role="status"
                    data-testid="detail-enrichment-notice"
                  >
                    {enrichmentNotice}
                  </p>
                ) : null}

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

                <SpineStudio
                  bookId={bookId}
                  title={detail.title}
                  author={detail.authors.join(" · ")}
                  pages={detail.pageCount}
                  coverDataUrl={detail.coverDataUrl}
                  initialStyle={detail.spineStyle}
                />

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
      {coverOpen && detail ? (
        <CoverChooser
          bookId={bookId}
          bookTitle={detail.title}
          onClose={() => setCoverOpen(false)}
          onChanged={handleCoverChanged}
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
    </>
  );
}

