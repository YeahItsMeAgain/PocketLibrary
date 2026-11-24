/**
 * The single seam between the React UI and the Rust command API.
 *
 * Every screen talks to `platform`, never to Tauri directly. On a phone the
 * Tauri implementation forwards to `invoke`; in a browser (Vite dev and
 * Playwright) the mock answers with the same types so the UI is testable
 * without a device.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  appVersion: string;
  schemaVersion: number;
}

export type BookFormat = "epub" | "pdf";
export type ReadingStatus = "unread" | "reading" | "finished";
export type ScanIssueReason = "unreadable" | "invalid_epub" | "invalid_pdf";

/** Mirrors `pocketlibrary_core::Book` (camelCase on the wire). */
export interface Book {
  id: number;
  contentHash: string;
  format: BookFormat;
  title: string;
  authors: string[];
  series: string | null;
  language: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  identifier: string | null;
  pageCount: number | null;
  addedAt: number;
  shelfId: number | null;
  slotIndex: number | null;
  readingStatus: ReadingStatus;
  labels: Label[];
}

/** Mirrors `pocketlibrary_core::BookDetail`. */
export interface BookDetail extends Book {
  coverDataUrl: string | null;
}

/** A reusable coloured label. */
export interface Label {
  id: number;
  name: string;
  colour: string;
  createdAt: number;
}

/** A label with the number of books wearing it. */
export interface LabelUsage extends Label {
  bookCount: number;
}

/** Mirrors `pocketlibrary_core::ReadingState`. */
export interface ReadingState {
  status: ReadingStatus;
  statusSource: "auto" | "manual";
  progress: number;
  locator: string | null;
}

/** Mirrors `pocketlibrary_core::Bookmark` (a `kind='bookmark'` annotation). */
export interface Bookmark {
  id: number;
  bookId: number;
  locator: string;
  createdAt: number;
}

/** The fixed label palette; no free colour picker. */
export const LABEL_PALETTE: ReadonlyArray<{ name: string; colour: string }> = [
  { name: "Oxblood", colour: "#6e2630" },
  { name: "Forest", colour: "#294735" },
  { name: "Mustard", colour: "#6b4d18" },
  { name: "Ink blue", colour: "#26384f" },
  { name: "Sepia", colour: "#57402d" },
  { name: "Plum", colour: "#4a2a45" },
  { name: "Teal", colour: "#214d4c" },
  { name: "Charcoal", colour: "#333336" },
];

/** Mirrors `pocketlibrary_core::ScanIssue`. */
export interface ScanIssue {
  name: string;
  reason: ScanIssueReason;
}

/** Mirrors `pocketlibrary_core::Shelf`. */
export interface Shelf {
  id: number;
  ordinal: number;
  capacity: number;
}

/** Mirrors `pocketlibrary_core::Placement`. */
export interface Placement {
  bookId: number;
  shelfId: number;
  shelfOrdinal: number;
  appendedShelf: boolean;
}

/** Mirrors `pocketlibrary_core::LibraryState`. */
export type LibraryState = "needsFolder" | "ready" | "disconnected";

/** Mirrors `pocketlibrary_core::LibraryStatus`. */
export interface LibraryStatus {
  state: LibraryState;
  folderName: string | null;
}

/** Mirrors `pocketlibrary_core::ScanReport`. */
export interface ScanReport {
  total: number;
  added: number;
  removed: number;
  duplicates: number;
  skipped: ScanIssue[];
  placements: Placement[];
}

/** Mirrors `pocketlibrary_core::ApiError` (camelCase on the wire). */
export interface ApiError {
  code: string;
  message: string;
}

/** Narrow an unknown rejection from `invoke` to the command API error shape. */
export function isApiError(error: unknown): error is ApiError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    typeof candidate.code === "string" && typeof candidate.message === "string"
  );
}

/** True when the chosen library folder is no longer reachable. */
export function isLibraryUnavailable(error: unknown): error is ApiError {
  return isApiError(error) && error.code === "library_unavailable";
}

