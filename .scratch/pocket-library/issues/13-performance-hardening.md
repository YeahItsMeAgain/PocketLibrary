# 13: Performance hardening

**What to build:** The shelf stays smooth with 2,000 books on a mid-range Android phone. Initial paint, scrolling, filtering, and drag all meet the spec budgets, verified with a benchmark and on the actual WebView.

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] Shelves use `content-visibility: auto` with an intrinsic size; no JS windowing, canvas, or WebGL
- [ ] Drag and filter never read whole-library geometry; shelf/slot lookup is arithmetic on the model
- [ ] `preserve-3d` is confined to the detail/flip subtree; `will-change` is confined to the lifted ghost
- [ ] A generated 2,000-book benchmark meets: first shelf interactive <400 ms at 4x throttle, scroll p95 ≤20 ms, p99 ≤33 ms, no long tasks >50 ms, renderer DOM <15 MB, filter <50 ms
- [ ] The same checks are run on the real Android WebView and the result is recorded
- [ ] If a budget is missed, the documented fallback ladder is applied and the decision is recorded
