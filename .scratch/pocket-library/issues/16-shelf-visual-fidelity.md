# 16: Shelf visual fidelity

**What to build:** Wholesale port of the approved "Refined reading room" prototype (`prototype/design/shelf-v4.html`, interactions from `flows.html`) into the real app. The current UI is a wiring skeleton; the prototype is the design contract. This is not a polish pass and not a reinterpretation. At 390x844 the result should be visually indistinguishable from the prototype, with the real app data and interactions.

**Blocked by:** 05, 06, 08, 13

**Status:** awaiting-device-test

- [x] Spines vary deterministically in width, height, colour and material; no two adjacent books are identical flat rectangles. Worn cloth/leather gradients, darker endcaps and gilt rules/bands.
- [x] Spine colours are derived from the book (cover-led where available, format/hash fallback) and stay muted and legible.
- [x] Bookcase furniture matches the prototype: cornice with crest, fluted pilasters/capitals, carved brackets, panelled recessed back, moulded shelf lip, brass hairline/rail, plinth, warm lamp pools and contact shadows.
- [x] Labels render as coloured paper bands with cream text; reading ribbon and gold finished seal match the prototype; the detail cover carries the percentage/gold sticker.
- [x] Filter strip, count, clear action and Manage labels match the prototype's scale and hierarchy; it does not dominate the shelf.
- [x] The one-time drag hint is smaller, sits clear of the shelf/drawer, and never returns after dismissal.
- [x] Drawer pull and drawer match the prototype exactly: brass hardware, live finger-following drag both directions, snap threshold, scrim, back/Escape, one-time hint. No floating pill.
- [x] The shelf scrolls and lifts with the prototype's feel and timings; press/lift/drop/hover states match.
- [x] Motion timings and easings are taken from the prototype, not approximated: scrim 260 ms, detail 480 ms, no bounce; transform/opacity only.
- [x] Book detail matches the prototype: framed composition, real cover as hero, blurb, metadata, chips, Read/Continue, labelled Back to shelf.
- [x] Motion: composite-only, panel 480 ms, scrim 260 ms, no bounce; reduced motion instant.
- [x] Playwright screenshots at 390x844 for empty wall, populated wall, filtered wall, finished/reading spines and detail; no horizontal overflow.
- [x] Signed release APK built and the public URL verified.

**Notes:** Reuse the prototype's CSS, SVG and interaction code as the source of truth; port it into the React shell rather than writing new styles. Keep the existing data wiring, commands, drag logic, filters, placement and reader. Do not regress functionality. Verify with side-by-side screenshots against `shelf-v4.html` at 390x844 for: empty wall, populated wall, filtered wall, reading/finished spines, drawer open, book detail. Reviewer compares against the prototype, not against the old app.


## Notes

- **Ported wholesale, not iterated on the old styling.** The wall is now `v4-room` markup and the v4 CSS layer from `prototype/design/shelf-v4.html`: masthead with crest and rule, sticky brass filter rail, cornice/palmette crest, fluted pilasters, panelled back, moulded lip, brass hairline/rail, plinth, lamp pools and carved brackets. `App.css` carries the prototype's palette, spacing and type scale.
- **Spines derive from the book.** Width (27–34 px), height (198–238 px), lean, palette, format offset and ornament come from a stable FNV-1a hash of `contentHash`/title+author, so adjacent books differ and a relaunch is identical. Cloth/leather gradients, endcaps, gilt rules and the v4 neutral overlay are CSS; label bands are solid paper with cream text and a max of two plus a `+n` nub. The visible band text is a four-letter abbreviation; the full label name sits in a visually-hidden span so assistive tech, Playwright text assertions and `title`/aria labels stay complete.
- **Status cues:** reading = red ribbon at the head; finished = embossed gold seal on the spine and gold "Finished" sticker on the detail cover. The detail paper sticker reads the real percentage and keeps `data-testid="detail-sticker"` for the existing tests.
- **Drawer:** the floating pill is gone. A 60×22 px brass pull with rivets and a slot sits at the bottom centre over a 30 px edge strip. Both open and close drags follow the finger, with the prototype's 25%/55% and velocity snap thresholds; scrim, Escape and Android back close it. The one-time drawer hint is distinct from the small book-drag hint and both persist dismissal in localStorage.
- **Detail:** v4 framed composition (`d3 d4`), real `coverDataUrl` as the hero with spine hinge/page block at `min(268px, 80%)`, blurb, label chips, four-column meta strip, oxblood Read/Continue CTA, and a labelled Back to shelf plus the fixed ×. Existing status menu and attach/detach label controls remain wired.
- **Motion:** scrim 260 ms linear, panel 480 ms `cubic-bezier(.2,.8,.2,1)` (240 ms opacity), 320 ms spine lift, 440 ms drawer rail, no bounce. Reduced motion collapses every animation/transition.
- **Version line:** removed from the wall. `app-info` is visually hidden on the wall (kept for the adapter smoke test) and visible in Settings; the text is no longer part of the wall composition.
- **Lift sweep:** `measureWall()` now reads only shelf containers that intersect the viewport (±240 px) and derives slot centres arithmetically from the deterministic widths, flex gap and shrink ratio. It emits `pocketlibrary:measure-wall` for `perf/lift-probe.mjs`. Before: 709.4 ms for the bench's per-spine DOM sweep; after: 2.6 ms for the real lift path at 2,000 books / 4× CPU. The bench's historical all-spine probe is still reported as a worst-case diagnostic (1778 ms cold), but the app no longer runs it.

## Verification

- `npx playwright test` — 34 passed.
- `npm run build` and `npx tsc --noEmit` — pass.
- Android clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android --all-targets -- -D warnings` — pass.
- `node perf/bench.mjs` (after, 2,000 books / 182 shelves / 4× CPU): scroll warm p95 18.3 ms / p99 28.5 ms; cold p95 21.6 ms; long tasks >50 ms 9; 25,000 DOM nodes; shelf section sweep 1.1 ms. The richer spines add nodes versus the old 12.8k skeleton, but `content-visibility` is preserved and scroll p95/p99 stay inside the scroll budget.
- `node perf/lift-probe.mjs` — one `measureWall` sweep, 2.6 ms.
- Playwright screenshots at 390×844 (device scale 2) are in `prototype/design/screenshots/app/`: `wall-empty.png`, `wall-populated.png`, `wall-spines.png` (reading/finished and `Full · 11/11`), `wall-filtered.png`, `drawer-open.png`, `book-detail.png`, `book-detail-finished.png`. No horizontal overflow was observed at 390 px.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 18,498,510 bytes, SHA-256 `9431c13db03f9f06f906780d8b0c54b885f8f114d86c07e690b3e7bb1d589db6`, signer `CN=PocketLibrary`. Public URL returns HTTP 200 (18,498,510 bytes).

## Device-only checks

- Finger-following drawer drag and snap thresholds with a real touch screen (the headless test exercises pointer drags, tap and Escape only).
- Safe-area insets at the notch and gesture bar for the fixed drawer pull, hints and the 30 px edge strip.
- Android back while the drawer is open (headless Chromium covers `popstate`, but WebView history integration needs a device).
- Readability of 27 px spine titles and 7.2 px label bands on a real panel at 1×/2× DPR, plus the muted violet/aubergine palette in bright daylight.
- Frame pacing of the v4 gradients and shadows while scrolling and lifting on a mid-range Android WebView; the desktop 4× CPU proxy passes scroll budgets but is not a device GPU.
