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

## Verification

- `cargo test --manifest-path core/Cargo.toml`: 35 passed (generated EPUB with/without cover, rich metadata, minimal PDF, page count, rendered cover, fallback cover, filename fallback, dedupe by content, rename survival with id/status/progress, quick-key stability, malformed skip, v1→v2 reset, path-free wire).
- `npm run test:e2e`: 11 passed, including tap spine → cover/title/author/blurb → Back returns to the wall, and Escape/scrim dismissal.
- `npm run build` and `npx tsc --noEmit`: pass.
- Android clippy `--target aarch64-linux-android --all-targets -- -D warnings`: pass (hayro included).
- Signed release APK built with `npm run tauri android build -- --apk --target aarch64 --ci`; `apksigner verify` reports `CN=PocketLibrary, O=Personal, C=US`.

## Only a phone can confirm

- A real SAF tree returns seekable/readable bytes for a large PDF and a nested EPUB, and the scan completes without memory pressure.
- Renaming or moving real files in the Android file manager keeps one book and its status/progress.
- Real-world EPUB/PDF metadata and covers (including damaged, DRM-ish and cover-less files) look right in the Android WebView; generated covers render at phone scale.
- The signed release APK installs over the previous build and the v2 reset/rebuild behaves on device.
- Scroll position behind the detail panel is preserved on the real WebView, not only in Chromium.
