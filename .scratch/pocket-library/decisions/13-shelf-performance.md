# 13 — Shelf performance at scale

Type: research
Mode: AFK
Status: resolved
Blocked by: 01, 06

## Question

How do we render a wall of up to 2,000 books smoothly in Android System WebView?

Evaluate DOM-per-spine with virtualisation versus canvas/WebGL2 instancing; texture atlases for spines and covers; lazy cover decode and caching; drag and flip performance; the memory ceiling of the WebView process; and the cost of CSS 3D chains. Recommend a rendering architecture with a measurable target (frame budget, cold-scroll time, memory), and note the fallback if the target is missed.

Prefer a prototype or benchmark over a paper answer where possible; blocked until the shelf interaction and design language exist.

## Answer

Resolved 2026-11-24. Full report, method and benchmark: `notes/shelf-performance.md`; benchmark in `/tmp/opencode/perf`.

**Decision: keep DOM-per-spine and add `content-visibility: auto` + `contain-intrinsic-size: auto 358px` per shelf. Do not move the wall to canvas/WebGL2 for v1.**

Benchmarks (Chromium 159, 390x844, 4x CPU throttle, 2,000 books):

- Plain DOM: first paint 2,300-2,700 ms, DOM 61-70 MB, scroll p95 17.5 ms / p99 17.7 ms, 6 long tasks of 50-78 ms, filter 96-145 ms.
- JS windowing (10 shelves): first paint ~300 ms, DOM ~8 MB, but p99 jumps to 155-172 ms with 150-190 ms boundary stalls. Worse than content-visibility.
- DOM + content-visibility: first paint 346-359 ms, DOM 9.7-10.8 MB, p95 17.6-18.8 ms / p99 22-23 ms, **zero long tasks**, filter 11-18 ms.
- Canvas 2D strips: fastest paint (~160 ms) but loses text/accessibility and the drag/detail model.
- WebGL2 atlas: infeasible at phone DPR for 2,000 spines (7 x 2048^2 RGBA = ~1.1 GiB at DPR 3); only viable as a visible-window atlas.

**Critical implementation notes:**

- The prototype's drag code measures the whole library on every pointer move (`bookRects()`, `shelfAt()`), which is ~650 ms per pass at 4x with content-visibility. Replace it with arithmetic shelf/slot lookup from the model; target 0.4 ms per pass.
- Put `preserve-3d` only on the detail/flip subtree, not the scrolling wall.
- Apply `will-change` only to the lifted ghost; on every spine it worsens p99.
- Avoid O(N) global style changes; filters and status updates must touch only affected spines.

**Targets:** first shelf interactive under 400 ms at 4x throttle; scroll p95 <= 20 ms and p99 <= 33 ms; no long tasks > 50 ms; renderer DOM under ~15 MB; filtering 2,000 books under 50 ms. Verify on the actual Android WebView; these are Chromium proxies.

**Fallback ladder:** content-visibility -> model-arithmetic updates -> canvas 2D strips -> windowed WebGL2 atlas.
