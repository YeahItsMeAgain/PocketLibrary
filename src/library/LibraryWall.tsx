import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  platform,
  type Book,
  type Label,
  type LabelUsage,
  type ReadingStatus,
  type Shelf,
} from "../platform";
import { ReportAction } from "../Diagnostics";
import { Masthead } from "../shell/Masthead";
import { FilterStrip } from "../labels/FilterStrip";
import { matchingBookIds } from "./filter";
import { LibrarySkeleton } from "./LibrarySkeleton";
import { ShelfCase, SpineFace } from "./Shelf";
import { SPINE_GOLD, SPINE_INK, shelfMark, shelfSpineStyle } from "./spine";
import { useSpineActivity } from "./spineActivity";
import {
  HINT_KEY,
  prefersReducedMotion,
  useShelfDrag,
} from "./useShelfDrag";
import {
  EAGER_SHELF_LIMIT,
  SHELF_UNIT_PX,
  computeShelfRange,
  mountedShelves,
  placeholderRanges,
  type ShelfRange,
} from "./window";

// The readers (and pdf.js/foliate behind them) are only needed after a tap.
// Keeping them out of the startup chunk protects first shelf time.
const EpubReader = lazy(() => import("../reader/EpubReader"));
const PdfReader = lazy(() => import("../reader/PdfReader"));
const DetailPanel = lazy(() =>
  import("./DetailPanel").then((module) => ({ default: module.DetailPanel })),
);
const ManageLabels = lazy(() =>
  import("../labels/ManageLabels").then((module) => ({
    default: module.ManageLabels,
  })),
);

interface LibraryWallProps {
  reloadKey: number;
  focusBookId: number | null;
  notice: string | null;
  noticeFailed: boolean;
  onAddBooks: () => void;
  onFindBook: () => void;
}

