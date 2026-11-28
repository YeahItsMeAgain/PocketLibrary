import type { Book, Shelf } from "../platform";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { textDirection } from "./spineRenderer";
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

const TYPOGRAPHY = "typography" as const;
type SpineStyleName = "art" | "cloth" | typeof TYPOGRAPHY;

/**
 * A missing or unknown style is the Art default.
 */
export function spineStyleName(book: Book): SpineStyleName {
  const value = book.spineStyle as string | undefined;
  return value === "cloth" || value === TYPOGRAPHY ? value : "art";
}

export function paintsArt(spineStyle: SpineStyleName): boolean {
  return spineStyle === "art";
}

/** Art's deep scrim foot exists when there is anything to put in it. */
export function hasFootContent(book: Book): boolean {
  return Boolean(book.authors[0]) || book.labels.length > 0;
}

/** Non-band faces need to know what sits below the title block. */
export function spineFurnitureClass(book: Book): string {
  return `${book.labels.length > 0 ? " has-labels" : ""}${
    book.labels.length > 2 ? " many-labels" : ""
  }`;
}

export function spineFurnitureVars(book: Book): CSSProperties {
  const chips =
    Math.min(book.labels.length, 2) + (book.labels.length > 2 ? 1 : 0);
  return { "--label-count": chips } as CSSProperties;
}

/**
 * Split an author into two balanced lines for the Art foot. A one-word name
 * stays on one line; otherwise the split mirrors the reading order, with the
 * first line taking the extra word when the count is odd.
 */
export function authorLines(author: string): string[] {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [author.trim()];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/** Reserved layout space; a missing author/labels collapses the foot. */
export function spineReserveVars(book: Book): CSSProperties {
  // Cloth and Typography reserve the space actually occupied by their chips,
  // so the title+author group can centre in what is left instead of a guessed
  // 50px. Art's foot is the scrim's darkest 30%, so it needs no reserve.
  const chips =
    Math.min(book.labels.length, 2) + (book.labels.length > 2 ? 1 : 0);
  const labelReserve = chips
    ? 8 + chips * 13 + (chips - 1) * 2 + 2
    : 0;
  const lowerReserve = labelReserve > 0 ? labelReserve : 26;
  return {
    "--lower-reserve": `${lowerReserve}px`,
  } as CSSProperties;
}

/** The ink and board variables shared by a shelf spine and its drag ghost. */
export function spinePaletteVars(book: Book): CSSProperties {
  const style = shelfSpineStyle(book);
  const spineStyle = spineStyleName(book);
  const foil = "#ecd7a4";
  // Art's scrim standardises the strip, so its ink is always cream. Cloth has
  // no window; its foil is fixed and tested against the board colour.
  // Typography keeps the original cream board lettering.
  const ink = spineStyle === "cloth" ? foil : SPINE_INK;
  const inkDim = spineStyle === "cloth" ? "#cbb78c" : "#dccba4";
  return {
    "--c1": style.c1,
    "--c2": style.c2,
    "--gold": SPINE_GOLD,
    "--ink": SPINE_INK,
    "--fs": style.fontSize,
    "--spine-ink": ink,
    "--spine-ink-dim": inkDim,
    "--foil": foil,
  } as CSSProperties;
}

const MIN_TITLE_FONT = 2.8;
// Below this the type stops reading as a title. A single column is preferred
// all the way down to the floor; only a title that cannot fit one column at
// this size is split across two.
const READABLE_FONT = 6.4;
// A short column tracked to the full run spreads "Man" into "M a n". The lab
// caps per-column tracking at 0.12em.
const COLUMN_TRACKING_CAP = 0.12;

interface TitleColumn {
  text: string;
  tracking: number;
}

interface TitleLayout {
  size: number;
  tracking: number;
  columns: TitleColumn[] | null;
}

function titleChars(title: string): number {
  return Math.max(1, Array.from(title.replace(/\s+/g, " ").trim()).length);
}

function sameLayout(left: TitleLayout | null, right: TitleLayout): boolean {
  if (!left) return false;
  if (left.size !== right.size || left.tracking !== right.tracking) {
    return false;
  }
  if (!left.columns !== !right.columns) return false;
  if (!left.columns || !right.columns) return true;
  return left.columns.every(
    (column, index) =>
      column.text === right.columns?.[index]?.text &&
      column.tracking === right.columns?.[index]?.tracking,
  );
}

/** Split at a word boundary so both columns carry the same amount of type. */
function splitBalanced(
  title: string,
  measure: (text: string) => number,
): { left: string; right: string } | null {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: { left: string; right: string; difference: number } | null = null;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(" ");
    const right = words.slice(index).join(" ");
    const difference = Math.abs(measure(left) - measure(right));
    if (!best || difference < best.difference) {
      best = { left, right, difference };
    }
  }
  return best ? { left: best.left, right: best.right } : null;
}

