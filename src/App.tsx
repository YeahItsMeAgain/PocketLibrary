import { useCallback, useEffect, useRef, useState } from "react";

import {
  isLibraryUnavailable,
  platform,
  type AppInfo,
  type Book,
  type LibraryStatus,
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

function ShelfCase({ shelf, books }: { shelf: Shelf; books: Book[] }) {
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
              {books.map((book) => (
                <li
                  key={book.id}
                  className="spine"
                  data-testid="spine"
                  data-status={book.readingStatus}
                  title={book.title}
                >
                  <span>{book.title}</span>
                </li>
              ))}
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

interface LibraryWallProps {
  reloadKey: number;
  onAddBooks: () => void;
  onFindBook: () => void;
}

function LibraryWall({ reloadKey, onAddBooks, onFindBook }: LibraryWallProps) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [failed, setFailed] = useState(false);

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
          />
        ))}
      </div>
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
  onRescan: () => void;
  onChoose: () => void;
}

function SettingsView({
  status,
  busy,
  notice,
  onRescan,
  onChoose,
}: SettingsViewProps) {
  const reachable = status.state === "ready";
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

function scanNotice(report: ScanReport): string {
  const added = report.added === 1 ? "1 new book" : `${report.added} new books`;
  const removed =
    report.removed === 0
      ? null
      : report.removed === 1
        ? "1 book marked finished"
        : `${report.removed} books marked finished`;
  return [`Scan complete: ${report.total} books`, added, removed]
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let next = await platform.libraryStatus();
        if (next.state === "ready") {
          const outcome = await runScan();
          if (outcome.kind === "unavailable") next = disconnected(next);
        }
        if (alive) setStatus(next);
      } catch {
        if (alive) setStatusFailed(true);
      }
    })();
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
          onRescan={rescan}
          onChoose={chooseFolder}
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
