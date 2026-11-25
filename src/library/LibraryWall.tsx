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
import { ManageLabels } from "../labels/ManageLabels";
import { DetailPanel } from "./DetailPanel";
import { ShelfCase, SpineFace } from "./Shelf";
import { SPINE_GOLD, SPINE_INK, shelfMark, spineStyle } from "./spine";
import {
  HINT_KEY,
  SHELF_UNIT_PX,
  prefersReducedMotion,
  useShelfDrag,
} from "./useShelfDrag";

const INITIAL_SHELVES = 1;
const MOUNT_BATCH = 1;
const MOUNT_AHEAD_PX = 0;

// The readers (and pdf.js/foliate behind them) are only needed after a tap.
// Keeping them out of the startup chunk protects first shelf time.
const EpubReader = lazy(() => import("../reader/EpubReader"));
const PdfReader = lazy(() => import("../reader/PdfReader"));

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
  const [mountedShelves, setMountedShelves] = useState(INITIAL_SHELVES);
  const [showHint, setShowHint] = useState(() => {
    try {
      return window.localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const closeDetail = useCallback(() => setOpenBookId(null), []);
  const wallRef = useRef<HTMLElement>(null);
  const booksRef = useRef<Book[]>(books);
  const filterRef = useRef<{
    selected: number[];
    status: ReadingStatus | null;
  }>({ selected: [], status: null });
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
      readingStatus?: ReadingStatus;
      labels?: Label[];
    }) => {
      setBooks((current) =>
        current.map((book) =>
          book.id === patch.id
            ? {
                ...book,
                readingStatus: patch.readingStatus ?? book.readingStatus,
                labels: patch.labels ?? book.labels,
              }
            : book,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setMountedShelves(INITIAL_SHELVES);
    Promise.all([
      platform.listShelves(),
      platform.listBooks(),
      platform.listLabels(),
    ])
      .then(([nextShelves, nextBooks, nextLabels]) => {
        if (!alive) return;
        setMountedShelves(
          nextShelves.length <= 12 ? nextShelves.length : INITIAL_SHELVES,
        );
        setShelves(nextShelves);
        setBooks(nextBooks);
        setLabels(nextLabels);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!shelves || mountedShelves >= shelves.length) return;
    const sentinel = wallRef.current?.querySelector("[data-shelf-sentinel]");
    if (!sentinel) return;
    if (typeof IntersectionObserver === "undefined") {
      setMountedShelves(shelves.length);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        startTransition(() => {
          setMountedShelves((current) =>
            Math.min(shelves.length, current + MOUNT_BATCH),
          );
        });
      },
      { rootMargin: `${MOUNT_AHEAD_PX}px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shelves, mountedShelves]);

  useEffect(() => {
    if (focusBookId === null || focusedBookRef.current === focusBookId) return;
    const element = wallRef.current?.querySelector<HTMLElement>(
      `[data-book-id="${focusBookId}"]`,
    );
    if (!element) return;
    focusedBookRef.current = focusBookId;
    element.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [books, focusBookId]);

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(dismissHint, 9000);
    return () => window.clearTimeout(timer);
  }, [showHint, dismissHint]);

  const applyFilterToDom = useCallback(
    (selected: number[], status: ReadingStatus | null) => {
      const wall = wallRef.current;
      if (!wall) return;
      const active = selected.length > 0 || status !== null;
      const matching = new Set<number>();
      if (active) {
        for (const book of booksRef.current) {
          const worn = book.labels ?? [];
          if (
            selected.every((labelId) =>
              worn.some((label) => label.id === labelId),
            ) &&
            (status === null || book.readingStatus === status)
          ) {
            matching.add(book.id);
          }
        }
      }
      wall.querySelectorAll<HTMLElement>(".spine[data-book-id]").forEach(
        (element) => {
          const dimmed =
            active && !matching.has(Number(element.dataset.bookId));
          element.classList.toggle("is-dim", dimmed);
          if (dimmed) element.dataset.dimmed = "true";
          else delete element.dataset.dimmed;
        },
      );
    },
    [],
  );

  const handleFilter = useCallback(
    (selected: number[], status: ReadingStatus | null) => {
      filterRef.current = { selected, status };
      applyFilterToDom(selected, status);
    },
    [applyFilterToDom],
  );

  useLayoutEffect(() => {
    const { selected, status } = filterRef.current;
    applyFilterToDom(selected, status);
  }, [books, mountedShelves, applyFilterToDom]);

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
    return (
      <main
        id="library-main"
        className="library-wall"
        data-testid="library-wall"
        aria-busy="true"
      >
        <div className="wall-inner" />
      </main>
    );
  }

  return (
    <main
      ref={wallRef}
      id="library-main"
      className="library-wall"
      data-testid="library-wall"
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
          onManage={() => setShowLabelManager(true)}
        />
        {shelves.slice(0, mountedShelves).map((shelf) => (
          <ShelfCase
            key={shelf.id}
            shelf={shelf}
            books={booksByShelf.get(shelf.id) ?? []}
            draggedBookId={lift?.book.id ?? null}
            onOpen={(book) => {
              if (performance.now() < suppressClickRef.current) return;
              setOpenBookId(book.id);
            }}
            onPress={startPress}
          />
        ))}
        {mountedShelves < shelves.length ? (
          <>
            <div className="v4-shelf-sentinel" data-shelf-sentinel="true" aria-hidden="true" />
            <div
              className="v4-shelf-spacer"
              style={{ height: (shelves.length - mountedShelves) * SHELF_UNIT_PX }}
              aria-hidden="true"
            />
          </>
        ) : null}
      </div>
      {openBookId !== null ? (
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
        />
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
        <ManageLabels
          onClose={() => setShowLabelManager(false)}
          onChanged={refreshWallData}
        />
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
                "--c1": spineStyle(lift.book).c1,
                "--c2": spineStyle(lift.book).c2,
                "--gold": SPINE_GOLD,
                "--ink": SPINE_INK,
                "--lean": "0deg",
                "--fs": spineStyle(lift.book).fontSize,
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

