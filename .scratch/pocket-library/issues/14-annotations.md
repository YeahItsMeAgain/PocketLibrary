# 14: Annotations

**What to build:** Highlights, notes, and bookmark UI in the EPUB reader, anchored so they survive re-renders and small text shifts. This is M4; the data model and internal selection wiring already exist.

**Blocked by:** 07

**Status:** awaiting-device-test

- [x] Text can be selected and highlighted in four colours
- [x] A note can be attached to a highlight and edited or deleted
- [x] Annotations use a Readium-shaped Locator plus text-quote and text-position fallbacks
- [x] A CFI that no longer resolves falls back to the quote and is repaired on next save
- [x] An annotation list per book supports jumping to and deleting entries
- [x] Annotations persist across relaunch and are included in backup/export

## Device-only checks

- **Final integration (2026-11-25).** The reader's Contents, Type/Zoom, Annotations and note-editor sheets now register with the shared layer guard. Escape and Android/browser back close the open sheet first and the reader on the next press, with no extra history entries; Playwright covers the EPUB Contents and Type sheets. Naming, backup-rescan and the rest of the reader/annotation behaviour remain intact (73 Playwright tests). Release APK 35,117,598 bytes, SHA-256 `6514a0c6e941e0771d8fc2b070a125fd5a4c3c3f4b17c1de2bca1a2239652ff8`, signed `CN=PocketLibrary`; published path HTTP 200.
- Real finger selection inside the Android WebView, including the selection handles
  and the popover placement above the selection. Playwright drives the same DOM
  selection and `selectionchange` path programmatically because browser selection
  handles are not reliable in headless Chromium.
- Long-press word selection and the touch target size of the four swatches on a
  real phone.
- A release APK was built and signed (`CN=PocketLibrary`), but installing it and
  reading a real SAF-backed EPUB still requires the phone.
