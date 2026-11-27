# Shelf performance at 2,000 books — benchmark report (ticket 13)

**Date:** 2026-11-25 · **Harness:** `perf/bench.mjs` · **Method:** `perf/README.md`
**Proxy:** Chromium 159.0.8154.6 via Playwright 1.65.1, 390x844, 4x CDP CPU
throttle, 2,000 generated books on 182 shelves (11 per shelf). DPR 1 is the
primary method; DPR 3 is a spot check. Raw results:
`perf/results/before-13.json`, `after-13.json`, `after-13-dpr3.json`.

This is a Chromium proxy, not Android System WebView on ARM. The device run is
still outstanding.

## 0.1.2 update — windowed shelves and deferred filtering (ticket 18 phase 2)

The phase 2 wall mounts only the visible shelves plus one on each side, recycles
them, memoises spines and applies filters outside React's render path. Canonical
results are `perf/results/phase2-before.json` (phase 1 rerun) and
`phase2-after.json` (phase 2), same 2,000 books / 4× method.

| Metric | Phase 1 | Phase 2 | Gate |
|---|---:|---:|---|
| First shelf | 493.7 ms | **505.7 ms** | +2.4% (≤10%); 400 ms still missed |
| Scroll warm p95 / p99 | 18.1 / 24.0 ms | **19.1 / 25.6 ms** | fixed 20 / 33 ms |
| Filter sync / DOM pass | 37.2 / — ms | **9.5 / 0.7 ms** | DOM pass <20 ms |
| Lift sweep p95 / max | 6.4 ms rect sweep | **1.9 / 1.9 ms** | <20 ms |
| Renderer DOM | 11.3 MB / 1,807 nodes | **17.3 MB / 3,435 nodes** | fixed 5,000 nodes |
| Full-wall traversal | not measured | **3,435 → 3,741 nodes (+8.9%)** | ≤15% growth |

The 400 ms target remains a load-time miss (495–532 ms across runs). The initial
`list_books` IPC still returns the whole catalogue; the renderer mounts only the
window, but a first-window-only backend command is future work. Reader fonts are
deliberately not subsetted because EPUB text is arbitrary; they stay lazy. The
original ticket 13 report below is kept as the historical baseline.

## Historical baseline (ticket 13, phase 1)

> **Historical.** Everything from here to **Reproduce** describes the phase-1
> wall, including its zero-height sentinel + `IntersectionObserver` mounting
> and the "nodes are kept once mounted" rule. The shipped renderer no longer
> works that way: it derives an arithmetic window from scroll position and
> recycles a fixed slot pool (see the 0.1.2 update above and
> `src/library/window.ts`). The numbers below are kept as the ticket-13
> baseline, not as a description of current behaviour.

## Headline

Progressive mounting plus an imperative filter and model-arithmetic geometry
bring the wall close to the budgets, with all scroll and interaction budgets now
passing. Two proxy misses remain, both load-only:

1. **First shelf** is 475.7 ms against 400 ms. The 4x proxy floor is the app
   itself: an 11-book run still takes ~403 ms, and the main bundle's module
   evaluation is a ~91 ms long task. The wall adds ~70 ms when 2,000 books are
   present.
2. **Long tasks** are 2 (91 ms module evaluation, 58 ms first wall commit), both
   during load. There are **zero** long tasks during scroll, filter or drag.

The rest passes comfortably: scroll p95 18.8 ms / p99 23.2 ms, renderer DOM
11.3 MB / 1,807 nodes at the measured top-of-wall state, filter apply 35.3 ms
(sync style flush), lift sweep 6.6 ms including all mounted spines.

## Results (DPR 1, 4x)

| Metric | Before | After | Budget | Result |
|---|---:|---:|---:|---|
| First shelf interactive | 1,393.5 ms | **475.7 ms** | < 400 ms | **MISS** (+75.7) |
| Scroll p95 (warm) | 35.5 ms | **18.8 ms** | ≤ 20 ms | **PASS** |
| Scroll p99 (warm) | 111.1 ms | **23.2 ms** | ≤ 33 ms | **PASS** |
| Scroll frames > 50 ms | 11 (warm) | **0** | 0 | **PASS** |
| Long tasks > 50 ms (whole run) | 37 | **2** | 0 | **MISS** (load only) |
| Long tasks during scroll/filter/drag | 31 | **0** | 0 | **PASS** |
| Renderer DOM (embedder heap) | 27.1 MB | **11.3 MB** | < 15 MB | **PASS** |
| DOM nodes | 24,758 | **1,807** | – | – |
| Filter apply (sync + forced flush) | 1.5 ms* | **35.3 ms** | < 50 ms | **PASS** |
| Filter clear (sync + forced flush) | 1.5 ms* | **9.8 ms** | < 50 ms | **PASS** |
| Filter apply (settled, +2 frames) | 191.8 ms | **66.5 ms** | diagnostic | – |
| Lift-time sweep: sections / spines | 2.3 / 1,998.7 ms | **0.1 / 6.6 ms** | – | **PASS** |

\* The baseline's 1.5 ms is the click/flush only; the old React commit then ran
as a deferred 190 ms task, which is why the settled number was 191.8 ms.

DPR 3 spot check (after): first shelf 506.2 ms, scroll p95 18.6 ms / p99 25.8 ms,
DOM 11.3 MB, filter 36.9 ms, sweep 11.6 ms. Ranking is unchanged.

