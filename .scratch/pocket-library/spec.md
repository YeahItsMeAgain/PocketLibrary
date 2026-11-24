# PocketLibrary — v1 Spec

Status: ready-for-agent
Tracker: local `.scratch/pocket-library/`

## Problem Statement

I have my own EPUBs and PDFs, but no reading app that feels like *my* library. Existing readers are utilitarian lists; my books end up as rows of filenames. Finding a book I don't own yet means leaving the app, hunting Libgen in a browser, and then manually moving a file into place. I want one personal, offline-first Android app where my books live on physical-feeling shelves, I can arrange them the way I want, label and track them, read them, and fetch new ones without leaving the room.

## Solution

PocketLibrary is a sideloaded Android app that presents one Victorian reading room: a vertical wall of wooden bookcases, books spine-out, each spine carrying its labels, reading ribbon and status. Tapping a book lifts it off the shelf and opens it to show the real cover, blurb, labels and progress. A built-in reader handles EPUB and PDF. A hidden brass drawer opens acquisition, where Libgen can be searched with advanced filters and downloaded directly into the library folder. The user places books by hand; shelves are space, not categories. Everything that is not a book file — shelves, labels, reading state, annotations, downloads — is backed up explicitly.

## User Stories

1. As the reader, I want to choose one library folder on my phone, so that PocketLibrary indexes my existing files without copying them.
2. As the reader, I want the app to scan that folder recursively for EPUB and PDF files, so that nested folders work.
3. As the reader, I want the app to ignore non-book files and hidden directories, so that the shelf is not polluted.
4. As the reader, I want the grant to survive a relaunch, so that I do not re-pick the folder every time.
5. As the reader, I want a clear recovery screen if the folder is moved or permission is revoked, so that I never see a silently empty library.
6. As the reader, I want the app to detect new and removed files on launch and on manual rescan, so that the shelf matches my folder.
7. As the reader, I want a removed file to become "finished" rather than disappearing from the library, because if I kept it there was a reason.
8. As the reader, I want a book's title, author, series, language, description, publisher, date, identifier and cover read from the file first, so that the shelf reflects the book itself.
9. As the reader, I want filename parsing and online enrichment only to fill gaps, so that bad metadata never overrides good metadata.
10. As the reader, I want to edit metadata manually, so that I can fix a bad file.
11. As the reader, I want duplicate files detected by content, not filename, so that renaming or moving does not create ghosts.
12. As the reader, I want the library to handle around 2,000 books, so that a real collection stays smooth.
13. As the reader, I want a vertical wall of fixed bookcases, so that browsing feels like walking along a shelf.
14. As the reader, I want books rendered spine-out with their labels and status visible, so that I can browse without opening anything.
15. As the reader, I want to tap a book to lift it off the shelf and open its detail, so that the physical metaphor holds.
16. As the reader, I want the detail to show the real cover large, the blurb, metadata, labels and progress, so that I can decide what to read.
17. As the reader, I want a clear "Read" or "Continue reading" button, so that starting a book is never a guess.
18. As the reader, I want a clear "Back to shelf" control, so that leaving a book is obvious.
19. As the reader, I want new books to land on the lowest shelf with room, so that placing them is predictable.
20. As the reader, I want a new shelf appended automatically when the lowest one is full, with an undo, so that importing is never blocked.
21. As the reader, I want to long-press a book to lift it, so that moving it is a deliberate physical act.
22. As the reader, I want to drag a book along its shelf to reorder it, so that I control the arrangement.
23. As the reader, I want to drag a book onto another shelf, with the wall scrolling at the edges, so that I can move books across the library.
24. As the reader, I want other books to slide aside and show the drop gap, so that the result is predictable before I release.
25. As the reader, I want a short tap to still open a book, so that moving and opening never fight.
26. As the reader, I want my scroll position preserved when I return from a book, so that I do not lose my place.
27. As the reader, I want no shelf management — no names, reorder, add or delete controls — because shelves exist only as space for books I placed.
28. As the reader, I want to create reusable labels with a name and a muted Victorian colour, so that I can group books without moving them.
29. As the reader, I want to attach several labels to one book, so that a book can be "Gothic" and "Want to read".
30. As the reader, I want labels rendered as coloured paper bands on the spine, so that the shelf itself shows them.
31. As the reader, I want at most two label bands plus a "+1" nub on a spine, so that narrow spines stay legible.
32. As the reader, I want labels to filter the wall without moving books, so that filtering never destroys my arrangement.
33. As the reader, I want to combine a label filter with a status filter, so that "want to read" and "unread" can intersect.
34. As the reader, I want to manage labels centrally and delete one without deleting books, so that cleanup is safe.
35. As the reader, I want unread / reading / finished status, with a ribbon, a gold seal and no marker respectively, so that the shelf shows progress at a glance.
36. As the reader, I want status to update automatically when I open a book and when I reach the end, so that I do not have to maintain it.
37. As the reader, I want a manual status override that sticks, so that the app does not fight me.
38. As the reader, I want a percentage sticker on the open cover and a shiny gold sticker when finished, so that completion feels like an achievement.
39. As the reader, I want reading status removed from the book detail, so that the detail stays about the book.
40. As the reader, I want to read EPUBs in the app, so that I do not need another app.
41. As the reader, I want to read PDFs in the same shell, so that both formats feel like one library.
42. As the reader, I want immersive reading with tap zones, so that the page is not crowded by chrome.
43. As the reader, I want to swipe or tap for page turns, with vertical scroll as an option, so that I can read the way I prefer.
44. As the reader, I want a table of contents and bookmarks in one Contents sheet, so that navigating is quick.
45. As the reader, I want five text sizes, three line spacings, two margins, and Paper / Sepia / Night themes, so that long reading is comfortable.
46. As the reader, I want three bundled serif fonts, so that the typography matches the room.
47. As the reader, I want my position remembered per book, so that I resume where I stopped.
48. As the reader, I want PDF fit-width and pinch zoom, with themes as a tint, so that fixed layouts remain usable.
49. As the reader, I want to open a book in another app, so that I am not trapped.
50. As the reader, I want the built-in reader to be the default, so that the common path is fast.
51. As the reader, I want to summon navigation with a physical gesture, so that the shelf is not permanently covered by an app bar.
52. As the reader, I want a bottom drawer with Library, Search and Settings, so that the three top-level places are reachable.
53. As the reader, I want to drag the drawer closed and use Android back, so that dismissal is natural.
54. As the reader, I want advanced Libgen search — title, author, year, language, format, publisher, ISBN, MD5 — so that I can find a specific edition.
55. As the reader, I want results with format, size and source, so that I can choose sensibly.
56. As the reader, I want a result detail with mirrors and a Download button, so that acquisition is one decision.
57. As the reader, I want downloads to run in a queue with progress and cancel, so that slow mirrors do not block me.
58. As the reader, I want mirror failover to be automatic, so that I do not have to know which Libgen domain is alive.
59. As the reader, I want duplicate checks before and after download, so that I do not add a book I already own.
60. As the reader, I want downloaded files named `Author - Title (Year)` in my library folder, so that they fit my existing layout.
61. As the reader, I want the new book to appear on the lowest shelf with room after download, so that the loop closes visibly.
62. As the reader, I want no acquisition source that cannot download inside the app, so that I am never bounced to a browser.
63. As the reader, I want a clear offline and mirror-failure state, so that I know whether to retry.
64. As the reader, I want a single Settings screen for folder, reader defaults, download naming, backup and about, so that configuration is not scattered.
65. As the reader, I want to export my shelf layout, labels, reading state, annotations and settings to one file, so that a reinstall does not lose years of curation.
66. As the reader, I want to import that file with a merge-by-content-hash default, so that restoring never silently deletes newer progress.
67. As the reader, I want an explicit "replace current library data" option, so that I can do a clean restore when I mean it.
68. As the reader, I want Android auto-backup as an extra safety net, so that a lost phone is less catastrophic.
69. As the reader, I want no accounts, no cloud sync, no telemetry, so that the library is mine.
70. As the reader, I want reduced-motion support and large touch targets, so that the app is comfortable and accessible.
71. As the reader, I want the app to work offline except for acquisition and enrichment, so that reading is never gated on a network.
72. As the reader, I want the shelf to stay smooth at 2,000 books, so that the room does not become unusable as the library grows.

