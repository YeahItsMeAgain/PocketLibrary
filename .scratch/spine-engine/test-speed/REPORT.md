# Test-speed investigation: current Playwright cost vs Rustwright

Date: 2026-11-27
Scope: measurement only. No product code, tests, or configs were changed. All
throwaway code lives in `.scratch/spine-engine/test-speed/`.

Host: 6 logical cores, 25 GB RAM. Load average during measurements was **20–37**
(other agents were compiling Rust and running their own browsers), so absolute
wall times are inflated. All comparisons below were run sequentially under the
same load; ratios are the useful number.

## TL;DR

1. Rustwright **does work** (built from source, drives Chromium), but only the
   **Python** binding is usable. The Node/TS client is missing `addInitScript`,
   locators, viewport/DPR/touch emulation, routing, and there is no test runner.
   It cannot run `tests/e2e/*.spec.ts`. Do not migrate.
2. The suite's cost is not the driver. For the 80-test fast gate at
   `--workers=1`: **438 s wall, 79 s user CPU**, and test bodies account for
   431 s of the 438 s. Browser launch is ~0.1 s per worker.
3. Two self-inflicted costs dominate:
   - `check.sh` forces `--workers=1` on a fully parallel suite. **4 workers:
     438 s → 115 s (3.8×)**, same total CPU.
   - `screenshot: "only-on-failure"` captures a temporary DPR-3 screenshot after
     **every** test (Playwright `captureTemporary`), then discards it on pass.
     That is **~3 s/test**. Turning it off: **438 s → 234 s at one worker**.
4. Fastest safe path: workers 4–6 + no implicit screenshots + run against the
   built preview instead of the Vite dev server. That is ~4–5× on the gate
   without touching coverage or rewriting a single spec.
5. Rustwright's engine is genuinely faster in Python (2.21 s vs 2.83 s for the
   same seeded flow, 1.6× less CPU), but browser RSS is identical (1.26 vs
   1.33 GB) and the porting cost is enormous for this repo.

## 1. Current cost

Suite: **33 spec files, 235 tests**. The fast gate subset in `scripts/check.sh`
is 8 files / **80 tests** (`smoke`, `spine-queue`, `spine-renderer`,
`spine-studio`, `pdf-reader`, `reader`, `reader-csp`, `reader-layout`).

Note: on this checkout the gate is already red before any speed work —
`smoke.spec.ts` expects `schema 6` but the app reports `schema 7` (1 failure of
80). It is unrelated to timing, but it means the numbers below are for 79
passing tests plus one 5 s assertion timeout.

### Fast gate, measured

| Run | Config | Wall | User | Sys | Peak Chrome RSS |
|---|---|---:|---:|---:|---:|
| `--workers=1` | repo config as-is | **437.8 s** | 78.9 s | 11.8 s | ~1.3 GB delta |
| `--workers=2` (one spec) | repo config | 26.8 s\* | 21.0 s | 3.1 s | noisy |
| `--workers=4` | repo config as-is | **115.4 s** | 80.5 s | 12.2 s | ~7 GB delta |
| `--workers=1` | screenshots off | **234.1 s** | 39.0 s | 10.1 s | — |
| `--workers=4` | screenshots off, DPR 3 | 113.3 s | 48.5 s | 12.4 s | ~7 GB delta |
| `--workers=4` | screenshots off, DPR 1 | 126.6 s | 50.7 s | 12.5 s | ~8 GB delta |
| `--workers=6` | screenshots off, DPR 3 | **88.5 s** | 55.3 s | 13.4 s | — |

\* the 2-worker number is from `spine-presentation.spec.ts` (11 tests), not the
gate; that spec is unrepresentative (PNG decoding, per-character layout).

Per-test durations inside the gate run:

| Config | Test-body sum | Average | Median-ish band | Max |
|---|---:|---:|---|---:|
| repo config, w1 | 430.7 s | **5.38 s** | 46 tests at 4–8 s | 11.6 s |
| screenshots off, w1 | 227.8 s | **2.85 s** | 35 at 2–4 s, 21 at 1–2 s | 10.1 s |

Full-suite estimate at w1: 235 × 5.4 s ≈ **21 min** plus startup. At w4 with
screenshots off, roughly **5–6 min**; at w6, ~4–5 min (load-dependent).

### Startup costs, measured separately

