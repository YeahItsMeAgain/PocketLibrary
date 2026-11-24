# Map — PocketLibrary

## Destination

A complete, buildable spec plus a full ticket graph for PocketLibrary — an Android-only, single-user Victorian library app — grouped into milestones: **M1** library, shelf, and reader → **M2** Libgen/Anna's acquisition → **M3** many shelves, labels, manual placement → **M4** annotations and optional features. The map is done when no decision remains that would block writing that spec and those tickets.

## Notes

**Standing decisions from charting** (settled in conversation; do not re-open without cause):

- Personal, sideloaded APK. One user, no accounts, no cloud sync, no telemetry.
- Framework: Tauri v2, Rust backend + web UI. See `docs/adr/0001-tauri-v2-android.md`.
- Library is one user-picked SAF folder; files read in place, downloads written there. See `docs/adr/0002-saf-library-folder.md`.
- Shelves are fixed-capacity furniture, manually populated, never auto-sorted, no endless scroll. New books go to the lowest shelf with room. See `docs/adr/0003-fixed-manual-shelves.md`.
- Labels are reusable coloured stickers, many-to-many, filters only. Reading status is unread/reading/finished, manual plus automatic, shown on the spine; a vanished file becomes "finished" and the book is never dropped.
- Metadata: embedded first, online enrichment only for gaps, manual edit always available, hash-based duplicate detection.
- Reader M1: TOC, typography, themes, page/scroll mode, resume, progress, bookmarks, open-in-another-app. Optional later: highlights, notes, in-book search, TTS.
- Acquisition HTTP must use browser/TLS impersonation (JA3/JA4) to survive Cloudflare/DDoS-Guard; `wreq` (github.com/0x676e67/wreq) is the candidate. Libgen primary (LG+ mirrors; there is no structured search API — search is the HTML result table, with some filters client-side); automatic mirror failover; Anna's Archive is not a viable v1 fallback (DDoS-Guard 403; its only API needs a membership key).
- Design for ~2,000 books; virtualise the shelf.
- Local SQLite in app-private storage; explicit export/import in M1.
- No DRM handling. EPUB and PDF only.

**Why the map exists:** no `/dev/kvm` on the build server, so the emulator is out. Verification ladder: Playwright at a phone viewport, `cargo test`/`clippy`/web tests, an APK build per merge, manual install on the user's phone; wireless `adb` and Firebase Robo are optional. Toolchain research: `notes/framework-research.md`.

**Skills per ticket:** research tickets → `research`; prototype tickets → `prototype`; grilling tickets → `grilling` + `domain-modeling`; tasks → none.

**Ideas from comparable apps, to consider later:** reading statistics; series grouping; metadata editing; OPDS catalogs; "up next" queue; dictionary lookup; page-turn sounds; annotation export; custom covers.

**Deviation from the wayfinder default:** research tickets write their findings to `.scratch/pocket-library/notes/` on the working branch instead of a pushed `research/<name>` branch, because this is a local docs effort and the tickets link the notes directly.

## Decisions so far

- [02 — Screen map and navigation](issues/02-screen-map.md): hidden brass drawer (Library/Search/Settings) opened by pull/swipe and closed by drag/back; front-desk acquisition sheet with advanced search, results, mirrors, download queue and shelf landing; labels managed from the filter strip; settings includes backup; explicit first-run and permission-recovery states.
- [01 — Shelf interaction](issues/01-shelf-interaction.md): vertical wall, tap-to-open, long-press-lift-and-drag, auto-append a shelf when full with undo, no shelf management at all, filters dim only, return preserves position.
- [06 — Victorian visual design system](issues/06-visual-design-system.md): "Refined reading room" v4 — dark aubergine/plum, brass and oxblood, ornate gradient/SVG casework, coloured labels with cream text, larger spine type, real covers as hero, labelled back-to-shelf, compositor-only motion.
- [05 — Reader engine and annotation model](issues/05-reader-engine-annotations.md): foliate-js behind a ReaderEngine adapter (strict CSP mandatory), epub-ts fallback, pdfjs-dist for PDF, Readium Locator + quote selectors for annotations, annotations table in M1.
- [03 — Libgen and Anna's Archive access](issues/03-libgen-annas-api.md): hand-rolled LG+ client; `index.php` HTML search with client-side filters; `ads.php`→`get.php`→CDN downloads with Range resume; SLUM `status.json` as a health hint; Anna's external-browser only; `wreq` TLS impersonation candidate.
- [08 — Build toolchain, signing, verification](issues/08-build-toolchain.md): headless Tauri Android build works; debug APK 129 MiB at `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, signed and verified; Playwright smoke test passes; release keystore generated outside the repo; SDK 36 override needed because 37 is unavailable.
- [07 — Labels and reading status](issues/07-labels-reading-status.md): fixed status axis with auto rules and manual override; shelf ribbon/gold seal; cover percentage sticker/gold sticker; labels are Victorian-coloured spine bands, filters only; achievements post-v1.
- [04 — EPUB and PDF ingest](issues/04-epub-pdf-ingest.md): `rbook` for EPUB, `lopdf` + `hayro` for PDF, direct SAF file handles, BLAKE3 identity, Open Library enrichment, content-addressed covers.

## Not yet specified

- Achievements system (badges, streaks, "10 books finished"), explicitly wanted but post-v1.

- Reader chrome details, typography scale, and PDF-specific reading controls (graduate after 05 and 14).
- Annotation UX: highlight palette, note editor, annotation browser, export (after 05 and 14).
- In-book search and TTS implementation (after 05).
- Book flip content and layout: blurb, metadata, actions, edition details (after 06 and 02).
- First-run onboarding beyond folder selection; empty library; permission recovery copy (after 02 and 10).
- Multiple rooms or bookcases as a second spatial layer (after 01).
- Sorting as an optional later feature, and how it would coexist with manual placement (after 01).
- Tablet/landscape layout; accessibility and large-font behaviour.
- Metadata editing UI and cover replacement.
- Download queue persistence, background downloads, and resume after app restart (after 11).
- Acquisition sources beyond Libgen/Anna's, and legal free catalogs (Gutenberg, Standard Ebooks).
- App identity: name, icon, splash, versioning, in-app update check.
- Screen-level error, offline, and corruption states.

## Out of scope

- iOS, desktop, and web builds.
- Play Store distribution.
- Accounts, sync, cloud storage, multi-user.
- DRM-protected books and any DRM removal.
- Torrent acquisition.
- Formats other than EPUB and PDF; OCR and PDF reflow.
- Social features and public sharing.
