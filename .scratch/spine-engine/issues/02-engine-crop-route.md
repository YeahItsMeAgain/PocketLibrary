# 02: Run the v8 crop pipeline end to end on a cover

**What to build:** A spine engine that takes a book's cover, title, author and page count and
produces a text-free spine the rest of the app can display, using the crop route. Running it twice on
the same book reuses the cached result instead of re-running detection. The report records the route
taken, the QA verdict, the mask percentage and the crop box, and the output directory holds the art,
the 52 × 236 spine, a typographic fallback, the mask preview and the existing v8 run/QA JSON.

**Blocked by:** 01 (model bundle and loader)

**Status:** ready-for-agent

- [ ] Given a downloaded EPUB cover, generation produces every artifact named in the integration contract, with `run.json` carrying a crop box and `qa.json` carrying a verdict.
- [ ] A second generation of the same book and inputs returns the cached artifact and does no detection work; deleting the book's cache entry forces a fresh run.
- [ ] Editing only the page count recomposes the cheap outputs without re-running detection.
- [ ] A book whose QA verdict is `review` still returns a completed artifact with that verdict, rather than being silently upgraded to pass.
- [ ] A failed or panicking run leaves no partial cache entry behind and reports an error the caller can retry.
- [ ] Generation of a book that has no cover returns a clear "no cover" outcome rather than an artifact.