## Implementation Decisions

### Platform and architecture

- Android-only, sideloaded APK. Tauri v2 with a Rust backend and a React/Vite web UI running in Android System WebView. No desktop or iOS target.
- One thin `Platform` adapter sits between the web UI and Tauri `invoke`; the UI never calls Tauri directly. This keeps a Capacitor shell as a cheap fallback and gives the UI tests a single mock point.
- The Rust core owns files, SQLite, parsing, acquisition and the reader's file serving. The web layer owns presentation, motion and the reader engine.
- Network access is limited to Libgen acquisition and optional Open Library enrichment. No telemetry, no analytics, no accounts.
- Strict Content Security Policy is mandatory. The reader must never allow EPUB scripts to reach the app origin; this is a release blocker, not a hardening task.

### Core modules and interfaces

- **Library source** — a SAF adapter that lists, reads and writes inside the granted tree. A fake directory implementation backs tests. Callers never see `content://` details.
- **Catalog** — books, shelves, placements, labels, reading state, settings. The only writer of the database.
- **Ingest** — scan, hash, parse metadata, extract covers, dedupe, place. Idempotent: running it twice is safe.
- **Acquisition** — a Libgen search provider, a mirror/download resolver, a persisted queue, and duplicate checks. Network providers sit behind traits so fixtures can replace them.
- **Reader service** — serves book bytes to the web reader, stores positions and annotations, and reports reading progress.
- **Backup** — exports and imports the versioned metadata archive.
- **Platform adapter (web)** — typed commands, file handoff, share/save pickers, lifecycle.

