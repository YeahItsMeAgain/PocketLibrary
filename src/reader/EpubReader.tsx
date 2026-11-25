import {
  useCallback,
  useEffect,
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
  type ReaderTheme,
} from "./settings";
import { ReaderPersistentChrome, useReaderExit } from "./ReaderControls";

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

type Sheet = "contents" | "type" | null;
type ContentsTab = "chapters" | "bookmarks" | "annotations";

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

const THEME_ORDER: ReaderTheme[] = ["paper", "sepia", "night"];

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
      view.resolveCFI(locator.cfi);
      return locator.cfi;
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
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [toc, setToc] = useState<Array<FoliateTocItem & { depth: number }>>([]);
  const [chrome, setChrome] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetTab, setSheetTab] = useState<ContentsTab>("chapters");
  const [progress, setProgress] = useState(0);
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
  // the open sheet first, then the reader on the next press.
  const closeSheet = useLayerExit(sheet !== null, () => setSheet(null));
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

  useEffect(() => {
    saveReaderSettings(settings);
    if (!ready) return;
    const view = viewRef.current;
    if (view) applyReaderSettings(view, settings);
  }, [settings, ready]);

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
      const detail = (event as CustomEvent<FoliateRelocate>).detail;
      if (!detail) return;
      const fraction = readFraction(detail);
      const cfi = detail.cfi;
      const quote = quoteFromRange(detail.range);
      const locator: ReaderLocator = { v: 1, cfi, quote, progress: fraction };
      setProgress(fraction);
      setCurrentLocator(locator);
      setCurrentHref(detail.tocItem?.href ?? null);
      currentChapterRef.current = detail.tocItem?.label;
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
        else setChrome((visible) => !visible);
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
        const state = await platform.readingState(book.id);
        const locator = parseLocator(state.locator);
        await platform.recordOpen(book.id);
        if (cancelled) return;
        const start = await resolveStart(view, locator);
        await view.init({ lastLocation: start, showTextStart: !start });
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

  const jumpAnnotation = useCallback(async (annotation: Annotation) => {
    const view = viewRef.current;
    if (!view) return;
    const locator = parseAnnotationLocator(annotation.locator);
    const target =
      resolvedAnnotations.current.get(annotation.id) ??
      locator?.locations.fragments[0] ??
      locator?.href;
    if (!target) return;
    try {
      await view.goTo(target);
    } catch {
      // Keep the annotation list usable even when this rendering cannot jump.
    }
    closeSheet();
    setActiveAnnotation(null);
  }, []);

  const jumpBookmark = useCallback(async (bookmark: Bookmark) => {
    const locator = parseLocator(bookmark.locator);
    if (!locator?.cfi) return;
    const view = viewRef.current;
    if (!view) return;
    try {
      await view.goTo(locator.cfi);
    } catch {
      // The bookmark stays in the list even if this rendering cannot find it.
    }
    closeSheet();
  }, []);

  const jumpChapter = useCallback(async (item: FoliateTocItem) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      await view.goTo(item.href);
    } catch {
      // A broken TOC target should not tear down the reader.
    }
    closeSheet();
  }, []);

  const cycleTheme = useCallback(() => {
    const index = THEME_ORDER.indexOf(settings.theme);
    update({ theme: THEME_ORDER[(index + 1) % THEME_ORDER.length] });
  }, [settings.theme, update]);

  const theme = READER_THEMES[settings.theme];
  const percent = Math.round(progress * 100);

  return (
    <section
      className="reader"
      data-testid="reader"
      data-theme={settings.theme}
      data-mode={settings.mode}
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
      <div className="reader-stage" ref={containerRef} />

      <ReaderPersistentChrome
        progress={progress}
        label={`${percent}%`}
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

      <header
        className={`reader-bar reader-top${chrome ? " is-visible" : ""}`}
        aria-hidden={!chrome}
      >
        <button
          type="button"
          className="reader-back"
          data-testid="reader-back"
          aria-label="Back to shelf"
          onClick={close}
        >
          <span aria-hidden="true">←</span> Shelf
        </button>
        <button
          type="button"
          className="reader-top-action"
          data-testid="reader-contents"
          onClick={() => {
            setSheet("contents");
            setSheetTab("chapters");
          }}
        >
          Contents
        </button>
        <span className="reader-progress" data-testid="reader-progress">
          {percent}%
        </span>
        <button
          type="button"
          className="reader-top-action"
          data-testid="reader-external"
          onClick={() => void openExternally()}
        >
          Open in another app
        </button>
      </header>

      <footer
        className={`reader-bar reader-bottom${chrome ? " is-visible" : ""}`}
        aria-hidden={!chrome}
      >
        <button
          type="button"
          className="reader-bottom-action"
          data-testid="reader-type"
          onClick={() => setSheet("type")}
        >
          Aa <span>Type</span>
        </button>
        <button
          type="button"
          className="reader-bottom-action"
          data-testid="reader-theme"
          aria-label={`Theme: ${theme.name}`}
          onClick={cycleTheme}
        >
          ◐ <span>{theme.name}</span>
        </button>
        <button
          type="button"
          className={`reader-bottom-action${
            currentBookmark ? " is-active" : ""
          }`}
          data-testid="reader-bookmark"
          aria-label={currentBookmark ? "Remove bookmark" : "Add bookmark"}
          onClick={() => void toggleBookmark()}
        >
          <span aria-hidden="true">{currentBookmark ? "🔖" : "▽"}</span>
          <span>{currentBookmark ? "Bookmarked" : "Bookmark"}</span>
        </button>
      </footer>

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

      {sheet === "contents" ? (
        <>
          <button
            type="button"
            className="reader-scrim"
            aria-label="Close contents"
            onClick={() => closeSheet()}
          />
          <section
            className="reader-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Contents and bookmarks"
            data-testid="reader-contents-sheet"
          >
            <div className="reader-sheet-grip" aria-hidden="true" />
            <div className="reader-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "chapters"}
                data-testid="reader-tab-chapters"
                onClick={() => setSheetTab("chapters")}
              >
                Chapters
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "bookmarks"}
                data-testid="reader-tab-bookmarks"
                onClick={() => setSheetTab("bookmarks")}
              >
                Bookmarks
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === "annotations"}
                data-testid="reader-tab-annotations"
                onClick={() => setSheetTab("annotations")}
              >
                Annotations
              </button>
            </div>
            {sheetTab === "chapters" ? (
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
                          {current ? <span aria-hidden="true">❧</span> : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ol>
            ) : sheetTab === "bookmarks" ? (
              <ul className="reader-bookmarks" data-testid="reader-bookmarks">
                {bookmarks.length === 0 ? (
                  <li className="reader-empty">
                    No bookmarks yet. Use the ribbon in the bottom bar.
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
            ) : (
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
            )}
          </section>
        </>
      ) : null}

      {sheet === "type" ? (
        <>
          <button
            type="button"
            className="reader-scrim"
            aria-label="Close type settings"
            onClick={() => closeSheet()}
          />
          <section
            className="reader-sheet reader-type-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Type and theme"
            data-testid="reader-type-sheet"
          >
            <div className="reader-sheet-grip" aria-hidden="true" />
            <div className="reader-type-group" role="group" aria-label="Mode">
              <span className="reader-type-label">Reading</span>
              <div className="reader-segment">
                <button
                  type="button"
                  aria-pressed={settings.mode === "paginated"}
                  data-testid="reader-mode-paginated"
                  onClick={() => update({ mode: "paginated" })}
                >
                  Paginated
                </button>
                <button
                  type="button"
                  aria-pressed={settings.mode === "scrolled"}
                  data-testid="reader-mode-scrolled"
                  onClick={() => update({ mode: "scrolled" })}
                >
                  Scroll
                </button>
              </div>
            </div>
            <div className="reader-type-group" role="group" aria-label="Text size">
              <span className="reader-type-label">Size</span>
              <div className="reader-segment">
                {READER_SIZES.map((entry, index) => (
                  <button
                    key={entry.name}
                    type="button"
                    aria-pressed={settings.size === index}
                    aria-label={entry.name}
                    data-testid={`reader-size-${index}`}
                    onClick={() => update({ size: index })}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>
            <div className="reader-type-group" role="group" aria-label="Line spacing">
              <span className="reader-type-label">Spacing</span>
              <div className="reader-segment">
                {READER_SPACINGS.map((entry, index) => (
                  <button
                    key={entry.name}
                    type="button"
                    aria-pressed={settings.spacing === index}
                    data-testid={`reader-spacing-${index}`}
                    onClick={() => update({ spacing: index })}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="reader-type-group" role="group" aria-label="Margins">
              <span className="reader-type-label">Margins</span>
              <div className="reader-segment">
                {READER_MARGINS.map((entry, index) => (
                  <button
                    key={entry.name}
                    type="button"
                    aria-pressed={settings.margin === index}
                    data-testid={`reader-margin-${index}`}
                    onClick={() => update({ margin: index })}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="reader-type-group" role="group" aria-label="Typeface">
              <span className="reader-type-label">Typeface</span>
              <div className="reader-segment reader-fonts">
                {READER_FONTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={settings.font === entry.id}
                    data-testid={`reader-font-${entry.id}`}
                    style={{ fontFamily: `'${entry.family}', serif` }}
                    onClick={() => update({ font: entry.id })}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="reader-type-group" role="group" aria-label="Theme">
              <span className="reader-type-label">Theme</span>
              <div className="reader-segment">
                {THEME_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={settings.theme === id}
                    data-testid={`reader-theme-${id}`}
                    onClick={() => update({ theme: id })}
                  >
                    {READER_THEMES[id].name}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
