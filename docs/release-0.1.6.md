# PocketLibrary 0.1.6 release notes

> **Historical.** The version, schema and artifact numbers below describe the
> release named in the title, not the current code. Current values live in the
> repository metadata checked by `scripts/check-docs.mjs`.

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.6`
(versionCode `1004`), Android 8.0+ (API 24, targets API 36).

0.1.6 fixes the follow-up reports from 0.1.4 and adds book deletion. The app
signing key and the updater key are unchanged, so this installs over
0.1.0–0.1.4 and keeps the database, folder grant, shelves, labels and reading
progress.

## Highlights

- **“MAN” is repaired on launch.** If a book was indexed from a truncated
  embedded title, PocketLibrary now completes it from the download history or
  filename when the catalogue opens. Existing libraries are fixed on the next
  launch — no rescan required.
- **PDF covers skip the title page.** Cover extraction now samples the first
  few pages and picks the first jacket-like page instead of blindly rendering
  page one. Cached PDF covers are regenerated once on the next launch scan, so
  an existing “page of words” cover is replaced too. If no jacket page is
  found, the app falls back to its generated plate.
- **Moving a pile of books stays reliable.** A shelf move is painted
  immediately and clears the drag preview before the command finishes, so a
  second quick drag cannot fight the first one or be overwritten by a stale
  result.
- **Books can be deleted.** The book actions menu now offers **Delete book…**
  with a confirmation. Deleting removes the file from the library folder, the
  cached cover, labels, reading state, annotations, and the catalogue row, then
  compacts the shelf.

## Upgrade notes

- Install over 0.1.0–0.1.4 without uninstalling. The release key is unchanged
  (`CN=PocketLibrary`), so app data survives. A debug build cannot be upgraded
  to this release (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- Settings → Updates offers 0.1.6 to 0.1.4 installs. The APK is verified by
  SHA-256 and a version-bound minisign signature before Android's installer
  opens.

## Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `npm run test:e2e` | 112 passed |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| Android target clippy | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.6, code 1006, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,483,442 bytes** · SHA-256 `0d878c6ea250583ef3e7149b509a783fc79dc3723026468f722485a1449e1c9e`.

## Known gaps

- **PDF cover choice is heuristic.** A jacket-like page is chosen from the
  first four pages by ink and colour; a PDF with only text pages gets the
  generated plate rather than an unrelated page of words. A scanned cover that
  looks exactly like a text page cannot be distinguished.
- **Device pass not performed.** Verified with the core suite, Playwright and
  an Android-target clippy run; no phone or emulator was attached. Deleting a
  real SAF file and the installer/update consent flow remain device-only
  checks.

See [`release-0.1.4.md`](release-0.1.4.md) for the previous release, and
[`updates.md`](updates.md) for the updater design and key handling.
