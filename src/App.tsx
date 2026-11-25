import {
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
  LABEL_PALETTE,
  isApiError,
  isLibraryUnavailable,
  platform,
  type ApiError,
  type AppInfo,
  type Book,
  type BookDetail,
  type Label,
  type LabelUsage,
  type LibgenResult,
  type LibraryStatus,
  type ReadingState,
  type ReadingStatus,
  type ScanIssueReason,
  type ScanReport,
  type SearchPage,
  type SearchQuery,
  type Shelf,
} from "./platform";
import { useLayerExit } from "./navigation";
import EpubReader from "./reader/EpubReader";
import PdfReader from "./reader/PdfReader";
import {
  READER_SIZES,
  READER_THEMES,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderTheme,
} from "./reader/settings";
import "./App.css";

const ROMAN_MARKS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

function shelfMark(ordinal: number): string {
  return ROMAN_MARKS[ordinal] ?? String(ordinal + 1);
}

const STATUS_LABELS: Record<Book["readingStatus"], string> = {
  unread: "Unread",
  reading: "Reading",
  finished: "Finished",
};

type View = "library" | "search" | "settings";

const NAV_ITEMS: ReadonlyArray<{ view: View; label: string; note: string }> = [
  { view: "library", label: "Library", note: "The wall" },
  { view: "search", label: "Search", note: "Front desk" },
  { view: "settings", label: "Settings", note: "The study" },
];

/* ---------------------------------------------------------------- spines */

/** Curated Victorian bindings. Spines hash into these, never random. */
const SPINE_PALETTES: ReadonlyArray<readonly [string, string]> = [
  ["#5a201c", "#2e0d0c"],
  ["#33243f", "#170f20"],
  ["#1d2f45", "#0b1623"],
  ["#7a5a26", "#402c10"],
  ["#3b2233", "#190e18"],
  ["#4b3422", "#24150c"],
  ["#3a2436", "#1a0f19"],
  ["#333a45", "#171b22"],
  ["#6b3a24", "#33170c"],
  ["#5d1f2a", "#2c0b11"],
  ["#5a2637", "#2a0f19"],
  ["#1b2740", "#0a1120"],
  ["#3d2a1d", "#1c1008"],
  ["#3a3046", "#191321"],
];

const SPINE_GOLD = "#d8b976";
const SPINE_INK = "#f4e6c4";
const SPINE_ORNAMENTS = ["✦", "❦", "❧", "✶"] as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

interface SpineStyle {
  width: number;
  height: number;
  lean: number;
  c1: string;
  c2: string;
  fontSize: string;
  ornament: string;
}

function spineStyle(book: Book): SpineStyle {
  const seed =
    hashString(book.contentHash || `${book.title}|${book.authors.join("|")}`) +
    (book.slotIndex ?? 0) * 2654435761;
  const palette = SPINE_PALETTES[seed % SPINE_PALETTES.length];
  const width = 27 + (seed % 8);
  const height = 198 + ((seed >>> 3) % 41);
  const lean = seed % 9 === 4 ? -2.2 : seed % 11 === 8 ? 1.3 : 0;
  const offset = book.format === "pdf" ? 5 : 0;
  const alt = SPINE_PALETTES[(seed + offset) % SPINE_PALETTES.length];
  const source = book.format === "pdf" ? alt : palette;
  return {
    width,
    height,
    lean,
    c1: shade(source[0], 0.16),
    c2: shade(source[1], 0.3),
    fontSize: width < 29 ? "9.6px" : width > 33 ? "10.8px" : "10.2px",
    ornament: SPINE_ORNAMENTS[seed % SPINE_ORNAMENTS.length],
  };
}

function surname(author: string): string {
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1] ?? author;
}

function spineLabelAbbr(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? name;
  return first.length > 4 ? first.slice(0, 4) : first;
}


function CrestMark({ className = "mast-orn" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="52"
      height="14"
      viewBox="0 0 52 14"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 11h14M36 11h14" stroke="currentColor" opacity=".55" />
      <path
        d="M26 1c-3 3.4-6.4 5-10.4 5 3.6 1.6 6 4 7.2 7 1.2-2.6 2.2-2.6 3.2-4 1 1.4 2 1.4 3.2 4 1.2-3 3.6-5.4 7.2-7C32.4 6 29 4.4 26 1z"
        fill="currentColor"
        opacity=".85"
      />
      <circle cx="26" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

function CrownCrest() {
  return (
    <svg
      className="v4-crest"
      width="62"
      height="17"
      viewBox="0 0 64 18"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 15h18M44 15h18" stroke="currentColor" opacity=".5" />
      <path
        d="M32 2c-3 4-6.5 6-11 6 4 1.8 6.8 4.6 8.2 8 1.1-2.4 2-2.8 2.8-4.2.8 1.4 1.7 1.8 2.8 4.2C36.2 12.6 39 9.8 43 8c-4.5 0-8-2-11-6z"
        fill="currentColor"
        opacity=".9"
      />
      <circle cx="32" cy="16" r="1.1" fill="currentColor" />
    </svg>
  );
}

function Bracket({ side }: { side: "l" | "r" }) {
  const flip = side === "r" ? ' transform="scale(-1,1) translate(-34,0)"' : "";
  return (
    <svg
      className={`v4-brk v4-brk-${side}`}
      width="30"
      height="30"
      viewBox="0 0 34 34"
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: `<path d="M3 3c0 16 7 25 27 28" stroke="currentColor" stroke-width="1.2"/><path d="M8 4c.5 12 5.5 19 20 22" stroke="currentColor" stroke-width="1" opacity=".55"/><path d="M13 5c.6 8 3.6 13 12 15" stroke="currentColor" stroke-width="1" opacity=".4"/><circle cx="5" cy="5" r="2" fill="currentColor" opacity=".7"/><g${flip}></g>`,
      }}
    />
  );
}

function Masthead({
  volumeCount,
  caseCount,
}: {
  volumeCount?: number;
  caseCount?: number;
}) {
  const meta =
    volumeCount === undefined
      ? "A quiet room for your own books"
      : `${volumeCount} ${volumeCount === 1 ? "volume" : "volumes"} · ${
          caseCount ?? 0
        } ${caseCount === 1 ? "case" : "cases"}`;
  return (
    <header className="v4-mast">
      <p className="kicker">Bibliotheca Domestica</p>
      <CrestMark />
      <h1>Pocket Library</h1>
      <div className="rule" aria-hidden="true">
        <span>❦</span>
      </div>
      <p className="meta">{meta}</p>
    </header>
  );
}

interface ShelfCaseProps {
  shelf: Shelf;
  books: Book[];
  draggedBookId: number | null;
  dimmedBookIds: Set<number>;
  onOpen: (book: Book) => void;
  onPress: (book: Book, event: ReactPointerEvent<HTMLLIElement>) => void;
}

