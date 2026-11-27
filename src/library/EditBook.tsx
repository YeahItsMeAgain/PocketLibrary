import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  isApiError,
  platform,
  type BookDetail,
  type CoverOption,
  type EnrichmentOutcome,
  type Label,
  type LabelUsage,
  type ReadingStatus,
  type SpineStyle,
} from "../platform";
import { useLayerExit } from "../navigation";
import { CoverChooser } from "./CoverChooser";
import { EnrichmentReview } from "./EnrichmentReview";
import { SpineStudio } from "./SpineStudio";
import { useSpineActivity } from "./spineActivity";
import { prefersReducedMotion } from "./useShelfDrag";
import { STATUS_LABELS } from "./spine";

export type EditSection =
  | "details"
  | "cover"
  | "spine"
  | "status"
  | "online"
  | "danger";

interface EditBookProps {
  bookId: number;
  initialDetail: BookDetail;
  initialSection?: EditSection;
  onClose: () => void;
  onDetailChanged: (detail: BookDetail) => void;
  onBookChanged: (patch: {
    id: number;
    title?: string;
    authors?: string[];
    pageCount?: number | null;
    readingStatus?: ReadingStatus;
    labels?: Label[];
    spineStyle?: SpineStyle;
  }) => void;
  onLabelsChanged: () => void;
  onDeleted: (bookId: number) => void;
}

const SECTION_ORDER: ReadonlyArray<{ id: EditSection; title: string }> = [
  { id: "details", title: "Details" },
  { id: "cover", title: "Cover" },
  { id: "spine", title: "Spine" },
  { id: "status", title: "Status & labels" },
  { id: "online", title: "Online details" },
  { id: "danger", title: "Danger" },
];

const COVER_SOURCE_LABELS: Record<string, string> = {
  embedded: "the book file",
  rendered: "the PDF",
  generated: "the generated plate",
  open_library: "Open Library",
  internet_archive: "a linked Internet Archive scan",
  device: "this device",
};

type FieldStatus = "idle" | "saving" | "saved" | "error";

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

interface AutoSaveFieldProps {
  id: string;
  name: string;
  label: string;
  initial: string;
  multiline?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  hint?: string;
  save: (raw: string) => Promise<void>;
  validate?: (raw: string) => string | null;
}

/**
 * A single autosaving field. Text waits 600 ms after the last keystroke and
 * flushes immediately on blur. A failed save keeps the typed value on screen
 * and shows the error inline; the next edit retries.
 */
