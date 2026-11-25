# PocketLibrary 0.1.2 release notes

First public release. Android-only, arm64-v8a, package `app.pocketlibrary`,
version `0.1.2` (versionCode `1002`), Android 8.0+ (API 24, targets API 36).

0.1.2 rolls up the 0.1.0 and 0.1.1 work plus the architecture, performance and
update changes below.

## Highlights

- **Updates from inside the app.** Settings → Updates checks the latest GitHub
  Release, shows the version, date, size and notes, and downloads only when you
  tap the button. The APK is checked against its SHA-256 and a version-bound
  minisign signature before Android's package installer is opened. There is no
  silent install: Android shows its normal consent screen. If **Install unknown
  apps** is off, PocketLibrary opens the per-app setting and offers a retry.
  The app signing key is unchanged, so updates install over 0.1.0/0.1.1 and keep
  the database, folder grant, shelves, labels and reading progress.
- **A faster, lighter library.** `App.tsx` went from 4,865 to 649 lines with
  feature modules for the shell, library, labels, search, downloads, settings
  and backup. The wall now mounts only the visible shelves plus one on each
  side and recycles them, so traversing a 2,000-book library no longer keeps
  every shelf alive. Filtering is memoised and applied outside React's render
  path; the 2,000-book DOM pass measures under 1 ms. Search, Settings, book
  detail and the label manager load on demand, the first-paint noise tile
  shrank from 82 kB to 9.09 kB, and a shelf skeleton paints while the first
  catalogue request is in flight.
- **Diagnostics and one-tap support.** A rolling local `diagnostics.log`
  captures startup, folder/scan, import/export, downloads, readers, migrations,
  panics and JS errors. Settings → Help & diagnostics can send a zip through the
  Android share sheet (SAF fallback), copy a summary, or clear logs. Scan,
  download, import and reader failures offer the same export. No network calls,
  no telemetry.
- **Reader and drawer polish.** The persistent `← Library` pill is gone; the
  top-bar Back, Escape and Android/browser back remain, along with the
  always-visible progress bar. Drag-opened drawers and snap-backs no longer
  replay the entrance animation.

## Measured results

At 4× CPU throttle with 2,000 books (see `docs/perf-shelf-benchmark.md`):

| Check | Result |
|---|---|
| First shelf | 505.7 ms (was 493.7 ms; 400 ms proxy budget still missed) |
| Scroll p95 / p99 | 19.1 ms / 25.6 ms |
| Filter DOM pass | 0.7 ms |
| Lift sweep p95 | 1.9 ms |
| DOM nodes | 3,435 |
| Full-wall traversal | +8.9% over the phase-1 baseline |

## Upgrade notes

- Install over 0.1.0 or 0.1.1 without uninstalling. The release key is unchanged
  (`CN=PocketLibrary`), so app data survives. A debug build cannot be upgraded
  to this release (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- 0.1.2 is the first build with the updater. Future updates are offered from
  Settings → Updates; a one-time **Install unknown apps** permission may be
  required for PocketLibrary.
- Book files are never copied into the app. They stay in the SAF-granted folder
  and are read in place.

## Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 102 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| `PERF_CHECK=1 node perf/bench.mjs` | pass |
| Android `cargo clippy --all-targets -- -D warnings` | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.2, code 1002, min 24, target 36 |

APK:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,440,818 bytes** · SHA-256 `837f8224797a8a64653f3230a6b977b85074fd5ee77ca280efe8a93ae47cf061`
· certificate SHA-256
`f2167c3918933cd2fe247fb5748e7b699f925d8f6f716eec04da9f862d1dcbdb`.

## Known gaps

- **Device pass not performed.** The refresh was verified with the core suite,
  102 Playwright tests and a perf check, but no phone or emulator was attached.
  In particular, the updater's unknown-apps consent, installer intent,
  install-over-upgrade and cancel paths are device-only, as are the share sheet,
  SAF pickers, touch gestures and Android back stack.
- **First paint** still misses the 400 ms proxy budget (495–532 ms at 4× CPU
  throttle). Initial `list_books` still loads the catalogue in one response, and
  the reader fonts stay unsubsetted because EPUB text is arbitrary; both are
  lazy-loaded after first paint.
- **PDF memory:** whole files are transported. Files over 100 MB are refused
  with a clear message; a 90 MB PDF can still spike memory (Rust + IPC + PDF.js
  each hold a copy). Streaming/range transport is future work.
- **Annotations are EPUB-only.** PDF has no highlights or notes in this release.
- **External reader cancel:** Android does not report which app was chosen, so
  cancelling the open-with chooser after a handoff can still mark the book as
  reading on the next resume.

See [`release-0.1.1.md`](release-0.1.1.md) and
[`release-0.1.0.md`](release-0.1.0.md) for the earlier notes, and
[`updates.md`](updates.md) for the updater design and key handling.
