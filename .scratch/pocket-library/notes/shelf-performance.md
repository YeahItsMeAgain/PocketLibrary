# Shelf performance at 2,000 books (ticket 13)

**Question:** what rendering architecture keeps a 2,000-book shelf smooth in Android System WebView, and what are realistic targets?

**Date:** 2026-11-24 · **Status labels:** **[V]** verified against a primary source or directly measured here; **[I]** inference/estimate from verified facts.

**Verdict up front:** keep **one DOM node per spine**, but make each shelf a `content-visibility: auto` container and stop measuring the whole library on every pointer move. Do **not** move the wall to canvas or WebGL2 for v1. The DOM does not break down at 2,000 spines during scroll; it breaks down at *initial layout*, *global style changes*, and *O(N) geometry reads*. Those are fixable without leaving the DOM, and the DOM keeps text crisp, accessible, and draggable with the existing code.

---

## 1. What the prototype actually does

Read from `prototype/design/flows.html` **[V]** (source read directly):

- Each book is a `<button class="book">` containing a `.spine` with a 2-stop gradient, two 1px gradient rules, vertical `writing-mode: vertical-rl` title/author, up to two label bands, an optional ribbon and an optional seal (`spineHTML()`, lines 2363–2387).
- The wall is a normal flex column of `.v4-shelf` sections, ~358 px tall each. There is **no `preserve-3d` on the wall**; books are 2D with a small `rotate(var(--lean))` (`.book`, line 391). `preserve-3d` appears in the detail/flip styling (lines 789, 795, 1288), where it belongs.
- `.spine::before` is a noise texture with `mix-blend-mode: overlay` (lines 419–423), and every spine has 6 `box-shadow` layers (lines 411–417).
- Drag is O(N): `bookRects()` reads `getBoundingClientRect()` for **every** `.book` (line 3219), `flipBooks()` forces layout with `app.offsetWidth` and re-measures every book (lines 3225–3231), and `shelfAt()` calls `getBoundingClientRect()` on every `[data-shelf]` (lines 3257–3264). On pointermove this runs per event (line 3392). This is the single largest performance bug in the prototype.
- Lifting a book moves the real node to a fixed drag layer, inserts a placeholder in the shelf, and FLIPs the affected rows (lines 3331–3390). This is a sound pattern and survives at 2,000 books **if** the measurement scope is reduced.

The design intent is ~2,000 books at 10–11 volumes per shelf → ~182 shelves → ~65,000 px of document height. That is what was benchmarked.

---

## 2. Method

Throwaway benchmark at **`/tmp/opencode/perf/bench.mjs`** (not in the repo). Chromium **159.0.8154.6** via Playwright 1.65.1, viewport **390×844**, `deviceScaleFactor` 1 (primary) and 3 (spot check), `isMobile`, touch, **4× CPU throttle** as a mid-range-phone proxy. The page builds 2,000 deterministic spines with the prototype's gradient/shadow/text/band structure and 182 shelves (11 books/shelf). Scroll is driven by `requestAnimationFrame` + `scrollBy(0, 14px)` for 240 frames (~3,360 px, ~9.4 shelves), measuring rAF deltas, `longtask`, and `long-animation-frame`. Heap is from CDP `Runtime.getHeapUsage`; node counts from `Memory.getDOMCounters`.

Modes:

| Mode | What it is |
|---|---|
| `dom-full` | 2,000 spine nodes, no virtualisation |
| `dom-window` | JS window: pool of 10 shelf sections, recycled in place, spacer for scroll height |
| `dom-cv` | All 2,000 nodes, `.shelf { content-visibility: auto; contain-intrinsic-size: auto 358px }` |
| `dom-cv-noise` | `dom-cv` + per-spine `mix-blend-mode: overlay` noise (as in the prototype) |
| `dom-cv-willchange` | `dom-cv` + `.book { will-change: transform }` |
| `canvas2d` | Fixed viewport canvas; each shelf pre-rendered once to an offscreen strip and blitted |
| `webgl2` | One instanced quad per spine, atlas pages, visible shelves culled per frame, pre-rendered furniture |

All numbers below are **[V] measured here**, at **4× / DPR 1 / 390×844** unless stated. "Warm" is the second scroll pass. Reproduce: `cd /tmp/opencode/perf && RATE=4 node bench.mjs` (`RATE=1`, `RATE=6`, `DPR=3` also run).

