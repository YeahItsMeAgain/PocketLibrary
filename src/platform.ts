/**
 * The single seam between the React UI and the Rust command API.
 *
 * Every screen talks to `platform`, never to Tauri directly. On a phone the
 * Tauri implementation forwards to `invoke`; in a browser (Vite dev and
 * Playwright) the mock answers with the same types so the UI is testable
 * without a device.
 */
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  appVersion: string;
  schemaVersion: number;
}

export type DiagnosticLevel = "error" | "warn" | "info";

/** Mirrors `pocketlibrary_core::diagnostics::DiagnosticsSummary`. */
export interface DiagnosticsSummary {
  logBytes: number;
  logLines: number;
  errors: number;
  warnings: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** Where the diagnostics zip went, without exposing a filesystem path. */
export interface DiagnosticsExport {
  fileName: string;
  bytes: number;
  method: "share" | "save";
  cancelled: boolean;
}

/** Mirrors `src-tauri/src/updates::UpdateCheck` (camelCase on the wire). */
export interface UpdateCheck {
  currentVersion: string;
  available: boolean;
  latestVersion?: string | null;
  notes?: string | null;
  pubDate?: string | null;
  size?: number | null;
  sha256?: string | null;
}

/** A downloaded and verified update waiting for the user to install it. */
export interface DownloadedUpdate {
  version: string;
  bytes: number;
  sha256: string;
}

/** What the Android package installer reported. */
export interface UpdateInstallResult {
  started: boolean;
}

/** Mirrors `src-tauri/src/updates::DownloadEvent`. */
export type UpdateDownloadEvent =
  | {
      event: "started";
      data: { contentLength: number | null; total: number };
    }
  | {
      event: "progress";
      data: {
        chunkLength: number;
        downloaded: number;
        contentLength: number | null;
      };
    }
  | { event: "finished"; data: { bytes: number } };

interface SavedDiagnostics {
  fileName: string;
  bytes: number;
}

/** Mirrors the shell's native-share result; `null` means unsupported. */
interface SharedDiagnostics {
  fileName: string;
  bytes: number;
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

export type AnnotationKind = "highlight" | "note";

/** Mirrors `pocketlibrary_core::Annotation`. */
export interface Annotation {
  id: number;
  bookId: number;
  kind: AnnotationKind;
  colour: string | null;
  note: string | null;
  locator: string;
  createdAt: number;
  updatedAt: number;
}

/** Fields an edit or anchor repair may change; absent fields are kept. */
export interface AnnotationPatch {
  colour?: string;
  note?: string;
  locator?: string;
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

/** Mirrors `pocketlibrary_core::BackupPreview`. */
export interface BackupPreview {
  matched: number;
  new: number;
}

export type BackupMode = "merge" | "replace";

/** Mirrors `pocketlibrary_core::BackupReport`. */
export interface BackupReport {
  mode: BackupMode;
  matched: number;
  new: number;
  skipped: number;
  replaced: number;
}

/** What the shell wrote through the system save picker. */
export interface BackupExport {
  fileName: string;
  bytes: number;
  books: number;
}

/** An archive picked and inspected by the shell, kept behind an opaque token. */
export interface BackupSelection {
  token: string;
  fileName: string;
  preview: BackupPreview;
}

/** Mirrors `pocketlibrary_core::ScanReport`. */
export interface ScanReport {
  total: number;
  added: number;
  /** Known books whose local path was filled in or changed by this scan. */
  relinked: number;
  removed: number;
  duplicates: number;
  skipped: ScanIssue[];
  placements: Placement[];
}

/** The naming pattern used until the user saves another one. */
export const DEFAULT_DOWNLOAD_NAMING = "{author} - {title} ({year})";

/** What an import changed, plus the rescan that re-linked imported books. */
export interface BackupImport {
  report: BackupReport;
  scan: ScanReport | null;
  scanError: string | null;
}

/** Mirrors `pocketlibrary_core::ApiError` (camelCase on the wire). */
export interface ApiError {
  code: string;
  message: string;
}

/* ------------------------------------------------------------ acquisition */

/** Mirrors `pocketlibrary_core::SearchQuery`. */
export interface SearchQuery {
  query: string;
  title: string;
  author: string;
  yearFrom: number | null;
  yearTo: number | null;
  language: string;
  format: string;
  publisher: string;
  isbn: string;
  md5: string;
  page: number;
}

/** Mirrors `pocketlibrary_core::MirrorLink`. */
export interface MirrorLink {
  label: string;
  url: string;
}

/** Mirrors `pocketlibrary_core::LibgenResult`. */
export interface LibgenResult {
  md5: string;
  title: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  language: string | null;
  pages: number | null;
  sizeText: string;
  sizeBytes: number | null;
  extension: string;
  fileId: number | null;
  source: string;
  mirrors: MirrorLink[];
}

/** Mirrors `pocketlibrary_core::MirrorHealth`. */
export interface MirrorHealth {
  host: string;
  failures: number;
  coolingDown: boolean;
  lastSuccess: boolean;
}

/** Mirrors `pocketlibrary_core::DownloadState`. */
export type DownloadState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Mirrors `pocketlibrary_core::Download`. */
export interface Download {
  id: number;
  md5: string;
  title: string;
  authors: string[];
  year: number | null;
  format: BookFormat;
  source: string;
  mirrorUrls: string[];
  state: DownloadState;
  /** Host currently serving, or last tried by, this download. */
  mirror: string | null;
  bytes: number;
  totalBytes: number | null;
  error: string | null;
  errorCode: string | null;
  bookId: number | null;
  filename: string | null;
  createdAt: number;
  finishedAt: number | null;
}

/** Mirrors `pocketlibrary_core::DownloadRequest`. */
export interface DownloadRequest {
  md5: string;
  title: string;
  authors: string[];
  year: number | null;
  format: BookFormat;
  source: string;
  mirrorUrls: string[];
}

/** Mirrors `pocketlibrary_core::SearchPage`. */
export interface SearchPage {
  results: LibgenResult[];
  page: number;
  perPage: number;
  total: number;
  totalIsExact: boolean;
  onPageBeforeFilters: number;
  rowsReturned: number;
  unsupportedRows: number;
  filtersApplied: boolean;
  sourceMirror: string;
  health: MirrorHealth[];
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
  searchLibgen(query: SearchQuery): Promise<SearchPage>;
  enqueueDownload(request: DownloadRequest): Promise<Download>;
  listDownloads(): Promise<Download[]>;
  cancelDownload(id: number): Promise<void>;
  retryDownload(id: number): Promise<Download>;
  listBooks(): Promise<Book[]>;
  listShelves(): Promise<Shelf[]>;
  getBookDetail(id: number): Promise<BookDetail>;
  libraryStatus(): Promise<LibraryStatus>;
  chooseLibraryFolder(): Promise<LibraryStatus>;
  rescanLibrary(): Promise<ScanReport>;
  getShelfCapacity(): Promise<number>;
  setShelfCapacity(capacity: number): Promise<number>;
  getDownloadNaming(): Promise<string>;
  setDownloadNaming(pattern: string): Promise<string>;
  moveBook(bookId: number, shelfId: number, slotIndex: number): Promise<void>;
  deleteBook(bookId: number, deleteFile?: boolean): Promise<void>;
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
  listAnnotations(bookId: number): Promise<Annotation[]>;
  createAnnotation(
    bookId: number,
    kind: AnnotationKind,
    colour: string | null,
    note: string | null,
    locator: string,
  ): Promise<Annotation>;
  updateAnnotation(
    bookId: number,
    annotationId: number,
    patch: AnnotationPatch,
  ): Promise<Annotation>;
  deleteAnnotation(bookId: number, annotationId: number): Promise<void>;
  exportBackup(): Promise<BackupExport | null>;
  previewBackup(): Promise<BackupSelection | null>;
  importBackup(token: string, mode: BackupMode): Promise<BackupImport>;
  openBookExternally(bookId: number): Promise<void>;
  /** Add a JS-side event to the local diagnostics log. */
  logDiagnostic(
    level: DiagnosticLevel,
    event: string,
    message: string,
  ): Promise<void>;
  diagnosticsSummary(): Promise<DiagnosticsSummary>;
  clearDiagnostics(): Promise<void>;
  /** Export the zip through the share sheet, falling back to the save picker. */
  sendDiagnostics(): Promise<DiagnosticsExport>;
  /** Fetch update metadata only; nothing downloads until asked. */
  checkForUpdate(): Promise<UpdateCheck>;
  /** Download and verify the release from the most recent check. */
  downloadUpdate(
    onEvent: (event: UpdateDownloadEvent) => void,
  ): Promise<DownloadedUpdate>;
  /** Open the Android package installer for the verified download. */
  installUpdate(): Promise<UpdateInstallResult>;
}

export type Invoke = typeof invoke;

function errorText(error: unknown): string {
  if (isApiError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Wrap every platform method so a rejected command is written to the local log.
 * Successful calls stay quiet. `logDiagnostic` is excluded to avoid a loop.
 */
function traced(
  base: Platform,
  onFailure: (method: string, error: unknown) => void,
): Platform {
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== "function" || name === "logDiagnostic") {
      wrapped[name] = value;
      continue;
    }
    wrapped[name] = (...args: unknown[]) => {
      let result: unknown;
      try {
        result = (value as (...inner: unknown[]) => unknown).apply(base, args);
      } catch (error) {
        onFailure(name, error);
        throw error;
      }
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          onFailure(name, error);
          throw error;
        });
      }
      return result;
    };
  }
  return wrapped as unknown as Platform;
}

