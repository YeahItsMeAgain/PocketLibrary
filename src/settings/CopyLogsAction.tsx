import { useCallback, useEffect, useRef, useState } from "react";

import { writeClipboardText } from "../diagnostics";
import { useLayerExit } from "../navigation";
import { platform } from "../platform";

/**
 * Copy the plain-text diagnostics report. Falls back to a read-only selection
 * sheet when the browser refuses both clipboard paths, so the user can still
 * copy manually.
 */
export function CopyLogsAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const noticeTimer = useRef(0);

  const clearFallback = useCallback(() => setFallback(null), []);
  const closeSheet = useLayerExit(fallback !== null, clearFallback);

  useEffect(() => {
    return () => window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (fallback === null) return;
    textRef.current?.focus();
    textRef.current?.select();
    return () => {
      buttonRef.current?.focus();
    };
  }, [fallback]);

  const selectAll = useCallback(() => {
    const area = textRef.current;
    if (!area) return;
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
  }, []);

  const copy = useCallback(async () => {
    window.clearTimeout(noticeTimer.current);
    setBusy(true);
    setNotice(null);
    try {
      const text = await platform.diagnosticsText();
      try {
        await writeClipboardText(text);
        setNotice("Copied to clipboard.");
        noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
      } catch {
        setFallback(text);
      }
    } catch {
      setNotice("Logs could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="secondary-action"
        data-testid="settings-copy-logs"
        disabled={busy}
        onClick={() => void copy()}
      >
        {busy ? "Preparing…" : "Copy logs"}
      </button>
      <span
        className="settings-note copy-logs-notice"
        role="status"
        aria-live="polite"
        data-testid="copy-logs-notice"
      >
        {notice}
      </span>

      {fallback !== null ? (
        <>
          <button
            type="button"
            className="detail-scrim"
            aria-label="Close copied logs"
            onClick={closeSheet}
          />
          <section
            className="diagnostics-copy-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="diagnostics-copy-title"
            data-testid="diagnostics-copy-fallback"
          >
            <h3 id="diagnostics-copy-title">Copy logs</h3>
            <p className="settings-note">
              Clipboard access was refused. Select the text below and copy it
              manually.
            </p>
            <textarea
              ref={textRef}
              className="diagnostics-copy-text"
              data-testid="diagnostics-copy-text"
              aria-label="Diagnostics log text"
              readOnly
              value={fallback}
            />
            <div className="diagnostics-copy-actions">
              <button
                type="button"
                className="secondary-action"
                data-testid="diagnostics-copy-select-all"
                onClick={selectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="settings-back"
                data-testid="diagnostics-copy-close"
                onClick={closeSheet}
              >
                Close
              </button>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
