# PocketLibrary 0.1.15 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.15`
(versionCode `1015`), Android 8.0+ (API 24, targets API 36).

0.1.15 makes the three spine styles real, readable and distinct, fixes taps on
the style picker, makes the chosen style survive everywhere, and cleans up
confusing copy. Signing is unchanged, so this installs over 0.1.x.

## Shelf presentation

- **Art** is the one art style: the cover crop is clipped between a top brass
  mark band and a bottom author/label band. The title runs down the remaining
  art with adaptive ink and a hairline halo. No dark rail or scrim.
- **Cloth** no longer borrows art: it draws a woven board with foil rules and
  centred foil serif type.
- **Typography** is the original pre-engine spine: a flat, untextured two-tone
  title-hash board, cream and gold serif type, seal and rules, no art and no
  weave. It is a separate style from Cloth, not a fallback.
- Long titles wrap into up to two vertical columns and shrink to fit; the
  title never ellipses mid-word and the author never overlaps it.
- Adaptive ink reports measured contrast from the actual art behind the type
  (≥4.5:1 on both light and dark art); Cloth foil stays 5.99:1. Only Art
  paints art. Type centre within ±2 px of the spine centre.

The Edit preview uses the same treatment: the art spine shows the top and
bottom bands, and cloth uses the sampled art palette.

## Picker and style persistence

- The fixed undo toast was swallowing taps on the bottom style row. The toast
  now passes pointer events through; only its Undo button is interactive.
- `EditBook` kept a duplicate `spineStyle` state, so the picker could show a
  stale style while the preview or wall used another. The detail is now the
  single record.
- Choosing a style and closing immediately persists; Undo restores the style in
  the picker, stored detail and wall; a reload keeps it.
- Existing `wrap` and `full-bleed` rows migrate to `art` (shown as **Art**);
  neither old value exists in the enum, database CHECK, picker or renderer.
- The mock now projects styles through `list_books` / `get_book_detail` and
  persists them, so tests can catch this class of bug.

## Copy and small UI

- Removed the confusing Review note (“The check found art it cannot vouch
  for…”) and its inline Use Cloth action.
- Pass copy is “Passed the on-device check.”; fallback says the result was
  rejected and the cloth spine is shown.
- “View the source record” is a proper brass action with an external-link mark
  and a 44 px target, not an unstyled browser link.

## Verification

| Check | Result |
|---|---|
| Playwright combined (style sync, studio, queue, renderer, edit, settings, metadata, smoke, navigation, diagnostics) | 121 passed |
| `npx tsc --noEmit`, `npm run build` | pass |
| Contract check | pass |
| `apksigner verify` | `CN=PocketLibrary` |
| `aapt2 dump badging` | 0.1.15, code 1015 |

APK: `pocketlibrary-0.1.15-spine-arm64.apk` · 68,127,785 bytes ·
SHA-256 `a72203f844532464b6cd3b2d8ec6b22cbdf17988173251c7c5d29dc7affe7d45`.

Limitation: the shelf payload has no sampled palette, so shelf Cloth uses the
existing title-hash palette; the Edit preview samples cloth from the artifact.
