import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";

import { isApiError, platform, type Book, type Shelf } from "../platform";
import { moveBookInList } from "./placement";
import { SHELF_UNIT_PX } from "./window";

const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 8;
const EDGE_ZONE = 88;
const EDGE_MAX_SPEED = 14;
// The wall mounts a scroll window and reuses slot nodes. Geometry is measured
// only for the few mounted cases, so a lift never forces layout across the
// whole library.
export { SHELF_UNIT_PX } from "./window";
export const HINT_KEY = "pocketlibrary.dragHintSeen";

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

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}


interface UseShelfDragOptions {
  shelves: Shelf[] | null;
  books: Book[];
  booksRef: RefObject<Book[]>;
  wallRef: RefObject<HTMLElement | null>;
  setBooks: Dispatch<SetStateAction<Book[]>>;
  dismissHint: () => void;
}

export function useShelfDrag({
  shelves,
  books,
  booksRef,
  wallRef,
  setBooks,
  dismissHint,
}: UseShelfDragOptions) {
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [lift, setLift] = useState<LiftVisual | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const geometryRef = useRef<Map<number, ShelfGeometry>>(new Map());
  const flipRef = useRef<Map<number, { left: number; top: number }> | null>(
    null,
  );
  const suppressClickRef = useRef(0);
  const shelvesRef = useRef<Shelf[]>(shelves ?? []);
  shelvesRef.current = shelves ?? [];

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
      // Derive slot centres from the laid-out spines themselves instead of
      // re-deriving the flex distribution. That keeps drag geometry in step
      // with the packed-left shelf, with flex shrink, and with the preview
      // reorder that replaces the DOM order mid-gesture. offsetLeft and
      // offsetWidth are layout values, so the lean rotation and the FLIP
      // transforms never skew the measurement.
      const strip = section.querySelector<HTMLElement>(".spines");
      const stripRect = strip ? strip.getBoundingClientRect() : rect;
      const elements = strip
        ? Array.from(strip.querySelectorAll<HTMLElement>(":scope > .spine"))
        : [];
      const slots: ShelfGeometry["slots"] = elements.map((element) => ({
        bookId: Number(element.dataset.bookId),
        center: stripRect.left + element.offsetLeft + element.offsetWidth / 2,
      }));
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
    // A preview reorders the spines that are already mounted, so the slot
    // centres cached at lift no longer describe the screen. Re-measure before
    // the FLIP effect applies its visual offsets; the next pointer move and
    // the drop then use the geometry the user can actually see.
    if (preview && gestureRef.current?.lifted) measureWall();
  }, [preview, measureWall]);

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

  /** Insertion index for a pointer x, counting the other books to its left. */
  function insertionIndex(
    geometry: ShelfGeometry,
    bookId: number,
    x: number,
  ): number {
    let index = 0;
    for (const slot of geometry.slots) {
      if (slot.bookId === bookId) continue;
      if (x > slot.center) index += 1;
    }
    return index;
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

    const index = insertionIndex(geometry, gesture.book.id, gesture.lastX);
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
      // The source may be leaning; its transformed bounding box is wider than
      // the spine. The ghost must keep the spine's own box so its fitted title
      // and panels match the shelf exactly.
      width: gesture.element.offsetWidth,
      height: gesture.element.offsetHeight,
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
    const previousBooks = booksRef.current;
    const nextBooks = moveBookInList(
      previousBooks,
      shelvesRef.current,
      gesture.book.id,
      shelfId,
      index,
    );
    // Paint the result immediately. Waiting for the command used to leave the
    // old ghost and preview on screen, so a second quick drag could start
    // against stale geometry and its result could overwrite the first move.
    setBooks(nextBooks);
    setPreview(null);
    setLift(null);
    setMoveNotice(null);
    platform
      .moveBook(gesture.book.id, shelfId, index)
      .catch((error) => {
        setBooks(previousBooks);
        setMoveNotice(
          isApiError(error)
            ? error.message
            : "That book could not be moved. Please try again.",
        );
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
    // The preview is what the user is aiming at, so commit exactly there.
    // Only fall back to a fresh hit test if the pointer ended on a different
    // shelf from the one the preview was showing.
    const index =
      gesture.previewShelfId === shelfId
        ? gesture.previewIndex
        : insertionIndex(geometry, moving.id, gesture.lastX);
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

  return {
    displayBooks,
    lift,
    moveNotice,
    startPress,
    suppressClickRef,
    ghostRef,
    gestureRef,
  };
}
