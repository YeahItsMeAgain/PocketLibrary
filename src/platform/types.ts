/**
 * Wire and domain types for the platform seam.
 *
 * These mirror the Rust command API (`core/` and `src-tauri/`); keep them in
 * sync with the camelCase payloads those commands return.
 */
import { invoke } from "@tauri-apps/api/core";

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
  /** Persisted renderer style; absent means the default, Wrap. */
  spineStyle?: SpineStyle;
  /**
   * Cached 52 x 236 strip delivered with the list payload, when one exists.
   * The shelf paints this immediately; live queue state can replace it.
   */
  spineDataUrl?: string | null;
}

/** Mirrors `pocketlibrary_core::BookDetail`. */
export interface BookDetail extends Book {
  coverDataUrl: string | null;
  enrichment: BookEnrichmentState;
}

/**
 * Fields the Edit layer may change. Absent fields keep their current value;
 * `pageCount: null` clears the page count. Authors are trimmed and empty
 * entries are dropped at the edge.
 */
export interface BookEdit {
  title?: string;
  authors?: string[];
  pageCount?: number | null;
}

/* ------------------------------------------------------------- spine engine */

/** Which route the on-device pipeline took from the cover to text-free art. */
export type SpineRoute = "crop" | "inpaint" | "fallback";

/** The quality gate's verdict for a generated spine. */
export type SpineVerdict = "pass" | "review" | "fallback";

/** `final.crop_box_work` in art-image pixels, as the engine reports it. */
export interface SpineCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors the shell's `SpineArtifact` (camelCase on the wire). */
export interface SpineArtifact {
  bookId: number;
  route: SpineRoute;
  verdict: SpineVerdict;
  maskPercent: number;
  /** True when a missing page count forced the ~320-page width estimate. */
  pagesApproximate: boolean;
  cropBox: SpineCropBox | null;
  /** Text-free working art; `data:image/jpeg;base64,...`. */
  artDataUrl: string;
  /** 52 x 236 spine crop. */
  spineDataUrl: string;
  fallbackDataUrl: string;
  runJson: unknown;
  qaJson: unknown;
}

/** One shelf-ready strip projected from the on-disk cache. */
export interface SpineCachedStrip {
  bookId: number;
  verdict: SpineVerdict;
  /** 52 x 236 strip; `data:image/jpeg;base64,...`. */
  spineDataUrl: string;
}

/** Mirrors the shell's `SpineStatus`. */
export interface SpineStatus {
  models: "ready" | "bundled" | "missing" | "error";
  bundleId: string;
  bytes: number;
  /** Resolved model directory, or the expected directory when resolution failed. */
  modelPath: string | null;
  /** True when every required model file is present on disk. */
  modelPresent: boolean;
  error: string | null;
}

/** One book whose automatic spine job failed and is waiting for a retry. */
export interface SpineQueueFailure {
  bookId: number;
  state: "needs-attention";
  code: string;
  error: string;
  attempts: number;
}

/** One row of the read-only Settings → Spine status table. */
export interface SpineBookDiagnostic {
  bookId: number;
  title: string;
  coverPresent: boolean;
  artifactPresent: boolean;
  lastError: string | null;
}

/** Mirrors the shell's `SpineDiagnostics` command payload. */
export interface SpineDiagnostics {
  status: SpineStatus;
  queue: SpineQueueState;
  books: SpineBookDiagnostic[];
}

/* ------------------------------------------------------- automatic queue */

/** The three renderer styles. Persisted per book in `books.spine_style`. */
export type SpineStyle = "wrap" | "full-bleed" | "cloth";

/** A pipeline stage the queue reports while a book is being prepared. */
export type SpineStage = "art" | "text" | "check";

/** Mirrors the shell's `SpineQueueState` (camelCase on the wire). */
export interface SpineQueueState {
  running: boolean;
  paused: boolean;
  pending: number;
  completed: number;
  failed: number;
  currentBookId: number | null;
  stage: SpineStage | null;
  /**
   * True only while the existing library has never been queued for the
   * current model bundle; the shell clears it once the backfill has run.
   */
  backfillPending: boolean;
  /** Failed books that stay visible until Retry clears them. */
  attention: SpineQueueFailure[];
}

/** Payload of `spine://progress`, one per stage. */
export interface SpineProgress {
  bookId: number;
  stage: SpineStage;
  index: number;
  total: number;
}

/** Register for queue state transitions; resolves to an unsubscribe function. */
export type SpineQueueListener = (state: SpineQueueState) => void;
/** Register for per-stage progress; resolves to an unsubscribe function. */
export type SpineProgressListener = (progress: SpineProgress) => void;

export type EnrichmentMode = "off" | "ask" | "automatic";

export interface EnrichmentSettings {
  mode: EnrichmentMode;
  sourceLabel: string;
  sourceUrl: string;
  batchLimit: number;
}

export interface EnrichmentAttribution {
  label: string;
  url: string;
  fields: string[];
}

export interface EnrichmentCandidate {
  key: string;
  source: string;
  title: string;
  authors: string[];
  year: number | null;
  publisher: string | null;
  hasCover: boolean;
  coverDataUrl: string | null;
  sourceUrl: string;
}