| Item | Time |
|---|---:|
| Vite dev cold start (`vite --port 1422`) | 488 ms reported ready; **2.24 s** to first HTTP 200 |
| Vite preview start (built assets) | **0.72 s** |
| `npm run build` (tsc + vite) | **9.48 s** (vite itself 0.87 s) |
| App boot per test, dev server (fresh context → wall ready) | **0.90 s** (nav 0.63 s, app ready 0.27 s) |
| App boot per test, preview server | **0.39 s** (nav 0.20 s, app ready 0.19 s) |
| Browser launch per worker | 0.08–0.11 s |

`check.sh` runs `npm run build` as the "Web build" stage, then the Playwright
`webServer` runs `npm run build && npm run preview` again. That is ~10 s wasted
per invocation whenever the preview server is not already up (always in CI).
Both dev and preview servers are started for every Playwright run even though
only two specs (`reader-csp`, `detail-open-perf`) need port 1421.

## 2. Where the time goes

Ranked for the 80-test gate at one worker:

1. **Failure-screenshot capture on every test: ~200 s (46%) and ~40 s CPU.**
   `screenshot: "only-on-failure"` is not lazy. `playwright/lib/index.js:598`
   (`SnapshotRecorder.captureTemporary`) snapshots each page at teardown for
   `only-on-failure`, writes a temp PNG, and deletes it if the test passed.
   At `deviceScaleFactor: 3` that is a 1170×2532 capture + font wait + PNG
   encode: measured **3.1 s** in one test (10.1 s total). With `screenshot:
   "off"` the same test is **3.3 s**. Proof:
   `.scratch/spine-engine/test-speed/proto/*.time`, `/tmp/spine-debug*.log`.
2. **Test body / app interaction: ~230 s.** Average 2.85 s/test even without
   screenshots. Floors: 0.39–0.9 s app boot (context + goto + React ready),
   then dozens of locator round-trips at ~20–100 ms each. The suite's explicit
   `waitForTimeout` calls (36 across all specs) add little.
3. **App boot per test: ~40 s (9%).** Fresh context + navigation to an
   unbundled Vite dev server. Preview boot is ~2× faster (0.39 s vs 0.90 s).
4. **DPR 3 for everything: not a wall-time factor** (DPR 1 was not faster in
   the w4 run), but it makes each screenshot 9× the pixels and is the reason
   the implicit screenshots cost 3 s. Keep DPR 3 only where pixel geometry is
   asserted (`spine-presentation` decodes PNGs).
5. **Browser launch per worker: negligible** (~0.1 s; the whole gate has
   2 s of launch overhead at w4).
6. **`--workers=1`: 3.8× penalty.** Tests are isolated via `addInitScript`
   mocks and are already `fullyParallel`; serial execution leaves 80% of the
   machine idle (79 s CPU over 438 s).

## 3. Rustwright, tried for real

### Build

- Cloned `https://github.com/Skyvern-AI/rustwright` to
  `/tmp/opencode/rustwright`, HEAD `9ac4793` (2026-11-24), package 0.3.1.
- Toolchain: Rust 1.99.0, Node 24.21.0, npm 11.19.0, Python 3.13.5.
- `cd node && npm install` → 66 packages, 3 s.
- `npm run build` (napi-rs release build of the Rust CDP engine) → **182 s**,
  success (203 warnings). No separate browser download needed; it used the
  Playwright-cached browser at
  `~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`
  (Google Chrome for Testing **159.0.8154.6**).
- Published npm `rustwright` is 0.3.0 (2026-08-24); PyPI wheel resolves to
  0.3.1. MIT license, ~968 stars, alpha, no GitHub releases (tags only),
  26 open issues, actively developed (last push 2026-11-24). Telemetry is on by
  default (`DISABLE_TELEMETRY=1` disables it).

### What actually works

| Capability | Python 0.3.1 | Node 0.3.1 (built from source) |
|---|---|---|
| Launch Chromium | ✅ | ✅ |
| `data-testid` | ✅ `get_by_test_id` | ❌ no locators/getByTestId (CSS selector works with `click`/`textContent`) |
| `addInitScript` | ✅ | ❌ not bridged |
| Screenshot (viewport, clip) | ✅ | ✅ |
| DPR 3 | ✅ `device_scale_factor=3` (`window.devicePixelRatio === 3`) | ❌ only `--force-device-scale-factor` launch arg |
| Mobile/touch | ✅ `is_mobile`, `has_touch`, `locator.tap()` (`maxTouchPoints === 1`) | ❌ no viewport/touch options |
| Clipboard stub | ✅ via init script (`navigator.clipboard.writeText`, value observed) | ❌ no init script |
| Route interception | ✅ `page.route` + `fulfill(418)` | ❌ not bridged |
| Bounding box / computed style | ✅ `bounding_box`, `evaluate(getComputedStyle)` | ✅ `evaluate` only |
| Multiple pages / contexts | ✅ 2 pages, 2 contexts | ⚠️ `newContext` is a documented non-isolating shim (single process) |
| Parallel workers | ⚠️ one browser per process; Python async wraps sync in threads | ❌ no worker model |
| TypeScript/JS test runner | ❌ none; no `@playwright/test` replacement | ❌ none |
| Run existing `*.spec.ts` | ❌ import/fixture/test-runner mismatch | ❌ same, plus missing APIs |

