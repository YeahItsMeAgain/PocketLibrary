# 05 — Reader engine and annotation model

Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

Which EPUB renderer should the reader use, and how must annotations be represented so highlights and notes are not a later rewrite?

`epub.js` is the default candidate but has been unmaintained since 2020; evaluate vendoring and patching it versus Foliate's JS engine versus a custom XHTML/iframe renderer. Cover pagination and scroll modes, theming, font and margin control, position persistence, TOC, bookmarks, in-book search feasibility, and highlight/note anchoring (EPUB CFI plus a quoted-text fallback). Then cover `pdf.js` in the same reader shell: page fit/zoom, position persistence, and whether annotations are needed for PDF in the first pass.

Report recommendation, integration shape, Android WebView performance risks, and what must be built in M1 so the optional annotation work in M4 fits the same data model.

## Answer

Resolved 2026-11-24. Full report with local engine benchmarks: `notes/reader-engine.md`.

- **Primary EPUB engine:** `foliate-js` at a pinned commit, behind a `ReaderEngine` adapter. MIT; best reflow, instant progress without location generation, built-in search/TTS, fixed-layout support. Cost: unstable API and a **mandatory strict Tauri CSP**.
- **CSP is a release blocker:** without it, a scripted EPUB executed inside foliate's iframe and wrote to the parent. With `script-src 'self'` the script and inline handler were blocked. If strict CSP cannot be guaranteed, switch the primary to the fallback.
- **Fallback:** `@likecoin/epub-ts@0.7.4` (maintained, typed epub.js fork). Do not use raw `epub.js@0.3.93`.
- **PDF:** `pdfjs-dist@6.5.438`, `PDFViewer`/`PDFSinglePageViewer`, local worker plus local `cmaps/`, `standard_fonts/`, `wasm/`; text layer enabled in M1.
- **Annotations:** store a Readium-shaped `Locator` (`href`, `locations.fragments` = CFI or `page=N`, `progression`, `position`, `text.before/highlight/after`) plus W3C `TextQuoteSelector` and `TextPositionSelector`. Resolve CFI → validate quote → section search → whole-book search; write corrected CFIs back. A one-paragraph insertion broke CFI resolution in both engines, so the text-quote fallback is mandatory.
- **M1 data model:** create the `annotations` table now and treat bookmarks as `kind='bookmark'`; wire selection → Locator and apply-highlight internally even if the UI is hidden. M4 then becomes UI-only work.
- **Benchmarks:** foliate opened a 500-section book in 109 ms and jumped to 50% in 41 ms; epub-ts took 8.3 s; raw epub.js location generation did not finish in 15 s.
