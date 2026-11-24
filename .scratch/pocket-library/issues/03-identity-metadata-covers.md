# 03: Identity, metadata, covers, and duplicates

**What to build:** Every book gets a content identity and real metadata. Rename or move the file and it stays the same book. Identical bytes are not imported twice. The detail view shows the actual cover, blurb, metadata, and the Read and Back controls.

**Blocked by:** 02

**Status:** awaiting-device-test

- [x] Title, author(s), series, language, description, publisher, date, and identifier are read from EPUB/PDF metadata, with filename fallback
- [x] A cover is extracted or rendered and cached; a generated cover is the fallback
- [x] Duplicate detection uses content, not filename; re-importing identical bytes is rejected
- [x] Renaming or moving a file preserves its identity, labels, status, and position
- [x] The detail view shows the real cover large, blurb, metadata, Read/Continue, and Back to shelf
- [x] A malformed book is skipped with a visible reason and does not crash the scan

## Notes

**Schema v2 reset (pre-release, deliberate):** ticket 02 stored a hash of the path, which cannot identify content. Migration v1→v2 clears `books`, `reading_state`, `annotations` and `book_labels`, keeps `shelves`, `labels` and `settings`, adds `page_count` and `cover_source`, and lets the launch scan rebuild the catalog. Nobody has curated data in this pre-release build.

**Identity:** full-file BLAKE3 (`content_hash`, unique) plus a 128 KiB head/tail quick key. Scans group files by content hash, so a rename or move updates the existing row's path while keeping the id, shelf slot, labels and reading state. Identical bytes at two paths produce one book and a `duplicates` count. A missing hash marks the existing book finished. Paths and cover paths remain `#[serde(skip)]`; detail covers cross the wire as JPEG data URLs.

**Metadata:** `rbook` 0.7.13 for EPUB 2/3 (title, creators, `belongs-to-collection`, language, description, publisher, date, identifier, cover, first image fallback). `lopdf` 0.47.0 for PDF Info fields and page count; junk titles (`untitled`, `Microsoft Word…`) are rejected. `hayro` 0.9.0 renders PDF page 1 to a cover. Fallback order is embedded → filename (`Author - Title (Year)` / `Title`) → empty. Description HTML is stripped to plain text. Online enrichment is **deferred** (not in this ticket).

**Covers:** content-addressed under app data `covers/<content-hash>.jpg`, fitted inside 600×900 and JPEG q80. Unreadable covers become a deterministic aubergine/brass generated plate. A missing cache file is regenerated on demand.

**Deviations:** hayro 0.9.0 cross-compiles cleanly for `aarch64-linux-android`, so no generated-PDF-cover fallback was needed. The SAF adapter reads whole file bytes (`open_file_readable` + `read_to_end`) rather than mmap; correct, but a large-PDF memory/performance check belongs on the phone.

**Skipped files** appear in `ScanReport.skipped` as `{ name, reason }` with stable reasons `unreadable`, `invalid_epub`, `invalid_pdf`; Settings shows the first two. Reasons never carry a full path.

### Code-review fixes (2026-11-24)

Status kept at `awaiting-device-test`.

- Reading status is gone from the detail panel (the shelf ribbon/seal is the only status cue); the e2e assertion for it was removed.
- Rescans now read only the 128 KiB head/tail quick key and match it against stored keys, so unchanged files are never read whole; only new or changed quick keys get a full BLAKE3. Rename/move, duplicate rejection and finish-on-removal keep working through the same path.
- A missing cover cache is rebuilt from the source (embedded or PDF-rendered) on detail open, and `cover_source` is repaired in the database; an unreadable file falls back to the generated plate.
- PDF metadata now fills series, language, publisher and identifier from Info entries, splits authors on semicolons or the word `and` (not commas, so "Le Guin, Ursula K." stays one author), rejects only the named junk titles, and strips the extension from the final filename fallback.
- Tests assert behaviour through the command API: quick keys by counting whole-file reads, reading state and labels by API reads (small reading/label seams added), and no direct `books`/`reading_state`/`content_hash` helpers remain.
- `quick_key` and `cover_source` no longer cross the wire (`#[serde(skip)]` + TypeScript types removed).
- Quality: panel enters with the spec's 480 ms transform ease plus 240 ms opacity, spine hover uses transform/opacity, `insert_book` takes a `NewBook` struct, and `ExtractedBook` was removed.

New fixtures/tests: EPUB 2 metadata, manifest first-image cover fallback, rich PDF (series/language/publisher/identifier/3 pages), cover-cache deletion restores the real cover, unreadable cover falls back to generated, unchanged rescan makes zero whole-file reads, and rename keeps API-seeded labels plus progress/locator.

## Verification

- `cargo test --manifest-path core/Cargo.toml`: 42 passed (generated EPUB 2/3 with/without cover, first-image fallback, rich metadata, minimal and rich PDF, page count, rendered cover, fallback cover, filename fallback, dedupe by content, rename survival with id/labels/status/progress/locator, quick-key rescan with zero whole-file reads, cover-cache repair, malformed skip, v1→v2 reset, path-free and internals-free wire).
- `npm run test:e2e`: 11 passed, including tap spine → cover/title/author/blurb → Back returns to the wall, and Escape/scrim dismissal.
- `npm run build` and `npx tsc --noEmit`: pass.
- Android clippy `--target aarch64-linux-android --all-targets -- -D warnings`: pass (hayro included).
- Signed release APK built with `npm run tauri android build -- --apk --target aarch64 --ci`; `apksigner verify` reports `CN=PocketLibrary, O=Personal, C=US`.
- APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 15,778,502 bytes, SHA-256 `47bbb695f2d00891de982d975d7ab82e6501e9339bc85b628fe85f123903f987`; tunnel URL returned HTTP 200.

## Only a phone can confirm

- A real SAF tree returns seekable/readable bytes for a large PDF and a nested EPUB, and the scan completes without memory pressure.
- Renaming or moving real files in the Android file manager keeps one book and its status/progress.
- Real-world EPUB/PDF metadata and covers (including damaged, DRM-ish and cover-less files) look right in the Android WebView; generated covers render at phone scale.
- The signed release APK installs over the previous build and the v2 reset/rebuild behaves on device.
- Scroll position behind the detail panel is preserved on the real WebView, not only in Chromium.
