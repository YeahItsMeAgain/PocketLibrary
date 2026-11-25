import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import {
  isApiError,
  platform,
  type Book,
  type Bookmark,
} from "../platform";
import { ReportAction } from "../Diagnostics";
import { noteFailure } from "../diagnostics";
import {
  openPdf,
  pageSize,
  parsePdfLocator,
  readOutline,
  renderPage,
  type PdfLocator,
  type PdfOutlineEntry,
} from "./pdf";
import {
  READER_THEMES,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
  type ReaderTheme,
} from "./settings";
import { ReaderPersistentChrome, useReaderExit } from "./ReaderControls";
import { useLayerExit } from "../navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "./pdf.css";

interface PdfReaderProps {
  book: Book;
  onClose: () => void;
}

type Sheet = "contents" | "zoom" | null;

const THEME_ORDER: ReaderTheme[] = ["paper", "sepia", "night"];
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3.5;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function progressForPage(page: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(page / total, 0, 1);
}

function locatorForPage(page: number, total: number): PdfLocator {
  return {
    v: 1,
    page,
    progress: progressForPage(page, total),
    quote: `Page ${page}`,
  };
}

function touchDistance(touches: TouchList): number {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export default function PdfReader({ book, onClose }: PdfReaderProps) {
  const close = useReaderExit(onClose);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTask = useRef<{ cancel(): void } | null>(null);
  const latestLocator = useRef<PdfLocator | null>(null);
  const persistTimer = useRef(0);
  const zoomRef = useRef(1);
  const pageRef = useRef(1);
  const totalRef = useRef(0);
  const suppressClick = useRef(0);

  const [settings, setSettings] = useState<ReaderSettings>(() =>
    loadReaderSettings(),
  );
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [progress, setProgress] = useState(0);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [zoom, setZoom] = useState(1);
  const [stageWidth, setStageWidth] = useState(0);
  const [chrome, setChrome] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [sheetTab, setSheetTab] = useState<"chapters" | "bookmarks">(
    "chapters",
  );
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkNotice, setBookmarkNotice] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const [rendering, setRendering] = useState(true);

  pageRef.current = pageNumber;
  totalRef.current = numPages;
  zoomRef.current = zoom;

  // The Contents and Zoom sheets unwind before the reader in the shared stack.
  const closeSheet = useLayerExit(sheet !== null, () => setSheet(null));

  const persist = useCallback(
    (page: number, total: number, immediate = false) => {
      if (total <= 0) return;
      const locator = locatorForPage(page, total);
      latestLocator.current = locator;
      window.clearTimeout(persistTimer.current);
      const write = () => {
        void platform
          .recordProgress(book.id, locator.progress ?? 0, JSON.stringify(locator))
          .catch(() => {});
      };
      if (immediate) write();
      else persistTimer.current = window.setTimeout(write, 450);
    },
    [book.id],
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
  }, [settings]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageWidth(stage.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Open the document once, restore the page, and keep the PDF alive until the
  // reader closes. A whole-file read is the M1 transport; large PDFs are
  // rejected before PDF.js takes ownership of the bytes.
  useEffect(() => {
    let cancelled = false;
    const opened: { destroy: (() => Promise<void>) | null } = { destroy: null };

    (async () => {
      try {
        const bytes = await platform.readBook(book.id);
        if (cancelled) return;
        if (bytes.byteLength > MAX_PDF_BYTES) {
          setFailed(
            "This PDF is larger than 100 MB, which is too large to hold in memory on this device. Open it in another app instead.",
          );
          return;
        }
        const opened_pdf = await openPdf(bytes);
        if (cancelled) {
          void opened_pdf.destroy();
          return;
        }
        const pdf = opened_pdf.doc;
        opened.destroy = opened_pdf.destroy;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        totalRef.current = pdf.numPages;
        void readOutline(pdf)
          .then((entries) => {
            if (!cancelled) setOutline(entries);
          })
          .catch(() => {});

        const state = await platform.readingState(book.id);
        const saved = parsePdfLocator(state.locator);
        const page = clamp(saved?.page ?? 1, 1, pdf.numPages);
        await platform.recordOpen(book.id);
        if (cancelled) return;
        setPageNumber(page);
        pageRef.current = page;
        setPageInput(String(page));
        setProgress(progressForPage(page, pdf.numPages));
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        const message = isApiError(error)
          ? error.message
          : "This PDF could not be opened. It may be damaged or password protected.";
        noteFailure();
        void platform
          .logDiagnostic("error", "reader.failed", `${book.title}: ${message}`)
          .catch(() => {});
        setFailed(message);
      }
    })();

    return () => {
      cancelled = true;
      renderTask.current?.cancel();
      void opened.destroy?.();
      pdfRef.current = null;
    };
  }, [book.id]);

  // Paint the current page. Fit-width is the baseline; `zoom` multiplies it.
  useEffect(() => {
    if (!ready) return;
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!pdf || !canvas || !text) return;
    let cancelled = false;
    renderTask.current?.cancel();
    renderTask.current = null;
    setRendering(true);

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const size = await pageSize(page);
        if (cancelled) return;
        // The stage is at least a phone width once mounted; 24px is the
        // breathing room on either side.
        const available =
          stageWidth > 0 ? Math.max(160, stageWidth - 24) : size.width;
        await renderPage({
          page,
          canvas,
          textContainer: text,
          availableWidth: available,
          zoom,
          onTask: (task) => {
            if (cancelled) task.cancel();
            else renderTask.current = task;
          },
        });
        if (cancelled) return;
        setRendering(false);
      } catch (error) {
        if (cancelled) return;
        setRendering(false);
        setFailed(
          error instanceof Error && error.name === "PasswordException"
            ? "This PDF is password protected and cannot be opened here."
            : "This page could not be drawn. Please try another page.",
        );
      }
    })();

    return () => {
      cancelled = true;
      renderTask.current?.cancel();
    };
  }, [ready, pageNumber, zoom, stageWidth]);

  // Persist each settled page turn. The end of the book also resolves status.
  useEffect(() => {
    if (!ready || numPages <= 0) return;
    const nextProgress = progressForPage(pageNumber, numPages);
    setProgress(nextProgress);
    setPageInput(String(pageNumber));
    persist(pageNumber, numPages, pageNumber >= numPages);
  }, [pageNumber, numPages, ready, persist]);

  useEffect(() => {
    return () => {
      window.clearTimeout(persistTimer.current);
      const locator = latestLocator.current;
      if (locator) {
        void platform
          .recordProgress(book.id, locator.progress ?? 0, JSON.stringify(locator))
          .catch(() => {});
      }
    };
  }, [book.id]);

  const turn = useCallback(
    (direction: "prev" | "next") => {
      const total = totalRef.current;
      if (total <= 0) return;
      const target =
        direction === "prev"
          ? Math.max(1, pageRef.current - 1)
          : Math.min(total, pageRef.current + 1);
      if (target === pageRef.current) return;
      setChrome(false);
      setPageNumber(target);
    },
    [],
  );

  const goToPage = useCallback((page: number) => {
    const total = totalRef.current;
    if (total <= 0) return;
    setPageNumber(clamp(Math.round(page), 1, total));
  }, []);

  // Native touch listeners: React's synthetic touch handlers cannot guarantee
  // a non-passive listener, and pinch needs preventDefault.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let pinch: { distance: number; zoom: number } | null = null;
    let pan: { x: number; y: number; left: number; top: number } | null = null;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { distance: touchDistance(event.touches), zoom: zoomRef.current };
        pan = null;
        suppressClick.current = Date.now();
      } else if (event.touches.length === 1 && zoomRef.current !== 1) {
        const touch = event.touches[0];
        pan = {
          x: touch.clientX,
          y: touch.clientY,
          left: stage.scrollLeft,
          top: stage.scrollTop,
        };
      }
    };

    const onMove = (event: TouchEvent) => {
      if (pinch && event.touches.length >= 2) {
        event.preventDefault();
        const ratio = touchDistance(event.touches) / Math.max(1, pinch.distance);
        setZoom(clamp(pinch.zoom * ratio, ZOOM_MIN, ZOOM_MAX));
        suppressClick.current = Date.now();
      } else if (pan && event.touches.length === 1) {
        const touch = event.touches[0];
        const dx = touch.clientX - pan.x;
        const dy = touch.clientY - pan.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          event.preventDefault();
          stage.scrollLeft = pan.left - dx;
          stage.scrollTop = pan.top - dy;
          suppressClick.current = Date.now();
        }
      }
    };

    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
      if (event.touches.length === 0) pan = null;
    };

    stage.addEventListener("touchstart", onStart, { passive: true });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onEnd, { passive: true });
    stage.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() - suppressClick.current < 400) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const target = event.target as Element | null;
      if (target && typeof target.closest === "function" && target.closest("a")) {
        return;
      }
      const ratio = event.clientX / Math.max(1, window.innerWidth);
      if (ratio < 1 / 3) turn("prev");
      else if (ratio > 2 / 3) turn("next");
      else setChrome((visible) => !visible);
    },
    [turn],
  );

  const currentLocator = useMemo(
    () => (numPages > 0 ? locatorForPage(pageNumber, numPages) : null),
    [pageNumber, numPages],
  );

  const currentBookmark = useMemo(
    () =>
      bookmarks.find(
        (bookmark) => parsePdfLocator(bookmark.locator)?.page === pageNumber,
      ) ?? null,
    [bookmarks, pageNumber],
  );

  const currentOutline = useMemo(() => {
    let match: PdfOutlineEntry | null = null;
    for (const entry of outline) {
      if (entry.page <= pageNumber) match = entry;
      else break;
    }
    return match;
  }, [outline, pageNumber]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const cycleTheme = useCallback(() => {
    const index = THEME_ORDER.indexOf(settings.theme);
    update({ theme: THEME_ORDER[(index + 1) % THEME_ORDER.length] });
  }, [settings.theme, update]);

  const toggleBookmark = useCallback(async () => {
    if (!currentLocator) return;
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

  const jumpBookmark = useCallback(
    (bookmark: Bookmark) => {
      const locator = parsePdfLocator(bookmark.locator);
      if (!locator) return;
      goToPage(locator.page);
      closeSheet();
    },
    [goToPage],
  );

  const submitPage = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const page = Number(pageInput);
      if (!Number.isFinite(page)) {
        setPageInput(String(pageNumber));
        return;
      }
      goToPage(page);
      setChrome(false);
    },
    [goToPage, pageInput, pageNumber],
  );

  const theme = READER_THEMES[settings.theme];
  const percent = Math.round(progress * 100);
  const zoomLabel = zoom === 1 ? "Fit width" : `${Math.round(zoom * 100)}%`;

  return (
    <section
      className="reader pdf-reader"
      data-testid="reader"
      data-format="pdf"
      data-theme={settings.theme}
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
      <div
        className="reader-stage pdf-stage"
        ref={stageRef}
        data-testid="pdf-stage"
        onClick={onStageClick}
      >
        <div className="pdf-page-wrap">
          <div
            className="pdf-page"
            data-testid="pdf-page"
          >
            <canvas ref={canvasRef} className="pdf-canvas" />
            <div
              ref={textRef}
              className="textLayer pdf-text-layer"
              data-testid="pdf-text-layer"
            />
            <div
              className={`pdf-tint pdf-tint-${settings.theme}`}
              data-testid="pdf-tint"
              aria-hidden="true"
            />
          </div>
        </div>
        {rendering && ready ? (
          <span className="pdf-rendering" aria-hidden="true" />
        ) : null}
      </div>

      <ReaderPersistentChrome
        progress={progress}
        label={`${percent}% · ${pageNumber}/${numPages || "—"}`}
        onClose={close}
      />

      {!ready && !failed ? (
        <div className="reader-loading" data-testid="reader-loading">
          <p className="kicker">Opening the folio</p>
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
        <form className="pdf-page-jump" onSubmit={submitPage}>
          <label className="pdf-sr-only" htmlFor="pdf-page-input">
            Page number
          </label>
          <input
            id="pdf-page-input"
            data-testid="reader-page-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={numPages || 1}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
          />
          <span aria-hidden="true">/ {numPages || "—"}</span>
          <button type="submit" data-testid="reader-page-go">
            Go
          </button>
        </form>
      </header>

      <footer
        className={`reader-bar reader-bottom${chrome ? " is-visible" : ""}`}
        aria-hidden={!chrome}
      >
        <button
          type="button"
          className="reader-bottom-action"
          data-testid="reader-zoom"
          onClick={() => setSheet("zoom")}
        >
          <span aria-hidden="true">⤢</span>
          <span>Zoom</span>
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

      {bookmarkNotice ? (
        <p
          className="reader-toast"
          role="alert"
          data-testid="reader-bookmark-notice"
        >
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
                Contents
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
            </div>
            {sheetTab === "chapters" ? (
              <ol className="reader-toc" data-testid="reader-toc">
                {outline.length === 0 ? (
                  <li className="reader-empty">
                    This PDF has no outline. Use the page number to jump.
                  </li>
                ) : (
                  outline.map((item) => {
                    const current = item === currentOutline;
                    return (
                      <li key={`${item.page}-${item.title}-${item.depth}`}>
                        <button
                          type="button"
                          className="reader-toc-item"
                          data-testid="reader-toc-item"
                          data-current={current || undefined}
                          aria-current={current ? "location" : undefined}
                          style={{ paddingLeft: 14 + item.depth * 16 }}
                          onClick={() => {
                            goToPage(item.page);
                            closeSheet();
                          }}
                        >
                          <span>{item.title}</span>
                          <small>{item.page}</small>
                        </button>
                      </li>
                    );
                  })
                )}
              </ol>
            ) : (
              <ul className="reader-bookmarks" data-testid="reader-bookmarks">
                {bookmarks.length === 0 ? (
                  <li className="reader-empty">
                    No bookmarks yet. Use the ribbon in the bottom bar.
                  </li>
                ) : (
                  bookmarks.map((bookmark) => {
                    const locator = parsePdfLocator(bookmark.locator);
                    return (
                      <li key={bookmark.id} data-testid="reader-bookmark-row">
                        <button
                          type="button"
                          className="reader-bookmark-jump"
                          onClick={() => jumpBookmark(bookmark)}
                        >
                          <span>{locator?.quote ?? "Saved page"}</span>
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
            )}
          </section>
        </>
      ) : null}

      {sheet === "zoom" ? (
        <>
          <button
            type="button"
            className="reader-scrim"
            aria-label="Close zoom settings"
            onClick={() => closeSheet()}
          />
          <section
            className="reader-sheet reader-type-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Zoom and theme"
            data-testid="reader-zoom-sheet"
          >
            <div className="reader-sheet-grip" aria-hidden="true" />
            <div className="reader-type-group" role="group" aria-label="Zoom">
              <span className="reader-type-label">Zoom</span>
              <div className="reader-segment pdf-zoom-controls">
                <button
                  type="button"
                  data-testid="reader-zoom-out"
                  aria-label="Zoom out"
                  onClick={() => setZoom((value) => clamp(value - 0.25, ZOOM_MIN, ZOOM_MAX))}
                >
                  −
                </button>
                <button
                  type="button"
                  data-testid="reader-fit-width"
                  aria-pressed={zoom === 1}
                  onClick={() => setZoom(1)}
                >
                  Fit width
                </button>
                <button
                  type="button"
                  data-testid="reader-zoom-in"
                  aria-label="Zoom in"
                  onClick={() => setZoom((value) => clamp(value + 0.25, ZOOM_MIN, ZOOM_MAX))}
                >
                  +
                </button>
              </div>
            </div>
            <p className="pdf-zoom-value" data-testid="reader-zoom-value">
              {zoomLabel}
            </p>
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
            <p className="pdf-note">
              PDF pages keep their own layout. Themes are a wash of colour over
              the page, and pinching zooms without reflowing the text.
            </p>
          </section>
        </>
      ) : null}
    </section>
  );
}
