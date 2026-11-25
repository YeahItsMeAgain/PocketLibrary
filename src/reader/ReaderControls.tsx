import { useLayerExit } from "../navigation";

/**
 * One close path for the reader: the labelled bar button, the persistent
 * corner pill, Escape and Android/browser back all end here.
 *
 * The shared navigation guard owns the history entry, so the reader joins the
 * same one-layer-at-a-time stack as the drawer, detail and sheets instead of
 * competing with a second history system.
 */
export function useReaderExit(onClose: () => void): () => void {
  return useLayerExit(true, onClose);
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
