# PocketLibrary 0.1.14 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.14`
(versionCode `1014`), Android 8.0+ (API 24, targets API 36).

0.1.14 fixes the remaining “queue empty / fallback / cloth spine” case, removes
the attention nag, and turns Settings → Spine engine into a calm status card.
The signing key is unchanged, so this installs over 0.1.x and keeps the
library, shelves, labels, reading progress and covers.

## Why Rock Paper Scissors stayed cloth

The device log from 0.1.13 showed the engine running successfully and the QA
gate returning `fallback` on every attempt. The host produces `Inpaint` /
`Review` for the same cover at 28–44% mask coverage, and the device was
rejected for reconstructing more than 55% of the cover.

A large but clean reconstruction is a quality signal, not a failed spine:

- `fallback` is now reserved for **readable residual text in the 52×236
  spine** or **too little structure**.
- Coverage over 55%, seam outliers and palette differences are **review**,
  which still paints.
- The rejection message now names the reason, e.g. “residual text is readable
  in the 52x236 spine”, in the attention row and `spine.log`.
- A QA policy bump clears persisted attempt counts once, so books rejected by
  the older gate retry on launch instead of waiting for a manual Retry.

## No more attention nag

- The global “N spines need attention · Retry” banner is removed. The progress
  chip only appears while spines are actively being prepared.
- The “!” shelf badge is removed.
- Attention is per book: Edit → Spine and Settings → Spine engine.

## Settings → Spine engine

- One status line (engine, books that can paint art, artifacts on disk).
- A queue line only when work is pending or needs attention.
- Only problem books are listed, each with a one-line reason and Retry.
- **All books · details** and **What these checks mean** are collapsed by
  default. The full Artifact / Shelf strip / Verdict table remains one tap away.
- Retry all appears only when there is something to retry; Refresh is a quiet
  text action.
- Height reduced 72% when healthy and 53% with a fallback; still exactly
  centred at 320/390 with zero horizontal overflow.

## Verification

| Check | Result |
|---|---|
| Host engine on RPS source + 3 variants | Inpaint Review / Pass / Pass / Review |
| Playwright: spine queue, studio, edit, settings, diagnostics, smoke, navigation | pass after version bump |
| Core tests incl. policy-reset and decision thresholds | pass |
| Clippy core / spine / Android src-tauri `-D warnings` | clean |
| `npx tsc --noEmit`, `npm run build` | pass |
| `apksigner verify` | `CN=PocketLibrary` |
| `aapt2 dump badging` | 0.1.14, code 1014 |

APK: `pocketlibrary-0.1.14-spine-arm64.apk` · 68,123,753 bytes ·
SHA-256 `692db881b23e00f01ff86f421bd63520bc01bd12fcbbfac3e8aa7ee7d85d156f`.
