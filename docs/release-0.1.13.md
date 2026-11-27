# PocketLibrary 0.1.13 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.13`
(versionCode `1013`), Android 8.0+ (API 24, targets API 36).

0.1.13 fixes the shelf silently showing cloth spines while the spine queue said
"nothing pending", and two layout defects in Settings and Edit. The signing key
is unchanged, so this installs over 0.1.x and keeps the library, shelves,
labels, reading progress and covers.

## Why art spines could stay invisible

There were two definitions of "done" and they disagreed:

- the queue called a book cached when `artifact.json` existed;
- the shelf only paints a **projected, shelf-eligible strip**: the 52 × 236
  image must decode and the quality gate must be `pass` or `review`.

So a book whose artifact existed but was a `fallback`, or could not project its
strip, counted as finished forever. The queue stayed empty, no error was shown,
and the wall kept the cloth spine. That is the exact reported combination.

0.1.13 makes the shelf strip the single definition of done:

- `shelf_book_ids()` requires a decodable strip with an eligible verdict, and
  launch repair now uses it. Unusable artifacts are regenerated instead of
  being treated as cached.
- A `fallback` result is retried automatically up to three attempts. After
  that it stays visible in the activity chip, the shelf marker and Settings
  until the user taps **Retry**.
- `review` still paints; `fallback` never paints and never counts as done.
- Settings → **Spine engine** now shows **Artifact**, **Shelf strip** and
  **Verdict** separately, plus "N of M books can paint spine art".
  **Retry all** re-queues books without a shelf strip.
- The `spine.log` shelf line reports scanned / projected / skipped / shelf /
  fallback counts.

## Other fixes

- **Settings is centred again.** The page's auto-sized grid column grew to the
  widest child's min-content width, so the card sat right of centre at 390 and
  was clipped at both edges at 320. The card now shrinks to the viewport, long
  paths and errors wrap, and the per-book table becomes a stacked list below
  520 px. Verified at 320 / 390 / 412 with no horizontal overflow.
- **Switching spine styles no longer jumps.** Two causes: every style choice
  re-ran the studio load (collapsing it for a few frames), and the preview
  stage changed height between Wrap and Full-bleed/Cloth. The studio now loads
  per book only, and all three styles share one reserved stage.
- **A fallback no longer pins Cloth.** The studio used to persist
  `spine_style = 'cloth'` when generation fell back, which hid later successful
  art with no explanation. Fallback now previews as cloth without changing the
  book's stored style.

## Upgrade notes

- Install over any 0.1.x build signed with the same key. A debug build or a
  differently signed build must be uninstalled first.
- On first launch the repair pass re-checks every book against the shelf strip
  definition and re-queues books that were wrongly considered done. This may
  run the engine again for those books.
- If Settings → Spine engine shows a book as **Suppressed by Cloth style**, that
  book's stored style is Cloth. Change it in Edit → Spine if you want art.

## Verification

| Check | Result |
|---|---|
| Playwright: spine queue, studio, edit, settings layout/naming, diagnostics | 63 passed |
| Core tests (`cargo test -p pocketlibrary-core`) | pass |
| Core clippy `-D warnings` | clean |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |
| Contract / structure / docs checks | pass |
| Real engine on three covers (`spine-host`, bundled models) | route `text-free crop`, verdict `pass`, strips 3/3 projected |
| Browser shelf with those projected strips | art painted, `img.spine-generated` 52 px wide |
| `apksigner verify` | `CN=PocketLibrary` |
| `aapt2 dump badging` | 0.1.13, code 1013 |

APK: `pocketlibrary-0.1.13-spine-arm64.apk`
