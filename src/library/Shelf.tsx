import type { Book, Shelf } from "../platform";
import {
  memo,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  SPINE_GOLD,
  SPINE_INK,
  STATUS_LABELS,
  shelfMark,
  shelfSpineStyle,
  spineLabelAbbr,
  surname,
} from "./spine";
import { mix, readableInk } from "./spineRenderer";
import type { SpineBookState } from "./spineActivity";

interface ShelfCaseProps {
  shelf: Shelf;
  books: Book[];
  draggedBookId: number | null;
  generatedSpines: Record<number, string>;
  spineJobs: Record<number, SpineBookState>;
  onOpen: (book: Book) => void;
  onPress: (book: Book, event: ReactPointerEvent<HTMLLIElement>) => void;
}

export function SpineFace({
  book,
  spineStyle = "wrap",
  showScrim = false,
}: {
  book: Book;
  spineStyle?: "wrap" | "full-bleed" | "cloth";
  showScrim?: boolean;
}) {
  const bands = book.labels.slice(0, 2);
  const hiddenLabels = book.labels.length - bands.length;
  const author = book.authors[0];
  return (
    <>
      {showScrim && spineStyle !== "cloth" ? (
        <span className="spine-scrim" aria-hidden="true" />
      ) : null}
      <span className="spine-text">
        <span className="st">{book.title}</span>
        {author ? <span className="sa">{surname(author)}</span> : null}
      </span>
      {book.readingStatus === "finished" ? (
        <span
          className="seal"
          data-testid="spine-seal"
          aria-hidden="true"
        >
          ✦
        </span>
      ) : null}
      {book.labels.length > 0 ? (
        <span className="bands">
          {bands.map((label) => (
            <span
              key={label.id}
              className="lb"
              data-testid="spine-label-band"
              data-short={spineLabelAbbr(label.name)}
              style={
                {
                  "--lc": label.colour,
                  "--li": "#f8edd6",
                  backgroundColor: label.colour,
                } as CSSProperties
              }
              title={label.name}
            >
              <span className="visually-hidden">{label.name}</span>
            </span>
          ))}
          {hiddenLabels > 0 ? (
            <span className="lb more" data-testid="spine-label-more">
              +{hiddenLabels}
            </span>
          ) : null}
        </span>
      ) : null}
      {book.readingStatus === "reading" ? (
        <span
          className="ribbon"
          data-testid="spine-ribbon"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

interface SpineProps {
  book: Book;
  dragging: boolean;
  generatedSpine?: string;
  spineState?: SpineBookState;
  onOpen: (book: Book) => void;
  onPress: (book: Book, event: ReactPointerEvent<HTMLLIElement>) => void;
}

/**
 * The shelf title has to fit a narrow spine without clipping mid-word. A
 * vertical run can use at most two columns, so a long title shrinks just
 * enough that two columns hold it; ordinary titles keep the shelf's chosen
 * size and wrap at a word boundary.
 */
function shelfTitleFont(
  title: string,
  style: { height: number; fontSize: string },
): string {
  const base = Number.parseFloat(style.fontSize) || 10;
  // Top/bottom insets and the author run leave this much inline length.
  const available = Math.max(48, style.height - 16 - 50 - 16);
  const chars = Math.max(1, String(title).trim().length);
  const twoColumnLimit = (2 * available) / (0.62 * chars);
  const size = Math.min(base, Math.max(6.4, twoColumnLimit));
  return `${Math.floor(size * 10) / 10}px`;
}

/**
 * One spine. Filtering and slot recycling must not reconcile the other
 * twenty-odd spines on a shelf, so each book is its own memoised leaf.
 * Callbacks are intentionally excluded: their behaviour is ref-stable and
 * recreating them must not invalidate every book.
 */
export const Spine = memo(function Spine({
  book,
  dragging,
  generatedSpine,
  spineState,
  onOpen,
  onPress,
}: SpineProps) {
  const statusLabel = STATUS_LABELS[book.readingStatus];
  const style = useMemo(() => shelfSpineStyle(book), [book]);
  // Missing/undefined is the documented Wrap default; only an explicit
  // Cloth choice suppresses generated art.
  const spineStyle = book.spineStyle ?? "wrap";
  const titleFont = useMemo(
    () => shelfTitleFont(book.title, style),
    [book.title, style],
  );
  // The backdrop standardises the art, so the ink is chosen against the smoked
  // window rather than the raw pixels. Cloth has no window; its foil is fixed
  // and tested against the board colour.
  const foil = "#ecd7a4";
  const ink =
    spineStyle === "cloth"
      ? foil
      : readableInk(mix(style.c1, "#0b0908", 0.78));
  const inkDim = spineStyle === "cloth" ? "#cbb78c" : "#dccba4";
  // Wrap and Full-bleed paint the generated strip; Cloth is the typographic
  // spine rendered below. A rejected fallback never reaches here with a strip.
  // The list payload carries the cached strip; the activity map only supplies
  // live updates from the queue or a manual generation.
  const generatedStrip = generatedSpine || book.spineDataUrl || undefined;
  const showGenerated = Boolean(generatedStrip) && spineStyle !== "cloth";
  const spineNote =
    spineState?.state === "working"
      ? `spine preparing, ${spineState.stage} stage`
      : spineState?.state === "ready"
        ? "spine ready"
        : spineState?.state === "needs-attention"
          ? "cloth spine"
          : "spine waiting";
  return (
    <li
      className={`spine book${dragging ? " is-dragging-source" : ""}${
        showGenerated ? " has-generated" : ""
      }`}
      data-testid="spine"
      data-book-id={book.id}
      data-slot={book.slotIndex ?? undefined}
      data-status={book.readingStatus}
      data-style={spineStyle}
      data-spine-state={spineState?.state ?? "waiting"}
      data-dragging={dragging || undefined}
      title={`${book.title} — ${statusLabel} — ${spineNote}`}
      aria-label={`${book.title}, ${statusLabel}, ${spineNote}`}
      aria-grabbed={dragging || undefined}
      role="button"
      tabIndex={0}
      style={
        {
          "--w": `${style.width}px`,
          "--h": `${style.height}px`,
          "--c1": style.c1,
          "--c2": style.c2,
          "--gold": SPINE_GOLD,
          "--ink": SPINE_INK,
          "--lean": `${style.lean}deg`,
          "--fs": style.fontSize,
          "--title-fs": titleFont,
          "--spine-ink": ink,
          "--spine-ink-dim": inkDim,
          "--foil": foil,
        } as CSSProperties
      }
      onPointerDown={(event) => onPress(book, event)}
      onClick={() => onOpen(book)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(book);
        }
      }}
    >
      {showGenerated && generatedStrip ? (
        <img
          className="spine-generated"
          data-testid="spine-generated"
          src={generatedStrip}
          alt=""
          draggable={false}
        />
      ) : null}
      <SpineFace
        book={book}
        spineStyle={spineStyle}
        showScrim={showGenerated}
      />
    </li>
  );
}, areSpineEqual);

function areSpineEqual(prev: SpineProps, next: SpineProps): boolean {
  return (
    prev.book === next.book &&
    prev.dragging === next.dragging &&
    prev.generatedSpine === next.generatedSpine &&
    prev.spineState === next.spineState
  );
}

export const ShelfCase = memo(function ShelfCase({
  shelf,
  books,
  draggedBookId,
  generatedSpines,
  spineJobs,
  onOpen,
  onPress,
}: ShelfCaseProps) {
  const mark = shelfMark(shelf.ordinal);
  const empty = books.length === 0;
  const full = books.length >= shelf.capacity && shelf.ordinal > 0;

  return (
    <section
      className={`v4-shelf${empty ? " v4-empty" : ""}`}
      data-shelf-id={shelf.id}
      data-testid={empty ? "empty-shelf" : "shelf"}
      aria-label={
        empty ? `Shelf ${mark}, empty` : `Shelf ${mark}, ${books.length} books`
      }
    >
      <div className="v4-case">
        <div className="v4-crown" aria-hidden="true">
          <span className="v4-crest" />
        </div>
        <div className="v4-cavity">
          <div className="v4-back" aria-hidden="true" />
          <div className="v4-pil v4-pil-l" aria-hidden="true" />
          <div className="v4-pil v4-pil-r" aria-hidden="true" />
          <div className="v4-lamp" aria-hidden="true" />
          {empty ? (
            <div className="v4-empty-note">
              <span className="e1">Shelf {mark}</span>
              <span className="e2">Awaiting its first volume</span>
            </div>
          ) : (
            <ul className="spines v4-books">
              {books.map((book, slot) => (
                // Slot keys are deliberate: a recycled case updates its
                // existing spine nodes in place instead of replacing eleven
                // subtrees whenever the window crosses a boundary.
                <Spine
                  key={slot}
                  book={book}
                  dragging={draggedBookId === book.id}
                  generatedSpine={generatedSpines[book.id]}
                  spineState={spineJobs[book.id]}
                  onOpen={onOpen}
                  onPress={onPress}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="v4-lip" aria-hidden="true" />
        <div className="v4-board">
          <span className="v4-plate">Shelf {mark}</span>
          {full ? (
            <span className="v4-full">
              Full · {books.length}/{shelf.capacity}
            </span>
          ) : null}
        </div>
        <div className="v4-plinth" aria-hidden="true" />
      </div>
    </section>
  );
}, areShelfCaseEqual);

function areShelfCaseEqual(prev: ShelfCaseProps, next: ShelfCaseProps): boolean {
  if (prev.shelf !== next.shelf) return false;
  if (prev.books.length !== next.books.length) return false;
  for (let index = 0; index < prev.books.length; index += 1) {
    if (prev.books[index] !== next.books[index]) return false;
  }
  for (const book of prev.books) {
    if (prev.generatedSpines[book.id] !== next.generatedSpines[book.id]) {
      return false;
    }
    if (prev.spineJobs[book.id] !== next.spineJobs[book.id]) return false;
  }
  const prevHasDragged =
    prev.draggedBookId !== null &&
    prev.books.some((book) => book.id === prev.draggedBookId);
  const nextHasDragged =
    next.draggedBookId !== null &&
    next.books.some((book) => book.id === next.draggedBookId);
  return prevHasDragged === nextHasDragged;
}
