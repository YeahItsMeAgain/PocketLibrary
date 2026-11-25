import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_DOWNLOAD_NAMING,
  isApiError,
  platform,
  type AppInfo,
  type DiagnosticsSummary,
  type LibraryStatus,
} from "../platform";
import {
  copyDiagnosticsSummary,
  diagnosticsResultNotice,
  formatLogSize,
  noteFailure,
} from "../diagnostics";
import {
  READER_SIZES,
  READER_THEMES,
  loadReaderSettings,
  saveReaderSettings,
  type ReaderTheme,
} from "../reader/settings";
import { BackupSection } from "./BackupSection";
import { downloadNameExample } from "./naming";
import { UpdateSection } from "./UpdateSection";

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

export function SettingsView({
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

        <BackupSection busy={busy} onLibraryChanged={onLibraryChanged} />

        <UpdateSection />

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

