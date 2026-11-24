import { useCallback, useEffect, useRef, useState } from "react";

import {
  isApiError,
  isLibraryUnavailable,
  platform,
  type AppInfo,
  type Book,
  type BookDetail,
  type LibraryStatus,
  type Placement,
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
  onOpen: (book: Book) => void;
}

function ShelfCase({ shelf, books, onOpen }: ShelfCaseProps) {
  const mark = shelfMark(shelf.ordinal);
  const empty = books.length === 0;

  return (
    <section
      className="shelf"
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
                return (
                  <li
                    key={book.id}
                    className="spine"
                    data-testid="spine"
                    data-status={book.readingStatus}
                    title={`${book.title} — ${statusLabel}`}
                    aria-label={`${book.title}, ${statusLabel}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(book)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(book);
                      }
                    }}
                  >
                    <span className="spine-title">{book.title}</span>
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
}

function DetailPanel({ bookId, onClose }: DetailPanelProps) {
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [readerNotice, setReaderNotice] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setFailed(false);
    setReaderNotice(false);
    platform
      .getBookDetail(bookId)
      .then((next) => {
        if (alive) setDetail(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

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
              <div className="rule detail-rule" aria-hidden="true">
                <span>❧</span>
              </div>
              <p className="detail-blurb" data-testid="detail-blurb">
                {detail.description ?? "No blurb was printed with this edition."}
              </p>

              <dl className="detail-meta">
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

interface LibraryWallProps {
  reloadKey: number;
  notice: string | null;
  undo: Placement | null;
  busy: boolean;
  onUndo: () => void;
  onAddBooks: () => void;
  onFindBook: () => void;
}

function LibraryWall({
  reloadKey,
  notice,
  undo,
  busy,
  onUndo,
  onAddBooks,
  onFindBook,
}: LibraryWallProps) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [failed, setFailed] = useState(false);
  const [openBookId, setOpenBookId] = useState<number | null>(null);
  const closeDetail = useCallback(() => setOpenBookId(null), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([platform.listShelves(), platform.listBooks()])
      .then(([nextShelves, nextBooks]) => {
        if (!alive) return;
        setShelves(nextShelves);
        setBooks(nextBooks);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

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

  const booksByShelf = new Map<number, Book[]>();
  for (const book of books) {
    if (book.shelfId === null) continue;
    const shelfBooks = booksByShelf.get(book.shelfId);
    if (shelfBooks) shelfBooks.push(book);
    else booksByShelf.set(book.shelfId, [book]);
  }

  return (
    <main id="library-main" className="library-wall" data-testid="library-wall">
      <div className="wall-inner">
        {shelves.map((shelf) => (
          <ShelfCase
            key={shelf.id}
            shelf={shelf}
            books={booksByShelf.get(shelf.id) ?? []}
            onOpen={(book) => setOpenBookId(book.id)}
          />
        ))}
      </div>
      {openBookId !== null ? (
        <DetailPanel bookId={openBookId} onClose={closeDetail} />
      ) : null}
      {undo !== null ? (
        <aside className="undo-notice" data-testid="undo-notice" role="status">
          <p>A new shelf was added for the book you just imported.</p>
          <button
            type="button"
            className="secondary-action undo-action"
            data-testid="undo-placement"
            onClick={onUndo}
            disabled={busy}
          >
            {busy ? "Undoing…" : "Undo"}
          </button>
        </aside>
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

function appendedPlacement(report: ScanReport): Placement | null {
  const placements = report.placements ?? [];
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    if (placements[index].appendedShelf) return placements[index];
  }
  return null;
}

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
  const [pendingUndo, setPendingUndo] = useState<Placement | null>(null);
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
    // scanning twice would waste a scan and lose the first undo notice.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    (async () => {
      try {
        let next = await platform.libraryStatus();
        if (next.state === "ready") {
          const outcome = await runScan();
          if (outcome.kind === "unavailable") next = disconnected(next);
          if (outcome.kind === "report") {
            setPendingUndo(appendedPlacement(outcome.report));
          }
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
          setPendingUndo(appendedPlacement(outcome.report));
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
        setPendingUndo(appendedPlacement(outcome.report));
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

  const undoPlacement = useCallback(async () => {
    if (pendingUndo === null) return;
    setBusy(true);
    setNotice(null);
    try {
      const removed = await platform.undoPlacement(
        pendingUndo.bookId,
        pendingUndo.shelfId,
      );
      setPendingUndo(null);
      setReloadKey((key) => key + 1);
      setNotice(
        removed
          ? "Removed from the library — the file stays in your folder"
          : "That shelf has changed, so nothing was removed.",
      );
    } catch (error) {
      setPendingUndo(null);
      setNotice(
        isApiError(error)
          ? error.message
          : "The placement could not be undone. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [pendingUndo]);

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
        undo={pendingUndo}
        busy={busy}
        onUndo={undoPlacement}
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