### Results (2,000 books, 182 shelves)

| Mode | First paint (ms) | DOM elements | Renderer DOM memory* | Scroll p95 / p99 (warm) | Warm frames >50 ms | Worst long task (either pass) | Filter 2,000 (dim/clear) | Drag geometry pass |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **dom-full** | 2,300–2,700 | 19,129 | 61–70 MB | 17.5 / 17.7–17.8 ms | 0 | 67–77 ms | **96–145 / 93–124 ms** | 15–18 ms |
| **dom-window (10 shelves)** | **292–307** | 1,400 | **7.7–8.1 MB** | 24.6–26.8 / 155–172 ms | 6 | **186–190 ms** | 10–13 / 1.1–1.9 ms | 0.5–0.7 ms |
| **dom-cv** | **346–359** | 19,129 | **9.7–10.8 MB** | **17.6–18.8 / 22.0–22.8 ms** | **0** | **0 ms** | **11–18 / 5–6 ms** | 640–650 ms† |
| dom-cv + noise blend | 340–359 | 19,129 | 9.9–10.8 MB | 18.0–18.2 / 25.9–26.5 ms | 0 | 0 ms | 11–16 / 4.7–5.1 ms | 633–669 ms† |
| dom-cv + will-change | 298–363 | 19,129 | 9.7–10.6 MB | 17.8–19.3 / 28.0–31.8 ms | 0 | 0 ms | 11–22 / 4.9–8.1 ms | 593–628 ms† |
| **canvas2d strips** | **158–161** | 10 | **2.0 MB** | 17.6–17.9 / 17.9–19.0 ms | 0 | 0 ms | n/a | n/a |
| **webgl2 atlas** | 2,900–3,155 | 10 | 3.5–3.8 MB | 17.5–17.7 / 18.4–19.7 ms | 0 | 0 ms | n/a | n/a |

\* CDP `embedderHeapUsedSize`: Blink DOM/layout/style memory, **not** Android PMF. `dom-cv` is low because skipped subtrees get no layout boxes. DPR 3 spot-check: `dom-full` 73.7 MB, `dom-cv` 9.7–10.5 MB — the ranking is unchanged.
† This is the cost of the prototype's `bookRects()`/`shelfAt()` pattern when it forces layout of every `content-visibility`-skipped shelf. It is a **code bug**, not an argument against `content-visibility`; the fix is in §4.

Initial setup in isolation: building the 19,129-element innerHTML costs **160–210 ms** at 4×; the remaining ~2.1–2.5 s of `dom-full`'s first paint is layout/style/paint. With `content-visibility` that falls to ~150–200 ms of rendering work. This is the cleanest explanation of where the DOM "breaks down": **not node construction, but laying out and painting 2,000 spines at once.**

Throttle sensitivity for `dom-cv` first paint / warm p95-p99: **1×: 79 ms / 17.0–17.1 ms**, **4×: 359 ms / 17.6–22.8 ms**, **6×: 442 ms / 20.2–36.1 ms**. At DPR 3 / 4×: 297 ms / 18.2–23.3 ms (no consistent effect in headless software raster; the ranking is unchanged). The ranking of modes did not change at any setting. First-pass (cold tile cache) p99 is higher than warm: `dom-full` 57–60 ms and `dom-cv` 36–37 ms at 4×; `dom-cv` still produces no long task, while `dom-full` produces six 50–78 ms tasks.

---

## 3. DOM vs canvas/WebGL2

### Where the DOM actually breaks down

Measured here, in order of severity **[V]**:

1. **Initial layout and paint of the whole wall.** `dom-full` takes **2.3–2.7 s** at 4× before first paint and holds **61–70 MB** of Blink DOM/layout memory. That is the cold-start cliff, and it grows linearly with book count.
2. **Global style changes across all books.** Dimming non-matching books for a label/status filter costs **96–145 ms at 4×** on `dom-full` — several dropped frames plus a visibly late filter. With `content-visibility` it is **11–18 ms**, because skipped shelves never compute descendants' style.
3. **O(N) geometry reads during drag.** The prototype's `bookRects()`/`shelfAt()` patterns cost **~650 ms per pass at 4×** on `dom-cv` (because they force layout of every skipped shelf) and ~18 ms on `dom-full`. Any design where `pointermove` is O(library) will fail regardless of rendering architecture.
4. **Revealing new shelves during scroll** costs paint/raster: `dom-full` shows 50–80 ms long tasks on the first pass until shelf tiles are cached. This is the one cost that is intrinsic to a tall DOM, and exactly what `content-visibility` amortises.

