import { useCallback, useEffect, useState } from "react";

import { platform, type SpineDiagnostics } from "../platform";
import "./SpineStatusPanel.css";

const MODEL_LABELS: Record<
  SpineDiagnostics["status"]["models"],
  string
> = {
  ready: "Engine ready",
  bundled: "Engine bundled in this build",
  missing: "Models missing",
  error: "Engine error",
};

/**
 * Read-only spine diagnostics. This is deliberately a report, not a repair:
 * it shows the engine, the queue and every book's cover/artifact/last error so
 * a user can tell us why generation is not running.
 */
export function SpineStatusPanel() {
  const [diagnostics, setDiagnostics] = useState<SpineDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDiagnostics(await platform.spineDiagnostics());
    } catch {
      // The panel still renders the unreadable state; the diagnostics export
      // carries the detailed command failure.
      setDiagnostics(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retryAll = useCallback(async () => {
    if (!diagnostics) return;
    const failed = diagnostics.queue.attention.map((failure) => failure.bookId);
    const ids =
      failed.length > 0
        ? failed
        : diagnostics.books
            .filter((book) => !book.shelfStripPresent)
            .map((book) => book.bookId);
    if (ids.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await platform.spineRetry(ids);
      setNotice(`Queued ${ids.length} book${ids.length === 1 ? "" : "s"} again.`);
      await refresh();
    } catch {
      setNotice("The books could not be queued again. Try again.");
    } finally {
      setBusy(false);
    }
  }, [diagnostics, refresh]);

  const status = diagnostics?.status;
  const queue = diagnostics?.queue;

  return (
    <section
      className="settings-section spine-status"
      aria-labelledby="settings-spine-status"
      data-testid="settings-spine-status"
    >
      <h3 id="settings-spine-status">Spine engine</h3>
      <p className="settings-note">
        A read-only report for the automatic spine queue. <b>Shelf strip</b> is
        the only column that means the wall can paint art; an artifact on disk
        may still be a quality-gate fallback or unreadable. Failures stay here
        until retried, and every attempt is also written to{" "}
        <code>spine/spine.log</code>.
      </p>
      <p className="settings-note" data-testid="settings-spine-summary">
        {diagnostics
          ? `${diagnostics.paintable} of ${diagnostics.books.length} book${
              diagnostics.books.length === 1 ? "" : "s"
            } can paint spine art · ${diagnostics.artifactsPresent} artifact${
              diagnostics.artifactsPresent === 1 ? "" : "s"
            } on disk`
          : "Reading the shelf projection…"}
      </p>
      <dl className="settings-list">
        <div className="setting-row">
          <dt>Engine</dt>
          <dd data-testid="settings-spine-engine">
            {status ? MODEL_LABELS[status.models] : "Reading…"}
          </dd>
        </div>
        <div className="setting-row">
          <dt>Bundle</dt>
          <dd data-testid="settings-spine-bundle">{status?.bundleId ?? "…"}</dd>
        </div>
        <div className="setting-row">
          <dt>Model path</dt>
          <dd data-testid="settings-spine-model-path">
            {status?.modelPath ?? "Not resolved"}
            {status ? (
              <span className="spine-status-present">
                {status.modelPresent ? " · present" : " · not found"}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="setting-row">
          <dt>Queue</dt>
          <dd data-testid="settings-spine-queue">
            {queue
              ? `${queue.pending} pending · ${queue.failed} needing attention · ${queue.completed} ready`
              : "…"}
          </dd>
        </div>
      </dl>
      {status?.error ? (
        <p className="settings-note" data-testid="settings-spine-error">
          {status.error}
        </p>
      ) : null}

      <div className="settings-actions">
        <button
          type="button"
          className="secondary-action"
          data-testid="settings-spine-retry-all"
          disabled={busy || !diagnostics}
          onClick={() => void retryAll()}
        >
          {busy ? "Queueing…" : "Retry all"}
        </button>
        <button
          type="button"
          className="settings-back"
          data-testid="settings-spine-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
      {notice ? (
        <p
          className="settings-note backup-notice"
          role="status"
          data-testid="settings-spine-notice"
        >
          {notice}
        </p>
      ) : null}

      {diagnostics?.books.some(
        (book) => book.shelfStripPresent && !book.paintsArt,
      ) ? (
        <p className="settings-note" data-testid="settings-spine-cloth-note">
          A book whose stored style is Cloth deliberately hides its art. Change
          it in Edit → Spine if you want the art spine on the wall.
        </p>
      ) : null}

      <div className="spine-status-table-wrap">
        <table className="spine-status-table" data-testid="spine-status-table">
          <thead>
            <tr>
              <th scope="col">Book</th>
              <th scope="col">Cover</th>
              <th scope="col">Artifact</th>
              <th scope="col">Shelf strip</th>
              <th scope="col">Verdict</th>
              <th scope="col">Last error</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics?.books.length ? (
              diagnostics.books.map((book) => (
                <tr key={book.bookId} data-testid="spine-status-row">
                  <td>{book.title}</td>
                  <td>{book.coverPresent ? "Present" : "Missing"}</td>
                  <td>{book.artifactPresent ? "Present" : "Missing"}</td>
                  <td data-testid="spine-status-shelf">
                    {book.paintsArt
                      ? "Paints art"
                      : book.shelfStripPresent
                        ? "Suppressed by Cloth style"
                        : book.shelfReason ?? "Missing"}
                  </td>
                  <td>{book.verdict ?? "—"}</td>
                  <td>{book.lastError ?? "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No books reported.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
