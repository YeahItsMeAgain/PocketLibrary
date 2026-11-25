# 12: Backup and restore

**What to build:** Export the irreplaceable part of the library — shelves, labels, reading state and positions, annotations, settings, download history — to one versioned file, and restore it later by merging or replacing.

**Blocked by:** 06, 07, 09

**Status:** awaiting-device-test

- [x] Export writes one versioned archive containing the metadata and optional covers, not the books, via the system file picker
- [x] Import inspects the archive and reports matched and new entries before applying
- [x] Merge matches by content hash, adds missing entries, never deletes, and never overwrites a newer reading position
- [x] "Replace current library data" is available behind an explicit confirmation
- [x] A corrupt, older, or wrong-schema archive is rejected with a clear reason
- [x] No book files are copied or moved by export or import

**Core archive done (2026-11-25):** versioned zip + manifest, preview, merge-by-hash, replace, cover handling and corruption rejection are implemented and covered by 7 core tests. SAF transport, Settings UI and the external-reader handoff remain for the second pass.

## Notes

- **SAF transport.** `export_backup` opens the Android create-document picker, writes the archive bytes through the returned content URI and reports the chosen name, size and book count. `preview_backup` opens the open-document picker, reads the archive into the shell, inspects it, and holds it behind an opaque token; `import_backup` accepts only that token plus `merge`/`replace`. No path or content URI crosses the command wire.
- **UI.** Settings exports with a success summary, and imports into an inline preview showing matched/new counts. Merge is the default primary action; replace opens a second explicit confirmation that names what is cleared. Archive errors use the core's typed messages (`archive_corrupt`, `archive_unsupported_version`, `archive_wrong_schema`).
- **External reader.** The book detail and EPUB reader now invoke `open_book_externally`, which resolves the SAF document URI in the shell and shows the Android open-with chooser. The shell no longer marks the book when the chooser opens: it remembers the handoff and marks the book reading on the next Android resume. That is best effort — Android does not report which app was chosen, so cancelling the chooser can still count as a return — but nothing is marked while the chooser is merely open. The browser mock still returns the real unsupported error rather than pretending success.
- **Post-import rescan (2026-11-25).** The import command now runs a rescan immediately after merge/replace and returns it with the report. Restored pathless books are matched by content hash, get their local path back, and are counted as `relinked`; Settings shows linked, new and missing counts in the import summary. A missing folder grant leaves the import successful and reports the rescan reason instead of failing the restore. Playwright covers the summary and core keeps the pathless-to-linked test.
- **Tests.** Playwright covers export success, import preview + merge, replace confirmation, corrupt archive rejection, and asserts no `.epub`/`.pdf` request occurs during any backup flow. Core tests still own archive semantics.

## Verification

- `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` — pass.
- `npm run test:e2e` — 73 pass (final integration).
- `npm run build`, `npx tsc --noEmit` — pass.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 35,117,598 bytes, SHA-256 `6514a0c6e941e0771d8fc2b070a125fd5a4c3c3f4b17c1de2bca1a2239652ff8`. Signer DN `CN=PocketLibrary, O=Personal, C=US`. Published path returns HTTP 200.

## Device-only checks

- Export to Downloads and to a cloud/Drive provider, reopen the picked archive, and confirm an existing `.pocketlibrary` name does not corrupt the destination.
- Import a real exported archive, check matched/new counts, merge, and confirm newer phone progress survives.
- Replace on a throwaway library and confirm the second confirmation is required.
- Pick a corrupt/truncated file and a real EPUB to confirm both are rejected with the right message rather than crashing.
- Open a book in another reader, return, and confirm it is marked reading (unless finished) and no book file changed.