Notably, **steady-state scrolling of `dom-full` is already 60 fps** once painted **[V]** (17.5 ms p95, zero >50 ms frames). Scrolling is handled on the compositor thread; a non-blocking scroll does not involve Blink. Do not "fix" scrolling that is not broken.

### Why canvas/WebGL2 is not the default

Canvas/WebGL win on the benchmark: no long tasks, p99 ~19 ms, ~2–4 MB DOM memory **[V]**. They are real options, but they lose on product-level constraints **[I]**:

- **Text and accessibility [I].** 2,000 buttons with `aria-label`, vertical text, focus, find-in-page and tap targets come free with DOM. Canvas needs a parallel accessibility tree and a manual hit-test map. The shelf is the primary navigation surface; that is a large regression.
- **Texture memory at phone DPR is the killer [I, arithmetic].** The benchmark's WebGL atlas is 48×272 cells at DPR 1: 7 × 2048² RGBA = **112 MiB**. At DPR 3 a spine cell is ~144×816; 14×2 = 28 spines per 2048² page → ~72 pages → **~1.1 GiB**. That is not shippable. A windowed atlas (visible ±1 shelf) stays at 1–2 pages (~16–32 MiB at DPR 3), but then you must rebuild/patch textures as you scroll — extra complexity to save ~2 ms on p99.
- **Canvas 2D is viable but not free [V measured for speed; I for DPR-scaled strip memory].** The strip-cache design measured 158 ms first paint and 17.9/19.0 ms warm. At DPR 3 each cached shelf strip is ~1098×1074×4 ≈ **4.7 MB**; an 8-shelf LRU is ~38 MB, which is fine, but text is rastered per shelf and crispness/zoom becomes your problem. It is a good **fallback**, not a first choice.
- **Drag-and-drop is harder.** The existing lift/ghost/placeholder/FLIP interaction would have to be reimplemented for a canvas scene. With DOM + `content-visibility`, the nodes exist, so drag works unchanged.

### Where a hybrid would make sense

Only if the DOM misses targets on a real device: **DOM for the visible shelves (pointer/tap/accessibility), canvas for a decorative fixed background or for pre-rendered shelf strips**. Do not split the spine content itself across DOM and canvas — two sources of truth for the same scene is the worst maintenance outcome.

---

## 4. Virtualisation: use rendered-content virtualisation first

`content-visibility: auto` is virtualisation performed by the engine **[V]** (MDN + web.dev): off-screen subtrees get **layout, style, paint and hit-testing containment**, keep their DOM and accessibility nodes, and render just in time as they approach the viewport. It also caches rendering state, so it does not redo the same work each pass. Verified in MDN and the web.dev article (Chrome 85+/Baseline 2024), and measured here: first paint 346–359 ms, ~10 MB DOM, zero scroll long tasks, filter 11–18 ms.

That satisfies the map's standing decision to "virtualise the shelf" without adding a JS window **[I]**. Keep node identity: filtering, drag, focus, and return-to-position all keep working on the real nodes.

### If a JS window is needed (fallback A)

Concrete recommendation from the measured numbers **[I]** (sizing informed by [V] measurements):

