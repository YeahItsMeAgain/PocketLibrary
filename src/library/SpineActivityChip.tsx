import {
  useSpineActivity,
  useSpineReaderOpen,
} from "./spineActivity";

/**
 * A quiet global progress line for automatic spine preparation. It sits over
 * the wall and the detail sheet, and hides entirely while the reader is open.
 *
 * A failed job is never silent: the chip stays visible with the outstanding
 * count and a Retry action until every failure is cleared.
 */
export function SpineActivityChip() {
  const { queue, paused, stop, resume, retryAll } = useSpineActivity();
  const readerOpen = useSpineReaderOpen();
  if (readerOpen || !queue) return null;

  const attention = queue.attention.length;
  const total =
    queue.completed +
    queue.pending +
    (queue.currentBookId !== null ? 1 : 0);
  const active =
    queue.pending > 0 || queue.currentBookId !== null || queue.running;
  if (!active && attention === 0) return null;

  return (
    <div
      className={`spine-activity${paused ? " is-paused" : ""}${
        attention > 0 ? " needs-attention" : ""
      }`}
      data-testid="spine-activity"
      data-paused={paused}
      data-stage={queue.stage ?? ""}
      data-running={queue.running}
      data-attention={attention}
      role="status"
      aria-live="polite"
    >
      <span className="spine-activity-text">
        {attention > 0
          ? `${attention} spine${attention === 1 ? "" : "s"} need${
              attention === 1 ? "s" : ""
            } attention · `
          : `Preparing spines · ${queue.completed} of ${total}`}
      </span>
      {attention > 0 ? (
        <button
          type="button"
          className="spine-activity-action"
          data-testid="spine-retry-all"
          onClick={retryAll}
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          className="spine-activity-action"
          data-testid={paused ? "spine-resume" : "spine-stop"}
          onClick={paused ? resume : stop}
        >
          {paused ? "Resume" : "Stop preparing"}
        </button>
      )}
    </div>
  );
}