function asArrayBuffer(value: ArrayBuffer | number[]): ArrayBuffer {
  return value instanceof ArrayBuffer
    ? value
    : new Uint8Array(value).buffer;
}

/**
 * Let the native shell open its share chooser first. When it reports that
 * sharing is unsupported (desktop) or fails, fall back to the shell's system
 * save picker. The caller never sees a raw path either way.
 */
async function shareOrSaveDiagnostics(
  fileName: string,
  fallbackBytes: number,
  share: () => Promise<SharedDiagnostics | null>,
  save: () => Promise<SavedDiagnostics | null>,
): Promise<DiagnosticsExport> {
  let shared: SharedDiagnostics | null = null;
  try {
    shared = await share();
  } catch {
    // A refused native share falls through to the save picker.
  }
  if (shared) {
    return {
      fileName: shared.fileName,
      bytes: shared.bytes,
      method: "share",
      cancelled: false,
    };
  }
  const saved = await save();
  if (!saved) {
    return { fileName, bytes: fallbackBytes, method: "save", cancelled: true };
  }
  return {
    fileName: saved.fileName,
    bytes: saved.bytes,
    method: "save",
    cancelled: false,
  };
}

/**
 * Build the Tauri adapter around an invoke function.
 *
 * Injecting the function lets tests drive the real adapter without a device.
 */