- **Window size: 8 shelves** for a 390×844 viewport. Visible height holds ~2.4 shelves; 8 = 2 above + visible + ~3 below, which hides mount latency during a normal fling and costs ~1,400 DOM elements / 8 MB. (The benchmark used 10 and got 8.1 MB; 8 is enough.) Add **1-shelf hysteresis** so small scroll jitter does not swap a slot back and forth.
- **Recycle shelf sections, not the whole list.** One `<section>` per shelf in the pool with 11 permanent book nodes; update `--w`, `--h`, `--c1`, `--c2`, text, band colours, seal/ribbon visibility, and `top`. Measured in-place update: **0.9–1.3 ms** average, 2.3–4.8 ms max at 4×. Do not `replaceChildren()` / re-`innerHTML` a shelf: that variant produced 150–190 ms paint stalls at each boundary.
- **Height comes from a spacer**, not from measuring sections: `#spacer { height: shelves.length * SHELF_H }`, sections absolutely positioned at `index * SHELF_H`.
- **Data structures:**
  ```ts
  type BookId = number;
  interface Book { id: BookId; shelfId: number; slot: number; w: number; h: number;
                    spine: { c1: string; c2: string; fs: number; lean: number };
                    title: string; author: string; labels: LabelId[]; status: Status }
  // persisted/loaded once
  const shelves: { id: number; index: number; capacity: number; books: BookId[] }[];
  const bookById: Map<BookId, Book>;
  // derived once per mutation
  const shelfTops: Int32Array;          // index -> y, fixed SHELF_H
  const slotPrefix: Float32Array[];     // per shelf, cumulative widths for O(1) gap index
  ```
  With fixed shelf height, `shelfAt(y) = clamp(floor((y + scrollY) / SHELF_H))` and `gapIndex(shelf, x)` binary-searches the prefix widths. No DOM reads.
- **`IntersectionObserver` is the wrong tool for the window.** It is asynchronous and delivers after intersection, so it can only tell you something became visible — too late to mount it before paint. Use scroll math (or, better, let `content-visibility` do it). Use `IntersectionObserver` for *lazy cover decoding* and non-critical work, where a frame of latency is fine.
- **Drag/drop with recycling:** keep the source shelf pinned in the pool until drop; move the dragged node into the fixed drag layer; resolve the drop target from the model (`shelfId`, `slot`), never from "is this element mounted"; commit the move, then re-window. With `content-visibility` there is no recycling, so the existing ghost/placeholder works as written — subject to the O(N) fix below.
- **Edge auto-scroll** stays a single `requestAnimationFrame` loop calling `scrollBy(0, dy)`. Hit-test at most once per frame using the arithmetic above; do not call `getBoundingClientRect()` across shelves inside the loop.

### Mandatory fix to the prototype's drag code

Replace `bookRects()` / `shelfAt()` over the whole document with the model lookups. Scope FLIP to the **source and target shelves only** (~22 books): read those rects once per gap change, not per pointer move. The measured cost of the scoped version is **0.4 ms per pass at 4×**; the unscoped version is **650 ms**. Also note the web.dev warning: calling layout-forcing APIs on `content-visibility: hidden/auto` subtrees defeats the optimisation, which is exactly what the unscoped code does.

Target drop animation: 190 ms transform/opacity only; no layout in the drop commit beyond moving one logical book and re-rendering at most two shelves.

---

## 5. Covers and text

### Spines

- Keep spines as **text + CSS**, not images. With `content-visibility`, only ~2–3 shelves' worth of text is shaped at a time.
- The prototype uses `writing-mode: vertical-rl` per title and author. Vertical text shaping is more expensive than horizontal **[I]**, but the visible count is ~30–50 spines, so it is not a scroll-path problem. Keep `text-overflow`/pre-truncation (`spineTitle()`) so no spine can reflow to multiple lines.
- Bundle the shelf serif (no network font), `font-display: swap` for the reader, and preload the shelf font. Avoid synthesised bold/italic on 2,000 nodes **[I]**.
- Do not put `will-change` on `.book` or `.spine`. Measured: no p95 gain (17.8–19.3 vs 17.6–18.8 ms), first paint within noise (298–363 ms both), and a consistently worse p99 (28–32 vs 22–23 ms) — layers are created and retained for no benefit. Apply `will-change: transform` **only to `.book-ghost` while lifted**, and remove it on drop. This matches MDN's guidance to use it sparingly, toggle it via script, and never on large subtrees.

### Covers

Covers are detail-view only in the approved design, which is the right call **[I]**. Strategy:

