# bookcover-js — deep source audit (spine-only output)

**Date:** 2026-11-26
**Subject:** <https://github.com/acestronautical/bookcover-js> / <https://acestronautical.github.io/bookcover-js/>
**Audited revision:** `7a99ad9a05960de2262453b45eba757846b4228a` (2024-08-14, "tweak spine placement"), branch `main`, clone in `/tmp/bookcover-js`.
**Method:** read all 1,133 lines of JS + 262 lines of HTML; ran the real app in Chromium via Playwright and exercised `#saveSpineSVG` / `#saveSpinePNG` directly; verified exported files pixel-by-pixel.

**Verdict (corrected):** The earlier conclusion was **wrong on the key point**. bookcover-js *does* have first-class **spine-only SVG and PNG export** — a dedicated `#spine-cover` panel, a "Save Spine" pair of buttons, and `saveSpine()` dispatch. It is a genuine **2D spine panel generator** (metadata + typography + optional ornament → standalone spine strip), not merely a cut-panel/wrap generator. It **is** usable as a 2D spine generator today, with configuration. It is **not** usable as a *cover-derived* spine (no page count → thickness, no real front-cover consumption, no continuous wrap), and a raster background needs either an SVG wrapper (works, but tiles) or a ~15-line patch for full-bleed. Details and exact patch points below.

---

## 0. What the previous test got right and wrong

| Claim from the earlier test | Status |
|---|---|
| "Only a 2D clothbound cut-panel generator" | **Wrong / too broad.** There are four independent save targets (front, spine, back, combined), each in SVG and PNG. The spine is a first-class output. |
| "It cannot output just the spine" | **Wrong.** See `index.html:44-53`, `main.js:252-253`, `main.js:261-262`, `penguinstyle.js:153`. |
| "Spine width is manual, no page count" | **Right.** `index.html:159-161`, `main.js:135-144`; no page/paper/PPI logic anywhere (grep confirms). |
| "Only single-colour SVG line art is accepted" | **Mostly right for the UI**, but a raster wrapped in an SVG `<image>` survives and exports — see §5. |
| "Text clips at 1 in with default 18 px font" | **Right for stacked styles 1/5** (measured `Whisper` = 76.26 px in a 54 px strip). **Wrong for rotated styles 2/3**, which fit vertically and are the normal spine treatment. |
| "Combined export is not a continuous wrap" | **Right.** `penguinstyle.js:154-162`, `svghelper.js:115-134`. |
| "No npm package / no library API / unmaintained" | **Right.** See §7. |

---

## 1. Source map

| File | Lines | Role |
|---|---:|---|
| `index.html` | 262 | UI, four save-button pairs, settings form |
| `js/main.js` | 355 | DOM wiring, event handling, save dispatch, font upload |
| `js/penguinstyle.js` | 579 | `PenguinCover` model: geometry, frame, spine, tesselation, save methods |
| `js/svghelper.js` | 199 | SVG create/parse/serialize, text centering, combine, PNG rasterization |
| `styles.css` | 245 | `.cover` flex centering; `#coverSection` preview scale only |

No dependencies, no build step, no `package.json`, no tests.

---

## 2. Every output mode and export path

### 2.1 UI

| Output | Buttons (HTML) | Click handler (JS) | Save method |
|---|---|---|---|
| Front | `#saveFrontSVG` / `#saveFrontPNG` — `index.html:58-61` | `main.js:254-255`, `263-265` | `saveFront()` `penguinstyle.js:151` |
| **Spine** | **`#saveSpineSVG` / `#saveSpinePNG` — `index.html:48-51`** | **`main.js:252-253`, `261-262`** | **`saveSpine()` `penguinstyle.js:153`** |
| Back / endpaper | `#saveBackSVG` / `#saveBackPNG` — `index.html:38-41` | `main.js:247-251`, `256-260` | `saveBack()` `penguinstyle.js:152` |
| Combined | `#saveCombinedSVG` / `#saveCombinedPNG` — `index.html:25-28` | `main.js:266-270` | `saveCombined()` `penguinstyle.js:154-162` |

### 2.2 Format dispatch

`save(filename, svgElem, padX, padY)` — `penguinstyle.js:135-150`:

