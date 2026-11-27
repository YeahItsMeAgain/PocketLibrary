/**
 * The browser mock of the platform seam. Playwright and Vite dev run against
 * this implementation, which stores state in memory and `localStorage`.
 */
import {
  SPINE_BUNDLE_ID,
  SPINE_HEIGHT,
  SPINE_WIDTH,
} from "../spineSpec";
import {
  errorText,
  shareOrSaveDiagnostics,
  traced,
  type SavedDiagnostics,
  type SharedDiagnostics,
} from "./shared";
import {
  DEFAULT_DOWNLOAD_NAMING,
  LABEL_PALETTE,
} from "./types";
import type {
  Annotation,
  ApiError,
  AppInfo,
  BackupExport,
  BackupPreview,
  BackupReport,
  Book,
  BookEnrichmentState,
  Bookmark,
  CoverLookupOutcome,
  CoverOption,
  CoverSource,
  DeviceCoverPreview,
  DiagnosticLevel,
  DiagnosticsSummary,
  Download,
  EnrichmentAttribution,
  EnrichmentMode,
  EnrichmentOutcome,
  Label,
  LabelUsage,
  LibgenResult,
  LibraryState,
  LibraryStatus,
  Platform,
  ReadingStatus,
  ScanReport,
  SearchPage,
  SearchQuery,
  Shelf,
  SpineArtifact,
  SpineCachedStrip,
  SpineCropBox,
  SpineProgress,
  SpineProgressListener,
  SpineQueueListener,
  SpineQueueState,
  SpineRoute,
  SpineStage,
  SpineStatus,
  SpineStyle,
  SpineVerdict,
} from "./types";

export const MOCK_APP_INFO: AppInfo = {
  name: "PocketLibrary",
  appVersion: "0.1.8",
  schemaVersion: 6,
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

const MOCK_ALT_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">' +
      '<rect width="300" height="450" fill="#294735"/>' +
      '<rect x="18" y="18" width="264" height="414" fill="none" stroke="#e7d4ac" stroke-width="2"/>' +
      '<circle cx="150" cy="210" r="62" fill="none" stroke="#e7d4ac" stroke-width="2"/>' +
      '<path d="M150 158 L166 202 L212 202 L175 229 L189 274 L150 247 L111 274 L125 229 L88 202 L134 202 Z" fill="#e7d4ac"/>' +
      "</svg>",
  );

const MOCK_SPINE_CROP: SpineCropBox = {
  x: 92,
  y: 44,
  width: 116,
  height: 362,
};

function loadMockImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function mockSpineCloth(book: Book): string {
  if (typeof document === "undefined") return MOCK_COVER;
  const palettes = ["#4a2a45", "#294735", "#26384f", "#6e2630", "#333336"];
  const cloth = palettes[book.id % palettes.length];
  const canvas = document.createElement("canvas");
  canvas.width = SPINE_WIDTH;
  canvas.height = SPINE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return MOCK_COVER;
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, SPINE_WIDTH, SPINE_HEIGHT);
  // Woven grain, then the brass head/tail rules.
  for (let x = 0; x < SPINE_WIDTH; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.09)";
    ctx.fillRect(x, 0, 0.5, SPINE_HEIGHT);
  }
  ctx.fillStyle = "#e8d3a1";
  ctx.globalAlpha = 0.72;
  ctx.fillRect(8, 12, SPINE_WIDTH - 16, 0.7);
  ctx.fillRect(8, SPINE_HEIGHT - 12, SPINE_WIDTH - 16, 0.7);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(SPINE_WIDTH / 2, SPINE_HEIGHT / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#f2e6c9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 11px Georgia, serif";
  ctx.fillText((book.title || "Untitled").toUpperCase().slice(0, 30), 0, -4);
  ctx.font = "400 7px Georgia, serif";
  ctx.fillText((book.authors[0] ?? "").toUpperCase().slice(0, 24), 0, 6);
  ctx.restore();
  return canvas.toDataURL("image/jpeg", 0.9);
}