export type EnrichmentOutcome =
  | {
      state: "applied";
      source: string;
      fields: string[];
      attribution: EnrichmentAttribution | null;
    }
  | {
      state: "needsReview";
      candidates: EnrichmentCandidate[];
      attribution: EnrichmentAttribution;
    }
  | { state: "noMatch"; source: string; reason: string }
  | {
      state: "unavailable";
      source: string;
      code: string;
      message: string;
      retryAfterSeconds?: number;
    }
  | { state: "cancelled" };

export interface BookEnrichmentState {
  hasFileCover: boolean;
  fileCoverSource: CoverSource | null;
  coverSource: CoverSource | null;
  coverManual: boolean;
  descriptionSource: string | null;
  descriptionUrl: string | null;
  coverUrl: string | null;
  hasGap: boolean;
  attribution: EnrichmentAttribution | null;
}

export type CoverSource =
  | "embedded"
  | "rendered"
  | "generated"
  | "open_library"
  | "internet_archive"
  | "device";

export interface CoverOption {
  key: string;
  source: string;
  label: string;
  detail: string | null;
  previewDataUrl: string | null;
  isCurrent: boolean;
  isOriginal: boolean;
  candidateKey?: string;
  providerCoverKey?: string;
  sourceUrl?: string;
  warning?: string;
}

export interface CoverChoices {
  current: CoverOption | null;
  original: CoverOption;
  online: CoverOption[];
  sourceLabel: string;
}

export type CoverLookupOutcome =
  | {
      state: "found";
      candidates: CoverOption[];
      attribution: EnrichmentAttribution;
    }
  | {
      state: "unavailable";
      source: string;
      code: string;
      message: string;
      retryAfterSeconds?: number;
    }
  | { state: "noMatch"; source: string; reason: string }
  | { state: "cancelled" };

export interface DeviceCoverPreview {
  token: string;
  previewDataUrl: string;
  width: number;
  height: number;
  warning: string | null;
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
  editBook(bookId: number, changes: BookEdit): Promise<BookDetail>;
  enrichmentSettings(): Promise<EnrichmentSettings>;
  setEnrichmentMode(mode: EnrichmentMode): Promise<EnrichmentSettings>;
  lookupEnrichment(bookId: number, force?: boolean): Promise<EnrichmentOutcome>;
  acceptEnrichmentCandidate(
    bookId: number,
    key: string,
  ): Promise<EnrichmentOutcome>;
  cancelEnrichment(bookId: number): Promise<void>;
  editBlurb(bookId: number, text: string | null): Promise<void>;
  revertEnrichment(bookId: number): Promise<void>;
  enrichmentTargets(limit: number): Promise<Book[]>;
  coverChoices(bookId: number): Promise<CoverChoices>;
  lookupCoverCandidates(bookId: number): Promise<CoverLookupOutcome>;
  applyCoverChoice(
    bookId: number,
    choice: CoverOption,
    acknowledged?: boolean,
  ): Promise<void>;
  chooseDeviceCover(bookId: number): Promise<DeviceCoverPreview | null>;
  applyDeviceCover(
    bookId: number,
    token: string,
    acknowledged?: boolean,
  ): Promise<void>;
  resetCover(bookId: number): Promise<void>;
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
  /** One bounded plain-text report, including recent failures and spine.log. */
  diagnosticsText(): Promise<string>;
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
  /** Run the on-device spine pipeline for a book, reusing the cache. */
  spineGenerate(bookId: number): Promise<SpineArtifact>;
  /** Load an existing result without running the pipeline; `null` if none. */
  spineArtifact(bookId: number): Promise<SpineArtifact | null>;
  /**
   * Project every cached spine for the wall. Scans the cache only: never runs
   * inference and never hashes a cover.
   */
  spineCachedStrips(): Promise<SpineCachedStrip[]>;
  /** Whether the required model bundle is installed and usable. */
  spineStatus(): Promise<SpineStatus>;
  /** Read engine, queue and per-book cache state without changing anything. */
  spineDiagnostics(): Promise<SpineDiagnostics>;
  /** Queue books for automatic preparation; dedupes and skips cached. */
  spineEnqueue(bookIds: number[]): Promise<void>;
  /** Clear each failed state, then queue the books again. */
  spineRetry(bookIds: number[]): Promise<void>;
  /** The worker's current counts and stage. */
  spineQueue(): Promise<SpineQueueState>;
  /** Reader-open pause; manual generation still runs. */
  spinePause(paused: boolean): Promise<void>;
  /** Persist a book's renderer style. */
  spineSetStyle(bookId: number, style: SpineStyle): Promise<void>;
  /** Subscribe to `spine://queue`; resolves to an unsubscribe function. */
  onSpineQueue(handler: SpineQueueListener): Promise<() => void>;
  /** Subscribe to `spine://progress`; resolves to an unsubscribe function. */
  onSpineProgress(handler: SpineProgressListener): Promise<() => void>;
}

export type Invoke = typeof invoke;
