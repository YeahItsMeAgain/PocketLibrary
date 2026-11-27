import { useCallback, useEffect, useRef, useState } from "react";

import {
  platform,
  type BookDetail,
  type CoverOption,
  type EnrichmentOutcome,
  type SpineStyle,
} from "../../platform";
import { useLayerExit } from "../../navigation";
import { CoverChooser } from "../CoverChooser";
import { EnrichmentReview } from "../EnrichmentReview";
import { useSpineActivity } from "../spineActivity";
import { CoverSection } from "./CoverSection";
import { DangerSection } from "./DangerSection";
import { DetailsSection } from "./DetailsSection";
import { errorMessage } from "./errors";
import { OnlineDetailsSection } from "./OnlineDetailsSection";
import { SpineSection } from "./SpineSection";
import { StatusLabelsSection } from "./StatusLabelsSection";
import type { EditBookProps, EditSection } from "./types";
import { UndoToast } from "./UndoToast";

export type { EditSection } from "./types";

const SECTION_ORDER: ReadonlyArray<{ id: EditSection; title: string }> = [
  { id: "details", title: "Details" },
  { id: "cover", title: "Cover" },
  { id: "spine", title: "Spine" },
  { id: "status", title: "Status & labels" },
  { id: "online", title: "Online details" },
  { id: "danger", title: "Danger" },
];

export function EditBook({
  bookId,
  initialDetail,
  onClose,
  onDetailChanged,
  onBookChanged,
  onLabelsChanged,
  onDeleted,
}: EditBookProps) {
  const [detail, setDetail] = useState<BookDetail>(initialDetail);
  const detailRef = useRef(detail);
  detailRef.current = detail;
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
  const [undo, setUndo] = useState<{
    message: string;
    restore: () => Promise<void>;
  } | null>(null);
  const undoTimerRef = useRef(0);
  const coverBeforeRef = useRef<CoverOption | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);
  const { enqueue: enqueueSpine } = useSpineActivity();

  const applyDetail = useCallback(
    (next: BookDetail) => {
      setDetail(next);
      onDetailChanged(next);
    },
    [onDetailChanged],
  );

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

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
                <DetailsSection
                  key={id}
                  title={title}
                  bookId={bookId}
                  detail={detail}
                  applyDetail={applyDetail}
                  onBookChanged={onBookChanged}
                />
              );
            }
            if (id === "cover") {
              return (
                <CoverSection
                  key={id}
                  title={title}
                  detail={detail}
                  onOpenCover={openCover}
                />
              );
            }
            if (id === "spine") {
              return (
                <SpineSection
                  key={id}
                  title={title}
                  bookId={bookId}
                  detail={detail}
                  spineStyle={spineStyle}
                  onStyleChange={handleSpineStyle}
                />
              );
            }
            if (id === "status") {
              return (
                <StatusLabelsSection
                  key={id}
                  title={title}
                  bookId={bookId}
                  detail={detail}
                  applyDetail={applyDetail}
                  onBookChanged={onBookChanged}
                  onLabelsChanged={onLabelsChanged}
                />
              );
            }
            if (id === "online") {
              return (
                <OnlineDetailsSection
                  key={id}
                  title={title}
                  detail={detail}
                  enrichmentBusy={enrichmentBusy}
                  enrichmentNotice={enrichmentNotice}
                  externalNotice={externalNotice}
                  onLookup={() => void runLookup(false)}
                  onRevert={() => void revertDetails()}
                  onOpenExternally={() => void openExternally()}
                />
              );
            }
            return (
              <DangerSection
                key={id}
                title={title}
                bookId={bookId}
                detail={detail}
                onDeleted={onDeleted}
              />
            );
          })}
        </div>

        <UndoToast undo={undo} onUndo={runUndo} />
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
