# PocketLibrary 0.1.3 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.3`
(versionCode `1003`), Android 8.0+ (API 24, targets API 36).

0.1.3 is a search-quality fix. The app signing key and the updater key are
unchanged, so this installs over 0.1.0–0.1.2 and keeps the database, folder
grant, shelves, labels and reading progress.

## Highlights

- **The search box now searches titles and authors.** A basic query used to
  send no field selection, so LG+ searched every field — title, author, series,
  year, publisher and ISBN. Searching `1984` matched years (833,584 rows live)
  instead of titles (63,835). The box now always sends `columns[]=t&columns[]=a`,
  matching its "Title or author" label.
- **Books only.** Text searches now restrict LG+ topics to Libgen, Fiction and
  Fiction RUS. Comics, magazines, standards and scientific articles are
  excluded server-side. Page 1 for `The Hobbit` was 11 CBR, 6 CBZ, 5 EPUB and
  3 PDF; it is now 20 EPUB and 2 PDF on the same 25-row page.
- **Nothing disappears silently.** The result ledger says how many rows were
  skipped because they are not EPUB/PDF, and a page with no supported files
  explains why instead of looking like a failed search.
- **Hyphenated ISBNs work.** `978-0-00-837100-5` now finds the same 17 rows as
  `9780008371005`; spaces, hyphens and a lowercase `x` check digit are
  normalised.
- **Paging no longer stops early.** When a mirror omits its result-count badge,
  Next stays enabled as long as the mirror returned a full 25-row page, even
  though non-EPUB/PDF rows were filtered out.

Language, format and year filters are still applied client-side because LG+
does not accept them server-side; the counts now show both filter-hidden and
format-dropped rows.

## Upgrade notes

- Install over 0.1.0–0.1.2 without uninstalling. The release key is unchanged
  (`CN=PocketLibrary`), so app data survives. A debug build cannot be upgraded
  to this release (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- Settings → Updates offers 0.1.3 to 0.1.2 installs. The APK is verified by
  SHA-256 and a version-bound minisign signature before Android's installer
  opens.

## Verification

| Check | Result |
|---|---|
| `cargo test --manifest-path core/Cargo.toml` | pass |
| `cargo test --test acquisition live_search -- --ignored` | `18 results, total 43, from libgen.li` |
| `npm run test:e2e` | 105 tests; one timing-sensitive navigation test passed on rerun |
| `npm run build` | pass |
| `npx tsc --noEmit` | pass |
| `cargo clippy --lib` / `--test acquisition -- -D warnings` | pass |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.3, code 1003, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,442,610 bytes** · SHA-256 `9ae2054ab674a3f742c927164835bde9232f2307de61af72b85c6c14c970333d`.

## Known gaps

- **Device pass not performed.** Verified with the core suite, Playwright and a
  live search; no phone or emulator was attached. Live search on a carrier
  network and the installer/update consent flow remain device-only checks.
- **Filters still page by 25.** A language/format/year filter can hide every
  row on a page. The UI reports the hidden counts and keeps paging available,
  but LG+ has no server-side filter to narrow the result set first.
- **Comics are out of scope.** The app only opens EPUB and PDF, and 0.1.3
  excludes comic/magazine topics from text search. An MD5 or ISBN lookup is
  still unscoped and may return a format the app cannot open.
- First paint still misses the 400 ms proxy budget; see 0.1.2's notes for the
  measured numbers.

See [`release-0.1.2.md`](release-0.1.2.md) for the previous release, and
[`updates.md`](updates.md) for the updater design and key handling.
