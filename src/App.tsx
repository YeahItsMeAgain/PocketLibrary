import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DEFAULT_DOWNLOAD_NAMING,
  isApiError,
  isLibraryUnavailable,
  platform,
  type ApiError,
  type AppInfo,
  type BackupImport,
  type BackupMode,
  type BackupReport,
  type BackupSelection,
  type BookFormat,
  type DiagnosticsSummary,
  type Download,
  type DownloadRequest,
  type LibgenResult,
  type LibraryStatus,
  type ScanIssueReason,
  type ScanReport,
  type SearchPage,
  type SearchQuery,
} from "./platform";
import { useLayerExit } from "./navigation";
import { ReportAction } from "./Diagnostics";
import {
  DIAGNOSTICS_HINT_EVENT,
  copyDiagnosticsSummary,
  diagnosticsResultNotice,
  formatLogSize,
  noteFailure,
} from "./diagnostics";
import {
  READER_SIZES,
  READER_THEMES,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderTheme,
} from "./reader/settings";
import "./App.css";

import { Masthead } from "./shell/Masthead";
import { LibraryWall } from "./library/LibraryWall";

const DRAWER_HINT_KEY = "pocketlibrary.drawerHintSeen";

type View = "library" | "search" | "settings";

const NAV_ITEMS: ReadonlyArray<{ view: View; label: string; note: string }> = [
  { view: "library", label: "Library", note: "The wall" },
  { view: "search", label: "Search", note: "Front desk" },
  { view: "settings", label: "Settings", note: "The study" },
];


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
          <>
            <p className="action-error" role="alert">
              {error}
            </p>
            <ReportAction testId="folder-report" label="Report" />
          </>
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
          <>
            <p className="action-error" role="alert">
              {error}
            </p>
            <ReportAction testId="reconnect-report" label="Report" />
          </>
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
  onLibraryChanged: () => void;
  onBack: () => void;
}