- One cover at a time. Create the `Image`, set `src`, `await img.decode()`, then attach. `decode()` resolves when the bitmap is ready, preventing the frame after insertion from stalling on decode.
- Cover files should be stored as a reasonable max dimension (e.g. 1,200 px on the long edge) and rendered at `object-fit: cover`. A 1000×1500 RGBA bitmap is ~6 MB decoded **[I, width×height×4]**; keep at most 2–3 decoded covers (current + neighbours) and let the rest be re-decoded.
- If cover-out shelves are added later: 2× thumbnails (~160–240 px wide, WebP), `loading="lazy"` + `IntersectionObserver` or `content-visibility` on the shelf, and an LRU of decoded thumbnails. Never 18 full-size covers in the document.
- `decoding="async"` on all non-hero images; avoid `filter`/`backdrop-filter` over the cover while it fades in.

### Font rendering cost

Text rasterisation is CPU work and shows up in first paint, not in steady scroll **[I]**. `dom-cv`'s first paint of 346–359 ms at 4× includes rendering three shelves of vertical text. Pre-baking the noise and reducing per-spine shadows are the two cheapest wins if first paint needs to come down further.

---

## 6. CSS 3D, compositing, and what to avoid on the scroll path

Everything in this section is **[V]** against the cited engine docs/MDN unless marked otherwise; the application to this shelf is **[I]**.

- **Scroll is compositor-driven.** Chromium's `cc` handles scroll gestures on the compositor thread "responsively without involving Blink"; input that cannot be handled there (a synchronous JS touch/wheel handler) is forwarded to Blink. Keep all scroll/touch listeners `{ passive: true }`, avoid non-passive `touchmove`/`wheel`, and never call layout-forcing APIs from a scroll handler.
- **Only `transform` and `opacity` are compositor-only.** Animations of `top`, `left`, `width`, `height`, `box-shadow`, `filter`, or `background` force layout/paint. The lift/ghost/drop and the detail entrance already use transforms; keep it that way.
- **`preserve-3d` is a per-frame sorting cost.** Chromium puts quads in a 3D context into a **BSP tree to sort and intersect them**. That is fine for one open book/flip card; it is the wrong tool for 182 shelves. Keep the wall flat (2D transforms), and scope `preserve-3d` to a single detail/flip subtree.
- **Flattening traps** (from MDN `transform-style`): `overflow` other than `visible`/`clip`, `opacity < 1`, `filter`, `clip-path`, `mask`, `mix-blend-mode`, `isolation: isolate`, and paint containment on the 3D ancestor collapse children to `flat`. The prototype's `.spine { overflow: hidden }` is a leaf and safe; do not add any of these to the flip card's 3D ancestor — clip on an outer wrapper instead.
- **Layers cost memory.** Promoting many elements creates textures and management work; on memory-constrained devices the cost outweighs the benefit. One or two promoted elements during an interaction is the budget. `will-change` on 2,000 books is exactly the "layer explosion" the web.dev compositor article warns about.
- **The noise blend is tolerable but not free.** `mix-blend-mode: overlay` per spine costs ~0–2 ms p95 in the benchmark (18.0 vs 17.8 ms) because only visible spines blend under `content-visibility`. If a low-end device misses p99, bake the noise into the gradient or move it to one shelf-level overlay with normal blending.
- **Shadows: cap them.** Each spine has six inset/outset `box-shadow` layers in the prototype. They measured acceptably (they are part of all DOM numbers above), but they are pure paint cost. Collapse to one inset highlight + one drop shadow; pre-render shelf furniture (crown/lip/board/plinth gradients) as a single background image reused by all shelves.
- **Avoid `backdrop-filter` on the sticky filter bar.** It creates a render pass per frame while scrolling. Use an opaque/gradient bar.

### Concrete CSS rules

```css
/* Rendering virtualisation: the core of the recommendation. */
.shelf {
  content-visibility: auto;
  contain-intrinsic-size: auto 358px; /* measured shelf height; `auto` remembers real size */
}

/* The scrolling wall itself must stay flat and clip on an outer wrapper. */
.wall { overflow-x: clip; overflow-y: visible; }

/* Spines: paint once, never animate layout. */
.book  { touch-action: pan-y; transform: rotate(var(--lean)); }
.spine { overflow: hidden; }             /* leaf, safe */
.book, .spine { will-change: auto; }     /* never promote 2,000 nodes */

/* Only the lifted ghost is promoted, and only while lifted. */
.book-ghost.is-lifted { will-change: transform; }

/* 3D only on the isolated detail/flip subtree.
   Do not put overflow/opacity/filter/mask/mix-blend-mode on any 3D ancestor. */
.detail-3d-stage { transform-style: preserve-3d; perspective: 1200px; }

/* Interaction feedback without paint storms. */
.book.is-dim { opacity: .24; }           /* opacity is compositor-only */
```