### Command API (contract level)

- Library: pick folder, check grant, scan/rescan, list books, get one book, place/move a book, list shelves.
- Catalog: create/rename/recolour/delete label, attach/detach label, set reading status, set reading position, list annotations.
- Acquisition: search, resolve a result, enqueue/cancel a download, list the queue, retry a failed download.
- Reader: open a book for reading, save position, add/remove bookmark.
- Settings: get/set reader defaults, download naming, shelf capacity.
- Backup: export to a user-chosen destination, inspect an import, apply a merge or replace.

Contract rules: commands are idempotent where retry is possible, return typed errors rather than strings, and never expose filesystem paths to the UI except as opaque book identifiers.

### Data model

SQLite `library.db` in app-private storage, WAL mode, `PRAGMA user_version` migrations. Books stay in the SAF folder; cover images are content-addressed files in app data; the database stores paths, hashes and metadata.

- `books`: internal id, BLAKE3 content hash (unique), current path, format, title, authors, series, language, description, publisher, published date, identifier, cover path, added time, shelf id, slot index.
- `shelves`: id, ordinal, capacity. First-class and persisted. Default capacity 12, in settings.
- `labels`: id, name (unique), colour, created time.
- `book_labels`: book id + label id, both primary.
- `reading_state`: book id primary, status (`unread|reading|finished`), status source (`auto|manual`), progress fraction, locator JSON, last opened, finished at.
- `annotations`: id, book id, kind (`highlight|note|bookmark`), colour, note, locator JSON, created/updated. Created in M1 even though its UI lands in M4.
- `downloads`: id, md5, title, source, state, bytes, error, created/finished. Survives restart.
- `settings`: key-value.

Identity is the internal id, not the path. The BLAKE3 hash is unique and survives rename/move. Re-importing identical bytes is a duplicate.

### Storage and SAF

