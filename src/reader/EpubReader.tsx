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
  type Book,
  type Bookmark,
  type ReadingStatus,
} from "../platform";
import {
  applyReaderSettings,
  createFoliateView,
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
  const [sheetTab, setSheetTab] = useState<"chapters" | "bookmarks">(
    "chapters",
  );
  const [progress, setProgress] = useState(0);
  const [currentLocator, setCurrentLocator] = useState<ReaderLocator | null>(
    null,
  );
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkNotice, setBookmarkNotice] = useState<string | null>(null);
  const [externalNote, setExternalNote] = useState<string | null>(null);

  const openExternally = useCallback(async () => {
    try {
      await platform.openBookExternally(book.id);
      setExternalNote("Opened in another app. Your place is saved.");
    } catch (error) {
      setExternalNote(
        isApiError(error)
          ? error.message
          : "No other reader could be opened for this book.",
      );
    }
  }, [book.id]);

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

    const onLoad = (event: Event) => {
      const detail = (event as CustomEvent<{ doc: Document }>).detail;
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
    };

    view.addEventListener("relocate", onRelocate);
    view.addEventListener("load", onLoad);

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
      } catch (error) {
        if (cancelled) return;
        setFailed(
          isApiError(error)
            ? error.message
            : "This book could not be opened. Please try again.",
        );
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(persistTimer.current);
      const locator = latestLocator.current;
      if (locator) {
        void platform
          .recordProgress(book.id, locator.progress ?? 0, JSON.stringify(locator))
          .catch(() => {});
      }
      view.removeEventListener("relocate", onRelocate);
      view.removeEventListener("load", onLoad);
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
    setSheet(null);
  }, []);

  const jumpChapter = useCallback(async (item: FoliateTocItem) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      await view.goTo(item.href);
    } catch {
      // A broken TOC target should not tear down the reader.
    }
    setSheet(null);
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
        onClose={close}
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
            onClick={() => setSheet(null)}
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
            ) : (
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
            onClick={() => setSheet(null)}
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
