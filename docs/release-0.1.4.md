# PocketLibrary 0.1.4 release notes

> **Historical.** The version, schema and artifact numbers below describe the
> release named in the title, not the current code. Current values live in the
> repository metadata checked by `scripts/check-docs.mjs`.

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.4`
(versionCode `1004`), Android 8.0+ (API 24, targets API 36).

0.1.4 is a bug-fix release for the shelf, metadata, downloads and diagnostics.
The app signing key and the updater key are unchanged, so this installs over
0.1.0–0.1.3 and keeps the database, folder grant, shelves, labels and reading
progress.

## Highlights

- **Books sit together again.** A partly filled shelf packs its books from the
  left instead of spreading them across the whole board. Dragging now follows
  the real spine positions, refreshes the preview geometry as books slide
  aside, and lands the book in the visible gap rather than merely swapping it
  with a neighbour.
- **“The Whisper Man” is no longer “MAN”.** A short embedded title that is only
  a suffix of the full filename title now loses to the filename. Trailing
  Libgen-style `ebook` is stripped, and a rescan repairs the already-indexed
  book.
- **Transient download failures retry.** When mirrors briefly answer 500, the
  queue now makes up to three bounded passes over the mirror list before
  failing. Cancelling still stops promptly, and progress/mirror labels keep
  updating.
- **Send diagnostics opens the share sheet.** Android now hands the zip to the
  native share chooser as a readable `application/zip` content URI instead of
  opening the save picker. The save picker remains the fallback if sharing is
  unavailable.

## Upgrade notes

- Install over 0.1.0–0.1.3 without uninstalling. The release key is unchanged
  (`CN=PocketLibrary`), so app data survives. A debug build cannot be upgraded
  to this release (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- Settings → Updates offers 0.1.4 to 0.1.3 installs. The APK is verified by
  SHA-256 and a version-bound minisign signature before Android's installer
  opens.

## Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 110 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| Android target check | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.4, code 1004, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,458,738 bytes** · SHA-256 `d9b8b91cc029f384176099bb74d35acb82668eb31b887ea1358d42dc3667ed90`.

## Known gaps

- **Needful Things cover still needs an artifact.** PDF covers are rendered
  from page one; the reporter has not yet shared the PDF or a screenshot, so
  the incorrect image has not been diagnosed or changed in this release.
- **Device pass not performed.** Verified with the core suite, Playwright and an
  Android-target compile; no phone or emulator was attached. The native share
  chooser and the installer/update consent flow remain device-only checks.
- First paint still misses the 400 ms proxy budget; see 0.1.2's notes for the
  measured numbers.

See [`release-0.1.3.md`](release-0.1.3.md) for the previous release, and
[`updates.md`](updates.md) for the updater design and key handling.
