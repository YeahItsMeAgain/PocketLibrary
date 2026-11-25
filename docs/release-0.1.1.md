# PocketLibrary 0.1.1 release notes

Patch release focused on making a family member's problem report one tap away.
Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.1`
(versionCode `1001`), Android 8.0+ (API 24, targets API 36).

## Included

- **Diagnostics log.** A rolling `diagnostics.log` in app data records startup
  (version/schema), folder grant and scan results, import/export, download
  transitions and failures, reader opens/failures, migrations, Rust panics and
  JS errors/unhandled rejections. Capped near 2 MB and 7 days; paths and book
  titles are kept because the log stays on the family's device, but keystore
  secrets, passwords, tokens and book contents are never written.
- **Session marker.** Each launch writes a session-start line and a clean
  shutdown marker. A missing marker on the next launch is logged as
  "previous session ended unexpectedly".
- **One-tap export.** Settings → Help & diagnostics offers **Send diagnostics**
  (Android share sheet with `pocketlibrary-diagnostics.zip`, falling back to the
  system save picker), **Copy summary**, log size, last error and **Clear logs**.
  The zip holds `diagnostics.txt`, `summary.json` (app/schema/Android/device and
  library counts) and `recent-failures.txt` (last 20). No network calls. See
  [`diagnostics.md`](diagnostics.md) for the full guide.
- **Report actions.** Scan, download, import and reader failures offer the same
  export directly. After three failures in a session a gentle one-time hint
  points to Help & diagnostics.
- **Reader back and progress.** The persistent `← Library` pill is gone; the
  top-bar Back, Escape and Android/browser back remain, along with the
  always-visible bottom progress bar and readout.
- **Drawer stability.** The entrance animation now runs only for a genuine tap,
  so drag-opened drawers and snap-backs no longer replay it or flicker.

## Upgrade notes

- Install over 0.1.0 without uninstalling: the release key is unchanged
  (`CN=PocketLibrary`), so the database, folder grant, shelves, labels, covers,
  reading progress, annotations and settings survive. No manual migration step
  is required.
- Keep the same signing key. A debug build cannot be upgraded to this release
  (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- Book files are never copied into the app. They stay in the SAF-granted folder
  and are re-read in place.
- The first launch after upgrading begins a new diagnostics session; logs from
  before the upgrade are not carried over because 0.1.0 did not write them.

## Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 82 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| Android `cargo clippy --all-targets -- -D warnings` | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.1, code 1001, min 24, target 36 |

APK:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,359,638 bytes** · SHA-256
`80ccd6cab3f2f814bc256b49386e15e37a1b88cf13c2980994b9b3dd33ea4de1`
· certificate SHA-256
`f2167c3918933cd2fe247fb5748e7b699f925d8f6f716eec04da9f862d1dcbdb`.

## Known gaps

- **Device pass pending.** No phone or emulator was attached during the release
  build. The README device checklist still needs a physical device, including
  install-over-upgrade, SAF reads, touch selection, pinch zoom, backup pickers,
  the Android back stack and the final smoke.
- **Share sheet is device-only.** The WebView share path is mocked in Playwright;
  verify the Android share sheet on a real phone, including the SAF fallback.
- **First paint** misses the 400 ms proxy budget (475.7 ms at 4× CPU throttle);
  scroll, filter and drag budgets pass. See
  [`perf-shelf-benchmark.md`](perf-shelf-benchmark.md).
- **External reader cancel:** Android does not report which app was chosen, so
  cancelling the open-with chooser after a handoff can still mark the book as
  reading on the next resume.
- **PDF memory:** books are transported whole. Files over 100 MB are refused
  with a clear message; a 90 MB PDF can still spike memory (Rust + IPC + PDF.js
  each hold a copy). Streaming/range transport is future work.
- **Annotations are EPUB-only.** PDF has no highlights or notes in this release.

## Device-only check

Verify on a phone that **Send diagnostics** opens the Android share sheet with
`pocketlibrary-diagnostics.zip` (one tap to email, WhatsApp or Drive), and that
refusing file sharing falls back to the SAF save picker. Also check that
**Copy summary** and **Clear logs** work and that Android back unwinds sheets,
then the reader, then the app.

## Previous release

See [`release-0.1.0.md`](release-0.1.0.md) for the first sideloadable release.