```js
if (filename.endsWith('.svg'))      SVGHelper.saveAsSvg(...)   // svghelper.js:153
else if (filename.endsWith('.png')) SVGHelper.saveAsPng(...)   // svghelper.js:162
else console.error('Unsupported file type. Please use .svg or .png extension.');
```

- **No PDF export.** No PDF code path, no PDF.js, nothing.
- PNG is always **10×** (`scaleFactor = 10`, `penguinstyle.js:137`).
- Combined is only an SVG/PNG concatenation, not a print wrap.

### 2.3 Spine save call and its padding

`penguinstyle.js:153`:

```js
saveSpine(filename) { this.save(filename, this.spine.svgElem, this.borderGap / 2, this.borderGap); }
```

This padding matters and is **not** a bug: see §4.

---

## 3. Exact spine geometry

### 3.1 Model constants

`penguinstyle.js:17-30`:

| Field | Default | Meaning |
|---|---|---|
| `inchToPx` | `72` | 72 px/in (Illustrator convention) |
| `mmToPx` | `2.8346` | mm→px |
| `outerWidth` | `396` | 5.5 in cover panel |
| `outerHeight` | `648` | 9 in |
| `borderGap` | `18` | 0.25 in inset |
| `shoulderGap` | `18` | used only by combined |
| `borderThickness` | `3.6` | 0.05 in decorative stroke |
| `saveTransparent` | `true` | PNG background |

### 3.2 Spine object

`penguinstyle.js:112-133`:

```js
spine.outerWidth = 108                             // 1.5 in default (:121)
spine.outerWidthInches / Milli   (:122-125)
spine.outerHeight  = book.outerHeight              // (:126)
spine.innerWidth   = this.outerWidth - borderGap   // (:129)  <-- ONE gap, not two
spine.innerHeight  = book.innerHeight              // outerHeight - 2*borderGap (:128, :56)
spine.paddingX     = (outerWidth - innerWidth)/2   // = borderGap/2 (:130)
spine.paddingY     = (outerHeight - innerHeight)/2 // = borderGap   (:131)
```

So for a **1.0 in spine** at 72 px/in and default gap 0.25 in:

| Quantity | Value |
|---|---|
| `spine.outerWidth` | 72 px (1.00 in) |
| `spine.innerWidth` | **54 px (0.75 in)** |
| `spine.innerHeight` | 612 px (8.5 in at 9 in trim) |
| Spine SVG element | **54 × 612**, `width`/`height` attrs, **no `viewBox`** |
| Spine PNG (default) | **720 × 6480** = exactly 1.00 × 9.00 in at 10× |

### 3.3 Where the frame is built

`genCoverFrame('spine')` — `penguinstyle.js:210-261`:

```js
svg = SVGHelper.create('svg', { width: innerWidth, height: innerHeight, overflow: 'hidden' })  // :219-223
```

- Note the `if (side == 'front')` block (:229-259) — **spine frames contain no text there**; spine text is added by `genSpine()`.
- No `viewBox` is ever set. The exported SVG therefore has no scalable coordinate system; it is an absolute-pixel document.
- `overflow="hidden"` means the outer border stroke is clipped in half: the rect is at `x=0,y=0,w=innerWidth` with `stroke-width = borderThickness*2` (`genBorderRectangle`, `penguinstyle.js:265-287`), so 3.6 px of a 7.2 px stroke falls outside the canvas.

### 3.4 Border / bleed / crop

`genBorderRectangle` (`penguinstyle.js:265-287`) draws:

- outer rect: `stroke-width = borderThickness*2`, at `0,0`, `innerWidth × innerHeight` (:269-274)
- inner rect: `stroke-width = borderThickness/10`, inset by `borderThickness` (:276-283)

There is **no bleed, trim box, crop marks, or margin model**. "Bleed" is simply `borderGap`, a single inset applied to the artwork area. Issue #2 ("saved SVG should crop along border") is still **open** — the app expects manual cropping, as the button tooltips say (`index.html:49`).

### 3.5 Spine width from page count

**Does not exist.** Confirmed by grep over all JS/HTML for `page|thick|ppi|paper|isbn|bleed|trim` — the only hits are `borderThickness` and the word "PDFDocument" in a font-name regex. The sole width input is:

