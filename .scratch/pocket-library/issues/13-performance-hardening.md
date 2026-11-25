# 13: Performance hardening

**What to build:** The shelf stays smooth with 2,000 books on a mid-range Android phone. Initial paint, scrolling, filtering, and drag all meet the spec budgets, verified with a benchmark and on the actual WebView.

**Blocked by:** 05, 06

**Status:** claimed — wall/DOM/filter/drag work is in; all scroll and interaction budgets pass. Two load-only proxy misses remain: first shelf (475.7 ms vs 400) and zero long tasks (2, both during load). Device pass still outstanding.

- [x] Shelves use `content-visibility: auto` with an intrinsic size; no JS windowing, canvas, or WebGL
- [x] Drag and filter never read whole-library geometry; shelf/slot lookup is arithmetic on the model
- [x] `preserve-3d` is confined to the detail/flip subtree; `will-change` is confined to the lifted ghost
- [ ] A generated 2,000-book benchmark meets: first shelf interactive <400 ms at 4x throttle, scroll p95 ≤20 ms, p99 ≤33 ms, no long tasks >50 ms, renderer DOM <15 MB, filter <50 ms
- [ ] The same checks are run on the real Android WebView and the result is recorded
- [x] If a budget is missed, the documented fallback ladder is applied and the decision is recorded

## Benchmark record (2026-11-25, second pass)

Harness: `perf/bench.mjs` (production bundle, real wall UI, 390x844, DPR 1 primary / DPR 3 spot check, 4x CPU throttle, 2,000 books on 182 shelves). Report: `docs/perf-shelf-benchmark.md`. Raw: `perf/results/{before-13,after-13,after-13-dpr3}.json`. Lift: `node perf/lift-probe.mjs`.

| Metric | Before | After | Budget | Result |
|---|---:|---:|---:|---|
| First shelf interactive | 1,393.5 ms | 475.7 ms | < 400 ms | miss (+75.7) |
| Scroll p95 (warm) | 35.5 ms | 18.8 ms | ≤ 20 ms | pass |
| Scroll p99 (warm) | 111.1 ms | 23.2 ms | ≤ 33 ms | pass |
| Scroll frames > 50 ms (warm) | 11 | 0 | 0 | pass |
| Long tasks > 50 ms (whole run) | 37 | 2 | 0 | miss (load only) |
| Long tasks during scroll/filter/drag | 31 | 0 | 0 | pass |
| Renderer DOM | 27.1 MB / 24,758 nodes | 11.3 MB / 1,807 nodes | < 15 MB | pass |
| Filter apply, sync + forced flush | 1.5 ms* | 35.3 ms | < 50 ms | pass |
| Filter clear, sync + forced flush | 1.5 ms* | 9.8 ms | < 50 ms | pass |
| Filter apply, settled (+2 frames) | 191.8 ms | 66.5 ms | diagnostic | – |
| Lift sweep (sections / spines) | 2.3 / 1,998.7 ms | 0.1 / 6.6 ms | low ms | pass |

\* The baseline's React commit ran as a deferred ~190 ms task, so its settled filter time was 191.8 ms. The after run's long tasks are module evaluation (91 ms) and the first wall commit (58 ms), both `load`; scroll, filter and drag produce none.

DPR 3: first 506.2 ms, p95 18.6 / p99 25.8 ms, DOM 11.3 MB, filter 36.9 ms, sweep 11.6 ms.

## What landed

- Progressive mount: first shelf paints immediately, then one sentinel + one full-height spacer and an `IntersectionObserver` mount one case ahead (`startTransition`); nodes persist, no scroll jump. Libraries of ≤12 shelves mount fully.
- Memoised `ShelfCase`/21-spine comparator, imperative filter pass (no wall re-render), model-arithmetic `measureWall()` over the visible shelf range, lazy reader chunks (main bundle 810 kB → 319 kB).
- Pre-rasterised noise tile (replacing `feTurbulence`), CSS background brackets/crest (13 fewer nodes per case), conditional label bands, corrected `contain-intrinsic-size` 328px.

## Remaining gaps

1. **First shelf (475.7 ms vs 400):** the 4x proxy floor is app startup — an 11-book run is ~403 ms, and module evaluation alone is a ~91 ms long task. The 2,000-book data path adds ~70 ms. Next rung: app-shell/vendor chunk split, then measure on the real WebView (Tauri/SQLite startup is excluded by this proxy).
2. **Long tasks (2, load only):** module evaluation and first wall commit. No scroll/interaction long tasks. Same next step if zero load tasks is mandatory.
3. **Full-traversal memory:** the reported 11.3 MB is the benchmark's top-of-wall state. Nodes persist once mounted, so scrolling the entire 182-shelf wall grows renderer memory; the pre-hardening build also grew once every shelf had been painted. A hard cap needs the explicitly out-of-scope 8-shelf JS window.
4. **Device pass:** `adb` is still unavailable here (`dumpsys meminfo`, real WebView bundle evaluation, compositor fling, progressive-mount boundary, touch drag/filter).
