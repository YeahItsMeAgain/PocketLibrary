# Shelf performance at 2,000 books — benchmark report (ticket 13)

**Date:** 2026-11-25 · **Harness:** `perf/bench.mjs` · **Method:** `perf/README.md`
**Proxy:** Chromium 159.0.8154.6 via Playwright 1.65.1, 390x844, 4x CDP CPU
throttle, 2,000 generated books on 182 shelves (11 per shelf). DPR 1 is the
primary method (matching `notes/shelf-performance.md`); DPR 3 is a spot check.

This is a Chromium proxy, not Android System WebView on ARM. The device run is
still outstanding.

## Headline

`content-visibility: auto` + `contain-intrinsic-size` cut the renderer DOM by
**66%** and brought steady-state scrolling inside budget, but the proxy still
misses **first shelf**, **filter**, and **zero long tasks**. The remaining causes
are outside a CSS-only change:

1. The first shelf waits on the eagerly bundled reader code plus React
   mounting all 13k spine nodes; `content-visibility` skips layout/paint, not
   element creation or bundle parse.
2. Filtering re-renders every spine's class name through React; the style flush
   is <2 ms, but the deferred React commit produces 100 ms-class long tasks.
3. Loading the wall once lays out the shelves that `content-visibility` had
   skipped; the drag lift then measures every spine (651 ms) because
   `measureWall()` is still an O(library) DOM sweep, not model arithmetic.

Do **not** treat the drag-lift regression as a reason to drop
`content-visibility`: without it scroll and DOM budgets miss badly. Fix the
sweep first (next section).

## Results (DPR 1, 4x)

| Metric | Before | After | Budget | Result |
|---|---:|---:|---:|---|
| First shelf interactive | 1,437.6 ms | **774.6 ms** | < 400 ms | **MISS** |
| Scroll p95 (warm) | 28.7 ms | **19.0 ms** | ≤ 20 ms | **PASS** |
| Scroll p99 (warm) | 39.4 ms | **22.4 ms** | ≤ 33 ms | **PASS** |
| Scroll frames > 50 ms | 5 | **0** | 0 | **PASS** |
| Long tasks > 50 ms (whole run) | 12 | **5** | 0 | **MISS** |
| Long tasks during scroll | 5 | **0** | 0 | **PASS** |
| Renderer DOM (embedder heap) | 31.2 MB | **10.7 MB** | < 15 MB | **PASS** |
| DOM nodes | 13,838 | 12,864 | – | – |
| Filter apply (settled) | 927.6 ms | **152.9 ms** | < 50 ms | **MISS** |
| Filter clear (settled) | 573.8 ms | **105.3 ms** | < 50 ms | **MISS** |
| Filter sync style flush | 1.6 ms | **0.8 ms** | – | – |
| Cold scroll p95 / p99 | 34.8 / 62.1 ms | 25.6 / 311.7 ms | – | cold-cache reveal |
| Lift-time sweep: sections / spines | 1.5 / 18.4 ms | 1.2 / **651.8 ms** | – | **regression** |

After-run long tasks: 3 during load (160, 230, 76 ms) and 2 during filter (101,
103 ms). None during scroll. The before run had 5 scroll long tasks.

DPR 3 spot check (after): first shelf 711.0 ms, scroll p95 18.3 ms / p99
22.3 ms, DOM 10.7 MB, filter 145.1 ms, spine sweep 622.7 ms. Ranking is
unchanged.

## What changed

`src/App.css` only:

```css
.shelf {
  content-visibility: auto;
  contain-intrinsic-size: auto 242px; /* measured section height at 390x844 */
}
.spine.is-dimmed {
  opacity: 0.24; /* no per-spine filter: opacity is compositor-only */
}
```

Verified, not changed:

- `preserve-3d` does not appear on the wall at all; the scrolling wall is flat.
- `will-change` appears only on `.spine.drag-ghost`, the lifted ghost.
- Filters is model-side: `matchingIds`/`dimmedBookIds` iterate the 2,000-book
  model, not DOM geometry. The class mutation is still O(books) through React.
- Drag pointer moves use `geometryRef` and `shelfAtPoint()`; there is no
  per-pointermove `getBoundingClientRect()`. However `beginLift()` and the
  edge-auto-scroll loop still call `measureWall()`, which sweeps every section
  and spine. That is the 651 ms probe above.

## Budget gaps and fallback ladder

The documented ladder is: tune paint/CSS → JS window → canvas 2D → windowed
WebGL2. This ticket was constrained to `App.css`, so only step 1 was available.

- **First shelf (774 ms vs 400):** measured fixed cost dominates. A 100-book run
  still took ~900 ms before hardening, and a 2,000-book run only added ~500 ms.
  The cheap next step is to lazy-load the reader/EPUB vendor chunk and defer
  off-screen shelves (`requestIdleCallback` or a shelf window); both need
  `App.tsx`/build changes owned by other tickets. CSS cannot create elements
  more cheaply.
- **Filter (153 ms vs 50):** the synchronous style/layout flush is under 1 ms;
  React's deferred re-render of 2,000 spine class names is the cost. The next
  step is to move dimming to a wall-level state and let CSS apply it, or window
  the wall so only mounted shelves re-render. Needs `App.tsx`.
- **Long tasks (5):** all are load and filter tasks; scroll itself is clean.
  Same follow-ups as above.
- **Drag lift (652 ms):** the ladder's step 2 (model arithmetic) is the fix:
  derive shelf tops from `SHELF_H` and slot offsets from the model, and scope
  FLIP to the source/target shelves. This should also avoid forcing layout of
  `content-visibility`-skipped shelves. Needs `App.tsx`.

Recommendation: keep the CSS hardening, land the model-arithmetic drag and a
deferred/windowed initial render next, then rerun
`PERF_LABEL=after node perf/bench.mjs` and only then do the device pass.

## Reproduce

```bash
node perf/bench.mjs                                 # after
PERF_BASELINE_CSS=1 PERF_LABEL=before node perf/bench.mjs
PERF_DPR=3 PERF_LABEL=after-dpr3 node perf/bench.mjs
```

Raw results: `perf/results/before.json`, `after.json`, `after-dpr3.json`.

## Device remainder

No Android device/WebView was attached during this work (`adb devices` empty),
so the real-device checkbox stays open. On device, additionally check:

- The first frame excluding Tauri/SQLite startup (the proxy excludes neither the
  bundle parse nor React mount, and includes both).
- Renderer process memory with `dumpsys meminfo`, not just Blink embedder heap.
- Vestibular/touch scroll behaviour under a compositor fling, where the warm
  p95 should be at least as good as the synthetic rAF pass.
- The drag-lift freeze after the geometry fix; it is currently the biggest
  user-visible risk at 2,000 books.