```html
<input type="number" id="spineWidthInput" min="1" max="150" step="0.1">
```
(`index.html:157-161`), wired at `main.js:135-144` to `spine.outerWidthInches|Milli`. You must compute thickness yourself and type it in.

---

## 4. Export geometry, precisely

### 4.1 SVG (`svghelper.js:153-160`)

- Serializes `spine.svgElem` directly.
- Output for a 1 in spine with default gap: **`width="54" height="612"`**, no `viewBox`, no units.
- Appends a `<style>` block (`embedFonts`, `svghelper.js:147-151`). **Bug:** with no uploaded font, it emits
  `@font-face { font-family: ''Adobe Garamond Pro', ... serif'; src: url('undefined'); }`
  (the whole font stack is quoted as one family, and `fontData` is `undefined`). Harmless in most renderers, but it is malformed CSS in every SVG export.
- Padding arguments (`padX`, `padY`) are **ignored** for SVG. So the SVG is the *inner* strip only (0.75 in of art at default settings), not the nominal 1 in.

### 4.2 PNG (`svghelper.js:162-198`)

```js
paddingX = paddingX * scaleFactor;            // :168
paddingY = paddingY * scaleFactor;            // :169
canvas.width  = img.width  * 10 + 2*paddingX; // :176
canvas.height = img.height * 10 + 2*paddingY; // :177
```

For `saveSpine`, `padX = borderGap/2 = 9`, `padY = borderGap = 18`:

```
width  = 54*10 + 2*90  = 720   -> 1.00 in @10x
height = 612*10 + 2*180 = 6480 -> 9.00 in @10x
```

So the **PNG is exactly the nominal spine size** (1.00 × 9.00 in) at 10×; the art is inset by 0.25 in and the gap is restored as transparent (or background-coloured) padding. This is the opposite of what the earlier report implied — the PNG does **not** lose the spine width.

- PNG has **no `pHYs` chunk / DPI metadata** (verified chunk list: only `IHDR`, `IDAT…`, `IEND`). Physical size is convention only ("divide by ten" per README).
- Default background is transparent (`saveTransparent = true`, `penguinstyle.js:30`); unchecking "Save Transparent" fills `backgroundColor` (`penguinstyle.js:136`, `svghelper.js:179-184`).
- Rasterization is `img.src = data:image/svg+xml;base64,…` → canvas (`svghelper.js:197`), so embedded raster data URIs render and do **not** taint the canvas.

### 4.3 Zero-config clean strip (no frame)

Setting **Border Gap = 0** and **Border Thickness = 0** in the UI yields a clean, full-bleed strip with no code changes:

- SVG: **72 × 612** (exactly 1 in × 8.5 in), only two invisible zero-stroke rects remain.
- PNG: **720 × 6120** (1 in × 8.5 in at 10×), no gutters.
- Verified in `out3/clean-spine.svg` / `clean-spine.png`.

This is the simplest existing path to "just the spine, no Penguin frame".

---

## 5. Raster cover input

### 5.1 What the UI accepts

```html
<input type="file" id="fileInput" accept=".svg">   <!-- index.html:254 -->
```

Handler (`main.js:297-312`) does `reader.readAsText(file)` → `SVGHelper.fromString` → push `{svg}`. There is **no JPEG/PNG path, no `readAsDataURL`**, and no concept of "this is the front cover".

`SVGHelper.color()` (`svghelper.js:72-79`) then walks *all* descendants and sets `fill`/`stroke`, removing `style`. For an `<image>` element, `fill`/`stroke` are ignored — **so an embedded raster survives**.

### 5.2 Raster-in-SVG works today (verified)

I uploaded:

```svg
<svg xmlns=... viewBox="0 0 400 600">
  <image width="400" height="600" href="data:image/jpeg;base64,…"/>
</svg>
```

Result in the real app: the raster is **accepted, rendered, and exported** in both SVG (base64 preserved) and PNG (canvas). But `genSpine()` treats every uploaded image as an ornament (`penguinstyle.js:366-426`, art-style table `:373-388`), so it is **scaled down and tiled/repeated** at the top/bottom of the spine — not used as a cover crop. See `out2/spine-raster-tiled.png`.

