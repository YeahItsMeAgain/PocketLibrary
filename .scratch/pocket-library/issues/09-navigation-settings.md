# 09: Navigation and settings shell

**What to build:** The hidden brass drawer opens Library, Search, and Settings by pull or gesture and closes by drag, scrim, Escape, or Android back. Settings holds folder, rescan, reader defaults, download naming, and About. Empty and permission-recovery states are reachable from here.

**Blocked by:** 02

**Status:** awaiting-device-test

- [x] A brass pull at the bottom edge opens the drawer by tap, upward swipe, or drag
- [x] Library, Search, and Settings each open their surface; Library returns to the wall
- [x] Dragging the drawer down past the threshold closes it; otherwise it snaps back
- [x] Escape and Android back close one layer at a time and never leave the app while a layer is open
- [x] Settings shows library folder + rescan, reader defaults, download naming, and About
- [x] The drawer hint appears once and does not return after dismissal

## Notes

- **One back stack.** `src/navigation.ts` replaces the reader's private history hook with one shared guard entry for the drawer, book detail, label manager, Search/Settings and the reader. Opening another layer replaces the guard token in place; only the last close pops it. Escape and browser/Android back go through the same close callback as buttons and scrims, so a layer cannot close twice and a drawer open over a sheet cannot also close the sheet.
- **Drawer.** Tap, upward drag on the pull, or an edge drag opens it; the rail follows the pointer and snaps open or closed on release. Dragging down past a quarter of the rail (or a fast downward flick) closes it. The scrim is now clickable (the full-screen drawer wrapper no longer intercepts it). Library/Search/Settings are the only items, with no floating tab bar. The one-time hint is written to storage as soon as it appears, so a timeout or reload cannot bring it back.
- **Search and Settings.** Search is a real front-desk placeholder with a labelled Back to shelf and a working back path until ticket 10. Settings has Library (folder, access, rescan, change folder), Reader defaults (paginated/scroll, Paper/Sepia/Night, five text sizes) wired to `reader/settings`, shelf capacity, natural download naming (`Author - Title (Year)`) clearly marked as a ticket-11 placeholder, Export/Import buttons disabled and labelled ticket-12 placeholders, and About with app version/schema plus font/engine licences. The wall keeps version text visually hidden and out of the accessibility tree; it is shown only in Settings.
- **Placeholders.** Download naming is read-only until 11; Export/Import are disabled until 12. Both say so in the UI rather than pretending to work.
- **Final integration (2026-11-25).** Download naming is now an editable pattern, not a placeholder. Settings loads the persisted pattern from the core, previews a live example, saves, resets to `{author} - {title} ({year})` and surfaces the typed `invalid_download_naming` error for blank, unknown-placeholder or unbalanced patterns. The search result sheet and the EPUB/PDF reader sheets (Contents, Type/Zoom, Annotations, note editor) now join the shared back stack, so Escape/Android back closes the top sheet, then the Search view or reader, then returns to the wall. Playwright covers naming save/reset, Search detail back, and reader sheet back; all 73 tests pass.
- **Tests.** `tests/e2e/navigation.spec.ts` covers tap + synthetic upward drag, drag-down close and short-drag snap-back, scrim/Escape/browser back, each destination's back path, detail browser back, persisted reader defaults, one-time hint, About/placeholders, and that no guard history entry is left behind after closing. All 50 Playwright tests pass, including the existing reader, detail, labels, drag and CSP suites.

## Verification

- **Final integration (2026-11-25):** `cargo test --manifest-path core/Cargo.toml`, `npm run test:e2e` (73 pass), `npm run build`, `npx tsc --noEmit` and Android clippy `-D warnings` all pass.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 35,117,598 bytes, SHA-256 `6514a0c6e941e0771d8fc2b070a125fd5a4c3c3f4b17c1de2bca1a2239652ff8`, signer `CN=PocketLibrary, O=Personal, C=US`. Published path returns HTTP 200 (same 35,117,598 bytes).

## Device-only checks

- Android hardware/gesture back on a real phone: one press closes the drawer/detail/sheet/reader without leaving PocketLibrary, including after a force-stop/relaunch.
- Drawer edge-drag and upward-swipe feel, rail follow and snap threshold on a touch screen; scrim tap under the Android WebView.
- Settings scroll, tap targets for size/theme chips, and the About/licence block at a 390x844 safe-area viewport.
- Reader defaults chosen in Settings actually open the next EPUB/PDF with that theme, size and mode on device.
