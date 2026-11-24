import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  LABEL_PALETTE,
  isApiError,
  isLibraryUnavailable,
  platform,
  type AppInfo,
  type Book,
  type BookDetail,
  type Label,
  type LabelUsage,
  type LibraryStatus,
  type ReadingState,
  type ReadingStatus,
  type ScanIssueReason,
  type ScanReport,
  type Shelf,
} from "./platform";
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

const NAV_ITEMS: ReadonlyArray<{ view: View; label: string }> = [
  { view: "library", label: "Library" },
  { view: "search", label: "Search" },
  { view: "settings", label: "Settings" },
];

function Masthead() {
  return (
    <header className="masthead">
      <p className="kicker">Bibliotheca Domestica</p>
      <div className="crest" aria-hidden="true">
        ❦
      </div>
      <h1>Pocket Library</h1>
      <div className="rule" aria-hidden="true">
        <span>❧</span>
      </div>
      <p className="tagline">A quiet room for your own books</p>
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
  return (
    <>
      <span className="spine-title">{book.title}</span>
      {bands.length > 0 ? (
        <span className="spine-labels" aria-hidden="true">
          {bands.map((label) => (
            <span
              key={label.id}
              className="spine-label-band"
              data-testid="spine-label-band"
              style={{ backgroundColor: label.colour }}
              title={label.name}
            >
              {label.name}
            </span>
          ))}
          {hiddenLabels > 0 ? (
            <span className="spine-label-more" data-testid="spine-label-more">
              +{hiddenLabels}
            </span>
          ) : null}
        </span>
      ) : null}
      {book.readingStatus === "finished" ? (
        <span
          className="spine-seal"
          data-testid="spine-seal"
          aria-hidden="true"
        >
          ✓
        </span>
      ) : null}
      {book.readingStatus === "reading" ? (
        <span
          className="spine-ribbon"
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

  return (
    <section
      className="shelf"
      data-shelf-id={shelf.id}
      data-testid={empty ? "empty-shelf" : "shelf"}
      aria-label={
        empty ? `Shelf ${mark}, empty` : `Shelf ${mark}, ${books.length} books`
      }
    >
      <div className="case">
        <div className="crown" aria-hidden="true">
          <span className="crest-small">❦</span>
        </div>
        <div className="cavity">
          <div className="back" aria-hidden="true" />
          <div className="pilaster pilaster-left" aria-hidden="true" />
          <div className="pilaster pilaster-right" aria-hidden="true" />
          <div className="lamp" aria-hidden="true" />
          {empty ? (
            <div className="empty-note">
              <span className="empty-title">Shelf {mark}</span>
              <span className="empty-sub">Awaiting its first volume</span>
            </div>
          ) : (
            <ul className="spines">
              {books.map((book) => {
                const statusLabel = STATUS_LABELS[book.readingStatus];
                const dragging = draggedBookId === book.id;
                const dimmed = dimmedBookIds.has(book.id);
                return (
                  <li
                    key={book.id}
                    className={`spine${dragging ? " is-dragging-source" : ""}${
                      book.labels.length > 0 ? " has-labels" : ""
                    }${dimmed ? " is-dimmed" : ""}`}
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
        <div className="lip" aria-hidden="true" />
        <div className="board">
          <span className="plate">Shelf {mark}</span>
        </div>
        <div className="plinth" aria-hidden="true" />
      </div>
    </section>
  );
}

interface DetailPanelProps {
  bookId: number;
  onClose: () => void;
  onBookChanged: (patch: {
    id: number;
    readingStatus?: ReadingStatus;
    labels?: Label[];
  }) => void;
  onLabelsChanged: () => void;
}

function DetailPanel({
  bookId,
  onClose,
  onBookChanged,
  onLabelsChanged,
}: DetailPanelProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [availableLabels, setAvailableLabels] = useState<LabelUsage[]>([]);
  const [failed, setFailed] = useState(false);
  const [readerNotice, setReaderNotice] = useState(false);
  const [statusMenu, setStatusMenu] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
    setReaderNotice(false);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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

  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close book detail"
        onClick={onClose}
      />
      <section
        className="book-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        data-testid="book-detail"
      >
        <button
          ref={closeRef}
          type="button"
          className="detail-close"
          aria-label="Back to shelf"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>

        {failed ? (
          <div className="detail-loading">
            <p className="kicker">The Keeper's Ledger</p>
            <h2 id="detail-title">This volume is unavailable</h2>
            <p>The book could not be opened just now.</p>
          </div>
        ) : detail === null ? (
          <div className="detail-loading" aria-busy="true">
            <p className="kicker">Fetching the volume</p>
            <h2 id="detail-title">Opening…</h2>
          </div>
        ) : (
          <>
            <figure className="detail-cover-frame">
              <div className="detail-cover-mat">
                {detail.coverDataUrl ? (
                  <img
                    className="detail-cover"
                    data-testid="detail-cover"
                    src={detail.coverDataUrl}
                    alt={`Cover of ${detail.title}`}
                  />
                ) : (
                  <div className="detail-cover detail-cover-fallback" aria-hidden="true">
                    {detail.title.slice(0, 1)}
                  </div>
                )}
                <div className="cover-status">
                  <button
                    type="button"
                    className="cover-status-button"
                    data-testid="detail-status-control"
                    aria-haspopup="menu"
                    aria-expanded={statusMenu}
                    onClick={() => {
                      setStatusMenu((open) => !open);
                      setLabelMenu(false);
                    }}
                  >
                    Status · {STATUS_LABELS[detail.readingStatus]}
                  </button>
                  {statusMenu ? (
                    <div
                      className="cover-status-menu"
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
                          className="cover-status-option"
                          data-testid={`detail-status-option-${status}`}
                          onClick={() => chooseStatus(status)}
                        >
                          {STATUS_LABELS[status]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {sticker ? (
                  <div
                    className={`cover-sticker cover-sticker-${sticker.kind}`}
                    data-testid="detail-sticker"
                    data-sticker={sticker.kind}
                    aria-label={
                      sticker.kind === "gold"
                        ? "Finished"
                        : `${sticker.text} read`
                    }
                  >
                    {sticker.text}
                  </div>
                ) : null}
              </div>
            </figure>

            <div className="detail-body">
              <p className="kicker">From the shelf</p>
              <h2 id="detail-title" data-testid="detail-title">
                {detail.title}
              </h2>
              <p className="detail-author" data-testid="detail-author">
                {authors}
              </p>
              {detail.series ? (
                <p className="detail-series">{detail.series}</p>
              ) : null}
              <div className="detail-labels" data-testid="detail-labels">
                {detail.labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className="detail-label-chip"
                    data-testid="detail-label-chip"
                    style={{ backgroundColor: label.colour }}
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
                  className="detail-label-add"
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
              <div className="rule detail-rule" aria-hidden="true">
                <span>❧</span>
              </div>
              <p className="detail-blurb" data-testid="detail-blurb">
                {detail.description ?? "No blurb was printed with this edition."}
              </p>

              <dl className="detail-meta" data-testid="detail-meta">
                <div className="detail-meta-row">
                  <dt>Format</dt>
                  <dd>{detail.format.toUpperCase()}</dd>
                </div>
                {detail.publisher ? (
                  <div className="detail-meta-row">
                    <dt>Publisher</dt>
                    <dd>{detail.publisher}</dd>
                  </div>
                ) : null}
                {detail.publishedDate ? (
                  <div className="detail-meta-row">
                    <dt>Published</dt>
                    <dd>{detail.publishedDate}</dd>
                  </div>
                ) : null}
                {detail.language ? (
                  <div className="detail-meta-row">
                    <dt>Language</dt>
                    <dd>{detail.language}</dd>
                  </div>
                ) : null}
                {detail.pageCount ? (
                  <div className="detail-meta-row">
                    <dt>Pages</dt>
                    <dd>{detail.pageCount}</dd>
                  </div>
                ) : null}
                {detail.identifier ? (
                  <div className="detail-meta-row">
                    <dt>Identifier</dt>
                    <dd>{detail.identifier}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="detail-actions">
                <button
                  type="button"
                  className="primary-action"
                  data-testid="detail-read"
                  onClick={() => setReaderNotice(true)}
                >
                  {readLabel}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  data-testid="detail-back"
                  onClick={onClose}
                >
                  Back to shelf
                </button>
              </div>
              {readerNotice ? (
                <p className="detail-note" role="status">
                  The reading room opens in the next chapter.
                </p>
              ) : null}
            </div>
          </>
        )}
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
  return (
    <section
      className="filter-strip"
      data-testid="filter-strip"
      aria-label="Shelf filters"
    >
      <div className="filter-row">
        <span className="filter-kicker">Filter</span>
        <div className="filter-chips" role="group" aria-label="Label filters">
          {labels.length === 0 ? (
            <span className="filter-empty">No labels yet</span>
          ) : (
            labels.map((label) => (
              <button
                key={label.id}
                type="button"
                className="filter-chip filter-label-chip"
                data-testid="filter-label-chip"
                aria-pressed={selectedLabelIds.includes(label.id)}
                style={{ borderColor: label.colour }}
                onClick={() => onToggleLabel(label.id)}
              >
                <span
                  className="filter-dot"
                  style={{ backgroundColor: label.colour }}
                  aria-hidden="true"
                />
                <span>{label.name}</span>
                <span className="filter-count">{label.bookCount}</span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="filter-row filter-status-row">
        <div
          className="filter-chips"
          role="group"
          aria-label="Reading status filters"
        >
          {(["unread", "reading", "finished"] as ReadingStatus[]).map(
            (value) => (
              <button
                key={value}
                type="button"
                className="filter-chip filter-status-chip"
                data-testid={`filter-status-${value}`}
                aria-pressed={status === value}
                onClick={() => onStatus(status === value ? null : value)}
              >
                {STATUS_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="filter-manage"
          data-testid="manage-labels"
          onClick={onManage}
        >
          Manage labels
        </button>
      </div>
      <div className="filter-summary">
        <span data-testid="filter-count" aria-live="polite">
          {active
            ? `${matchingCount} of ${totalCount} books match`
            : `${totalCount} books on the wall`}
        </span>
        <button
          type="button"
          className="filter-clear"
          data-testid="filter-clear"
          onClick={onClear}
          disabled={!active}
        >
          Clear filters
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refresh, onClose]);

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
        onClick={onClose}
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
          onClick={onClose}
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
    const next = new Map<number, ShelfGeometry>();
    wall
      .querySelectorAll<HTMLElement>("section.shelf[data-shelf-id]")
      .forEach((section) => {
        const shelfId = Number(section.dataset.shelfId);
        const rect = section.getBoundingClientRect();
        const slots: ShelfGeometry["slots"] = [];
        section
          .querySelectorAll<HTMLElement>(".spines > .spine")
          .forEach((element) => {
            const spine = element.getBoundingClientRect();
            slots.push({
              bookId: Number(element.dataset.bookId),
              center: spine.left + spine.width / 2,
            });
          });
        next.set(shelfId, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          slots,
        });
      });
    geometryRef.current = next;
  }, []);

  const captureSpineRects = useCallback((shelfIds: Set<number>) => {
    const positions = new Map<number, { left: number; top: number }>();
    wallRef.current
      ?.querySelectorAll<HTMLElement>("section.shelf[data-shelf-id]")
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
          onClose={closeDetail}
          onBookChanged={updateBook}
          onLabelsChanged={refreshLabels}
        />
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
            className={`spine drag-ghost${lift.returning ? " is-returning" : ""}`}
            style={{
              left: lift.left,
              top: lift.top,
              width: lift.width,
              height: lift.height,
              transform: lift.returning
                ? `translate3d(${lift.dx}px, ${lift.dy}px, 0) scale(1)`
                : undefined,
            }}
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
}

function SettingsView({
  status,
  busy,
  notice,
  shelfCapacity,
  onRescan,
  onChoose,
  onSetCapacity,
}: SettingsViewProps) {
  const reachable = status.state === "ready";
  const [draftCapacity, setDraftCapacity] = useState("");

  useEffect(() => {
    if (shelfCapacity !== null) setDraftCapacity(String(shelfCapacity));
  }, [shelfCapacity]);

  const parsedCapacity = Number(draftCapacity);
  const capacityValid =
    Number.isInteger(parsedCapacity) && parsedCapacity >= 1;
  return (
    <main id="library-main" className="placeholder" data-testid="settings-view">
      <section className="placeholder-card settings-card">
        <p className="kicker">The Keeper's Ledger</p>
        <h2>Settings</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <dl className="settings-list">
          <div className="setting-row">
            <dt>Library folder</dt>
            <dd>{status.folderName ?? "Not chosen"}</dd>
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
        <div className="settings-actions">
          <button
            type="button"
            className="primary-action"
            onClick={onRescan}
            disabled={busy || !reachable}
          >
            {busy ? "Scanning…" : "Rescan library"}
          </button>
          <button type="button" className="secondary-action" onClick={onChoose}>
            Change library folder
          </button>
        </div>
        {notice ? (
          <p className="scan-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function SearchPlaceholder() {
  return (
    <main id="library-main" className="placeholder" data-testid="placeholder-view">
      <section className="placeholder-card">
        <p className="kicker">The Acquisition Desk</p>
        <h2>Search</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p>Searching the wider library is being bound in a later chapter.</p>
      </section>
    </main>
  );
}

function AppInfoFooter() {
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
    <footer className="app-info" data-testid="app-info" aria-live="polite">
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
  const pullRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const closeDrawer = useCallback((restoreFocus = true) => {
    setDrawerOpen(false);
    if (restoreFocus) {
      pullRef.current?.focus();
    }
  }, []);

  const navigate = useCallback(
    (next: View) => {
      setView(next);
      closeDrawer();
    },
    [closeDrawer],
  );

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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, closeDrawer]);

  function renderMain() {
    if (view === "search") return <SearchPlaceholder />;
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

  return (
    <div className="room">
      <Masthead />
      <AppInfoFooter />

      {renderMain()}

      <button
        ref={pullRef}
        type="button"
        className="drawer-pull"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="navigation-drawer"
        onClick={() => setDrawerOpen(true)}
      >
        <span className="pull-handle" aria-hidden="true" />
      </button>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close navigation"
            onClick={() => closeDrawer()}
          />
          <div
            id="navigation-drawer"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            <div className="drawer-inner">
              <div className="drawer-grip" aria-hidden="true" />
              <h2 id="drawer-title" className="drawer-title">
                Navigation
              </h2>
              <nav aria-label="Main navigation">
                <ul className="drawer-list">
                  {NAV_ITEMS.map((item, index) => (
                    <li key={item.view}>
                      <button
                        ref={index === 0 ? firstItemRef : undefined}
                        type="button"
                        className="drawer-item"
                        aria-current={view === item.view ? "page" : undefined}
                        onClick={() => navigate(item.view)}
                      >
                        <span>{item.label}</span>
                        <span className="drawer-mark" aria-hidden="true">
                          ❧
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
