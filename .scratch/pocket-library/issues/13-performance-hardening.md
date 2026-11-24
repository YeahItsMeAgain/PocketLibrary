# 13: Performance hardening

**What to build:** The shelf stays smooth with 2,000 books on a mid-range Android phone. Initial paint, scrolling, filtering, and drag all meet the spec budgets, verified with a benchmark and on the actual WebView.

**Blocked by:** 05, 06

**Status:** claimed — CSS hardening is in; proxy budgets still miss on first shelf, filter, long tasks and drag lift, so this is not ready for device sign-off.

- [x] Shelves use `content-visibility: auto` with an intrinsic size; no JS windowing, canvas, or WebGL
- [ ] Drag and filter never read whole-library geometry; shelf/slot lookup is arithmetic on the model
- [x] `preserve-3d` is confined to the detail/flip subtree; `will-change` is confined to the lifted ghost
- [ ] A generated 2,000-book benchmark meets: first shelf interactive <400 ms at 4x throttle, scroll p95 ≤20 ms, p99 ≤33 ms, no long tasks >50 ms, renderer DOM <15 MB, filter <50 ms
- [ ] The same checks are run on the real Android WebView and the result is recorded
- [ ] If a budget is missed, the documented fallback ladder is applied and the decision is recorded

## Benchmark record (2026-11-25)

Harness: `perf/bench.mjs` (production bundle, real wall UI, 390x844, DPR 1 primary / DPR 3 spot check, 4x CPU throttle, 2,000 books on 182 shelves). Report: `docs/perf-shelf-benchmark.md`. Raw: `perf/results/{before,after,after-dpr3}.json`.

| Metric | Before | After | Budget | Result |
|---|---:|---:|---:|---|
| First shelf interactive | 1,437.6 ms | 774.6 ms | < 400 ms | miss |
| Scroll p95 (warm) | 28.7 ms | 19.0 ms | ≤ 20 ms | pass |
| Scroll p99 (warm) | 39.4 ms | 22.4 ms | ≤ 33 ms | pass |
| Scroll frames > 50 ms | 5 | 0 | 0 | pass |
| Long tasks > 50 ms (whole run) | 12 | 5 | 0 | miss |
| Renderer DOM | 31.2 MB | 10.7 MB | < 15 MB | pass |
| Filter apply (settled) | 927.6 ms | 152.9 ms | < 50 ms | miss |
| Lift-time sweep (all spines) | 18.4 ms | 651.8 ms | – | regression |

DPR 3: first 711.0 ms, p95 18.3 ms / p99 22.3 ms, DOM 10.7 MB, filter 145.1 ms, spine sweep 622.7 ms.

## Remaining work (recorded fallback decision)

Only ladder step 1 (CSS/paint tuning) was available under this ticket's
`App.css`-only constraint. Steps 2+ need `App.tsx`/build changes:

1. **First shelf (774 ms):** fixed app cost dominates (a 100-book run was still
   ~900 ms before hardening). Lazy-load the reader/EPUB vendor chunk and defer
   off-screen shelves; neither is a CSS change.
2. **Filter (153 ms):** the style flush is <1 ms, but React re-renders 2,000
   spine class names in a deferred 100 ms-class task. Move dimming to wall-level
   state or window the wall.
3. **Drag lift (652 ms):** `beginLift()`/`measureWall()` still sweeps every
   section and spine, forcing layout of `content-visibility`-skipped shelves.
   Replace with model arithmetic (`shelfTop = index * SHELF_H`, slot offsets from
   the model) and scope FLIP to the source/target shelves. Pointer moves already
   use the cached map; the lift sweep is the remaining O(library) read.
4. **Long tasks (5):** all load/filter; scroll itself is clean (0 >50 ms).

Keep the CSS change: reverting it loses the scroll and DOM wins. Rerun
`PERF_LABEL=after node perf/bench.mjs` after the App.tsx work, then do the device
pass (`adb` was unavailable here; `dumpsys meminfo` still needed).