### 5.3 Full-bleed raster needs a small patch

The minimal patch is a background slot in `genSpine()` before the text/frame ordering, e.g. insert as the **first child** of `this.spine.svgElem`:

```js
const bg = SVGHelper.create('image', {
  href: this.spine.background,          // data: URL
  x: 0, y: 0,
  width:  this.spine.innerWidth,
  height: this.spine.innerHeight,
  preserveAspectRatio: 'xMinYMid slice', // keeps the fold-side edge of the cover
});
this.spine.svgElem.insertBefore(bg, this.spine.svgElem.firstChild);
```

plus `accept=".svg,.jpg,.jpeg,.png,.webp"` and a `readAsDataURL` branch in `main.js:297`. I prototyped exactly this and exported **`spine-raster-patched.png` (720 × 6480, 3.5 MB)** — the real Whisper Man cover fills the strip, text and border sit on top, and the export is correct. See `out2/thumb-patched.png` vs `out2/thumb-tiled.png`.

Note: a parallel harness at `./harness/` in this directory already contains a similar patch (background + scrim + raster accept). It is **not required** by this audit; the above is independently derived from upstream.

### 5.4 Sub-pixel / colour caveat for raster

`SVGHelper.color()` will set `fill`/`stroke` on raster wrapper elements but cannot recolour the bitmap, so the photo keeps its colour. If you want a duotone/knockout treatment you must filter the bitmap yourself. No blend modes, no contrast/scrim controls upstream.

---

## 6. Typography placement and fitting

### 6.1 Text pipeline

`genSpine()` — `penguinstyle.js:289-363`:

| Style | Code | Behaviour |
|---|---|---|
| 1 "both centered" | `:301-318` | splits title **and author on whitespace**, one word per line (`:305,307`), vertically centred |
| 5 "centered preserve format" | `:301-318` | same but keeps user newlines |
| 2 "both rotated" | `:319-335` | two `<text>` elements rotated 90°, title/author side by side |
| 3 "title rotated" | `:336-346` | one rotated `<text>`, `letter-spacing: 2`, **author omitted** |
| 4 "author top" | `:347-363` | style 3 title + author block at `innerHeight/12`, font size heuristic `4*innerWidth/(log2(longest)*longest-1)` |

`createCenteredText()` (`svghelper.js:81-113`):

```js
padding = size / 6;                                  // :84
lineY   = y + index * (size + padding);              // :98
lineX   = (parentWidth - textWidth) / 2;             // :97  (uses getBBox)
height  = lineY - y;                                 // :104
if (reposition) y -= height / 2;                    // :106-111
```

- **Width is measured** (`getBBox`) but only used to centre horizontally.
- **No shrink-to-fit, no wrap, no ellipsis, no warning.** Font size is a fixed input (`index.html:83-86` → `main.js:148-149`).
- Vertical centring is approximate: `height` is the *baseline delta of the last line*, not the visual bbox, so multi-line blocks drift by roughly one line-height.
- Rotated styles use a fixed `x = xCenter ± fontSize/2` (`:322,331`) — no metric fitting at all.

### 6.2 Measured at 1.0 in spine (54 px inner), 18 px font, style 1

| Line | Width (px) | x | Clipped? |
|---|---:|---:|---|
| The | 34.27 | 9.87 | no |
| **Whisper** | **76.26** | **−11.13** | **yes** |
| Man | 41.16 | 6.42 | no |
| Alex | 40.56 | 5.72 | no |
| **North** | **54.42** | **−0.21** | touches edge |

Measured minimum fit size for "Whisper" in 54 px: **≈ 12.75 px**. At 12 px it is 50.84 px and fits. So auto-fit is entirely feasible with the existing `getBBox` machinery, but is not implemented.

**Important correction:** styles 2/3 (rotated) do **not** have this problem — the constraint becomes the 612 px height, and a 493 px title fits easily at 1 in. The earlier "clips at normal widths" finding is specific to the stacked styles.

Also relevant: open issue #15 — Silhouette Studio ignores `text-anchor: middle`, so rotated spines (`text-anchor: middle`) can misplace on that RIP. The author's own suggested fix (measure and set `x` instead) is not implemented.