Long-task phases (after): `load` 91 ms and 58 ms; `scroll` 0; `filter` 0;
`drag` 0.

## What changed

`src/App.css`:

- `content-visibility: auto` + `contain-intrinsic-size: auto 328px` per shelf.
  The old 350px intrinsic size was larger than the real 328px case, so unrendered
  shelves inflated the document and shifted it when mounted; the corrected size
  removes that jump.
- The SVG `feTurbulence` noise tile became a pre-rasterised `src/assets/noise.png`.
  The filter was the single largest first-paint raster task (~130 ms at 4x).
- Shelf brackets and the crown crest are CSS background images instead of inline
  SVGs, removing 13 DOM nodes per case with the same drawing.
- `preserve-3d` remains confined to the detail/flip subtree; `will-change`
  remains only on the lifted ghost.

`src/App.tsx`:

- **Progressive mount (phase 1; since replaced).** The first shelf painted
  immediately; one zero-height sentinel plus a single spacer reserved the exact
  remaining wall height, and an `IntersectionObserver` mounted one more case
  just before it was needed. Mounting was wrapped in `startTransition` and
  nodes were kept once mounted (no recycling). The shipped renderer instead
  computes the visible shelf range from `scrollY`, the viewport height and the
  fixed 358px shelf unit, keeps one shelf of overscan, and recycles a pool of
  nine slots while `v4-shelf-placeholder` gaps reserve the exact height of
  every unmounted shelf. Twelve shelves or fewer still mount eagerly.
- **Memoised shelves and spines.** `ShelfCase` is `React.memo` with a comparator
  on shelf identity and book references, so a drag preview or filter does not
  reconcile unaffected shelves. Empty label bands are omitted; labels only
  render when present.
- **Imperative filtering.** Filter state lives in refs inside `FilterStrip`; a
  chip updates `aria-pressed`, the count and each spine's `is-dim`/`data-dimmed`
  directly. There is no wall re-render or React commit for a filter, and newly
  mounted shelves re-apply the current filter in a layout effect.
- **Model-arithmetic drag geometry.** `measureWall()` now derives the visible
  shelf range from scroll position and fixed shelf height and measures only
  those few cases; it no longer sweeps the whole library. `bookById` is a map
  instead of a linear find per spine.
- **Lazy readers.** `EpubReader` and `PdfReader` (and pdf.js/foliate behind them)
  are `React.lazy` chunks. The startup bundle fell from 810 kB to 319 kB.
- Reader close clones the refreshed book objects so memoised spines pick up
  status changes.

## Remaining gaps and fallback ladder

- **First shelf (+75.7 ms, 19%).** This is fixed app cost in the proxy, not the
  wall: 11 books still take ~403 ms, and the 2,000-book data path adds ~70 ms.
  The bundle's module evaluation is itself a ~91 ms long task. Next steps would
  be splitting React/app vendor chunks further and raising this ticket's proxy
  to a real-device measurement; CSS and wall DOM are no longer the bottleneck.
- **Long tasks (2, load only).** Both are startup: module evaluation and the
  first wall commit. Scroll, filter and drag are clean. If zero load tasks is a
  hard requirement, the next rung is an app-shell split (deliver masthead/filter
  first, defer non-library views) rather than more wall work.
- **Memory over a full traversal (phase 1).** The benchmark read 11.3 MB at the
  measured top-of-wall state. Under phase 1, nodes were kept once mounted, so a
  user who scrolled the entire 182-shelf wall grew the renderer; the 0.1.2
  window recycles a nine-slot pool, so the mounted set tracks the viewport
  rather than the library size. The phase-1 node counts above are historical and
  are not a current memory projection.

The fallback ladder was applied at step 1 (paint/DOM tuning) and step 2's
model-arithmetic part for drag. The ticket-13 build did not use a JS window;
the 0.1.2 phase 2 later added the arithmetic window and slot recycling described
at the top. A canvas path was still not used.

## Device remainder

No Android device/WebView was attached during this work, so the real-device
checkbox stays open. On device, check:

- First shelf excluding Tauri/SQLite startup, and the real bundle-evaluation
  time on the target WebView.
- Renderer memory with `dumpsys meminfo`, not just Blink embedder heap.
- Compositor fling behaviour and the shelf-window boundary (no blank shelf
  and no scroll jump).
- Lift/drop and filtering with the real touch pipeline.

## v0.1.0 release run (2026-11-25)

`PERF_LABEL=release-0.1.0 node perf/bench.mjs` on the release commit, same
method: first shelf **481.3 ms** (miss), scroll warm p95/p99 **18.3 / 22.1 ms**
(pass), scroll cold p95/p99 22.8 / 35.4 ms, **2** load-only long tasks (miss),
DOM **11.3 MB / 1,807 nodes** (pass), filter apply **36 ms** sync / 74.1 ms
settled (pass), filter clear **12.6 ms** sync / 47.6 ms settled (pass), lift
sweep **0 / 6.5 ms** (pass). Raw:
`perf/results/release-0.1.0.json`. The ranking is unchanged from the hardening
run; the first-paint and load-long-task gaps remain accepted for the device pass.

## Reproduce

```bash
node perf/bench.mjs                                 # after
PERF_BASELINE_CSS=1 PERF_LABEL=before node perf/bench.mjs
PERF_DPR=3 PERF_LABEL=after-dpr3 node perf/bench.mjs
node perf/lift-probe.mjs
```
