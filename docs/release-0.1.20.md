# PocketLibrary 0.1.20 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.20`
(versionCode `1020`), Android 8.0+ (API 24, targets API 36).

0.1.20 is a one-fix patch on 0.1.19. Signing and the database schema are
unchanged, so this installs over 0.1.x.

## Fixed

- **The reading status mark sits on the book again.** 0.1.19 drew reading as an
  oxblood drape in a case-level layer: it started 4px above the book's foot and
  hung 27px over the shelf lip and board. On a phone it read as a loose red
  strip floating below the book. Reading is now the oxblood head ribbon from the
  spine lab: 8×26px at `top: 0`, `right: 3px`, inside the spine, in exactly the
  same slot as the finished gold ribbon, with an 80% notch, a 2px top sheen and
  the oxblood ramp `#4c0a0f → #8e1b22 → #c3353d → #8e1b22 → #4c0a0f`.
- Reading books now reserve the same 28px head as finished, so the ribbon never
  touches a title glyph. The two marks differ only by colour (oxblood vs brass);
  reading and finished are exclusive, so they can share the slot.
- The case-level cue layer was deleted with the drape: no `ShelfCues`
  measuring/resize/intersection/mutation observers, no `.v4-cues`, no drag-ghost
  copy, no separate filter dim sweep, and the canvas no longer reports the
  reading mark as a foot drape. Shelf and Studio both report
  `headReserve = 28` and `markKind = reading-ribbon` for reading.

Everything from 0.1.19 is unchanged: the smoked-leather shelf, the gold finished
ribbon, the repaired Edit → Labels menu, and the reading desk.

## Verification

| Check | Result |
|---|---|
| Fast gate (`./scripts/check.sh`) | pass, 126 Playwright tests |
| Spine specs (presentation, renderer, studio, style-sync) | 69 passed |
| Full Playwright suite (2 workers) | 293 passed |
| `npm run build` / `check:contract` / `check:docs` / `check:structure` | pass |
| `./scripts/release-check.sh` | pass |

APK: `PocketLibrary-0.1.20.apk` · 68,126,233 bytes · SHA-256
`f3cf7b46f3a2a2626c72843997c09dc1695acfc7228e478bc51b93e505bf592d`.