/**
 * Prefer one column. A title that fits the run at the readable floor keeps the
 * full glyph size and is tracked out to fill it. Only when one column would
 * need unreadably small type does the title split into two balanced columns,
 * each tracked to the same run so neither ends halfway down the spine.
 */
function fitSpineTitle(
  element: HTMLSpanElement,
  title: string,
): TitleLayout | null {
  const spine = element.closest<HTMLElement>(".spine");
  if (!spine) return null;
  const available = element.clientHeight;
  if (available < 24) return null;
  const width = spine.clientWidth || 30;
  const maxFont = Math.min(11.8, Math.max(7, width * 0.34));
  // Leave a little more room in one-column mode so a final word does not
  // spill into an unbalanced second column; two-column mode keeps the fuller
  // run.
  const target = available * 0.92;
  const columnTarget = available * 0.94;
  const chars = titleChars(title);
  const style = getComputedStyle(element);

  // A detached probe measures the unwrapped run at any candidate size without
  // disturbing the rendered title (and works before the columns exist).
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.top = "0";
  probe.style.left = "-9999px";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.writingMode = "vertical-rl";
  probe.style.textOrientation = "mixed";
  probe.style.whiteSpace = "nowrap";
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.direction = style.direction === "rtl" ? "rtl" : "ltr";
  probe.style.unicodeBidi = "isolate";
  probe.style.letterSpacing = "0px";
  document.body.appendChild(probe);
  const measure = (text: string, size: number) => {
    probe.style.fontSize = `${size}px`;
    probe.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(probe);
    return range.getBoundingClientRect().height;
  };

  try {
    const naturalMax = measure(title, maxFont);
    if (naturalMax <= target) {
      return {
        size: maxFont,
        tracking: (target - naturalMax) / chars,
        columns: null,
      };
    }

    // One column, shrunk just enough for the run to fit at the readable floor.
    const needed = maxFont * (target / naturalMax);
    if (needed >= READABLE_FONT) {
      let size = Math.min(maxFont, needed);
      let natural = measure(title, size);
      for (let attempt = 0; attempt < 3 && natural > target; attempt += 1) {
        size *= target / natural;
        natural = measure(title, size);
      }
      return {
        size,
        tracking: Math.max(0, (target - natural) / chars),
        columns: null,
      };
    }

    // Two columns: shrink until the whole run is two columns long, then split
    // at the word boundary that balances the two halves.
    let size = maxFont;
    let natural = naturalMax;
    const twoColumnLimit = columnTarget * 2;
    for (let attempt = 0; attempt < 4 && natural > twoColumnLimit; attempt += 1) {
      size = Math.max(
        MIN_TITLE_FONT,
        size * (twoColumnLimit / natural) * 0.98,
      );
      natural = measure(title, size);
    }
    let parts = splitBalanced(title, (text) => measure(text, size));
    if (!parts) {
      // A single long word cannot become two columns. Shrink one column until
      // it fits rather than returning a run that overflows the title box.
      let single = size;
      for (let attempt = 0; attempt < 12 && measure(title, single) > target; attempt += 1) {
        single *= 0.97;
      }
      // The floor is a legibility goal, not a licence to clip: if the word
      // still overflows at 2.8px, the last resort is smaller type.
      for (let attempt = 0; attempt < 40 && measure(title, single) > target; attempt += 1) {
        single *= 0.94;
      }
      return {
        size: single,
        tracking: Math.max(0, (target - measure(title, single)) / chars),
        columns: null,
      };
    }
    // A short word at the split can make one half longer than the run; shrink
    // and rebalance until both halves fit.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const longest = Math.max(
        measure(parts.left, size),
        measure(parts.right, size),
      );
      if (longest <= target) break;
      size = Math.max(MIN_TITLE_FONT, size * (target / longest) * 0.99);
      const next = splitBalanced(title, (text) => measure(text, size));
      if (!next) break;
      parts = next;
    }
    // Whatever the rebalance did, each column must fit the box.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const longest = Math.max(
        measure(parts.left, size),
        measure(parts.right, size),
      );
      if (longest <= target) break;
      size *= (target / longest) * 0.99;
      const next = splitBalanced(title, (text) => measure(text, size));
      if (!next) break;
      parts = next;
    }
    const leftLength = measure(`${parts.left} `, size);
    const rightLength = measure(parts.right, size);
    const columnTracking = (length: number, text: string) =>
      Math.min(
        size * COLUMN_TRACKING_CAP,
        Math.max(0, (columnTarget - length) / titleChars(text)),
      );
    return {
      size,
      tracking: 0,
      columns: [
        {
          // The trailing space keeps the title's text content intact across
          // the column break; it is invisible in the rendered run.
          text: `${parts.left} `,
          // Each column is tracked independently towards the same run, so the
          // shorter half does not leave a dark gap below its words. The cap
          // stops a short half being spread into "M a n".
          tracking: columnTracking(leftLength, `${parts.left} `),
        },
        {
          text: parts.right,
          tracking: columnTracking(rightLength, parts.right),
        },
      ],
    };
  } finally {
    probe.remove();
  }
}