---

## 7. Memory ceiling in Android System WebView

There is **no hard per-app ceiling for web content**:

- On Android 8+, WebView runs the page in an isolated sandboxed renderer process; on low-RAM devices it may fall back to one process. Most WebView memory — DOM, JS heap, decoded graphics — is **native memory**, not Java heap. A Java heap dump therefore does not show it.
- Native memory is not capped by `maxHeap`; it "can silently grow to gigabytes", and Android's Low Memory Killer starts terminating background processes and eventually the foreground app. The renderer can be killed; apps must handle `onRenderProcessGone` and recreate the WebView.
- `ActivityManager.getMemoryClass()` returns a Java-heap guidance value whose documented baseline is **16 MB**; it is **not** the ceiling for WebView content. Do not size the shelf against it.

Practical budget for a mid-range 4 GB phone **[I]**: keep the **shelf's renderer DOM ≤ 40 MB** (measured 9.7–10.8 MB for `content-visibility`, 61–70 MB unvirtualised), the **whole WebView renderer PMF ≤ ~200 MB**, and the **app total ≤ ~300 MB** under normal use. The WebView baseline process/shared-library overhead is separate. Measure with `dumpsys meminfo <renderer_pid>` and `adb shell cat /proc/<pid>/maps | grep anon:` as documented by Android.

---

## 8. Measurable targets and fallbacks

Budgets are **[I]** for the **reference mid-range device** (4 GB RAM, 60 Hz, Android 12+, current WebView), with a 4×-throttled headless Chromium proxy used in CI. Targets are chosen so that the measured `dom-cv` numbers pass with headroom, and `content-visibility` + the scoped drag code are the primary implementation.

| Metric | How measured | Budget | Measured proxy (4×) | If missed |
|---|---|---|---|---|
| First shelf interactive | navigation/data-ready → first shelf painted, `PerformanceObserver` paint | **≤ 500 ms cold; ≤ 200 ms warm** | 346–359 ms | Defer off-screen shelves; skeleton/first-3-shelves sync, rest in `rAF`/idle; reduce shadows/noise |
| Scroll frame time | rAF deltas during 240-frame fling; LoAF | **p95 ≤ 16.7 ms; p99 ≤ 25 ms; zero frames > 50 ms** | p95 17.6–18.8, p99 22–23, zero | Bake noise, drop shadows, shelf background image; add JS window; then canvas strips |
| Long tasks while scrolling | `longtask` + `longanimframe` | **none > 50 ms** | 0 | Same ladder; check for forced layout in drag/scroll handlers |
| Renderer DOM memory | CDP `embedderHeapUsedSize` / `dumpsys meminfo` | **≤ 40 MB** | ~10 MB | JS window (8 MB) + cover LRU; drop full-atlas canvas |
| Filter apply/clear | `performance.now()` around class toggle + forced style flush | **≤ 50 ms (≤ 16 ms preferred)** | 11–18 ms | Keep `content-visibility`; avoid per-book restyle; dim one shelf-level overlay if needed |
| Drag hand-off | long-press (380 ms) → ghost visible | **≤ 100 ms** from lift | ghost is the lifted node, transform-only | Pre-warm the ghost layer on `pointerdown`; haptic at lift |
| Drag per-move | pointermove handler time, scoped to 2 shelves | **≤ 4 ms** | 0.4 ms scoped / 650 ms unscoped | Fix O(N) measurement first; then window |
| Drop commit | drop → new position painted | **≤ 100 ms** | move one book + repaint 2 shelves | Avoid full `render()`; update two shelf DOMs |
| Cover open | tap → cover decoded and shown | **≤ 100 ms** after tap; no blank frame | not measured (detail only) | `img.decode()`, 2× pre-downscale, 2–3 cover cache |

### Fallback ladder

