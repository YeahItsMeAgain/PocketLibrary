# PocketLibrary

PocketLibrary is a private, Android-only reading room for an existing EPUB and
PDF library. It reads the books where they already live, lets you arrange them
on fixed manual shelves, and adds labels, reading status, a built-in reader with
EPUB annotations, Libgen search/downloads, one-file backup/restore, and a
one-tap diagnostics export. There is no account, cloud sync, or telemetry.

**Version:** 0.1.1 · **Package:** `app.pocketlibrary` · **Android 8.0+** (API 24;
targets API 36, arm64-v8a).

## Install

The v0.1.1 release is a sideloaded, signed APK:

```bash
adb install -r app-universal-release.apk
```

The release is signed with the PocketLibrary key (`CN=PocketLibrary`). A debug
build cannot be upgraded to it and vice versa; uninstall the other build first
(`adb uninstall app.pocketlibrary`). Installing over a previous release with the
same key keeps the app's database, covers, and settings. Book files are never
copied into the app and remain in your chosen folder.

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
node perf/bench.mjs
```

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
- [ ] Check Android back unwinds sheets, then the reader, then the app.
- [ ] Scroll a large library, drag a book, filter by label and status, and check
      the first-paint and memory numbers from `docs/perf-shelf-benchmark.md`.

## Known gaps in 0.1.1

- The checklist above is **pending on a physical device**; no phone or emulator
  was attached during the release build.
- **Share sheet is device-only.** The WebView share path is mocked in Playwright;
  verify the Android share sheet on a real phone, including the SAF fallback.
- **First paint** misses the 400 ms proxy budget (475.7 ms at 4× CPU throttle);
  scroll, filter and drag budgets pass. See `docs/perf-shelf-benchmark.md`.
- **External reader cancel:** Android does not report which app was chosen, so
  cancelling the open-with chooser after a handoff can still mark the book as
  reading on the next resume.
- **PDF memory:** books are transported whole. Files over 100 MB are refused with
  a clear message; a 90 MB PDF can still spike memory (Rust + IPC + PDF.js each
  hold a copy). Streaming/range transport is future work.
- **Annotations are EPUB-only.** PDF has no highlights or notes in this release.

See [`docs/release-0.1.0.md`](docs/release-0.1.0.md) for the full release notes.

## Licence

MIT — see `LICENSE`. Third-party components and prototype assets are listed in
`THIRD_PARTY_NOTICES.md`.