async function buildMockSpineArtifact(
  book: Book,
  config: MockSpineConfig,
  coverDataUrl: string,
): Promise<SpineArtifact> {
  const verdict = config.verdict ?? "pass";
  const route: SpineRoute =
    config.route ?? (verdict === "fallback" ? "fallback" : "crop");
  const maskPercent =
    config.maskPercent ??
    (verdict === "pass" ? 0 : verdict === "review" ? 44.1 : 62.5);
  const crop = MOCK_SPINE_CROP;
  const fallbackDataUrl = mockSpineCloth(book);
  let artDataUrl = coverDataUrl;
  let spineDataUrl = fallbackDataUrl;

  const source = await loadMockImage(coverDataUrl);
  if (source && typeof document !== "undefined") {
    const art = document.createElement("canvas");
    art.width = 300;
    art.height = 450;
    const artCtx = art.getContext("2d");
    if (artCtx) {
      artCtx.drawImage(source, 0, 0, art.width, art.height);
      // A faint plate gradient makes the synthetic art visibly different from
      // the cover while staying inside the same palette.
      const glow = artCtx.createLinearGradient(0, 0, 0, art.height);
      glow.addColorStop(0, "rgba(255,238,196,.08)");
      glow.addColorStop(0.55, "rgba(0,0,0,0)");
      glow.addColorStop(1, "rgba(0,0,0,.22)");
      artCtx.fillStyle = glow;
      artCtx.fillRect(0, 0, art.width, art.height);
      artDataUrl = art.toDataURL("image/jpeg", 0.9);

      const spine = document.createElement("canvas");
      spine.width = SPINE_WIDTH;
      spine.height = SPINE_HEIGHT;
      const spineCtx = spine.getContext("2d");
      if (spineCtx) {
        // Cover-fit the reported crop box into the 52 x 236 strip.
        const sourceAspect = crop.width / crop.height;
        const targetAspect = SPINE_WIDTH / SPINE_HEIGHT;
        let sw = crop.width;
        let sh = crop.height;
        let sx = crop.x;
        let sy = crop.y;
        if (sourceAspect > targetAspect) {
          sw = crop.height * targetAspect;
          sx = crop.x + (crop.width - sw) / 2;
        } else {
          sh = crop.width / targetAspect;
          sy = crop.y + (crop.height - sh) / 2;
        }
        spineCtx.drawImage(
          art,
          sx,
          sy,
          sw,
          sh,
          0,
          0,
          SPINE_WIDTH,
          SPINE_HEIGHT,
        );
        const edge = spineCtx.createLinearGradient(0, 0, SPINE_WIDTH, 0);
        edge.addColorStop(0, "rgba(0,0,0,.4)");
        edge.addColorStop(0.1, "rgba(0,0,0,0)");
        edge.addColorStop(0.9, "rgba(0,0,0,0)");
        edge.addColorStop(1, "rgba(0,0,0,.4)");
        spineCtx.fillStyle = edge;
        spineCtx.fillRect(0, 0, SPINE_WIDTH, SPINE_HEIGHT);
        spineDataUrl = spine.toDataURL("image/jpeg", 0.9);
      }
    }
  }

  return {
    bookId: book.id,
    route,
    verdict,
    maskPercent,
    pagesApproximate: config.pagesApproximate ?? false,
    cropBox: crop,
    artDataUrl,
    spineDataUrl,
    fallbackDataUrl,
    runJson: {
      final: {
        crop_box_work: [crop.x, crop.y, crop.width, crop.height],
      },
      route,
      verdict,
    },
    qaJson: {
      verdict,
      route,
      mask_pct: maskPercent,
      residual_text: verdict !== "pass",
    },
  };
}

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
  /** Online-details and cover-chooser scenarios. */
  enrichment?: MockEnrichmentConfig;
  /** On-device spine engine scenario. */
  spine?: MockSpineConfig;
}

/**
 * Drives the mock enrichment and cover chooser without a network.
 *
 * `lookup` is the outcome returned per book; `coverCandidates` is what
 * **Find covers** returns; `fileCoverIds` marks books whose file supplied a
 * real cover rather than the generated plate.
 */