export function SpineFace({
  book,
  spineStyle = "art",
  generatedSpine,
  floating = false,
}: {
  book: Book;
  spineStyle?: SpineStyleName;
  generatedSpine?: string;
  /** The drag ghost hangs below the shelf lip, so it carries its own drape. */
  floating?: boolean;
}) {
  const bands = book.labels.slice(0, 2);
  const hiddenLabels = book.labels.length - bands.length;
  const author = book.authors[0];
  const titleRef = useRef<HTMLSpanElement>(null);
  const authorRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<TitleLayout | null>(null);
  const strip = generatedSpine || book.spineDataUrl || undefined;
  const showGenerated = Boolean(strip) && paintsArt(spineStyle);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const fit = () => {
      const next = fitSpineTitle(title, book.title);
      if (next) {
        setLayout((current) => (sameLayout(current, next) ? current : next));
      }
    };
    fit();
    const spine = title.closest<HTMLElement>(".spine");
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(title);
    if (spine) observer?.observe(spine);
    // Webfonts change the advance width, and therefore the run, after mount.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) fit();
    });
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [book.title, book.spineStyle]);

  const isArt = spineStyle === "art";

  // The Art author gets the full two-line name at a fixed starting size. Shrink
  // only when a long name would spill out of the scrim's foot; the floor keeps
  // it legible on the narrowest spine.
  useLayoutEffect(() => {
    if (!isArt || !author) return;
    const node = authorRef.current;
    const foot = node?.closest<HTMLElement>(".spine-foot");
    if (!node || !foot) return;
    const fit = () => {
      let size = 6.2;
      node.style.fontSize = `${size}px`;
      while (
        size > 4.2 &&
        (foot.scrollHeight > foot.clientHeight ||
          node.scrollWidth > node.clientWidth)
      ) {
        size = Math.round((size - 0.2) * 10) / 10;
        node.style.fontSize = `${size}px`;
      }
    };
    fit();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(foot);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) fit();
    });
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [author, book.spineStyle, book.labels.length, isArt]);

  const labelBands =
    book.labels.length > 0 ? (
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
            <span className="lb-name">{label.name}</span>
          </span>
        ))}
        {hiddenLabels > 0 ? (
          <span className="lb more" data-testid="spine-label-more">
            +{hiddenLabels}
          </span>
        ) : null}
      </span>
    ) : null;

  return (
    <>
      {showGenerated && strip ? (
        <img
          className="spine-generated"
          data-testid="spine-generated"
          src={strip}
          alt=""
          draggable={false}
        />
      ) : null}
      {showGenerated ? (
        <span className="spine-smoke" data-testid="spine-scrim" aria-hidden="true" />
      ) : null}
      {isArt && hasFootContent(book) ? (
        <span className="spine-foot" data-testid="spine-foot">
          {author ? (
            <span className="sa" ref={authorRef}>
              {authorLines(author).map((line, index, lines) => (
                // The trailing space keeps the full name intact for assistive
                // technology across the two visual lines.
                <span key={index}>
                  {index < lines.length - 1 ? `${line} ` : line}
                </span>
              ))}
            </span>
          ) : null}
          {labelBands}
        </span>
      ) : null}
      <span className="spine-text">
        <span
          className={`st${layout?.columns ? " has-columns" : ""}`}
          ref={titleRef}
          style={
            {
              ...(layout
                ? {
                    fontSize: `${Math.round(layout.size * 100) / 100}px`,
                    letterSpacing: `${Math.round(layout.tracking * 100) / 100}px`,
                  }
                : null),
            } as CSSProperties
          }
        >
          {layout?.columns
            ? layout.columns.map((column, index) => (
                <span
                  key={index}
                  className="st-col"
                  style={{
                    letterSpacing: `${Math.round(column.tracking * 100) / 100}px`,
                  }}
                >
                  {column.text}
                </span>
              ))
            : book.title}
        </span>
        {!isArt && author ? (
          <span className="sa">{surname(author)}</span>
        ) : null}
      </span>
      {book.readingStatus === "finished" ? (
        <span
          className="gold-ribbon"
          data-testid="spine-gold-ribbon"
          aria-hidden="true"
        />
      ) : null}
      {!isArt ? labelBands : null}
      {floating && book.readingStatus === "reading" ? (
        <span className="spine-drape is-inline" aria-hidden="true" />
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
  // Missing/undefined is the documented Art default; only Cloth and
  // Typography suppress generated art.
  const spineStyle = spineStyleName(book);
  // Art paints the generated strip; Cloth and Typography are
  // the typographic spines rendered below. A rejected fallback never reaches
  // here with a strip. The list payload carries the cached strip; the activity
  // map only supplies live updates from the queue or a manual generation.
  const generatedStrip = generatedSpine || book.spineDataUrl || undefined;
  const showGenerated = Boolean(generatedStrip) && paintsArt(spineStyle);
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
      }${spineFurnitureClass(book)}`}
      data-testid="spine"
      data-book-id={book.id}
      data-slot={book.slotIndex ?? undefined}
      data-status={book.readingStatus}
      data-style={spineStyle}
      dir={textDirection(book.title) === "rtl" ? "rtl" : undefined}
      data-spine-state={spineState?.state ?? "waiting"}
      data-dragging={dragging || undefined}
      title={`${book.title} — ${statusLabel} — ${spineNote}`}
      aria-label={`${book.title}, ${statusLabel}, ${spineNote}`}
      aria-grabbed={dragging || undefined}
      role="button"
      tabIndex={0}
      style={
        {
          ...spinePaletteVars(book),
          ...spineReserveVars(book),
          ...spineFurnitureVars(book),
          "--w": `${style.width}px`,
          "--h": `${style.height}px`,
          "--lean": `${style.lean}deg`,
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
      <SpineFace
        book={book}
        spineStyle={spineStyle}
        generatedSpine={generatedStrip}
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

/**
 * Reading cue B lives over the shelf lip and board, so it cannot sit inside
 * `.v4-cavity` (which clips). This layer is a sibling of the cavity inside the
 * case: it measures each reading book and hangs an oxblood drape from the
 * book's foot to the bottom of the board. Positions are remeasured when the
 * shelf resizes, scrolls into view, or a book starts dragging or is dimmed.
 */
function ShelfCues({ books }: { books: Book[] }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const caseEl = layer?.parentElement;
    if (!layer || !caseEl) return;
    const list = caseEl.querySelector<HTMLElement>(".v4-books");
    const board = caseEl.querySelector<HTMLElement>(".v4-board");
    let frame = 0;

    const place = () => {
      frame = 0;
      const caseRect = caseEl.getBoundingClientRect();
      const boardRect = board?.getBoundingClientRect() ?? caseRect;
      layer.textContent = "";
      for (const spine of caseEl.querySelectorAll<HTMLElement>(
        '.spine[data-status="reading"]',
      )) {
        if (spine.dataset.dragging === "true") continue;
        const rect = spine.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const top = rect.bottom - caseRect.top - 4;
        const drape = document.createElement("span");
        drape.className = "spine-drape";
        drape.dataset.testid = "spine-drape";
        drape.dataset.bookId = spine.dataset.bookId ?? "";
        drape.style.left = `${rect.right - caseRect.left - 10}px`;
        drape.style.top = `${top}px`;
        drape.style.height = `${Math.max(24, boardRect.bottom - caseRect.top - top)}px`;
        if (spine.dataset.dimmed === "true") drape.dataset.dimmed = "true";
        layer.appendChild(drape);
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(place);
    };

    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(caseEl);
    if (list) observer?.observe(list);
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    if (list) {
      // Filtering dims the drapes directly (a data-attribute sweep); only a
      // drag changes the drape set, so the cue layer must not rebuild on the
      // dim flag or a filter would mutate DOM it has no reason to touch.
      mutations?.observe(list, {
        attributes: true,
        attributeFilter: ["data-dragging"],
        subtree: true,
      });
    }
    const intersection =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) schedule();
          });
    intersection?.observe(caseEl);
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      intersection?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [books]);

  return (
    <div
      className="v4-cues"
      data-testid="spine-cue-layer"
      ref={layerRef}
      aria-hidden="true"
    />
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
        {!empty ? <ShelfCues books={books} /> : null}
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
