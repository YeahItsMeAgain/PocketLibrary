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
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  isApiError,
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
import { moveBookInList } from "./placement";

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

const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 8;
const EDGE_ZONE = 88;
const EDGE_MAX_SPEED = 14;
// Progressive mount: the first few shelves paint immediately, the rest mount
// just ahead of the viewport. Nodes are kept once mounted, so scroll position
// and drag geometry stay stable; `content-visibility` keeps far shelves cheap.
const INITIAL_SHELVES = 1;
const MOUNT_BATCH = 1;
const MOUNT_AHEAD_PX = 0;
const SHELF_UNIT_PX = 358;
const HINT_KEY = "pocketlibrary.dragHintSeen";

interface ShelfGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
  slots: Array<{ bookId: number; center: number }>;
}

interface DragPreview {
  bookId: number;
  shelfId: number;
  index: number;
}

interface DragGesture {
  book: Book;
  element: HTMLLIElement;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  liftScrollY: number;
  sourceRect: DOMRect;
  sourceIndex: number;
  timer: number;
  raf: number;
  lifted: boolean;
  movedPre: boolean;
  previewShelfId: number | null;
  previewIndex: number;
  cleanup: () => void;
}

interface LiftVisual {
  book: Book;
  left: number;
  top: number;
  width: number;
  height: number;
  returning: boolean;
  dx: number;
  dy: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [lift, setLift] = useState<LiftVisual | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
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
  const ghostRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const geometryRef = useRef<Map<number, ShelfGeometry>>(new Map());
  const flipRef = useRef<Map<number, { left: number; top: number }> | null>(
    null,
  );
  const suppressClickRef = useRef(0);
  const booksRef = useRef<Book[]>(books);
  const shelvesRef = useRef<Shelf[]>(shelves ?? []);
  const booksByIdRef = useRef<Map<number, Book>>(new Map());
  const filterRef = useRef<{
    selected: number[];
    status: ReadingStatus | null;
  }>({ selected: [], status: null });
  const focusedBookRef = useRef<number | null>(null);
  booksRef.current = books;
  shelvesRef.current = shelves ?? [];
  booksByIdRef.current = new Map(books.map((book) => [book.id, book]));

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
  }, []);

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

  const measureWall = useCallback(() => {
    const wall = wallRef.current;
    if (!wall) return;
    const startedAt = performance.now();
    const next = new Map<number, ShelfGeometry>();
    const shelfList = shelvesRef.current;
    const firstSection = wall.querySelector<HTMLElement>(
      "section[data-shelf-id]",
    );
    if (!firstSection || shelfList.length === 0) {
      geometryRef.current = next;
      return;
    }
    const firstId = Number(firstSection.dataset.shelfId);
    const firstIndex = Math.max(
      0,
      shelfList.findIndex((shelf) => shelf.id === firstId),
    );
    const scrollY = window.scrollY;
    const viewport = window.innerHeight || 844;
    const firstTop = firstSection.getBoundingClientRect().top + scrollY;
    // Shelf heights are fixed for a non-empty case, so the visible window can
    // be selected arithmetically. Only those few sections are measured; the
    // former whole-library sweep forced layout for every skipped shelf.
    const startIndex = Math.max(
      0,
      firstIndex + Math.floor((scrollY - firstTop) / SHELF_UNIT_PX) - 1,
    );
    const endIndex = Math.min(
      shelfList.length,
      firstIndex +
        Math.ceil((scrollY + viewport - firstTop) / SHELF_UNIT_PX) +
        2,
    );
    for (let index = startIndex; index < endIndex; index += 1) {
      const shelf = shelfList[index];
      if (!shelf) continue;
      const section = wall.querySelector<HTMLElement>(
        `section[data-shelf-id="${shelf.id}"]`,
      );
      if (!section) continue;
      const rect = section.getBoundingClientRect();
      if (rect.bottom < -240 || rect.top > viewport + 240) continue;
      const strip = section.querySelector<HTMLElement>(".spines");
      const stripRect = strip ? strip.getBoundingClientRect() : rect;
      const elements = strip
        ? Array.from(strip.querySelectorAll<HTMLElement>(":scope > .spine"))
        : [];
      const bookIds = elements.map((element) => Number(element.dataset.bookId));
      const nominal = bookIds.map((bookId) => {
        const book = booksByIdRef.current.get(bookId);
        return book ? spineStyle(book).width : 30;
      });
      const count = nominal.length;
      let widths = nominal;
      if (count > 1) {
        const total = nominal.reduce((sum, width) => sum + width, 0);
        const available = stripRect.width;
        if (total + (count - 1) > available) {
          const scale = Math.max(0, (available - (count - 1)) / total);
          widths = nominal.map((width) => width * scale);
        }
      }
      const widthTotal = widths.reduce((sum, width) => sum + width, 0);
      const gap =
        count > 1
          ? Math.max(
              0,
              (stripRect.width - widthTotal - (count - 1)) / (count - 1),
            ) + 1
          : 0;
      const slots: ShelfGeometry["slots"] = [];
      let cursor = count === 1 ? (stripRect.width - widths[0]) / 2 : 0;
      for (let slot = 0; slot < count; slot += 1) {
        slots.push({
          bookId: bookIds[slot],
          center: stripRect.left + cursor + widths[slot] / 2,
        });
        cursor += widths[slot] + gap;
      }
      next.set(shelf.id, {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        slots,
      });
    }
    geometryRef.current = next;
    try {
      performance.measure("pocketlibrary:measure-wall", {
        start: startedAt,
        end: performance.now(),
      });
    } catch {
      // Performance measurement is diagnostic only.
    }
  }, []);

  const captureSpineRects = useCallback((shelfIds: Set<number>) => {
    const positions = new Map<number, { left: number; top: number }>();
    wallRef.current
      ?.querySelectorAll<HTMLElement>("section[data-shelf-id]")
      .forEach((section) => {
        if (!shelfIds.has(Number(section.dataset.shelfId))) return;
        section
          .querySelectorAll<HTMLElement>(".spines > .spine")
          .forEach((element) => {
            const rect = element.getBoundingClientRect();
            positions.set(Number(element.dataset.bookId), {
              left: rect.left,
              top: rect.top,
            });
          });
      });
    return positions;
  }, []);

  useLayoutEffect(() => {
    const before = flipRef.current;
    flipRef.current = null;
    if (!before) return;
    before.forEach((start, bookId) => {
      const element = wallRef.current?.querySelector<HTMLElement>(
        `[data-book-id="${bookId}"]`,
      );
      if (!element) return;
      const end = element.getBoundingClientRect();
      const dx = start.left - end.left;
      const dy = start.top - end.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      element.style.transition = "none";
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      void element.offsetWidth;
      element.style.transition = "";
      window.requestAnimationFrame(() => {
        element.style.transform = "";
      });
    });
  }, [preview]);

  useEffect(() => {
    if (!lift) return;
    const refresh = () => {
      const gesture = gestureRef.current;
      if (!gesture?.lifted) return;
      measureWall();
      updateTarget(gesture);
    };
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [lift, measureWall]);

  const displayBooks = useMemo(() => {
    if (!preview || !shelves) return books;
    return moveBookInList(
      books,
      shelves,
      preview.bookId,
      preview.shelfId,
      preview.index,
    );
  }, [books, shelves, preview]);

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

  function updateGhost(gesture: DragGesture) {
    const ghost = ghostRef.current;
    if (!ghost) return;
    const dx = gesture.lastX - gesture.startX;
    const dy = gesture.lastY - gesture.startY;
    ghost.style.transform = `translate3d(${dx}px, ${dy - 8}px, 0) scale(1.04)`;
  }

  function shelfAtPoint(x: number, y: number): number | null {
    for (const [shelfId, geometry] of geometryRef.current) {
      if (
        x >= geometry.left &&
        x <= geometry.right &&
        y >= geometry.top &&
        y <= geometry.bottom
      ) {
        return shelfId;
      }
    }
    return null;
  }

  function updateTarget(gesture: DragGesture) {
    if (!gesture.lifted) return;
    const shelfId = shelfAtPoint(gesture.lastX, gesture.lastY);
    const moving = booksRef.current.find(
      (book) => book.id === gesture.book.id,
    );
    if (!moving) return;
    const targetShelf = shelfId
      ? shelvesRef.current.find((shelf) => shelf.id === shelfId)
      : undefined;
    const sameShelf = moving.shelfId === shelfId;
    const targetCount = shelfId
      ? booksRef.current.filter(
          (book) => book.shelfId === shelfId && book.id !== moving.id,
        ).length
      : 0;
    const full = !!targetShelf && !sameShelf && targetCount >= targetShelf.capacity;
    const geometry = shelfId ? geometryRef.current.get(shelfId) : undefined;

    if (shelfId === null || full || !geometry) {
      if (gesture.previewShelfId !== null) {
        const affected = new Set<number>();
        if (gesture.previewShelfId !== null) affected.add(gesture.previewShelfId);
        if (moving.shelfId !== null) affected.add(moving.shelfId);
        flipRef.current = captureSpineRects(affected);
        gesture.previewShelfId = null;
        gesture.previewIndex = gesture.sourceIndex;
        setPreview(null);
      }
      return;
    }

    const others = geometry.slots.filter(
      (slot) => slot.bookId !== gesture.book.id,
    );
    let index = 0;
    for (const slot of others) {
      if (gesture.lastX > slot.center) index += 1;
    }
    if (
      gesture.previewShelfId === shelfId &&
      gesture.previewIndex === index
    ) {
      return;
    }
    const affected = new Set<number>();
    if (moving.shelfId !== null) affected.add(moving.shelfId);
    if (gesture.previewShelfId !== null) affected.add(gesture.previewShelfId);
    affected.add(shelfId);
    flipRef.current = captureSpineRects(affected);
    gesture.previewShelfId = shelfId;
    gesture.previewIndex = index;
    setPreview({ bookId: moving.id, shelfId, index });
  }

  function beginLift(gesture: DragGesture) {
    if (gesture.lifted) return;
    measureWall();
    const rect = gesture.element.getBoundingClientRect();
    const shelfBooks = booksRef.current
      .filter((book) => book.shelfId === gesture.book.shelfId)
      .sort((left, right) => (left.slotIndex ?? 0) - (right.slotIndex ?? 0));
    const sourceIndex = Math.max(
      0,
      shelfBooks.findIndex((book) => book.id === gesture.book.id),
    );
    gesture.lifted = true;
    gesture.sourceRect = rect;
    gesture.sourceIndex = sourceIndex;
    gesture.previewShelfId = gesture.book.shelfId;
    gesture.previewIndex = sourceIndex;
    gesture.liftScrollY = window.scrollY;
    setLift({
      book: gesture.book,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      returning: false,
      dx: 0,
      dy: 0,
    });
    setPreview(
      gesture.book.shelfId === null
        ? null
        : {
            bookId: gesture.book.id,
            shelfId: gesture.book.shelfId,
            index: sourceIndex,
          },
    );
    document.documentElement.classList.add("is-book-dragging");
    dismissHint();
    if (navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {
        // Vibration is a nicety, not a requirement.
      }
    }

    const step = () => {
      const current = gestureRef.current;
      if (!current?.lifted) return;
      const height = window.innerHeight;
      const y = Math.max(0, Math.min(height, current.lastY));
      let dy = 0;
      if (y < EDGE_ZONE) {
        dy = -EDGE_MAX_SPEED * (1 - y / EDGE_ZONE);
      } else if (y > height - EDGE_ZONE) {
        dy = EDGE_MAX_SPEED * ((y - (height - EDGE_ZONE)) / EDGE_ZONE);
      }
      if (dy !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, dy);
        if (window.scrollY !== before) {
          measureWall();
          updateTarget(current);
        }
      }
      current.raf = window.requestAnimationFrame(step);
    };
    gesture.raf = window.requestAnimationFrame(step);
  }

  function returnBook(gesture: DragGesture) {
    const reduced = prefersReducedMotion();
    const scrollDelta = window.scrollY - gesture.liftScrollY;
    setPreview(null);
    setLift((current) =>
      current
        ? {
            ...current,
            returning: true,
            dx: 0,
            dy: -scrollDelta,
          }
        : current,
    );
    window.setTimeout(() => setLift(null), reduced ? 0 : 190);
  }

  function commitMove(
    gesture: DragGesture,
    shelfId: number,
    index: number,
  ) {
    const nextBooks = moveBookInList(
      booksRef.current,
      shelvesRef.current,
      gesture.book.id,
      shelfId,
      index,
    );
    platform
      .moveBook(gesture.book.id, shelfId, index)
      .then(() => {
        setBooks(nextBooks);
        setPreview(null);
        setLift(null);
        setMoveNotice(null);
      })
      .catch((error) => {
        setMoveNotice(
          isApiError(error)
            ? error.message
            : "That book could not be moved. Please try again.",
        );
        returnBook(gesture);
      });
  }

  function handlePointerMove(event: PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    if (!gesture.lifted) {
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (distance > DRAG_THRESHOLD) {
        window.clearTimeout(gesture.timer);
        gesture.timer = 0;
        gesture.movedPre = true;
      }
      return;
    }
    if (event.cancelable) event.preventDefault();
    updateGhost(gesture);
    updateTarget(gesture);
  }

  function handlePointerUp(event: PointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (event.type !== "pointercancel" && event.pointerId !== gesture.pointerId) {
      return;
    }
    gesture.cleanup();
    gestureRef.current = null;
    window.clearTimeout(gesture.timer);
    window.cancelAnimationFrame(gesture.raf);
    document.documentElement.classList.remove("is-book-dragging");

    if (!gesture.lifted) {
      const distance = Math.hypot(
        gesture.lastX - gesture.startX,
        gesture.lastY - gesture.startY,
      );
      if (gesture.movedPre || distance > DRAG_THRESHOLD) {
        suppressClickRef.current = performance.now() + 500;
      }
      return;
    }

    if (event.cancelable) event.preventDefault();
    suppressClickRef.current = performance.now() + 700;
    if (event.type === "pointercancel") {
      returnBook(gesture);
      return;
    }

    const shelfId = shelfAtPoint(gesture.lastX, gesture.lastY);
    const moving = booksRef.current.find(
      (book) => book.id === gesture.book.id,
    );
    const targetShelf = shelfId
      ? shelvesRef.current.find((shelf) => shelf.id === shelfId)
      : undefined;
    const geometry = shelfId ? geometryRef.current.get(shelfId) : undefined;
    if (!moving || !shelfId || !targetShelf || !geometry) {
      returnBook(gesture);
      return;
    }
    const sameShelf = moving.shelfId === shelfId;
    const targetCount = booksRef.current.filter(
      (book) => book.shelfId === shelfId && book.id !== moving.id,
    ).length;
    if (!sameShelf && targetCount >= targetShelf.capacity) {
      setMoveNotice("That shelf is already full.");
      returnBook(gesture);
      return;
    }
    const others = geometry.slots.filter(
      (slot) => slot.bookId !== moving.id,
    );
    let index = 0;
    for (const slot of others) {
      if (gesture.lastX > slot.center) index += 1;
    }
    commitMove(gesture, shelfId, index);
  }

  function startPress(book: Book, event: ReactPointerEvent<HTMLLIElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dismissHint();
    setMoveNotice(null);
    const element = event.currentTarget;
    const gesture: DragGesture = {
      book,
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      liftScrollY: window.scrollY,
      sourceRect: element.getBoundingClientRect(),
      sourceIndex: book.slotIndex ?? 0,
      timer: 0,
      raf: 0,
      lifted: false,
      movedPre: false,
      previewShelfId: null,
      previewIndex: 0,
      cleanup: () => {},
    };
    const onMove = (next: PointerEvent) => handlePointerMove(next);
    const onUp = (next: PointerEvent) => handlePointerUp(next);
    const onContext = (next: Event) => {
      if (gesture.lifted) next.preventDefault();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("contextmenu", onContext);
    gesture.cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("contextmenu", onContext);
    };
    gesture.timer = window.setTimeout(() => {
      const current = gestureRef.current;
      if (current && !current.lifted) beginLift(current);
    }, LONG_PRESS_MS);
    gestureRef.current = gesture;
  }

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