The full seeded flow **did run in Python**: init script seeded one book,
`get_by_test_id("library-wall")`, touch-tapped the spine, read
`detail-title` = "THE HOLLOW CROWN" and `detail-author` = "ADA LOVELACE · 1974 ·
SHELF I", took a screenshot, and closed. Route interception, `bounding_box`,
`getComputedStyle`, a second page and a second context also worked.

### Measured: Node vs Node (same flow, no seed possible in Rustwright Node)

Flow: launch → goto `http://localhost:1420/` → onboarding → click "Choose
library folder" → wait `library-wall` → screenshot.

Flow total is the in-script mark (excludes interpreter startup; external
`real` was 4.37 s for Rustwright and 2.28 s for Playwright).

| Metric | Rustwright Node | Playwright Node |
|---|---:|---:|
| Flow total (marks) | **4.25 s** | **1.78 s** |
| Launch | 984 ms | 77 ms |
| New page | 492 ms | 75 ms |
| goto | 628 ms | 277 ms |
| Click | 1061 ms | 109 ms |
| Wait for wall | 6 ms | 13 ms |
| Screenshot | 803 ms | 1096 ms |
| Close | 125 ms | 43 ms |
| Peak browser RSS | 1.21 GB | 0.62 GB (headless shell) |
| CPU (user+sys) | 1.55 s | 1.81 s |
| `data-testid` / init script / touch | no / no / no | yes / yes / yes |

RW Node cannot seed a book, so `spineCount` was 0; it never reached the
"click a spine / read a detail testid" part.

### Measured: Python vs Python (seeded flow, same Chromium binary)

Flow: init script seeds one book → goto → `library-wall` → tap spine →
`book-detail` → read `detail-title` → screenshot.

Flow total is the in-script mark (external `real` was 2.40 s for Rustwright and
2.99 s for Playwright, including Python startup).

| Metric | Rustwright Python | Playwright Python |
|---|---:|---:|
| Flow total (marks) | **2.21 s** | **2.83 s** |
| Launch | 204 ms | 640 ms |
| New page | 167 ms | 182 ms |
| goto | 258 ms | 329 ms |
| Wait wall | 86 ms | 142 ms |
| Tap spine | 109 ms | 89 ms |
| Wait detail | 22 ms | 20 ms |
| Screenshot | 1231 ms | 1284 ms |
| Close | 84 ms | 87 ms |
| Peak browser RSS | 1.26 GB | 1.33 GB |
| CPU (user+sys) | 1.35 s | 2.14 s |

This is the honest best case for Rustwright: the same language, same browser,
same flow. It is **1.28× faster** and uses **37% less CPU**, almost entirely
because it removes the Python→Node driver startup. Memory is browser-dominated
and effectively equal. Its own README says the same: 70% less *client* memory,
"Chromium-dominated whole-process memory is roughly equal".

**Where the attempt stopped:** the TS suite cannot be executed at all. There is
no `@playwright/test`-compatible runner, and the Node client lacks
`addInitScript`, locators, viewport/touch/DPR options, and routing. Running one
existing spec would mean either (a) porting it to Python/pytest and rewriting
all fixtures, or (b) waiting for Node API parity and building a runner.

### Porting one spec (e.g. `library-flow.spec.ts`) would require

- Rewrite imports to `rustwright.sync_api` / Python and replace `test`/`expect`
  with pytest or a custom runner (no runner, reporters, retries, sharding,
  `test.step`, trace).
- `page.addInitScript` → `page.add_init_script` (works today, Python only).
- `getByTestId` → `get_by_test_id`; `toHaveText` → `expect(locator).to_have_text`
  (Python `expect` exists).
- Keep the mock object as a JSON string in the init script.
- DPR 3 + `is_mobile` + `has_touch` work; touch uses `locator.tap()`.
- Clipboard must be stubbed in the init script (`navigator.clipboard.writeText`),
  because there is no Playwright permission/grant API parity.
- Replace the playwright `webServer` block with a shell/CI step (start preview,
  wait for 200).
