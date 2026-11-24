import { useCallback, useEffect, useRef } from "react";

const HISTORY_KEY = "__pocketLibraryReader";
let readerToken = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One close path for the reader: the labelled bar button, the persistent
 * corner pill, Escape and Android/browser back all end here.
 *
 * Opening pushes a history entry so the platform back gesture closes the
 * reader instead of leaving the app. Closing from the UI pops that entry
 * without re-entering the popstate handler; a real popstate closes the reader
 * without touching history again.
 */
export function useReaderExit(onClose: () => void): () => void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef("");
  if (!tokenRef.current) {
    readerToken += 1;
    tokenRef.current = `reader-${readerToken}`;
  }
  const pushedRef = useRef(false);
  const finishedRef = useRef(false);
  const activeRef = useRef(false);
  const cleanupTimer = useRef(0);

  const close = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    window.clearTimeout(cleanupTimer.current);
    const state = history.state;
    if (isRecord(state) && state[HISTORY_KEY] === tokenRef.current) {
      // Drop the entry we pushed; the listener above is already finished, so
      // the resulting popstate cannot close the reader a second time.
      history.back();
    }
    onCloseRef.current();
  }, []);

  useEffect(() => {
    // StrictMode mounts, cleans up and mounts again. Cancel the deferred
    // cleanup and reuse the single history entry pushed by the first pass.
    window.clearTimeout(cleanupTimer.current);
    activeRef.current = true;
    finishedRef.current = false;
    if (!pushedRef.current) {
      const base = isRecord(history.state) ? history.state : {};
      history.pushState({ ...base, [HISTORY_KEY]: tokenRef.current }, "");
      pushedRef.current = true;
    }

    const onPopState = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
      activeRef.current = false;
      // If the reader unmounts without using the close path, remove its entry.
      // Deferring lets StrictMode's immediate remount cancel this.
      cleanupTimer.current = window.setTimeout(() => {
        if (activeRef.current || finishedRef.current) return;
        const state = history.state;
        if (isRecord(state) && state[HISTORY_KEY] === tokenRef.current) {
          finishedRef.current = true;
          history.back();
        }
      }, 0);
    };
  }, [close]);

  return close;
}

interface ReaderPersistentChromeProps {
  /** Fraction read, 0..1. */
  progress: number;
  /** Small readout beside the bar, e.g. "42%" or "42% · 8/19". */
  label: string;
  onClose: () => void;
}

/**
 * Unobtrusive controls that stay put while the tap-to-reveal bars are hidden:
 * a translucent Library pill and a brass progress line at the bottom edge.
 */
export function ReaderPersistentChrome({
  progress,
  label,
  onClose,
}: ReaderPersistentChromeProps) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  return (
    <>
      <button
        type="button"
        className="reader-float-back"
        data-testid="reader-persistent-back"
        aria-label="Back to library"
        onClick={onClose}
      >
        <span aria-hidden="true">←</span> Library
      </button>
      <div
        className="reader-float-progress"
        data-testid="reader-persistent-progress"
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span
          className="reader-float-fill"
          style={{ width: `${percent}%` }}
        />
        <span
          className="reader-float-percent"
          data-testid="reader-persistent-percent"
        >
          {label}
        </span>
      </div>
    </>
  );
}
