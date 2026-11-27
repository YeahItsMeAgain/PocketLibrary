/**
 * The Tauri adapter: every platform method forwards to an `invoke` command.
 */
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  SPINE_PROGRESS_EVENT,
  SPINE_QUEUE_EVENT,
} from "../spineSpec";
import {
  asArrayBuffer,
  errorText,
  shareOrSaveDiagnostics,
  traced,
  type SavedDiagnostics,
  type SharedDiagnostics,
} from "./shared";
import type {
  Annotation,
  AppInfo,
  BackupExport,
  BackupImport,
  BackupSelection,
  Book,
  BookDetail,
  Bookmark,
  CoverChoices,
  CoverLookupOutcome,
  DeviceCoverPreview,
  DiagnosticsSummary,
  Download,
  DownloadedUpdate,
  EnrichmentOutcome,
  EnrichmentSettings,
  Invoke,
  Label,
  LabelUsage,
  LibraryStatus,
  Platform,
  ReadingState,
  ReadingStatus,
  ScanReport,
  SearchPage,
  Shelf,
  SpineArtifact,
  SpineCachedStrip,
  SpineProgress,
  SpineQueueState,
  SpineStatus,
  UpdateCheck,
  UpdateDownloadEvent,
  UpdateInstallResult,
} from "./types";

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
    enrichmentSettings: () =>
      call<EnrichmentSettings>("enrichment_settings"),
    setEnrichmentMode: (mode) =>
      call<EnrichmentSettings>("set_enrichment_mode", { mode }),
    lookupEnrichment: (bookId, force = false) =>
      call<EnrichmentOutcome>("lookup_enrichment", { bookId, force }),
    acceptEnrichmentCandidate: (bookId, key) =>
      call<EnrichmentOutcome>("accept_enrichment_candidate", { bookId, key }),
    cancelEnrichment: (bookId) =>
      call<void>("cancel_enrichment", { bookId }),
    editBlurb: (bookId, text) =>
      call<void>("edit_blurb", { bookId, text }),
    revertEnrichment: (bookId) =>
      call<void>("revert_enrichment", { bookId }),
    enrichmentTargets: (limit) =>
      call<Book[]>("enrichment_targets", { limit }),
    coverChoices: (bookId) =>
      call<CoverChoices>("cover_choices", { bookId }),
    lookupCoverCandidates: (bookId) =>
      call<CoverLookupOutcome>("lookup_cover_candidates", { bookId }),
    applyCoverChoice: (bookId, choice, acknowledged = false) =>
      call<void>("apply_cover_choice", { bookId, choice, acknowledged }),
    chooseDeviceCover: (bookId) =>
      call<DeviceCoverPreview | null>("choose_device_cover", { bookId }),
    applyDeviceCover: (bookId, token, acknowledged = false) =>
      call<void>("apply_device_cover", { bookId, token, acknowledged }),
    resetCover: (bookId) => call<void>("reset_cover", { bookId }),
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
    spineGenerate: (bookId) =>
      call<SpineArtifact>("spine_generate", { bookId }),
    spineArtifact: (bookId) =>
      call<SpineArtifact | null>("spine_artifact", { bookId }),
    spineCachedStrips: () =>
      call<SpineCachedStrip[]>("spine_cached_strips"),
    spineStatus: () => call<SpineStatus>("spine_status"),
    spineEnqueue: (bookIds) =>
      call<void>("spine_enqueue", { bookIds }),
    spineQueue: () => call<SpineQueueState>("spine_queue"),
    spinePause: (paused) => call<void>("spine_pause", { paused }),
    spineSetStyle: (bookId, style) =>
      call<void>("spine_set_style", { bookId, style }),
    onSpineQueue: (handler) =>
      listen<SpineQueueState>(SPINE_QUEUE_EVENT, (event) =>
        handler(event.payload),
      ),
    onSpineProgress: (handler) =>
      listen<SpineProgress>(SPINE_PROGRESS_EVENT, (event) =>
        handler(event.payload),
      ),
  };
  return traced(base, (method, error) => {
    void call("log_diagnostic", {
      level: "error",
      event: "command_failed",
      message: `${method}: ${errorText(error)}`,
    }).catch(() => {});
  });
}