function SettingsView({
  status,
  busy,
  notice,
  shelfCapacity,
  onRescan,
  onChoose,
  onSetCapacity,
  onLibraryChanged,
  onBack,
}: SettingsViewProps) {
  const reachable = status.state === "ready";
  const [draftCapacity, setDraftCapacity] = useState("");
  const [reader, setReader] = useState(() => loadReaderSettings());
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [namingDraft, setNamingDraft] = useState(DEFAULT_DOWNLOAD_NAMING);
  const [namingBusy, setNamingBusy] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);

  useEffect(() => {
    if (shelfCapacity !== null) setDraftCapacity(String(shelfCapacity));
  }, [shelfCapacity]);

  useEffect(() => {
    let alive = true;
    platform
      .getDownloadNaming()
      .then((pattern) => {
        if (!alive) return;
        setNaming(pattern);
        setNamingDraft(pattern);
      })
      .catch(() => {
        if (!alive) return;
        setNaming(DEFAULT_DOWNLOAD_NAMING);
        setNamingDraft(DEFAULT_DOWNLOAD_NAMING);
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveNaming = useCallback(async (pattern: string) => {
    setNamingBusy(true);
    setNamingError(null);
    try {
      const saved = await platform.setDownloadNaming(pattern);
      setNaming(saved);
      setNamingDraft(saved);
    } catch (error) {
      setNamingError(
        isApiError(error)
          ? error.message
          : "That naming pattern could not be saved.",
      );
    } finally {
      setNamingBusy(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    platform
      .appInfo()
      .then((next) => {
        if (alive) setInfo(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const updateReader = useCallback(
    (patch: Partial<typeof reader>) => {
      setReader((current) => {
        const next = { ...current, ...patch };
        saveReaderSettings(next);
        return next;
      });
    },
    [],
  );

  const parsedCapacity = Number(draftCapacity);
  const capacityValid =
    Number.isInteger(parsedCapacity) && parsedCapacity >= 1;
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSelection, setBackupSelection] =
    useState<BackupSelection | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(
    null,
  );
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<string | null>(
    null,
  );

  const refreshDiagnostics = useCallback(async () => {
    try {
      setDiagnostics(await platform.diagnosticsSummary());
    } catch {
      // The size/last-error line is informative; a failure leaves it blank.
    }
  }, []);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const sendDiagnosticsNow = useCallback(async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsNotice(null);
    try {
      const result = await platform.sendDiagnostics();
      setDiagnosticsNotice(diagnosticsResultNotice(result));
      await refreshDiagnostics();
    } catch {
      noteFailure();
      setDiagnosticsNotice(
        "Diagnostics could not be prepared. Please try again.",
      );
    } finally {
      setDiagnosticsBusy(false);
    }
  }, [refreshDiagnostics]);

  const copySummaryNow = useCallback(async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsNotice(null);
    try {
      await copyDiagnosticsSummary();
      setDiagnosticsNotice("Summary copied. Paste it into your message.");
    } catch {
      setDiagnosticsNotice("The summary could not be copied.");
    } finally {
      setDiagnosticsBusy(false);
    }
  }, []);

  const clearLogsNow = useCallback(async () => {
    setDiagnosticsBusy(true);
    setDiagnosticsNotice(null);
    try {
      await platform.clearDiagnostics();
      setDiagnosticsNotice("Logs cleared.");
      await refreshDiagnostics();
    } catch {
      setDiagnosticsNotice("The logs could not be cleared.");
    } finally {
      setDiagnosticsBusy(false);
    }
  }, [refreshDiagnostics]);

  const exportBackupNow = useCallback(async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const written = await platform.exportBackup();
      if (written === null) {
        setBackupNotice("Export cancelled. Nothing was written.");
      } else {
        setBackupNotice(
          `Exported ${written.books} ${written.books === 1 ? "book" : "books"} (${formatBackupSize(written.bytes)}) to ${written.fileName}. Book files were not copied.`,
        );
      }
    } catch (error) {
      noteFailure();
      setBackupError(
        isApiError(error)
          ? error.message
          : "The backup could not be written. Please try again.",
      );
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const chooseBackupNow = useCallback(async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    setBackupSelection(null);
    setConfirmReplace(false);
    try {
      const selection = await platform.previewBackup();
      if (selection === null) {
        setBackupNotice("Import cancelled. Nothing was changed.");
      } else {
        setBackupSelection(selection);
      }
    } catch (error) {
      noteFailure();
      setBackupError(
        isApiError(error)
          ? error.message
          : "That backup could not be read. Choose another file.",
      );
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const applyBackupNow = useCallback(
    async (mode: BackupMode) => {
      if (!backupSelection) return;
      setBackupBusy(true);
      setBackupError(null);
      setBackupNotice(null);
      try {
        const outcome = (await platform.importBackup(
          backupSelection.token,
          mode,
        )) as BackupImport;
        setBackupSelection(null);
        setConfirmReplace(false);
        setBackupNotice(backupImportNotice(outcome));
        onLibraryChanged();
      } catch (error) {
        noteFailure();
        setBackupError(
          isApiError(error)
            ? error.message
            : "The backup could not be restored. Please try again.",
        );
      } finally {
        setBackupBusy(false);
      }
    },
    [backupSelection, onLibraryChanged],
  );

  return (
    <main
      id="library-main"
      className="placeholder settings-main"
      data-testid="settings-view"
    >
      <section className="placeholder-card settings-card">
        <button
          type="button"
          className="settings-back"
          data-testid="settings-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Back to shelf
        </button>
        <p className="kicker">The Keeper's Ledger</p>
        <h2>Settings</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>

        <section className="settings-section" aria-labelledby="settings-library">
          <h3 id="settings-library">Library</h3>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>Library folder</dt>
              <dd data-testid="settings-folder">
                {status.folderName ?? "Not chosen"}
              </dd>
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
            <button
              type="button"
              className="secondary-action"
              onClick={onChoose}
            >
              Change library folder
            </button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-reader">
          <h3 id="settings-reader">Reader defaults</h3>
          <p className="settings-note">
            New and resumed books open with these.
          </p>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>Reading mode</dt>
              <dd className="setting-choice">
                <button
                  type="button"
                  data-testid="settings-reader-paginated"
                  aria-pressed={reader.mode === "paginated"}
                  onClick={() => updateReader({ mode: "paginated" })}
                >
                  Paginated
                </button>
                <button
                  type="button"
                  data-testid="settings-reader-scrolled"
                  aria-pressed={reader.mode === "scrolled"}
                  onClick={() => updateReader({ mode: "scrolled" })}
                >
                  Scroll
                </button>
              </dd>
            </div>
            <div className="setting-row">
              <dt>Theme</dt>
              <dd className="setting-choice">
                {(Object.keys(READER_THEMES) as ReaderTheme[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    data-testid={`settings-reader-theme-${theme}`}
                    aria-pressed={reader.theme === theme}
                    onClick={() => updateReader({ theme })}
                  >
                    {READER_THEMES[theme].name}
                  </button>
                ))}
              </dd>
            </div>
          </dl>
          <fieldset className="settings-size">
            <legend>Text size</legend>
            <div className="size-choices">
              {READER_SIZES.map((size, index) => (
                <button
                  key={size.name}
                  type="button"
                  data-testid={`settings-reader-size-${index}`}
                  aria-pressed={reader.size === index}
                  onClick={() => updateReader({ size: index })}
                >
                  {size.name}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="settings-section" aria-labelledby="settings-shelf">
          <h3 id="settings-shelf">Shelf</h3>
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
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-download"
          data-testid="settings-download"
        >
          <h3 id="settings-download">Download naming</h3>
          <form
            className="capacity-form naming-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!namingBusy) void saveNaming(namingDraft);
            }}
          >
            <label htmlFor="download-naming">Pattern</label>
            <div className="capacity-controls">
              <input
                id="download-naming"
                data-testid="download-naming"
                type="text"
                value={namingDraft}
                maxLength={160}
                spellCheck={false}
                onChange={(event) => setNamingDraft(event.target.value)}
                disabled={namingBusy}
              />
              <button
                type="submit"
                className="secondary-action"
                data-testid="save-download-naming"
                disabled={namingBusy || !namingDraft.trim()}
              >
                Save
              </button>
            </div>
            <div className="naming-reset-row">
              <button
                type="button"
                className="settings-back"
                data-testid="reset-download-naming"
                disabled={namingBusy || naming === DEFAULT_DOWNLOAD_NAMING}
                onClick={() => void saveNaming(DEFAULT_DOWNLOAD_NAMING)}
              >
                Reset to default
              </button>
            </div>
          </form>
          <p className="settings-note">
            Placeholders: <code>{"{author}"}</code>, <code>{"{title}"}</code> and{" "}
            <code>{"{year}"}</code>. Only one placeholder per part; unknown or
            unbalanced braces are rejected. A missing year drops its empty
            brackets, and path separators are sanitised.
          </p>
          <p
            className="settings-value naming-example"
            data-testid="download-naming-example"
          >
            {downloadNameExample(namingDraft)}
          </p>
          <p className="settings-note" data-testid="download-naming-saved">
            {naming
              ? `Saved pattern: ${naming}`
              : "Using the default until the saved pattern loads."}
          </p>
          {namingError ? (
            <p
              className="action-error"
              role="alert"
              data-testid="download-naming-error"
            >
              {namingError}
            </p>
          ) : null}
        </section>

        <section className="settings-section" aria-labelledby="settings-backup">
          <h3 id="settings-backup">Export / import</h3>
          <p className="settings-note">
            One versioned archive holds shelves, labels, reading positions,
            annotations, settings and download history — never the books
            themselves.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-action"
              data-testid="settings-export"
              disabled={busy || backupBusy}
              onClick={() => void exportBackupNow()}
            >
              {backupBusy && backupSelection === null ? "Working…" : "Export library data"}
            </button>
            <button
              type="button"
              className="secondary-action"
              data-testid="settings-import"
              disabled={busy || backupBusy}
              onClick={() => void chooseBackupNow()}
            >
              Import library data
            </button>
          </div>

          {backupSelection ? (
            <div className="backup-panel" data-testid="backup-preview">
              <p className="settings-value" data-testid="backup-file">
                {backupSelection.fileName}
              </p>
              <dl className="backup-counts">
                <div>
                  <dt>Already here</dt>
                  <dd data-testid="backup-preview-matched">
                    {backupSelection.preview.matched}
                  </dd>
                </div>
                <div>
                  <dt>New to this library</dt>
                  <dd data-testid="backup-preview-new">
                    {backupSelection.preview.new}
                  </dd>
                </div>
              </dl>
              <p className="settings-note">
                Merge is the safe default: it adds missing entries, keeps newer
                reading positions and never deletes. Book files stay where they
                are.
              </p>
              {confirmReplace ? (
                <div className="backup-confirm" role="alert">
                  <p>
                    Replace clears this library's shelves, labels, reading
                    state and history, then restores the archive. This cannot
                    be undone. Book files are not moved.
                  </p>
                  <div className="backup-actions">
                    <button
                      type="button"
                      className="danger-action"
                      data-testid="backup-replace-confirm"
                      disabled={backupBusy}
                      onClick={() => void applyBackupNow("replace")}
                    >
                      Yes, replace library data
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      data-testid="backup-replace-cancel"
                      disabled={backupBusy}
                      onClick={() => setConfirmReplace(false)}
                    >
                      Keep current library
                    </button>
                  </div>
                </div>
              ) : (
                <div className="backup-actions">
                  <button
                    type="button"
                    className="primary-action"
                    data-testid="backup-merge"
                    disabled={backupBusy}
                    onClick={() => void applyBackupNow("merge")}
                  >
                    Merge into library
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    data-testid="backup-replace"
                    disabled={backupBusy}
                    onClick={() => setConfirmReplace(true)}
                  >
                    Replace current library data…
                  </button>
                  <button
                    type="button"
                    className="settings-back backup-cancel"
                    data-testid="backup-cancel"
                    disabled={backupBusy}
                    onClick={() => {
                      setBackupSelection(null);
                      setConfirmReplace(false);
                    }}
                  >
                    Cancel import
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {backupError ? (
            <>
              <p className="action-error" role="alert" data-testid="backup-error">
                {backupError}
              </p>
              <ReportAction testId="backup-report" label="Report" />
            </>
          ) : null}
          {backupNotice ? (
            <p className="settings-note backup-notice" role="status" data-testid="backup-notice">
              {backupNotice}
            </p>
          ) : null}
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-help"
          data-testid="settings-help"
        >
          <h3 id="settings-help">Help &amp; diagnostics</h3>
          <p className="settings-note">
            If something goes wrong, send a small report. It holds the app
            version, device, folder names, book titles and recent errors —
            never book contents, passwords or keys. Nothing is sent until you
            choose Send diagnostics.
          </p>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>Log size</dt>
              <dd data-testid="diagnostics-size">
                {diagnostics
                  ? `${formatLogSize(diagnostics.logBytes)} · ${diagnostics.logLines} entries`
                  : "…"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Last error</dt>
              <dd
                className="diagnostics-last-error"
                data-testid="diagnostics-last-error"
              >
                {diagnostics?.lastError
                  ? diagnostics.lastError
                  : "None recorded"}
              </dd>
            </div>
          </dl>
          <div className="settings-actions">
            <button
              type="button"
              className="primary-action"
              data-testid="settings-send-diagnostics"
              disabled={diagnosticsBusy}
              onClick={() => void sendDiagnosticsNow()}
            >
              {diagnosticsBusy ? "Preparing…" : "Send diagnostics"}
            </button>
            <button
              type="button"
              className="secondary-action"
              data-testid="settings-copy-summary"
              disabled={diagnosticsBusy}
              onClick={() => void copySummaryNow()}
            >
              Copy summary
            </button>
            <button
              type="button"
              className="settings-back"
              data-testid="settings-clear-diagnostics"
              disabled={diagnosticsBusy}
              onClick={() => void clearLogsNow()}
            >
              Clear logs
            </button>
          </div>
          {diagnosticsNotice ? (
            <p
              className="settings-note backup-notice"
              role="status"
              data-testid="diagnostics-notice"
            >
              {diagnosticsNotice}
            </p>
          ) : null}
        </section>

        <section className="settings-section" aria-labelledby="settings-about">
          <h3 id="settings-about">About</h3>
          <dl className="settings-list">
            <div className="setting-row">
              <dt>App</dt>
              <dd>{info?.name ?? "PocketLibrary"}</dd>
            </div>
            <div className="setting-row">
              <dt>Version</dt>
              <dd data-testid="settings-version">
                v{info?.appVersion ?? "…"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Schema</dt>
              <dd data-testid="settings-schema">
                {info?.schemaVersion ?? "…"}
              </dd>
            </div>
          </dl>
          <p className="settings-note settings-credits">
            Typefaces: EB Garamond, Literata and Source Serif 4 under the SIL
            Open Font License. Reader engines: foliate-js and PDF.js
            (Apache-2.0). Built with Tauri.
          </p>
        </section>

        {notice ? (
          <p className="scan-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </main>
  );
}

interface SearchForm {
  query: string;
  title: string;
  author: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  format: string;
  publisher: string;
  isbn: string;
  md5: string;
}

const EMPTY_SEARCH_FORM: SearchForm = {
  query: "",
  title: "",
  author: "",
  yearFrom: "",
  yearTo: "",
  language: "",
  format: "",
  publisher: "",
  isbn: "",
  md5: "",
};

const SEARCH_LANGUAGES = [
  "English",
  "French",
  "German",
  "Spanish",
  "Italian",
  "Russian",
  "Portuguese",
] as const;

const SEARCH_FORMATS = ["epub", "pdf"] as const;

/** Pocket Library can only open EPUB and PDF; never coerce another format. */
function supportedBookFormat(extension: string): BookFormat | null {
  const value = extension.trim().toLowerCase();
  return value === "epub" || value === "pdf" ? value : null;
}

function searchYear(value: string): number | null {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : null;
}

function searchQueryFrom(form: SearchForm, page: number): SearchQuery {
  return {
    query: form.query.trim(),
    title: form.title.trim(),
    author: form.author.trim(),
    yearFrom: searchYear(form.yearFrom),
    yearTo: searchYear(form.yearTo),
    language: form.language.trim(),
    format: form.format.trim().toLowerCase(),
    publisher: form.publisher.trim(),
    isbn: form.isbn.trim(),
    md5: form.md5.trim(),
    page,
  };
}

function hasSearchTerm(form: SearchForm): boolean {
  return [form.query, form.title, form.author, form.publisher, form.isbn, form.md5]
    .map((value) => value.trim())
    .some(Boolean);
}

function searchErrorCopy(error: ApiError): { title: string; body: string } {
  switch (error.code) {
    case "offline":
      return {
        title: "The desk is offline",
        body:
          "Libgen search needs a connection. Your shelves, books and reading progress are unaffected.",
      };
    case "all_mirrors_failed":
      return {
        title: "Every mirror refused",
        body:
          "All five Libgen mirrors timed out or refused the request. Wait a moment, then try again.",
      };
    case "mirror_format_changed":
      return {
        title: "The mirror's page changed",
        body:
          "A mirror answered, but its results could not be read. Try another search, or try again later.",
      };
    case "empty_search":
      return {
        title: "Nothing to search for",
        body: "Enter a title, author, ISBN or MD5 first.",
      };
    default:
      return {
        title: "The front desk could not answer",
        body: error.message,
      };
  }
}

function SearchResultRow({
  result,
  onOpen,
}: {
  result: LibgenResult;
  onOpen: () => void;
}) {
  const author = result.authors.join("; ") || "Author unknown";
  return (
    <li>
      <button
        type="button"
        className="search-result"
        data-testid="search-result"
        onClick={onOpen}
      >
        <span className="search-result-title">{result.title}</span>
        <span className="search-result-meta">
          <span>{author}</span>
          <span>{result.year ?? "Year unknown"}</span>
          <span>{result.extension.toUpperCase()}</span>
          <span>{result.sizeText || "Size unknown"}</span>
          <span className="search-result-source">{result.source}</span>
        </span>
      </button>
    </li>
  );
}

function downloadPercent(download: Download): number {
  if (download.state === "completed") return 100;
  if (!download.totalBytes || download.totalBytes <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((download.bytes / download.totalBytes) * 100)),
  );
}

function downloadStatusText(download: Download): string {
  switch (download.state) {
    case "queued":
      return "Queued";
    case "running":
      return download.error ?? `Downloading ${downloadPercent(download)}%`;
    case "completed":
      return download.errorCode === "duplicate"
        ? "Already in your library"
        : "Added to library";
    case "failed":
      return download.error ?? "The download failed.";
    case "cancelled":
      return "Cancelled";
  }
}

function DownloadProgress({ download }: { download: Download }) {
  const percent = downloadPercent(download);
  return (
    <div
      className="download-progress"
      data-testid="download-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Download ${percent}%`}
    >
      <span className="download-progress-fill" style={{ width: `${percent}%` }} />
      <span className="download-progress-label">{percent}%</span>
    </div>
  );
}

function ResultDetail({
  result,
  download,
  onClose,
  onDownload,
  onCancel,
  onRetry,
}: {
  result: LibgenResult;
  download: Download | null;
  onClose: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active =
    download?.state === "queued" || download?.state === "running";
  const supported = supportedBookFormat(result.extension) !== null;
  const close = useLayerExit(true, onClose);
  return (
    <div className="search-sheet-backdrop" onClick={close}>
      <section
        className="search-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Result details"
        data-testid="result-detail"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="search-sheet-head">
          <div>
            <p className="kicker">On the front desk</p>
            <h2>{result.title}</h2>
            <p className="search-sheet-author">
              {result.authors.join("; ") || "Author unknown"}
            </p>
          </div>
          <button
            type="button"
            className="sheet-close"
            data-testid="result-detail-close"
            aria-label="Close result details"
            onClick={close}
          >
            ×
          </button>
        </header>

        <dl className="search-detail-list">
          <div>
            <dt>Year</dt>
            <dd>{result.year ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd>{result.publisher ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{result.language ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{result.pages ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{result.extension.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{result.sizeText || "Unknown"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{result.source}</dd>
          </div>
          <div className="search-detail-md5">
            <dt>MD5</dt>
            <dd>{result.md5}</dd>
          </div>
        </dl>

        <section className="search-mirrors" aria-labelledby="mirror-heading">
          <h3 id="mirror-heading">Mirrors</h3>
          {result.mirrors.length === 0 ? (
            <p className="settings-note">No mirror links were listed.</p>
          ) : (
            <ul>
              {result.mirrors.map((mirror) => (
                <li key={mirror.url} data-testid="mirror-row">
                  <span className="mirror-label">{mirror.label}</span>
                  <span className="mirror-url">{mirror.url}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!supported ? (
          <p
            className="settings-note result-unsupported"
            data-testid="result-unsupported"
          >
            Pocket Library reads EPUB and PDF only. This edition is a{" "}
            {result.extension.toUpperCase()} file, so it cannot be added here.
          </p>
        ) : download ? (
          <div
            className={`result-download-state is-${download.state}`}
            data-testid="result-download-state"
          >
            <p>{downloadStatusText(download)}</p>
            {download.state === "running" || download.state === "queued" ? (
              <DownloadProgress download={download} />
            ) : null}
            {download.errorCode === "duplicate" ? (
              <p className="settings-note">
                The existing copy stays on your shelf; nothing new was added.
              </p>
            ) : null}
            {active ? (
              <button
                type="button"
                className="secondary-action"
                data-testid="result-download-cancel"
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : download.state === "failed" || download.state === "cancelled" ? (
              <>
                <button
                  type="button"
                  className="secondary-action"
                  data-testid="result-download-retry"
                  onClick={onRetry}
                >
                  Retry
                </button>
                {download.state === "failed" ? (
                  <ReportAction
                    testId="download-report"
                    label="Report"
                  />
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="primary-action search-download"
            data-testid="result-download"
            onClick={onDownload}
          >
            Download to library
          </button>
        )}
        <p className="settings-note">
          The file is fetched inside the app, checked for duplicates, named
          “Author - Title (Year)” and placed on the lowest shelf with room.
        </p>
      </section>
    </div>
  );
}

interface SearchViewProps {
  onBack: () => void;
  downloads: Download[];
  onRefreshDownloads: () => Promise<Download[]>;
}

function SearchView({
  onBack,
  downloads,
  onRefreshDownloads,
}: SearchViewProps) {
  const [form, setForm] = useState<SearchForm>(EMPTY_SEARCH_FORM);
  const [advanced, setAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState<SearchQuery | null>(null);
  const [pageData, setPageData] = useState<SearchPage | null>(null);
  const [selected, setSelected] = useState<LibgenResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueOpen, setQueueOpen] = useState(true);

  const update = (field: keyof SearchForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const downloadFor = (result: LibgenResult) =>
    downloads.find(
      (download) => download.md5.toLowerCase() === result.md5.toLowerCase(),
    ) ?? null;

  const enqueue = async (result: LibgenResult) => {
    const format = supportedBookFormat(result.extension);
    if (!format) {
      setError({
        code: "unsupported_format",
        message: `Pocket Library reads EPUB and PDF only. This edition is a ${result.extension.toUpperCase()} file.`,
      });
      return;
    }
    const mirrors = result.mirrors
      .filter((link) => link.url.includes("ads.php"))
      .map((link) => link.url);
    const request: DownloadRequest = {
      md5: result.md5,
      title: result.title,
      authors: result.authors,
      year: result.year,
      format,
      source: result.source,
      mirrorUrls: mirrors.length > 0 ? mirrors : result.mirrors.map((link) => link.url),
    };
    try {
      await platform.enqueueDownload(request);
      await onRefreshDownloads().catch(() => {});
      setQueueOpen(true);
    } catch (rejection) {
      noteFailure();
      setError(
        isApiError(rejection)
          ? rejection
          : {
              code: "unknown",
              message: "The download could not be queued.",
            },
      );
    }
  };

  const cancelDownload = async (download: Download) => {
    try {
      await platform.cancelDownload(download.id);
      await onRefreshDownloads();
    } catch {
      // The next poll corrects the row.
    }
  };

  const retryDownload = async (download: Download) => {
    try {
      await platform.retryDownload(download.id);
      await onRefreshDownloads();
    } catch {
      // The next poll corrects the row.
    }
  };

  const runSearch = useCallback(
    async (query: SearchQuery) => {
      setBusy(true);
      setError(null);
      setSelected(null);
      try {
        const next = await platform.searchLibgen(query);
        setPageData(next);
        setSubmitted(query);
      } catch (rejection) {
        setPageData(null);
        noteFailure();
        setError(
          isApiError(rejection)
            ? rejection
            : {
                code: "unknown",
                message: "The front desk could not be reached.",
              },
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const submit = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!hasSearchTerm(form) || busy) return;
    void runSearch(searchQueryFrom(form, 1));
  };

  const turnPage = (nextPage: number) => {
    if (!submitted || busy || nextPage < 1) return;
    void runSearch({ ...submitted, page: nextPage });
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const canSearch = hasSearchTerm(form) && !busy;
  const total = pageData?.total ?? 0;
  const hasNextPage =
    pageData !== null &&
    (pageData.totalIsExact
      ? pageData.page * pageData.perPage < total
      : pageData.results.length === pageData.perPage);
  const hiddenByFilters =
    pageData !== null && pageData.filtersApplied
      ? Math.max(0, pageData.onPageBeforeFilters - pageData.results.length)
      : 0;
  const showPager =
    pageData !== null && (pageData.page > 1 || hasNextPage);
  const clearFilters = () => {
    if (busy) return;
    const next = { ...form, format: "", language: "", yearFrom: "", yearTo: "" };
    setForm(next);
    if (hasSearchTerm(next)) void runSearch(searchQueryFrom(next, 1));
  };
  const pager = pageData && showPager ? (
    <nav className="search-pager" aria-label="Result pages">
      <button
        type="button"
        className="secondary-action"
        data-testid="search-prev"
        disabled={busy || pageData.page <= 1}
        onClick={() => turnPage(pageData.page - 1)}
      >
        Previous
      </button>
      <span data-testid="search-page">Page {pageData.page}</span>
      <button
        type="button"
        className="secondary-action"
        data-testid="search-next"
        disabled={busy || !hasNextPage}
        onClick={() => turnPage(pageData.page + 1)}
      >
        Next
      </button>
    </nav>
  ) : null;

  return (
    <main
      id="library-main"
      className="search-view search-main"
      data-testid="search-view"
    >
      <section className="search-card">
        <button
          type="button"
          className="settings-back"
          data-testid="search-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Back to shelf
        </button>
        <p className="kicker">The Acquisition Desk</p>
        <h2>Search Libgen</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p className="search-intro">
          Ask the five LG+ mirrors at once. Formats, language and years are
          filtered here, because Libgen ignores those fields.
        </p>

        <form className="search-form" onSubmit={submit}>
          <label className="search-field search-field-wide" htmlFor="search-query">
            <span>Title or author</span>
            <input
              id="search-query"
              data-testid="search-query"
              type="search"
              value={form.query}
              placeholder="e.g. Rock Paper Scissors"
              autoComplete="off"
              onChange={(event) => update("query", event.target.value)}
            />
          </label>

          <button
            type="button"
            className="search-advanced-toggle"
            data-testid="search-advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
          >
            {advanced ? "Hide advanced fields" : "Advanced fields"}
            <span aria-hidden="true">{advanced ? " ▴" : " ▾"}</span>
          </button>

          <div className="search-advanced" hidden={!advanced}>
            <label className="search-field">
              <span>Title</span>
              <input
                data-testid="search-title"
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Author</span>
              <input
                data-testid="search-author"
                value={form.author}
                onChange={(event) => update("author", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year from</span>
              <input
                data-testid="search-year-from"
                inputMode="numeric"
                value={form.yearFrom}
                onChange={(event) => update("yearFrom", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year to</span>
              <input
                data-testid="search-year-to"
                inputMode="numeric"
                value={form.yearTo}
                onChange={(event) => update("yearTo", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Language</span>
              <select
                data-testid="search-language"
                value={form.language}
                onChange={(event) => update("language", event.target.value)}
              >
                <option value="">Any language</option>
                {SEARCH_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Format</span>
              <select
                data-testid="search-format"
                value={form.format}
                onChange={(event) => update("format", event.target.value)}
              >
                <option value="">Any format</option>
                {SEARCH_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Publisher</span>
              <input
                data-testid="search-publisher"
                value={form.publisher}
                onChange={(event) => update("publisher", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>ISBN</span>
              <input
                data-testid="search-isbn"
                inputMode="numeric"
                value={form.isbn}
                onChange={(event) => update("isbn", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>MD5</span>
              <input
                data-testid="search-md5"
                value={form.md5}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => update("md5", event.target.value)}
              />
            </label>
          </div>

          <button
            type="submit"
            className="primary-action search-submit"
            data-testid="search-submit"
            disabled={!canSearch}
          >
            {busy ? "Searching the mirrors…" : "Search"}
          </button>
        </form>

        {error ? (
          <div className="search-state" data-testid="search-error" role="alert">
            <h3>{searchErrorCopy(error).title}</h3>
            <p>{searchErrorCopy(error).body}</p>
            <button
              type="button"
              className="secondary-action"
              data-testid="search-retry"
              onClick={() => submit()}
              disabled={!canSearch}
            >
              Try again
            </button>
            <ReportAction testId="search-report" label="Report" />
          </div>
        ) : null}

        {!error && pageData && pageData.results.length === 0 ? (
          <>
            <div className="search-state" data-testid="search-empty">
              <h3>
                {total === 0 ? "No files found" : "0 matches on this page"}
              </h3>
              <p>
                {total === 0
                  ? "The mirrors answered honestly: nothing matches that search."
                  : hiddenByFilters > 0
                    ? `${hiddenByFilters} of ${pageData.onPageBeforeFilters} files on this page were hidden by your filters.`
                    : pageData.page > 1
                      ? "The mirrors listed more files, but this page arrived empty. Turn back a page."
                      : "The mirrors listed more files, but this page arrived empty."}
              </p>
              {pageData.filtersApplied ? (
                <button
                  type="button"
                  className="secondary-action"
                  data-testid="search-clear-filters"
                  onClick={clearFilters}
                  disabled={busy}
                >
                  Clear format, language and year filters
                </button>
              ) : null}
            </div>
            {pager}
          </>
        ) : null}

        {!error && pageData && pageData.results.length > 0 ? (
          <section className="search-results" aria-labelledby="results-heading">
            <div className="search-summary">
              <h3 id="results-heading">Front desk ledger</h3>
              <p data-testid="search-counts">
                <strong>{total}</strong>{" "}
                {pageData.totalIsExact ? "files" : "or more files"} at Libgen ·{" "}
                {pageData.results.length} shown on this page
                {hiddenByFilters > 0
                  ? ` · ${hiddenByFilters} hidden by your filters`
                  : ""}
                {" · "}
                answered by {pageData.sourceMirror}
              </p>
            </div>
            <ul className="search-list">
              {pageData.results.map((result) => (
                <SearchResultRow
                  key={result.md5}
                  result={result}
                  onOpen={() => setSelected(result)}
                />
              ))}
            </ul>
            {pager}
          </section>
        ) : null}

        {!error && !pageData ? (
          <p className="search-idle">
            The desk is ready. Search by title or author, or open the advanced
            fields for year, language, format, publisher, ISBN and MD5.
          </p>
        ) : null}
      </section>

      {downloads.length > 0 ? (
        <section
          className="download-queue"
          data-testid="download-queue"
          aria-labelledby="download-queue-heading"
        >
          <div className="download-queue-head">
            <h3 id="download-queue-heading">The delivery hatch</h3>
            <span className="download-badge" data-testid="download-badge">
              {downloads.filter(
                (download) =>
                  download.state === "queued" || download.state === "running",
              ).length}{" "}
              active
            </span>
            <button
              type="button"
              className="download-queue-toggle"
              data-testid="download-queue-toggle"
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen((open) => !open)}
            >
              {queueOpen ? "Hide" : "Show"}
            </button>
          </div>
          {queueOpen ? (
            <ul className="download-queue-list">
              {downloads.map((download) => (
                <li
                  key={download.id}
                  className={`download-row is-${download.state}`}
                  data-testid="download-row"
                >
                  <div className="download-row-main">
                    <span className="download-row-title">
                      {download.title}
                    </span>
                    <span
                      className="download-row-status"
                      data-testid="download-status"
                    >
                      {downloadStatusText(download)}
                    </span>
                    {download.state === "running" ? (
                      <DownloadProgress download={download} />
                    ) : null}
                  </div>
                  {download.state === "queued" ||
                  download.state === "running" ? (
                    <button
                      type="button"
                      className="download-cancel"
                      data-testid="download-cancel"
                      onClick={() => void cancelDownload(download)}
                    >
                      Cancel
                    </button>
                  ) : download.state === "failed" ||
                    download.state === "cancelled" ? (
                    <>
                      <button
                        type="button"
                        className="download-retry"
                        data-testid="download-retry"
                        onClick={() => void retryDownload(download)}
                      >
                        Retry
                      </button>
                      {download.state === "failed" ? (
                        <ReportAction
                          testId="download-queue-report"
                          label="Report"
                          className="download-report"
                        />
                      ) : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {selected ? (
        <ResultDetail
          result={selected}
          download={downloadFor(selected)}
          onClose={() => setSelected(null)}
          onDownload={() => void enqueue(selected)}
          onCancel={() => {
            const download = downloadFor(selected);
            if (download) void cancelDownload(download);
          }}
          onRetry={() => {
            const download = downloadFor(selected);
            if (download) void retryDownload(download);
          }}
        />
      ) : null}
    </main>
  );
}

function AppInfoFooter({ hidden = false }: { hidden?: boolean }) {
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
    <footer
      className={`app-info${hidden ? " app-info-hidden" : ""}`}
      data-testid="app-info"
      aria-live="polite"
      aria-hidden={hidden || undefined}
    >
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

function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupReportNotice(report: BackupReport): string {
  if (report.mode === "replace") {
    const cleared =
      report.replaced === 1
        ? "1 previous book cleared"
        : `${report.replaced} previous books cleared`;
    return `Library data replaced: ${report.new} new, ${report.matched} matched, ${cleared}. No book files were moved.`;
  }
  const skipped =
    report.skipped > 0
      ? `, ${report.skipped} newer reading position${report.skipped === 1 ? "" : "s"} kept`
      : "";
  return `Merge complete: ${report.new} new, ${report.matched} matched${skipped}. Nothing was deleted.`;
}

function backupImportNotice(outcome: BackupImport): string {
  const summary = backupReportNotice(outcome.report);
  if (outcome.scanError) {
    return `${summary} Rescan after import could not run: ${outcome.scanError}`;
  }
  if (!outcome.scan) return summary;
  const linked =
    outcome.scan.relinked > 0
      ? outcome.scan.relinked === 1
        ? "1 imported book linked to its file"
        : `${outcome.scan.relinked} imported books linked to their files`
      : null;
  const details = [
    linked,
    outcome.scan.added > 0
      ? `${outcome.scan.added} new book${outcome.scan.added === 1 ? "" : "s"} found`
      : null,
    outcome.scan.removed > 0
      ? `${outcome.scan.removed} missing book${outcome.scan.removed === 1 ? "" : "s"} marked finished`
      : null,
  ].filter(Boolean);
  const result =
    details.length > 0
      ? details.join(", ")
      : `${outcome.scan.total} books on the shelves`;
  return `${summary} Rescan after import: ${result}.`;
}

function downloadNameExample(pattern: string): string {
  const author = "Ursula K. Le Guin";
  const title = "The Left Hand of Darkness";
  const year = "1969";
  const stem = pattern.replace(
    /\{(author|title|year)\}/g,
    (_match, token: string) =>
      token === "author" ? author : token === "title" ? title : year,
  );
  const cleaned = stem
    .replace("()", "")
    .replace("[]", "")
    .replace("{}", "")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned || "Untitled"}.epub`;
}

function scanNotice(report: ScanReport): string {
  const added = report.added === 1 ? "1 new book" : `${report.added} new books`;
  const relinked =
    report.relinked > 0
      ? report.relinked === 1
        ? "1 book linked to its file"
        : `${report.relinked} books linked to their files`
      : null;
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
  return [`Scan complete: ${report.total} books`, relinked, added, removed, duplicates, skipped]
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
    if (!isLibraryUnavailable(error)) noteFailure();
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
  const [noticeFailed, setNoticeFailed] = useState(false);
  const [diagnosticsHint, setDiagnosticsHint] = useState(false);
  const [shelfCapacity, setShelfCapacity] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusBookId, setFocusBookId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOffset, setDrawerOffset] = useState<number | null>(null);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerOpening, setDrawerOpening] = useState(false);
  const [showDrawerHint, setShowDrawerHint] = useState(false);
  const pullRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const drawerDragRef = useRef<{
    fromOpen: boolean;
    opened: boolean;
    y0: number;
    t0: number;
    height: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressRailRef = useRef(0);
  const lastHandleGestureRef = useRef(0);
  const drawerOpenedAtRef = useRef(0);
  const drawerTrackingRef = useRef(false);

  const openDrawer = useCallback((animate = false) => {
    setShowDrawerHint(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpen(true);
    // Only a genuine tap replays the rail entrance. Drags and snap-backs
    // already track the finger, so animating them would flicker.
    setDrawerOpening(animate);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
    drawerOpenedAtRef.current = performance.now();
  }, []);

  const dismissDrawerHint = useCallback(() => {
    setShowDrawerHint(false);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
  }, []);

  const closeView = useLayerExit(
    view !== "library",
    useCallback(() => setView("library"), []),
  );

  const closeDrawer = useLayerExit(drawerOpen, () => {
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpening(false);
    pullRef.current?.focus();
  });

  useEffect(() => {
    const showHint = () => setDiagnosticsHint(true);
    window.addEventListener(DIAGNOSTICS_HINT_EVENT, showHint);
    return () => window.removeEventListener(DIAGNOSTICS_HINT_EVENT, showHint);
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(DRAWER_HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    const show = window.setTimeout(() => {
      setShowDrawerHint(true);
      // The hint is one-time: mark it as seen as soon as it appears, so a
      // dismissal or a reload never brings it back.
      try {
        window.localStorage.setItem(DRAWER_HINT_KEY, "1");
      } catch {
        // A private WebView may refuse storage; the hint simply returns.
      }
    }, 900);
    const hide = window.setTimeout(() => setShowDrawerHint(false), 7100);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    if (!showDrawerHint) return;
    const dismiss = () => dismissDrawerHint();
    window.addEventListener("pointerdown", dismiss, { passive: true });
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [showDrawerHint, dismissDrawerHint]);

  function startDrawerDrag(fromOpen: boolean, event: ReactPointerEvent) {
    if (fromOpen && !drawerOpen) return;
    if (!fromOpen && drawerOpen) return;
    if (fromOpen && (event.target as HTMLElement).closest("button")) return;
    const rail = railRef.current;
    const height = rail?.offsetHeight || 208;
    dismissDrawerHint();
    drawerDragRef.current = {
      fromOpen,
      opened: fromOpen,
      y0: event.clientY,
      t0: performance.now(),
      height,
      y: fromOpen ? 0 : height,
      moved: false,
    };
    setDrawerOpening(false);
    setDrawerDragging(true);
    setDrawerOffset(fromOpen ? 0 : height);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners still work.
    }
    if (!(event.target as HTMLElement).closest("button")) {
      event.preventDefault();
    }
    trackDrawerDrag();
  }

  // Attach the move/end listeners in the same turn as pointerdown. Waiting
  // for a React effect would drop the first few pixels of a quick drag.
  function trackDrawerDrag() {
    if (drawerTrackingRef.current) return;
    drawerTrackingRef.current = true;
    const onMove = (event: PointerEvent) => {
      const drag = drawerDragRef.current;
      if (!drag) return;
      const dy = event.clientY - drag.y0;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (!drag.fromOpen && !drag.opened && drag.moved) {
        // Mount the rail on the first real movement, not on pointerdown, so a
        // tap has one render path: the animated open on pointerup.
        drag.opened = true;
        setDrawerOpen(true);
        drawerOpenedAtRef.current = performance.now();
      }
      const y = drag.fromOpen
        ? Math.max(0, Math.min(drag.height, dy))
        : Math.max(0, Math.min(drag.height, drag.height + dy));
      drag.y = y;
      setDrawerOffset(y);
      if (event.cancelable) event.preventDefault();
    };
    const onEnd = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      drawerTrackingRef.current = false;
      const drag = drawerDragRef.current;
      drawerDragRef.current = null;
      setDrawerDragging(false);
      if (!drag) return;
      const dy = (event.clientY ?? drag.y0) - drag.y0;
      const dt = Math.max(1, performance.now() - drag.t0);
      const velocity = dy / dt;
      if (!drag.fromOpen) lastHandleGestureRef.current = performance.now();
      if (drag.moved && drag.fromOpen) {
        suppressRailRef.current = performance.now() + 500;
      }
      let shouldOpen: boolean;
      if (drag.fromOpen) {
        shouldOpen = !(drag.y > drag.height * 0.25 || velocity > 0.45);
      } else {
        shouldOpen =
          drag.y < drag.height * 0.55 || velocity < -0.45;
        if (!drag.moved && dt < 420) shouldOpen = true;
      }
      if (shouldOpen) openDrawer(!drag.fromOpen && !drag.moved);
      else closeDrawer();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  const navigate = useCallback((next: View) => {
    // Let the view's layer take over before the drawer's layer leaves, so the
    // guard history entry is replaced rather than popped and re-pushed.
    setView(next);
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpening(false);
  }, []);

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

  const announcedDownloads = useRef(new Set<number>());
  const failedDownloads = useRef(new Set<number>());
  const refreshDownloads = useCallback(async () => {
    const rows = await platform.listDownloads();
    setDownloads(rows);
    return rows;
  }, []);
  useEffect(() => {
    // The one download poller. Search reads the same rows, so leaving it
    // cannot lose progress, and completions still refresh and focus the wall.
    let alive = true;
    let initialized = false;
    const check = async () => {
      let rows: Download[];
      try {
        rows = await refreshDownloads();
      } catch {
        // The queue is advisory here; the next tick retries.
        return;
      }
      if (!alive) return;
      if (!initialized) {
        initialized = true;
        for (const row of rows) {
          announcedDownloads.current.add(row.id);
          if (row.state === "failed") failedDownloads.current.add(row.id);
        }
        return;
      }
      for (const row of rows) {
        if (row.state === "failed" && !failedDownloads.current.has(row.id)) {
          failedDownloads.current.add(row.id);
          noteFailure();
        }
      }
      const fresh = rows.filter(
        (row) =>
          row.state === "completed" &&
          row.bookId !== null &&
          !announcedDownloads.current.has(row.id),
      );
      for (const row of fresh) {
        announcedDownloads.current.add(row.id);
      }
      if (fresh.length > 0) {
        setFocusBookId(fresh[0].bookId);
        setReloadKey((key) => key + 1);
      }
    };
    void check();
    const timer = window.setInterval(check, 450);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshDownloads]);

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
    setNoticeFailed(false);
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
      noteFailure();
      setActionError("The folder picker could not be opened. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const rescan = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setNoticeFailed(false);
    try {
      const outcome = await runScan();
      if (outcome.kind === "report") {
        setNotice(scanNotice(outcome.report));
        setReloadKey((key) => key + 1);
      } else if (outcome.kind === "unavailable") {
        setStatus((current) => (current ? disconnected(current) : current));
        setNotice(null);
      } else {
        setNoticeFailed(true);
        setNotice("The scan could not be completed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const saveCapacity = useCallback(async (capacity: number) => {
    setBusy(true);
    setNotice(null);
    setNoticeFailed(false);
    try {
      const applied = await platform.setShelfCapacity(capacity);
      setShelfCapacity(applied);
      setReloadKey((key) => key + 1);
      setNotice(`Shelf capacity set to ${applied}.`);
    } catch (error) {
      noteFailure();
      setNoticeFailed(true);
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
  }, [drawerOpen]);

  function renderMain() {
    if (view === "search") {
      return (
        <SearchView
          onBack={closeView}
          downloads={downloads}
          onRefreshDownloads={refreshDownloads}
        />
      );
    }
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
          onLibraryChanged={() => setReloadKey((key) => key + 1)}
          onBack={closeView}
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
            <ReportAction testId="library-state-report" label="Report" />
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
        focusBookId={focusBookId}
        notice={notice}
        noticeFailed={noticeFailed}
        onAddBooks={chooseFolder}
        onFindBook={() => setView("search")}
      />
    );
  }

  const libraryReady = view === "library" && status?.state === "ready";
  return (
    <div className={`room v4-room${drawerOpen ? " is-drawer-open" : ""}`}>
      {!libraryReady ? <Masthead /> : null}
      <AppInfoFooter hidden={view !== "settings"} />

      {diagnosticsHint ? (
        <div
          className="diagnostics-hint"
          role="status"
          data-testid="diagnostics-hint"
        >
          <p>
            A few things have stumbled. A short diagnostics report can help
            put them right.
          </p>
          <button
            type="button"
            className="secondary-action"
            data-testid="diagnostics-hint-open"
            onClick={() => {
              setDiagnosticsHint(false);
              navigate("settings");
            }}
          >
            Help &amp; diagnostics
          </button>
          <button
            type="button"
            className="diagnostics-hint-close"
            aria-label="Dismiss diagnostics hint"
            data-testid="diagnostics-hint-dismiss"
            onClick={() => setDiagnosticsHint(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {renderMain()}

      <div
        className="edge-zone"
        aria-hidden="true"
        onPointerDown={(event) => startDrawerDrag(false, event)}
      />
      <button
        ref={pullRef}
        type="button"
        className="drawer-pull"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="navigation-drawer"
        onPointerDown={(event) => startDrawerDrag(false, event)}
        onClick={() => {
          if (performance.now() - lastHandleGestureRef.current < 500) return;
          if (drawerOpen) closeDrawer();
          else openDrawer(true);
        }}
      >
        <span className="pull-slot" aria-hidden="true" />
      </button>

      {showDrawerHint && !drawerOpen ? (
        <p className="drawer-hint show" role="status">
          <span className="up" aria-hidden="true">↑</span> Swipe up to open the drawer
        </p>
      ) : null}

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close navigation"
            onClick={() => closeDrawer()}
          />
          <div id="navigation-drawer" className="drawer is-open">
            <div
              ref={railRef}
              className={`drawer-rail${drawerDragging ? " is-dragging" : ""}${drawerOpening ? " is-opening" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="drawer-title"
              style={
                drawerOffset !== null
                  ? { transform: `translate3d(0, ${drawerOffset}px, 0)` }
                  : undefined
              }
              onPointerDown={(event) => startDrawerDrag(true, event)}
              onAnimationEnd={(event) => {
                if (event.animationName === "drawer-rail-in") {
                  setDrawerOpening(false);
                }
              }}
              onClickCapture={(event) => {
                if (performance.now() < suppressRailRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <h2 id="drawer-title" className="visually-hidden">
                Navigation
              </h2>
              <div className="drawer-grip" aria-hidden="true" />
              <p className="drawer-cap">The Household Catalogue</p>
              <div className="drawer-items">
                {NAV_ITEMS.map((item, index) => (
                  <button
                    key={item.view}
                    ref={index === 0 ? firstItemRef : undefined}
                    type="button"
                    className="drawer-item"
                    aria-current={view === item.view ? "page" : undefined}
                    onClick={() => navigate(item.view)}
                  >
                    <svg
                      width="25"
                      height="25"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      {item.view === "library" ? (
                        <>
                          <path d="M4 4.5h3v15H4zM9 6h3v13.5H9zM14 3.5l3 .8-4 14.8-3-.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                          <path d="M3 20.5h18" stroke="currentColor" strokeWidth="1.2" />
                        </>
                      ) : item.view === "search" ? (
                        <>
                          <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M12 3.2v2M12 18.8v2M20.8 12h-2M5.2 12h-2M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4M18.2 18.2l-1.4-1.4M7.2 7.2L5.8 5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                    <b>{item.label}</b>
                    <span aria-hidden="true">{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="drawer-foot">Tap outside or swipe down to close</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
