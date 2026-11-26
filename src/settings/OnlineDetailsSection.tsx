import { useCallback, useEffect, useRef, useState } from "react";

import {
  isApiError,
  platform,
  type Book,
  type EnrichmentMode,
  type EnrichmentSettings,
} from "../platform";

const MODE_COPY: Record<EnrichmentMode, { title: string; detail: string }> = {
  off: {
    title: "Off",
    detail: "Nothing is looked up automatically. A per-book lookup still works when you press it.",
  },
  ask: {
    title: "Ask",
    detail: "The Flip offers Look up details. Nothing leaves the device until you press it.",
  },
  automatic: {
    title: "Automatic",
    detail: "A book with a missing blurb or cover is looked up when its Flip opens.",
  },
};

export function OnlineDetailsSection() {
  const [settings, setSettings] = useState<EnrichmentSettings | null>(null);
  const [targets, setTargets] = useState<Book[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [applied, setApplied] = useState(0);
  const cancelled = useRef(false);
  const currentBook = useRef<number | null>(null);
  const alive = useRef(true);

  const refreshTargets = useCallback(async (limit: number) => {
    try {
      const next = await platform.enrichmentTargets(limit);
      if (alive.current) setTargets(next);
    } catch {
      if (alive.current) setTargets([]);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    let mounted = true;
    platform
      .enrichmentSettings()
      .then(async (loaded) => {
        if (!mounted) return;
        setSettings(loaded);
        await refreshTargets(loaded.batchLimit);
      })
      .catch(() => {
        if (!mounted) return;
        setSettings({
          mode: "off",
          sourceLabel: "Open Library",
          sourceUrl: "https://openlibrary.org",
          batchLimit: 20,
        });
      });
    return () => {
      mounted = false;
      alive.current = false;
      cancelled.current = true;
      if (currentBook.current !== null) {
        void platform.cancelEnrichment(currentBook.current).catch(() => {});
      }
    };
  }, [refreshTargets]);

  const chooseMode = useCallback(async (mode: EnrichmentMode) => {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await platform.setEnrichmentMode(mode);
      setSettings(saved);
      setNotice(
        mode === "off"
          ? "Online details are off. No lookup will be made unless you ask for one."
          : `Online details set to ${MODE_COPY[mode].title}.`,
      );
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "That setting could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, []);

  const startBatch = useCallback(async () => {
    if (!settings || running) return;
    setNotice(null);
    setApplied(0);
    setDone(0);
    cancelled.current = false;
    let queue: Book[] = [];
    try {
      queue = await platform.enrichmentTargets(settings.batchLimit);
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "The queue of books could not be read just now.",
      );
      return;
    }
    setTargets(queue);
    if (queue.length === 0) {
      setNotice("Every book already has its blurb and cover.");
      return;
    }
    setTotal(queue.length);
    setRunning(true);
    let filled = 0;
    let processed = 0;
    for (const book of queue) {
      if (cancelled.current) break;
      currentBook.current = book.id;
      try {
        const outcome = await platform.lookupEnrichment(book.id, false);
        if (outcome.state === "applied") filled += 1;
      } catch {
        // One failed book must not stop the foreground queue.
      }
      processed += 1;
      currentBook.current = null;
      if (alive.current) {
        setDone(processed);
        setApplied(filled);
      }
    }
    currentBook.current = null;
    if (alive.current) {
      setRunning(false);
      setNotice(
        cancelled.current
          ? `Stopped after ${processed} of ${queue.length} books. ${filled} ${
              filled === 1 ? "book was" : "books were"
            } filled.`
          : processed === queue.length
            ? `Finished ${processed} ${
                processed === 1 ? "book" : "books"
              }; ${filled} ${filled === 1 ? "was" : "were"} filled.`
            : "The queue stopped before it finished.",
      );
      await refreshTargets(settings.batchLimit);
    }
  }, [settings, running, refreshTargets]);

  const cancelBatch = useCallback(() => {
    cancelled.current = true;
    if (currentBook.current !== null) {
      void platform.cancelEnrichment(currentBook.current).catch(() => {});
    }
    setNotice("Stopping after this book…");
  }, []);

  return (
    <section
      className="settings-section"
      aria-labelledby="settings-online"
      data-testid="settings-online"
    >
      <h3 id="settings-online">Online details</h3>
      <p className="settings-note">
        Fill a missing blurb or replace only a generated plate with a cover from{" "}
        <a href={settings?.sourceUrl ?? "https://openlibrary.org"} target="_blank" rel="noreferrer">
          {settings?.sourceLabel ?? "Open Library"}
        </a>
        . Only the title, author and ISBN leave the device. No account, key,
        library list, reading progress or file contents are sent, and there is
        no paid source.
      </p>
      <fieldset className="settings-mode">
        <legend>Lookup mode</legend>
        <div className="mode-choices">
          {(Object.keys(MODE_COPY) as EnrichmentMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              data-testid={`settings-online-mode-${mode}`}
              aria-pressed={settings?.mode === mode}
              disabled={saving || running || settings === null}
              onClick={() => void chooseMode(mode)}
            >
              {MODE_COPY[mode].title}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="settings-note" data-testid="settings-online-mode-copy">
        {settings ? MODE_COPY[settings.mode].detail : "Reading the setting…"}
      </p>
      <p className="settings-note">
        A real embedded or PDF-rendered cover is never replaced automatically;
        only the cover chooser can do that. A linked Internet Archive scan is
        read only when the matched Open Library edition points at it.
      </p>
      <div className="settings-actions">
        <button
          type="button"
          className="primary-action"
          data-testid="settings-online-fill"
          disabled={running || settings === null || targets === null}
          onClick={() => void startBatch()}
        >
          {running
            ? `Filling ${done} of ${total}…`
            : targets === null
              ? "Reading the queue…"
              : `Fill missing details… (${targets.length})`}
        </button>
        {running ? (
          <button
            type="button"
            className="secondary-action"
            data-testid="settings-online-cancel"
            onClick={cancelBatch}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="settings-back"
            data-testid="settings-online-refresh"
            disabled={settings === null}
            onClick={() =>
              settings &&
              void refreshTargets(settings.batchLimit).then(() =>
                setNotice("Queue refreshed."),
              )
            }
          >
            Refresh queue
          </button>
        )}
      </div>
      {running ? (
        <p className="settings-note" role="status" data-testid="settings-online-progress">
          {done} of {total} books checked; {applied} filled. Leaving Settings
          stops the queue.
        </p>
      ) : targets !== null ? (
        <p className="settings-note" data-testid="settings-online-queue">
          {targets.length === 0
            ? "No book is missing a blurb or cover."
            : `${targets.length} ${
                targets.length === 1 ? "book is" : "books are"
              } missing a blurb or cover. A run checks at most ${settings?.batchLimit ?? 20}.`}
        </p>
      ) : null}
      {notice ? (
        <p
          className="settings-note backup-notice"
          role="status"
          data-testid="settings-online-notice"
        >
          {notice}
        </p>
      ) : null}
    </section>
  );
}
