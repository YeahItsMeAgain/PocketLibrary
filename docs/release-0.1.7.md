# PocketLibrary 0.1.7 release notes

> **Historical.** The version, schema and artifact numbers below describe the
> release named in the title, not the current code. Current values live in the
> repository metadata checked by `scripts/check-docs.mjs`.

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.7`
(versionCode `1007`), Android 8.0+ (API 24, targets API 36).

0.1.7 adds readable update announcements, free/keyless metadata enrichment, and
a manual cover chooser. The app signing key and updater key are unchanged, so
this installs over 0.1.0–0.1.6 and keeps the database, folder grant, shelves,
labels, reading progress, annotations and existing covers.

## Highlights

- **Updates are visible on launch.** A compact “A new edition is ready” notice
  appears above the wall after the first paint. It names the version, shows up
  to three release highlights, and links straight to Settings → Updates.
  Dismissing it remembers that version; a later release appears again.
- **Release notes are readable.** Settings shows a compact highlights block and
  an expandable **Full release notes** section instead of one wall of raw
  Markdown. Headings, paragraphs and bullets are rendered natively.
- **Missing details can be filled online.** The new Settings → Online details
  section offers **Off**, **Ask** and **Automatic**. Lookups use free, keyless
  Open Library data, with Internet Archive only when an edition exposes an
  `ocaid`. There are no user API keys and no paid sources.
- **Matching is conservative.** ISBN, edition, work and title+author matching
  produce a confidence result. Automatic mode fills only missing blurbs and
  upgrades a generated/missing cover on a high-confidence match. Real embedded
  or rendered covers are never replaced automatically.
- **Covers can be chosen by hand.** Tap a book’s cover to open the chooser:
  current cover, file original, generated plate, matched Open Library
  candidates, or an image from the device. It previews in the portrait cover
  cache, requires an explicit **Use this cover**, and keeps provenance so
  **Reset to original** or **Use generated plate** remains available.
- **Provenance and backups survive.** Schema v5 records file-original covers
  and blurbs plus per-field provenance. Backups carry manual covers, originals
  and provenance across devices.
- **Existing safety rules remain.** Enrichment is cancellable, rate-limited,
  cached with TTLs, and writes nothing on a failed batch. Covers are validated
  for format, size, portrait ratio and corruption before entering the cache.

## Upgrade notes

- Install over 0.1.0–0.1.6 without uninstalling. The release key is unchanged
  (`CN=PocketLibrary`), so app data survives. A debug build cannot be upgraded
  to this release (or the reverse); uninstall the other build first with
  `adb uninstall app.pocketlibrary`.
- Settings → Updates offers 0.1.7 to 0.1.6 installs. The APK is verified by
  SHA-256 and a version-bound minisign signature before Android's installer
  opens.
- Online details defaults to **Off**. Choose **Ask** or **Automatic** to use
  Open Library. The first successful lookup for a book is cached for 30 days;
  a no-match is cached for 7 days.

## Verification

| Check | Result |
|---|---|
| Core unit + integration tests | pass |
| Enrichment tests | 26 passed |
| Command API tests | 8 passed |
| Backup tests | 8 passed |
| `npx tsc --noEmit` | pass |
| Playwright suite | 136 passed |
| `npm run build` | pass |
| Android target `cargo check` | pass |
| `git diff --check` | clean |
| `apksigner verify` | `CN=PocketLibrary, O=Personal, C=US` |
| `aapt2 dump badging` | `app.pocketlibrary`, 0.1.7, code 1007, min 24, target 36 |

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
· **35,778,994 bytes** · SHA-256 `787e70d37b7aa1a5133df5f7e4021e1bcca6ad680a42b3cba03e861f4980348d`.

## Known gaps

- **No second general-purpose metadata source.** Open Library is the only free,
  keyless general source. Internet Archive is a supplement only through an
  Open Library `ocaid`. Google Books is excluded because keyless access is
  unreliable and user keys are out of scope.
- **No conditional HTTP revalidation.** Cached enrichment uses TTLs and forced
  refresh rather than ETag/Last-Modified checks.
- **Online cover search reuses the matched edition.** The chooser does not yet
  offer a separate free-text Open Library search form.
- **Device cover picking is Android-only.** Desktop builds report it as
  unsupported; the Android SAF picker is wired.
- **Desktop-native shell check is environment-limited.** Android target
  `cargo check` passed; a native desktop check was not possible here because the
  machine lacks GTK/GDK development packages.

See [`release-0.1.6.md`](release-0.1.6.md) for the previous release.
