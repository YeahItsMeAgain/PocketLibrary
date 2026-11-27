# 12: Persist per-book style, cap the cache and backfill the library

**What to build:** A per-book spine style survives restart. Migration 6 adds `books.spine_style`
defaulting to `wrap`; switching style updates that column and never re-runs the pipeline or
invalidates the cache key. The app cache is capped at 200 MB LRU and holds only runtime files:
`art.jpg`, `spine-2x.jpg`, `fallback-spine.jpg`, `run.json`, `qa.json`, `artifact.json`. `source.jpg`
and `mask.png` are pipeline scratch only. The existing library is backfilled once at low priority
behind new jobs.

**Blocked by:** 10 (automatic queue), 11 (reduced renderers)

**Status:** ready-for-agent

- [ ] Migration 6 adds `books.spine_style` with default `wrap`; existing rows migrate without loss.
- [ ] The detail style switch writes `books.spine_style`, and the chosen style survives restart and reopening the book.
- [ ] A style switch redraws from cached art; it does not re-run detection and does not change the cache key.
- [ ] The cache contains only `art.jpg`, `spine-2x.jpg`, `fallback-spine.jpg`, `run.json`, `qa.json`, `artifact.json`; `source.jpg` and `mask.png` are never written there.
- [ ] Cache size is trimmed to 200 MB by LRU mtime after each completed job, with the oldest entries removed first.
- [ ] The existing library is backfilled exactly once, at low priority, and new jobs run ahead of it.
- [ ] Deleting a book removes its cache directory and its `spine_style` row.
