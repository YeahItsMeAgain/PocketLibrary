# PocketLibrary release notes

## 0.1.1 — Diagnostics and log export

Patch release focused on making a family member's problem report one tap away.
Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.1`
(versionCode `1001`), Android 8.0+ (API 24, targets API 36).

### Included

- **Diagnostics log.** A rolling `diagnostics.log` in app data records startup
  (version/schema), folder grant and scan results, import/export, download
  transitions and failures, reader opens/failures, migrations, Rust panics and
  JS errors/unhandled rejections. Capped near 2 MB and 7 days; no command
  details are redacted because the log stays on the family's device, but
  keystore secrets, passwords, tokens and book contents are never written.
- **Session marker.** Each launch writes a session-start line and a clean
  shutdown marker. A missing marker on the next launch is logged as
  "previous session ended unexpectedly".
- **One-tap export.** Settings → Help & diagnostics offers **Send diagnostics**
  (Android share sheet with `pocketlibrary-diagnostics.zip`, falling back to the
  system save picker), **Copy summary**, log size, last error and **Clear logs**.
  The zip holds `diagnostics.txt`, `summary.json` (app/schema/Android/device and
  library counts) and `recent-failures.txt` (last 20). No network calls.
- **Report actions.** Scan, download, import and reader failures offer the same
  export directly. After three failures in a session a gentle one-time hint
  points to Help & diagnostics.
- **Reader chrome.** The persistent `← Library` pill is gone; the top-bar Back,
  Escape and Android/browser back remain, along with the always-visible bottom
  progress bar and readout.
- **Drawer.** The entrance animation now runs only for a genuine tap, so
  drag-opened drawers and snap-backs no longer replay it or flicker.

### Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 82 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| Android `cargo clippy --all-targets -- -D warnings` | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.1, code 1001, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,359,638 bytes** · SHA-256
`80ccd6cab3f2f814bc256b49386e15e37a1b88cf13c2980994b9b3dd33ea4de1`
· certificate SHA-256
`f2167c3918933cd2fe247fb5748e7b699f925d8f6f716eec04da9f862d1dcbdb`.
Published path
`https://tunnel.invalid/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
returned HTTP 200.

### Device-only check

The real Android WebView share sheet was not exercised on a phone. Verify on
device that **Send diagnostics** opens the Android share sheet with
`pocketlibrary-diagnostics.zip` (one tap to email, WhatsApp or Drive), and that
refusing file sharing falls back to the SAF save picker.

## 0.1.0

First sideloadable release. Android-only, arm64-v8a, package
`app.pocketlibrary`, version `0.1.0` (versionCode `1000`), Android 8.0+ (API 24,
targets API 36).

## Included

- **Library room.** One SAF-granted folder read in place; recursive EPUB/PDF
  scan with BLAKE3 identity, metadata and covers, rescan/relink.
- **Shelves.** Fixed manual cases, model-arithmetic long-press drag, labels and
  reading status shown as spine cues, filters that dim without moving books,
  2,000-book progressive mounting.
- **Reader.** EPUB (foliate-js) and PDF (PDF.js) in one immersive shell with tap
  zones, paginated/scroll modes, Contents and bookmarks, five sizes, three line
  spacings, two margins, Paper/Sepia/Night, three bundled serifs, remembered
  position. EPUB highlights and notes with four colours and a repaired CFI
  fallback; PDF fit-width, pinch zoom, page jump and outline.
- **Acquisition.** Libgen search across mirrors, result detail, two-at-a-time
  download queue with progress/cancel/retry, failover, duplicate checks and
  `Author - Title (Year)` naming into the granted folder.
- **Backup.** One versioned archive of shelves, labels, reading state,
  annotations, settings and download history; merge by content hash is the
  default, replace needs explicit confirmation.
- **Identity.** Name PocketLibrary, dark purple logo and adaptive launcher icon
  on an aubergine background, matching dark window/splash background on Android
  12+, `CN=PocketLibrary` release signing.

## Verification

All checks ran on 2026-11-25 on the headless build host:

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 74 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| Android `cargo clippy --all-targets -- -D warnings` | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.0, code 1000, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,122,454 bytes** · SHA-256
`cdb2461256adaf19d0b9f83b9edec87d517d8ddb1512699bcb3684fac9cf786f`
· certificate SHA-256
`f2167c3918933cd2fe247fb5748e7b699f925d8f6f716eec04da9f862d1dcbdb`.
Published locally from
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
and served over a temporary tunnel for the device test (URL not retained).

### 2,000-book benchmark (release run)

`PERF_LABEL=release-0.1.0 node perf/bench.mjs` — Chromium proxy, 390×844 @1x,
4× CPU throttle, 2,000 books / 182 shelves. Raw:
`perf/results/release-0.1.0.json`.

| Metric | Result | Budget |
|---|---:|---:|
| First shelf interactive | 481.3 ms | < 400 ms — **miss** |
| Scroll warm p95 / p99 | 18.3 / 22.1 ms | ≤ 20 / ≤ 33 ms — pass |
| Scroll cold p95 / p99 | 22.8 / 35.4 ms | diagnostic |
| Long tasks > 50 ms | 2 (load only) | 0 — **miss** |
| Renderer DOM | 11.3 MB / 1,807 nodes | < 15 MB — pass |
| Filter apply | 36 ms sync / 74.1 ms settled | < 50 ms sync — pass |
| Filter clear | 12.6 ms sync / 47.6 ms settled | < 50 ms sync — pass |
| Lift-time layout | 0 ms sections / 6.5 ms spines | low ms — pass |

## Known limitations

- **Device testing is pending.** No phone or emulator was attached. Installing
  over a previous release, SAF reads on real hardware, touch selection, pinch
  zoom, backup pickers, the Android back stack and the final smoke still need a
  physical phone.
- **First-paint budget.** 481.3 ms against 400 ms at 4× throttle; the proxy's
  app-startup floor is the main cost. Scroll, filter and drag budgets pass.
- **External-reader cancel caveat.** Android does not report which app was chosen
  from the open-with chooser. A handoff is remembered and the book is marked
  reading on the next resume, so cancelling the chooser can also count as a
  return.
- **PDF memory cap.** Books travel whole. Files over 100 MB are refused with a
  clear message, but a 90 MB PDF can still spike memory because Rust, the IPC
  buffer and the PDF.js worker each hold a copy. Streaming/range transport is
  future work.
- **Annotations are EPUB-only.** PDF has no highlight or note UI in this
  release.
- **No desktop or iOS build; sideload only.** No Play Store distribution,
  accounts, cloud sync or telemetry.
