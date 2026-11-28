import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  isApiError,
  platform,
  type Annotation,
  type Book,
  type Bookmark,
  type ReadingStatus,
} from "../platform";
import { useLayerExit } from "../navigation";
import { ReportAction } from "../Diagnostics";
import { noteFailure } from "../diagnostics";
import {
  ANNOTATION_COLOURS,
  DEFAULT_ANNOTATION_COLOUR,
  buildAnnotationLocator,
  normalizeWhitespace,
  parseAnnotationLocator,
  resolveAnnotationLocator,
  type AnnotationLocator,
} from "./annotations";
import {
  applyReaderSettings,
  createFoliateView,
  drawAnnotationHighlight,
  flattenToc,
  type FoliateRelocate,
  type FoliateTocItem,
  type FoliateView,
} from "./foliate";
import {
  READER_FONTS,
  READER_MARGINS,
  READER_SIZES,
  READER_SPACINGS,
  READER_THEMES,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
} from "./settings";
import {
  ReaderDesk,
  ReaderPull,
  ReaderTypePanel,
  themeName,
  useReaderExit,
} from "./ReaderControls";

interface ReaderLocator {
  v: 1;
  cfi?: string;
  quote?: string;
  progress?: number;
}

interface EpubReaderProps {
  book: Book;
  onClose: () => void;
}

type Sheet = "type" | "contents" | "marks" | null;

interface PageInfo {
  page: number;
  total: number;
}

interface SelectionDraft {
  range: Range;
  index: number;
  quote: string;
  title?: string;
  progress: number;
  left: number;
  top: number;
}

interface NoteEditor {
  annotation: Annotation;
  text: string;
}

interface AnnotationEventDetail {
  draw(func: typeof drawAnnotationHighlight, options: { color?: string; marker?: boolean }): void;
  annotation: { value: string; colour?: string; kind?: string };
  range?: Range;
}

const DESK_TABS = [
  { id: "type", label: "Type" },
  { id: "contents", label: "Contents" },
  { id: "marks", label: "Marks" },
] as const;

function parseLocator(raw: string | null | undefined): ReaderLocator | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReaderLocator>;
    if (value && value.v === 1) {
      return {
        v: 1,
        cfi: typeof value.cfi === "string" ? value.cfi : undefined,
        quote: typeof value.quote === "string" ? value.quote : undefined,
        progress:
          typeof value.progress === "number" ? value.progress : undefined,
      };
    }
  } catch {
    // A stale or non-reader locator is ignored; the book opens at its start.
  }
  return null;
}

/**
 * Collapse a relocated range to its start point.
 *
 * foliate reports the visible range (a CFI with two offsets). The paginator
 * destroys and rebuilds its document when the stage is resized, and a range
 * from the old document cannot be scrolled back to; a point CFI can. It also
 * restores exactly on the next open, where a range CFI can land at the start
 * of the section.
 */
function pointCfiFromRelocate(
  view: FoliateView,
  detail: FoliateRelocate,
): string | undefined {
  if (!detail.cfi) return undefined;
  if (!detail.range) return detail.cfi;
  try {
    const index = view.resolveCFI(detail.cfi).index;
    if (typeof index !== "number" || index < 0) return detail.cfi;
    const collapsed = detail.range.cloneRange();
    collapsed.collapse(true);
    return view.getCFI(index, collapsed);
  } catch {
    return detail.cfi;
  }
}

function quoteFromRange(range: Range | undefined): string | undefined {
  if (!range) return undefined;
  try {
    const text = range.toString().replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 120) : undefined;
  } catch {
    return undefined;
  }
}

async function resolveStart(
  view: FoliateView,
  locator: ReaderLocator | null,
): Promise<string | null> {
  if (!locator) return null;
  if (locator.cfi) {
    try {
      const resolved = view.resolveCFI(locator.cfi);
      if (typeof resolved.index === "number" && resolved.index >= 0) {
        return locator.cfi;
      }
    } catch {
      // CFI is structural; a re-render can invalidate it. Use the quote.
    }
  }
  if (locator.quote) {
    try {
      for await (const result of view.search({
        query: locator.quote.slice(0, 64),
      })) {
        if (typeof result !== "string" && result.cfi) return result.cfi;
      }
    } catch {
      // Search is best effort; opening at the start is still safe.
    }
  }
  return null;
}

