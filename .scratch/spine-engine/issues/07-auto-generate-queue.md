# 07: Generate automatically on import with a queue, cancel and cache invalidation

**What to build:** Spines appear without the user asking. Importing an EPUB/PDF, scanning a barcode,
or adding a manual book with a cover queues a spine job; one worker runs jobs in order; the shelf
shows cloth until each result lands. Importing twenty books does not spawn twenty parallel runs.
Leaving a screen does not cancel work, but an explicit Cancel does. Cache entries invalidate for the
right reasons and are removed when a book is deleted.

**Blocked by:** 06 (wrap and shelf presentation)

**Status:** ready-for-agent

- [ ] Adding a book by import, barcode scan, or manual entry plus cover automatically queues a spine job once the book has a cover and a page count.
- [ ] Jobs run one at a time in arrival order, and a batch import of at least twenty books completes without parallel runs or duplicate jobs.
- [ ] An explicit Cancel discards the partial result and leaves the cloth spine; navigating away from a book does not cancel.
- [ ] Changing the cover, the book file, the design version or the bundle id invalidates and regenerates, while a page-count-only edit just recomposes the wrap.
- [ ] Deleting a book removes its cache entry and frees its bytes.
- [ ] A bundle version bump garbage-collects the previous model version at the next launch.

