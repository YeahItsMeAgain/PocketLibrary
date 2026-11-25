import { useCallback, useState } from "react";

import {
  isApiError,
  platform,
  type BackupImport,
  type BackupMode,
  type BackupSelection,
} from "../platform";
import { noteFailure } from "../diagnostics";
import { ReportAction } from "../Diagnostics";
import { backupImportNotice, formatBackupSize } from "./backup";

interface BackupSectionProps {
  busy: boolean;
  onLibraryChanged: () => void;
}

export function BackupSection({ busy, onLibraryChanged }: BackupSectionProps) {
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupSelection, setBackupSelection] =
    useState<BackupSelection | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
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
  </section>  );
}
