# Reader engine and annotation model (2026-11-24)

**Question:** which EPUB renderer should PocketLibrary use, and how must annotations be represented so M4 highlights/notes are not a rewrite?

**Status labels**

- **[V]** verified against a primary source on 2026-11-24: official docs, spec text, package metadata, or source code.
- **[V-local]** verified by running the library here on 2026-11-24 in headless Chromium **156.0.7569.0** (Playwright build 1248), phone viewport 390×844, DPR 3, touch. This is Chromium, **not** Android WebView; treat absolute timings as desktop indicators.
- **[I]** inference or estimate, not directly tested.

---

## TL;DR

**Primary: `foliate-js`, vendored at a pinned commit and wrapped behind our own `EpubReaderEngine`.** It is the strongest candidate for reading quality: bisecting-based reflow, instant progress without loading the whole book, built-in in-book search, TTS, fixed-layout support, and an annotation overlay that does not mutate the book DOM. MIT, ~1.2k stars, used in stable Foliate releases, pure ES modules, no build step, no hard dependency beyond a vendored zip reader. Its cost is an explicitly unstable API and a **security obligation**: its iframe is sandboxed with `allow-scripts allow-same-origin`, so a strict Tauri CSP is mandatory. Without CSP, a scripted EPUB can write to the parent document — confirmed locally.

**Fallback: `@likecoin/epub-ts@0.7.4`**, a maintained TypeScript fork of epub.js 0.3.93 (BSD-2, typed, ~970 tests, only `jszip` at runtime, active in Nov 2026). It is the pragmatic choice if foliate-js's API churn or the CSP work becomes a time sink, or if we want the familiar epub.js API (`rendition.themes`, `rendition.annotations`, `book.locations`) with a maintained upstream. Do **not** use raw `epub.js@0.3.93`.

**PDF: `pdfjs-dist@6.5.438`**, `PDFViewer`/`PDFSinglePageViewer`, text layer enabled, local worker + `cmaps/` + `standard_fonts/` + `wasm/`. Modern build for current WebView; `legacy` build targets Chrome 125+. M1 needs page fit/zoom, outline TOC, page+offset resume, page-level bookmarks. Persistent PDF highlights are M4, but enabling the text layer in M1 is what keeps M4 cheap.

**Annotations: store a Readium-shaped `Locator` plus W3C selectors (CFI + text quote + prefix/suffix + position), never a bare CFI.** Both EPUB engines fail to use CFI ID/text assertions when resolving. In a local test, inserting one paragraph before the target made epub.ts resolve the CFI to `null`, and made foliate-js throw `IndexSizeError`. A CFI alone is not a durable anchor.

**Never:** a custom XHTML/iframe renderer (weeks of work to recreate pagination, CFI, selection mapping, fixed layout, footnotes), raw epub.js (no GitHub release since 2020, last npm release 2022; 519 open issues/PRs), or Readium Web for M1 (it does not parse EPUB; it needs a prebuilt RWPM manifest and positions list).

---

## 1. Engine landscape

| Engine | Status / licence | Runs in plain WebView? | Paginated + scrolled | Themes / typography | CFI + highlights | Search | Fixed layout | Verdict |
|---|---|---|---|---|---|---|---|---|
| **foliate-js** | Active; last commit 2026-05-01; 1,159★, 74 open issues/PRs; MIT; no releases/tags | **Yes** — pure ES modules/custom element; no build; vendor `zip.js` | **Yes**; `flow` attr switches without reload; scrolled is per-section, **no continuous scroll** | App CSS via `renderer.setStyles()`; `::part(filter)` | Yes; `getCFI`/`resolveCFI`; `Overlayer` SVG; app persists annotations | **Built-in** (`view.search`) | Yes (`fixed-layout.js`) | **Primary** |
| **@likecoin/epub-ts** | Active fork; 0.7.4 2026-11-13; 24★, 4 open issues/PRs (all Dependabot); BSD-2 | **Yes**; ESM/CJS/UMD; documented WebView use | Yes (`flow: paginated / scrolled / scrolled-doc`; default + continuous managers) | Built-in `rendition.themes.*` | Yes; `rendition.annotations.highlight/underline/mark` via marks-pane SVG | **No built-in search** | epub.js `layout` support | **Fallback** |
| **epub.js** | Effectively unmaintained; last GitHub release 0.3.88 (2020-07-01), last npm 0.3.93 (2022-02-16), 0.5 alpha 2023; 519 open issues/PRs | Yes for basic rendering [V-local], but fragile | Yes, with known bugs | `rendition.themes` | Yes, CFI-only | No | epub.js layout | **Do not use** |
| **@intity/epub-js** | Fork 0.3.103 (2026-09-26), 51★; BSD-2; API-breaking rework; pulls `jsdom` | Yes, but heavier/browser-unproven | Yes | Yes | Yes | No | ? | Not recommended |
| **Readium `@readium/navigator`** | 2.16.1 (2026-11-20), 163★, BSD-3, very active | Yes, but **not self-contained**: needs RWPM manifest + Fetcher + positions list | Yes (Readium CSS) | Preferences API | Decorations API (Locator-based) | No built-in book search | Yes | Only if we already have a manifest pipeline |
| **`@lingo-reader/epub-parser`** | 0.4.7 (2026-11-22), 42★, MIT | Parser only | — | — | — | — | — | Not a renderer |
| **EpubKit** | Swift EPUB parser (322★) / Python optimiser | No | — | — | — | — | — | Ruled out |
| **Custom XHTML/iframe** | We own it | Yes | We build it | We build it | We build it | We build it | We build it | Ruled out |

Sources: table rows are backed by the detailed sections below.

---

## 2. epub.js: current state and the real cost of vendoring it

### 2.1 Release reality