function SpineFace({ book }: { book: Book }) {
  const bands = book.labels.slice(0, 2);
  const hiddenLabels = book.labels.length - bands.length;
  const author = book.authors[0];
  return (
    <>
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

function ShelfCase({
  shelf,
  books,
  draggedBookId,
  dimmedBookIds,
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
        <Bracket side="l" />
        <Bracket side="r" />
        <div className="v4-crown" aria-hidden="true">
          <CrownCrest />
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
              {books.map((book) => {
                const statusLabel = STATUS_LABELS[book.readingStatus];
                const dragging = draggedBookId === book.id;
                const dimmed = dimmedBookIds.has(book.id);
                const style = spineStyle(book);
                return (
                  <li
                    key={book.id}
                    className={`spine book${dragging ? " is-dragging-source" : ""}${
                      dimmed ? " is-dim" : ""
                    }`}
                    data-testid="spine"
                    data-book-id={book.id}
                    data-slot={book.slotIndex ?? undefined}
                    data-status={book.readingStatus}
                    data-dimmed={dimmed || undefined}
                    data-dragging={dragging || undefined}
                    title={`${book.title} — ${statusLabel}`}
                    aria-label={`${book.title}, ${statusLabel}`}
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
                    <SpineFace book={book} />
                  </li>
                );
              })}
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
}

interface DetailPanelProps {
  bookId: number;
  shelfLabel: string;
  onClose: () => void;
  onRead: (book: Book) => void;
  onBookChanged: (patch: {
    id: number;
    readingStatus?: ReadingStatus;
    labels?: Label[];
  }) => void;
  onLabelsChanged: () => void;
}

function DetailPanel({
  bookId,
  shelfLabel: shelfMarkLabel,
  onClose,
  onRead,
  onBookChanged,
  onLabelsChanged,
}: DetailPanelProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [failed, setFailed] = useState(false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);

  const refreshAvailableLabels = useCallback(async () => {
    try {
      setAvailableLabels(await platform.listLabels());
    } catch {
      // The manager surface still shows the labels already worn.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setReading(null);
    setFailed(false);
    setStatusMenu(false);
    setLabelMenu(false);
    setLabelNotice(null);
    Promise.all([
      platform.getBookDetail(bookId),
      platform.readingState(bookId),
      platform.listLabels(),
    ])
      .then(([next, state, labels]) => {
        if (!alive) return;
        setDetail(next);
        setReading(state);
        setAvailableLabels(labels);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const attachLabel = useCallback(
    async (label: Label) => {
      if (!detail) return;
      try {
        await platform.attachLabel(bookId, label.id);
        const labels = [...detail.labels, label];
        setDetail({ ...detail, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelMenu(false);
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That label could not be attached. Please try again.",
        );
      }
    },
    [
      detail,
      bookId,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const detachLabel = useCallback(
    async (label: Label) => {
      if (!detail) return;
      try {
        await platform.detachLabel(bookId, label.id);
        const labels = detail.labels.filter((worn) => worn.id !== label.id);
        setDetail({ ...detail, labels });
        onBookChanged({ id: bookId, labels });
        onLabelsChanged();
        setLabelNotice(null);
        await refreshAvailableLabels();
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That label could not be removed. Please try again.",
        );
      }
    },
    [
      detail,
      bookId,
      onBookChanged,
      onLabelsChanged,
      refreshAvailableLabels,
    ],
  );

  const chooseStatus = useCallback(
    async (status: ReadingStatus) => {
      if (!detail) return;
      try {
        await platform.setReadingStatus(bookId, status);
        const state = await platform.readingState(bookId);
        setReading(state);
        setDetail({ ...detail, readingStatus: status });
        onBookChanged({ id: bookId, readingStatus: status });
        setStatusMenu(false);
      } catch (error) {
        setLabelNotice(
          isApiError(error)
            ? error.message
            : "That status could not be saved. Please try again.",
        );
      }
    },
    [detail, bookId, onBookChanged],
  );

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const authors =
    detail && detail.authors.length > 0
      ? detail.authors.join(" · ")
      : "Unknown author";
  const readLabel =
    detail?.readingStatus === "reading"
      ? "Continue reading"
      : detail?.readingStatus === "finished"
        ? "Read again"
        : "Read";
  const sticker =
    detail?.readingStatus === "finished"
      ? { kind: "gold" as const, text: "✓" }
      : detail?.readingStatus === "reading"
        ? {
            kind: "paper" as const,
            text: `${Math.round((reading?.progress ?? 0) * 100)}%`,
          }
        : null;
  const unattachedLabels = detail
    ? availableLabels.filter(
        (label) => !detail.labels.some((worn) => worn.id === label.id),
      )
    : [];

  const readingProgress = Math.round((reading?.progress ?? 0) * 100);
  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close book detail"
        onClick={close}
      />
      <section
        className="detail d3 d4 is-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        data-testid="book-detail"
      >
        <button
          ref={closeRef}
          type="button"
          className="close"
          aria-label="Back to shelf"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
        <div className="d3-wrap">
          <div className="detail-stage v3d-frame v4d-frame">
            <div className="detail-toolbar">
              <button
                type="button"
                className="btn-back"
                data-testid="detail-back"
                aria-label="Back to shelf"
                onClick={close}
              >
                <span className="arrow" aria-hidden="true">←</span>
                <span>Back to shelf</span>
              </button>
              {detail ? (
                <div className="detail-actions">
                  <button
                    type="button"
                    className="detail-overflow"
                    data-testid="detail-actions"
                    aria-label="Book actions"
                    aria-haspopup="menu"
                    aria-expanded={statusMenu}
                    onClick={() => {
                      setStatusMenu((open) => !open);
                      setLabelMenu(false);
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {statusMenu ? (
                    <div
                      className="detail-status-menu"
                      role="menu"
                      aria-label="Set reading status"
                    >
                      {(
                        ["unread", "reading", "finished"] as ReadingStatus[]
                      ).map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="menuitemradio"
                          aria-checked={detail.readingStatus === status}
                          className="detail-status-option"
                          data-testid={`detail-status-option-${status}`}
                          onClick={() => chooseStatus(status)}
                        >
                          {STATUS_LABELS[status]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {failed ? (
              <div className="detail-loading">
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <h2 id="detail-title">This volume is unavailable</h2>
                <p>The book could not be opened just now.</p>
              </div>
            ) : detail === null ? (
              <div className="detail-loading" aria-busy="true">
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <h2 id="detail-title">Opening…</h2>
              </div>
            ) : (
              <>
                <p className="v3d-top" aria-hidden="true">✦ ❦ ✦</p>
                <div className="v3d-coverwrap v4d-coverwrap">
                  <div className="v4-cover">
                    <div className="v4-cover-art">
                      {detail.coverDataUrl ? (
                        <img
                          data-testid="detail-cover"
                          src={detail.coverDataUrl}
                          alt={`Cover of ${detail.title}`}
                          loading="eager"
                          decoding="async"
                        />
                      ) : (
                        <div className="cover cov-lg" aria-hidden="true">
                          <span className="cov-frame" />
                          <span className="cov-title">{detail.title}</span>
                          <span className="cov-orn">❦</span>
                          <span className="cov-author">
                            {detail.authors.join(" · ") || "Unknown"}
                          </span>
                          <span className="cov-imprint">Pocket Library</span>
                        </div>
                      )}
                    </div>
                    <span className="v4-pages" aria-hidden="true" />
                    <span className="v4-hinge" aria-hidden="true" />
                    {sticker ? (
                      <span
                        className={`sticker sticker-${sticker.kind}`}
                        data-testid="detail-sticker"
                        data-sticker={sticker.kind}
                        aria-label={
                          sticker.kind === "gold"
                            ? "Finished"
                            : `${sticker.text} read`
                        }
                      >
                        {sticker.kind === "gold" ? (
                          <>
                            <span className="gstar" aria-hidden="true">✦</span>
                            <span className="gsub">Finished</span>
                          </>
                        ) : (
                          <>
                            <span className="pct">
                              {sticker.text.replace("%", "")}
                              <i>%</i>
                            </span>
                            <span className="psub" aria-hidden="true" />
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>

                <h2 id="detail-title" data-testid="detail-title">
                  {detail.title}
                </h2>
                <p className="byline" data-testid="detail-author">
                  {authors}
                </p>
                {detail.series ? (
                  <p className="detail-series">{detail.series}</p>
                ) : null}
                <div className="orn-rule" aria-hidden="true">❧</div>
                <p className="blurb" data-testid="detail-blurb">
                  {detail.description ?? "No blurb was printed with this edition."}
                </p>

                {detail.readingStatus === "reading" ? (
                  <div className="progress">
                    <div className="p-cap">
                      <span>Progress</span>
                      <span>{readingProgress}%</span>
                    </div>
                    <span className="bar">
                      <i style={{ width: `${readingProgress}%` }} />
                    </span>
                  </div>
                ) : null}

                <div className="detail-labels dlabels" data-testid="detail-labels">
                  {detail.labels.map((label) => (
                    <button
                      key={label.id}
                      type="button"
                      className="detail-label-chip dlabel"
                      data-testid="detail-label-chip"
                      style={
                        {
                          "--lc": label.colour,
                          "--li": "#f8edd6",
                          backgroundColor: label.colour,
                        } as CSSProperties
                      }
                      aria-label={`Remove label ${label.name}`}
                      title={`Remove ${label.name}`}
                      onClick={() => detachLabel(label)}
                    >
                      <span>{label.name}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="detail-label-add dlabel none"
                    data-testid="detail-add-label"
                    aria-haspopup="menu"
                    aria-expanded={labelMenu}
                    onClick={() => {
                      setLabelMenu((open) => !open);
                      setStatusMenu(false);
                    }}
                  >
                    + Add label
                  </button>
                </div>
                {labelMenu ? (
                  <div className="detail-label-menu" role="menu" aria-label="Add a label">
                    {unattachedLabels.length > 0 ? (
                      unattachedLabels.map((label) => (
                        <button
                          key={label.id}
                          type="button"
                          role="menuitem"
                          className="detail-label-option"
                          data-testid={`label-option-${label.id}`}
                          onClick={() => attachLabel(label)}
                        >
                          <span
                            className="label-swatch"
                            style={{ backgroundColor: label.colour }}
                            aria-hidden="true"
                          />
                          {label.name}
                        </button>
                      ))
                    ) : (
                      <p className="detail-label-empty">
                        No other labels yet. Manage labels on the shelf.
                      </p>
                    )}
                  </div>
                ) : null}
                {labelNotice ? (
                  <p className="detail-note" role="alert">
                    {labelNotice}
                  </p>
                ) : null}

                <div className="meta-strip" data-testid="detail-meta">
                  <span>
                    <em>Edition</em>
                    <b>{detail.publishedDate?.slice(0, 4) ?? "—"}</b>
                  </span>
                  <span>
                    <em>Shelf</em>
                    <b>{shelfMarkLabel}</b>
                  </span>
                  <span>
                    <em>Format</em>
                    <b>{detail.format.toUpperCase()}</b>
                  </span>
                  <span>
                    <em>Labels</em>
                    <b>{detail.labels.length}</b>
                  </span>
                </div>
                <p className="detail-fine">
                  {[
                    detail.publisher,
                    detail.language ? `Language ${detail.language}` : null,
                    detail.pageCount ? `${detail.pageCount} pages` : null,
                    detail.identifier,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Pocket Library edition"}
                </p>

                <button
                  type="button"
                  className="btn-read"
                  data-testid="detail-read"
                  onClick={() => onRead(detail)}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 4.4C8.3 3.2 6.2 2.9 3 3.1v12.1c3.2-.2 5.3.1 7 1.3 1.7-1.2 3.8-1.5 7-1.3V3.1c-3.2-.2-5.3.1-7 1.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M10 4.6v11.9" stroke="currentColor" strokeWidth="1.1" />
                  </svg>
                  <span>{readLabel}</span>
                </button>
                <button
                  type="button"
                  className="btn-return"
                  data-testid="detail-return"
                  onClick={close}
                >
                  Return to shelf
                </button>
              </>
            )}
          </div>
          <p className="hint">Tap outside or press Esc to close</p>
        </div>
      </section>
    </>
  );
}

interface FilterStripProps {
  labels: LabelUsage[];
  selectedLabelIds: number[];
  status: ReadingStatus | null;
  matchingCount: number;
  totalCount: number;
  onToggleLabel: (labelId: number) => void;
  onStatus: (status: ReadingStatus | null) => void;
  onClear: () => void;
  onManage: () => void;
}

function FilterStrip({
  labels,
  selectedLabelIds,
  status,
  matchingCount,
  totalCount,
  onToggleLabel,
  onStatus,
  onClear,
  onManage,
}: FilterStripProps) {
  const active = selectedLabelIds.length > 0 || status !== null;
  const countText = active
    ? `${matchingCount} of ${totalCount} books match`
    : `${totalCount} books on the wall`;
  const statusColour: Record<ReadingStatus, string> = {
    unread: "#7c7364",
    reading: "#a83238",
    finished: "#b58a34",
  };
  return (
    <section
      className="filterbar fb-1"
      data-testid="filter-strip"
      aria-label="Shelf filters"
      role="toolbar"
    >
      <div className="fb-row">
        <div className="fb-scroll" role="group" aria-label="Label filters">
          {labels.length === 0 ? (
            <span className="fb-empty">No labels yet</span>
          ) : (
            labels.map((label) => (
              <button
                key={label.id}
                type="button"
                className="chip filter-label-chip"
                data-testid="filter-label-chip"
                aria-pressed={selectedLabelIds.includes(label.id)}
                onClick={() => onToggleLabel(label.id)}
              >
                <span
                  className="dot"
                  style={{ backgroundColor: label.colour }}
                  aria-hidden="true"
                />
                <span>{label.name}</span>
                <span className="filter-count">{label.bookCount}</span>
              </button>
            ))
          )}
          <button
            type="button"
            className="chip clear"
            data-testid="filter-clear"
            onClick={onClear}
            hidden={!active}
            aria-label="Clear filters"
          >
            Clear
          </button>
        </div>
        <div className="fb-count" aria-hidden="true">
          <b>{active ? matchingCount : totalCount}</b>
          <span>vols</span>
        </div>
        <span className="visually-hidden" data-testid="filter-count" aria-live="polite">
          {countText}
        </span>
      </div>
      <div className="fb-row">
        <span className="fb-cap">Status</span>
        <div
          className="fb-scroll"
          role="group"
          aria-label="Reading status filters"
        >
          {(["unread", "reading", "finished"] as ReadingStatus[]).map(
            (value) => (
              <button
                key={value}
                type="button"
                className="chip filter-status-chip"
                data-testid={`filter-status-${value}`}
                aria-pressed={status === value}
                onClick={() => onStatus(status === value ? null : value)}
              >
                <span
                  className="dot status-dot"
                  style={{ backgroundColor: statusColour[value] }}
                  aria-hidden="true"
                />
                {STATUS_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="fb-manage filter-manage"
          data-testid="manage-labels"
          aria-label="Manage labels"
          onClick={onManage}
        >
          Manage
        </button>
      </div>
    </section>
  );
}

interface ManageLabelsProps {
  onClose: () => void;
  onChanged: () => void;
}

function ManageLabels({ onClose, onChanged }: ManageLabelsProps) {
  const [labels, setLabels] = useState<LabelUsage[] | null>(null);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(LABEL_PALETTE[0].colour);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);

  const refresh = useCallback(async () => {
    try {
      setLabels(await platform.listLabels());
    } catch {
      setError("Labels could not be loaded. Please try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    closeRef.current?.focus();
  }, [refresh]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
      onChanged();
    } catch (caught) {
      setError(
        isApiError(caught)
          ? caught.message
          : "That label change could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close label manager"
        onClick={close}
      />
      <section
        className="book-detail manage-labels"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-labels-title"
        data-testid="manage-labels-panel"
      >
        <button
          ref={closeRef}
          type="button"
          className="detail-close"
          aria-label="Close label manager"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
        <p className="kicker">The Label Drawer</p>
        <h2 id="manage-labels-title">Manage labels</h2>
        <p className="manage-note">
          Labels group books without moving them. Deleting a label never
          deletes a book.
        </p>

        <form
          className="label-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await platform.createLabel(name, colour);
              setName("");
            });
          }}
        >
          <label htmlFor="new-label-name">New label</label>
          <input
            id="new-label-name"
            data-testid="label-name"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Gothic"
          />
          <div className="label-palette" role="group" aria-label="Label colour">
            {LABEL_PALETTE.map((entry) => (
              <button
                key={entry.colour}
                type="button"
                className={`label-palette-swatch${
                  colour === entry.colour ? " is-selected" : ""
                }`}
                style={{ backgroundColor: entry.colour }}
                aria-label={entry.name}
                aria-pressed={colour === entry.colour}
                onClick={() => setColour(entry.colour)}
              />
            ))}
          </div>
          <button
            type="submit"
            className="secondary-action"
            data-testid="create-label"
            disabled={busy || !name.trim()}
          >
            Create label
          </button>
        </form>

        {error ? (
          <p className="action-error" role="alert">
            {error}
          </p>
        ) : null}

        {labels === null ? (
          <p className="manage-note" aria-busy="true">
            Opening the drawer…
          </p>
        ) : labels.length === 0 ? (
          <p className="manage-note" data-testid="manage-empty">
            No labels yet. Create one above.
          </p>
        ) : (
          <ul className="manage-list">
            {labels.map((label) => (
              <li
                key={label.id}
                className="manage-row"
                data-testid="label-row"
              >
                <div className="manage-row-head">
                  <span
                    className="manage-dot"
                    style={{ backgroundColor: label.colour }}
                    aria-hidden="true"
                  />
                  {editing?.id === label.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const next = editing.name;
                        if (!next.trim()) return;
                        void run(async () => {
                          await platform.renameLabel(label.id, next);
                          setEditing(null);
                        });
                      }}
                    >
                      <input
                        data-testid="rename-label"
                        value={editing.name}
                        maxLength={40}
                        autoFocus
                        onChange={(event) =>
                          setEditing({
                            id: label.id,
                            name: event.target.value,
                          })
                        }
                      />
                      <button type="submit" disabled={busy}>
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="manage-name"
                      onClick={() =>
                        setEditing({ id: label.id, name: label.name })
                      }
                    >
                      {label.name}
                    </button>
                  )}
                  <span className="manage-usage">
                    {label.bookCount === 1
                      ? "1 book"
                      : `${label.bookCount} books`}
                  </span>
                </div>
                <div className="manage-row-foot">
                  <div
                    className="label-palette label-palette-small"
                    role="group"
                    aria-label={`Colour for ${label.name}`}
                  >
                    {LABEL_PALETTE.map((entry) => (
                      <button
                        key={entry.colour}
                        type="button"
                        className={`label-palette-swatch label-palette-swatch-small${
                          label.colour === entry.colour ? " is-selected" : ""
                        }`}
                        style={{ backgroundColor: entry.colour }}
                        aria-label={entry.name}
                        aria-pressed={label.colour === entry.colour}
                        onClick={() =>
                          void run(() =>
                            platform.recolourLabel(label.id, entry.colour),
                          )
                        }
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="manage-delete"
                    aria-label={`Delete ${label.name}`}
                    onClick={() => void run(() => platform.deleteLabel(label.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface LibraryWallProps {
  reloadKey: number;
  notice: string | null;
  onAddBooks: () => void;
  onFindBook: () => void;
}

const LONG_PRESS_MS = 380;
const DRAG_THRESHOLD = 8;
const EDGE_ZONE = 88;
const EDGE_MAX_SPEED = 14;
const HINT_KEY = "pocketlibrary.dragHintSeen";
const DRAWER_HINT_KEY = "pocketlibrary.drawerHintSeen";

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

function orderBookList(books: Book[], shelves: Shelf[]): Book[] {
  const rank = new Map(shelves.map((shelf, index) => [shelf.id, index]));
  return [...books].sort((left, right) => {
    const leftRank =
      left.shelfId === null
        ? Number.MAX_SAFE_INTEGER
        : rank.get(left.shelfId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      right.shelfId === null
        ? Number.MAX_SAFE_INTEGER
        : rank.get(right.shelfId) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const slot = (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
    return slot !== 0 ? slot : left.id - right.id;
  });
}

function moveBookInList(
  books: Book[],
  shelves: Shelf[],
  bookId: number,
  targetShelfId: number,
  targetIndex: number,
): Book[] {
  const moving = books.find((book) => book.id === bookId);
  if (!moving || moving.shelfId === null) return books;
  const sourceShelfId = moving.shelfId;
  const sameShelf = sourceShelfId === targetShelfId;
  const bySlot = (left: Book, right: Book) =>
    (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
  const sourceBooks = books
    .filter((book) => book.shelfId === sourceShelfId)
    .sort(bySlot);
  const targetBooks = (
    sameShelf
      ? sourceBooks.filter((book) => book.id !== bookId)
      : books
          .filter((book) => book.shelfId === targetShelfId)
          .sort(bySlot)
  ).slice();
  const index = Math.max(0, Math.min(targetBooks.length, targetIndex));
  targetBooks.splice(index, 0, moving);

  const placements = new Map<
    number,
    { shelfId: number; slotIndex: number }
  >();
  targetBooks.forEach((book, slot) =>
    placements.set(book.id, { shelfId: targetShelfId, slotIndex: slot }),
  );
  if (!sameShelf) {
    sourceBooks
      .filter((book) => book.id !== bookId)
      .forEach((book, slot) =>
        placements.set(book.id, { shelfId: sourceShelfId, slotIndex: slot }),
      );
  }
  const updated = books.map((book) => {
    const placement = placements.get(book.id);
    return placement ? { ...book, ...placement } : book;
  });
  return orderBookList(updated, shelves);
}

function LibraryWall({
  reloadKey,
  notice,
  onAddBooks,
  onFindBook,
}: LibraryWallProps) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [labels, setLabels] = useState<LabelUsage[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | null>(null);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [failed, setFailed] = useState(false);
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const [readerBook, setReaderBook] = useState<Book | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [lift, setLift] = useState<LiftVisual | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
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
  booksRef.current = books;
  shelvesRef.current = shelves ?? [];

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
      const next = await platform.listLabels();
      setLabels(next);
      setSelectedLabelIds((current) =>
        current.filter((id) => next.some((label) => label.id === id)),
      );
    } catch {
      // Keep the labels already on screen; the next reload retries.
    }
  }, []);

  const refreshWallData = useCallback(async () => {
    await refreshLabels();
    try {
      setBooks(await platform.listBooks());
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
    Promise.all([
      platform.listShelves(),
      platform.listBooks(),
      platform.listLabels(),
    ])
      .then(([nextShelves, nextBooks, nextLabels]) => {
        if (!alive) return;
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
    if (!showHint) return;
    const timer = window.setTimeout(dismissHint, 9000);
    return () => window.clearTimeout(timer);
  }, [showHint, dismissHint]);

  const measureWall = useCallback(() => {
    const wall = wallRef.current;
    if (!wall) return;
    const startedAt = performance.now();
    const next = new Map<number, ShelfGeometry>();
    // Ticket 16: only the shelf containers are measured. Slot centres are
    // derived from the deterministic spine widths plus the flex gap, so a
    // lift never forces layout for every spine on the wall.
    wall
      .querySelectorAll<HTMLElement>("section[data-shelf-id]")
      .forEach((section) => {
        const shelfId = Number(section.dataset.shelfId);
        const rect = section.getBoundingClientRect();
        const viewport = window.innerHeight || 844;
        if (rect.bottom < -240 || rect.top > viewport + 240) return;
        const strip = section.querySelector<HTMLElement>(".spines");
        const stripRect = strip ? strip.getBoundingClientRect() : rect;
        const elements = strip
          ? Array.from(
              strip.querySelectorAll<HTMLElement>(":scope > .spine"),
            )
          : [];
        const bookIds = elements.map((element) =>
          Number(element.dataset.bookId),
        );
        const nominal = bookIds.map((bookId) => {
          const book = booksRef.current.find(
            (candidate) => candidate.id === bookId,
          );
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
        for (let index = 0; index < count; index += 1) {
          slots.push({
            bookId: bookIds[index],
            center: stripRect.left + cursor + widths[index] / 2,
          });
          cursor += widths[index] + gap;
        }
        next.set(shelfId, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          slots,
        });
      });
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

  const filterActive = selectedLabelIds.length > 0 || statusFilter !== null;
  const matchingIds = new Set(
    books
      .filter((book) => {
        const worn = book.labels ?? [];
        return (
          selectedLabelIds.every((labelId) =>
            worn.some((label) => label.id === labelId),
          ) &&
          (statusFilter === null || book.readingStatus === statusFilter)
        );
      })
      .map((book) => book.id),
  );
  const dimmedBookIds = filterActive
    ? new Set(
        books
          .filter((book) => !matchingIds.has(book.id))
          .map((book) => book.id),
      )
    : new Set<number>();

  const booksByShelf = new Map<number, Book[]>();
  for (const book of displayBooks) {
    if (book.shelfId === null) continue;
    const shelfBooks = booksByShelf.get(book.shelfId);
    if (shelfBooks) shelfBooks.push(book);
    else booksByShelf.set(book.shelfId, [book]);
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
          selectedLabelIds={selectedLabelIds}
          status={statusFilter}
          matchingCount={matchingIds.size}
          totalCount={books.length}
          onToggleLabel={(labelId) =>
            setSelectedLabelIds((current) =>
              current.includes(labelId)
                ? current.filter((id) => id !== labelId)
                : [...current, labelId],
            )
          }
          onStatus={setStatusFilter}
          onClear={() => {
            setSelectedLabelIds([]);
            setStatusFilter(null);
          }}
          onManage={() => setShowLabelManager(true)}
        />
        {shelves.map((shelf) => (
          <ShelfCase
            key={shelf.id}
            shelf={shelf}
            books={booksByShelf.get(shelf.id) ?? []}
            draggedBookId={lift?.book.id ?? null}
            dimmedBookIds={dimmedBookIds}
            onOpen={(book) => {
              if (performance.now() < suppressClickRef.current) return;
              setOpenBookId(book.id);
            }}
            onPress={startPress}
          />
        ))}
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
        readerBook.format === "pdf" ? (
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
        )
      ) : null}
      {showLabelManager ? (
        <ManageLabels
          onClose={() => setShowLabelManager(false)}
          onChanged={refreshWallData}
        />
      ) : null}
      {notice ? (
        <p
          className="scan-notice library-notice"
          role="status"
          data-testid="library-notice"
        >
          {notice}
        </p>
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

interface FolderActionProps {
  busy: boolean;
  error: string | null;
  onChoose: () => void;
}

function Onboarding({ busy, error, onChoose }: FolderActionProps) {
  return (
    <main id="library-main" className="placeholder" data-testid="onboarding">
      <section className="placeholder-card">
        <p className="kicker">Before the shelves can fill</p>
        <h2>Choose a library folder</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p>
          Android gives apps access to one folder at a time. PocketLibrary reads
          your EPUBs and PDFs where they already live; nothing is copied.
        </p>
        <p className="folder-hint">
          In the picker, choose or create <strong>Documents/PocketLibrary</strong>.
        </p>
        <button
          type="button"
          className="primary-action"
          onClick={onChoose}
          disabled={busy}
        >
          {busy ? "Opening the folder picker…" : "Choose library folder"}
        </button>
        {error ? (
          <p className="action-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function Reconnect({
  folderName,
  busy,
  error,
  onChoose,
}: FolderActionProps & { folderName: string | null }) {
  return (
    <main id="library-main" className="placeholder" data-testid="reconnect">
      <section className="placeholder-card">
        <p className="kicker">The door is locked</p>
        <h2>Reconnect library folder</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p>
          PocketLibrary cannot reach{" "}
          {folderName ? <strong>{folderName}</strong> : "your library folder"}.
          Android may have revoked access, or the folder was moved or renamed.
          Your books, shelves and progress are safe.
        </p>
        <button
          type="button"
          className="primary-action"
          onClick={onChoose}
          disabled={busy}
        >
          {busy ? "Opening the folder picker…" : "Reconnect library folder"}
        </button>
        {error ? (
          <p className="action-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}

interface SettingsViewProps {
  status: LibraryStatus;
  busy: boolean;
  notice: string | null;
  shelfCapacity: number | null;
  onRescan: () => void;
  onChoose: () => void;
  onSetCapacity: (capacity: number) => void;
  onBack: () => void;
}

function SettingsView({
  status,
  busy,
  notice,
  shelfCapacity,
  onRescan,
  onChoose,
  onSetCapacity,
  onBack,
}: SettingsViewProps) {
  const reachable = status.state === "ready";
  const [draftCapacity, setDraftCapacity] = useState("");
  const [reader, setReader] = useState(() => loadReaderSettings());
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (shelfCapacity !== null) setDraftCapacity(String(shelfCapacity));
  }, [shelfCapacity]);

  useEffect(() => {
    let alive = true;
    platform
      .appInfo()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const updateReader = useCallback(
    (patch: Partial<typeof reader>) => {
      setReader((current) => {
        const next = { ...current, ...patch };
        saveReaderSettings(next);
        return next;
      });
    },
    [],
  );

  const parsedCapacity = Number(draftCapacity);
  const capacityValid =
    Number.isInteger(parsedCapacity) && parsedCapacity >= 1;
  return (
    <main
      id="library-main"
      className="placeholder settings-main"
      data-testid="settings-view"
    >
      <section className="placeholder-card settings-card">
        <button
          type="button"
          className="settings-back"
          data-testid="settings-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Back to shelf
        </button>
        <p className="kicker">The Keeper's Ledger</p>
        <h2>Settings</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>

        <section className="settings-section" aria-labelledby="settings-library">
          <h3 id="settings-library">Library</h3>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>Library folder</dt>
              <dd data-testid="settings-folder">
                {status.folderName ?? "Not chosen"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Access</dt>
              <dd>
                {reachable
                  ? "Read and write"
                  : status.state === "disconnected"
                    ? "Needs reconnecting"
                    : "Not granted"}
              </dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              type="button"
              className="primary-action"
              onClick={onRescan}
              disabled={busy || !reachable}
            >
              {busy ? "Scanning…" : "Rescan library"}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={onChoose}
            >
              Change library folder
            </button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-reader">
          <h3 id="settings-reader">Reader defaults</h3>
          <p className="settings-note">
            New and resumed books open with these.
          </p>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>Reading mode</dt>
              <dd className="setting-choice">
                <button
                  type="button"
                  data-testid="settings-reader-paginated"
                  aria-pressed={reader.mode === "paginated"}
                  onClick={() => updateReader({ mode: "paginated" })}
                >
                  Paginated
                </button>
                <button
                  type="button"
                  data-testid="settings-reader-scrolled"
                  aria-pressed={reader.mode === "scrolled"}
                  onClick={() => updateReader({ mode: "scrolled" })}
                >
                  Scroll
                </button>
              </dd>
            </div>
            <div className="setting-row">
              <dt>Theme</dt>
              <dd className="setting-choice">
                {(Object.keys(READER_THEMES) as ReaderTheme[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    data-testid={`settings-reader-theme-${theme}`}
                    aria-pressed={reader.theme === theme}
                    onClick={() => updateReader({ theme })}
                  >
                    {READER_THEMES[theme].name}
                  </button>
                ))}
              </dd>
            </div>
          </dl>
          <fieldset className="settings-size">
            <legend>Text size</legend>
            <div className="size-choices">
              {READER_SIZES.map((size, index) => (
                <button
                  key={size.name}
                  type="button"
                  data-testid={`settings-reader-size-${index}`}
                  aria-pressed={reader.size === index}
                  onClick={() => updateReader({ size: index })}
                >
                  {size.name}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="settings-section" aria-labelledby="settings-shelf">
          <h3 id="settings-shelf">Shelf</h3>
          <form
            className="capacity-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (capacityValid) onSetCapacity(parsedCapacity);
            }}
          >
            <label htmlFor="shelf-capacity">Shelf capacity</label>
            <div className="capacity-controls">
              <input
                id="shelf-capacity"
                data-testid="shelf-capacity"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={draftCapacity}
                onChange={(event) => setDraftCapacity(event.target.value)}
                disabled={busy || shelfCapacity === null}
              />
              <button
                type="submit"
                className="secondary-action"
                data-testid="save-shelf-capacity"
                disabled={busy || !capacityValid || shelfCapacity === null}
              >
                Save
              </button>
            </div>
          </form>
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-download"
          data-testid="settings-download"
        >
          <h3 id="settings-download">Download naming</h3>
          <p className="settings-value">Author - Title (Year)</p>
          <p className="settings-note">
            Placeholder until the download queue lands in ticket 11; naming is
            not editable yet.
          </p>
        </section>

        <section className="settings-section" aria-labelledby="settings-backup">
          <h3 id="settings-backup">Export / import</h3>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-action"
              data-testid="settings-export"
              disabled
            >
              Export library data
            </button>
            <button
              type="button"
              className="secondary-action"
              data-testid="settings-import"
              disabled
            >
              Import library data
            </button>
          </div>
          <p className="settings-note">
            Placeholder until backup and restore lands in ticket 12.
          </p>
        </section>

        <section className="settings-section" aria-labelledby="settings-about">
          <h3 id="settings-about">About</h3>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>App</dt>
              <dd>{info?.name ?? "PocketLibrary"}</dd>
            </div>
            <div className="setting-row">
              <dt>Version</dt>
              <dd data-testid="settings-version">
                v{info?.appVersion ?? "…"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Schema</dt>
              <dd data-testid="settings-schema">
                {info?.schemaVersion ?? "…"}
              </dd>
            </div>
          </dl>
          <p className="settings-note settings-credits">
            Typefaces: EB Garamond, Literata and Source Serif 4 under the SIL
            Open Font License. Reader engines: foliate-js and PDF.js
            (Apache-2.0). Built with Tauri.
          </p>
        </section>

        {notice ? (
          <p className="scan-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </main>
  );
}

interface SearchForm {
  query: string;
  title: string;
  author: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  format: string;
  publisher: string;
  isbn: string;
  md5: string;
}

const EMPTY_SEARCH_FORM: SearchForm = {
  query: "",
  title: "",
  author: "",
  yearFrom: "",
  yearTo: "",
  language: "",
  format: "",
  publisher: "",
  isbn: "",
  md5: "",
};

const SEARCH_LANGUAGES = [
  "English",
  "French",
  "German",
  "Spanish",
  "Italian",
  "Russian",
  "Portuguese",
] as const;

const SEARCH_FORMATS = ["epub", "pdf", "mobi", "azw3", "cbz", "cbr"] as const;

function searchYear(value: string): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : null;
}

function searchQueryFrom(form: SearchForm, page: number): SearchQuery {
  return {
    query: form.query.trim(),
    title: form.title.trim(),
    author: form.author.trim(),
    yearFrom: searchYear(form.yearFrom),
    yearTo: searchYear(form.yearTo),
    language: form.language.trim(),
    format: form.format.trim().toLowerCase(),
    publisher: form.publisher.trim(),
    isbn: form.isbn.trim(),
    md5: form.md5.trim(),
    page,
  };
}

function hasSearchTerm(form: SearchForm): boolean {
  return [form.query, form.title, form.author, form.publisher, form.isbn, form.md5]
    .map((value) => value.trim())
    .some(Boolean);
}

function searchErrorCopy(error: ApiError): { title: string; body: string } {
  switch (error.code) {
    case "offline":
      return {
        title: "The desk is offline",
        body:
          "Libgen search needs a connection. Your shelves, books and reading progress are unaffected.",
      };
    case "all_mirrors_failed":
      return {
        title: "Every mirror refused",
        body:
          "All five Libgen mirrors timed out or refused the request. Wait a moment, then try again.",
      };
    case "mirror_format_changed":
      return {
        title: "The mirror's page changed",
        body:
          "A mirror answered, but its results could not be read. Try another search, or try again later.",
      };
    case "empty_search":
      return {
        title: "Nothing to search for",
        body: "Enter a title, author, ISBN or MD5 first.",
      };
    default:
      return {
        title: "The front desk could not answer",
        body: error.message,
      };
  }
}

function SearchResultRow({
  result,
  onOpen,
}: {
  result: LibgenResult;
  onOpen: () => void;
}) {
  const author = result.authors.join("; ") || "Author unknown";
  return (
    <li>
      <button
        type="button"
        className="search-result"
        data-testid="search-result"
        onClick={onOpen}
      >
        <span className="search-result-title">{result.title}</span>
        <span className="search-result-meta">
          <span>{author}</span>
          <span>{result.year ?? "Year unknown"}</span>
          <span>{result.extension.toUpperCase()}</span>
          <span>{result.sizeText || "Size unknown"}</span>
          <span className="search-result-source">{result.source}</span>
        </span>
      </button>
    </li>
  );
}

function ResultDetail({
  result,
  onClose,
}: {
  result: LibgenResult;
  onClose: () => void;
}) {
  return (
    <div className="search-sheet-backdrop" onClick={onClose}>
      <section
        className="search-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Result details"
        data-testid="result-detail"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="search-sheet-head">
          <div>
            <p className="kicker">On the front desk</p>
            <h2>{result.title}</h2>
            <p className="search-sheet-author">
              {result.authors.join("; ") || "Author unknown"}
            </p>
          </div>
          <button
            type="button"
            className="sheet-close"
            data-testid="result-detail-close"
            aria-label="Close result details"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <dl className="search-detail-list">
          <div>
            <dt>Year</dt>
            <dd>{result.year ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd>{result.publisher ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{result.language ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{result.pages ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{result.extension.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{result.sizeText || "Unknown"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{result.source}</dd>
          </div>
          <div className="search-detail-md5">
            <dt>MD5</dt>
            <dd>{result.md5}</dd>
          </div>
        </dl>

        <section className="search-mirrors" aria-labelledby="mirror-heading">
          <h3 id="mirror-heading">Mirrors</h3>
          {result.mirrors.length === 0 ? (
            <p className="settings-note">No mirror links were listed.</p>
          ) : (
            <ul>
              {result.mirrors.map((mirror) => (
                <li key={mirror.url} data-testid="mirror-row">
                  <span className="mirror-label">{mirror.label}</span>
                  <span className="mirror-url">{mirror.url}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          type="button"
          className="primary-action search-download"
          data-testid="result-download"
          disabled
        >
          Download — arrives with the queue (ticket 11)
        </button>
        <p className="settings-note">
          The file is not fetched yet. Downloads, duplicate checks and naming are
          bound in the next ticket.
        </p>
      </section>
    </div>
  );
}

function SearchView({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState<SearchForm>(EMPTY_SEARCH_FORM);
  const [advanced, setAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState<SearchQuery | null>(null);
  const [pageData, setPageData] = useState<SearchPage | null>(null);
  const [selected, setSelected] = useState<LibgenResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (field: keyof SearchForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const runSearch = useCallback(
    async (query: SearchQuery) => {
      setBusy(true);
      setError(null);
      setSelected(null);
      try {
        const next = await platform.searchLibgen(query);
        setPageData(next);
        setSubmitted(query);
      } catch (rejection) {
        setPageData(null);
        setError(
          isApiError(rejection)
            ? rejection
            : {
                code: "unknown",
                message: "The front desk could not be reached.",
              },
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const submit = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!hasSearchTerm(form) || busy) return;
    void runSearch(searchQueryFrom(form, 1));
  };

  const turnPage = (nextPage: number) => {
    if (!submitted || busy || nextPage < 1) return;
    void runSearch({ ...submitted, page: nextPage });
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const canSearch = hasSearchTerm(form) && !busy;
  const total = pageData?.total ?? 0;
  const hasNextPage =
    pageData !== null &&
    (pageData.totalIsExact
      ? pageData.page * pageData.perPage < total
      : pageData.results.length === pageData.perPage);
  const hiddenByFilters =
    pageData !== null && pageData.filtersApplied
      ? Math.max(0, pageData.onPageBeforeFilters - pageData.results.length)
      : 0;

  return (
    <main
      id="library-main"
      className="search-view search-main"
      data-testid="search-view"
    >
      <section className="search-card">
        <button
          type="button"
          className="settings-back"
          data-testid="search-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Back to shelf
        </button>
        <p className="kicker">The Acquisition Desk</p>
        <h2>Search Libgen</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p className="search-intro">
          Ask the five LG+ mirrors at once. Formats, language and years are
          filtered here, because Libgen ignores those fields.
        </p>

        <form className="search-form" onSubmit={submit}>
          <label className="search-field search-field-wide" htmlFor="search-query">
            <span>Title or author</span>
            <input
              id="search-query"
              data-testid="search-query"
              type="search"
              value={form.query}
              placeholder="e.g. Rock Paper Scissors"
              autoComplete="off"
              onChange={(event) => update("query", event.target.value)}
            />
          </label>

          <button
            type="button"
            className="search-advanced-toggle"
            data-testid="search-advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
          >
            {advanced ? "Hide advanced fields" : "Advanced fields"}
            <span aria-hidden="true">{advanced ? " ▴" : " ▾"}</span>
          </button>

          <div className="search-advanced" hidden={!advanced}>
            <label className="search-field">
              <span>Title</span>
              <input
                data-testid="search-title"
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Author</span>
              <input
                data-testid="search-author"
                value={form.author}
                onChange={(event) => update("author", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year from</span>
              <input
                data-testid="search-year-from"
                inputMode="numeric"
                value={form.yearFrom}
                onChange={(event) => update("yearFrom", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year to</span>
              <input
                data-testid="search-year-to"
                inputMode="numeric"
                value={form.yearTo}
                onChange={(event) => update("yearTo", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Language</span>
              <select
                data-testid="search-language"
                value={form.language}
                onChange={(event) => update("language", event.target.value)}
              >
                <option value="">Any language</option>
                {SEARCH_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Format</span>
              <select
                data-testid="search-format"
                value={form.format}
                onChange={(event) => update("format", event.target.value)}
              >
                <option value="">Any format</option>
                {SEARCH_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Publisher</span>
              <input
                data-testid="search-publisher"
                value={form.publisher}
                onChange={(event) => update("publisher", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>ISBN</span>
              <input
                data-testid="search-isbn"
                inputMode="numeric"
                value={form.isbn}
                onChange={(event) => update("isbn", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>MD5</span>
              <input
                data-testid="search-md5"
                value={form.md5}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => update("md5", event.target.value)}
              />
            </label>
          </div>

          <button
            type="submit"
            className="primary-action search-submit"
            data-testid="search-submit"
            disabled={!canSearch}
          >
            {busy ? "Searching the mirrors…" : "Search"}
          </button>
        </form>

        {error ? (
          <div className="search-state" data-testid="search-error" role="alert">
            <h3>{searchErrorCopy(error).title}</h3>
            <p>{searchErrorCopy(error).body}</p>
            <button
              type="button"
              className="secondary-action"
              data-testid="search-retry"
              onClick={() => submit()}
              disabled={!canSearch}
            >
              Try again
            </button>
          </div>
        ) : null}

        {!error && pageData && pageData.results.length === 0 ? (
          <div className="search-state" data-testid="search-empty">
            <h3>
              {total === 0
                ? "No files found"
                : pageData.page > 1
                  ? "No more results on this page"
                  : "Nothing on this page matches"}
            </h3>
            <p>
              {total === 0
                ? "The mirrors answered honestly: nothing matches that search."
                : "Turn back a page, widen the year range, or clear a format or language filter."}
            </p>
          </div>
        ) : null}

        {!error && pageData && pageData.results.length > 0 ? (
          <section className="search-results" aria-labelledby="results-heading">
            <div className="search-summary">
              <h3 id="results-heading">Front desk ledger</h3>
              <p data-testid="search-counts">
                <strong>{total}</strong>{" "}
                {pageData.totalIsExact ? "files" : "or more files"} at Libgen ·{" "}
                {pageData.results.length} shown on this page
                {hiddenByFilters > 0
                  ? ` · ${hiddenByFilters} hidden by your filters`
                  : ""}
                {" · "}
                answered by {pageData.sourceMirror}
              </p>
            </div>
            <ul className="search-list">
              {pageData.results.map((result) => (
                <SearchResultRow
                  key={result.md5}
                  result={result}
                  onOpen={() => setSelected(result)}
                />
              ))}
            </ul>
            <nav className="search-pager" aria-label="Result pages">
              <button
                type="button"
                className="secondary-action"
                data-testid="search-prev"
                disabled={busy || pageData.page <= 1}
                onClick={() => turnPage(pageData.page - 1)}
              >
                Previous
              </button>
              <span data-testid="search-page">Page {pageData.page}</span>
              <button
                type="button"
                className="secondary-action"
                data-testid="search-next"
                disabled={busy || !hasNextPage}
                onClick={() => turnPage(pageData.page + 1)}
              >
                Next
              </button>
            </nav>
          </section>
        ) : null}

        {!error && !pageData ? (
          <p className="search-idle">
            The desk is ready. Search by title or author, or open the advanced
            fields for year, language, format, publisher, ISBN and MD5.
          </p>
        ) : null}
      </section>

      {selected ? (
        <ResultDetail result={selected} onClose={() => setSelected(null)} />
      ) : null}
    </main>
  );
}

function AppInfoFooter({ hidden = false }: { hidden?: boolean }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    platform
      .appInfo()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer
      className={`app-info${hidden ? " app-info-hidden" : ""}`}
      data-testid="app-info"
      aria-live="polite"
      aria-hidden={hidden || undefined}
    >
      {failed ? (
        <span>App information unavailable</span>
      ) : (
        <>
          <span>{info?.name ?? "PocketLibrary"}</span>
          <span aria-hidden="true">·</span>
          <span>v{info?.appVersion ?? "…"}</span>
          <span aria-hidden="true">·</span>
          <span>schema {info?.schemaVersion ?? "…"}</span>
        </>
      )}
    </footer>
  );
}

const SCAN_REASON_LABELS: Record<ScanIssueReason, string> = {
  unreadable: "could not be read",
  invalid_epub: "not a valid EPUB",
  invalid_pdf: "not a valid PDF",
};

function scanNotice(report: ScanReport): string {
  const added = report.added === 1 ? "1 new book" : `${report.added} new books`;
  const removed =
    report.removed === 0
      ? null
      : report.removed === 1
        ? "1 book marked finished"
        : `${report.removed} books marked finished`;
  const duplicates =
    report.duplicates > 0
      ? report.duplicates === 1
        ? "1 duplicate copy ignored"
        : `${report.duplicates} duplicate copies ignored`
      : null;
  const skipped =
    report.skipped.length > 0
      ? report.skipped
          .slice(0, 2)
          .map(
            (issue) =>
              `Skipped ${issue.name}: ${SCAN_REASON_LABELS[issue.reason]}`,
          )
          .join(" · ")
      : null;
  return [`Scan complete: ${report.total} books`, added, removed, duplicates, skipped]
    .filter(Boolean)
    .join(" · ");
}

type ScanOutcome =
  | { kind: "report"; report: ScanReport }
  | { kind: "unavailable" }
  | { kind: "failed" };

async function runScan(): Promise<ScanOutcome> {
  try {
    return { kind: "report", report: await platform.rescanLibrary() };
  } catch (error) {
    return { kind: isLibraryUnavailable(error) ? "unavailable" : "failed" };
  }
}

function disconnected(status: LibraryStatus): LibraryStatus {
  return { state: "disconnected", folderName: status.folderName };
}

export default function App() {
  const [view, setView] = useState<View>("library");
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shelfCapacity, setShelfCapacity] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOffset, setDrawerOffset] = useState<number | null>(null);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [showDrawerHint, setShowDrawerHint] = useState(false);
  const pullRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const drawerDragRef = useRef<{
    fromOpen: boolean;
    y0: number;
    t0: number;
    height: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressRailRef = useRef(0);
  const lastHandleGestureRef = useRef(0);
  const drawerOpenedAtRef = useRef(0);
  const drawerTrackingRef = useRef(false);

  const openDrawer = useCallback(() => {
    setShowDrawerHint(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpen(true);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
    drawerOpenedAtRef.current = performance.now();
  }, []);

  const dismissDrawerHint = useCallback(() => {
    setShowDrawerHint(false);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
  }, []);

  const closeView = useLayerExit(
    view !== "library",
    useCallback(() => setView("library"), []),
  );

  const closeDrawer = useLayerExit(drawerOpen, () => {
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    pullRef.current?.focus();
  });

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(DRAWER_HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    const show = window.setTimeout(() => {
      setShowDrawerHint(true);
      // The hint is one-time: mark it as seen as soon as it appears, so a
      // dismissal or a reload never brings it back.
      try {
        window.localStorage.setItem(DRAWER_HINT_KEY, "1");
      } catch {
        // A private WebView may refuse storage; the hint simply returns.
      }
    }, 900);
    const hide = window.setTimeout(() => setShowDrawerHint(false), 7100);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    if (!showDrawerHint) return;
    const dismiss = () => dismissDrawerHint();
    window.addEventListener("pointerdown", dismiss, { passive: true });
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [showDrawerHint, dismissDrawerHint]);

  function startDrawerDrag(fromOpen: boolean, event: ReactPointerEvent) {
    if (fromOpen && !drawerOpen) return;
    if (!fromOpen && drawerOpen) return;
    if (fromOpen && (event.target as HTMLElement).closest("button")) return;
    const rail = railRef.current;
    const height = rail?.offsetHeight || 208;
    dismissDrawerHint();
    drawerDragRef.current = {
      fromOpen,
      y0: event.clientY,
      t0: performance.now(),
      height,
      y: fromOpen ? 0 : height,
      moved: false,
    };
    if (!fromOpen) {
      setDrawerOpen(true);
      drawerOpenedAtRef.current = performance.now();
    }
    setDrawerDragging(true);
    setDrawerOffset(fromOpen ? 0 : height);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners still work.
    }
    if (!(event.target as HTMLElement).closest("button")) {
      event.preventDefault();
    }
    trackDrawerDrag();
  }

  // Attach the move/end listeners in the same turn as pointerdown. Waiting
  // for a React effect would drop the first few pixels of a quick drag.
  function trackDrawerDrag() {
    if (drawerTrackingRef.current) return;
    drawerTrackingRef.current = true;
    const onMove = (event: PointerEvent) => {
      const drag = drawerDragRef.current;
      if (!drag) return;
      const dy = event.clientY - drag.y0;
      if (Math.abs(dy) > 6) drag.moved = true;
      const y = drag.fromOpen
        ? Math.max(0, Math.min(drag.height, dy))
        : Math.max(0, Math.min(drag.height, drag.height + dy));
      drag.y = y;
      setDrawerOffset(y);
      if (event.cancelable) event.preventDefault();
    };
    const onEnd = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      drawerTrackingRef.current = false;
      const drag = drawerDragRef.current;
      drawerDragRef.current = null;
      setDrawerDragging(false);
      if (!drag) return;
      const dy = (event.clientY ?? drag.y0) - drag.y0;
      const dt = Math.max(1, performance.now() - drag.t0);
      const velocity = dy / dt;
      if (!drag.fromOpen) lastHandleGestureRef.current = performance.now();
      if (drag.moved && drag.fromOpen) {
        suppressRailRef.current = performance.now() + 500;
      }
      let shouldOpen: boolean;
      if (drag.fromOpen) {
        shouldOpen = !(drag.y > drag.height * 0.25 || velocity > 0.45);
      } else {
        shouldOpen =
          drag.y < drag.height * 0.55 || velocity < -0.45;
        if (!drag.moved && dt < 420) shouldOpen = true;
      }
      if (shouldOpen) openDrawer();
      else closeDrawer();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  const navigate = useCallback((next: View) => {
    // Let the view's layer take over before the drawer's layer leaves, so the
    // guard history entry is replaced rather than popped and re-pushed.
    setView(next);
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
  }, []);

  const initialLoadStarted = useRef(false);

  useEffect(() => {
    // A single launch reconciliation; StrictMode may replay this effect, but
    // scanning twice would waste a scan.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    (async () => {
      try {
        let next = await platform.libraryStatus();
        if (next.state === "ready") {
          const outcome = await runScan();
          if (outcome.kind === "unavailable") next = disconnected(next);
        }
        setStatus(next);
      } catch {
        setStatusFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    platform
      .getShelfCapacity()
      .then((next) => {
        if (alive) setShelfCapacity(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const chooseFolder = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      let next = await platform.chooseLibraryFolder();
      if (next.state === "ready") {
        const outcome = await runScan();
        if (outcome.kind === "report") {
          setNotice(scanNotice(outcome.report));
        } else if (outcome.kind === "unavailable") {
          next = disconnected(next);
        } else {
          setActionError("The folder was granted, but the first scan failed.");
        }
      }
      setStatus(next);
      setReloadKey((key) => key + 1);
    } catch {
      setActionError("The folder picker could not be opened. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const rescan = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await runScan();
      if (outcome.kind === "report") {
        setNotice(scanNotice(outcome.report));
        setReloadKey((key) => key + 1);
      } else if (outcome.kind === "unavailable") {
        setStatus((current) => (current ? disconnected(current) : current));
        setNotice(null);
      } else {
        setNotice("The scan could not be completed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const saveCapacity = useCallback(async (capacity: number) => {
    setBusy(true);
    setNotice(null);
    try {
      const applied = await platform.setShelfCapacity(capacity);
      setShelfCapacity(applied);
      setReloadKey((key) => key + 1);
      setNotice(`Shelf capacity set to ${applied}.`);
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "Shelf capacity could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    firstItemRef.current?.focus();
  }, [drawerOpen]);

  function renderMain() {
    if (view === "search") return <SearchView onBack={closeView} />;
    if (view === "settings") {
      if (status === null) {
        return (
          <main id="library-main" className="placeholder" aria-busy="true">
            <div className="wall-inner" />
          </main>
        );
      }
      return (
        <SettingsView
          status={status}
          busy={busy}
          notice={notice}
          shelfCapacity={shelfCapacity}
          onRescan={rescan}
          onChoose={chooseFolder}
          onSetCapacity={saveCapacity}
          onBack={closeView}
        />
      );
    }
    if (statusFailed) {
      return (
        <main id="library-main" className="placeholder" data-testid="library-error">
          <section className="placeholder-card">
            <p className="kicker">The Keeper's Ledger</p>
            <h2>Library unavailable</h2>
            <p>The library folder state could not be read just now.</p>
          </section>
        </main>
      );
    }
    if (status === null) {
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
    if (status.state === "needsFolder") {
      return (
        <Onboarding busy={busy} error={actionError} onChoose={chooseFolder} />
      );
    }
    if (status.state === "disconnected") {
      return (
        <Reconnect
          folderName={status.folderName}
          busy={busy}
          error={actionError}
          onChoose={chooseFolder}
        />
      );
    }
    return (
      <LibraryWall
        reloadKey={reloadKey}
        notice={notice}
        onAddBooks={chooseFolder}
        onFindBook={() => setView("search")}
      />
    );
  }

  const libraryReady = view === "library" && status?.state === "ready";
  return (
    <div className={`room v4-room${drawerOpen ? " is-drawer-open" : ""}`}>
      {!libraryReady ? <Masthead /> : null}
      <AppInfoFooter hidden={view !== "settings"} />

      {renderMain()}

      <div
        className="edge-zone"
        aria-hidden="true"
        onPointerDown={(event) => startDrawerDrag(false, event)}
      />
      <button
        ref={pullRef}
        type="button"
        className="drawer-pull"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="navigation-drawer"
        onPointerDown={(event) => startDrawerDrag(false, event)}
        onClick={() => {
          if (performance.now() - lastHandleGestureRef.current < 500) return;
          if (drawerOpen) closeDrawer();
          else openDrawer();
        }}
      >
        <span className="pull-slot" aria-hidden="true" />
      </button>

      {showDrawerHint && !drawerOpen ? (
        <p className="drawer-hint show" role="status">
          <span className="up" aria-hidden="true">↑</span> Swipe up to open the drawer
        </p>
      ) : null}

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close navigation"
            onClick={() => closeDrawer()}
          />
          <div id="navigation-drawer" className="drawer is-open">
            <div
              ref={railRef}
              className={`drawer-rail${drawerDragging ? " is-dragging" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="drawer-title"
              style={
                drawerOffset !== null
                  ? { transform: `translate3d(0, ${drawerOffset}px, 0)` }
                  : undefined
              }
              onPointerDown={(event) => startDrawerDrag(true, event)}
              onClickCapture={(event) => {
                if (performance.now() < suppressRailRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <h2 id="drawer-title" className="visually-hidden">
                Navigation
              </h2>
              <div className="drawer-grip" aria-hidden="true" />
              <p className="drawer-cap">The Household Catalogue</p>
              <div className="drawer-items">
                {NAV_ITEMS.map((item, index) => (
                  <button
                    key={item.view}
                    ref={index === 0 ? firstItemRef : undefined}
                    type="button"
                    className="drawer-item"
                    aria-current={view === item.view ? "page" : undefined}
                    onClick={() => navigate(item.view)}
                  >
                    <svg
                      width="25"
                      height="25"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      {item.view === "library" ? (
                        <>
                          <path d="M4 4.5h3v15H4zM9 6h3v13.5H9zM14 3.5l3 .8-4 14.8-3-.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                          <path d="M3 20.5h18" stroke="currentColor" strokeWidth="1.2" />
                        </>
                      ) : item.view === "search" ? (
                        <>
                          <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M12 3.2v2M12 18.8v2M20.8 12h-2M5.2 12h-2M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4M18.2 18.2l-1.4-1.4M7.2 7.2L5.8 5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                    <b>{item.label}</b>
                    <span aria-hidden="true">{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="drawer-foot">Tap outside or swipe down to close</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
