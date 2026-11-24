# 08: PDF reader

**What to build:** PDFs open in the same reader shell with the same chrome, Contents, bookmarks, progress, themes, and position memory, but as fixed pages: fit-width, pinch zoom, and page jump.

**Blocked by:** 07

**Status:** awaiting-device-test

- [x] A PDF opens in the reader with the same top/bottom bars and tap zones
- [x] Fit-width is the default; pinch zoom and page-number jump work
- [x] Paper/Sepia/Night apply as a tint without reflowing the page
- [x] Position resumes at the same page; progress reflects pages read
- [x] Contents lists the PDF outline where present; bookmarks work
- [x] Font-size controls are replaced by zoom and text reflow is absent

## Notes

- **Engine and assets:** `pdfjs-dist` pinned to `6.5.438`. The worker is a Vite `?url` asset (local, hashed, no CDN); `cmaps/`, `standard_fonts/` and `wasm/` are copied from `node_modules` to `public/pdfjs/` by `scripts/sync-pdfjs-assets.mjs`, which runs before `dev` and `build`. The text layer is enabled.
- **Shell:** `PdfReader` reuses the same `reader` chrome classes and test ids as the EPUB reader: labelled Back, centre-tap toggle, left/right thirds, Contents sheet with Contents/Bookmarks tabs, theme cycle and bookmark ribbon. The type sheet becomes a zoom sheet (fit width, −/+, value); the top bar adds a page-number form. No reflow: pages render to canvas and themes are a tint layer (plus a night filter on the canvas).
- **Position:** a versioned locator `{v:1, page, progress, quote}` is stored in `reading_state.locator` via `record_progress`; reopening clamps the stored page and renders it. Progress is `page / pageCount`, so page 1 of 3 reads 33% and the final page reads 100% and resolves `finished`.
- **Large PDFs:** the Rust `read_book` path now reads at most 100 MiB + 1 byte through `read_path_limited` and returns `code: "book_too_large"` with a clear message rather than growing the allocation. The web reader repeats the 100 MiB check before handing bytes to PDF.js. This is still a whole-file transport: Rust, IPC and the PDF.js worker each hold a copy, so a 90 MiB PDF can spike memory even though it passes the guard. Range/streaming transport is future work.
- **CSP:** production policy keeps `script-src 'self'` and adds only `'wasm-unsafe-eval'`; `worker-src 'self' blob:`, `connect-src 'self'` and the existing image/font allowances let the local worker, cmaps, fonts and wasm load. The built-app test opens the PDF under `vite preview`, verifies a painted canvas and non-empty text layer, and asserts no CSP refusals; the scripted-EPUB test still passes (scripts blocked).
- **Fixture:** `test-assets/sample.pdf` (also mirrored in `public/test-assets/`) is a self-authored three-page PDF with a two-entry outline (Chapter One, Chapter Two). Its filler text is original and dedicated to CC0 1.0; no third-party fonts or content. See `test-assets/README.md`.
- **No annotations:** none are created or rendered for PDF in M1, as scoped.

## Verification

- `cargo test --manifest-path core/Cargo.toml` — pass (13 scan tests plus catalog tests).
- `npm run test:e2e` — 34 pass, including the new PDF reader/resume/theme/zoom/outline/bookmark tests and the built-app PDF worker/CSP test.
- `npm run build` / `npx tsc --noEmit` — pass.
- Android clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` — pass.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 18,492,750 bytes, SHA-256 `dd9cb4e46c82ea54fff23c7256cb4bebd5a0d0f554dde99ff77a2a46070bbe82`, signer `CN=PocketLibrary, O=Personal, C=US`. Published path returns HTTP 200.

## Device-only checks

- Pinch-to-zoom and one-finger pan at zoom on a physical touch screen (headless Chromium only exercises the ± buttons).
- Tap-zone feel with a real page taller than the viewport, and safe-area insets on the top/bottom bars.
- Open a genuinely large (50–95 MiB) PDF and a >100 MiB PDF over SAF to confirm the memory headroom and the `book_too_large` message on the device.
- PDF outline resolution for real-world outlines (deep nesting, named destinations) and a password-protected PDF's error.
- Android System WebView CSP: local module worker + wasm under `http://tauri.localhost` (the preview test proves desktop Chromium).