### 6.3 Fonts

Default is a Garamond stack (`penguinstyle.js:13`). Custom `.ttf/.otf` upload is beta (`index.html:119-122`, `main.js:314-342`); the family name is derived from the filename and the font is embedded as a data URL in the SVG (`svghelper.js:147-151`). Works, but see the malformed-`@font-face` bug in §4.1.

---

## 7. Reuse, packaging, licence, maintenance

### 7.1 As a library

| Aspect | Finding |
|---|---|
| Module exports | `PenguinCover`, `DefaultSvgText`, `DefaultFontFamilies` (`penguinstyle.js:5,13,16`). Importing the module in Node **works** (no top-level side effects). |
| Instantiation | **Fails outside a browser.** `new PenguinCover()` throws `DOMParser is not defined`; after polyfilling that, the object field initializers call `document.getElementById('front-cover'/'back-cover'/'spine-cover')` (`penguinstyle.js:82,99,119`). |
| Rendering | `genCoverFrame` uses `document.createElementNS`; `sizeImage`/`createCenteredText`/`rotate`/`mirror` all call `getBBox()` (`svghelper.js:40-45,50,61,94`), which needs real layout. jsdom/happy-dom will not do. |
| Practical reuse | (a) drive the app in **Playwright/Chromium** (what this audit did); (b) **fork/copy** ~780 lines and de-DOM them; (c) load it in a page via a CDN (`cdn.jsdelivr.net/gh/acestronautical/bookcover-js@main/js/penguinstyle.js`) — browser-only, relative import resolves. |
| Package | **No npm package** (`registry.npmjs.org/bookcover-js` → 404), no `package.json`, no releases/tags, no tests. |
| Coupling | `PenguinCover` is a singleton-ish model wired to fixed DOM ids; the UI (`main.js`) owns all state mutation. There is no headless `render(spineSpec) → svg` API. |

**Conclusion:** usable as an app/harness or as a fork, not as a drop-in dependency. For PocketLibrary, the pragmatic options are (1) run it headless in Playwright and scrape the exported spine, or (2) vendor `penguinstyle.js`/`svghelper.js` and refactor the geometry into a pure function.

### 7.2 Licence

**MPL-2.0** (`LICENSE`, README "License"). File-level copyleft: you may combine the MPL files with proprietary code and distribute the larger work under other terms, **but modifications to the MPL-covered files must remain MPL and be made available**. If PocketLibrary vendors and patches `penguinstyle.js`, that patched file must be published under MPL-2.0. Calling it out-of-process (Playwright) avoids the obligation for your own code.

### 7.3 Maintenance

- Last code push **2024-08-14** (`7a99ad9`); repo metadata "updated" 2026-09 is a star/watch event, not a commit.
- 30 stars, 4 forks, 6 open issues, 0 releases, 0 tags.
- Open issues relevant here: **#2** (crop along border — confirms no crop model), **#15** (`text-anchor` on Silhouette), **#16** (iPad canvas > 16 MP — the 10× PNG can exceed mobile canvas limits), **#17** (even/odd scaling, no maintainer reply), **#6** (custom fonts), **#11** (fill images).
- Effectively **feature-frozen / low maintenance**, but the source is small and stable enough to fork confidently.

---

## 8. What is reusable and what must be patched

| Capability | Upstream status | Patch effort |
|---|---|---|
| **Spine-only SVG** | ✅ native (`saveSpineSVG`) | none |
| **Spine-only PNG at nominal size** | ✅ native (`saveSpinePNG`, 10×, transparent) | none |
| **Clean strip without Penguin frame** | ✅ via Border Gap = 0, Thickness = 0 | none (settings) |
| **Spine width from page count** | ❌ manual only | ~5 lines: add `pages`, `ppi`, derive `spine.outerWidth = pages/ppi * 72`; wire one input |
| **Full-bleed raster background** | ❌ tiles as ornament | ~15 lines: background slot + `readAsDataURL` + `accept` |
| **Raster colour treatment** | ❌ no filters | you own it (pre-process the bitmap) |
| **Auto-fit / shrink text** | ❌ fixed size | ~15 lines loop on `getBBox().width` (and height for rotated) |
| **Reliable vertical centring** | ⚠️ approximate | use full text bbox instead of baseline delta |
| **`viewBox` / physical units in SVG** | ❌ none | 2 lines; needed for sane scaling in Illustrator/Figma |
| **PNG DPI metadata** | ❌ no `pHYs` | 1 line in canvas encoder or post-process |
| **Correct `@font-face` in SVG** | ⚠️ malformed when no custom font | guard `if (fontData)` |
| **Continuous wrap / bleed** | ❌ inner panels + 45 px gaps | do not use `saveCombined`; compose your own |
| **PDF** | ❌ | n/a |
| **Headless API** | ❌ DOM-bound | Playwright, or de-DOM the model |