export interface Platform {
  appInfo(): Promise<AppInfo>;
  listBooks(): Promise<Book[]>;
  listShelves(): Promise<Shelf[]>;
  getBookDetail(id: number): Promise<BookDetail>;
  libraryStatus(): Promise<LibraryStatus>;
  chooseLibraryFolder(): Promise<LibraryStatus>;
  rescanLibrary(): Promise<ScanReport>;
  getShelfCapacity(): Promise<number>;
  setShelfCapacity(capacity: number): Promise<number>;
  moveBook(bookId: number, shelfId: number, slotIndex: number): Promise<void>;
  listLabels(): Promise<LabelUsage[]>;
  createLabel(name: string, colour: string): Promise<Label>;
  renameLabel(labelId: number, name: string): Promise<Label>;
  recolourLabel(labelId: number, colour: string): Promise<Label>;
  deleteLabel(labelId: number): Promise<void>;
  attachLabel(bookId: number, labelId: number): Promise<void>;
  detachLabel(bookId: number, labelId: number): Promise<void>;
  readingState(bookId: number): Promise<ReadingState>;
  setReadingStatus(bookId: number, status: ReadingStatus): Promise<void>;
  readBook(bookId: number): Promise<ArrayBuffer>;
  recordOpen(bookId: number): Promise<void>;
  recordProgress(
    bookId: number,
    progress: number,
    locator: string | null,
  ): Promise<ReadingStatus>;
  listBookmarks(bookId: number): Promise<Bookmark[]>;
  addBookmark(bookId: number, locator: string): Promise<Bookmark>;
  deleteBookmark(bookId: number, bookmarkId: number): Promise<void>;
}

export type Invoke = typeof invoke;

/**
 * Build the Tauri adapter around an invoke function.
 *
 * Injecting the function lets tests drive the real adapter without a device.
 */
export function createTauriPlatform(call: Invoke): Platform {
  return {
    appInfo: () => call<AppInfo>("app_info"),
    listBooks: () => call<Book[]>("list_books"),
    listShelves: () => call<Shelf[]>("list_shelves"),
    getBookDetail: (id) => call<BookDetail>("get_book_detail", { id }),
    libraryStatus: () => call<LibraryStatus>("library_status"),
    chooseLibraryFolder: () =>
      call<LibraryStatus>("choose_library_folder"),
    rescanLibrary: () => call<ScanReport>("rescan_library"),
    getShelfCapacity: () => call<number>("get_shelf_capacity"),
    setShelfCapacity: (capacity) =>
      call<number>("set_shelf_capacity", { capacity }),
    moveBook: (bookId, shelfId, slotIndex) =>
      call<void>("move_book", { bookId, shelfId, slotIndex }),
    listLabels: () => call<LabelUsage[]>("label_usage"),
    createLabel: (name, colour) =>
      call<Label>("create_label", { name, colour }),
    renameLabel: (labelId, name) =>
      call<Label>("rename_label", { labelId, name }),
    recolourLabel: (labelId, colour) =>
      call<Label>("recolour_label", { labelId, colour }),
    deleteLabel: (labelId) => call<void>("delete_label", { labelId }),
    attachLabel: (bookId, labelId) =>
      call<void>("attach_label", { bookId, labelId }),
    detachLabel: (bookId, labelId) =>
      call<void>("detach_label", { bookId, labelId }),
    readingState: (bookId) =>
      call<ReadingState>("reading_state", { bookId }),
    setReadingStatus: (bookId, status) =>
      call<void>("set_reading_status", { bookId, status }),
    readBook: async (bookId) => {
      const bytes = await call<ArrayBuffer>("read_book", { bookId });
      return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes as number[]).buffer;
    },
    recordOpen: (bookId) => call<void>("record_open", { bookId }),
    recordProgress: (bookId, progress, locator) =>
      call<ReadingStatus>("record_progress", { bookId, progress, locator }),
    listBookmarks: (bookId) =>
      call<Bookmark[]>("list_bookmarks", { bookId }),
    addBookmark: (bookId, locator) =>
      call<Bookmark>("add_bookmark", { bookId, locator }),
    deleteBookmark: (bookId, bookmarkId) =>
      call<void>("delete_bookmark", { bookId, bookmarkId }),
  };
}

