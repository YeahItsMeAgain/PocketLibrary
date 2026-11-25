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
  type AppInfo,
  type BackupImport,
  type BackupMode,
  type BackupReport,
  type BackupSelection,
  type DiagnosticsSummary,
  type Download,
  type LibraryStatus,
  type ScanIssueReason,
  type ScanReport,
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
import { SearchView } from "./search/SearchView";

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