export interface MockEnrichmentConfig {
  mode?: EnrichmentMode;
  /** Make forcing/setting a mode fail, as a network or database fault would. */
  setModeError?: ApiError;
  sourceLabel?: string;
  sourceUrl?: string;
  batchLimit?: number;
  fileCoverIds?: number[];
  lookup?: Record<number, EnrichmentOutcome>;
  appliedDescription?: string;
  appliedCoverUrl?: string;
  coverCandidates?: Record<number, CoverOption[]>;
  /** Candidates already in the cache before **Find covers** is pressed. */
  cachedCoverCandidates?: Record<number, CoverOption[]>;
  coverLookup?: Record<number, CoverLookupOutcome>;
  devicePreview?: Record<number, DeviceCoverPreview | null>;
  lookupDelayMs?: number;
  applyError?: ApiError;
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
  /** Test observability: metadata checks this mock has served. */
  checks?: number;
  checkError?: ApiError;
  downloadError?: ApiError;
}

/**
 * Drives the mock spine engine without a network or native pipeline.
 *
 * The browser mock fabricates a deterministic artifact from the same mock
 * cover the rest of the UI uses: a JPEG working art, a realistic crop box and
 * 52 x 236 spine/fallback strips. It never calls the real engine.
 */
export interface MockSpineConfig {
  verdict?: SpineVerdict;
  route?: SpineRoute;
  maskPercent?: number;
  /** Mark the generated width as the ~320-page estimate. */
  pagesApproximate?: boolean;
  /** Artifacts `spineArtifact` returns before anything is generated. */
  artifacts?: Record<number, SpineArtifact>;
  /** Milliseconds a mock generation takes, so the honest progress copy shows. */
  generateDelayMs?: number;
  /** Make generation fail with a typed command error. */
  error?: ApiError;
  status?: Partial<SpineStatus>;
  /** Milliseconds per mock queue stage (default 45). */
  queueStepMs?: number;
  /** Books whose automatic job fails at the check stage. */
  failIds?: number[];
  /** Start the queue paused, so a test can resume it deliberately. */
  queueStartPaused?: boolean;
  /** Whether the library still needs its one-time bundle backfill. */
  backfillPending?: boolean;
  /** Persisted per-book styles before the session starts. */
  styles?: Record<number, SpineStyle>;
}

const MOCK_READING_KEY = "pocketlibrary.mock.reading";
const MOCK_BOOKMARKS_KEY = "pocketlibrary.mock.bookmarks";
const MOCK_ANNOTATIONS_KEY = "pocketlibrary.mock.annotations";
const MOCK_DOWNLOAD_NAMING_KEY = "pocketlibrary.mock.downloadNaming";
const MOCK_ENRICHMENT_KEY = "pocketlibrary.mock.enrichmentMode";
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