- One user-granted folder is the source of truth (ADR 0002). Books are read in place; downloads are written there. No app-private copy of the library.
- `tauri-plugin-android-fs` 30.2.0 provides the directory picker and persisted read/write grant. The plugin is pinned exactly.
- Android forbids granting the storage root, a reliable SD root, or `Download`; onboarding must ask for or create a subfolder such as `Documents/PocketLibrary`.
- On launch, re-check the grant. If it is gone, show reconnect; never silently show an empty shelf.
- A scan is recursive, ignores hidden directories and non-EPUB/PDF files, and records a quick hash key for rescans plus a full BLAKE3 for identity.

### Metadata and covers

- EPUB: `rbook` 0.7.13 for container/OPF metadata, cover, TOC and spine; parse directly from the SAF file handle.
- PDF: `lopdf` 0.47.0 for metadata and page count; `hayro` 0.9.0 for a page-1 cover.
- Fallback order: embedded metadata, then filename parsing, then optional Open Library enrichment for gaps only. Manual edit always wins.
- Covers are cached as content-addressed JPEG files; paths live in the database. No cover is required to render a book; a generated cover is the fallback.
- Duplicate detection: quick key for rescans, full BLAKE3 for identity and dedupe.

### Shelves and placement

- Shelves are fixed furniture with capacity, persisted, and never managed by the user: no naming, reordering, adding or deleting controls. They exist only as space for books the user placed.
- A book stores its shelf and slot. New books go to the lowest shelf with room. If none has room, a shelf is appended and the book is placed there, with an undo notice.
- Drag is arithmetic on the model, not DOM measurement. Long-press lifts after ~380 ms; a short tap opens the book.
- Filters dim non-matching books and never move them. Clearing restores everything. Return from a book restores the same shelf and scroll position.

### Labels and status

- Labels are free-form, many-to-many, with a fixed palette of about eight muted Victorian colours. Rendered as spine bands (max two plus "+1") and full-name chips in the detail. Minimum contrast 5.56:1. Deleting a label removes it from books and nothing else.
- Status is a separate fixed axis, not a label: `unread | reading | finished`. First open sets `reading`; the last page or ≥98% sets `finished`; reopening does not clear it; a manual override wins and sticks.
- A vanished file becomes `finished`; the book record is never dropped.
- Shelf cues: no marker = unread, red ribbon = reading, gold seal = finished. Cover cues: nothing = unread, paper percentage sticker = reading, gold sticker = finished. Status is absent from the book detail.
- Achievements are parked post-v1.

### Reader

- EPUB: `foliate-js` at a pinned commit behind a `ReaderEngine` adapter, with `@likecoin/epub-ts` 0.7.4 as the fallback if the pinned API or CSP blocks M1. Raw `epub.js` is not used.
- Strict CSP is required; without it a scripted EPUB can reach the parent.
- PDF: `pdfjs-dist` 6.5.438 with a local worker and local `cmaps/`, `standard_fonts/` and `wasm/`. Text layer enabled.
- Chrome: immersive. Centre tap toggles a slim top bar (back to shelf, Contents, progress) and bottom bar (type, theme, bookmark). Left/right thirds page; the first and last page do nothing.
- Modes: paginated default, vertical scroll optional, global and remembered.
- Contents: one sheet with Chapters and Bookmarks tabs; bookmark button drops a ribbon.
- Typography: five sizes, three line spacings, two margins, Paper/Sepia/Night, three bundled serifs (EB Garamond, Literata, Source Serif) under ~1.5 MB total.
- PDF uses the same shell; font size becomes zoom, themes are a tint, no reflow, no annotations in M1.
- Annotations use a Readium-shaped Locator (`href`, fragments as CFI or `page=N`, progression, position, text before/highlight/after) plus W3C TextQuote and TextPosition selectors. Resolution order: CFI → validate quote → section search → whole-book search; write corrected CFIs back.
- M1 creates the annotations table and wires selection→Locator + apply-highlight internally even though the UI is hidden, so M4 is UI-only work.
- External reader: content URI via the Android chooser. Built-in is the default; no position sync; on return the book is marked reading unless finished.

### Acquisition

