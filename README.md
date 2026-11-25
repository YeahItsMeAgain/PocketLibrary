# PocketLibrary

[![CI](https://github.com/YeahItsMeAgain/PocketLibrary/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/YeahItsMeAgain/PocketLibrary/actions/workflows/ci.yml)

PocketLibrary is a private, Android-only reading room for an existing EPUB and
PDF library. It reads the books where they already live, lets you arrange them
on fixed manual shelves, and adds labels, reading status, a built-in reader with
EPUB annotations, Libgen search/downloads, one-file backup/restore, and a
one-tap diagnostics export. There is no account, cloud sync, or telemetry.

**Version:** 0.1.2 · **Package:** `app.pocketlibrary` · **Android 8.0+** (API 24;
targets API 36, arm64-v8a).

## What it is

PocketLibrary is for the reader who already has a folder of books and does not
want a store, an account or a sync service between them and the page. Point it
at a folder, and it scans EPUBs and PDFs in place, builds covers and metadata,
and lays them out as fixed wooden shelves you arrange by hand. Labels and
reading status appear as cues on the spines; filters dim rather than reshuffle.
A built-in reader remembers your place and supports highlights and notes in
EPUB, Libgen search can fetch a missing volume into the same folder, and the
whole library — shelves, labels, progress, annotations and settings — can be
exported to one archive. Everything stays on the device; diagnostics are local
and only leave when you choose to share them.

## A look inside

<table>
  <tr>
    <td align="center" valign="top">
      <img src="docs/assets/wall.webp" width="180" alt="PocketLibrary wall with two populated wooden shelves, spine labels and reading-status pips">
      <br><sub>The wall</sub>
    </td>
    <td align="center" valign="top">
      <img src="docs/assets/book-detail.webp" width="240" alt="Book detail sheet showing a cover, metadata, reading status and action buttons">
      <br><sub>Book detail</sub>
    </td>
    <td align="center" valign="top">
      <img src="docs/assets/drawer.webp" width="240" alt="Navigation drawer open over the library wall">
      <br><sub>The drawer</sub>
    </td>
    <td align="center" valign="top">
      <img src="docs/assets/epub-reader.webp" width="240" alt="EPUB reader in the Paper theme with chapter text, type controls and a progress readout">
      <br><sub>EPUB reader</sub>
    </td>
  </tr>
</table>

These are compressed copies of the release screenshots; the originals remain
under `prototype/design/screenshots/release/` and are not linked here.

## Status

**v0.1.2 is the first public release.** The signed APK builds, the Rust core
tests pass, the web build and type check pass, and 102 Playwright tests pass.
It adds in-app updates, a windowed shelf lifecycle and first-paint work. The
physical-device pass is still pending — no phone or emulator was attached for
the release build — so treat storage, sharing, touch and the Android installer
as verified only by proxy until the checklist below is run. Sideload only:
there is no Play Store listing, desktop build or iOS build.

## Architecture

- **Tauri 2 shell (Rust).** `src-tauri/` exposes thin commands over the core
  catalog, owns Android integration (SAF, share sheet, file pickers, back
  handling) and hosts the WebView.
- **Headless Rust core.** `core/` holds the SQLite catalog, scanning, metadata,
  covers, backup, downloads and diagnostics with no Tauri dependency, so it is
  tested on a normal Linux host.
- **SQLite catalog.** `rusqlite` with bundled SQLite and versioned migrations
  stores shelves, placements, labels, reading state, annotations, bookmarks and
  download history.
- **React UI.** React 19 + Vite renders the wall, detail sheets, search,
  downloads, settings, backup and the reader shell; styles are plain CSS.
- **One platform boundary.** Components never invoke Tauri commands directly.
  The typed adapter in `src/platform.ts` is the only native seam and is mocked
  in tests.
- **Storage Access Framework.** A user-granted folder is read in place through
  `tauri-plugin-android-fs`; books are never copied into app storage, and BLAKE3
  content hashes provide identity across rescans and relinks.
- **Readers.** EPUB uses vendored [foliate-js](src/vendor/foliate/) with
  highlights, notes, bookmarks and remembered position; PDF uses PDF.js with
  fit-width, pinch zoom, page jump and outline.
- **Acquisition and care.** Libgen search runs against several mirrors, with a
  two-at-a-time download queue, progress/cancel/retry and failover. Backup is a
  versioned archive with merge-by-default restore, and diagnostics are a local
  rolling log with a one-tap export.
- **Updates.** Settings checks the latest public GitHub Release, verifies the
  APK's SHA-256 and version-bound minisign signature, then hands it to Android's
  package installer. Downloads are explicit; installs are never silent. See
  [`docs/updates.md`](docs/updates.md).

## Install

The v0.1.2 release is a sideloaded, signed APK:

```bash
adb install -r app-universal-release.apk
```

The release is signed with the PocketLibrary key (`CN=PocketLibrary`). A debug
build cannot be upgraded to it and vice versa; uninstall the other build first
(`adb uninstall app.pocketlibrary`). Installing over a previous release with the
same key keeps the app's database, covers, and settings. Book files are never
copied into the app and remain in your chosen folder.

Release APK SHA-256:
`837f8224797a8a64653f3230a6b977b85074fd5ee77ca280efe8a93ae47cf061`.
See [`docs/release-0.1.2.md`](docs/release-0.1.2.md) for the full notes and
upgrade guidance.

On first launch, choose or create a folder such as `Documents/PocketLibrary`.
Android will not grant the storage root, `Download`, or a removable-storage
root; pick a normal subfolder.

## Build

The reproducible headless build path (JDK 21, Android SDK 36, NDK, Rust target,
release keystore) is documented in [`docs/build.md`](docs/build.md).

```bash
source scripts/android-env.sh
npm ci
npm run tauri android build -- --apk --target aarch64 --ci
```

The signed APK lands at
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
Secrets stay outside the repo in `$HOME/.android-keys/`; see
`docs/build.md` §6.

## Checks

```bash
cargo test --manifest-path core/Cargo.toml
npm run test:e2e
npm run build
npx tsc --noEmit
source scripts/android-env.sh
cargo clippy --manifest-path src-tauri/Cargo.toml \
  --target aarch64-linux-android --all-targets -- -D warnings
PERF_CHECK=1 node perf/bench.mjs
```

GitHub Actions runs the core tests, type check, web build and Playwright suite
on every push and pull request. The Android APK is not built in CI because it
needs the SDK, NDK and a local keystore; build and sign it locally.

## Device test checklist

Run these on a real phone against the signed release, not a debug build:

- [ ] Fresh install, then install the next release over it without uninstalling;
      the library folder grant, shelves, labels and progress survive.
- [ ] Choose a real folder, scan it, and confirm EPUB and PDF covers/metadata.
- [ ] Read an EPUB: page turns, swipe/tap, Contents, bookmark, position resume,
      highlight and note with a finger.
- [ ] Read a PDF: fit-width, pinch zoom, page jump, outline and position resume.
- [ ] Search Libgen, download a book, cancel/retry a slow download, confirm it
      lands on the lowest shelf with room.
- [ ] Export a backup to Downloads, import it, and confirm matched/new counts;
      try the explicit replace path on a throwaway library.
- [ ] Open a book in another app, return, and confirm it is marked reading.
- [ ] In Settings → Help & diagnostics, tap **Send diagnostics** and confirm the
      Android share sheet offers the zip to email/WhatsApp/Drive; if the WebView
      refuses file sharing, confirm the SAF save picker still writes it. Check
      `Copy summary` and `Clear logs`.
- [ ] Settings → Updates: check, read the notes, download, allow installs, and
      install over the previous build without losing data. Cancel the installer
      once and retry.
- [ ] Check Android back unwinds sheets, then the reader, then the app.
- [ ] Scroll a large library, drag a book, filter by label and status, and check
      the first-paint and memory numbers from `docs/perf-shelf-benchmark.md`.

## Known gaps in 0.1.2

- The checklist above is **pending on a physical device**; no phone or emulator
  was attached during the release build. This includes the updater's
  unknown-apps consent, installer intent, install-over-upgrade and cancel paths.
- **Share sheet is device-only.** The WebView share path is mocked in Playwright;
  verify the Android share sheet on a real phone, including the SAF fallback.
- **First paint** still misses the 400 ms proxy budget (495–532 ms at 4× CPU
  throttle). The initial catalogue request is still whole-library and reader
  fonts stay unsubsetted; scroll, filter and drag budgets pass. See
  `docs/perf-shelf-benchmark.md`.
- **External reader cancel:** Android does not report which app was chosen, so
  cancelling the open-with chooser after a handoff can still mark the book as
  reading on the next resume.
- **PDF memory:** books are transported whole. Files over 100 MB are refused with
  a clear message; a 90 MB PDF can still spike memory (Rust + IPC + PDF.js each
  hold a copy). Streaming/range transport is future work.
- **Annotations are EPUB-only.** PDF has no highlights or notes in this release.

See [`docs/release-0.1.2.md`](docs/release-0.1.2.md) for this release,
[`docs/release-0.1.1.md`](docs/release-0.1.1.md) for diagnostics and the reader
fixes, and [`docs/release-0.1.0.md`](docs/release-0.1.0.md) for the first build.

## Roadmap

- **Device verification.** Run the checklist on a physical phone against the
  signed 0.1.2 APK, especially the updater's unknown-apps flow,
  install-over-upgrade and cancel paths, plus the share-sheet fallback.
- **First paint and IPC.** The initial catalogue request still loads the whole
  library in one response. Trim it to the first window plus counts, then retry
  the 400 ms first-shelf budget at 4× throttle; reader fonts stay lazy because
  EPUB text is arbitrary.
- **PDF streaming.** Replace whole-file transport with range reads so large PDFs
  do not hold three copies in memory.
- **Maintainer care.** Back up the release keystore and the separate updater
  private key; losing either stops future installs or updates.

## Documentation

- [0.1.2 release notes](docs/release-0.1.2.md) · [0.1.1](docs/release-0.1.1.md) · [0.1.0](docs/release-0.1.0.md)
- [Diagnostics and log export](docs/diagnostics.md)
- [Updates, signing and publishing](docs/updates.md)
- [Android build guide](docs/build.md)
- [Shelf performance benchmark](docs/perf-shelf-benchmark.md)
- [Architecture decision records](docs/adr/)
- [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Licence

MIT — see `LICENSE`. Third-party components and prototype assets are listed in
`THIRD_PARTY_NOTICES.md`.
