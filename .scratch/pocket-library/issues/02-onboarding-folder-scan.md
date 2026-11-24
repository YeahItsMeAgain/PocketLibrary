# 02: Onboarding, folder grant, and scan

**What to build:** First run explains Android folder access, opens the SAF picker, persists the grant, and scans recursively for EPUBs and PDFs. Books appear as spines on the wall. The grant survives relaunch; a revoked or moved folder shows a reconnect state, never a silent empty shelf.

**Blocked by:** 01

**Status:** awaiting-device-test

- [x] First run explains why a folder must be chosen and opens the picker; the user can create or choose a subfolder
- [ ] The read/write grant persists across force-stop and relaunch without re-picking
- [x] Recursive scan finds `.epub` and `.pdf`, ignores hidden directories and other files
- [x] Each found book produces a catalogue record and a spine on the wall
- [x] An empty library shows empty shelves with "Add books" and "Find a book"
- [x] A revoked or moved folder shows "Reconnect library folder" instead of an empty shelf
- [x] Manual rescan adds new files and reflects removed ones without duplicating

## Notes

Code-review fixes (2026-11-24), status kept at `awaiting-device-test`:

- A failed directory listing (including an over-deep tree) now aborts the scan with `library_unavailable` and performs no reconciliation, so a partial tree cannot mark books finished.
- Removals are idempotent: only books not already finished transition, `progress` and `status_source` are preserved, and a repeat removal scan reports zero removed.
- Raw SAF/database causes stay in logs; the wire carries a stable message and machine code. Unused folder-clear API and `SourceEntry.len`/`modified` were removed.
- Quality: shared settings lookup for shelf capacity, Rust timestamps for settings, `api_error` naming, typed `ApiError` plus `isLibraryUnavailable` in `platform.ts`, and shared scan fallback logic in `App.tsx`.

New tests: failed subfolder leaves all books untouched; over-deep tree aborts; second removal scan reports nothing and preserves progress/`finished_at`; serialised source error contains no path fragment.

Verification: `cargo test --manifest-path core/Cargo.toml` (16 passed), `npm run test:e2e` (8 passed), `npm run build`, `npx tsc --noEmit`, Android clippy `-D warnings`, and a debug APK rebuild with `apksigner verify`.

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, 303,866,552 bytes, SHA-256 `da9ee4d5cf70e71ca9b06ae3b9193eec6d4ccd59482cfadbb8ac73443b0528e8`.

Visual cue (2026-11-24): a minimal finished seal / reading ribbon was pulled forward from 06 so removed-finished files are distinguishable now; full label system still tracked in 06.