export function mockConfig(): MockConfig {
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

export function createMockPlatform(config: MockConfig = {}): Platform {
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
  const enrichmentConfig = config.enrichment ?? {};
  let enrichmentMode = readStored<EnrichmentMode>(
    MOCK_ENRICHMENT_KEY,
    enrichmentConfig.mode ?? "automatic",
  );
  const enrichmentSourceLabel =
    enrichmentConfig.sourceLabel ?? "Open Library";
  const enrichmentSourceUrl =
    enrichmentConfig.sourceUrl ?? "https://openlibrary.org";
  const enrichmentStates = new Map<number, BookEnrichmentState>();
  const coverDataByBook = new Map<number, string>();
  const originalCoverData = new Map<number, string>();
  const fileDescriptions = new Map<number, string | null>();
  const usedDeviceTokens = new Set<string>();
  let nextDeviceToken = 1;
  const spineConfig = config.spine ?? {};
  const spineArtifacts = new Map<number, SpineArtifact>();
  for (const [id, artifact] of Object.entries(spineConfig.artifacts ?? {})) {
    spineArtifacts.set(Number(id), artifact);
  }
  let spineGenerateCalls = 0;
  const noteSpineGenerate = () => {
    spineGenerateCalls += 1;
    (
      window as unknown as { __POCKETLIBRARY_SPINE_GENERATE_CALLS__?: number }
    ).__POCKETLIBRARY_SPINE_GENERATE_CALLS__ = spineGenerateCalls;
  };
  let spineStatusCalls = 0;
  const noteSpineStatus = () => {
    spineStatusCalls += 1;
    (
      window as unknown as { __POCKETLIBRARY_SPINE_STATUS_CALLS__?: number }
    ).__POCKETLIBRARY_SPINE_STATUS_CALLS__ = spineStatusCalls;
  };
  let spineCachedStripCalls = 0;
  const noteSpineCachedStrips = () => {
    spineCachedStripCalls += 1;
    (
      window as unknown as {
        __POCKETLIBRARY_SPINE_CACHED_STRIP_CALLS__?: number;
      }
    ).__POCKETLIBRARY_SPINE_CACHED_STRIP_CALLS__ = spineCachedStripCalls;
  };

  /* --------------------------------------------------- mock spine queue */

  const queueListeners = new Set<SpineQueueListener>();
  const progressListeners = new Set<SpineProgressListener>();
  const queue: SpineQueueState = {
    running: false,
    paused: spineConfig.queueStartPaused === true,
    pending: 0,
    completed: 0,
    failed: 0,
    currentBookId: null,
    stage: null,
    backfillPending: spineConfig.backfillPending ?? true,
  };
  const queueJobs: number[] = [];
  const queuedIds = new Set<number>();
  const failedQueueIds = new Set<number>();
  const spineStyles = new Map<number, SpineStyle>(
    Object.entries(spineConfig.styles ?? {}).map(([id, style]) => [
      Number(id),
      style,
    ]),
  );
  const queueStep = spineConfig.queueStepMs ?? 45;
  let queueTimer: number | null = null;
  let pausedStage: { bookId: number; index: number } | null = null;
  const queuedCalls: number[] = [];
  const pauseCalls: boolean[] = [];
  const queueEvents: Array<{
    event: "queue" | "progress";
    payload: unknown;
  }> = [];
  const exposeMockSpine = () => {
    const scope = window as unknown as {
      __POCKETLIBRARY_SPINE_QUEUED__?: number[];
      __POCKETLIBRARY_SPINE_PAUSE_CALLS__?: boolean[];
      __POCKETLIBRARY_SPINE_EVENTS__?: typeof queueEvents;
      __POCKETLIBRARY_SPINE_ARTIFACT_IDS__?: number[];
      __POCKETLIBRARY_SPINE_STYLES__?: Record<number, SpineStyle>;
    };
    scope.__POCKETLIBRARY_SPINE_QUEUED__ = queuedCalls;
    scope.__POCKETLIBRARY_SPINE_PAUSE_CALLS__ = pauseCalls;
    scope.__POCKETLIBRARY_SPINE_EVENTS__ = queueEvents;
    scope.__POCKETLIBRARY_SPINE_ARTIFACT_IDS__ = [...spineArtifacts.keys()];
    scope.__POCKETLIBRARY_SPINE_STYLES__ = Object.fromEntries(spineStyles);
  };
  const queueSnapshot = (): SpineQueueState => ({ ...queue });
  const emitQueue = () => {
    const payload = queueSnapshot();
    queueEvents.push({ event: "queue", payload });
    exposeMockSpine();
    for (const handler of queueListeners) handler(payload);
  };
  const emitProgress = (progress: SpineProgress) => {
    queueEvents.push({ event: "progress", payload: progress });
    exposeMockSpine();
    for (const handler of progressListeners) handler(progress);
  };

  async function produceSpineArtifact(bookId: number): Promise<SpineArtifact> {
    const book = books.find((candidate) => candidate.id === bookId);
    if (!book) {
      throw {
        code: "book_not_found",
        message: "That book could not be found.",
      };
    }
    if (spineConfig.error) throw spineConfig.error;
    if (spineConfig.generateDelayMs) {
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, spineConfig.generateDelayMs),
      );
    }
    const configured = spineConfig.artifacts?.[bookId];
    const artifact =
      configured ??
      (await buildMockSpineArtifact(
        book,
        spineConfig,
        coverDataByBook.get(bookId) ?? MOCK_COVER,
      ));
    spineArtifacts.set(bookId, artifact);
    exposeMockSpine();
    return artifact;
  }

  const STAGE_ORDER: SpineStage[] = ["art", "text", "check"];

  function scheduleQueue() {
    if (queueTimer !== null) return;
    if (queue.paused) return;
    if (queue.currentBookId !== null) return;
    const next = queueJobs.shift();
    if (next === undefined) {
      queue.running = false;
      queue.stage = null;
      emitQueue();
      return;
    }
    queuedIds.delete(next);
    queue.currentBookId = next;
    queue.running = true;
    queue.pending = queueJobs.length;
    runStage(next, 0);
  }

  function runStage(bookId: number, index: number) {
    if (queue.paused) {
      queue.stage = STAGE_ORDER[index];
      emitQueue();
      return;
    }
    queue.stage = STAGE_ORDER[index];
    emitQueue();
    emitProgress({
      bookId,
      stage: STAGE_ORDER[index],
      index: index + 1,
      total: STAGE_ORDER.length,
    });
    queueTimer = window.setTimeout(() => {
      queueTimer = null;
      if (queue.paused) {
        pausedStage = { bookId, index };
        emitQueue();
        return;
      }
      if (index < STAGE_ORDER.length - 1) {
        runStage(bookId, index + 1);
        return;
      }
      void finishQueueJob(bookId);
    }, queueStep);
  }

  async function finishQueueJob(bookId: number) {
    const failed = (spineConfig.failIds ?? []).includes(bookId);
    if (!failed) {
      try {
        await produceSpineArtifact(bookId);
      } catch {
        failedQueueIds.add(bookId);
        queue.failed += 1;
        queue.currentBookId = null;
        queue.stage = null;
        queue.running = false;
        emitQueue();
        scheduleQueue();
        return;
      }
    }
    queue.currentBookId = null;
    queue.stage = null;
    queue.running = false;
    if (failed) {
      failedQueueIds.add(bookId);
      queue.failed += 1;
    } else {
      failedQueueIds.delete(bookId);
      queue.completed += 1;
    }
    emitQueue();
    scheduleQueue();
  }

  function enqueueSpineIds(bookIds: number[]) {
    let changed = false;
    for (const id of bookIds) {
      if (!books.some((book) => book.id === id)) continue;
      if (spineArtifacts.has(id)) continue;
      if (queuedIds.has(id) || queue.currentBookId === id) continue;
      queueJobs.push(id);
      queuedIds.add(id);
      changed = true;
    }
    // The first enqueue is the mock's one-time backfill for this bundle.
    if (queue.backfillPending) {
      queue.backfillPending = false;
      changed = true;
    }
    if (!changed) {
      // Still publish a snapshot: a caller may be waiting for the current job.
      emitQueue();
      return;
    }
    queue.pending = queueJobs.length;
    emitQueue();
    scheduleQueue();
  }

  function setQueuePaused(paused: boolean) {
    pauseCalls.push(paused);
    exposeMockSpine();
    queue.paused = paused;
    emitQueue();
    if (paused) return;
    if (pausedStage) {
      const staged = pausedStage;
      pausedStage = null;
      runStage(staged.bookId, staged.index);
      return;
    }
    scheduleQueue();
  }

  function ensureEnrichment(book: Book): BookEnrichmentState {
    const existing = enrichmentStates.get(book.id);
    if (existing) return existing;
    const hasFile = (enrichmentConfig.fileCoverIds ?? []).includes(book.id);
    const originalSource: CoverSource = hasFile ? "embedded" : "generated";
    const state: BookEnrichmentState = {
      hasFileCover: hasFile,
      fileCoverSource: originalSource,
      coverSource: originalSource,
      coverManual: false,
      descriptionSource: null,
      descriptionUrl: null,
      coverUrl: null,
      hasGap: true,
      attribution: null,
    };
    enrichmentStates.set(book.id, state);
    coverDataByBook.set(book.id, MOCK_COVER);
    originalCoverData.set(book.id, MOCK_COVER);
    fileDescriptions.set(book.id, book.description);
    return state;
  }

  function hasGap(book: Book, state: BookEnrichmentState): boolean {
    const missingDescription = !book.description?.trim();
    const missingCover = !state.coverSource || state.coverSource === "generated";
    return missingDescription || missingCover;
  }

  function changeCover(
    book: Book,
    state: BookEnrichmentState,
    source: CoverSource,
    preview: string,
    manual: boolean,
    sourceUrl: string | null,
  ) {
    state.coverSource = source;
    state.coverManual = manual;
    state.coverUrl = sourceUrl;
    coverDataByBook.set(book.id, preview);
    // A cover change changes the cache key; drop the mock's cached spine so a
    // subsequent enqueue really regenerates it.
    spineArtifacts.delete(book.id);
    exposeMockSpine();
  }

  function applyEnrichmentFields(
    book: Book,
    state: BookEnrichmentState,
    fields: string[],
    attribution: EnrichmentAttribution | null,
  ) {
    if (fields.includes("description") && state.descriptionSource !== "manual") {
      book.description =
        enrichmentConfig.appliedDescription ??
        "A quiet revolution gathers behind the palace doors.";
      state.descriptionSource = "open_library";
      state.descriptionUrl = attribution?.url ?? enrichmentSourceUrl;
    }
    if (fields.includes("cover") && !state.coverManual) {
      changeCover(
        book,
        state,
        "open_library",
        enrichmentConfig.appliedCoverUrl ?? MOCK_ALT_COVER,
        false,
        attribution?.url ?? enrichmentSourceUrl,
      );
    }
    if (attribution) state.attribution = attribution;
  }

  function restoreOriginal(book: Book, state: BookEnrichmentState) {
    state.descriptionSource = null;
    state.descriptionUrl = null;
    state.attribution = null;
    book.description = fileDescriptions.get(book.id) ?? null;
    const source = state.fileCoverSource ?? "generated";
    state.coverSource = source;
    state.coverManual = false;
    state.coverUrl = null;
    coverDataByBook.set(book.id, originalCoverData.get(book.id) ?? MOCK_COVER);
  }
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
      const state = ensureEnrichment(book);
      return {
        ...book,
        coverDataUrl: coverDataByBook.get(id) ?? MOCK_COVER,
        enrichment: { ...state, hasGap: hasGap(book, state) },
      };
    },
    enrichmentSettings: async () => ({
      mode: enrichmentMode,
      sourceLabel: enrichmentSourceLabel,
      sourceUrl: enrichmentSourceUrl,
      batchLimit: enrichmentConfig.batchLimit ?? 20,
    }),
    setEnrichmentMode: async (mode) => {
      if (enrichmentConfig.setModeError) {
        throw enrichmentConfig.setModeError;
      }
      enrichmentMode = mode;
      writeStored(MOCK_ENRICHMENT_KEY, mode);
      return {
        mode,
        sourceLabel: enrichmentSourceLabel,
        sourceUrl: enrichmentSourceUrl,
        batchLimit: enrichmentConfig.batchLimit ?? 20,
      };
    },
    lookupEnrichment: async (bookId, force = false) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      if (enrichmentConfig.lookupDelayMs) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, enrichmentConfig.lookupDelayMs),
        );
      }
      const outcome =
        enrichmentConfig.lookup?.[bookId] ??
        ({ state: "noMatch", source: "open_library", reason: "no_result" } as const);
      if (outcome.state !== "applied") {
        // A forced refresh may be asked again in the same test; the fixture is
        // intentionally stable.
        void force;
        return outcome;
      }
      const state = ensureEnrichment(book);
      const fields = outcome.fields.filter(
        (field) =>
          !(field === "description" && state.descriptionSource === "manual") &&
          !(field === "cover" && state.coverManual),
      );
      if (fields.length === 0) {
        return { state: "noMatch", source: "open_library", reason: "nothing_missing" } as const;
      }
      applyEnrichmentFields(
        book,
        state,
        fields,
        outcome.attribution,
      );
      return { ...outcome, fields };
    },
    acceptEnrichmentCandidate: async (bookId, key) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const outcome = enrichmentConfig.lookup?.[bookId];
      if (outcome?.state !== "needsReview") {
        throw { code: "candidate_expired", message: "That match is no longer available." };
      }
      const candidate = outcome.candidates.find((entry) => entry.key === key);
      if (!candidate) {
        throw { code: "candidate_expired", message: "That match is no longer available." };
      }
      const state = ensureEnrichment(book);
      const fields = [
        ...(book.description ? [] : ["description"]),
        ...(state.coverSource === "generated" ? ["cover"] : []),
      ];
      applyEnrichmentFields(
        book,
        state,
        fields,
        outcome.attribution,
      );
      return {
        state: "applied",
        source: "open_library",
        fields,
        attribution: outcome.attribution,
      } as const;
    },
    cancelEnrichment: async () => {},
    editBlurb: async (bookId, text) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const state = ensureEnrichment(book);
      const cleaned = text?.trim() ? text.trim() : null;
      book.description = cleaned;
      state.descriptionSource = cleaned ? "manual" : null;
      state.descriptionUrl = null;
      books = [...books];
    },
    revertEnrichment: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const state = ensureEnrichment(book);
      if (state.descriptionSource !== "manual") {
        restoreOriginal(book, state);
      }
      books = [...books];
    },
    enrichmentTargets: async (limit) =>
      books
        .filter((book) => hasGap(book, ensureEnrichment(book)))
        .slice(0, limit),
    coverChoices: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const state = ensureEnrichment(book);
      const current = {
        key: "current",
        source: state.coverSource ?? "generated",
        label: "Current cover",
        detail: "The cover shown in the Flip now.",
        previewDataUrl: coverDataByBook.get(bookId) ?? MOCK_COVER,
        isCurrent: true,
        isOriginal: false,
      };
      const originalSource = state.fileCoverSource ?? "generated";
      const original = {
        key: originalSource === "generated" ? "generated" : "original",
        source: originalSource,
        label:
          originalSource === "generated"
            ? "Generated jacket plate"
            : "Cover from this book",
        detail:
          originalSource === "generated"
            ? "The plain jacket used when no cover exists."
            : `The cover ${originalSource} in this book.`,
        previewDataUrl: originalCoverData.get(bookId) ?? MOCK_COVER,
        isCurrent: !state.coverManual && state.coverSource === originalSource,
        isOriginal: true,
      };
      return {
        current,
        original,
        online: enrichmentConfig.cachedCoverCandidates?.[bookId] ?? [],
        sourceLabel: enrichmentSourceLabel,
      };
    },
    lookupCoverCandidates: async (bookId) => {
      if (enrichmentConfig.lookupDelayMs) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, enrichmentConfig.lookupDelayMs),
        );
      }
      const configured = enrichmentConfig.coverLookup?.[bookId];
      if (configured) return configured;
      const candidates = enrichmentConfig.coverCandidates?.[bookId] ?? [];
      if (candidates.length === 0) {
        return { state: "noMatch", source: "open_library", reason: "no_cover" } as const;
      }
      return {
        state: "found",
        candidates,
        attribution: {
          label: enrichmentSourceLabel,
          url: enrichmentSourceUrl,
          fields: ["cover"],
        },
      } as const;
    },
    applyCoverChoice: async (bookId, choice, acknowledged = false) => {
      if (enrichmentConfig.applyError) throw enrichmentConfig.applyError;
      if (choice.warning && !acknowledged) {
        throw {
          code: "cover_needs_acknowledgement",
          message: choice.warning,
        };
      }
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const state = ensureEnrichment(book);
      const source = choice.source as CoverSource;
      const manual = !["embedded", "rendered", "generated"].includes(source);
      changeCover(
        book,
        state,
        source,
        choice.previewDataUrl ??
          originalCoverData.get(bookId) ??
          MOCK_COVER,
        manual,
        choice.sourceUrl ?? null,
      );
      if (manual && source !== "device") {
        state.attribution = {
          label: enrichmentSourceLabel,
          url: choice.sourceUrl ?? enrichmentSourceUrl,
          fields: ["cover"],
        };
      } else if (manual) {
        state.attribution = null;
      }
      books = [...books];
    },
    chooseDeviceCover: async (bookId) => {
      const configured = enrichmentConfig.devicePreview?.[bookId];
      if (configured !== undefined) return configured;
      return {
        token: `device-${bookId}-${nextDeviceToken++}`,
        previewDataUrl: MOCK_ALT_COVER,
        width: 600,
        height: 900,
        warning: null,
      };
    },
    applyDeviceCover: async (bookId, token, acknowledged = false) => {
      if (enrichmentConfig.applyError) throw enrichmentConfig.applyError;
      if (usedDeviceTokens.has(token)) {
        throw {
          code: "cover_token_invalid",
          message: "That cover choice has expired. Choose it again.",
        };
      }
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const preview = enrichmentConfig.devicePreview?.[bookId];
      if (preview?.warning && !acknowledged) {
        throw { code: "cover_needs_acknowledgement", message: preview.warning };
      }
      usedDeviceTokens.add(token);
      const state = ensureEnrichment(book);
      changeCover(
        book,
        state,
        "device",
        preview?.previewDataUrl ?? MOCK_ALT_COVER,
        true,
        null,
      );
      books = [...books];
    },
    resetCover: async (bookId) => {
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book) throw { code: "book_not_found", message: "That book could not be found." };
      const state = ensureEnrichment(book);
      const source = state.fileCoverSource ?? "generated";
      changeCover(
        book,
        state,
        source,
        originalCoverData.get(bookId) ?? MOCK_COVER,
        false,
        null,
      );
      if (
        state.attribution?.fields.every((field) => field === "cover") ??
        false
      ) {
        state.attribution = null;
      }
      books = [...books];
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
      updateConfig.checks = (updateConfig.checks ?? 0) + 1;
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
    spineGenerate: async (bookId) => {
      noteSpineGenerate();
      return produceSpineArtifact(bookId);
    },
    spineArtifact: async (bookId) => {
      const artifact = spineArtifacts.get(bookId);
      return artifact ? { ...artifact } : null;
    },
    spineCachedStrips: async () => {
      noteSpineCachedStrips();
      return [...spineArtifacts.values()].map(
        (artifact): SpineCachedStrip => ({
          bookId: artifact.bookId,
          verdict: artifact.verdict,
          spineDataUrl: artifact.spineDataUrl,
        }),
      );
    },
    spineStatus: async () => {
      noteSpineStatus();
      return {
        models: "ready",
        bundleId: SPINE_BUNDLE_ID,
        bytes: 41_229_063,
        error: null,
        ...spineConfig.status,
      };
    },
    spineEnqueue: async (bookIds) => {
      queuedCalls.push(...bookIds);
      enqueueSpineIds(bookIds);
    },
    spineQueue: async () => queueSnapshot(),
    spinePause: async (paused) => {
      setQueuePaused(paused);
    },
    spineSetStyle: async (bookId, style) => {
      spineStyles.set(bookId, style);
      const book = books.find((candidate) => candidate.id === bookId);
      if (book) {
        book.spineStyle = style;
        books = [...books];
      }
      exposeMockSpine();
    },
    onSpineQueue: async (handler) => {
      queueListeners.add(handler);
      return () => queueListeners.delete(handler);
    },
    onSpineProgress: async (handler) => {
      progressListeners.add(handler);
      return () => progressListeners.delete(handler);
    },
  };

  return traced(base, (method, error) => {
    appendMockLog("error", "command_failed", `${method}: ${errorText(error)}`);
  });
}
