# 07: EPUB reader

**What to build:** In-app EPUB reading behind a strict CSP: immersive chrome, tap zones, paginated or scrolled text, Contents with chapters and bookmarks, typography and themes, and remembered position.

**Blocked by:** 03

**Status:** awaiting-device-test

- [x] An EPUB opens in the reader with the strict CSP in place; a scripted EPUB cannot reach the app origin
- [x] Centre tap toggles a slim top and bottom bar; left/right thirds page; first/last page does nothing
- [x] Paginated mode and vertical scroll both work; the choice is global and remembered
- [x] Contents sheet has Chapters and Bookmarks tabs; the bookmark button adds a ribbon and bookmarks survive relaunch
- [x] Five sizes, three line spacings, two margins, Paper/Sepia/Night, and three bundled serifs all apply
- [x] Position resumes on reopen, including after a re-render or a small text shift
- [ ] "Back to shelf" and "Open in another app" both work; back unwinds one layer at a time

## Notes

- **Engine:** `foliate-js` at pinned commit `78914aef4466eb960965702401634c2cb348e9b1`, vendored under `src/vendor/foliate/` (MIT, see `UPSTREAM.md`). Only the EPUB path is vendored; the upstream comic/FB2/MOBI/PDF branches are removed. No fallback to `@likecoin/epub-ts` was needed.
- **Bytes without paths:** `read_book` Tauri command returns a raw `tauri::ipc::Response` (no JSON/base64). Android resolves the book's library-relative path through the SAF tree in the shell; the path and content URI never cross the command wire. The file is materialised once in Rust and once in the WebView Blob, which is acceptable for M1; very large EPUBs need headroom.
- **CSP:** strict policy configured in `tauri.conf.json` and mirrored as a build-time `<meta>` tag (`script-src 'self'`, `frame-src blob:`, no `script-src blob:`). The CSP regression test runs against `vite preview`; the scripted EPUB's inline `<script>` and `<img onerror>` do not set `parent.__PWNED`. Device WebView check still required.
- **Bookmarks/position:** stored in `annotations` (`kind='bookmark'`) and `reading_state.locator` as versioned JSON (`v:1`, CFI, quote, progress). CFI restores first; a failed CFI falls back to foliate's text search. Bookmarks and positions persist through relaunch.
- **Status:** `record_open` on first open, `record_progress` while reading and at the end (≥98%). Manual overrides still win.
- **External reader:** deferred. The top bar button is labelled "Open in another app" and shows an honest deferred notice; no share intent or content-URI FileProvider was implemented this session. This is the only unticked box.
- **Device-only checks:** verify the scripted EPUB under Android System WebView (CSP inheritance from the app origin into foliate's blob iframe), the SAF `read_book` path on a real folder, and tap-zone feel on a physical screen.

## Verification

- `cargo test --manifest-path core/Cargo.toml` — pass, including bookmark CRUD.
- `npm run test:e2e` — 31 pass (reader, CSP, existing suites).
- `npm run build` / `npx tsc --noEmit` — pass.
- Android clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` — pass.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 15,980,230 bytes, SHA-256 `0773203d35ae31d1461b1b9a062a291674620e40d69a4032a668ac3549d1358b`, signer `CN=PocketLibrary`.