export default function EpubReader({ book, onClose }: EpubReaderProps) {
  const close = useReaderExit(onClose);
  const containerRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const persistTimer = useRef(0);
  const latestLocator = useRef<ReaderLocator | null>(null);
  const readerStatus = useRef<ReadingStatus | null>(null);
  const currentChapterRef = useRef<string | undefined>(undefined);
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    loadReaderSettings(),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const restoreTimer = useRef(0);
  const restoreFrame = useRef(0);
  const resumeLocator = useRef<ReaderLocator | null>(null);
  const openedLocator = useRef<ReaderLocator | null>(null);
  const appliedSettings = useRef<ReaderSettings | null>(null);
  const firstReady = useRef(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [toc, setToc] = useState<Array<FoliateTocItem & { depth: number }>>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [progress, setProgress] = useState(0);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  // The desk header keeps the last closed-state readout: a paginated reflow
  // can land on a different page fraction at a section boundary, which would
  // look like the reader's place moved.
  const [frozenReadout, setFrozenReadout] = useState<{
    progress: number;
    percent: number;
    meta: string;
  } | null>(null);
  const [currentLocator, setCurrentLocator] = useState<ReaderLocator | null>(
    null,
  );
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkNotice, setBookmarkNotice] = useState<string | null>(null);
  const [externalNote, setExternalNote] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(
    null,
  );
  const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(
    null,
  );
  const [noteEditor, setNoteEditor] = useState<NoteEditor | null>(null);
  const [annotationNotice, setAnnotationNotice] = useState<string | null>(
    null,
  );
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;
  const resolvedAnnotations = useRef(new Map<number, string>());
  const selectionTimer = useRef(0);

  // Sheets sit above the reader in the shared back stack: back/Escape closes
  // the open sheet first, then the reader on the next press. Every close path
  // records where the reader was before the stage moves back.
  const requestCloseSheet = useCallback(() => {
    setSheet(null);
    // Scrolled mode and a not-yet-ready reader do not reflow, so the frozen
    // readout can be released at once.
    if (!ready || settings.mode !== "paginated") setFrozenReadout(null);
  }, [ready, settings.mode]);
  const closeSheet = useLayerExit(sheet !== null, requestCloseSheet);
  const closeNoteEditor = useLayerExit(noteEditor !== null, () =>
    setNoteEditor(null),
  );

  const openExternally = useCallback(async () => {
    try {
      await platform.openBookExternally(book.id);
      setExternalNote(
        "Handed to the Android app chooser. Your place here is saved.",
      );
    } catch (error) {
      setExternalNote(
        isApiError(error)
          ? error.message
          : "No other reader could be opened for this book.",
      );
    }
  }, [book.id]);

  const upsertAnnotation = useCallback((next: Annotation) => {
    setAnnotations((current) => {
      const index = current.findIndex((entry) => entry.id === next.id);
      if (index < 0) return [...current, next];
      return current.map((entry, at) => (at === index ? next : entry));
    });
  }, []);

  const drawAnnotation = useCallback(
    async (annotation: Annotation, remove = false) => {
      const view = viewRef.current;
      const cfi = resolvedAnnotations.current.get(annotation.id);
      if (!view || !cfi) return;
      try {
        await view.addAnnotation(
          {
            value: cfi,
            colour: annotation.colour ?? DEFAULT_ANNOTATION_COLOUR,
            kind: annotation.kind,
          },
          remove,
        );
      } catch {
        // A stale anchor stays in the list; the next open repairs it.
      }
    },
    [],
  );

  const drawAnnotationsForIndex = useCallback(
    async (index: number) => {
      const view = viewRef.current;
      if (!view) return;
      for (const annotation of annotationsRef.current) {
        const cfi = resolvedAnnotations.current.get(annotation.id);
        if (!cfi) continue;
        try {
          if (view.resolveCFI(cfi).index !== index) continue;
        } catch {
          continue;
        }
        await drawAnnotation(annotation);
      }
    },
    [drawAnnotation],
  );

  const refreshBookmarks = useCallback(async () => {
    try {
      setBookmarks(await platform.listBookmarks(book.id));
    } catch {
      setBookmarks([]);
    }
  }, [book.id]);

  useEffect(() => {
    void refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("reader-open");
    return () => root.classList.remove("reader-open");
  }, []);

  // `applyReaderSettings` re-renders the paginator in place. foliate rebuilds
  // its view while doing so, so the visible range is momentarily lost; put the
  // reader back where they were once the layout has settled.
  const restorePosition = useCallback((cfi: string, onSettled?: () => void) => {
    window.cancelAnimationFrame(restoreFrame.current);
    window.clearTimeout(restoreTimer.current);
    const attempt = (settle: boolean) => () => {
      const view = viewRef.current;
      const done = () => {
        if (settle) onSettled?.();
      };
      if (!view) {
        done();
        return;
      }
      void view.goTo(cfi).then(done).catch(done);
    };
    restoreFrame.current = window.requestAnimationFrame(attempt(false));
    restoreTimer.current = window.setTimeout(() => attempt(true)(), 220);
  }, []);

  useEffect(() => {
    saveReaderSettings(settings);
    if (!ready) return;
    const view = viewRef.current;
    if (!view) return;
    // The first pass after opening must use the locator we initialised with:
    // foliate's mount-time resize has already discarded the visible range.
    const opened = openedLocator.current;
    const locator = opened ?? latestLocator.current;
    openedLocator.current = null;
    const first = firstReady.current;
    firstReady.current = false;
    // The opening path already applied this exact record before init;
    // applying it again would re-render and discard the restored position.
    if (appliedSettings.current === settings) appliedSettings.current = null;
    else applyReaderSettings(view, settings);
    // A fresh book has nowhere to return to; only a saved place (or a later
    // settings change) needs the post-reflow restore.
    if (opened?.cfi) restorePosition(opened.cfi);
    else if (!first && locator?.cfi) restorePosition(locator.cfi);
    return () => {
      window.cancelAnimationFrame(restoreFrame.current);
      window.clearTimeout(restoreTimer.current);
    };
  }, [settings, ready, restorePosition]);

  // Opening or closing the desk changes the stage height. Paginated foliate
  // re-columnises on that resize and forgets the visible range, so restore the
  // locator the reader had before the stage moved. Scrolled mode needs no
  // restore (the viewport height does not change) but the call is harmless.
  const deskMounted = useRef(false);
  useLayoutEffect(() => {
    if (!ready || sheet !== null) return;
    if (!deskMounted.current) {
      deskMounted.current = true;
      return;
    }
    const release = () => setFrozenReadout(null);
    if (settingsRef.current.mode !== "paginated") {
      release();
      return;
    }
    const cfi = resumeLocator.current?.cfi;
    if (cfi) restorePosition(cfi, release);
    else release();
  }, [sheet, ready, restorePosition]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    const view = createFoliateView();
    viewRef.current = view;
    container.appendChild(view);
    let lastDoc: Document | null = null;

    const persist = (locator: ReaderLocator | null, nextProgress: number) => {
      latestLocator.current = locator;
      window.clearTimeout(persistTimer.current);
      persistTimer.current = window.setTimeout(() => {
        void platform
          .recordProgress(
            book.id,
            nextProgress,
            locator ? JSON.stringify(locator) : null,
          )
          .then((status) => {
            readerStatus.current = status;
          })
          .catch(() => {});
      }, 650);
    };

    const readFraction = (detail: FoliateRelocate): number => {
      const renderer = view.renderer;
      const section = view.lastLocation
        ? (view.lastLocation as FoliateRelocate & {
            section?: { current: number; total: number };
          }).section
        : undefined;
      const total = Math.max(1, section?.total ?? 1);
      const index = Math.max(0, section?.current ?? 0);
      if (renderer && settingsRef.current.mode === "paginated") {
        const pages = renderer.pages;
        if (renderer.atEnd) return (index + 1) / total;
        if (renderer.atStart) return index / total;
        // foliate's pages include one leading and one trailing margin column.
        const within = Math.max(
          0,
          Math.min(1, (renderer.page - 1) / Math.max(1, pages - 3)),
        );
        return (index + within) / total;
      }
      if (renderer && settingsRef.current.mode === "scrolled") {
        const within = renderer.viewSize
          ? Math.max(0, Math.min(1, renderer.start / renderer.viewSize))
          : 0;
        return (index + (renderer.atEnd ? 1 : within)) / total;
      }
      return typeof detail.fraction === "number"
        ? Math.max(0, Math.min(1, detail.fraction))
        : 0;
    };

    const onRelocate = (event: Event) => {
      const detail = (
        event as CustomEvent<FoliateRelocate & { reason?: string }>
      ).detail;
      if (!detail) return;
      // A page turn or a scroll is the reader taking over; a pending reflow
      // restore must not drag them back to where the page used to be.
      if (
        detail.reason === "page" ||
        detail.reason === "snap" ||
        detail.reason === "scroll"
      ) {
        window.cancelAnimationFrame(restoreFrame.current);
        window.clearTimeout(restoreTimer.current);
      }
      const fraction = readFraction(detail);
      const cfi = pointCfiFromRelocate(view, detail);
      const quote = quoteFromRange(detail.range);
      const locator: ReaderLocator = { v: 1, cfi, quote, progress: fraction };
      setProgress(fraction);
      setCurrentLocator(locator);
      setCurrentHref(detail.tocItem?.href ?? null);
      currentChapterRef.current = detail.tocItem?.label;
      const liveRenderer = view.renderer;
      if (liveRenderer && settingsRef.current.mode === "paginated") {
        const total = Math.max(1, (liveRenderer.pages ?? 0) - 2);
        const page = Math.min(total, Math.max(1, liveRenderer.page ?? 1));
        setPageInfo((current) =>
          current?.page === page && current.total === total
            ? current
            : { page, total },
        );
      } else if (settingsRef.current.mode !== "paginated") {
        setPageInfo(null);
      }
      persist(locator, fraction);
      if (fraction >= 0.98) {
        void platform
          .recordProgress(book.id, fraction, JSON.stringify(locator))
          .then((status) => {
            readerStatus.current = status;
          })
          .catch(() => {});
      }
    };

    const turn = (direction: "prev" | "next") => {
      const renderer = view.renderer;
      if (!renderer) return;
      if (direction === "prev" ? renderer.atStart : renderer.atEnd) return;
      // A deliberate page turn wins over a pending post-reflow restore.
      window.cancelAnimationFrame(restoreFrame.current);
      window.clearTimeout(restoreTimer.current);
      const action = direction === "prev" ? view.prev() : view.next();
      action.catch(() => {});
    };

    const captureSelection = (doc: Document, index: number) => {
      window.clearTimeout(selectionTimer.current);
      selectionTimer.current = window.setTimeout(() => {
        const selection = doc.defaultView?.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          setSelectionDraft(null);
          return;
        }
        const range = selection.getRangeAt(0);
        const quote = normalizeWhitespace(range.toString());
        if (!quote) {
          setSelectionDraft(null);
          return;
        }
        const rects = range.getClientRects();
        const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
        const frame = doc.defaultView?.frameElement;
        const frameRect =
          frame instanceof Element
            ? frame.getBoundingClientRect()
            : { left: 0, top: 0 };
        const width = window.innerWidth || 390;
        setSelectionDraft({
          range,
          index,
          quote,
          title: currentChapterRef.current,
          progress: latestLocator.current?.progress ?? 0,
          left: Math.min(width - 126, Math.max(126, frameRect.left + rect.left + rect.width / 2)),
          top: Math.max(142, frameRect.top + rect.top - 8),
        });
      }, 30);
    };

    const onLoad = (event: Event) => {
      const detail = (event as CustomEvent<{ doc: Document; index: number }>)
        .detail;
      const doc = detail?.doc;
      if (!doc || doc === lastDoc) return;
      lastDoc = doc;
      doc.addEventListener("click", (click) => {
        const selection = doc.defaultView?.getSelection();
        if (selection && !selection.isCollapsed) return;
        const target = click.target as Element | null;
        if (target && typeof target.closest === "function" && target.closest("a")) {
          return;
        }
        // The iframe can be wider than the visible viewport (foliate lays out
        // extra margin columns). Page-relative coordinates keep the tap zones
        // aligned with what the reader actually sees.
        const frame = doc.defaultView?.frameElement;
        const left = frame instanceof Element ? frame.getBoundingClientRect().left : 0;
        const width = window.innerWidth || 1;
        const ratio = (click.clientX + left) / width;
        if (ratio < 1 / 3) turn("prev");
        else if (ratio > 2 / 3) turn("next");
      });
      const index = detail.index;
      const onSelection = () => captureSelection(doc, index);
      doc.addEventListener("selectionchange", onSelection);
      doc.addEventListener("pointerup", onSelection);
      doc.addEventListener("keyup", onSelection);
    };

    const onDrawAnnotation = (event: Event) => {
      const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
      if (!detail?.draw) return;
      detail.draw(drawAnnotationHighlight, {
        color: detail.annotation.colour ?? DEFAULT_ANNOTATION_COLOUR,
        marker: detail.annotation.kind === "note",
      });
    };

    const onShowAnnotation = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: string }>).detail;
      const cfi = detail?.value;
      if (!cfi) return;
      const annotation = annotationsRef.current.find(
        (entry) => resolvedAnnotations.current.get(entry.id) === cfi,
      );
      if (!annotation) return;
      setSelectionDraft(null);
      setActiveAnnotation(annotation);
    };

    const onCreateOverlay = (event: Event) => {
      const detail = (event as CustomEvent<{ index?: number }>).detail;
      if (typeof detail?.index !== "number") return;
      void drawAnnotationsForIndex(detail.index);
    };

    view.addEventListener("relocate", onRelocate);
    view.addEventListener("load", onLoad);
    view.addEventListener("draw-annotation", onDrawAnnotation);
    view.addEventListener("show-annotation", onShowAnnotation);
    view.addEventListener("create-overlay", onCreateOverlay);

    (async () => {
      try {
        const bytes = await platform.readBook(book.id);
        if (cancelled) return;
        const file = new File([bytes], `${book.title || "book"}.epub`, {
          type: "application/epub+zip",
        });
        await view.open(file);
        if (cancelled) return;
        setToc(flattenToc(view.book?.toc));
        applyReaderSettings(view, settingsRef.current);
        appliedSettings.current = settingsRef.current;
        const state = await platform.readingState(book.id);
        const locator = parseLocator(state.locator);
        await platform.recordOpen(book.id);
        if (cancelled) return;
        const start = await resolveStart(view, locator);
        await view.init({ lastLocation: start, showTextStart: !start });
        if (start) {
          openedLocator.current = { ...(locator ?? { v: 1 }), cfi: start };
        }
        if (cancelled) return;
        setReady(true);

        const stored = await platform.listAnnotations(book.id);
        if (cancelled) return;
        const repaired: Annotation[] = [];
        for (const annotation of stored) {
          const saved = parseAnnotationLocator(annotation.locator);
          if (!saved) {
            repaired.push(annotation);
            continue;
          }
          const resolved = await resolveAnnotationLocator(view, saved);
          if (cancelled) return;
          if (!resolved) {
            repaired.push(annotation);
            continue;
          }
          resolvedAnnotations.current.set(annotation.id, resolved.cfi);
          if (!resolved.repaired) {
            repaired.push(annotation);
            continue;
          }
          const corrected: AnnotationLocator = {
            ...saved,
            locations: {
              ...saved.locations,
              fragments: [resolved.cfi],
            },
          };
          try {
            const updated = await platform.updateAnnotation(
              book.id,
              annotation.id,
              { locator: JSON.stringify(corrected) },
            );
            repaired.push(updated);
          } catch {
            repaired.push(annotation);
          }
        }
        if (cancelled) return;
        setAnnotations(repaired);
        for (const annotation of repaired) {
          await drawAnnotation(annotation);
        }
      } catch (error) {
        if (cancelled) return;
        const message = isApiError(error)
          ? error.message
          : "This book could not be opened. Please try again.";
        noteFailure();
        void platform
          .logDiagnostic("error", "reader.failed", `${book.title}: ${message}`)
          .catch(() => {});
        setFailed(message);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(persistTimer.current);
      window.clearTimeout(selectionTimer.current);
      const locator = latestLocator.current;
      if (locator) {
        void platform
          .recordProgress(book.id, locator.progress ?? 0, JSON.stringify(locator))
          .catch(() => {});
      }
      view.removeEventListener("relocate", onRelocate);
      view.removeEventListener("load", onLoad);
      view.removeEventListener("draw-annotation", onDrawAnnotation);
      view.removeEventListener("show-annotation", onShowAnnotation);
      view.removeEventListener("create-overlay", onCreateOverlay);
      view.close();
      view.remove();
      viewRef.current = null;
    };
  }, [book.id, book.title]);

  const currentBookmark = useMemo(
    () =>
      bookmarks.find(
        (bookmark) =>
          parseLocator(bookmark.locator)?.cfi === currentLocator?.cfi,
      ) ?? null,
    [bookmarks, currentLocator],
  );

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const toggleBookmark = useCallback(async () => {
    if (!currentLocator?.cfi) return;
    setBookmarkNotice(null);
    try {
      if (currentBookmark) {
        await platform.deleteBookmark(book.id, currentBookmark.id);
      } else {
        await platform.addBookmark(book.id, JSON.stringify(currentLocator));
      }
      await refreshBookmarks();
    } catch (error) {
      setBookmarkNotice(
        isApiError(error)
          ? error.message
          : "That bookmark could not be saved.",
      );
    }
  }, [book.id, currentBookmark, currentLocator, refreshBookmarks]);

  const createHighlight = useCallback(
    async (colour: string) => {
      const draft = selectionDraft;
      const view = viewRef.current;
      if (!draft || !view) return;
      setAnnotationNotice(null);
      try {
        const locator = buildAnnotationLocator(
          view,
          draft.index,
          draft.range,
          draft.progress,
          draft.title,
        );
        const created = await platform.createAnnotation(
          book.id,
          "highlight",
          colour,
          null,
          JSON.stringify(locator),
        );
        resolvedAnnotations.current.set(
          created.id,
          locator.locations.fragments[0],
        );
        setAnnotations((current) => [...current, created]);
        setSelectionDraft(null);
        view.deselect();
        await drawAnnotation(created);
      } catch (error) {
        setAnnotationNotice(
          isApiError(error)
            ? error.message
            : "That highlight could not be saved.",
        );
      }
    },
    [book.id, drawAnnotation, selectionDraft],
  );

  const startNote = useCallback(async () => {
    const draft = selectionDraft;
    const view = viewRef.current;
    if (!draft || !view) return;
    setAnnotationNotice(null);
    try {
      const locator = buildAnnotationLocator(
        view,
        draft.index,
        draft.range,
        draft.progress,
        draft.title,
      );
      const created = await platform.createAnnotation(
        book.id,
        "highlight",
        DEFAULT_ANNOTATION_COLOUR,
        null,
        JSON.stringify(locator),
      );
      resolvedAnnotations.current.set(
        created.id,
        locator.locations.fragments[0],
      );
      setAnnotations((current) => [...current, created]);
      setSelectionDraft(null);
      view.deselect();
      await drawAnnotation(created);
      setNoteEditor({ annotation: created, text: "" });
    } catch (error) {
      setAnnotationNotice(
        isApiError(error)
          ? error.message
          : "That note could not be saved.",
      );
    }
  }, [book.id, drawAnnotation, selectionDraft]);

  const saveNote = useCallback(async () => {
    if (!noteEditor) return;
    setAnnotationNotice(null);
    try {
      const updated = await platform.updateAnnotation(
        book.id,
        noteEditor.annotation.id,
        { note: noteEditor.text },
      );
      upsertAnnotation(updated);
      closeNoteEditor();
      await drawAnnotation(updated);
    } catch (error) {
      setAnnotationNotice(
        isApiError(error) ? error.message : "That note could not be saved.",
      );
    }
  }, [book.id, drawAnnotation, noteEditor, upsertAnnotation]);

  const recolourAnnotation = useCallback(
    async (annotation: Annotation, colour: string) => {
      try {
        const updated = await platform.updateAnnotation(
          book.id,
          annotation.id,
          { colour },
        );
        upsertAnnotation(updated);
        setActiveAnnotation(updated);
        await drawAnnotation(updated);
      } catch (error) {
        setAnnotationNotice(
          isApiError(error)
            ? error.message
            : "That highlight could not be recoloured.",
        );
      }
    },
    [book.id, drawAnnotation, upsertAnnotation],
  );

  const deleteAnnotation = useCallback(
    async (annotation: Annotation) => {
      const view = viewRef.current;
      const cfi = resolvedAnnotations.current.get(annotation.id);
      try {
        await platform.deleteAnnotation(book.id, annotation.id);
        resolvedAnnotations.current.delete(annotation.id);
        setAnnotations((current) =>
          current.filter((entry) => entry.id !== annotation.id),
        );
        setActiveAnnotation(null);
        setNoteEditor((current) =>
          current?.annotation.id === annotation.id ? null : current,
        );
        if (view && cfi) {
          await view.addAnnotation({ value: cfi }, true);
        }
      } catch (error) {
        setAnnotationNotice(
          isApiError(error)
            ? error.message
            : "That annotation could not be removed.",
        );
      }
    },
    [book.id],
  );

  // A jump closes the desk, which grows the stage and re-columnises the
  // book. Hold the jumped-to place as the restore target so the reflow does
  // not fall back to the start of the section.
  const jumpAndClose = useCallback(
    async (target: unknown) => {
      const view = viewRef.current;
      if (!view) return;
      try {
        await view.goTo(target);
      } catch {
        // Keep the list usable even when this rendering cannot jump.
      }
      resumeLocator.current = latestLocator.current;
      closeSheet();
    },
    [closeSheet],
  );

  const jumpAnnotation = useCallback(
    async (annotation: Annotation) => {
      const locator = parseAnnotationLocator(annotation.locator);
      const target =
        resolvedAnnotations.current.get(annotation.id) ??
        locator?.locations.fragments[0] ??
        locator?.href;
      if (!target) return;
      await jumpAndClose(target);
      setActiveAnnotation(null);
    },
    [jumpAndClose],
  );

  const jumpBookmark = useCallback(
    async (bookmark: Bookmark) => {
      const locator = parseLocator(bookmark.locator);
      if (!locator?.cfi) return;
      await jumpAndClose(locator.cfi);
    },
    [jumpAndClose],
  );

  const jumpChapter = useCallback(
    async (item: FoliateTocItem) => {
      await jumpAndClose(item.href);
    },
    [jumpAndClose],
  );

  const theme = READER_THEMES[settings.theme];
  const percent = Math.round(progress * 100);
  const size = READER_SIZES[settings.size] ?? READER_SIZES[2];
  const spacing = READER_SPACINGS[settings.spacing] ?? READER_SPACINGS[1];
  const margin = READER_MARGINS[settings.margin] ?? READER_MARGINS[0];
  const font = READER_FONTS.find((entry) => entry.id === settings.font) ?? READER_FONTS[0];
  const deskMeta = pageInfo
    ? `${percent}% · page ${pageInfo.page} of ${pageInfo.total}`
    : `${percent}%`;
  const deskSummary = `${size.px}px · ${spacing.name} · ${margin.name} · ${font.name} · ${themeName(settings.theme)}`;
  const paginated = settings.mode === "paginated";
  const shownProgress = frozenReadout?.progress ?? progress;
  const shownPercent = frozenReadout?.percent ?? percent;
  const shownMeta = frozenReadout?.meta ?? deskMeta;

  const openDesk = useCallback(
    (tab: Exclude<Sheet, null>) => {
      resumeLocator.current = latestLocator.current;
      // Hold the closed-state readout; the reflow behind the sheet is not a
      // change of place.
      setFrozenReadout({ progress, percent, meta: deskMeta });
      setSheet(tab);
    },
    [progress, percent, deskMeta],
  );

  return (
    <section
      className="reader"
      data-testid="reader"
      data-theme={settings.theme}
      data-mode={settings.mode}
      data-desk={sheet ? "open" : "closed"}
      data-flow={paginated ? "reflow" : "overlay"}
      aria-label={`Reading ${book.title}`}
      style={
        {
          "--reader-paper": theme.paper,
          "--reader-ink": theme.ink,
          "--reader-accent": theme.accent,
          "--reader-rule": theme.rule,
        } as CSSProperties
      }
    >
      <div className="reader-stage" ref={containerRef} data-testid="reader-stage" />

      <ReaderPull
        progress={shownProgress}
        percentLabel={`${shownPercent}%`}
        expanded={sheet !== null}
        onOpen={() => openDesk("type")}
        buttonRef={pullRef}
      />

      {!ready && !failed ? (
        <div className="reader-loading" data-testid="reader-loading">
          <p className="kicker">Opening the volume</p>
          <p>{book.title}</p>
        </div>
      ) : null}
      {failed ? (
        <div className="reader-loading" role="alert" data-testid="reader-error">
          <p className="kicker">The reading room is dark</p>
          <h2>{book.title}</h2>
          <p>{failed}</p>
          <ReportAction testId="reader-report" label="Report" />
          <button type="button" className="secondary-action" onClick={close}>
            Back to shelf
          </button>
        </div>
      ) : null}

      {currentBookmark ? (
        <div
          className="reader-ribbon"
          data-testid="reader-bookmark-ribbon"
          aria-label="Bookmarked page"
        />
      ) : null}

      {selectionDraft ? (
        <div
          className="reader-selection-pop"
          role="dialog"
          aria-label="Highlight selection"
          data-testid="reader-selection-popover"
          style={{
            left: selectionDraft.left,
            top: selectionDraft.top,
          }}
        >
          <span className="reader-selection-quote" aria-hidden="true">
            “{selectionDraft.quote.slice(0, 42)}
            {selectionDraft.quote.length > 42 ? "…" : ""}”
          </span>
          <div className="reader-swatches">
            {ANNOTATION_COLOURS.map((entry) => (
              <button
                key={entry.colour}
                type="button"
                className="reader-swatch"
                style={{ background: entry.colour }}
                data-testid={`reader-highlight-${entry.name.toLowerCase()}`}
                aria-label={`Highlight ${entry.name}`}
                title={entry.name}
                onClick={() => void createHighlight(entry.colour)}
              />
            ))}
            <button
              type="button"
              className="reader-note-action"
              data-testid="reader-add-note"
              onClick={() => void startNote()}
            >
              Note
            </button>
          </div>
        </div>
      ) : null}

      {activeAnnotation ? (
        <div
          className="reader-annotation-pop"
          role="dialog"
          aria-label="Highlight actions"
          data-testid="reader-annotation-popover"
        >
          <div className="reader-annotation-summary">
            <p>
              {parseAnnotationLocator(activeAnnotation.locator)?.text.highlight ??
                "Saved highlight"}
            </p>
            {activeAnnotation.note ? (
              <p className="reader-annotation-note" data-testid="reader-active-note">
                {activeAnnotation.note}
              </p>
            ) : null}
          </div>
          <div className="reader-swatches">
            {ANNOTATION_COLOURS.map((entry) => (
              <button
                key={entry.colour}
                type="button"
                className="reader-swatch"
                style={{ background: entry.colour }}
                aria-pressed={
                  (activeAnnotation.colour ?? DEFAULT_ANNOTATION_COLOUR) ===
                  entry.colour
                }
                data-testid={`reader-recolour-${entry.name.toLowerCase()}`}
                aria-label={`Colour ${entry.name}`}
                onClick={() =>
                  void recolourAnnotation(activeAnnotation, entry.colour)
                }
              />
            ))}
            <button
              type="button"
              className="reader-note-action"
              data-testid="reader-edit-note"
              onClick={() => {
                setNoteEditor({
                  annotation: activeAnnotation,
                  text: activeAnnotation.note ?? "",
                });
                setActiveAnnotation(null);
              }}
            >
              {activeAnnotation.note ? "Edit note" : "Add note"}
            </button>
            <button
              type="button"
              className="reader-note-action reader-delete-action"
              data-testid="reader-delete-annotation"
              onClick={() => void deleteAnnotation(activeAnnotation)}
            >
              Delete
            </button>
            <button
              type="button"
              className="reader-pop-close"
              aria-label="Close highlight actions"
              data-testid="reader-annotation-close"
              onClick={() => setActiveAnnotation(null)}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {noteEditor ? (
        <>
          <button
            type="button"
            className="reader-scrim"
            aria-label="Close note editor"
            onClick={closeNoteEditor}
          />
          <section
            className="reader-sheet reader-note-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Annotation note"
            data-testid="reader-note-sheet"
          >
            <div className="reader-sheet-grip" aria-hidden="true" />
            <p className="reader-type-label">
              {noteEditor.annotation.note ? "Edit note" : "Write a note"}
            </p>
            <blockquote className="reader-note-quote">
              {parseAnnotationLocator(noteEditor.annotation.locator)?.text
                .highlight ?? "Saved highlight"}
            </blockquote>
            <textarea
              className="reader-note-input"
              data-testid="reader-note-input"
              aria-label="Note"
              value={noteEditor.text}
              autoFocus
              rows={4}
              placeholder="A thought in the margin…"
              onChange={(event) =>
                setNoteEditor((current) =>
                  current ? { ...current, text: event.target.value } : current,
                )
              }
            />
            <div className="reader-note-actions">
              <button
                type="button"
                className="secondary-action"
                data-testid="reader-note-cancel"
                onClick={closeNoteEditor}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                data-testid="reader-note-save"
                onClick={() => void saveNote()}
              >
                Save note
              </button>
            </div>
          </section>
        </>
      ) : null}

      {annotationNotice ? (
        <p
          className="reader-toast"
          role="alert"
          data-testid="reader-annotation-notice"
        >
          {annotationNotice}
        </p>
      ) : null}

      {externalNote ? (
        <p className="reader-toast" role="status" data-testid="reader-external-note">
          {externalNote}
        </p>
      ) : null}
      {bookmarkNotice ? (
        <p className="reader-toast" role="alert" data-testid="reader-bookmark-notice">
          {bookmarkNotice}
        </p>
      ) : null}

      {sheet ? (
        <ReaderDesk
          title={book.title}
          meta={shownMeta}
          tabs={DESK_TABS}
          activeTab={sheet}
          onTabChange={(id) => setSheet(id as Exclude<Sheet, null>)}
          summary={deskSummary}
          onClose={closeSheet}
          onShelf={() => {
            if (resumeLocator.current) {
              latestLocator.current = resumeLocator.current;
            }
            close();
          }}
          returnFocusRef={pullRef}
        >
          {sheet === "type" ? (
            <ReaderTypePanel
              settings={settings}
              onChange={update}
              onOpenExternally={() => {
                closeSheet();
                void openExternally();
              }}
            />
          ) : null}

          {sheet === "contents" ? (
            <ol className="reader-toc" data-testid="reader-toc">
              {toc.length === 0 ? (
                <li className="reader-empty">This book has no contents.</li>
              ) : (
                toc.map((item) => {
                  const current = item.href === currentHref;
                  return (
                    <li key={`${item.href}-${item.label}-${item.depth}`}>
                      <button
                        type="button"
                        className="reader-toc-item"
                        data-testid="reader-toc-item"
                        data-current={current || undefined}
                        aria-current={current ? "location" : undefined}
                        style={{ paddingLeft: 14 + item.depth * 16 }}
                        onClick={() => void jumpChapter(item)}
                      >
                        <span>{item.label}</span>
                        {current ? (
                          <span className="reader-toc-mark" aria-hidden="true">
                            ❧
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ol>
          ) : null}

          {sheet === "marks" ? (
            <div className="reader-marks" data-testid="reader-marks">
              <button
                type="button"
                className="reader-mark-toggle"
                data-testid="reader-bookmark"
                aria-pressed={currentBookmark !== null}
                onClick={() => void toggleBookmark()}
              >
                <span className="reader-mark-glyph" aria-hidden="true">
                  {currentBookmark ? "◆" : "▽"}
                </span>
                {currentBookmark ? "Remove this bookmark" : "Bookmark this page"}
              </button>

              <p className="reader-marks-cap">Bookmarks</p>
              <ul className="reader-bookmarks" data-testid="reader-bookmarks">
                {bookmarks.length === 0 ? (
                  <li className="reader-empty">
                    No bookmarks yet. Bookmark this page to keep your place.
                  </li>
                ) : (
                  bookmarks.map((bookmark) => {
                    const locator = parseLocator(bookmark.locator);
                    return (
                      <li key={bookmark.id} data-testid="reader-bookmark-row">
                        <button
                          type="button"
                          className="reader-bookmark-jump"
                          onClick={() => void jumpBookmark(bookmark)}
                        >
                          <span>{locator?.quote ?? "Saved place"}</span>
                          <small>
                            {Math.round((locator?.progress ?? 0) * 100)}%
                          </small>
                        </button>
                        <button
                          type="button"
                          className="reader-bookmark-delete"
                          aria-label="Remove bookmark"
                          data-testid="reader-bookmark-delete"
                          onClick={() =>
                            void platform
                              .deleteBookmark(book.id, bookmark.id)
                              .then(refreshBookmarks)
                              .catch(() => {})
                          }
                        >
                          ×
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              <p className="reader-marks-cap">Highlights</p>
              <ul
                className="reader-bookmarks reader-annotations"
                data-testid="reader-annotations"
              >
                {annotations.length === 0 ? (
                  <li className="reader-empty">
                    No highlights yet. Select a passage to keep it.
                  </li>
                ) : (
                  annotations.map((annotation) => {
                    const locator = parseAnnotationLocator(annotation.locator);
                    const percent = Math.round(
                      (locator?.locations.totalProgression ??
                        locator?.locations.progression ??
                        0) * 100,
                    );
                    const chapter =
                      locator?.title ??
                      locator?.href?.split("/").pop()?.replace(/\.x?html?$/i, "");
                    return (
                      <li
                        key={annotation.id}
                        data-testid="reader-annotation-row"
                        data-kind={annotation.kind}
                      >
                        <button
                          type="button"
                          className="reader-bookmark-jump"
                          data-testid="reader-annotation-jump"
                          onClick={() => void jumpAnnotation(annotation)}
                        >
                          <span>
                            {locator?.text.highlight ?? "Saved highlight"}
                            {annotation.note ? (
                              <span
                                className="reader-note-marker"
                                aria-label="Has a note"
                                data-testid="reader-annotation-note-marker"
                              />
                            ) : null}
                          </span>
                          {annotation.note ? (
                            <em data-testid="reader-annotation-note">
                              {annotation.note}
                            </em>
                          ) : null}
                          <small>
                            {chapter ? `${chapter} · ` : ""}
                            {percent}%
                          </small>
                        </button>
                        <button
                          type="button"
                          className="reader-bookmark-delete"
                          aria-label="Edit note"
                          data-testid="reader-annotation-edit"
                          onClick={() => {
                            closeSheet();
                            setNoteEditor({
                              annotation,
                              text: annotation.note ?? "",
                            });
                          }}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="reader-bookmark-delete"
                          aria-label="Delete annotation"
                          data-testid="reader-annotation-delete"
                          onClick={() => void deleteAnnotation(annotation)}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ) : null}
        </ReaderDesk>
      ) : null}
    </section>
  );
}