- Libgen only, fully in-app. No Anna's Archive, no external-browser handoff, no source that cannot download inside the app.
- Search: `GET https://<mirror>/index.php?req=…&page=N`, parse the 9-column `#tablelibgen` table, 25 rows/page. `columns[]` works; extension/language/year filters are applied client-side because Libgen ignores them. No structured search API exists.
- Mirrors: `libgen.li → .bz → .vg → .la → .gl`, hardcoded with automatic failover and a health/cooldown model. SLUM `https://open-slum.org/status.json` is a 10-minute hint only; it checks homepages and cannot see search/CDN failures.
- HTTP: browser/TLS impersonation (JA3/JA4) is required; `wreq` is the chosen candidate, with `reqwest` + rustls as fallback. Spike before committing the dependency.
- Download: `ads.php?md5=` → `get.php?md5=&key=` → 307 → CDN. HTTP/1.1, Range resume, content-length and magic-byte validation, key re-minting on failure. `.part` file and atomic rename.
- Queue: two concurrent, persisted across restarts, resumed with Range; runs while the app is open in M2. A foreground service is later.
- Duplicates: check result md5 against download history before fetching; hash the downloaded file with BLAKE3 against the library. On match, discard and link to the existing book.
- Naming: `Author - Title (Year).epub|pdf` in the library folder root, sanitised, ` (2)` on collision. Re-read embedded metadata after landing.
- Failures: "Trying another mirror…", then a retryable error with the last cause; explicit offline state.
- Acceptance example: *Rock Paper Scissors* by Alice Feeney searches, resolves an EPUB, downloads and lands on the lowest shelf with room.

### Backup and settings

- Backup is a versioned `.pocketlibrary` zip containing `manifest.json`: shelves and placements, labels, reading state and positions, annotations, settings, download history, optional cached covers. Books are not included.
- Export and import use the system file picker; nothing is written into the library folder automatically.
- Import merges by content hash by default, never overwrites newer reading positions, and never deletes. A clearly labelled replace action exists behind confirmation.
- Settings: library folder + rescan, reader defaults, download naming, export/import, about. Android auto-backup is enabled as an extra safety net but never relied on.

### Visual design and motion

- "Refined reading room": near-black aubergine/plum room, warm brass, aged cream, oxblood accents; worn jewel spine colours. No green cast.
- Victorian casework: cornice, palmette crest, fluted pilasters, panelled back, moulded shelf lip, brass hairline, plinth, carved brackets.
- Spine typography 9.6–10.8 px at weight 600 in cream-gold; authors 7.4 px. Label bands keep their colour with cream text.
- Book detail: framed composition, real cover at ~80% of the frame, progress sticker, blurb, labels, edition strip, Read/Continue CTA, and a labelled Back to shelf.
- Motion is compositor-only: transform and opacity. Scrim 260 ms; panel translateY(18px)/scale(.985) → identity in 480 ms with a single ease; opacity 240 ms. No flight clone, no non-uniform scaling, no bounce. Reduced motion is instant.
- Navigation is a hidden brass drawer pull: tap, upward swipe or edge drag opens Library/Search/Settings; drag down, scrim tap, Escape or Android back closes. Back unwinds one layer at a time.

### Performance

- DOM-per-spine with `content-visibility: auto` and `contain-intrinsic-size` per shelf. No JS windowing, canvas or WebGL in v1.
- Scroll and drag must use arithmetic shelf/slot lookup from the model, never whole-library geometry reads. Target ~0.4 ms per drag update.
- `preserve-3d` only on the detail/flip subtree. `will-change` only on the lifted ghost. Filters and status updates touch only affected spines.
- Targets at 4x CPU throttle proxy: first shelf interactive under 400 ms; scroll p95 ≤20 ms, p99 ≤33 ms; no long tasks over 50 ms; renderer DOM under ~15 MB; filtering 2,000 books under 50 ms. Verify on the actual Android WebView.
- Fallback ladder: content-visibility → model-arithmetic updates → canvas 2D strips → windowed WebGL2 atlas.

## Testing Decisions

