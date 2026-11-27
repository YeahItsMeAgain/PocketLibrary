import {
  useSpineActivity,
  useSpineReaderOpen,
} from "./spineActivity";

/**
 * A quiet global progress line for automatic spine preparation. It sits over
 * the wall and the detail sheet, and hides entirely while the reader is open.
 */
export function SpineActivityChip() {
  const { queue, paused, stop, resume } = useSpineActivity();
  const readerOpen = useSpineReaderOpen();
  if (readerOpen || !queue) return null;

  const total =
    queue.completed +
    queue.pending +
    (queue.currentBookId !== null ? 1 : 0);
  const active =
    queue.pending > 0 || queue.currentBookId !== null || queue.running;
  if (!active) return null;

  return (
    <div
      className={`spine-activity${paused ? " is-paused" : ""}`}
      data-testid="spine-activity"
      data-paused={paused}
      data-stage={queue.stage ?? ""}
      data-running={queue.running}
      role="status"
      aria-live="polite"
    >
      <span className="spine-activity-text">
        Preparing spines · {queue.completed} of {total}
      </span>
      <button
        type="button"
        className="spine-activity-action"
        data-testid={paused ? "spine-resume" : "spine-stop"}
        onClick={paused ? resume : stop}
      >
        {paused ? "Resume" : "Stop preparing"}
      </button>
    </div>
  );
}
