# Shelf benchmark (ticket 13)

Reproducible benchmark for the 2,000-book wall. It builds the production
bundle, serves it with `vite preview`, seeds the real UI through the mock
platform, and measures the wall at a 390x844 phone viewport under 4x CPU
throttling.

## Run it

```bash
node perf/bench.mjs                        # current CSS, label "current"
PERF_LABEL=after node perf/bench.mjs
PERF_BASELINE_CSS=1 PERF_LABEL=before node perf/bench.mjs
PERF_DPR=3 PERF_LABEL=after-dpr3 node perf/bench.mjs
```

Each run writes `perf/results/<label>.json` and prints a summary. Exit code is
0 only when every proxy budget passes.

Knobs:

| Variable | Default | Meaning |
|---|---|---|
| `PERF_LABEL` | `current` | Result filename and table heading |
| `PERF_RATE` | `4` | CDP CPU throttling rate |
| `PERF_DPR` | `1` | Device scale factor (primary method is 1; 3 is a spot check) |
| `PERF_BOOKS` | `2000` | Generated book count (11 per shelf) |
| `PERF_URL` | – | Reuse an already-running server instead of building/serving |
| `PERF_BASELINE_CSS` | `0` | Inject the pre-hardening overrides (`content-visibility` off and the old dimming filter) so the old baseline can be reproduced without checking out old code |

The build lands in `perf/.build/` (git-ignored). Raw deltas and observer entries
are kept in the JSON so the percentiles can be recomputed.

## Detail-open benchmark

`node perf/detail-open.mjs` seeds one realistic volume (long blurb, a
photographic cover and a cached 52×236 spine artifact) and taps its spine at
390×844 under 4× CPU throttling. It reports click-to-content, the spine
preview, long tasks and rAF frame deltas for the following 800 ms. The sibling
CI check is `tests/e2e/detail-open-perf.spec.ts`.

| Variable | Default | Meaning |
|---|---|---|
| `PERF_LABEL` | `current` | Result filename |
| `PERF_RATE` | `4` | CDP CPU throttling rate |
| `PERF_DPR` | `1` | Device scale factor (3 is the phone spot check) |
| `PERF_WIDTH` / `PERF_HEIGHT` | `390` / `844` | Viewport |
| `PERF_SPINE` | on | Set `0` to omit the cached spine artifact |
| `PERF_COVER_FILE` | `prototype/design/covers/jane-eyre.jpg` | Real JPEG cover; `generated` uses the synthetic PNG |
| `PERF_COVER` | on | Set `0` for the mock's tiny SVG plate |
| `PERF_WARM` | off | Set `1` to measure a second, warm open |
| `PERF_NOANIM` | off | Disable the entrance animation for an A/B floor |
| `PERF_CSS` | – | Extra CSS injected before load (animation experiments) |

## What it measures

- **First shelf** — navigation start to the first shelf having a non-zero rect
  and a spine that hit-tests, plus one extra frame.
- **Scroll p95/p99** — rAF deltas over two 240-frame passes (`scrollBy(0, 14)`
  per frame, ~9 shelves). Warm is the second pass.
- **Long tasks / LoAF** — `longtask` and `long-animation-frame` observers,
  tagged by phase (`load`, `scroll`, `filter`, `drag`).
- **Renderer DOM** — CDP `Runtime.getHeapUsage().embedderHeapUsedSize` and
  `Memory.getDOMCounters`, read before the drag probe so skipped shelves stay
  skipped.
- **Filter apply/clear** — the real label chip and clear button, measured to a
  forced style/layout flush plus two rAFs. The budget uses the synchronous
  class/attribute pass plus flush (the spec metric); the settled number is a
  diagnostic that also includes two compositor frames.
- **Geometry sweep** — a diagnostic, not a budget: the lift-time
  `getBoundingClientRect()` sweep over all shelves, then all spines. It exposes
  the remaining O(library) drag measurement.

Report, budgets and caveats: `docs/perf-shelf-benchmark.md`.