export const MOCK_APP_INFO: AppInfo = {
  name: "PocketLibrary",
  appVersion: "0.1.0",
  schemaVersion: 2,
};

const MOCK_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">' +
      '<rect width="300" height="450" fill="#1a0d1c"/>' +
      '<rect x="18" y="18" width="264" height="414" fill="none" stroke="#c9a86a" stroke-width="2"/>' +
      '<path d="M150 150 L190 225 L150 300 L110 225 Z" fill="none" stroke="#c9a86a" stroke-width="2"/>' +
      "</svg>",
  );

export interface MockConfig {
  state?: LibraryState;
  folderName?: string | null;
  books?: Book[];
  shelfCapacity?: number;
  shelves?: Shelf[];
  /** Books a rescan should import, one shelf-placement at a time. */
  scanAdds?: Book[];
  /** Labels available before any are created through the UI. */
  labels?: Label[];
  /** Progress fractions for the detail sticker, keyed by book id. */
  readingProgress?: Record<number, number>;
  /** Optional EPUB fixture URL per book id (defaults to sample.epub). */
  bookFiles?: Record<number, string>;
}

const MOCK_READING_KEY = "pocketlibrary.mock.reading";
const MOCK_BOOKMARKS_KEY = "pocketlibrary.mock.bookmarks";
const MOCK_SAMPLE_EPUB = "/test-assets/sample.epub";
const MOCK_SAMPLE_PDF = "/test-assets/sample.pdf";

interface StoredReading {
  status: ReadingStatus;
  statusSource: "auto" | "manual";
  progress: number;
  locator: string | null;
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private WebView may refuse storage; the session still works.
  }
}

interface MockWindow extends Window {
  __POCKETLIBRARY_MOCK__?: MockConfig;
}

function mockConfig(): MockConfig {
  if (typeof window === "undefined") return {};
  return (window as MockWindow).__POCKETLIBRARY_MOCK__ ?? {};
}

function initialShelves(config: MockConfig, books: Book[]): Shelf[] {
  if (config.shelves && config.shelves.length > 0) {
    return config.shelves.map((shelf) => ({ ...shelf }));
  }
  const capacity = config.shelfCapacity ?? 12;
  const ids = new Set(books.map((book) => book.shelfId ?? 1));
  ids.add(1);
  return [...ids]
    .sort((left, right) => left - right)
    .map((id, ordinal) => ({ id, ordinal, capacity }));
}

