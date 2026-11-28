# PocketLibrary 0.1.18 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.18`
(versionCode `1018`), Android 8.0+ (API 24, targets API 36).

0.1.18 redesigns the shelf spine and the reader's controls. Signing and the
database schema are unchanged, so this installs over 0.1.x.

## Shelf

- **Art is now smoked leather.** The full-height cover strip sits under a fixed
  warm scrim instead of relying on adaptive ink over raw art. Every title now
  clears 4.5:1 against the composited art; the old worst band was 1.3:1 on real
  engine output.
- **No foot band.** The author and the 5px label codes sit on the scrim's
  deepest 30%, so a shelf of seven books no longer reads as one black bar.
- **Reading and finished are ribbons.** Reading is an oxblood drape over the
  shelf lip; finished is a gold head ribbon. Neither enters the title box. The
  old ribbon covered up to 30px of title and the medallion covered the last
  letters of two finished books.
- **Titles fit.** A single long word shrinks to fit, per-column tracking is
  capped at 0.12em, RTL titles are measured in direction, and a rendered title
  can no longer leave its box.
- **Studio parity.** The Edit preview paints the same face and follows a reading
  status change live. Cloth and Typography keep their boards and share the same
  status language.

## Reader

- **One reading desk.** The old top and bottom bars are gone. A brass pull and
  the progress percentage are the only way in; they open a 48% desk carrying
  type, theme, mode, contents, bookmarks, highlights and, for PDF, page and
  zoom.
- **Swipe down closes** the desk, following the drag and springing back under
  the threshold. Scrim, Escape and Android back close it too, and focus returns
  to the pull.
- **The page is never covered while reading.** Paginated EPUB reflows while the
  desk is open and restores its position; scrolled EPUB and PDF overlay without
  repaginating.
- **Progress stays still** while the desk is open, so a reflow cannot make the
  readout jump.

## Under the hood

- Cover validation now has tests for online and manual images: portrait and
  minimum size, HTML, animation, oversized payloads and the warned manual case.
- The Open Library provider has an HTTP seam test against a local server.

## Verification

| Check | Result |
|---|---|
| Fast gate (`./scripts/check.sh`) | pass, 126 Playwright tests |
| Full Playwright suite | 293 passed |
| `check:contract`, `check:docs`, `check:structure` | pass |
| Phone-width Chromium | 320, 390, 430 pass with no overlap or overflow |

Device-only update checks remain as documented in `docs/updates.md` (the build
host has no emulator).

APK: `PocketLibrary-0.1.18.apk` · 68125649 bytes · SHA-256
`504d894d2fd0b68605be11fb504758c6706409d2e09b659ece2c218fd346624b`.