1. **Tune the DOM (days):** bake noise, reduce each spine to two shadows, pre-render casework per shelf as one image, cap the shelf layer's raster DPR at 2× if needed, remove `backdrop-filter`.
2. **JS window (days):** 8-shelf pool, model geometry, in-place updates, source-shelf pinning during drag. Trades the ~10 MB / zero-jank `content-visibility` result for 8 MB and boundary repaint spikes; mitigate by pre-rendering the next shelf strip offscreen before it enters the window (use `requestIdleCallback`).
3. **Canvas 2D strips (1–2 weeks):** fixed viewport canvas, LRU of 6–8 shelf strips at device DPR (~30–38 MB), DOM overlay or model hit-test for taps/accessibility. Measured 158 ms first paint, 17.9/19.0 ms.
4. **WebGL2 windowed atlas (2–3 weeks, last resort):** only visible ±1 shelf in the atlas (≤ 2 pages, 16–32 MiB at DPR 3), instanced draw, DOM/a11y overlay. Never build a 2,000-spine atlas at phone DPR.
5. **Product fallback:** if a genuinely low-end device still misses after (1)–(3), paginate the wall into "rooms" of ~500 books, or reduce visible spine density. Do not ship a 30 fps scroll.

---

## 9. Caveats on the benchmark

- **Chromium desktop, not Android WebView on ARM.** Headless Chromium 159 on a 6-core x86 box with software GL (SwiftShader). Absolute numbers are a proxy; the *ranking* and the shape of the failures are the useful output. Real-device GPU raster will make gradients/shadows cheaper and DPR-3 text more expensive **[I]**.
- **Scroll is main-thread-driven** (`rAF` + `scrollBy`), which is a worst case for DOM and a fair case for canvas/WebGL (they must draw on the main thread every frame). A real compositor fling can be smoother for a static DOM/CV wall; it cannot make canvas/WebGL free.
- **DPR 1 primary.** DPR 3 was spot-checked for DOM (ranking unchanged, `dom-cv` 297 ms / 18.2–23.3 ms, ~10 MB). Canvas/WebGL backing stores were not scaled to DPR 3, so their texture-memory cost is understated by ~9×; the atlas arithmetic in §3 gives the real numbers.
- **No real fonts, network, cover images, SQLite, or Tauri IPC.** Shelf data is generated synchronously in the page. The first-paint budget excludes the Rust/SQLite query and Tauri startup; add those on device.
- **Memory numbers are Blink embedder heap**, not Android PMF/RSS. Treat them as relative, not absolute.
- **`dom-window` numbers depend heavily on the recycling implementation.** The measured in-place updater is fast (≤ 4.8 ms), but repainting the newly mounted shelf still produced 150–190 ms stalls at 4×. A production window must pre-render ahead; that is extra complexity the `content-visibility` path avoids.
- **WebGL setup is eager and therefore unfair.** The 3.0 s first paint is dominated by rasterising 2,000 spine textures synchronously; a lazy/windowed atlas would cut it to tens of milliseconds and is required anyway for memory.

---

## 10. Sources

**Measured here** — `/tmp/opencode/perf/bench.mjs`, Chromium 159.0.8154.6, Playwright 1.65.1, 2026-11-24. Raw runs in `/tmp/opencode/perf/out/results-*.json`.

**Engine behaviour**

- `content-visibility` — skips layout/style/paint/hit-testing for off-screen content, keeps DOM and accessibility, `contain-intrinsic-size: auto` remembers rendered size: <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>
- web.dev, *content-visibility: the new CSS property that boosts your rendering performance* — Chrome 85+, 7× example (232 ms → 30 ms), warning that layout-forcing DOM APIs defeat it: <https://web.dev/articles/content-visibility>
- Chromium `cc` design doc — compositor thread handles scroll gestures without Blink; sync JS touch/wheel handlers force Blink; `transform-style: preserve-3d` puts quads in a 3D context sorted/intersected with a BSP tree: <https://chromium.googlesource.com/chromium/src/+/HEAD/docs/how_cc_works.md>
- web.dev, *Stick to compositor-only properties and manage layer count* — only `transform`/`opacity` avoid layout+paint; every layer costs memory; aim 4–5 ms compositing: <https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count>
- MDN `will-change` — use sparingly, toggle via script, overuse costs memory and slows the page; don't apply to large sections: <https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>
- MDN `transform-style` — flattening triggers (`overflow`, `opacity`, `filter`, `clip-path`, `mask`, `mix-blend-mode`, `isolation`, paint containment): <https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style>
- MDN `IntersectionObserver` — asynchronous notifications: <https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver>
- MDN `HTMLImageElement.decode()` — resolves once decoded, avoiding a stall when the image is attached: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode>
- Khronos WebGL 2.0 spec — `drawArraysInstanced`, `vertexAttribDivisor`, instancing in core: <https://registry.khronos.org/webgl/specs/latest/2.0/>