- **Good tests exercise external behaviour through the two seams, not internals.** A test should state a user-visible outcome: a file appears on a shelf, a label filters the wall, a download lands, a position resumes. Avoid asserting private functions, DOM class names or SQL.
- **Primary seam: the command API.** Rust integration tests drive the same commands the UI calls, against a temporary library folder and a temporary SQLite database. The network is replaced by fakes at the provider trait.
- **Secondary seam: the web Platform adapter.** Playwright runs the real UI at a 390x844 phone viewport with `invoke` mocked; it covers shelf rendering, drag/drop, drawer, detail and reader chrome. No component-level tests below this.
- **Library/ingest tests:** empty folder, nested folders, ignored files, two identical files, a rename, a deleted file becoming finished, a malformed EPUB, a large PDF, and a scan rerun being idempotent.
- **Catalog tests:** placing new books on the lowest shelf with room, auto-append when full, undo, reorder within a shelf, cross-shelf move, label attach/detach/delete, status transitions including manual override and a vanished file.
- **Acquisition tests:** a fake Libgen HTTP server serving a search table, an ads page, a redirect and file bytes; client-side filters; mirror failover on 5xx/timeouts; truncated download detection; md5 pre-check and BLAKE3 post-check; queue persistence and resume.
- **Reader tests:** open an EPUB, jump via TOC, add a bookmark, save and restore a position; a CFI that no longer resolves falls back to the text quote; a PDF opens, zooms and restores a page; a scripted EPUB is blocked by CSP.
- **Backup tests:** export, wipe, import merge, matched/new counts, no overwrite of newer progress, replace path behind confirmation, corrupt archive rejected.
- **UI tests (Playwright):** drawer gesture and back, search flow, download completion and new spine, long-press drag with auto-scroll, filters not moving books, reader chrome and tap zones.
- **Performance tests:** a generated 2,000-book shelf benchmarks first paint, scroll p95/p99, long tasks and filter time at 4x throttle; regression threshold on the budgets above.
- **Device checks (manual, because there is no emulator):** SAF pick/persist across force-stop, recursive scan of real files, read a real EPUB over SAF, write into the folder, revoked-permission recovery, and a cold scan of a large real folder.
- **Build checks:** web tests, `cargo test`, Android-target `cargo clippy -D warnings`, `tsc --noEmit`, an APK build per merge, and `apksigner verify` on releases.
- **Prior art:** the existing Playwright smoke test, the SAF storage spike, and the 2,000-spine performance harness.

## Out of Scope

- iOS, desktop and web builds.
- Play Store distribution.
- Accounts, cloud sync, multi-user, telemetry.
- DRM-protected books and any DRM removal.
- Torrent acquisition.
- Formats other than EPUB and PDF; OCR and PDF text reflow.
- Anna's Archive or any acquisition source that cannot download inside the app.
- Sorting (title/author/date) as an automatic shelf arrangement; manual placement only.
- Shelf management (names, reordering, add/remove controls).
- Multiple rooms or bookcases as a spatial layer.
- Achievements, streaks and social features in v1.
- In-book search, TTS and annotation UI in M1; the data model supports them later.

## Further Notes

- **Delivery order (not scope):** M1 library + shelf + reader; M2 acquisition; M3 shelving, labels and status; M4 annotations and optional reader features. Every milestone should leave an installable APK.
- **Known risks:** foliate-js API churn and CSP; `tauri-plugin-android-fs` is a single-maintainer dependency; Android System WebView fragmentation; Libgen mirror volatility; no KVM, so runtime verification depends on the user's phone.
- **Open spikes:** `wreq` TLS impersonation; hayro cross-compile to arm64; mmap on real SAF handles; a 2,000-file cold scan on a real device; release signing with the generated keystore.
- **App identity** (icon, splash, versioning) is not yet decided; it should be settled before the first release build.
- **Achievements** are explicitly wanted but post-v1; keep the gold-sticker language so they can grow into it.
- **Source of truth:** this spec synthesises 14 resolved decision tickets and three ADRs under `.scratch/pocket-library/`; if a detail conflicts, the ticket and ADR win.