function orderBooks(books: Book[], shelves: Shelf[]): Book[] {
  const rank = new Map(shelves.map((shelf, index) => [shelf.id, index]));
  return [...books].sort((left, right) => {
    const leftRank =
      left.shelfId === null ? Number.MAX_SAFE_INTEGER : rank.get(left.shelfId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      right.shelfId === null ? Number.MAX_SAFE_INTEGER : rank.get(right.shelfId) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    const slot = (left.slotIndex ?? 0) - (right.slotIndex ?? 0);
    if (slot !== 0) return slot;
    return left.id - right.id;
  });
}

function applyMove(
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
  const slotOf = (book: Book) => book.slotIndex ?? 0;
  const sourceBooks = books
    .filter((book) => book.shelfId === sourceShelfId)
    .sort((left, right) => slotOf(left) - slotOf(right));
  const targetBooks = (
    sameShelf
      ? sourceBooks.filter((book) => book.id !== bookId)
      : books
          .filter((book) => book.shelfId === targetShelfId)
          .sort((left, right) => slotOf(left) - slotOf(right))
  ).slice();
  const index = Math.max(0, Math.min(targetBooks.length, targetIndex));
  targetBooks.splice(index, 0, moving);

  const slots = new Map<number, { shelfId: number; slotIndex: number }>();
  targetBooks.forEach((book, slot) =>
    slots.set(book.id, { shelfId: targetShelfId, slotIndex: slot }),
  );
  if (!sameShelf) {
    sourceBooks
      .filter((book) => book.id !== bookId)
      .forEach((book, slot) =>
        slots.set(book.id, { shelfId: sourceShelfId, slotIndex: slot }),
      );
  }

  const updated = books.map((book) => {
    const placement = slots.get(book.id);
    return placement ? { ...book, ...placement } : book;
  });
  return orderBooks(updated, shelves);
}

function seedBooks(source: Book[] | undefined): Book[] {
  return source
    ? source.map((book) => ({ ...book, labels: [...(book.labels ?? [])] }))
    : [];
}

function seedLabels(config: MockConfig, books: Book[]): Label[] {
  const labels = (config.labels ?? []).map((label) => ({ ...label }));
  for (const book of books) {
    for (const label of book.labels) {
      if (!labels.some((candidate) => candidate.id === label.id)) {
        labels.push({ ...label });
      }
    }
  }
  return labels.sort(
    (left, right) => left.createdAt - right.createdAt || left.id - right.id,
  );
}

function createMockPlatform(config: MockConfig = {}): Platform {
  let state: LibraryState = config.state ?? "needsFolder";
  let folderName = config.folderName ?? null;
  let books = seedBooks(config.books);
  let labels = seedLabels(config, books);
  let shelves = initialShelves(config, books);
  let capacity = config.shelfCapacity ?? 12;
  let scanAdds = config.scanAdds ? [...config.scanAdds] : [];
  let nextBookId = Math.max(0, ...books.map((book) => book.id)) + 1;
  let nextShelfId = Math.max(0, ...shelves.map((shelf) => shelf.id)) + 1;
  let nextLabelId = Math.max(0, ...labels.map((label) => label.id)) + 1;
  const progress = new Map<number, number>(
    Object.entries(config.readingProgress ?? {}).map(([id, value]) => [
      Number(id),
      value,
    ]),
  );
  const storedReading = readStored<Record<number, StoredReading>>(
    MOCK_READING_KEY,
    {},
  );
  const bookmarkStore = readStored<Record<number, Bookmark[]>>(
    MOCK_BOOKMARKS_KEY,
    {},
  );
  let nextBookmarkId =
    Math.max(
      0,
      ...Object.values(bookmarkStore).flatMap((list) => list.map((b) => b.id)),
    ) + 1;
  for (const book of books) {
    const stored = storedReading[book.id];
    if (stored) {
      book.readingStatus = stored.status;
      progress.set(book.id, stored.progress);
    }
  }

  function saveReading(bookId: number, next: StoredReading) {
    storedReading[bookId] = next;
    writeStored(MOCK_READING_KEY, storedReading);
    const book = books.find((candidate) => candidate.id === bookId);
    if (book) {
      book.readingStatus = next.status;
      books = [...books];
    }
    progress.set(bookId, next.progress);
  }

  const status = (): LibraryStatus => ({ state, folderName });

  function labelUsage(): LabelUsage[] {
    return labels.map((label) => ({
      ...label,
      bookCount: books.filter((book) =>
        book.labels.some((worn) => worn.id === label.id),
      ).length,
    }));
  }

  function findLabel(labelId: number): Label {
    const label = labels.find((candidate) => candidate.id === labelId);
    if (!label) {
      throw { code: "label_not_found", message: "That label could not be found." };
    }
    return label;
  }

  function updateLabelEverywhere(label: Label) {
    labels = labels.map((candidate) =>
      candidate.id === label.id ? { ...label } : candidate,
    );
    books = books.map((book) => ({
      ...book,
      labels: book.labels.map((worn) =>
        worn.id === label.id ? { ...label } : worn,
      ),
    }));
  }

  function progressFor(book: Book): number {
    if (progress.has(book.id)) return progress.get(book.id) ?? 0;
    return book.readingStatus === "finished"
      ? 1
      : book.readingStatus === "reading"
        ? 0.42
        : 0;
  }

  function booksOnShelf(shelfId: number): Book[] {
    return books.filter((book) => book.shelfId === shelfId);
  }

  function rescan(): ScanReport {
    const report: ScanReport = {
      total: books.length,
      added: 0,
      removed: 0,
      duplicates: 0,
      skipped: [],
      placements: [],
    };

    for (const add of scanAdds) {
      let shelf = shelves.find(
        (candidate) =>
          booksOnShelf(candidate.id).length < candidate.capacity,
      );
      let appendedShelf = false;
      if (!shelf) {
        const ordinal = shelves.length;
        shelf = { id: nextShelfId++, ordinal, capacity };
        shelves = [...shelves, shelf];
        appendedShelf = true;
      }
      const used = new Set(
        booksOnShelf(shelf.id).map((book) => book.slotIndex ?? 0),
      );
      let slotIndex = 0;
      while (used.has(slotIndex)) slotIndex += 1;
      const book: Book = {
        ...add,
        id: nextBookId++,
        shelfId: shelf.id,
        slotIndex,
      };
      books = [...books, book];
      report.added += 1;
      report.total += 1;
      report.placements.push({
        bookId: book.id,
        shelfId: shelf.id,
        shelfOrdinal: shelf.ordinal,
        appendedShelf,
      });
    }
    scanAdds = [];
    return report;
  }

  return {
    appInfo: async () => MOCK_APP_INFO,
    listBooks: async () => books,
    listShelves: async () => shelves,
    getBookDetail: async (id) => {
      const book = books.find((candidate) => candidate.id === id);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      return { ...book, coverDataUrl: MOCK_COVER };
    },
    libraryStatus: async () => status(),
    chooseLibraryFolder: async () => {
      state = "ready";
      folderName = folderName ?? "PocketLibrary";
      books = seedBooks(config.books);
      for (const book of books) {
        const stored = storedReading[book.id];
        if (stored) book.readingStatus = stored.status;
      }
      labels = seedLabels(config, books);
      shelves = initialShelves(config, books);
      scanAdds = config.scanAdds ? [...config.scanAdds] : [];
      nextLabelId = Math.max(0, ...labels.map((label) => label.id)) + 1;
      return status();
    },
    rescanLibrary: async () => rescan(),
    getShelfCapacity: async () => capacity,
    setShelfCapacity: async (next) => {
      if (!Number.isInteger(next) || next < 1) {
        throw { code: "invalid_capacity", message: "Shelf capacity must be at least one book." };
      }
      capacity = next;
      shelves = shelves.map((shelf) => ({ ...shelf, capacity: next }));
      return capacity;
    },
    moveBook: async (bookId, shelfId, slotIndex) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const shelf = shelves.find((candidate) => candidate.id === shelfId);
      if (!shelf) {
        throw { code: "invalid_target", message: "That book cannot be placed there." };
      }
      const sameShelf = book.shelfId === shelfId;
      const targetCount = books.filter(
        (candidate) => candidate.shelfId === shelfId && candidate.id !== bookId,
      ).length;
      if (
        !Number.isInteger(slotIndex) ||
        slotIndex < 0 ||
        slotIndex > targetCount
      ) {
        throw { code: "invalid_target", message: "That book cannot be placed there." };
      }
      if (!sameShelf && targetCount >= shelf.capacity) {
        throw { code: "shelf_full", message: "That shelf is already full." };
      }
      books = applyMove(books, shelves, bookId, shelfId, slotIndex);
    },
    listLabels: async () => labelUsage(),
    createLabel: async (name, colour) => {
      const trimmed = name.trim();
      if (!trimmed) {
        throw { code: "invalid_label_name", message: "A label needs a name." };
      }
      if (!LABEL_PALETTE.some((entry) => entry.colour === colour)) {
        throw {
          code: "invalid_label_colour",
          message: "Choose one of the printed label colours.",
        };
      }
      if (
        labels.some(
          (label) => label.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw {
          code: "label_exists",
          message: "A label with that name already exists.",
        };
      }
      const label: Label = {
        id: nextLabelId++,
        name: trimmed,
        colour,
        createdAt: Math.floor(Date.now() / 1000),
      };
      labels = [...labels, label];
      return { ...label };
    },
    renameLabel: async (labelId, name) => {
      const trimmed = name.trim();
      if (!trimmed) {
        throw { code: "invalid_label_name", message: "A label needs a name." };
      }
      if (
        labels.some(
          (label) =>
            label.id !== labelId &&
            label.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw {
          code: "label_exists",
          message: "A label with that name already exists.",
        };
      }
      const label = { ...findLabel(labelId), name: trimmed };
      updateLabelEverywhere(label);
      return { ...label };
    },
    recolourLabel: async (labelId, colour) => {
      if (!LABEL_PALETTE.some((entry) => entry.colour === colour)) {
        throw {
          code: "invalid_label_colour",
          message: "Choose one of the printed label colours.",
        };
      }
      const label = { ...findLabel(labelId), colour };
      updateLabelEverywhere(label);
      return { ...label };
    },
    deleteLabel: async (labelId) => {
      findLabel(labelId);
      labels = labels.filter((label) => label.id !== labelId);
      books = books.map((book) => ({
        ...book,
        labels: book.labels.filter((label) => label.id !== labelId),
      }));
    },
    attachLabel: async (bookId, labelId) => {
      const label = findLabel(labelId);
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      if (!book.labels.some((worn) => worn.id === labelId)) {
        book.labels = [...book.labels, { ...label }];
        books = [...books];
      }
    },
    detachLabel: async (bookId, labelId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      book.labels = book.labels.filter((worn) => worn.id !== labelId);
      books = [...books];
    },
    readingState: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const stored = storedReading[bookId];
      return {
        status: stored?.status ?? book.readingStatus,
        statusSource: stored?.statusSource ?? "auto",
        progress: stored?.progress ?? progressFor(book),
        locator: stored?.locator ?? null,
      };
    },
    setReadingStatus: async (bookId, nextStatus) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const previous = storedReading[bookId];
      saveReading(bookId, {
        status: nextStatus,
        statusSource: "manual",
        progress:
          nextStatus === "finished" ? 1 : (previous?.progress ?? progressFor(book)),
        locator: previous?.locator ?? null,
      });
    },
    readBook: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const url =
        config.bookFiles?.[bookId] ??
        (book.format === "pdf" ? MOCK_SAMPLE_PDF : MOCK_SAMPLE_EPUB);
      const response = await fetch(url);
      if (!response.ok) {
        throw { code: "read_book", message: "That book could not be read." };
      }
      return response.arrayBuffer();
    },
    recordOpen: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const current = storedReading[bookId];
      if (current?.statusSource === "manual" || current?.status === "finished") {
        return;
      }
      saveReading(bookId, {
        status: "reading",
        statusSource: "auto",
        progress: current?.progress ?? 0,
        locator: current?.locator ?? null,
      });
    },
    recordProgress: async (bookId, nextProgress, locator) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      const clamped = Math.max(0, Math.min(1, nextProgress));
      const current = storedReading[bookId];
      const nextStatus: ReadingStatus =
        current?.statusSource === "manual"
          ? current.status
          : clamped >= 0.98 || current?.status === "finished"
            ? "finished"
            : "reading";
      saveReading(bookId, {
        status: nextStatus,
        statusSource: "auto",
        progress: clamped,
        locator: locator ?? current?.locator ?? null,
      });
      return nextStatus;
    },
    listBookmarks: async (bookId) => [...(bookmarkStore[bookId] ?? [])],
    addBookmark: async (bookId, locator) => {
      const bookmark: Bookmark = {
        id: nextBookmarkId++,
        bookId,
        locator,
        createdAt: Math.floor(Date.now() / 1000),
      };
      bookmarkStore[bookId] = [...(bookmarkStore[bookId] ?? []), bookmark];
      writeStored(MOCK_BOOKMARKS_KEY, bookmarkStore);
      return { ...bookmark };
    },
    deleteBookmark: async (bookId, bookmarkId) => {
      bookmarkStore[bookId] = (bookmarkStore[bookId] ?? []).filter(
        (bookmark) => bookmark.id !== bookmarkId,
      );
      writeStored(MOCK_BOOKMARKS_KEY, bookmarkStore);
    },
  };
}

function runningInTauri(): boolean {
  if (typeof window === "undefined") return false;
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

export function createPlatform(call: Invoke = invoke): Platform {
  return runningInTauri() ? createTauriPlatform(call) : createMockPlatform(mockConfig());
}

/** The platform the app is running against. */
export const platform: Platform = createPlatform();