**Budgets**

- web.dev RAIL — 10 ms per frame, 100 ms input response, 5 s load on mid-range mobile: <https://web.dev/articles/rail>
- web.dev, *Optimize long tasks* — a task over 50 ms is a long task; blocking period: <https://web.dev/articles/optimize-long-tasks>

**Android WebView memory and lifecycle**

- Android, *Manage and diagnose WebView memory* — multi-process since Android 8; DOM/JS/graphics are native memory; native memory not capped by `maxHeap`, can grow to gigabytes; LMK kills; renderer PMF vs browser PMF; `dumpsys meminfo` workflow: <https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory>
- Android, *Manage WebView objects* — `onRenderProcessGone`, renderer importance, renderer killed for memory: <https://developer.android.com/develop/ui/views/layout/webapps/managing-webview>
- Android, *Overview of memory management* — per-app heap limit varies by device; `getMemoryClass()`: <https://developer.android.com/topic/performance/memory-overview>
- `ActivityManager.getMemoryClass()` — baseline 16 MB, Java-heap guidance only: <https://developer.android.com/reference/android/app/ActivityManager#getMemoryClass()>

**Repo references**

- Prototype: `prototype/design/flows.html` — spine markup 2363–2387, spine CSS 391–487, V4 spine CSS 1213–1253, drag 3219–3492.
- Shelf interaction decision: `.scratch/pocket-library/issues/01-shelf-interaction.md`.
- Design system decision: `.scratch/pocket-library/issues/06-visual-design-system.md`.
- Framework/WebView notes: `.scratch/pocket-library/notes/framework-research.md`.

---

## Ticket summary (~10 lines)

1. **Recommendation:** keep DOM-per-spine; add `content-visibility: auto` + `contain-intrinsic-size: auto 358px` per shelf. Do not adopt canvas/WebGL for v1.
2. **Measured:** `dom-cv` first paint 346–359 ms at 4× CPU (vs 2,300–2,700 ms unvirtualised), ~10 MB renderer DOM (vs 61–70 MB), scroll p95 17.6 ms / p99 22 ms warm, zero >50 ms frames.
3. **The DOM's real failure modes are cold layout/paint, global style changes, and O(N) geometry reads — not steady scroll.** `content-visibility` fixes the first two; the third is a prototype bug.
4. **Filter dim/clear:** 11–18 ms with `content-visibility` vs 96–145 ms unvirtualised. This matters for ticket 07.
5. **Drag as written is O(library):** `bookRects()`/`shelfAt()` over 2,000 books measured 650 ms per pass at 4×. Replace with arithmetic shelf/slot lookup and scope FLIP to the source+target shelves (0.4 ms measured).
6. **Drag/drop needs no recycling** under `content-visibility`; keep the ghost/placeholder pattern. If a JS window is ever needed, use an 8-shelf pool with hysteresis and pin the source shelf during drag.
7. **Covers:** detail-only, one at a time, `await img.decode()` before attach; 2–3 decoded covers max. Never 18 full covers in the shelf DOM.
8. **CSS:** transform/opacity only on the interaction path; no `will-change` on books; keep `preserve-3d` off the wall (BSP sorting); avoid blend/filter/opacity/overflow on 3D ancestors; cap shadows and bake the noise if needed.
9. **Targets:** first shelf ≤500 ms cold / ≤200 ms warm; scroll p95 ≤16.7 ms, p99 ≤25 ms, no frame >50 ms; renderer DOM ≤40 MB; drag move ≤4 ms; filter ≤50 ms (16 ms preferred).
10. **Fallback ladder:** tune paint cost → 8-shelf JS window → canvas 2D strip cache (158 ms / 17.9 ms measured) → windowed WebGL2 atlas (never a 2,000-spine atlas: ~1.1 GiB at DPR 3).
