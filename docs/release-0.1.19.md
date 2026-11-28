# PocketLibrary 0.1.19 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.19`
(versionCode `1019`), Android 8.0+ (API 24, targets API 36).

0.1.19 is a one-fix patch on 0.1.18. Signing and the database schema are
unchanged, so this installs over 0.1.x.

## Fixed

- **Edit → Labels works again.** The label chips, the **+ Add label** trigger
  and its menu were styled only under the detail sheet, but the Edit sheet is a
  different layer. In Edit they fell back to the browser's default button: 19px
  tall, transparent and 16px text, so the menu looked like body copy and only
  the glyphs were tappable. The shared rules now apply in both layers, the
  trigger and menu options are 44px targets, and the options have a real panel,
  hover and focus state.
- A regression test now drives the real Edit flow and checks the menu's
  computed background and the 44px targets, so this scope mismatch cannot
  return unnoticed.

Everything from 0.1.18 is unchanged: the smoked-leather shelf, the reading
drape and gold finished ribbon, and the reading desk.

## Verification

| Check | Result |
|---|---|
| Fast gate (`./scripts/check.sh`) | pass, 126 Playwright tests |
| Labels, detail, edit and library-flow specs | 34 passed |
| Full Playwright suite | 293 passed |
| `check:docs` after the version bump | pass |

APK: `PocketLibrary-0.1.19.apk` · 68132909 bytes · SHA-256
`b86bd6f6a5d7365a1302a9ecb41c90b74974efbc3b2c53704e9e3e19ec4dca8b`.
