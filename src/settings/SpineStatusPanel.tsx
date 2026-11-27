import { useCallback, useEffect, useMemo, useState } from "react";

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

function bookNoun(count: number) {
  return `book${count === 1 ? "" : "s"}`;
}

function summaryText(diagnostics: SpineDiagnostics | null) {
  if (!diagnostics) return "Reading the shelf projection…";
  if (diagnostics.books.length === 0) return "No books on the shelf yet";
  return `${diagnostics.paintable} of ${diagnostics.books.length} ${bookNoun(
    diagnostics.books.length,
  )} can paint spine art · ${diagnostics.artifactsPresent} artifact${
    diagnostics.artifactsPresent === 1 ? "" : "s"
  } on disk`;
}

/** The one-line reason shown for a book that cannot show art. */
function attentionReason(
  book: SpineDiagnostics["books"][number],
  failure: SpineDiagnostics["queue"]["attention"][number] | undefined,
) {
  if (failure) {
    const prefix = `${failure.code}: `;
    const message = failure.error.startsWith(prefix)
      ? failure.error.slice(prefix.length)
      : failure.error;
    return message.charAt(0).toUpperCase() + message.slice(1);
  }
  if (!book.coverPresent) {
    return "No cover was found for this book, so it keeps its cloth spine.";
  }
  if (book.shelfReason) {
    return "The quality check rejected this spine, so it keeps its cloth spine.";
  }
  return "This spine needs another try.";
}

/**
 * A calm status card for the automatic spine queue: engine state, how many
 * books can show art, and only the books that need attention. The full
 * per-book report stays one disclosure away for support.
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

  const status = diagnostics?.status;
  const queue = diagnostics?.queue;

  const failureById = useMemo(
    () =>
      new Map(
        (queue?.attention ?? []).map((failure) => [failure.bookId, failure]),
      ),
    [queue],
  );

  const attention = useMemo(
    () =>
      (diagnostics?.books ?? [])
        .filter(
          (book) =>
            failureById.has(book.bookId) ||
            Boolean(book.shelfReason) ||
            (!book.coverPresent && !book.shelfStripPresent),
        )
        .map((book) => ({
          book,
          reason: attentionReason(book, failureById.get(book.bookId)),
        })),
    [diagnostics, failureById],
  );

  const retry = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      setBusy(true);
      setNotice(null);
      try {
        await platform.spineRetry(ids);
        setNotice(`Queued ${ids.length} ${bookNoun(ids.length)} again.`);
        await refresh();
      } catch {
        setNotice("The books could not be queued again. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const retryAll = useCallback(async () => {
    if (!diagnostics) return;
    const failed = diagnostics.queue.attention.map((failure) => failure.bookId);
    const ids =
      failed.length > 0
        ? failed
        : diagnostics.books
            .filter((book) => !book.shelfStripPresent)
            .map((book) => book.bookId);
    await retry(ids);
  }, [diagnostics, retry]);

  const queueBits: string[] = [];
  if (queue) {
    if (attention.length > 0) {
      queueBits.push(`${attention.length} ${bookNoun(attention.length)} needing attention`);
    }
    if (queue.pending > 0) {
      queueBits.push(
        `${queue.pending} ${bookNoun(queue.pending)} waiting to be prepared`,
      );
    } else if (queue.running || queue.currentBookId !== null) {
      queueBits.push("Preparing spine art now");
    }
    if (queue.paused && queue.pending > 0) {
      queueBits.unshift("Preparation paused");
    }
  }
  const queueLine = queueBits.join(" · ");
  const hasAttention = attention.length > 0;

  return (
    <section
      className="settings-section spine-status"
      aria-labelledby="settings-spine-status"
      data-testid="settings-spine-status"
      data-state={hasAttention ? "attention" : "calm"}
    >
      <h3 id="settings-spine-status">Spine engine</h3>

      <p className="spine-status-lead">
        {diagnostics && status ? (
          <>
            <span
              className="spine-status-engine"
              data-testid="settings-spine-engine"
            >
              {MODEL_LABELS[status.models]}
            </span>
            <span className="spine-status-sep" aria-hidden="true">
              {" · "}
            </span>
          </>
        ) : null}
        <span className="spine-status-count" data-testid="settings-spine-summary">
          {summaryText(diagnostics)}
        </span>
      </p>

      {queueLine ? (
        <p className="spine-status-queue" data-testid="settings-spine-queue">
          {queueLine}
        </p>
      ) : null}

      {hasAttention ? (
        <ul className="spine-attention" aria-label="Books needing attention">
          {attention.map(({ book, reason }) => (
            <li
              key={book.bookId}
              className="spine-attention-item"
              data-testid="spine-attention-item"
              data-book-id={book.bookId}
            >
              <div className="spine-attention-head">
                <p className="spine-attention-title" title={book.title}>
                  {book.title}
                </p>
                <button
                  type="button"
                  className="spine-attention-retry"
                  data-testid="spine-attention-retry"
                  disabled={busy}
                  onClick={() => void retry([book.bookId])}
                >
                  Retry
                </button>
              </div>
              <p className="spine-attention-reason" title={reason}>
                {reason}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="spine-status-actions">
        {hasAttention ? (
          <button
            type="button"
            className="secondary-action spine-retry-all"
            data-testid="settings-spine-retry-all"
            disabled={busy || !diagnostics}
            onClick={() => void retryAll()}
          >
            {busy ? "Queueing…" : "Retry all"}
          </button>
        ) : null}
        <button
          type="button"
          className="settings-back spine-refresh"
          data-testid="settings-spine-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {notice ? (
        <p
          className="settings-note backup-notice spine-status-notice"
          role="status"
          data-testid="settings-spine-notice"
        >
          {notice}
        </p>
      ) : null}

      <details className="spine-disclosure spine-status-books">
        <summary data-testid="settings-spine-books-toggle">
          <span>All books · details</span>
          <span className="spine-disclosure-count" aria-hidden="true">
            {diagnostics?.books.length ?? 0}
          </span>
        </summary>
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
                          ? book.spineStyle === "cloth"
                            ? "Suppressed by Cloth style · change in Edit → Spine"
                            : "Suppressed by Cloth style"
                          : (book.shelfReason ?? "Missing")}
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
      </details>

      <details className="spine-disclosure spine-status-help">
        <summary data-testid="settings-spine-help-toggle">
          <span>What these checks mean</span>
        </summary>
        <div className="spine-disclosure-body">
          <p className="settings-note">
            <b>Shelf strip</b> is the only column that means the wall can paint
            art. An artifact on disk may still be a quality-gate fallback or
            unreadable. Failures stay listed until retried, and every attempt is
            also written to <code>spine/spine.log</code>.
          </p>
          <dl className="spine-status-meta">
            <div>
              <dt>Engine</dt>
              <dd>{status ? MODEL_LABELS[status.models] : "Reading…"}</dd>
            </div>
            <div>
              <dt>Bundle</dt>
              <dd data-testid="settings-spine-bundle">
                {status?.bundleId ?? "…"}
              </dd>
            </div>
            <div>
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
            {status?.error ? (
              <div>
                <dt>Engine error</dt>
                <dd data-testid="settings-spine-error">{status.error}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </details>
    </section>
  );
}