export function createTauriPlatform(call: Invoke): Platform {
  const base: Platform = {
    appInfo: () => call<AppInfo>("app_info"),
    searchLibgen: (query) => call<SearchPage>("search_libgen", { query }),
    enqueueDownload: (request) =>
      call<Download>("enqueue_download", { request }),
    listDownloads: () => call<Download[]>("list_downloads"),
    cancelDownload: (id) => call<void>("cancel_download", { id }),
    retryDownload: (id) => call<Download>("retry_download", { id }),
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
    getDownloadNaming: () => call<string>("get_download_naming"),
    setDownloadNaming: (pattern) =>
      call<string>("set_download_naming", { pattern }),
    moveBook: (bookId, shelfId, slotIndex) =>
      call<void>("move_book", { bookId, shelfId, slotIndex }),
    deleteBook: (bookId, deleteFile = true) =>
      call<void>("delete_book", { bookId, deleteFile }),
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
      return asArrayBuffer(bytes as ArrayBuffer | number[]);
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
    listAnnotations: (bookId) =>
      call<Annotation[]>("list_annotations", { bookId }),
    createAnnotation: (bookId, kind, colour, note, locator) =>
      call<Annotation>("create_annotation", {
        bookId,
        kind,
        colour,
        note,
        locator,
      }),
    updateAnnotation: (bookId, annotationId, patch) =>
      call<Annotation>("update_annotation", {
        bookId,
        annotationId,
        ...patch,
      }),
    deleteAnnotation: (bookId, annotationId) =>
      call<void>("delete_annotation", { bookId, annotationId }),
    exportBackup: () =>
      call<BackupExport | null>("export_backup"),
    previewBackup: () =>
      call<BackupSelection | null>("preview_backup"),
    importBackup: (token, mode) =>
      call<BackupImport>("import_backup", { token, mode }),
    openBookExternally: (bookId) =>
      call<void>("open_book_externally", { bookId }),
    logDiagnostic: (level, event, message) =>
      call<void>("log_diagnostic", { level, event, message }),
    diagnosticsSummary: () =>
      call<DiagnosticsSummary>("diagnostics_summary"),
    clearDiagnostics: () => call<void>("clear_diagnostics"),
    sendDiagnostics: () =>
      shareOrSaveDiagnostics(
        "pocketlibrary-diagnostics.zip",
        0,
        () => call<SharedDiagnostics | null>("share_diagnostics"),
        () => call<SavedDiagnostics | null>("save_diagnostics"),
      ),
    checkForUpdate: () => call<UpdateCheck>("updates_check"),
    downloadUpdate: async (onEvent) => {
      const channel = new Channel<UpdateDownloadEvent>();
      channel.onmessage = onEvent;
      return call<DownloadedUpdate>("updates_download", {
        onEvent: channel,
      });
    },
    installUpdate: () =>
      call<UpdateInstallResult>("updates_install"),
  };
  return traced(base, (method, error) => {
    void call("log_diagnostic", {
      level: "error",
      event: "command_failed",
      message: `${method}: ${errorText(error)}`,
    }).catch(() => {});
  });
}

export const MOCK_APP_INFO: AppInfo = {
  name: "PocketLibrary",
  appVersion: "0.1.5",
  schemaVersion: 3,
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
  /** Initial download naming pattern; defaults to `DEFAULT_DOWNLOAD_NAMING`. */
  downloadNaming?: string;
  shelves?: Shelf[];
  /** Books a rescan should import, one shelf-placement at a time. */
  scanAdds?: Book[];
  /** Files the post-import rescan finds, so the import summary can be tested. */
  backupScanAdds?: Book[];
  /** Labels available before any are created through the UI. */
  labels?: Label[];
  /** Progress fractions for the detail sticker, keyed by book id. */
  readingProgress?: Record<number, number>;
  /** Optional EPUB fixture URL per book id (defaults to sample.epub). */
  bookFiles?: Record<number, string>;
  /** Front-desk results; defaults to a small Rock Paper Scissors set. */
  searchResults?: LibgenResult[];
  /** Total the mock mirror reports before client-side filters. */
  searchTotal?: number;
  /** Raw file rows the mock mirror returns on this page. */
  searchRowsReturned?: number;
  /** Rows the mock mirror drops because they are not EPUB or PDF. */
  searchUnsupportedRows?: number;
  /** Supported rows on this page before client filters. */
  searchOnPageBeforeFilters?: number;
  /** Whether the mock mirror reported an exact total. */
  searchTotalIsExact?: boolean;
  /** Force a front-desk state for UI tests. */
  searchMode?: "ok" | "offline" | "allFailed" | "formatChanged" | "empty";
  /** Milliseconds between mock download progress ticks. */
  downloadStepMs?: number;
  /** Make the next mock download fail so the retry affordance is visible. */
  downloadFail?: boolean;
  /** Show the transient failover note while a mock download runs. */
  downloadFailover?: boolean;
  /** Force a typed failure reason. */
  downloadFailCode?: "mirror_failed" | "offline" | "truncated_file";
  /** Result the mock save picker reports; `null` simulates cancelling. */
  backupExport?: BackupExport | null;
  /** What the next picked archive contains. */
  backupPreview?: BackupPreview;
  /** Reports returned by merge and replace. */
  backupMergeReport?: BackupReport;
  backupReplaceReport?: BackupReport;
  /** Make preview (and import) fail with a typed archive error. */
  backupError?: { code: string; message: string };
  /** Diagnostics save-picker result; `null` simulates cancelling. */
  diagnosticsSave?: SavedDiagnostics | null;
  /** Native share result; `null` (or absent) simulates no native share. */
  diagnosticsShare?: SharedDiagnostics | null;
  /** Byte size of the synthetic diagnostics zip. */
  diagnosticsBytes?: number;
  /** Test-only delay before a shelf move resolves. */
  moveDelayMs?: number;
  /** Test-only delay before the wall's shelves and books arrive. */
  libraryDelayMs?: number;
  /** Update flow scenario; defaults to `upToDate`. */
  updates?: MockUpdateConfig;
}

