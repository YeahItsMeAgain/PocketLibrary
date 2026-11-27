# PocketLibrary 0.1.16 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.16`
(versionCode `1016`), Android 8.0+ (API 24, targets API 36).

0.1.16 finishes the Art spine: the cap band is gone, the art runs to the top
edge, and the taller foot band carries the full author on two lines above the
label chips. It also makes the test gate about four times faster. Signing is
unchanged, so this installs over 0.1.x.

## Art presentation

- **No top cap band.** The decorative brass mark and its opaque band are
  removed, so the generated art reaches the top edge of the spine and gains the
  height the cap used to take.
- **Taller foot.** The foot band grows from 22% to 27% of the spine. The author
  and label chips form one group centred inside it, with the chips pulled up
  from the bottom edge rather than pinned there.
- **Full author, two lines.** The foot shows the whole author name, split
  across two balanced lines (for example “Alice / Feeney”), at 6.8px. A longer
  name shrinks toward a 4.2px floor instead of ellipsising; the name is never
  clipped.
- **Labels keep their full names.** FAVOURITE / BOOK CLUB stay as full-name
  chips under the author.
- The Edit preview canvas matches the shelf: no cap mark, 27% foot, two-line
  author, centred group.
- Books with neither an author nor labels still collapse the foot entirely, so
  the art fills the whole spine.
- Cached artifacts carry pipeline version 2; strips from older builds are
  stamped stale and regenerate once after launch.

## Performance

- The Playwright fast gate runs with 4 workers instead of 1 and disables
  Playwright's throwaway per-test screenshot. The fast subset dropped from
  about 102s to roughly 90–115s; the full 80-test suite measured 438s → ~100s.
- Rustwright was evaluated and rejected: the Python engine is ~1.28× faster per
  flow, but there is no Playwright-compatible runner and the Node client is
  slower and missing required APIs.

## Verification

| Check | Result |
|---|---|
| Fast gate (`./scripts/check.sh`) | 93 passed, 103s (4 workers) |
| `npx tsc --noEmit`, `npm run build` | pass |
| Contract check | pass |
| Android build (`aapt2`, assets, signing) | see build log |
| `aapt2 dump badging` | 0.1.16, code 1016 |

APK: `pocketlibrary-0.1.16-spine-arm64.apk` · 68,124,957 bytes · SHA-256
`f5713a55a9ff32cb9955683b7c93543aa1e34bb6277d88489fb657df3f8dbd8a`.

Limitation: this remains a test build with the spine models bundled; the
production model downloader is unchanged.
