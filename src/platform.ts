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
export type CoverSource = "embedded" | "rendered" | "generated";
export type ScanIssueReason = "unreadable" | "invalid_epub" | "invalid_pdf";

/** Mirrors `pocketlibrary_core::Book` (camelCase on the wire). */
export interface Book {
  id: number;
  contentHash: string;
  quickKey: string | null;
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
  coverSource: CoverSource | null;
  addedAt: number;
  shelfId: number | null;
  slotIndex: number | null;
  readingStatus: ReadingStatus;
}

/** Mirrors `pocketlibrary_core::BookDetail`. */
export interface BookDetail extends Book {
  coverDataUrl: string | null;
}

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
}

interface MockWindow extends Window {
  __POCKETLIBRARY_MOCK__?: MockConfig;
}

function mockConfig(): MockConfig {
  if (typeof window === "undefined") return {};
  return (window as MockWindow).__POCKETLIBRARY_MOCK__ ?? {};
}

function shelvesFor(books: Book[]): Shelf[] {
  const ids = new Set(books.map((book) => book.shelfId ?? 1));
  if (ids.size === 0) ids.add(1);
  return [...ids]
    .sort((left, right) => left - right)
    .map((id, ordinal) => ({ id, ordinal, capacity: 12 }));
}

function createMockPlatform(config: MockConfig = {}): Platform {
  let state: LibraryState = config.state ?? "needsFolder";
  let folderName = config.folderName ?? null;
  let books = config.books ? [...config.books] : [];

  const status = (): LibraryStatus => ({ state, folderName });

  return {
    appInfo: async () => MOCK_APP_INFO,
    listBooks: async () => books,
    listShelves: async () => shelvesFor(books),
    getBookDetail: async (id) => {
      const book = books.find((candidate) => candidate.id === id);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      return { ...book, coverDataUrl: MOCK_COVER };
    },
    libraryStatus: async () => status(),
    chooseLibraryFolder: async () => {
      state = "ready";
      folderName = folderName ?? "PocketLibrary";
      books = config.books ? [...config.books] : [];
      return status();
    },
    rescanLibrary: async () => ({
      total: books.length,
      added: 0,
      removed: 0,
      duplicates: 0,
      skipped: [],
    }),
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
