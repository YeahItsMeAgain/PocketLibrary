import { useCallback, useEffect, useRef, useState } from "react";

import { platform, type AppInfo, type Book, type Shelf } from "./platform";
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
                <li key={book.id} className="spine" title={book.title}>
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

function LibraryWall() {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
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
  }, []);

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
      {books.length === 0 && shelves.length > 0 && (
        <p className="wall-note">
          No volumes yet. The room is ready when you are.
        </p>
      )}
    </main>
  );
}

const PLACEHOLDERS: Record<Exclude<View, "library">, { kicker: string; title: string; body: string }> = {
  search: {
    kicker: "The Acquisition Desk",
    title: "Search",
    body: "Searching the wider library is being bound in a later chapter.",
  },
  settings: {
    kicker: "The Keeper's Ledger",
    title: "Settings",
    body: "The library folder, reader defaults and backup will live here soon.",
  },
};

function Placeholder({ view }: { view: Exclude<View, "library"> }) {
  const copy = PLACEHOLDERS[view];
  return (
    <main id="library-main" className="placeholder" data-testid="placeholder-view">
      <section className="placeholder-card">
        <p className="kicker">{copy.kicker}</p>
        <h2>{copy.title}</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p>{copy.body}</p>
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

export default function App() {
  const [view, setView] = useState<View>("library");
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

  return (
    <div className="room">
      <Masthead />
      <AppInfoFooter />

      {view === "library" ? <LibraryWall /> : <Placeholder view={view} />}

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