---

## 9. Bottom line

1. **The user is right.** bookcover-js has explicit **spine-only SVG and PNG** export. The earlier "cut-panel generator, not usable" verdict was based on the *spine-from-cover* requirement and under-reported the dedicated spine output.
2. **As a 2D spine generator it works.** With `Border Gap = 0` / `Border Thickness = 0` it emits a clean 72 × 612 px SVG (1 × 8.5 in) or a 720 × 6120 px PNG at 10×, containing just the spine. With default settings the PNG is exactly the nominal spine size; the SVG is the 0.75 in inner strip and needs a `viewBox`/outer margin if you want the full width vector.
3. **What it cannot do:** derive thickness from page count, consume a real front cover as a cover (only as a tiled ornament), auto-fit text, produce a print wrap, or emit PDF.
4. **Smallest viable path for PocketLibrary:** use the app as-is for typographic spines with rotated text and zero border, or vendor the model and patch in (a) page-count width, (b) a full-bleed `<image>` background, (c) shrink-to-fit, (d) `viewBox`. Total ~40 lines across `penguinstyle.js`/`svghelper.js`/`main.js`.
5. **Licence/ops:** MPL-2.0 — patched MPL files must stay MPL. No npm package, no API, last commit Aug 2024. Treat it as a fork, not a dependency.

---

## Appendix A — artefacts produced by this audit

All under `/tmp/bookcover-js/` (source) and `/tmp/bcjs-audit/` (outputs), outside the repo:

| File | What it proves |
|---|---|
| `out/spine.svg` | spine-only SVG = `width="54" height="612"`, no viewBox |
| `out/spine.png` | spine-only PNG = `720 × 6480` (nominal 1 × 9 in @10×) |
| `out/combined.svg` | combined = 864 × 612 with 45 px gaps, inner panels only |
| `out2/spine-raster-tiled.png` | raster-in-SVG upload → tiled ornament |
| `out2/spine-raster-patched.png` | full-bleed raster after ~15-line patch, exported correctly |
| `out2/thumb-patched.png` / `thumb-tiled.png` | visual comparison |
| `out3/clean-spine.svg` / `.png` | zero-gap/zero-border clean strip, 72 × 612 / 720 × 6120 |

Harness scripts: `exercise.cjs`, `raster.cjs`, `clean.cjs` (Playwright, Chromium 1.65.1).

## Appendix B — key line references

| Concern | Location |
|---|---|
| Spine save button pair | `index.html:44-53` |
| Spine save dispatch | `main.js:252-253`, `main.js:261-262` |
| `saveSpine` padding | `penguinstyle.js:153` |
| Format dispatch / no PDF | `penguinstyle.js:135-150` |
| Spine width / inner width | `penguinstyle.js:121-131` |
| Spine SVG creation, no viewBox | `penguinstyle.js:219-223` |
| Border rects | `penguinstyle.js:265-287` |
| `genSpine` text + art | `penguinstyle.js:289-427` |
| Art style table | `penguinstyle.js:373-388` |
| Text centring / no fit | `svghelper.js:81-113` |
| SVG export | `svghelper.js:153-160` |
| PNG rasterization / 10× | `svghelper.js:162-198` |
| Combine inner panels | `svghelper.js:115-134` |
| Raster input (SVG text only) | `main.js:297-312`, `index.html:254` |
| `SVGHelper.color` (raster survives) | `svghelper.js:72-79` |
| Page-count/thickness | **absent** |