export function LibraryWall({
  reloadKey,
  focusBookId,
  notice,
  noticeFailed,
  onAddBooks,
  onFindBook,
}: LibraryWallProps) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [labels, setLabels] = useState<LabelUsage[]>([]);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const [readerBook, setReaderBook] = useState<Book | null>(null);
  const {
    spines: generatedSpines,
    jobs: spineJobs,
    readerOpened: pauseForReader,
    readerClosed: resumeAfterReader,
  } = useSpineActivity();
  const [range, setRange] = useState<ShelfRange>({ start: 0, end: 0 });
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [showHint, setShowHint] = useState(() => {
    try {
      return window.localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const closeDetail = useCallback(() => setOpenBookId(null), []);
  const openLabelManager = useCallback(() => setShowLabelManager(true), []);
  const wallRef = useRef<HTMLElement>(null);
  const shelfWindowRef = useRef<HTMLDivElement>(null);
  const windowTopRef = useRef<number | null>(null);
  const scrollFrameRef = useRef(0);
  const booksRef = useRef<Book[]>(books);
  const filterRef = useRef<{
    selected: number[];
    status: ReadingStatus | null;
  }>({ selected: [], status: null });
  const filterFrameRef = useRef(0);
  const focusedBookRef = useRef<number | null>(null);
  booksRef.current = books;

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
  }, []);

  const {
    displayBooks,
    lift,
    moveNotice,
    startPress,
    suppressClickRef,
    ghostRef,
    gestureRef,
  } = useShelfDrag({
    shelves,
    books,
    booksRef,
    wallRef,
    setBooks,
    dismissHint,
  });

  const refreshLabels = useCallback(async () => {
    try {
      setLabels(await platform.listLabels());
    } catch {
      // Keep the labels already on screen; the next reload retries.
    }
  }, []);

  const refreshWallData = useCallback(async () => {
    await refreshLabels();
    try {
      const next = await platform.listBooks();
      // The platform may return the same objects it mutated (the mock does);
      // memoised shelves need fresh references to pick up reader progress.
      setBooks(next.map((book) => ({ ...book })));
    } catch {
      // A failed refresh leaves the current wall in place.
    }
  }, [refreshLabels]);

  const updateBook = useCallback(
    (patch: {
      id: number;
      title?: string;
      authors?: string[];
      pageCount?: number | null;
      readingStatus?: ReadingStatus;
      labels?: Label[];
      spineStyle?: Book["spineStyle"];
    }) => {
      setBooks((current) =>
        current.map((book) =>
          book.id === patch.id
            ? {
                ...book,
                title: patch.title ?? book.title,
                authors: patch.authors ?? book.authors,
                pageCount:
                  patch.pageCount !== undefined
                    ? patch.pageCount
                    : book.pageCount,
                readingStatus: patch.readingStatus ?? book.readingStatus,
                labels: patch.labels ?? book.labels,
                spineStyle: patch.spineStyle ?? book.spineStyle,
              }
            : book,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    if (!readerBook) return;
    pauseForReader(readerBook.id);
    return () => resumeAfterReader();
  }, [readerBook, pauseForReader, resumeAfterReader]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    // The wall only waits for shelves and the book index. Label usage can
    // arrive a frame later; it only decorates the filter strip.
    Promise.all([platform.listShelves(), platform.listBooks()])
      .then(([nextShelves, nextBooks]) => {
        if (!alive) return;
        setRange({
          start: 0,
          end:
            nextShelves.length <= EAGER_SHELF_LIMIT
              ? nextShelves.length
              : 1,
        });
        setShelves(nextShelves);
        setBooks(nextBooks);
        window.requestAnimationFrame(() => {
          if (alive) void refreshLabels();
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, refreshLabels]);

  const measureWindowTop = useCallback(() => {
    const element = shelfWindowRef.current;
    if (!element) return;
    windowTopRef.current = element.getBoundingClientRect().top + window.scrollY;
  }, []);

  const updateWindow = useCallback(() => {
    if (!shelves) return;
    if (windowTopRef.current === null) measureWindowTop();
    const top = windowTopRef.current;
    if (top === null) return;
    const next = computeShelfRange(
      shelves.length,
      window.scrollY,
      window.innerHeight || 844,
      top,
    );
    if (
      rangeRef.current.start === next.start &&
      rangeRef.current.end === next.end
    ) {
      return;
    }
    rangeRef.current = next;
    startTransition(() => setRange(next));
  }, [shelves, measureWindowTop]);

  useEffect(() => {
    // Expand from the first case to the full scroll window after the first
    // shelf has painted. The first frame is the budget that matters; the
    // overscan is not needed until the user scrolls.
    const timer = window.setTimeout(
      () => {
        measureWindowTop();
        updateWindow();
      },
      shelves?.length && shelves.length > EAGER_SHELF_LIMIT ? 220 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [updateWindow, measureWindowTop, shelves]);

  useEffect(() => {
    if (!shelves) return;
    // Label chips and notices can change the strip height and therefore the
    // document offset of the shelf list. Re-anchor once they settle.
    measureWindowTop();
    updateWindow();
  }, [labels, shelves, measureWindowTop, updateWindow]);

  useEffect(() => {
    if (!shelves || shelves.length <= EAGER_SHELF_LIMIT) return;
    const onScroll = () => {
      if (scrollFrameRef.current !== 0) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = 0;
        updateWindow();
      });
    };
    const onResize = () => {
      measureWindowTop();
      onScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (scrollFrameRef.current !== 0) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = 0;
      }
    };
  }, [shelves, updateWindow, measureWindowTop]);

  useEffect(() => {
    if (focusBookId === null || focusedBookRef.current === focusBookId) return;
    let cancelled = false;
    let attempts = 0;
    const find = () =>
      wallRef.current?.querySelector<HTMLElement>(
        `[data-book-id="${focusBookId}"]`,
      ) ?? null;
    const tryReveal = () => {
      if (cancelled) return;
      const element = find();
      if (!element) {
        if (attempts < 8) {
          attempts += 1;
          window.setTimeout(tryReveal, 50);
        }
        return;
      }
      focusedBookRef.current = focusBookId;
      element.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };
    const shelfIndex =
      shelves?.findIndex(
        (shelf) =>
          shelf.id ===
          books.find((book) => book.id === focusBookId)?.shelfId,
      ) ?? -1;
    if (shelfIndex >= 0 && windowTopRef.current !== null) {
      const target =
        windowTopRef.current +
        shelfIndex * SHELF_UNIT_PX -
        (window.innerHeight || 844) / 2;
      if (Math.abs(window.scrollY - target) > window.innerHeight) {
        window.scrollTo({
          top: Math.max(0, target),
          behavior: "auto",
        });
      }
    }
    tryReveal();
    return () => {
      cancelled = true;
    };
  }, [books, focusBookId, shelves]);

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(dismissHint, 9000);
    return () => window.clearTimeout(timer);
  }, [showHint, dismissHint]);

  const applyFilterToDom = useCallback(
    (selected: number[], status: ReadingStatus | null) => {
      const wall = wallRef.current;
      if (!wall) return;
      const startedAt = performance.now();
      const active = selected.length > 0 || status !== null;
      const matching = active
        ? matchingBookIds(booksRef.current, selected, status)
        : new Set<number>();
      wall.querySelectorAll<HTMLElement>(".spine[data-book-id]").forEach(
        (element) => {
          const dimmed =
            active && !matching.has(Number(element.dataset.bookId));
          if (dimmed) {
            if (element.dataset.dimmed !== "true") {
              element.dataset.dimmed = "true";
            }
          } else if (element.dataset.dimmed !== undefined) {
            delete element.dataset.dimmed;
          }
        },
      );
      try {
        performance.measure("pocketlibrary:filter", {
          start: startedAt,
          end: performance.now(),
        });
      } catch {
        // Diagnostic only.
      }
    },
    [],
  );

  const handleFilter = useCallback(
    (selected: number[], status: ReadingStatus | null) => {
      filterRef.current = { selected, status };
      // A chip press paints its own state first; the data-attribute sweep runs
      // on the next frame, so the wall never renders and the input handler
      // itself stays short. This is the deferred equivalent of the wall
      // reconciling a filter value on every keystroke.
      if (filterFrameRef.current !== 0) {
        window.cancelAnimationFrame(filterFrameRef.current);
      }
      filterFrameRef.current = window.requestAnimationFrame(() => {
        filterFrameRef.current = 0;
        applyFilterToDom(selected, status);
      });
    },
    [applyFilterToDom],
  );

  useEffect(
    () => () => {
      if (filterFrameRef.current !== 0) {
        window.cancelAnimationFrame(filterFrameRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const { selected, status } = filterRef.current;
    applyFilterToDom(selected, status);
  }, [books, range.start, range.end, applyFilterToDom]);

  const booksByShelf = useMemo(() => {
    const grouped = new Map<number, Book[]>();
    for (const book of displayBooks) {
      if (book.shelfId === null) continue;
      const shelfBooks = grouped.get(book.shelfId);
      if (shelfBooks) shelfBooks.push(book);
      else grouped.set(book.shelfId, [book]);
    }
    return grouped;
  }, [displayBooks]);

  const pinnedShelfId = lift?.book.shelfId ?? null;
  const pinnedIndex =
    pinnedShelfId === null || !shelves
      ? null
      : shelves.findIndex((shelf) => shelf.id === pinnedShelfId);
  const slots = useMemo(
    () =>
      shelves
        ? mountedShelves(shelves.length, range, pinnedIndex)
        : [],
    [shelves, range, pinnedIndex],
  );
  const placeholders = useMemo(
    () => (shelves ? placeholderRanges(shelves.length, range) : []),
    [shelves, range],
  );

  if (failed) {
    return (
      <main
        id="library-main"
        className="placeholder"
        data-testid="library-error"
      >
        <section className="placeholder-card">
          <p className="kicker">The Keeper's Ledger</p>
          <h2>Library unavailable</h2>
          <p>The shelves could not be opened just now.</p>
          <ReportAction testId="library-report" label="Report" />
        </section>
      </main>
    );
  }

  if (shelves === null) {
    return <LibrarySkeleton />;
  }

  return (
    <main
      ref={wallRef}
      id="library-main"
      className="library-wall"
      data-testid="library-wall"
      data-rendered-shelves={slots.length}
      onContextMenu={(event) => {
        if (gestureRef.current?.lifted) event.preventDefault();
      }}
    >
      <Masthead volumeCount={books.length} caseCount={shelves.length} />
      <div className="wall-inner">
        <FilterStrip
          labels={labels}
          books={books}
          onApply={handleFilter}
          onManage={openLabelManager}
        />
        <div
          ref={shelfWindowRef}
          className="shelf-window"
          style={{ height: shelves.length * SHELF_UNIT_PX }}
          data-testid="shelf-window"
          data-shelf-total={shelves.length}
          data-shelf-range={`${range.start}-${range.end}`}
        >
          {placeholders.map((gap) => (
            <div
              key={`gap-${gap.start}`}
              className="v4-shelf-placeholder"
              data-shelf-placeholder="true"
              aria-hidden="true"
              style={{
                top: gap.start * SHELF_UNIT_PX,
                height: (gap.end - gap.start) * SHELF_UNIT_PX,
              }}
            />
          ))}
          {slots.map(({ index, slot }) => {
            const shelf = shelves[index];
            if (!shelf) return null;
            return (
              <div
                key={`slot-${slot}`}
                className="shelf-slot"
                data-shelf-slot={slot}
                data-shelf-index={index}
                style={{ top: index * SHELF_UNIT_PX }}
              >
                <ShelfCase
                  shelf={shelf}
                  books={booksByShelf.get(shelf.id) ?? []}
                  draggedBookId={lift?.book.id ?? null}
                  generatedSpines={generatedSpines}
                  spineJobs={spineJobs}
                  onOpen={(book) => {
                    if (performance.now() < suppressClickRef.current) return;
                    setOpenBookId(book.id);
                  }}
                  onPress={startPress}
                />
              </div>
            );
          })}
        </div>
      </div>
      {openBookId !== null ? (
        <Suspense fallback={null}>
          <DetailPanel
            bookId={openBookId}
            shelfLabel={
              shelfMark(
                shelves.find(
                  (shelf) =>
                    shelf.id ===
                    books.find((book) => book.id === openBookId)?.shelfId,
                )?.ordinal ?? 0,
              )
            }
            onClose={closeDetail}
            onRead={(book) => {
              setReaderBook(book);
              setOpenBookId(null);
            }}
            onBookChanged={updateBook}
            onLabelsChanged={refreshLabels}
            onDeleted={() => {
              setOpenBookId(null);
              void refreshWallData();
            }}
          />
        </Suspense>
      ) : null}
      {readerBook ? (
        <Suspense fallback={null}>
          {readerBook.format === "pdf" ? (
            <PdfReader
              book={readerBook}
              onClose={() => {
                setReaderBook(null);
                void refreshWallData();
              }}
            />
          ) : (
            <EpubReader
              book={readerBook}
              onClose={() => {
                setReaderBook(null);
                void refreshWallData();
              }}
            />
          )}
        </Suspense>
      ) : null}
      {showLabelManager ? (
        <Suspense fallback={null}>
          <ManageLabels
            onClose={() => setShowLabelManager(false)}
            onChanged={refreshWallData}
          />
        </Suspense>
      ) : null}
      {notice ? (
        <>
          <p
            className="scan-notice library-notice"
            role="status"
            data-testid="library-notice"
          >
            {notice}
          </p>
          {noticeFailed ? (
            <ReportAction testId="scan-report" label="Report" />
          ) : null}
        </>
      ) : null}
      {moveNotice ? (
        <p
          className="scan-notice library-notice"
          role="status"
          data-testid="move-notice"
        >
          {moveNotice}
        </p>
      ) : null}
      {showHint && books.length > 0 ? (
        <button
          type="button"
          className="drag-hint"
          data-testid="drag-hint"
          onClick={dismissHint}
        >
          Press and hold a book to move it
        </button>
      ) : null}
      {lift ? (
        <div className="book-drag-layer" aria-hidden="true">
          <div
            ref={ghostRef}
            className={`spine book drag-ghost${lift.returning ? " is-returning" : ""}`}
            style={
              {
                left: lift.left,
                top: lift.top,
                width: lift.width,
                height: lift.height,
                "--w": `${lift.width}px`,
                "--h": `${lift.height}px`,
                "--c1": shelfSpineStyle(lift.book).c1,
                "--c2": shelfSpineStyle(lift.book).c2,
                "--gold": SPINE_GOLD,
                "--ink": SPINE_INK,
                "--lean": "0deg",
                "--fs": shelfSpineStyle(lift.book).fontSize,
                transform: lift.returning
                  ? `translate3d(${lift.dx}px, ${lift.dy}px, 0) scale(1)`
                  : undefined,
              } as CSSProperties
            }
          >
            <SpineFace book={lift.book} />
          </div>
        </div>
      ) : null}
      {books.length === 0 ? (
        <div className="wall-actions" data-testid="empty-library-actions">
          <p className="wall-note">
            No volumes yet. The room is ready when you are.
          </p>
          <div className="wall-buttons">
            <button type="button" className="primary-action" onClick={onAddBooks}>
              Add books
            </button>
            <button type="button" className="secondary-action" onClick={onFindBook}>
              Find a book
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