- Parallelism: one browser process per worker; no shared contexts.

## 4. Alternatives, concretely ranked for this suite

1. **More workers (biggest, zero rewrite).** `--workers=4` on the gate:
   437.8 → 115.4 s. 6 workers with screenshots off: 88.5 s. Memory is the
   limit: ~1.5–1.7 GB per worker at DPR 3, so 4 workers need ~7 GB; cap workers
   on 16 GB machines. `fullyParallel` is already on.
2. **Stop implicit failure screenshots.** `screenshot: "off"` in local runs,
   or keep diagnostics with a tiny custom fixture that calls
   `page.screenshot()` only when `testInfo.status !== testInfo.expectedStatus`.
   438 → 234 s at w1; halves CPU.
3. **Serve the built app, not the dev server.** Point `baseURL` at the preview
   (1421), start only `vite preview` (build once), delete the dev `webServer`.
   App boot 0.90 → 0.39 s, one less server (~1 GB RSS for a long-lived Vite
   dev process), and no duplicate `npm run build`. Expected ~0.5 s/test.
4. **Split the 17 browserless tests** (`library-helpers` 4, `search-helpers` 4,
   `spine-renderer` 5, `ui-helpers` 4) into `node:test`/Vitest. They already run
   in 6 ms/test; the saving is mostly avoiding the Playwright runner and its
   context for them. Small (7% of tests), but free.
5. **CI sharding** (`--shard=1/2` on two runners) for another 2× wall time when
   one machine is not enough. Playwright has no `--only-changed`; a manual
   `git diff --name-only` filter or `--grep` tag is needed.
6. **Puppeteer + thin runner / WebdriverIO BiDi / Vitest browser mode** — all
   still launch the same Chromium and pay the same app boot; they only swap the
   client and require rewriting the suite. No evidence they beat tuned
   Playwright here.
7. **Direct CDP (`chrome-remote-interface`)** — the profile shows driver
   overhead is a minor share; the 3 s screenshot and 0.4–0.9 s app boot remain.
   Not worth a rewrite.
8. **Rustwright** — engine is real and measurably faster in Python, but not a
   drop-in for this TS suite. Would cost a full rewrite for ~1.3× on a single
   flow, while the browser/app costs (boot, screenshot, memory) stay.

## 5. Recommendation

Do the quick wins first; they are larger than any tool swap and risk nothing:

- Change `scripts/check.sh` from `--workers=1` to `--workers=4` (or
  `PW_WORKERS` env, default 4; 2 on low-memory machines). Expected gate:
  **~7.3 min → ~2 min**.
- Set `screenshot: "off"` (or a failure-only custom fixture) and
  `trace: "off"` locally. Expected gate at w1: **~7.3 min → ~3.9 min**, and at
  w4 roughly **~1.5 min**.
- Run the web group against the built preview: one `npm run build`, then
  `vite preview`; drop the dev server. Removes the duplicate build and ~0.5 s
  per test.
- Then, if still needed, shard in CI.

Combined realistic estimate for the 235-test suite: **from ~21 min serial to
~3–4 min locally / ~2 min on two CI shards**, with no dropped coverage.

Do **not** migrate to Rustwright now. Revisit if/when its Node binding gains
`addInitScript`, locators, viewport/touch/DPR options, routing and a test
runner. If a Python-only test lane ever makes sense, the engine is credible.

## Raw artifacts

All under `.scratch/spine-engine/test-speed/`:

- `gate-w1.{json,time}`, `gate-w4.{json,time}` — repo config.
- `gate-w1-noshot.{json,time}`, `gate-w4-noshot.{json,time}`,
  `gate-w4-dpr1.{json,time}`, `gate-w6-noshot.{json,time}` — measurement config.
- `pw-measure.config.ts` — copy of the repo config with screenshots/trace off
  and no `webServer`, used only for measurement.
- `proto/rw-real-node.mjs`, `proto/pw-real-node.mjs` — Node same-flow trial.
- `proto/rw-real-python.py`, `proto/pw-real-python.py` — Python seeded trial.
- `proto/rw-features.py` — route/context/geometry/touch feature probe.
- `proto/measure-run.sh`, `proto/*.time`, `proto/*.sample` — wall/CPU/RSS harness.
- `proto/boot-probe.mjs` — dev vs preview app-boot probe.
- Built Rustwright source: `/tmp/opencode/rustwright` (outside the repo).
- Python venv with `rustwright==0.3.1`, `playwright==1.65.2`:
  `.scratch/spine-engine/test-speed/.venv/` (git-ignored scratch).