- GitHub's newest release is **v0.3.88, 2020-07-01**. [V] ([releases](https://github.com/futurepress/epub.js/releases))
- npm's `latest` is **0.3.93, 2022-02-16**; there are `0.5.0-alpha.0..3` published Jan–Sep 2023 but never promoted. [V] ([npm metadata](https://registry.npmjs.org/epubjs))
- The repository is **not archived**, and `master` has had merges in 2025–2026 (memory-leak fixes, continuous-scroll jitter). But none of that is in a published release. [V] ([commits](https://github.com/futurepress/epub.js/commits/master))
- **519 open issues/PRs** (GitHub `open_issues_count`, which includes PRs); an "Is this project abandoned?" issue opened 2025-01-24 is still open with no maintainer answer. [V] ([#1406](https://github.com/futurepress/epub.js/issues/1406))
- The epub.js issue thread itself points users to foliate-js and Readium as alternatives. [V, community comments] (same issue)

### 2.2 Does it still work?

**Basic rendering: yes.** [V-local] I loaded `epubjs@0.3.93` from npm in Chromium 156 with a 2-chapter EPUB: open, TOC, paginated display, `currentLocation().start.cfi` and `locations.generate(1024)` all worked (225 ms for 2 sections). No page errors. So "it is broken in modern Chromium" is too strong; "it works until it doesn't" is accurate.

**But its progress generator does not scale.** [V-local] On the same 500-spine-item, 186 KB EPUB, `book.locations.generate(1024)` **did not finish within 15 s**. The reason is in the source: `Locations` defaults to `pause = 100` ms and waits 100 ms after every section (`setTimeout(..., this.pause)`). [V] ([src/locations.js](https://github.com/futurepress/epub.js/blob/master/src/locations.js)) 500 sections therefore has a hard floor of ~50 s. This is exactly the "1000-page book" case the ticket asks about, and it is a user-visible first-open stall.

### 2.3 Known bugs that matter to this reader

All open on `futurepress/epub.js` as of 2026-11-24:

- **#982** `rendition.currentLocation()` does not update when font size changes (2019, 14 comments) — position/progress can go stale after typography changes. [V] ([#982](https://github.com/futurepress/epub.js/issues/982))
- **#1218** columns shift right when switching pages (2021, 15 comments). [V] ([#1218](https://github.com/futurepress/epub.js/issues/1218))
- **#1131** TOC + continuous scroll jumps after navigation (2020). [V] ([#1131](https://github.com/futurepress/epub.js/issues/1131))
- **#1295** continuous scroll-up does not return to the same page (2022). [V] ([#1295](https://github.com/futurepress/epub.js/issues/1295))
- **#1343** column shift when selecting text (2023). [V] ([#1343](https://github.com/futurepress/epub.js/issues/1343))
- **#744** "getting current page and total pages" (2018, 42 comments) — the locations/pagination model remains confusing. [V] ([#744](https://github.com/futurepress/epub.js/issues/744))

Its CFI implementation explicitly says it does **not** implement text location assertions, side bias, temporal or spatial offsets. [V] ([src/epubcfi.js](https://github.com/futurepress/epub.js/blob/master/src/epubcfi.js) file header) That matters for annotations (§5).

### 2.4 API shape (for comparison with foliate)

```js
const book = ePub(arrayBuffer);
const rendition = book.renderTo(el, { flow: "paginated", width, height });
await rendition.display(cfiOrHref);
const nav = await book.loaded.navigation;      // nested TOC
await book.locations.generate(1024);           // expensive; persist the result
const pct = book.locations.percentageFromCfi(cfi);
const loc = rendition.currentLocation();       // { start: { cfi, href, displayed }, end: ... }
rendition.themes.fontSize("20px");
rendition.themes.register("dark", { body: { background: "#111", color: "#eee" } });
rendition.themes.select("dark");
rendition.annotations.highlight(cfiRange, data, cb, "hl-yellow", { fill: "#ff0" });
rendition.flow("scrolled");
```

TOC, locations, themes, annotations, page turns and CFI restore all exist. **Bookmarks and search do not**; both are app-level (bookmarks = stored CFI/Locator; search = walk section text yourself). [V] ([API docs](https://github.com/futurepress/epub.js/blob/master/documentation/md/API.md))

### 2.5 Vendoring burden

If we forked raw epub.js ourselves: pin 0.3.93 (or an unreleased master SHA), keep a patch queue, rebuild with its webpack 4/Babel toolchain, and own 519 issues plus any Chromium regressions. Package is **6.4 MB unpacked**, ~133 KB gzip; runtime deps include `jszip`, `localforage`, `@xmldom/xmldom`, `marks-pane`, `lodash`, `core-js`. [V] ([npm metadata](https://registry.npmjs.org/epubjs)) That is a real ongoing tax for a personal project.

**If we ignored that and vendored raw epub.js anyway, the minimum patch list would be:**

- Replace the 100 ms/section locations pause and make generation cancellable/chunked, or every long book stalls on first open.
- Fix `currentLocation()` after font/line-height changes (#982) or progress/resume drifts.
- Fix column shifting on page turns and text selection (#1218, #1343), or pagination visibly jumps.
- Pick up the unreleased continuous-scroll jitter/memory-leak fixes from `master`, or avoid continuous mode entirely.
- Implement text-location-assertion correction (or accept that CFIs break when the book DOM is modified before/inside the target).
- Add search (or build it app-side).
- Audit the iframe sandbox/CSP story; the default sandbox blocks scripts (good), but any `allowScriptedContent` or remote-resource feature shifts the burden to our CSP.

That is not a one-afternoon patch queue, and every upstream fix would have to be cherry-picked by hand.

**Better:** don't vendor raw epub.js. If we want the epub.js API, use the maintained fork:

#### `@likecoin/epub-ts@0.7.4` [V]

- npm latest **0.7.4, 2026-11-13**; 33 versions; BSD-2; only runtime dependency `jszip`; generated `.d.ts`; ESM/CJS/UMD. [V] ([npm](https://registry.npmjs.org/@likecoin%2fepub-ts))
- README claims a complete TypeScript rewrite of 0.3.93 with same API, 970+ tests, and fixes; benchmark claims `locations.generate(1000)` drops from ~1.76 s to ~10 ms on Alice and from ~43 s to ~159 ms on War and Peace. [V] (README, its benchmark methodology is in the repo; not independently reproduced except the 500-section test below)
- 4 open issues/PRs, all Dependabot bumps; active commits into Nov 2026. [V] ([repo](https://github.com/likecoin/epub.ts))
- Explicitly documents WebView/UMD usage and `File`/`ArrayBuffer` loading. [V] (README)

**Local results** [V-local]:

- Basic 2-chapter book: open/TOC/display/CFI/locations/themes/font-size/page-turn/CFI restore/scrolled flow all worked.
- Highlight: `rendition.annotations.highlight(cfiRange, …)` created an SVG overlay in the **parent** document with `data-epubcfi="epubcfi(/6/2!/4/4[p1],/1:0,/1:80)"`; the book iframe DOM was untouched.
- 500-spine book: `locations.generate(1024)` took **8.3 s** and produced 1,000 locations; heap grew ~2 MB → ~10 MB. Faster than raw epub.js (which timed out at 15 s), but still a first-open stall. It scales with **spine item count**, not page count, so typical 30–80-chapter novels will be much faster.
- Scripted EPUB: default iframe sandbox is `allow-same-origin` only; the EPUB's `<script>` and `onerror` were blocked. Only `allowScriptedContent: true` adds `allow-scripts`. [V] ([src](https://github.com/likecoin/epub.ts/blob/master/src/managers/views/iframe.ts), local test)

**Verdict:** it is a credible fallback and a much safer default than foliate-js for untrusted books. It is still the epub.js architecture (columns, managers) and has a young maintainer base (24★), so it is not the primary quality bet.

---

## 3. foliate-js: the engine behind Foliate

### 3.1 Status, licence, embeddability

- **MIT**, copyright John Factotum. [V] ([LICENSE](https://github.com/johnfactotum/foliate-js/blob/main/LICENSE))
- 1,159 stars, 303 forks, 74 open issues/PRs; last commit **2026-05-01**; **no releases and no tags**. [V] ([repo](https://github.com/johnfactotum/foliate-js), GitHub API)
- README: pure JavaScript, native ES modules, **no build step**, **no hard dependencies**, does not load the whole file into memory, "does not care about older browsers". [V] ([README](https://github.com/johnfactotum/foliate-js#readme))
- It is explicitly **not stable**: "Expect to break and the API to change at any time… include the library as a git submodule… since there's no release yet." [V] (README)
- It is used in "several stable releases of Foliate" (the GTK reader), so the core is battle-tested even though the library API is not semver-stable. [V] (README)
- **Do not use the npm `foliate-js` package**: `foliate-js@1.0.1` (2025-04-21) is published by a third party (`shmandadi`, not John Factotum), and the README says to use a submodule. [V] ([npm metadata](https://registry.npmjs.org/foliate-js)) Vendor the repo at a pinned commit instead.
- Embeddable in a plain WebView: `view.js` defines a `<foliate-view>` custom element, dynamically imports `paginator.js` or `fixed-layout.js`, and uses a vendored `zip.js` for random access. No GTK, Electron, or Node API. [V] (README, source)

### 3.2 What it supports

| Need | foliate-js support | Evidence |
|---|---|---|
| TOC / page list | `book.toc`, `book.pageList`, nested `subitems`; `view.getTOCItemOf()` | [V] README, local test (500-item TOC) |
| Paginated | `flow="paginated"`; CSS multi-column; bisecting to find visible range | [V] README, local |
| Scrolled | `flow="scrolled"`; can switch without reload | [V] README, local |
| Continuous scroll | **No** — "currently there's no support for continuous scrolling" | [V] README |
| Font size / line-height / margins | App CSS via `renderer.setStyles()`; `max-inline-size`, `gap`, `margin`, `max-column-count` attributes | [V] README, source, local |
| Themes | App CSS; `foliate-view::part(filter)` applies filters to book content but not overlays | [V] README |
| Progress | `SectionProgress` uses **section byte sizes**, not rendered pages; `lastLocation.fraction` is instant | [V] source, local |
| Resume | `view.init({ lastLocation })` / `view.goTo(cfi)` | [V] source, local |
| Bookmarks | App-level; no built-in bookmark store | [V] API surface |
| In-book search | **Built-in** `view.search({ query })`, yields CFI + excerpt; README warns it is "extremely slow" and should be incremental | [V] README, local test |
| TTS | `tts.js` returns SSML; not speech output | [V] README |
| Fixed layout | `fixed-layout.js`; PDF adapter is proof-of-concept only | [V] README |
| CFI | `epubcfi.js` parse/stringify, ranges, spatial/temporal/text assertions **parsed but not employed when rendering** | [V] README |
| Highlights | `overlayer.js` generic SVG overlay; `view.addAnnotation({ value: cfi })`; `draw-annotation` event lets app choose `Overlayer.highlight/underline/squiggly`; `hitTest` for taps | [V] README, source, local (draw callback fired) |
| Scripted content | **Not supported**; iframe always has `allow-scripts allow-same-origin` due WebKit bug 218086, so CSP is the only defence | [V] README, source, local security test |

### 3.3 API for position and annotation

From `view.js` [V] ([source](https://github.com/johnfactotum/foliate-js/blob/main/view.js)):

```js
const view = document.createElement('foliate-view');
document.body.append(view);

view.addEventListener('relocate', e => {
  // e.detail = { cfi, fraction, tocItem, pageItem, range, ... }
  save({ cfi: e.detail.cfi, fraction: e.detail.fraction });
});

await view.open(fileOrUrl);           // File, Blob, URL, or a book object
await view.init({ lastLocation: savedCfi, showTextStart: true });

const { doc, index } = view.renderer.getContents()[0];
const range = doc.createRange();
range.setStart(node, 0); range.setEnd(node, 80);
const cfiRange = view.getCFI(index, range);   // -> "epubcfi(...)"

view.addAnnotation({ value: cfiRange, color: 'yellow' });
view.addEventListener('draw-annotation', e => {
  const { draw, annotation } = e.detail;
  draw(Overlayer.highlight, { color: annotation.color });
});
```

`view.addAnnotation` is **not a persistence layer**. It draws into the current iframe's overlayer. When a section is reloaded, the app must re-add the annotations for that section (listen for `create-overlay`/`load`, or re-apply after every `relocate`). This is a small amount of code, but it must be explicit. [V] (source; `#createOverlayer` only re-adds internal search results)

### 3.4 Local results [V-local]

- 2-chapter book: open, TOC, display, `getCFI`, `addAnnotation` (draw callback fired once), page turn, `goTo(cfi)`, `flow=scrolled` without reload, `search("Winston")` → CFI + excerpt, `setStyles` font-size 22px all worked.
- 500-spine, 186 KB book: open **109 ms**, first display **153 ms**, jump to 50% **41 ms**, heap ~1 → ~6 MB. No locations generation. `goTo` takes a **section index** when passed a number; to go to a fraction use `view.goTo({ fraction: 0.5 })`. [V-local]
- **CFI fragility test**: after inserting a `<p>` before the annotated node, `view.resolveCFI(cfiRange).anchor(doc)` threw `IndexSizeError: offset 80 is larger than the node's length (43)`. The same test on epub.ts returned `null`. [V-local]

### 3.5 Security: the one non-negotiable

`paginator.js` sets:

```js
iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
```

because of a WebKit bug; the README says scripted EPUB content is unsupported and that CSP is **imperative**. [V] ([paginator.js](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js), README)

**Local security test** [V-local]:

- Without CSP: a test EPUB's `<script>` ran and set `parent.__PWNED = true` / `parent.__PWNED_DETAIL = 'parent-write'`; its `<img onerror>` also ran. This is full parent-origin XSS from an untrusted book.
- With a strict parent CSP (`script-src 'self'`), the blob iframe inherited the CSP and **both** the inline script and the inline event handler were blocked. `__PWNED` stayed false.
- This must be re-verified on the target Android WebView, because the inheritance behaviour is a Chromium guarantee, not something foliate-js enforces. Do **not** add `blob:` to `script-src` (only to `worker-src`): a book's external script URL would then be eligible to run.

**Tauri CSP is not on by default**; it is only injected if configured. [V] ([Tauri CSP docs](https://v2.tauri.app/security/csp/)) For foliate-js, strict CSP is a **release blocker**, not a nice-to-have.

### 3.6 Integration gaps to plan for

- No built-in TOC/settings chrome; we build it (we are building it anyway).
- No theme registry; we map `light/sepia/dark` tokens to CSS and call `renderer.setStyles([before, after])`. **Call `renderer.render()` after a font-size/line-height change that affects layout**: `setStyles()` swaps the stylesheet and repaints the background, but does not itself trigger a re-layout. [V] (source; `setStyles` has no `render()` call)
- No continuous scrolling; `flow="scrolled"` is per-section. That satisfies "page-turn or scroll mode" but not infinite chapter-to-chapter scroll.
- No tap-to-turn. The paginator handles swipes/snapping but a zero-velocity tap does nothing. Implement tap zones as **left/right edge overlays outside the text column**, with a center zone that toggles chrome; do not cover the whole page or text selection dies.
- Annotations must be re-applied per section; build a small `AnnotationOverlay` controller.
- API can change between commits; pin and wrap.

---

## 4. Readium Web and the other candidates

### 4.1 Readium

- **`readium/readium-js` is archived** (last push 2022-04-11). Do not use. [V] ([repo](https://github.com/readium/readium-js))
- **`@readium/navigator` 2.16.1** (2026-11-20) is current, BSD-3, 163★, very active. It implements reflowable and fixed-layout EPUB navigation, Readium CSS preferences, and a decoration API. [V] ([npm](https://registry.npmjs.org/@readium%2fnavigator), [repo](https://github.com/readium/ts-toolkit))
- **But it is not an EPUB parser.** `EpubNavigator` takes a `Publication` built from a **Readium Web Publication Manifest** and a `Fetcher`; it also requires a **positions list** and will not operate without one. [V] ([Handling Publications](https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/HandlingPublications.md), [EpubNavigator](https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/epub/EpubNavigator.md))
  - That means we would need a Rust/Go step to unzip the EPUB, emit a manifest, rewrite resources, and compute positions before the JS navigator can open it. That is a second backend and a bigger M1 than the whole reader.
- It is genuinely production-grade: used by Thorium Web and cited as used by the Internet Archive, NYU Press, etc.; the Readium project manager describes 3+ years in production and active maintenance. [V, community] ([epub.js #1406 comment](https://github.com/futurepress/epub.js/issues/1406))
- Decorations are the best annotation API of the bunch: app declares the full desired state per group, navigator diffs and re-applies automatically. [V] ([Decorations docs](https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/epub/Decorations.md), [RFC 008](https://readium.org/architecture/proposals/008-decorator-api.html))

```ts
navigator.applyDecorations([{
  id: 'highlight-1',
  locator: myLocator,
  style: { type: DecorationStyleType.Highlight, tint: '#ffff00' }
}], 'user-highlights');
```

**Verdict:** technically the strongest "platform", but the manifest/positions requirement makes it the wrong M1 choice. Keep it as the escape hatch if PocketLibrary ever needs multi-format/DRM/enterprise support.

### 4.2 `@lingo-reader/epub-parser`

Active (0.4.7, 2026-11-22), MIT, 42★, parses EPUB 3.3/OPF 2.0.1 in browser and Node, returns chapter HTML/CSS and converts resource paths to blob/absolute URLs. **It is a parser, not a renderer** — no pagination, CFI, selection, or overlays. [V] ([README](https://www.npmjs.com/package/@lingo-reader/epub-parser)) It is a reasonable input layer if we ever build a custom renderer; it is not a reader engine.

### 4.3 EpubKit

`witekbobrowski/EPUBKit` is a **Swift EPUB parser** (322★, MIT). `b1rdmania/epubkit` is a Python/web EPUB optimiser, not a renderer. Neither gives us a browser reader. [V] (GitHub search/repo metadata) Ruled out.

### 4.4 Other epub.js forks

- `intity/epub-js` 0.3.103 (2026-09-26), 51★, BSD-2. It explicitly reworked the architecture and **broke API compatibility**; it also depends on `jsdom`, `lodash`, `marked`, `resize-observer`, `localforage`. [V] (npm, README) It could be evaluated if we wanted a clean-room epub.js successor, but it is not a drop-in and has a heavier browser footprint. Not recommended over foliate-js/`@likecoin/epub-ts`.
- `react-reader`, `vue-reader`, etc. are wrappers around epub.js, not independent engines. [V, inferred from package docs] Don't count them as maintained alternatives.

### 4.5 Custom XHTML/iframe renderer: real cost and what we lose

The alternative is: parse the EPUB ourselves (container → OPF → spine → nav), sanitise the XHTML, rewrite resource URLs to blob/asset URLs, render each spine item in a sandboxed iframe, and implement our own pagination and CSS.

**What we would actually have to build**

1. **Container/OPF parsing** — Rust `zip` + XML, or JS `fflate` + DOMParser. Includes encryption/obfuscation (`META-INF/encryption.xml`), font deobfuscation, remote-resource rules, EPUB 2 NCX + EPUB 3 nav, page-list, landmarks, `linear="no"`, RTL/vertical writing. A basic parser is days; a compatible one is weeks. [I]
2. **Sanitisation + resource rewriting** — allowlist tags/attributes, strip scripts/event handlers, resolve relative URLs, inline CSS, `@font-face`, SVG, MathML, `epub:type` footnotes. Every rule you miss is either an XSS or a broken book. [I]
3. **Pagination** — the hard part. CSS multi-column (`column-width`, `column-gap`, `column-fill`) plus measuring the visible range, binary-searching the first/last visible text node, anchoring across resize, switching paginated ↔ scrolled, and handling spreads/columns. Foliate's `paginator.js` is ~1,100 lines and its README still calls the strategy "slow, some CSS styles do not work as expected, and other bugs". [V] ([README](https://github.com/johnfactotum/foliate-js#the-paginator), [source](https://github.com/johnfactotum/foliate-js/blob/main/paginator.js))
4. **CFI** — parse/stringify/sort/range/correction, plus mapping CFI ↔ DOM Range, including the fact that assertions must be validated. foliate's `epubcfi.js` is ~350 lines; epub.js's is ~23 KB. [V] (source sizes, 2026-11-24)
5. **Selection + overlays** — Range rects, SVG overlay, tap hit-testing, reflow redraw. `overlayer.js` is small, but the edge cases are not. [V]
6. **Fixed layout** — viewport meta, spread, scaling, page navigation, `pre-paginated` OPF. Foliate has a separate `fixed-layout.js`; it is not free. [V]
7. **Footnotes/pop-ups, TTS, search** — all app-level, and all need a text↔DOM mapping. [I]

**Realistic cost:** 3–6 engineer-weeks for a solid reflowable renderer with CFI and highlights, plus ongoing CSS/browser bug fixing; more if fixed-layout, vertical writing, MathML/SVG, or encryption matter. [I] That is not a good trade against vendoring a ~375 KB MIT library that already does it and is used by a mature reader.

**What we lose by going custom**

- **CFI interoperability** — we would have to implement the spec ourselves or invent a private anchor; either way, external annotations/Readium/Thorium cannot consume it.
- **Fixed-layout EPUB** — page spreads, scaling, comic/manga layouts; a separate renderer and navigation model.
- **Complex CSS** — floats, tables, multi-column authors' CSS, `@supports`, footnotes, drop caps, SVG, MathML. Every unsupported construct becomes a bug report.
- **Footnotes/pop-ups and landmarks** — no standard behaviour; we build it.
- **Accessibility** — reading order, alt text, table semantics, screen-reader navigation; easy to regress.
- **Ecosystem fixes** — font obfuscation, ZIP quirks, malformed OPF, WebKit/Chromium differences; all ours.
- **M4 features** — search/TTS need a text walker and mapping; foliate already has `text-walker.js`, `search.js`, `tts.js`.

**Verdict:** only if both foliate-js and `@likecoin/epub-ts` fail on a must-have requirement (e.g., a bespoke layout engine or a format they cannot parse). For PocketLibrary's M1/M4 scope they do not.

---

## 5. Annotations: CFI, its limits, and the durable anchor

### 5.1 What EPUB CFI is

EPUB Canonical Fragment Identifiers (IDPF Recommended Specification 1.1, 2017-01-05) define `epubcfi(...)` references into an EPUB: a path through the package/spine, then through the XHTML DOM, with character offsets and optional range endpoints. Example:

```
epubcfi(/6/2!/4/4[p1],/1:0,/1:80)
```

means: spine item 2, into its document, element 4 (with ID assertion `p1`), text offset 0 to 80. [V] ([CFI spec](https://idpf.org/epub/linking/cfi/epub-cfi.html))

CFI is **EPUB-only**. PDF has no CFI; PDF.js uses page numbers and destinations. [V] (PDF.js API uses `pageNumber`/`destArray`, no CFI)

### 5.2 The limitations that bite

1. **Structural, not content-addressed.** Steps are child indices and character offsets. Insert a node before the target, remove a wrapper around it, or change whitespace/character offsets, and the same CFI points at different text. [V] Spec §3.1/§3.5 describes the structure; local test demonstrates the break.
2. **The spec's correction mechanism is optional in practice.** CFI 1.1 defines ID assertions and text location assertions and says a reading system *should* verify them and derive a corrected CFI. [V] ([§3.5 Intended Target Location Correction](https://idpf.org/epub/linking/cfi/epub-cfi.html)) But:
   - epub.js's `EpubCFI` header explicitly lists **"Does Not Implement: … Text Location Assertion ([)"**. [V] ([src/epubcfi.js](https://github.com/futurepress/epub.js/blob/master/src/epubcfi.js))
   - foliate-js parses text/spatial/temporal assertions but says "there's no support for employing them when rendering yet." [V] (README)
   - Local test: after inserting one paragraph before the target, epub.ts `contents.range(cfi)` returned `null`; foliate-js threw `IndexSizeError`. [V-local]
3. **Simple ranges only.** CFI ranges are a parent path + start subpath + end subpath; the endpoints must be in document order and the same "nature". No discontiguous selection; ranges are a single start→end pair, and the engines in practice resolve them within one document. [V] ([§3.4 Simple Ranges](https://idpf.org/epub/linking/cfi/epub-cfi.html))
4. **Not human-readable and not sortable without stripping assertions.** [V] (Spec §3.1.2/§3.2)
5. **It is tied to the exact rendition.** Different sanitisation, injected footnote markers, or a different EPUB build can invalidate it even when the text is unchanged.

**Conclusion: a CFI is a good *fast path*, not a durable anchor.** Store it, but never trust it alone.

### 5.3 Recommended anchor: Readium `Locator` + W3C selectors

Use the **Readium Locator** shape as the internal, engine-neutral location object, because it already models exactly what we need and is used by Readium/Thorium:

```json
{
  "href": "OEBPS/chapter1.xhtml",
  "type": "application/xhtml+xml",
  "title": "Chapter One",
  "locations": {
    "fragments": ["epubcfi(/6/2!/4/4[p1],/1:0,/1:80)"],
    "progression": 0.042,
    "totalProgression": 0.021,
    "position": 3
  },
  "text": {
    "before": "It was a bright cold day in April, ",
    "highlight": "and the clocks were striking thirteen. Winston Smith",
    "after": ", his chin nuzzled into his breast"
  }
}
```

Readium defines `href`, `type`, `title`, `locations.fragments/progression/totalProgression/position`, and `text.before/highlight/after` exactly this way. [V] ([Locator model](https://readium.org/architecture/models/locators/), [Locator.ts](https://github.com/readium/ts-toolkit/blob/develop/shared/src/publication/Locator.ts))

Then attach W3C Web Annotation selectors for durability and export:

```json
{
  "selectors": [
    { "type": "FragmentSelector", "value": "epubcfi(/6/2!/4/4[p1],/1:0,/1:80)" },
    { "type": "TextQuoteSelector", "exact": "and the clocks were striking thirteen. Winston Smith",
      "prefix": "It was a bright cold day in April, ",
      "suffix": ", his chin nuzzled into his breast" },
    { "type": "TextPositionSelector", "start": 1234, "end": 1310 }
  ]
}
```

- `TextQuoteSelector` is the primary fallback: `exact` plus `prefix`/`suffix` context; the spec says to normalize text, and if multiple matches remain, treat all as matches (we will instead disambiguate by section + prompt if ambiguous). [V] ([W3C Annotation Model §4.2.4](https://www.w3.org/TR/annotation-model/#text-quote-selector))
- `TextPositionSelector` is a cheap secondary index, but the spec itself calls it "very brittle" to edits. [V] (§4.2.5)
- `RangeSelector` (`startSelector`/`endSelector`) is available for cross-node selections. [V] (§4.2.8)
- This is the Hypothesis selector model; Hypothesis uses quote + position + range selectors for robust anchoring. [V, secondary] ([Hypothesis selectors](https://web.hypothes.is/help/selectors/))

### 5.4 Resolution algorithm (self-healing)

On every render/restore:

1. If `locations.fragments[0]` is an EPUB CFI, resolve it defensively (catch exceptions; epub.ts can return `null`, foliate can throw). Compare the resolved range text to `text.highlight` (Unicode/whitespace-normalised). If it matches, draw and optionally write back the CFI.
2. If it does not match, search the **same section** for `prefix + exact + suffix`; if found uniquely, derive a new CFI/range, draw, and **write the corrected CFI back**.
3. If not found, search the **whole book** for the exact quote. If unique, accept; if multiple, show candidates; if none, mark the annotation `needs_review` and keep it in the DB.
4. Never delete an annotation just because its CFI failed. That is data loss.

This is exactly the "CFI + quoted text + surrounding context" approach the ticket asks for. It also gives us free re-import resilience: if the EPUB is re-downloaded with different metadata or an updated build, the quote path still finds the text.

### 5.5 Data shape for SQLite

Use one table; bookmarks are annotations with `kind='bookmark'` and no body.

```sql
CREATE TABLE annotations (
  id           TEXT PRIMARY KEY,
  book_id      TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('highlight','note','bookmark')),
  locator_json TEXT NOT NULL,   -- Locator + selectors, versioned
  color        TEXT,            -- token: yellow|green|blue|pink; theme maps to CSS
  note         TEXT,            -- plain text/Markdown, M4
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE INDEX annotations_book_live
  ON annotations(book_id) WHERE deleted_at IS NULL;

CREATE TABLE reading_positions (
  book_id      TEXT PRIMARY KEY,
  locator_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
```

Add `anchor_version` inside the JSON (`"v": 1`) and a `book_fingerprint` (SHA-256 of the EPUB/PDF bytes) at import. Same bytes ⇒ CFI fast path is safe; different bytes ⇒ quote fallback. For a work with multiple files/editions, relate files to a `work` and store the fingerprint per file, so annotations can be offered across editions. [I]

For PDF, use the same `Locator` with:

```json
{
  "href": "pdf",
  "type": "application/pdf",
  "locations": { "fragments": ["page=12"], "position": 12, "progression": 0.11, "totalProgression": 0.11 },
  "text": { "before": "...", "highlight": "...", "after": "..." },
  "rects": [{ "page": 12, "x": 0.12, "y": 0.34, "w": 0.40, "h": 0.03 }]
}
```

`rects` are **render cache, not the anchor**: normalized to page width/height so zoom is irrelevant. The anchor is page + quote; if the PDF is re-imported with shifted pages, quote search across the document is the fallback. [I, based on PDF.js coordinate model]

### 5.6 How highlights are drawn in each candidate

| Engine | API | Mechanism | Persistence |
|---|---|---|---|
| **foliate-js** | `view.addAnnotation({ value: cfi, color })` + `draw-annotation` event → `draw(Overlayer.highlight, { color })` | SVG overlay absolutely positioned over the iframe; `Overlayer.highlight/underline/squiggly/outline`; `hitTest` for taps; overlays are separate from the book DOM, so CFI-generating DOM is untouched | App DB; re-add per section on `create-overlay`/`load` |
| **@likecoin/epub-ts** | `rendition.annotations.highlight(cfiRange, data, cb, className, styles)` (also `underline`, `mark`, `remove`) | marks-pane SVG overlay in the parent; local test confirmed `<g data-epubcfi=...>`; annotations are re-injected by `rendition.hooks.render` | App DB; re-add on book open; library holds in-memory registry |
| **Readium** | `navigator.applyDecorations([{ id, locator, style }], 'user-highlights')` | Navigator-managed decorations, diffed and automatically re-applied on resource load; built-in Highlight/Underline/Strikethrough/Outline/Mask/Template styles | App DB; navigator keeps the declared state |
| **pdf.js** | Text layer + custom SVG/DOM overlay per page; `TextHighlighter` is for find matches, not durable annotations | `.textLayer` divs overlay the canvas; compute `Range.getClientRects()` and draw; page + normalized quads stored | App DB; redraw on page render/scroll; visible pages only |

---

## 6. pdf.js

### 6.1 Version and support

- **`pdfjs-dist@6.5.438`**, published 2026-11-01; Apache-2.0; actively maintained by Mozilla. [V] ([npm](https://registry.npmjs.org/pdfjs-dist), [releases](https://github.com/mozilla/pdf.js/releases))
- Two builds: modern (latest browsers) and **`legacy`** (transpiled/polyfilled; Chrome **125+**, Firefox ESR+). Android WebView on a current phone is Chromium 130+, so modern normally works; ship `legacy` if we want a wider WebView floor. [V] ([FAQ support](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support))
- Package contains `build/`, `legacy/build/`, `web/` (`pdf_viewer.mjs` + `pdf_viewer.css`), `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`. [V] (npm file listing, local install)

### 6.2 Integration in the same reader shell

Use the prebuilt viewer components rather than hand-rolling everything:

```js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { PDFViewer, EventBus, PDFLinkService, PDFFindController }
  from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;   // local asset, no CDN

const loadingTask = pdfjsLib.getDocument({
  data: bytes,                                        // Uint8Array from Tauri IPC
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
});
const pdf = await loadingTask.promise;

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({
  container, viewer: viewerDiv, eventBus, linkService,
  textLayerMode: 1,          // TextLayerMode.ENABLE: selection + search + highlight geometry
  annotationMode: 2,         // ENABLE_FORMS: render existing links/forms
  maxCanvasPixels: 4 * 1024 * 1024,  // cap mobile canvas memory (tune)
  enableDetailCanvas: true,  // crisp zoomed detail without a giant canvas
});
linkService.setViewer(viewer);
viewer.setDocument(pdf);
linkService.setDocument(pdf);
```

- `TextLayerBuilder` "creates overlay divs over the PDF's text. These divs contain text that matches the PDF text they are overlaying" — this is what makes selection and highlight geometry work. [V] ([text_layer_builder.js](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.js))
- `TextHighlighter` maps find matches to text-layer divs; use it for search highlights, not as the annotation store. [V] ([text_highlighter.js](https://github.com/mozilla/pdf.js/blob/master/web/text_highlighter.js))
- Page fit/zoom: `PDFViewer.currentScaleValue = 'page-width' | 'page-fit' | 'auto'` or a numeric scale; `currentScale`; `pagesRotation`. [V] ([pdf_viewer.js](https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js))
- Page-turn mode: `PDFSinglePageViewer` exists alongside `PDFViewer`; for a page-flip UX use that, or drive `currentPageNumber` and `scrollPageIntoView({ pageNumber, destArray })`. [V] (same source, class exports)
- Position persistence: listen for the **`pagechanging`** event (`{ pageNumber, pageLabel, previous }`), store `pageNumber` + a normalized intra-page scroll offset; restore with `currentPageNumber`/`scrollPageIntoView`. [V] (same source)
- TOC: `pdf.getOutline()`; outline items carry `dest`/`url`, resolve via `linkService`. [V] ([API docs](https://mozilla.github.io/pdf.js/api/))
- Existing PDF annotations: PDF.js renders them and can add a subset; the FAQ says it "supports rendering annotations for viewing, but also supports adding annotations using a subset". [V] ([FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-annotations)) We should **not** write our highlights into the PDF in M1/M4; store app-side and export separately. Scanned/image-only PDFs have no text layer, so selection/highlights are impossible without OCR; detect empty `getTextContent()` and hide highlight UI. [I]
- PDF theming: the page is a canvas, so light/sepia/dark is a CSS filter/overlay on the canvas (e.g. `filter: invert(1) hue-rotate(180deg)` for dark), plus adjusted text-layer selection colours. There is no reflow, font-size, or line-height control; the PDF controls are fit/zoom/rotate. [I]

### 6.3 Local worker test [V-local]

With `pdfjs-dist@6.5.438`, local `pdf.worker.mjs`, local `cmaps/`, `standard_fonts/`, `wasm/`, Chromium 156:

- `getDocument({ data/url })` → 3 pages.
- Page 1 rendered to an 892×1262 canvas at scale 1.5.
- `getTextContent()` returned 15 items (`"Table Of Content Chapter 1"`).
- Only a harmless "Cannot load system font: Courier" warning; no worker/CDN errors.

So the local-worker, no-CDN setup works in Chromium; the same asset layout should work under `http://tauri.localhost`. [V-local + I for Tauri]

### 6.4 Tauri/Android specifics

- **Custom protocol origin.** On Android (and Windows), Tauri serves the app from **`http://<scheme>.localhost`**, default `http://tauri.localhost`; `useHttpsScheme` can switch to `https://`. [V] ([config reference](https://v2.tauri.app/reference/config/), `useHttpsScheme` doc)
- **Worker.** Bundle `pdf.worker.mjs` as a local asset (`?url` in Vite, or copy to `public/`). Do not use a CDN worker: the API and worker versions must match exactly, or PDF.js throws a version-mismatch error. [V] ([webpack example](https://github.com/mozilla/pdf.js/tree/master/examples/webpack), FAQ)
- **CSP.** Needs `worker-src 'self'` (plus `blob:` if the bundler creates a blob worker), `img-src 'self' blob: data:`, `style-src 'self' 'unsafe-inline'` (text-layer positioning), and `'wasm-unsafe-eval'` if PDF.js uses WASM (default `useWasm: true`). [V] ([Tauri CSP docs](https://v2.tauri.app/security/csp/), PDF.js `DocumentInitParameters`)
- **Feeding bytes.** Prefer `getDocument({ data: uint8Array })` from Tauri IPC/SAF. `TypedArray` data is transferred to the worker, reducing main-thread memory; PDF.js takes ownership. [V] (API docs) This avoids `file://`, `content://`, and range-request complications on Android. For very large PDFs (> ~50 MB), consider a Rust range-transport later; M1 can open them, but memory spikes. [I]
- **Legacy build.** If the target WebView is older than the modern build's baseline, switch the two imports to `pdfjs-dist/legacy/...`; no other code changes. [V] (FAQ)

---

## 7. Android WebView performance and memory

### 7.1 What Android actually documents

- WebView is a full Chromium engine with a **multi-process** architecture: browser process in the app, renderer process for HTML/CSS/JS/layout. On Android 8+, apps normally get **one renderer for all WebViews**; low-RAM devices may fall back to one process. [V] ([WebView memory guide](https://developer.android.com/topic/performance/memory/guide/webview-memory))
- Most WebView memory is **native**, not Java heap: "native memory can silently grow to gigabytes" and is not capped by the app's `maxHeap`; the Low Memory Killer eventually kills the foreground app. DOM and JS live in the renderer. [V] ([Manage WebView memory](https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory))
- `WebViewClient.onRenderProcessGone()` is the platform callback for a renderer that crashed or was killed; if the app does not handle it, "application will crash if render process crashed, or be killed if render process was killed by the system." [V] ([WebViewClient](https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone(android.webkit.WebView,%20android.webkit.RenderProcessGoneDetail)))
- **Tauri's Android WebViewClient does not override `onRenderProcessGone`.** I grepped `wry` (`src/android`, `examples`) and found no reference. [V] (source inspection, 2026-11-24) So a renderer OOM is not surfaced to JS; the app may be killed. Mitigation: keep memory bounded, persist position frequently, and if this becomes common, patch `RustWebViewClient.kt` or add a plugin.
- **WebView version is whatever the device ships.** Tauri uses the system Android WebView and does not bundle one, so support is tied to the selected provider. [V] ([Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)) Feature-test (not OS-version-test) for the APIs the reader needs; target a modern Chromium (≥100, ideally current) and keep "open in another app" as the graceful fallback for ancient WebViews. [I]

### 7.2 Long EPUBs (1000+ pages)

- Both engines render **one spine section at a time** (default manager). 1000 pages across 50 chapters is fine; 1000 pages in **one giant XHTML file** is not — that is one enormous DOM and one very expensive multi-column layout. [I, from architecture; foliate README says multi-column is "slow, some CSS styles do not work as expected, and other bugs"]
- Progress:
  - foliate-js computes fraction from **section byte sizes** and never loads the book; 500-section test: open 109 ms, jump 41 ms. [V-local]
  - epub.ts `locations.generate` loads every section in the JS main thread; 500-section test: **8.3 s**, heap 2→10 MB. [V-local] Typical 30–80-section novels are much faster (their War and Peace claim is 159 ms), but the cost scales with spine items.
  - Raw epub.js: 500 sections **did not finish in 15 s** due the 100 ms/section pause. [V-local]
- Mitigations:
  - Generate/cache `Locator`/locations JSON once per book at import, in a worker/idle callback; persist it. Show provisional progress from `spineIndex / spineCount` until ready.
  - Use the **default/single-section** manager on Android, not continuous. epub.js's own README says continuous is "less performant". [V] ([README](https://github.com/futurepress/epub.js#render-methods))
  - Prefetch only next/prev section; keep at most 3 section iframes alive; destroy the old view/section (`section.unload()`).
  - Detect pathological sections: if a single XHTML is > ~1–2 MB or > ~10k element nodes, switch that book to scrolled mode or offer "open in another app"; do not attempt multi-column on it. [I]
  - Persist position on a 1–2 s debounce and on `pagehide`/`visibilitychange`, not on every scroll event. [I]
- Known layout bugs to test: font-size changes (epub.js #982 stale current location), column shifts (#1218), TOC jumps in continuous mode (#1131). foliate-js's paginator bisects visible ranges and anchors to a `Range` across resizes, which is more robust. [V] (README)

### 7.3 PDFs with many pages

- PDF.js FAQ: a US-Letter page at 96 DPI is 816×1056×4 ≈ **3.4 MB** per canvas; at 2× DPI ≈ **13.8 MB**. 100 canvases would be hundreds of MB. "Our recommendation is to create and render only visible pages." [V] ([FAQ: all pages](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#allthepages))
- PDF.js also says **page count does not affect performance**; page size/content and high-resolution images do. [V] ([FAQ: optimize](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#optimize))
- Mitigations:
  - `PDFViewer` default page buffer is `DEFAULT_CACHE_SIZE = 10`; lower to 3–5 on Android. [V] (source constant)
  - Cap `maxCanvasPixels` (default 32 MP) and `capCanvasAreaFactor` (default 200%); keep `enableDetailCanvas: true` for zoom. [V] (PDFViewer options)
  - Cancel offscreen render tasks and call `page.cleanup()` when evicting; `pdf.cleanup()` / `pdf.destroy()` on reader exit. [V] (API)
  - Prefetch the next page only at idle; never render all pages.
  - For scanned PDFs, images dominate memory; lower the render scale/DPR before raising the page buffer. [I]
  - For 1000+ page PDFs, keep only the current spread + 1–2 pages; a page-turn `PDFSinglePageViewer` is safer than a long vertical scroller. [I]

### 7.4 Caching/prefetch summary

| Data | Strategy |
|---|---|
| EPUB zip | Keep the `ArrayBuffer`/`File`; JSZip/zip.js parses lazily. A 1.7 MB book parses in ~8–12 ms, so no persistent extraction is needed for M1. [V-local/I] |
| EPUB locations | Generate once at import (background), persist JSON keyed by content hash; never regenerate on open. |
| EPUB sections | Prefetch next/prev; keep ≤3; `unload()` the rest. |
| EPUB cover | Decode once to a small WebP/PNG thumbnail; cache in app storage. [I] |
| PDF | `Uint8Array` to worker; 3–5 page canvases; page cleanup on eviction; next-page prefetch at idle. |
| Text index | Optional M4: per-section plain text + offsets in SQLite FTS5, built in Rust at import. [I] |
| Rendered DOM | Never cache; re-render from the engine on open. |

---

## 8. Recommendation

### 8.1 Primary / fallback

**Primary: foliate-js**, pinned to a commit, behind `EpubReaderEngine`:

- Best reading quality per line of integration: bisecting paginator, anchor survives resize, instant byte-based progress, built-in search/TTS, fixed-layout support, MIT.
- Small surface: vendor the repo (~375 KB); no build step; only vendored `zip.js`.
- Costs accepted: unstable API (pin + adapter + smoke tests), build our own chrome/TOC/themes, no continuous scroll, **strict CSP mandatory**.
- Security gate: a scripted EPUB must be tested on the target Android WebView with the production CSP before M1 ships. If it executes, stop and fix; do not ship.

**Fallback: `@likecoin/epub-ts@0.7.4`**, if:

- foliate-js's API churn or paginator bugs block M1; or
- we decide the security-by-default sandbox is worth more than foliate's pagination/progress; or
- we need the epub.js API/locations model for a specific feature.
- It is a drop-in for epub.js, typed, tested, active, and safe by default. Budget the 8 s/500-section locations generation by caching at import.

**PDF:** pdf.js 6.5.438, always.

**Not chosen:** raw epub.js (unmaintained, >15 s progress on 500 sections), Readium (manifest/positions pipeline), custom renderer (weeks; loses CFI/fixed layout/footnotes), EpubKit/lingo (not renderers).

### 8.2 What to vendor / pin

| Dependency | Pin | How |
|---|---|---|
| foliate-js | commit `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01) or newer reviewed SHA | git submodule/subtree; include `vendor/zip.js`, `vendor/fflate.js`; record SHA + local patches in `UPSTREAM.md` |
| pdfjs-dist | `6.5.438` exact | npm lockfile; copy `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` to `public/pdfjs/`; worker via `?url` |
| @likecoin/epub-ts (fallback) | `0.7.4` exact | npm lockfile; `jszip@3.10.1`; no CDN |
| Tauri CSP | production config | strict `script-src 'self'`; `worker-src 'self' blob:`; `'wasm-unsafe-eval'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`; `connect-src ipc: http://ipc.localhost` |

Do not depend on npm `foliate-js` (third-party publish) or a CDN worker.

### 8.3 What must be built in M1 so M4 is cheap

1. **`ReaderEngine` adapter** with `open`, `goTo(locator)`, `next/prev`, `setFlow`, `setTheme`, `setTypography`, `getLocator`, `getToc`, `getSelectionLocator`, `applyAnnotations`, `onRelocate`, `destroy`. Two implementations: foliate EPUB, pdf.js PDF.
2. **Locator schema + repository**, exactly as §5.3–5.5, including `selectors`, `book_fingerprint`, and `anchor_version`.
3. **Self-healing resolver** (§5.4) with unit tests for: valid CFI, stale CFI (inserted node), missing CFI, duplicate quote, re-imported same file, re-imported different build.
4. **`annotations` table + repository methods** (`create/list/update/softDelete`) and use it for **bookmarks in M1** (`kind='bookmark'`). Do not create a separate bookmark anchor type.
5. **Selection → Locator** implemented and tested in M1, even if the only UI is "Copy" or a debug action:
   - foliate: `view.getCFI(index, range)` + text quote from `range.toString()` and surrounding text;
   - epub.ts: `contents.cfiFromRange(range)` + quote;
   - pdf.js: page + normalized `getClientRects()` + quote.
6. **Apply-highlight path** implemented and tested in M1 (e.g., a hidden debug highlight), so M4 only adds UI/colors/notes:
   - foliate: `view.addAnnotation` + `draw-annotation` + `create-overlay` re-apply;
   - epub.ts: `rendition.annotations.highlight`;
   - pdf.js: overlay per visible page.
7. **PDF text layer enabled** (`textLayerMode: ENABLE`) and page+quote capture wired, even if no persistent PDF highlights in M1. Detect image-only PDFs.
8. **Progress/resume/bookmarks/tap zones/typography/themes/TOC** as the M1 feature set.
9. **Memory discipline**: single engine instance, destroy on exit, page/section caches capped, position persistence debounced, long-book guard.
10. **CSP + scripted-EPUB regression test** in CI/device smoke test.

M4 then adds: highlight UI and color picker, note editor, in-book search (foliate built-in or FTS5), TTS (foliate `tts.js`), and export (W3C Web Annotation JSON-LD). No schema migration, no reader rewrite.

### 8.4 M1 scope guardrails

- **In:** TOC, font size/line-height/margins, light/sepia/dark, paginated/scrolled, progress, resume, bookmarks, tap zones, PDF fit/zoom, PDF outline.
- **Out but wired:** highlight rendering, note field, search index, TTS, annotation export.
- **Never in M1:** continuous infinite scroll for EPUB, custom pagination engine, PDF annotation writing, full-book text extraction on the UI thread.

---

## 9. Risks and open questions

1. **foliate-js API churn** — pin a SHA, wrap it, keep a smoke-test fixture, and treat upgrades as deliberate. Mitigation cost is low; the fallback is `@likecoin/epub-ts`. [V]/[I]
2. **foliate-js security** — without strict CSP, a malicious EPUB can write to the parent. This is a release blocker; test with the scripted EPUB on the target WebView. `@likecoin/epub-ts` is safer by default if this cannot be guaranteed. [V-local]/[V]
3. **Android WebView OOM** — one renderer for all WebViews, native memory can reach GB, and wry has no `onRenderProcessGone` handler. Cap caches, persist often, and consider a native patch if it happens in practice. [V]
4. **Pathological EPUBs** — one giant XHTML file defeats both engines' section-at-a-time strategy. Detect and degrade to scrolled/external. [I]
5. **PDF memory** — canvas cost is per page and per DPI; cap `maxCanvasPixels`, buffer, and DPR. [V]
6. **CFI re-import** — quote fallback is good but not magic; ambiguous quotes need UI. Plan for a "needs review" state, never silent deletion. [I]
7. **foliate-js no continuous scroll** — acceptable for M1 ("page-turn or scroll mode"), but if the UX requires chapter-to-chapter continuous scroll, that is a custom feature on top of the per-section scroller. [V]

---

## 10. Sources (accessed 2026-11-24 unless dated)

**epub.js / forks**

- epub.js releases (v0.3.88, 2020-07-01): <https://github.com/futurepress/epub.js/releases>
- epub.js npm metadata (0.3.93, 2022-02-16; 0.5 alpha 2023): <https://registry.npmjs.org/epubjs>
- epub.js commits / master fixes: <https://github.com/futurepress/epub.js/commits/master>
- "Is this project abandoned?" #1406: <https://github.com/futurepress/epub.js/issues/1406>
- epub.js CFI limitations (source header): <https://github.com/futurepress/epub.js/blob/master/src/epubcfi.js>
- epub.js locations pause: <https://github.com/futurepress/epub.js/blob/master/src/locations.js>
- epub.js annotations API: <https://github.com/futurepress/epub.js/blob/master/src/annotations.js>
- epub.js API docs: <https://github.com/futurepress/epub.js/blob/master/documentation/md/API.md>
- Known bugs: [#982](https://github.com/futurepress/epub.js/issues/982), [#1218](https://github.com/futurepress/epub.js/issues/1218), [#1131](https://github.com/futurepress/epub.js/issues/1131), [#1295](https://github.com/futurepress/epub.js/issues/1295), [#1343](https://github.com/futurepress/epub.js/issues/1343), [#744](https://github.com/futurepress/epub.js/issues/744)
- @likecoin/epub-ts npm: <https://registry.npmjs.org/@likecoin%2fepub-ts>; repo: <https://github.com/likecoin/epub.ts>; changelog: <https://github.com/likecoin/epub.ts/blob/master/CHANGELOG.md>
- @intity/epub-js npm: <https://registry.npmjs.org/@intity%2fepub-js>; repo: <https://github.com/intity/epub-js>

**foliate-js**

- Repo: <https://github.com/johnfactotum/foliate-js>
- README (features, status, security, CFI, overlayer, search, TTS): <https://github.com/johnfactotum/foliate-js/blob/main/README.md>
- Licence: <https://github.com/johnfactotum/foliate-js/blob/main/LICENSE>
- Paginator source (sandbox, setStyles, touch, render): <https://github.com/johnfactotum/foliate-js/blob/main/paginator.js>
- View source (getCFI, resolveCFI, addAnnotation, search): <https://github.com/johnfactotum/foliate-js/blob/main/view.js>
- Overlayer source: <https://github.com/johnfactotum/foliate-js/blob/main/overlayer.js>
- Progress source (byte-size progress): <https://github.com/johnfactotum/foliate-js/blob/main/progress.js>
- npm `foliate-js` third-party publish: <https://registry.npmjs.org/foliate-js>

**Readium / other engines**

- @readium/navigator npm: <https://registry.npmjs.org/@readium%2fnavigator>; repo: <https://github.com/readium/ts-toolkit>
- Handling publications (manifest + positions): <https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/HandlingPublications.md>
- EpubNavigator: <https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/epub/EpubNavigator.md>
- Decorations: <https://github.com/readium/ts-toolkit/blob/develop/navigator/docs/epub/Decorations.md>
- Decorator API RFC: <https://readium.org/architecture/proposals/008-decorator-api.html>
- Locator model: <https://readium.org/architecture/models/locators/>; Locator.ts: <https://github.com/readium/ts-toolkit/blob/develop/shared/src/publication/Locator.ts>
- Readium CSS: <https://github.com/readium/readium-css>
- readium-js archived: <https://github.com/readium/readium-js>
- @lingo-reader/epub-parser: <https://www.npmjs.com/package/@lingo-reader/epub-parser>; repo: <https://github.com/hhk-png/lingo-reader>
- EPUBKit Swift: <https://github.com/witekbobrowski/EPUBKit>

**CFI / annotations**

- EPUB CFI 1.1: <https://idpf.org/epub/linking/cfi/epub-cfi.html> (§3.4 simple ranges, §3.5 target correction)
- W3C Web Annotation Data Model: <https://www.w3.org/TR/annotation-model/> (§4.2.4 Text Quote, §4.2.5 Text Position, §4.2.8 Range)
- Hypothesis selectors (secondary): <https://web.hypothes.is/help/selectors/>

**pdf.js**

- npm: <https://registry.npmjs.org/pdfjs-dist>; releases: <https://github.com/mozilla/pdf.js/releases>
- FAQ support (modern vs legacy, Chrome 125+): <https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support>
- FAQ canvas memory: <https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#allthepages>
- FAQ PDF annotations: <https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-annotations>
- Document init parameters: <https://github.com/mozilla/pdf.js/blob/master/src/display/api.js>
- PDFViewer source (currentPageNumber, pagechanging, scrollPageIntoView, maxCanvasPixels): <https://github.com/mozilla/pdf.js/blob/master/web/pdf_viewer.js>
- Text layer: <https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.js>
- Text highlighter: <https://github.com/mozilla/pdf.js/blob/master/web/text_highlighter.js>
- Webpack/worker example: <https://github.com/mozilla/pdf.js/tree/master/examples/webpack>

**Android / Tauri**

- Android WebView memory guide: <https://developer.android.com/topic/performance/memory/guide/webview-memory>
- Manage WebView memory: <https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory>
- WebViewClient `onRenderProcessGone`: <https://developer.android.com/reference/android/webkit/WebViewClient#onRenderProcessGone(android.webkit.WebView,%20android.webkit.RenderProcessGoneDetail)>
- Tauri webview versions (system Android WebView, updatable): <https://v2.tauri.app/reference/webview-versions/>
- Tauri config (`useHttpsScheme`, `http://<scheme>.localhost`): <https://v2.tauri.app/reference/config/>
- Tauri CSP: <https://v2.tauri.app/security/csp/>
- wry Android source (no `onRenderProcessGone`): <https://github.com/tauri-apps/wry/tree/dev/src/android>

**Local test artefacts** (not committed; reproduced in `/tmp/opencode/reader-test` on 2026-11-24)

- `epubjs@0.3.93`, `@likecoin/epub-ts@0.7.4`, `foliate-js@main` (commit 78914ae), `pdfjs-dist@6.5.438`.
- Headless Chromium 156.0.7569.0; phone viewport 390×844, DPR 3, touch.
- Fixtures: 2-chapter EPUB, 500-chapter EPUB, scripted EPUB, 3-page PDF.
- Results table is in §2.5, §3.4, §6.3, §7.2.

---

## 11. Resolution comment (≈10 lines)

**Recommendation:** use **foliate-js** (pinned commit, vendored, MIT) as the EPUB engine, wrapped in a `ReaderEngine` adapter; use **pdfjs-dist 6.5.438** for PDF with a local worker and text layer. Fall back to **`@likecoin/epub-ts@0.7.4`** — not raw epub.js — if foliate's unstable API or CSP work blocks M1. Raw epub.js is unmaintained (no GitHub release since 2020; 519 issues) and its `locations.generate` took >15 s on a 500-section book; foliate's byte-size progress was instant.

**Annotations:** never store a bare CFI. Store a Readium-shaped `Locator` (`href`, `locations.fragments` = CFI or `page=N`, `progression`, `position`, `text.before/highlight/after`) plus W3C selectors (Fragment + TextQuote + TextPosition). Resolve CFI → validate quote → section quote search → whole-book quote search; write corrected CFIs back. Local test confirmed a one-node insertion breaks both engines' CFI resolution (epub.ts returns null; foliate throws), so the quote fallback is mandatory.

**M1:** TOC, typography, themes, page/scroll, progress, resume, bookmarks, tap zones, PDF fit/zoom/outline; create the `annotations` table now (bookmarks are `kind='bookmark'`), and implement selection→Locator + apply-highlight internally even if the UI is hidden. Enable the PDF text layer. **Strict Tauri CSP (`script-src 'self'`, no CDN) is a release blocker:** without it, a scripted EPUB ran in foliate's iframe and wrote to the parent document. With it, scripts were blocked. M4 (highlights, notes, search, TTS, export) then needs UI only — no schema or reader rewrite.