function AutoSaveField({
  id,
  name,
  label,
  initial,
  multiline = false,
  inputMode,
  maxLength,
  hint,
  save,
  validate,
}: AutoSaveFieldProps) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(initial);
  const timerRef = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const commit = useCallback(async (raw: string) => {
    if (raw === savedRef.current) return;
    const invalid = validateRef.current?.(raw) ?? null;
    if (invalid) {
      setStatus("error");
      setError(invalid);
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await saveRef.current(raw);
      savedRef.current = raw;
      setStatus("saved");
    } catch (nextError) {
      setStatus("error");
      setError(
        errorMessage(nextError, "That change could not be saved. Try again."),
      );
    }
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const change = (next: string) => {
    setValue(next);
    setStatus("idle");
    setError(null);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void commit(next);
    }, 600);
  };

  const blur = () => {
    window.clearTimeout(timerRef.current);
    void commit(value);
  };

  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "✓ Saved"
        : status === "error"
          ? "Not saved"
          : "";

  return (
    <div className="edit-field" data-field={name}>
      <div className="edit-field-head">
        <label htmlFor={id}>{label}</label>
        <span
          className="edit-save-state"
          data-status={status}
          data-testid={`edit-${name}-status`}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </span>
      </div>
      {multiline ? (
        <textarea
          id={id}
          data-testid={`edit-${name}`}
          value={value}
          rows={5}
          maxLength={maxLength}
          aria-invalid={status === "error"}
          aria-describedby={
            error ? `edit-${name}-error` : hint ? `edit-${name}-hint` : undefined
          }
          onChange={(event) => change(event.target.value)}
          onBlur={blur}
        />
      ) : (
        <input
          id={id}
          data-testid={`edit-${name}`}
          type="text"
          inputMode={inputMode}
          maxLength={maxLength}
          value={value}
          aria-invalid={status === "error"}
          aria-describedby={
            error ? `edit-${name}-error` : hint ? `edit-${name}-hint` : undefined
          }
          onChange={(event) => change(event.target.value)}
          onBlur={blur}
        />
      )}
      {hint && !error ? (
        <p className="edit-field-hint" id={`edit-${name}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className="edit-field-error"
          id={`edit-${name}-error`}
          data-testid={`edit-${name}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  id,
  title,
  note,
  sectionRef,
  children,
}: {
  id: EditSection;
  title: string;
  note?: string;
  sectionRef: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      id={`edit-section-${id}`}
      className="edit-section"
      data-testid={`edit-section-${id}`}
      aria-labelledby={`edit-section-${id}-title`}
      ref={sectionRef}
    >
      <h3 id={`edit-section-${id}-title`}>{title}</h3>
      {note ? <p className="edit-section-note">{note}</p> : null}
      {children}
    </section>
  );
}

export function EditBook({
  bookId,
  initialDetail,
  initialSection = "details",
  onClose,
  onDetailChanged,
  onBookChanged,
  onLabelsChanged,
  onDeleted,
}: EditBookProps) {
  const [detail, setDetail] = useState<BookDetail>(initialDetail);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const [spineStyle, setSpineStyle] = useState<SpineStyle>(
    initialDetail.spineStyle ?? "wrap",
  );
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [enrichmentNotice, setEnrichmentNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Extract<
    EnrichmentOutcome,
    { state: "needsReview" }
  > | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{
    message: string;
    restore: () => Promise<void>;
  } | null>(null);
  const undoTimerRef = useRef(0);
  const coverBeforeRef = useRef<CoverOption | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sectionsRef = useRef<
    Partial<Record<EditSection, HTMLElement | null>>
  >({});
  const close = useLayerExit(true, onClose);
  const { enqueue: enqueueSpine } = useSpineActivity();

  const applyDetail = useCallback(
    (next: BookDetail) => {
      setDetail(next);
      onDetailChanged(next);
    },
    [onDetailChanged],
  );

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

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!initialSection) return;
    const frame = requestAnimationFrame(() => {
      sectionsRef.current[initialSection]?.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);

  useEffect(() => {
    return () => window.clearTimeout(undoTimerRef.current);
  }, []);

  const showUndo = useCallback(
    (message: string, restore: () => Promise<void>) => {
      window.clearTimeout(undoTimerRef.current);
      setUndo({ message, restore });
      undoTimerRef.current = window.setTimeout(() => setUndo(null), 5000);
    },
    [],
  );

  const runUndo = useCallback(async () => {
    if (!undo) return;
    const action = undo.restore;
    window.clearTimeout(undoTimerRef.current);
    setUndo(null);
    try {
      await action();
      setEnrichmentNotice("Change undone.");
    } catch {
      setEnrichmentNotice("That change could not be undone just now.");
    }
  }, [undo]);

  /* ------------------------------------------------------------ details */

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

  /* ------------------------------------------------------------- spine */

  const handleSpineStyle = useCallback(
    (next: SpineStyle, previous: SpineStyle) => {
      setSpineStyle(next);
      const patched = { ...detailRef.current, spineStyle: next };
      applyDetail(patched);
      onBookChanged({ id: bookId, spineStyle: next });
      void platform.spineSetStyle(bookId, next).catch(() => {
        setEnrichmentNotice(
          "The style preview switched, but it could not be saved just now.",
        );
      });
      const label =
        next === "wrap"
          ? "Wrap"
          : next === "full-bleed"
            ? "Full-bleed"
            : "Cloth";
      showUndo(`Spine style set to ${label}.`, async () => {
        await platform.spineSetStyle(bookId, previous);
        setSpineStyle(previous);
        const restored = { ...detailRef.current, spineStyle: previous };
        applyDetail(restored);
        onBookChanged({ id: bookId, spineStyle: previous });
      });
    },
    [bookId, applyDetail, onBookChanged, showUndo],
  );

  /* ------------------------------------------------------------- cover */

  const openCover = useCallback(async () => {
    coverBeforeRef.current = null;
    try {
      const choices = await platform.coverChoices(bookId);
      coverBeforeRef.current = choices.current;
    } catch {
      // Undo falls back to the original jacket.
    }
    setCoverOpen(true);
  }, [bookId]);

  const handleCoverChanged = useCallback(
    (next: BookDetail) => {
      applyDetail(next);
      enqueueSpine([bookId]);
      const before = coverBeforeRef.current;
      showUndo("Cover changed.", async () => {
        try {
          if (before && before.source !== "device") {
            await platform.applyCoverChoice(bookId, before, true);
          } else {
            await platform.resetCover(bookId);
          }
        } catch {
          // The previous device image cannot be replayed; the original
          // jacket is the honest fallback the platform supports.
          await platform.resetCover(bookId);
        }
        const restored = await platform.getBookDetail(bookId);
        applyDetail(restored);
        enqueueSpine([bookId]);
      });
    },
    [bookId, applyDetail, enqueueSpine, showUndo],
  );

  /* ------------------------------------------------------ status/labels */

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

  /* ------------------------------------------------------------ online */

  const runLookup = useCallback(
    async (force: boolean) => {
      if (enrichmentBusy) return;
      setEnrichmentBusy(true);
      setEnrichmentNotice(null);
      try {
        const outcome = await platform.lookupEnrichment(bookId, force);
        if (outcome.state === "applied") {
          const next = await platform.getBookDetail(bookId);
          applyDetail(next);
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
          errorMessage(
            error,
            "The online source could not answer just now. The book is unchanged.",
          ),
        );
      } finally {
        setEnrichmentBusy(false);
      }
    },
    [bookId, enrichmentBusy, applyDetail, enqueueSpine],
  );

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
          applyDetail(await platform.getBookDetail(bookId));
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
          errorMessage(error, "That match could not be applied. Nothing changed."),
        );
      } finally {
        setReviewBusy(false);
      }
    },
    [bookId, applyDetail, enqueueSpine],
  );

  const revertDetails = useCallback(async () => {
    setEnrichmentBusy(true);
    setEnrichmentNotice(null);
    try {
      await platform.revertEnrichment(bookId);
      applyDetail(await platform.getBookDetail(bookId));
      setEnrichmentNotice("Reverted to the file's own details.");
      enqueueSpine([bookId]);
    } catch (error) {
      setEnrichmentNotice(
        errorMessage(error, "The file's details could not be restored just now."),
      );
    } finally {
      setEnrichmentBusy(false);
    }
  }, [bookId, applyDetail, enqueueSpine]);

  const openExternally = useCallback(async () => {
    setExternalNotice(null);
    try {
      await platform.openBookExternally(bookId);
      const reading = await platform.readingState(bookId);
      applyDetail({ ...detailRef.current, readingStatus: reading.status });
      onBookChanged({ id: bookId, readingStatus: reading.status });
      setExternalNotice(
        "Handed to the Android app chooser. The book is marked reading when you return; positions made there stay in that app.",
      );
    } catch (error) {
      setExternalNotice(
        errorMessage(error, "No other reader could be opened for this book."),
      );
    }
  }, [bookId, applyDetail, onBookChanged]);

  /* ------------------------------------------------------------ danger */

  const deleteBook = useCallback(async () => {
    setDeleteBusy(true);
    setDeleteNotice(null);
    try {
      await platform.deleteBook(bookId, true);
      onDeleted(bookId);
    } catch (error) {
      setDeleteNotice(
        errorMessage(error, "That book could not be deleted. Try again."),
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [bookId, onDeleted]);

  const unattachedLabels = availableLabels.filter(
    (label) => !detail.labels.some((worn) => worn.id === label.id),
  );

  return (
    <>
      <button
        type="button"
        className="edit-book-scrim"
        aria-label="Close edit book"
        onClick={close}
      />
      <section
        className="edit-book"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-book-title"
        data-testid="edit-book"
      >
        <div className="edit-book-head">
          <div>
            <p className="edit-book-kicker">The record</p>
            <h2 id="edit-book-title">Edit book</h2>
            <p className="edit-book-book">{detail.title}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="cover-sheet-close"
            data-testid="edit-book-close"
            aria-label="Close edit book"
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="edit-book-auto">Changes save as you make them.</p>

        <div className="edit-book-body">
          {SECTION_ORDER.map(({ id, title }) => {
            if (id === "details") {
              return (
                <Section
                  key={id}
                  id={id}
                  title={title}
                  sectionRef={(element) => {
                    sectionsRef.current[id] = element;
                  }}
                >
                  <AutoSaveField
                    id="edit-title-field"
                    name="title"
                    label="Title"
                    initial={detail.title}
                    maxLength={500}
                    save={saveTitle}
                    validate={(raw) =>
                      raw.trim() ? null : "A book needs a title."
                    }
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
            if (id === "cover") {
              return (
                <Section
                  key={id}
                  id={id}
                  title={title}
                  sectionRef={(element) => {
                    sectionsRef.current[id] = element;
                  }}
                >
                  <div className="edit-cover-row">
                    <div className="edit-cover-art">
                      {detail.coverDataUrl ? (
                        <img
                          src={detail.coverDataUrl}
                          alt={`Cover of ${detail.title}`}
                        />
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
                        onClick={() => void openCover()}
                      >
                        Change cover…
                      </button>
                    </div>
                  </div>
                </Section>
              );
            }
            if (id === "spine") {
              return (
                <Section
                  key={id}
                  id={id}
                  title={title}
                  sectionRef={(element) => {
                    sectionsRef.current[id] = element;
                  }}
                >
                  <SpineStudio
                    bookId={bookId}
                    title={detail.title}
                    author={detail.authors.join(" · ")}
                    pages={detail.pageCount}
                    coverDataUrl={detail.coverDataUrl}
                    initialStyle={detail.spineStyle}
                    style={spineStyle}
                    onStyleChange={handleSpineStyle}
                  />
                </Section>
              );
            }
            if (id === "status") {
              return (
                <Section
                  key={id}
                  id={id}
                  title={title}
                  sectionRef={(element) => {
                    sectionsRef.current[id] = element;
                  }}
                >
                  <fieldset className="edit-status-set">
                    <legend>Reading status</legend>
                    <div className="edit-status-options">
                      {(
                        ["unread", "reading", "finished"] as ReadingStatus[]
                      ).map((status) => (
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
                      ))}
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
                            } as React.CSSProperties
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
                      <div
                        className="detail-label-menu"
                        role="menu"
                        aria-label="Add a label"
                      >
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
            if (id === "online") {
              return (
                <Section
                  key={id}
                  id={id}
                  title={title}
                  note="Lookups only run when you ask. Nothing is uploaded."
                  sectionRef={(element) => {
                    sectionsRef.current[id] = element;
                  }}
                >
                  <div className="edit-online-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      data-testid="edit-lookup"
                      disabled={enrichmentBusy}
                      onClick={() => void runLookup(false)}
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
                        onClick={() => void revertDetails()}
                      >
                        Revert to file details
                      </button>
                    ) : null}
                  </div>
                  {detail.enrichment.attribution ? (
                    <p
                      className="detail-attribution"
                      data-testid="edit-attribution"
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
                      data-testid="edit-manual-provenance"
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
                      onClick={() => void openExternally()}
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
            return (
              <Section
                key={id}
                id={id}
                title={title}
                note="Deleting removes the book from the shelf and deletes its file. This cannot be undone."
                sectionRef={(element) => {
                  sectionsRef.current[id] = element;
                }}
              >
                {confirmDelete ? (
                  <div
                    className="detail-delete-confirm edit-delete-confirm"
                    role="alertdialog"
                    aria-label="Confirm deleting this book"
                    data-testid="detail-delete-confirm"
                  >
                    <p>
                      Delete “{detail.title}” from your library folder? The file
                      will be removed too. This cannot be undone.
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
                ) : (
                  <button
                    type="button"
                    className="danger-action"
                    data-testid="detail-delete"
                    onClick={() => {
                      setConfirmDelete(true);
                      setDeleteNotice(null);
                    }}
                  >
                    Delete book…
                  </button>
                )}
              </Section>
            );
          })}
        </div>

        <div
          className="edit-undo"
          role="status"
          aria-live="polite"
          data-testid="edit-undo-toast"
        >
          {undo ? (
            <>
              <span>{undo.message}</span>
              <button
                type="button"
                className="edit-undo-button"
                data-testid="edit-undo"
                onClick={() => void runUndo()}
              >
                Undo
              </button>
            </>
          ) : null}
        </div>
      </section>

      {coverOpen ? (
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
