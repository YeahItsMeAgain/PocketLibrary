# PocketLibrary 0.1.15 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.15`
(versionCode `1015`), Android 8.0+ (API 24, targets API 36).

0.1.15 makes the three spine styles real, readable and distinct, fixes taps on
the style picker, makes the chosen style survive everywhere, and cleans up
confusing copy. Signing is unchanged, so this installs over 0.1.x.

## Shelf presentation

- **Wrap** paints the generated art inset under a cream board edge, with a
  smoked, framed title window. Ink is contrast-derived from the scrim.
- **Full-bleed** paints the art edge to edge with a soft centred scrim. The type
  is centred on the spine, not in the old 20 px side rail.
- **Cloth** no longer borrows art: it draws a woven board with foil rules and
  centred foil serif type.
- Long titles wrap into up to two vertical columns and shrink to fit; the
  title never ellipses mid-word and the author never overlaps it.
- Measured worst-case ink contrast over white art: Wrap 8.8:1, Full-bleed
  10.9:1, Cloth foil 5.99:1. Type centre within ±2 px of the spine centre.

The Edit preview uses the same treatment: full-bleed type moved from `cx=40`
to `cx=26`, and cloth uses the sampled art palette.

## Picker and style persistence

- The fixed undo toast was swallowing taps on the bottom style row. The toast
  now passes pointer events through; only its Undo button is interactive.
- `EditBook` kept a duplicate `spineStyle` state, so the picker could show
  Full-bleed while the preview or wall used a stale copy. The detail is now the
  single record.
- Choosing a style and closing immediately persists; Undo restores the style in
  the picker, stored detail and wall; a reload keeps it.
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