/**
 * Drives the mock updater without a network or device.
 *
 * `checkError` fails the metadata check; `downloadError` fails the first
 * download attempt (then succeeds); `installPermission` rejects the first
 * install with the Android permission code, then allows a retry.
 */
export interface MockUpdateConfig {
  scenario?:
    | "upToDate"
    | "available"
    | "checkError"
    | "downloadError"
    | "installPermission";
  currentVersion?: string;
  latestVersion?: string;
  notes?: string;
  pubDate?: string;
  size?: number;
  sha256?: string;
  /** Milliseconds between simulated progress ticks. */
  stepMs?: number;
  /** How many download attempts fail before succeeding (default 1). */
  downloadFailures?: number;
  checkError?: ApiError;
  downloadError?: ApiError;
}

const MOCK_READING_KEY = "pocketlibrary.mock.reading";
const MOCK_BOOKMARKS_KEY = "pocketlibrary.mock.bookmarks";
const MOCK_ANNOTATIONS_KEY = "pocketlibrary.mock.annotations";
const MOCK_DOWNLOAD_NAMING_KEY = "pocketlibrary.mock.downloadNaming";
const MOCK_DIAGNOSTICS_KEY = "pocketlibrary.mock.diagnostics";
const MOCK_SAMPLE_EPUB = "/test-assets/sample.epub";
const MOCK_SAMPLE_PDF = "/test-assets/sample.pdf";

interface MockLogEntry {
  at: number;
  level: DiagnosticLevel;
  event: string;
  message: string;
}

function summarizeMockLog(entries: MockLogEntry[]): DiagnosticsSummary {
  const errors = entries.filter((entry) => entry.level === "error");
  const warnings = entries.filter((entry) => entry.level === "warn");
  const last = errors.length > 0 ? errors[errors.length - 1] : null;
  return {
    logBytes: new Blob([JSON.stringify(entries)]).size,
    logLines: entries.length,
    errors: errors.length,
    warnings: warnings.length,
    lastError: last ? `${last.event}: ${last.message}` : null,
    lastErrorAt: last ? new Date(last.at).toISOString() : null,
  };
}

const MOCK_SEARCH_RESULTS: LibgenResult[] = [
  {
    md5: "a1423442916f2f3def9517a3bf4dee48",
    title: "Rock Paper Scissors",
    authors: ["Alice Feeney"],
    publisher: "HarperCollins Publishers",
    year: 2021,
    language: "English",
    pages: 106,
    sizeText: "3 MB",
    sizeBytes: 3_000_000,
    extension: "epub",
    fileId: 98756682,
    source: "libgen.li",
    mirrors: [
      {
        label: "libgen.li",
        url: "https://libgen.li/ads.php?md5=a1423442916f2f3def9517a3bf4dee48",
      },
      {
        label: "libgen.bz",
        url: "https://libgen.bz/ads.php?md5=a1423442916f2f3def9517a3bf4dee48",
      },
      {
        label: "libgen.vg",
        url: "https://libgen.vg/ads.php?md5=a1423442916f2f3def9517a3bf4dee48",
      },
    ],
  },
  {
    md5: "8af476ee50480eaa5eb7db40f9edb742",
    title: "Rock Paper Scissors",
    authors: ["Alice Feeney"],
    publisher: "HarperCollins Publishers",
    year: 2021,
    language: "English",
    pages: 105,
    sizeText: "4 MB",
    sizeBytes: 4_000_000,
    extension: "epub",
    fileId: 98777542,
    source: "libgen.li",
    mirrors: [
      {
        label: "libgen.li",
        url: "https://libgen.li/ads.php?md5=8af476ee50480eaa5eb7db40f9edb742",
      },
    ],
  },
  {
    md5: "0541b9335749ea12eca941ff535aff53",
    title: "Rock Paper Scissors",
    authors: ["Alice Feeney"],
    publisher: "Flatiron Books",
    year: 2021,
    language: "English",
    pages: 267,
    sizeText: "3 MB",
    sizeBytes: 2_941_616,
    extension: "pdf",
    fileId: 101939413,
    source: "libgen.bz",
    mirrors: [
      {
        label: "libgen.bz",
        url: "https://libgen.bz/ads.php?md5=0541b9335749ea12eca941ff535aff53",
      },
    ],
  },
  {
    md5: "b22d21ad5e55cbcb4619dcba2865bfeb",
    title: "Feeney, Alice - Rock Paper Scissors",
    authors: ["Alice Feeney"],
    publisher: "HarperCollins Publishers",
    year: 2021,
    language: "English",
    pages: 87,
    sizeText: "783 kB",
    sizeBytes: 783_000,
    extension: "epub",
    fileId: 98946090,
    source: "libgen.li",
    mirrors: [
      {
        label: "libgen.li",
        url: "https://libgen.li/ads.php?md5=b22d21ad5e55cbcb4619dcba2865bfeb",
      },
    ],
  },
];

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

