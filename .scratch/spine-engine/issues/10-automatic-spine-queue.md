# 10: Automatic spine queue with quiet progress and one-shot failure handling

**What to build:** Spines appear without the user asking, for every path that produces a cover and a
page count — download, import, scan, manual edit, metadata enrichment and manual cover pick. The book
shows Cloth immediately and swaps when the art is ready. One FIFO worker runs automatic jobs one at a
time; manual Generate jumps the queue. A single global chip reads “Preparing spines · n of m” with
real stage labels and no percentage, and hides in the reader. One “Stop preparing” control pauses
automatic work, automatic jobs pause while the reader is open, the queue survives process death, and
a failed job retries once before settling on Cloth with a marker and a detail note.

**Blocked by:** 07 (queue worker and cache invalidation)

**Status:** ready-for-agent

- [ ] Every path that yields a cover and a page count enqueues exactly one job: download, import, scan, manual edit, metadata enrichment, manual cover pick.
- [ ] The book renders Cloth immediately and swaps to the generated spine on completion with no layout shift.
- [ ] Jobs run one at a time in FIFO order; a 20-book batch completes without parallel or duplicate runs; manual Generate jumps ahead of queued automatic jobs.
- [ ] The global chip shows “Preparing spines · n of m” and the per-book state; stages read preparing art / removing text / checking; no fake percentage.
- [ ] The chip is hidden while the reader is open and automatic jobs pause, resuming on close; manual Generate still runs.
- [ ] “Stop preparing” pauses the automatic queue and resumes cleanly; there is no per-book Cancel control.
- [ ] A failed job retries once automatically, then stays on Cloth with a small persistent marker and a detail note.
- [ ] Unfinished jobs are persisted and re-queued after process death; jobs wait for missing models rather than being dropped.
- [ ] A book with no page count enqueues normally using the ~320-page estimate and exposes the `approximate` label.