function orderBooks(books: Book[], shelves: Shelf[]): Book[] {  const rank = new Map(shelves.map((shelf, index) => [shelf.id, index]));
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

function applyDelete(books: Book[], shelves: Shelf[], bookId: number): Book[] {
  const removed = books.find((book) => book.id === bookId);
  if (!removed) return books;
  const remaining = books
    .filter((book) => book.shelfId === removed.shelfId && book.id !== bookId)
    .sort((left, right) => (left.slotIndex ?? 0) - (right.slotIndex ?? 0));
  const slots = new Map<number, number>();
  remaining.forEach((book, slot) => slots.set(book.id, slot));
  return orderBooks(
    books
      .filter((book) => book.id !== bookId)
      .map((book) =>
        slots.has(book.id)
          ? { ...book, slotIndex: slots.get(book.id) ?? book.slotIndex }
          : book,
      ),
    shelves,
  );
}

function seedBooks(source: Book[] | undefined): Book[] {
  return source
    ? source.map((book) => ({ ...book, labels: [...(book.labels ?? [])] }))
    : [];
}

function seedLabels(config: MockConfig, books: Book[]): Label[] {  const labels = (config.labels ?? []).map((label) => ({ ...label }));
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

function mirrorHostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function mockSearch(config: MockConfig, query: SearchQuery): SearchPage {
  const mode = config.searchMode ?? "ok";
  if (mode === "offline") {
    throw {
      code: "offline",
      message:
        "No network connection. Libgen search needs a connection; your shelf is still available.",
    };
  }
  if (mode === "allFailed") {
    throw {
      code: "all_mirrors_failed",
      message: "Every Libgen mirror refused or timed out. Try again in a moment.",
    };
  }
  if (mode === "formatChanged") {
    throw {
      code: "mirror_format_changed",
      message: "A Libgen mirror answered, but its results could not be read.",
    };
  }

  const all = config.searchResults ?? MOCK_SEARCH_RESULTS;
  const total = mode === "empty" ? 0 : (config.searchTotal ?? all.length);
  const filtersApplied =
    Boolean(query.language || query.format || query.yearFrom || query.yearTo);
  const matches = mode === "empty"
    ? []
    : all.filter((result) => {
        if (query.format && result.extension !== query.format.toLowerCase()) {
          return false;
        }
        if (query.language) {
          const language = (result.language ?? "").toLowerCase();
          if (!language.startsWith(query.language.toLowerCase())) return false;
        }
        if (query.yearFrom !== null || query.yearTo !== null) {
          if (result.year === null) return false;
          if (query.yearFrom !== null && result.year < query.yearFrom) return false;
          if (query.yearTo !== null && result.year > query.yearTo) return false;
        }
        return true;
      });
  const page = Math.max(1, query.page);
  const perPage = 25;
  const start = (page - 1) * perPage;
  const results = matches.slice(start, start + perPage);
  return {
    results,
    page,
    perPage,
    total,
    totalIsExact: config.searchTotalIsExact ?? true,
    onPageBeforeFilters:
      config.searchOnPageBeforeFilters ??
      Math.min(perPage, Math.max(0, total - start)),
    rowsReturned:
      config.searchRowsReturned ??
      Math.min(perPage, Math.max(0, total - start)),
    unsupportedRows: config.searchUnsupportedRows ?? 0,
    filtersApplied,
    sourceMirror: "libgen.li",
    health: [
      {
        host: "libgen.li",
        failures: 0,
        coolingDown: false,
        lastSuccess: true,
      },
    ],
  };
}

function validDownloadNaming(pattern: string): boolean {
  if (!pattern.trim()) return false;
  const supported = new Set(["author", "title", "year"]);
  let rest = pattern;
  while (true) {
    const start = rest.indexOf("{");
    if (start < 0) return !rest.includes("}");
    const after = rest.slice(start + 1);
    const end = after.indexOf("}");
    if (end < 0 || !supported.has(after.slice(0, end))) return false;
    rest = after.slice(end + 1);
  }
}

function createMockPlatform(config: MockConfig = {}): Platform {
  let state: LibraryState = config.state ?? "needsFolder";
  let folderName = config.folderName ?? null;
  let books = seedBooks(config.books);
  let labels = seedLabels(config, books);
  let shelves = initialShelves(config, books);
  let capacity = config.shelfCapacity ?? 12;
  let downloadNaming = readStored(
    MOCK_DOWNLOAD_NAMING_KEY,
    config.downloadNaming ?? DEFAULT_DOWNLOAD_NAMING,
  );
  let scanAdds = config.scanAdds ? [...config.scanAdds] : [];
  const backupScanAdds = config.backupScanAdds
    ? [...config.backupScanAdds]
    : [];
  let nextBookId = Math.max(0, ...books.map((book) => book.id)) + 1;
  let nextShelfId = Math.max(0, ...shelves.map((shelf) => shelf.id)) + 1;
  let nextLabelId = Math.max(0, ...labels.map((label) => label.id)) + 1;
  let downloads: Download[] = [];
  let nextDownloadId = 1;
  const downloadTimers = new Map<number, number>();
  const downloadFailedOnce = new Set<number>();
  const downloadStepMs = config.downloadStepMs ?? 45;
  const libraryDelay = () =>
    config.libraryDelayMs
      ? new Promise<void>((resolve) =>
          setTimeout(resolve, config.libraryDelayMs),
        )
      : Promise.resolve();
  const progress = new Map<number, number>(
    Object.entries(config.readingProgress ?? {}).map(([id, value]) => [
      Number(id),
      value,
    ]),
  );
  const diagnosticEntries = readStored<MockLogEntry[]>(
    MOCK_DIAGNOSTICS_KEY,
    [],
  );
  const updateConfig = config.updates ?? {};
  const updateScenario = updateConfig.scenario ?? "upToDate";
  const updateCurrentVersion =
    updateConfig.currentVersion ?? MOCK_APP_INFO.appVersion;
  const updateLatestVersion = updateConfig.latestVersion ?? "0.2.0";
  const updateSize = updateConfig.size ?? 3_535_963;
  const updateSha256 =
    updateConfig.sha256 ??
    "80ccd6cab3f2f814bc256b49386e15e37a1b88cf13c2980994b9b3dd33ea4de1";
  const updateStepMs = updateConfig.stepMs ?? 60;
  let updateDownloadFailuresLeft =
    updateScenario === "downloadError"
      ? (updateConfig.downloadFailures ?? 1)
      : 0;
  let updatePermissionPending = updateScenario === "installPermission";
  let updateDownloaded = false;
  const appendMockLog = (
    level: DiagnosticLevel,
    event: string,
    message: string,
  ) => {
    diagnosticEntries.push({ at: Date.now(), level, event, message });
    if (diagnosticEntries.length > 2000) {
      diagnosticEntries.splice(0, diagnosticEntries.length - 2000);
    }
    writeStored(MOCK_DIAGNOSTICS_KEY, diagnosticEntries);
  };
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
  const annotationStore = readStored<Record<number, Annotation[]>>(
    MOCK_ANNOTATIONS_KEY,
    {},
  );
  let nextAnnotationId =
    Math.max(
      0,
      ...Object.values(annotationStore).flatMap((list) =>
        list.map((annotation) => annotation.id),
      ),
    ) + 1;
  let pendingBackup: { token: string; name: string } | null = null;
  let nextBackupToken = 1;
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

  function addDownloadedBook(download: Download): number {
    let shelf = shelves.find(
      (candidate) => books.filter((book) => book.shelfId === candidate.id).length < candidate.capacity,
    );
    if (!shelf) {
      shelf = {
        id: nextShelfId++,
        ordinal: shelves.length,
        capacity,
      };
      shelves = [...shelves, shelf];
    }
    const used = new Set(
      books
        .filter((book) => book.shelfId === shelf!.id)
        .map((book) => book.slotIndex ?? 0),
    );
    let slotIndex = 0;
    while (used.has(slotIndex)) slotIndex += 1;
    const book: Book = {
      id: nextBookId++,
      contentHash: `mock-download-${download.id}`,
      format: download.format,
      title: download.title,
      authors: download.authors,
      series: null,
      language: null,
      description: null,
      publisher: null,
      publishedDate: download.year ? String(download.year) : null,
      identifier: null,
      pageCount: null,
      addedAt: Math.floor(Date.now() / 1000),
      shelfId: shelf.id,
      slotIndex,
      readingStatus: "unread",
      labels: [],
    };
    books = [...books, book];
    return book.id;
  }

  function finishMockDownload(id: number) {
    downloadTimers.delete(id);
    const index = downloads.findIndex((download) => download.id === id);
    if (index < 0) return;
    const current = downloads[index];
    if (current.state !== "running") return;
    if (config.downloadFail && !downloadFailedOnce.has(id)) {
      downloadFailedOnce.add(id);
      const code = config.downloadFailCode ?? "mirror_failed";
      const message =
        code === "offline"
          ? "The network is unavailable. Your shelf is unaffected."
          : code === "truncated_file"
            ? "The file arrived incomplete. Retry to resume where it stopped."
            : "The download mirror refused or timed out. Try again.";
      downloads[index] = {
        ...current,
        state: "failed",
        error: message,
        errorCode: code,
        finishedAt: Math.floor(Date.now() / 1000),
      };
      return;
    }
    const bookId = addDownloadedBook(current);
    downloads[index] = {
      ...current,
      state: "completed",
      bytes: current.totalBytes ?? current.bytes,
      error: null,
      errorCode: null,
      bookId,
      filename: `${current.authors[0] ?? "Unknown author"} - ${current.title} (${current.year ?? "n.d."}).${current.format}`,
      finishedAt: Math.floor(Date.now() / 1000),
    };
  }

  function scheduleMockDownload(id: number) {
    const timer = window.setTimeout(() => {
      const index = downloads.findIndex((download) => download.id === id);
      if (index < 0) return;
      if (downloads[index].state !== "queued") return;
      downloads[index] = {
        ...downloads[index],
        state: "running",
        totalBytes: downloads[index].totalBytes ?? 1_000_000,
        mirror:
          mirrorHostOf(downloads[index].mirrorUrls[0] ?? "") ??
          downloads[index].source,
      };
      const tick = window.setInterval(() => {
        const current = downloads.findIndex((download) => download.id === id);
        if (current < 0) {
          window.clearInterval(tick);
          return;
        }
        const row = downloads[current];
        if (row.state !== "running") {
          window.clearInterval(tick);
          downloadTimers.delete(id);
          return;
        }
        const total = row.totalBytes ?? 1_000_000;
        const next = Math.min(total, row.bytes + Math.ceil(total / 4));
        const failover = config.downloadFailover === true && next < total;
        downloads[current] = {
          ...row,
          bytes: next,
          error: failover ? "Trying another mirror…" : null,
          mirror: failover
            ? mirrorHostOf(row.mirrorUrls[1] ?? row.mirrorUrls[0] ?? "") ??
              row.mirror
            : row.mirror,
        };
        if (next >= total) {
          window.clearInterval(tick);
          finishMockDownload(id);
        }
      }, downloadStepMs);
      downloadTimers.set(id, tick);
    }, downloadStepMs);
    downloadTimers.set(id, timer);
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
      relinked: 0,
      removed: 0,
      duplicates: 0,
      skipped: [],
      placements: [],
    };

    for (const add of scanAdds) {
      if (books.some((book) => book.contentHash === add.contentHash)) {
        report.relinked += 1;
        continue;
      }
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

  const base: Platform = {
    appInfo: async () => MOCK_APP_INFO,
    searchLibgen: async (query) => mockSearch(config, query),
    enqueueDownload: async (request) => {
      const completed = downloads.find(
        (download) =>
          download.md5.toLowerCase() === request.md5.toLowerCase() &&
          download.state === "completed",
      );
      if (completed) {
        const duplicate: Download = {
          id: nextDownloadId++,
          ...request,
          state: "completed",
          mirror: null,
          bytes: 0,
          totalBytes: null,
          error: "Already in your library",
          errorCode: "duplicate",
          bookId: completed.bookId,
          filename: completed.filename,
          createdAt: Math.floor(Date.now() / 1000),
          finishedAt: Math.floor(Date.now() / 1000),
        };
        downloads = [duplicate, ...downloads];
        return { ...duplicate };
      }
      const active = downloads.find(
        (download) =>
          download.md5.toLowerCase() === request.md5.toLowerCase() &&
          (download.state === "queued" || download.state === "running"),
      );
      if (active) return { ...active };
      const row: Download = {
        id: nextDownloadId++,
        ...request,
        state: "queued",
        mirror: null,
        bytes: 0,
        totalBytes: null,
        error: null,
        errorCode: null,
        bookId: null,
        filename: null,
        createdAt: Math.floor(Date.now() / 1000),
        finishedAt: null,
      };
      downloads = [row, ...downloads];
      scheduleMockDownload(row.id);
      return { ...row };
    },
    listDownloads: async () => downloads.map((download) => ({ ...download })),
    cancelDownload: async (id) => {
      const timer = downloadTimers.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        window.clearInterval(timer);
        downloadTimers.delete(id);
      }
      downloads = downloads.map((download) =>
        download.id === id
          ? {
              ...download,
              state: "cancelled",
              error: null,
              errorCode: null,
              finishedAt: Math.floor(Date.now() / 1000),
            }
          : download,
      );
    },
    retryDownload: async (id) => {
      const existing = downloads.find((download) => download.id === id);
      if (!existing) {
        throw { code: "download_not_found", message: "That download could not be found." };
      }
      downloads = downloads.map((download) =>
        download.id === id
          ? {
              ...download,
              state: "queued",
              mirror: null,
              bytes: 0,
              totalBytes: null,
              error: null,
              errorCode: null,
              finishedAt: null,
            }
          : download,
      );
      scheduleMockDownload(id);
      return { ...downloads.find((download) => download.id === id)! };
    },
    listBooks: async () => {
      await libraryDelay();
      return books;
    },
    listShelves: async () => {
      await libraryDelay();
      return shelves;
    },
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
    getDownloadNaming: async () => downloadNaming,
    setDownloadNaming: async (pattern) => {
      const trimmed = pattern.trim();
      if (!validDownloadNaming(trimmed)) {
        throw {
          code: "invalid_download_naming",
          message:
            "Choose a pattern using only {author}, {title} and {year}, with both braces.",
        };
      }
      downloadNaming = trimmed;
      writeStored(MOCK_DOWNLOAD_NAMING_KEY, downloadNaming);
      return downloadNaming;
    },
    moveBook: async (bookId, shelfId, slotIndex) => {
      if (config.moveDelayMs) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, config.moveDelayMs),
        );
      }
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
    deleteBook: async (bookId) => {
      if (!books.some((book) => book.id === bookId)) {
        throw { code: "book_not_found", message: "That book could not be found." };
      }
      books = applyDelete(books, shelves, bookId);
      books = books.filter((book) => book.id !== bookId);
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
    listAnnotations: async (bookId) => [
      ...(annotationStore[bookId] ?? []).map((annotation) => ({
        ...annotation,
      })),
    ],
    createAnnotation: async (bookId, kind, colour, note, locator) => {
      if (!locator.trim()) {
        throw {
          code: "invalid_reader_locator",
          message: "The reading position could not be saved.",
        };
      }
      const now = Math.floor(Date.now() / 1000);
      const trimmed = note?.trim() ?? "";
      const annotation: Annotation = {
        id: nextAnnotationId++,
        bookId,
        kind: trimmed ? "note" : kind === "note" ? "note" : "highlight",
        colour: colour?.trim() || null,
        note: trimmed || null,
        locator,
        createdAt: now,
        updatedAt: now,
      };
      annotationStore[bookId] = [...(annotationStore[bookId] ?? []), annotation];
      writeStored(MOCK_ANNOTATIONS_KEY, annotationStore);
      return { ...annotation };
    },
    updateAnnotation: async (bookId, annotationId, patch) => {
      const list = annotationStore[bookId] ?? [];
      const index = list.findIndex((annotation) => annotation.id === annotationId);
      if (index < 0) {
        throw {
          code: "annotation_not_found",
          message: "That annotation could not be found.",
        };
      }
      const current = list[index];
      const next: Annotation = {
        ...current,
        colour:
          patch.colour === undefined
            ? current.colour
            : patch.colour.trim() || null,
        note:
          patch.note === undefined ? current.note : patch.note.trim() || null,
        locator: patch.locator ?? current.locator,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      if (patch.note !== undefined) {
        next.kind = next.note ? "note" : "highlight";
      }
      annotationStore[bookId] = list.map((annotation, at) =>
        at === index ? next : annotation,
      );
      writeStored(MOCK_ANNOTATIONS_KEY, annotationStore);
      return { ...next };
    },
    deleteAnnotation: async (bookId, annotationId) => {
      annotationStore[bookId] = (annotationStore[bookId] ?? []).filter(
        (annotation) => annotation.id !== annotationId,
      );
      writeStored(MOCK_ANNOTATIONS_KEY, annotationStore);
    },
    exportBackup: async () => {
      if ("backupExport" in config && config.backupExport === null) return null;
      return (
        config.backupExport ?? {
          fileName: "pocketlibrary-backup.pocketlibrary",
          bytes: 18_432,
          books: books.length,
        }
      );
    },
    previewBackup: async () => {
      if (config.backupError) throw config.backupError;
      const token = `mock-backup-${nextBackupToken++}`;
      pendingBackup = { token, name: "pocketlibrary-backup.pocketlibrary" };
      return {
        token,
        fileName: pendingBackup.name,
        preview: config.backupPreview ?? { matched: 3, new: 2 },
      };
    },
    importBackup: async (token, mode) => {
      if (config.backupError) throw config.backupError;
      if (!pendingBackup || pendingBackup.token !== token) {
        throw {
          code: "backup_selection_expired",
          message: "That archive is no longer selected. Choose it again.",
        };
      }
      pendingBackup = null;
      const matched = config.backupPreview?.matched ?? 3;
      const added = config.backupPreview?.new ?? 2;
      const report =
        mode === "replace"
          ? (config.backupReplaceReport ?? {
              mode,
              matched,
              new: added,
              skipped: 0,
              replaced: books.length,
            })
          : (config.backupMergeReport ?? {
              mode,
              matched,
              new: added,
              skipped: 1,
              replaced: 0,
            });
      // The native shell rescans right after an import so restored pathless
      // books are matched to files. The mock runs the same rescan seam.
      scanAdds = [...backupScanAdds];
      const scan = rescan();
      return { report, scan, scanError: null };
    },
    openBookExternally: async () => {
      throw {
        code: "unsupported",
        message: "Opening a book in another app needs the Android build.",
      };
    },
    logDiagnostic: async (level, event, message) => {
      appendMockLog(level, event, message);
    },
    diagnosticsSummary: async () => summarizeMockLog(diagnosticEntries),
    clearDiagnostics: async () => {
      diagnosticEntries.length = 0;
      writeStored(MOCK_DIAGNOSTICS_KEY, diagnosticEntries);
    },
    sendDiagnostics: async () => {
      const size = config.diagnosticsBytes ?? 2048;
      const share =
        "diagnosticsShare" in config ? (config.diagnosticsShare ?? null) : null;
      return shareOrSaveDiagnostics(
        "pocketlibrary-diagnostics.zip",
        size,
        async () => {
          if (share) {
            appendMockLog(
              "info",
              "diagnostics.export",
              `shared pocketlibrary-diagnostics.zip (${share.bytes} bytes)`,
            );
          }
          return share;
        },
        async () => {
          if ("diagnosticsSave" in config) {
            return config.diagnosticsSave ?? null;
          }
          appendMockLog(
            "info",
            "diagnostics.export",
            `saved pocketlibrary-diagnostics.zip (${size} bytes)`,
          );
          return {
            fileName: "pocketlibrary-diagnostics.zip",
            bytes: size,
          };
        },
      );
    },
    checkForUpdate: async () => {
      if (updateScenario === "checkError") {
        throw (
          updateConfig.checkError ?? {
            code: "network",
            message:
              "Couldn't reach the update server. Check your connection and try again.",
          }
        );
      }
      if (updateScenario === "upToDate") {
        return {
          currentVersion: updateCurrentVersion,
          available: false,
          latestVersion: updateCurrentVersion,
          notes: null,
          pubDate: null,
          size: null,
          sha256: null,
        };
      }
      return {
        currentVersion: updateCurrentVersion,
        available: true,
        latestVersion: updateLatestVersion,
        notes:
          updateConfig.notes ??
          "Fixes shelf placement, speeds up imports and tidies the reader.",
        pubDate: updateConfig.pubDate ?? "2026-11-25T10:00:00Z",
        size: updateSize,
        sha256: updateSha256,
      };
    },
    downloadUpdate: async (onEvent) => {
      if (updateScenario === "upToDate" || updateScenario === "checkError") {
        throw { code: "noUpdate", message: "Check for updates first." };
      }
      const contentLength = updateSize;
      onEvent({
        event: "started",
        data: { contentLength, total: updateSize },
      });
      const chunks = 5;
      const chunkLength = Math.ceil(updateSize / chunks);
      let downloaded = 0;
      for (let step = 0; step < chunks; step += 1) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, updateStepMs),
        );
        downloaded = Math.min(updateSize, downloaded + chunkLength);
        onEvent({
          event: "progress",
          data: { chunkLength, downloaded, contentLength },
        });
        if (updateDownloadFailuresLeft > 0 && step === 1) {
          updateDownloadFailuresLeft -= 1;
          throw (
            updateConfig.downloadError ?? {
              code: "network",
              message:
                "The download stopped before it finished. Check your connection and try again.",
            }
          );
        }
      }
      updateDownloaded = true;
      onEvent({ event: "finished", data: { bytes: updateSize } });
      return {
        version: updateLatestVersion,
        bytes: updateSize,
        sha256: updateSha256,
      };
    },
    installUpdate: async () => {
      if (!updateDownloaded) {
        throw { code: "noDownload", message: "Download the update first." };
      }
      if (updatePermissionPending) {
        updatePermissionPending = false;
        throw {
          code: "installPermission",
          message:
            "Allow PocketLibrary to install unknown apps, then try again.",
        };
      }
      return { started: true };
    },
  };

  return traced(base, (method, error) => {
    appendMockLog("error", "command_failed", `${method}: ${errorText(error)}`);
  });
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
