# A beautiful 2D book-spine system for PocketLibrary

**Design rationale and build plan — v6**  
Date: 2026-11-26  
Prototype: [`v6/`](v6/) · <http://127.0.0.1:4173/spine-cover-art-prototype/v6/>  
Evidence: [`v6/README.md`](v6/README.md), [`v6/audit.json`](v6/audit.json),
[`bookcover-js-deep/harness/HANDS-ON.md`](bookcover-js-deep/harness/HANDS-ON.md)

---

## 0. The recommendation

**Ship Hybrid as the production default.**

A Hybrid spine is a half-bound book: a narrow real-art window on the left and
a warm paper label on the right, with the title in Cormorant Garamond and the
author in EB Garamond. It is the only direction that keeps three things at once
on a 40–55 px spine:

- a genuine art window (identity),
- a label with the largest measured type of the three (7.70 px minimum), and
- the most contrast margin (91.4% max ink use; every text/field pair >4.5:1).

Editorial should ship as the **art-first alternate**: full-bleed art with a
smoked rail. It is the most contemporary and the best browsing view when the
cover is the point, but it spends 44.5% of the width on a dark rail and its
long titles reach 96.5% of the measured length.

Clothbound should ship as a **classics series mode**: pure cloth colour, foil
type, no raster art. It is the most beautiful object and the most coherent set,
but it stops showing the cover. It is the right answer for
public-domain/Standard Ebooks shelves and the wrong default for a library whose
premise is cover art.

The rest of this document explains the constraints, what is genuinely reusable
from bookcover-js, the design system, and the exact production build.

---

## 1. The problem, stated honestly

A shelf spine is not a cover scaled down. At 40–55 px wide:

- the visible type box is roughly **6–10 px** high;
- a 2 px rule is a major graphic element;
- a 1 px shift is 2.5% of the object;
- a 48 px-wide spine is read at a glance, often in peripheral vision;
- the spine is **2D** — no perspective, no page block, no 3D camera;
- a real spine is also **not the cover**: publisher spines are separately
  typeset, often with a different palette and no cover art.

That changes the design target. The question is not “how do we render the
cover on a spine?” but “what is the smallest designed object that still reads
as *this book*?”

The answer used here is: **one art idea, one type voice, one material edge.**
Anything else is noise at this size.

### Geometry

From v4-wrap, the physical model is:

```
spine_mm = (pages / 2) × caliper_mm + cover_allowance
         = (pages / 2) × 0.100 mm + 1.2 mm
```

For the v6 sample set (208–480 pages) that is **11.6–25.2 mm**. A real 40–55 px
shelf at this size is a display zoom, so v6 keeps the physical number in the
detail card and uses a separate display width:

```
width_px = clamp(40 + (pages − 208) × (14 / 272), 40, 55)
```

This is a deliberate split:

- the **physical** number drives the metadata and a future print/wrap export;
- the **display** number guarantees legibility at phone size and keeps the
  shelf composition within a 40–55 px band.

The shelf uses a balanced contiguous partition, not fixed columns. A small
dynamic program finds the shortest feasible row count, then minimises squared
slack so the shelf is neither crowded nor orphaned. A front-heavy pass puts
the extra volumes on the first shelf when they fit: 6/5/5/5 at 390/360 px,
5/5/6/5 at 320 px, 11/10 on a wide shelf. Book order is preserved.

---

## 2. bookcover-js: what is genuinely reusable

The deep audit (`bookcover-js-deep/harness/HANDS-ON.md`) found a real
spine-only renderer hidden inside a front-cover tool. It is worth separating
the good ideas from the code.

### 2.1 Reusable ideas

| Idea | Why it matters | How v6 uses it |
|---|---|---|
| **Spine-only export** | Upstream serialises the spine SVG by itself at 72 px/in, with no front/back panels and no 45 px combined-export gaps. | The production contract is one spine rectangle, transparent background, optional cutter padding. |
| **Outer frame + inner rule** | A double rule at 3 px inset is the visual signature of a Penguin-style cloth spine; it survives 40 px. | Clothbound and Hybrid use a 2–3 px frame, 0.5 px inner rule. |
| **Typographic styles** | Style 1 (stacked words), style 2 (rotated title + author), style 3 (centred rotated title with tracking) are a useful catalogue. | v6 keeps the *patterns*: −90° title, author at the foot, optional two-line fallback. |
| **Transparent SVG + 10× PNG** | Vector-first output is editable; a raster is a proof. | Future export: generate SVG, then rasterise at 300 dpi. Never screenshot the DOM. |
| **Colour pairing** | One field + one ink is robust and cheap. | v6 replaces the single `elementColor` with a measured palette and WCAG check. |
| **Ornament system** | Repeating tiny marks can create a series identity. | v6 uses four original geometric marks, not the upstream ship. |

### 2.2 What must be replaced

| Upstream behaviour | Why it fails | v6 / production replacement |
|---|---|---|
| `.svg`-only input parsed as line art | A JPEG/PNG cannot be uploaded; an image wrapper becomes a tiled ornament. | Raster input + a calculated `cover` slice with a focus point. |
| Manual spine width in inches | No page count, no caliper, no thin-spine policy. | `pages → mm → display px`; clamp 40–55. |
| Fixed px type (18 px), no auto-fit | Clips at normal 1 in spines; style 1 needs 1.30–1.62 in. | Canvas ink metrics, measured shrink, 3.5% safety margin, two-line fallback. |
| No full-bleed placement | Uploaded art tiles/crops as art, not a spine field. | Full-bleed `background-size: cover` with focus-aware horizontal position. |
| PNG has transparent gutters | Useful for a cutter, wrong for a shelf. | Exact rectangle for shelf; padded variant only for plotter export. |
| No wrap model | Front/back/spine are independent panels with gaps. | v4-wrap stays the continuous wrap compositor. |
| Single colour field | No palette extraction, no contrast check. | Measured palette, curated cloth, readable ink. |

### 2.3 MPL-2.0 boundary

bookcover-js is **MPL-2.0**. The practical rules:

1. **File-level copyleft.** If you copy or modify an MPL file, that file and
   its derivatives remain MPL-2.0. You must make the source available.
2. **Larger work is allowed.** You can combine MPL files with proprietary code
   if the MPL files stay separate and their source is available. MPL is not
   GPL; it does not relicense the whole app.
3. **Do not bury modified MPL code in a proprietary minified bundle** without
   the corresponding source and licence notice.
4. **Keep the licence and headers** if vendoring. Publish the modified files.
5. **Do not reuse the ship SVG path** unless you are prepared to treat that
   file/asset under MPL. v6 deliberately draws its own four marks.

v6 copies **no** bookcover-js code, paths or assets. The list above is a design
inventory, not a dependency. If production later vendors a patched
`penguinstyle.js`, that is a conscious MPL compliance decision; it should be
isolated in its own directory with `LICENSE`, a `NOTICE`, and source.

None of this is legal advice.

---

## 3. The design system

### 3.1 Tokens

| Token | Value | Notes |
|---|---|---|
| Shelf width band | 40–55 px | The only hard display constraint |
| Spine height | 226–242 px | 6 × 9 trim proportion, slight edition variation |
| Shelf gap | 5 px / 4 px / 3.5 px | 390 / 360 / 320 |
| Physical caliper | 0.100 mm per leaf | v4-wrap |
| Cover allowance | 1.2 mm | v4-wrap |
| Editorial rail | 44.5% of width | 5 px inset top/bottom |
| Hybrid paper | 56.5% of width | 43.5% art window |
| Type safety | 0.965 of available box | Canvas vs browser ink |
| Two-line trigger | one-line size < 6.9 px | Only if thickness ≥12 px |
| Two-line improvement | >8% larger | Otherwise keep one line |
| Min measured title | 7.45 px | Editorial, 320 px, two-line fallback |
| Max measured title | 10.2 px | Editorial at 52 px width |
| Provenance mark | 4 px | Filled / split / hollow lozenge |
| Headband | 2 px | 52% opacity, accent/paper/cloth |
| Frame inset | 2–3 px | 0.5 px rule |
| Contrast floor | 4.5:1 | Measured per ink/field |

### 3.2 Art treatment

Five treatments are defined; each direction uses one primary and one
supporting treatment.

| Treatment | Definition | Best use |
|---|---|---|
| **Full-bleed art** | The art fills the whole spine; type sits on a rail or paper overlay. | Editorial. Maximum cover identity. |
| **Art window** | A slice of art occupies 35–50% of the spine width, with a material edge. | Hybrid. Identity plus a legible label. |
| **Colour-wash** | A low-opacity cloth tint/vignette over art to bind it to the palette. | Both art directions; 12–34%. |
| **Paper strip** | An opaque warm paper field carrying the type. | Hybrid label; the type background is always high-contrast. |
| **Cloth** | A pure colour field with weave, frame, foil and edge. | Clothbound classics; no raster dependency. |

The art crop is a vertical slice, never a squashed thumbnail. For a 2:3 source:

```
imageDisplayWidth = spineHeight × (2/3)
visibleFraction   = artWindowWidth / imageDisplayWidth
focusX            = book.focus[0] (0..1)
backgroundPos     = ((focusX − visibleFraction/2) / (1 − visibleFraction)) × 100
```

That is the same measured-focus idea as v5, applied to the actual window width
rather than a fixed 236 px height.

### 3.3 Typography

**Pairing.** Editorial uses Inter for a modern, institutional voice. Clothbound
uses Cormorant Garamond for a high-contrast, engraved feel. Hybrid uses
Cormorant for the title and EB Garamond for the author, which makes the paper
label feel printed rather than UI. The page body is Literata, so the app has a
reading face distinct from the spines.

**Scale.** Sizes are measured per book, not a fixed ramp. The aesthetic caps
are direction-specific:

```
editorial  maxTitle = min(10.2, width × 0.205)
cloth      maxTitle = min(9.7,  width × 0.193)
hybrid     maxTitle = min(9.5,  width × 0.193)
```

**Rotation.** Titles read bottom-to-top (`rotate(-90deg)`). This is the common
UK/US shelf convention and it lets the title and author share one measured
rail. The author is a separate grid column at the foot; it is never appended to
the title string.

**Tracking.** Editorial 0.17em (wide, architectural), Cloth 0.11em (engraved),
Hybrid 0.055em (printed label). Tracking is included in the canvas measurement.

**Case.** Editorial and Cloth are uppercase; Hybrid is title case. Uppercase is
a material/typographic voice, not a default. Hybrid’s title case is more
readable at 7.7 px and makes the paper label feel like a printed spine.

**The two-line rule.** At 40 px, a 28-character title in one line drops to
5.5 px. That is technically legible at 2× DPR but aesthetically dead. The
engine tries every word boundary and sets two balanced lines when:

1. the one-line size is below 6.9 px,
2. the rail is at least 12 px thick, and
3. the two-line size is >8% larger.

Three lines are never attempted: the thickness budget at 40 px cannot carry
three lines plus a rail. The result: *The Hound of the Baskervilles* is **8.9 px
on two lines** at 46.6 px, instead of 5.5 px on one line.

### 3.4 Material cues

The material system is deliberately small. Each cue must survive at 40 px or it
is removed.

| Cue | Spec | Why |
|---|---|---|
| Cloth grain | 1 px warp + 1 px weft + SVG turbulence, overlay | Reads as fabric, not noise |
| Paper fibre | 1 px laid lines at 0.026 alpha, multiply | Makes the label feel printed |
| Foil | Cream/gold ink + 0.5 px light + 0.5 px dark shadow | Suggests stamped foil without a texture map |
| Emboss | Title shadow: dark below, light above | Letterpress impression |
| Head/tail bands | 2 px woven stripe, 52% opacity | The book’s binding edge |
| Frame | 0.5 px outer + 0.5 px inner rule | The Penguin/cloth signature |
| Edge wear | Cream left inset, dark right inset | A physical object catches light |
| Contact shadow | Blurred radial on the shelf | Books sit on a board |
| Vignette | 3 px inset dark + cream edge | Holds the eye inside the spine |
| Shelf sheen | Key-light gradient at `--lamp-x` | One light source for the set |

The **Material: cues on/off** control is a design test, not a gimmick. With cues
off, the hierarchy must still work: art or cloth field, type, contrast. It does.

### 3.5 Provenance without clutter

A shelf spine cannot carry “ORIGINAL ART” / “RECONSTRUCTED” text. It also
cannot pretend the classes are identical.

The compromise is one **4 px lozenge at the tail**:

- **Original** — filled accent.
- **Reconstructed** — half-filled, split down the middle.
- **Fallback** — hollow.

The mark is legible at 2× DPR and invisible at a glance. The full meaning lives
in the selected-spine card, which names the route, the source, the model (where
applicable), the measured fit, the contrast and the palette. The provenance
filter isolates one class at a time so the “do the reconstructions blend?”
question is an intentional comparison, not a guess.

### 3.6 Light, dark and contrast fallbacks

The page is a dark gallery. It is not a light-theme app, but the system must
still be robust:

- **Fixed editorial rail**: cream `#f2e8d4` on a smoked `#0d0e10` rail
  composited 88% over the art. Measured contrast at 390 px: 13.9–15.3:1.
- **Cloth**: choose cream `#f2e6c9` or ink `#241a12` by comparing contrast
  against the cloth. The Moonstone’s light stone cloth gets dark ink;
  Dracula’s oxblood gets cream.
- **Hybrid**: dark ink `#2c2118` on paper `#ece2ca` mixed 5.5% with the cloth.
  Measured 10–12:1.
- **Fallback**: the measured edge colour becomes the field; ink is chosen by
  contrast. No cover pixels are painted as art.
- **Art failure**: `.is-artless` shows the cloth field, rail/paper and fitted
  type. No blank holes.
- **Forced colours**: CanvasText outline, Canvas background for rail/paper,
  no decorative shadows.
- **Reduced motion**: all transitions disabled.

The fitline and detail card report the lowest-contrast spine. In the current
21-book set it is **0 below 4.5:1** at 390/360/320.

---

## 4. The three directions, concretely

### 4.1 Editorial — full bleed + smoked rail

```
z0  cloth base (art fallback)
z1  art (cover slice, focus-aware)
z2  wash (12% cloth + edge vignette)
z3  rail (right 44.5%, 5px inset, smoked, 0.5px inner hairline)
z5  grain (soft-light)
z6  head/tail 1px accent rules; 8px ornament at the rail head
z7  titlebox: width = h − 18 − 20; grid [authorW | title]; rotate −90°
z8  title Inter 500 caps; author Inter 400 caps at the foot
z9  4px provenance lozenge
```

**Measured at 390:** 6/5/5/5 shelf; min title 7.45 px; tightest ink 96.5%; zero
clips; zero low-contrast pairs.

**When to use:** art-first browsing, contemporary/editorial catalogues, covers
whose artwork is the reason to show a spine at all.

**Failure mode:** the rail is a large dark rectangle. At 40 px, a short title
leaves a lot of empty dark space. The design accepts this as “quiet”; a denser
variant would use a narrower rail and drop the author.

### 4.2 Clothbound — cloth field + foil

```
z0  curated cloth field (light from top-left, darker right edge)
z1  double frame: 3px inset, 0.5px outer + 0.5px inner
z5  cloth grain + edge wear
z6  2px head/tail bands; 11px ornament at the head
z7  titlebox: width = h − 33 − 17; grid [authorW | title]; rotate −90°
z8  title Cormorant 600 caps, 0.11em; author at the foot
z9  4px provenance lozenge
```

**Measured at 390:** 6/5/5/5; min 7.50 px; tightest 96.2%; zero clips; the
two-line fallback handles *Hound* / *Jekyll*.

**When to use:** public-domain classics, a “Penguin clothbound” series, a
library view where the set matters more than any one cover.

**Failure mode:** no art. It is a beautiful object but a weaker identity cue
for a modern cover-led library. It also requires curated palettes; deriving
cloth directly from a muddy painting produces mud.

### 4.3 Hybrid — art window + paper label

```
z0  cloth base
z1  art window: left 43.5%, duotone saturate .62 / brightness .92
z2  wash confined to the art window
z3  paper label: right 56.5%, laid paper, gold boundary
z4  frame: 2px inset, 0.5px gold
z6  2px head/tail bands; 8px ornament on the paper
z7  titlebox: width = h − 26 − 16; grid [authorW | title]; rotate −90°
z8  title Cormorant 600 title case; author EB Garamond at the foot
z9  4px provenance lozenge
```

**Measured at 390:** 6/5/5/5; min 7.70 px; tightest 91.4%; zero clips; zero
low-contrast pairs.

**When to use:** the default mixed library. It is the only direction that
keeps a real art window and a high-contrast label at the same time.

**Failure mode:** the art window is narrow (18–23 px), so only a face, a
horizon or a colour field survives. It is not a substitute for a full cover
view. The two-line fallback handles the longest titles at 7.7–8.9 px.

---

## 5. The type engine

This is the part that should not be re-invented in production; it should be a
single shared module used by the shelf, the detail preview and the future SVG
export.

### 5.1 Measurement

```js
ctx.font = `${weight} 100px "${family}"`;
const m = ctx.measureText(text);
const inkRatio     = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 100;
const advanceRatio = (m.width + tracking * 100 * text.length) / 100;
```

Run after `document.fonts.ready`. The actual ink box is essential: using the
font-size as a proxy overestimates caps and clips descenders.

### 5.2 Fit

```js
size = min(
  aestheticCap,
  thickness * 0.965 / inkRatio,
  length    * 0.965 / advanceRatio
);
size = floor(size * 20) / 20;
while (advanceRatio * size > length + 0.02 ||
       inkRatio * size > thickness + 0.02) size -= 0.025;
```

The 0.965 safety margin covers the gap between canvas metrics and the
browser’s rotated ink box. It is deliberately not 1.0; a spine that is exactly
full looks clipped even when it is not.

### 5.3 Two-line fallback

```js
if (oneLineSize < 6.9 && thickness >= 12) {
  best = argmin over word boundaries of
         max(lineA.advance, lineB.advance) + 0.16 * |lineA − lineB|
  twoLineSize = min(cap, thickness * 0.965 / (2 * 1.06),
                         length * 0.965 / best.advance)
  if (twoLineSize > oneLineSize * 1.08) use two lines
}
```

The renderer sets two `<span>` lines inside the rotated title block. The
across-spine thickness test becomes `2 × 1.06 × size`. The `Ink used` metric
reports `max(fitLength, fitThickness)` and the `limiting` reason is one of
`length`, `thickness`, `aesthetic cap`, `two-line cap`.

### 5.4 Why this matters at 40 px

Without the fallback, the 21-book set has a 5.55 px minimum. With it, the
minimum is **7.45 / 7.50 / 7.70 px** (Editorial / Cloth / Hybrid) and the
tightest ink use is **96.5 / 96.2 / 91.4%**. No title clips. That is the
difference between “technically rendered” and “designed”.

---

## 6. Production build plan

### 6.1 Modules

```
src/spines/
  tokens.ts            widths, insets, type specs, material toggles
  palette.ts           measured palette + readable ink + WCAG
  geometry.ts          pages → mm → display px; shelf packing; crop position
  fit.ts               canvas measurement, one-line/two-line fit
  layout.ts            direction-specific boxes (rail/paper/window/titlebox)
  render-dom.tsx       React/DOM shelf spine (interactive)
  render-svg.ts        same layout → SVG (export, print)
  ornaments.tsx        four geometric marks, no upstream SVG paths
  provenance.ts        route badge logic + filter
```

`render-dom.tsx` and `render-svg.ts` must consume the same `SpineLayout`
object. That is the only way to guarantee the screen spine and the exported
spine have the same type fit.

### 6.2 Data contract

```ts
type SpineBook = {
  id: string;
  title: string;
  author: string;
  pages: number;
  route: "original" | "reconstructed" | "fallback";
  art?: { src: string; focus: [number, number] };
  cover?: string;
  palette: { cloth: string; accent: string; measuredAvg: string };
  provenance: { label: string; source: string; license: string; note: string };
};
```

Page counts must come from edition metadata where available. The palette can be
precomputed at ingest (recommended) or sampled at runtime (v6 uses measured
values baked into `data.js`).

### 6.3 Render contract

```ts
type SpineLayout = {
  width: number; height: number;
  direction: "editorial" | "cloth" | "hybrid";
  fields: { rail?: Box; paper?: Box; art?: Box };
  crop: { backgroundPosition: string };
  title: { text: string; lines: string[]; size: number; tracking: number;
           box: Box; authorSize: number; authorBox: Box; limitedBy: string };
  material: { frame: boolean; bands: boolean; grain: boolean; foil: boolean };
  palette: { cloth: string; accent: string; paper: string; ink: string };
  contrast: number;
};
```

### 6.4 Export path

Do **not** screenshot the DOM. Generate the spine as an SVG from `SpineLayout`:

1. `<rect>` field / `<image clip-path>` art / `<rect>` paper or rail.
2. `<text>` title and author with the measured font-size and tracking.
3. Ornament and rules as vectors.
4. Serialise at 72 px/in (upstream convention) or 300 dpi.
5. Rasterise at 10× only for a PNG proof; keep the SVG authoritative.

The SVG export should carry a background field (unlike bookcover-js’s
transparent spine), because a shelf spine is an object, not a cutter guide.
Provide a separate “cutter” variant with padding if a plotter is ever needed.

### 6.5 Performance

- 21 spines × 2 measured text blocks = 42 `measureText` calls, cached by
  `family|weight|tracking|text`. Negligible.
- Palette extraction should be precomputed; runtime canvas sampling of 20
  images is avoidable.
- The shelf re-packs on resize, not on every scroll. Debounce 140 ms.
- Art is one background image per spine, `cover`, no filters that force a
  full-size offscreen layer beyond the existing `filter: saturate()`.

### 6.6 Test matrix (minimum)

- 320 / 360 / 390 / 414 px, 1× and 2× DPR.
- Three directions × rail on/off × material on/off × three lights.
- Filter each provenance class; selection preserved when possible.
- DOM clip test (title/author rect vs spine rect, 0.8 px tolerance).
- Canvas fit test (`fitLength`, `fitThickness` ≤ 1).
- Contrast test for every ink/field pair.
- Font load test: Inter, Cormorant, EB Garamond, Literata.
- Art failure test: remove one asset; expect cloth fallback, no blank.
- Export test: SVG dimensions, type positions, no clipping; PNG alpha.

v6 already runs the first four; the export and art-failure tests are the
remaining production work.

---

## 7. Recommendation, restated with the numbers

| Criterion | Editorial | Clothbound | Hybrid |
|---|---|---|---|
| Art identity | strong (strip) | none | **strong (window)** |
| Type legibility | 7.45 px | 7.50 px | **7.70 px** |
| Fit margin | 96.5% | 96.2% | **91.4%** |
| Contrast failures | 0 | 0 | **0** |
| Series coherence | high | **highest** | high |
| Works at 320 px | yes | yes | **yes, best margin** |
| Production cost | low | low (palette curation) | medium |
| Honest fallback | good | good | **best** |

**Ship Hybrid.** It is the only direction whose worst case is still a legible,
high-contrast, recognisable book. Keep Editorial behind an “Art first” toggle;
keep Clothbound for a classics series. Do not ship one universal type size,
and do not ship a spine without the measured two-line fallback.

### Exact division of labour with bookcover-js

**Borrow the contract, not the code:**

- one-spine SVG export, 72 px/in, transparent/cutter padding contract;
- outer frame + inner rule;
- rotated title + foot author;
- transparent SVG + scaled PNG proof;
- one field + one ink colour pairing.

**Build ourselves:**

- page/caliper → spine width and 40–55 px display clamp;
- raster art ingestion and focus-aware `cover` crop;
- measured fit + 3.5% margin + two-line fallback;
- rail/paper/art-window composition;
- measured palette + WCAG contrast fallback;
- provenance model and filter;
- shelf packing and responsive composition;
- SVG export from the same layout object (future).

**Do not copy:** `penguinstyle.js`, `svghelper.js`, the ship path, or any MPL
file into a proprietary bundle. If a future build vendors them, isolate the
files, keep the MPL headers, include the licence and publish the modified
source.

---

## 8. Risks and open questions

1. **The spine is a mock.** Real publisher spines are separately typeset and
   often have no cover art. v6 is an app design, not a facsimile.
2. **Art rights.** The two modern covers are in copyright; the reconstructed
   art is a derivative. The `RECONSTRUCTED` route is a design reference, not a
   production licence.
3. **Curated palettes.** The cloth colours are chosen, not extracted. A
   production ingest needs a palette review step or a constrained
   hue/saturation/lightness mapper.
4. **Two lines is a heuristic.** It should be paired with title abbreviation
   (“Hound of the Baskervilles”) and manual overrides.
5. **The rail is heavy.** Editorial at 40 px can read as a black bar with a
   thin painting. That is the direction’s character, not a bug, but it should
   be A/B tested against a narrower 38% rail.
6. **No 3D or wrap in v6.** v4-wrap remains the continuous-wrap compositor;
   v6 is the shelf spine system that would sit inside it.
7. **No export yet.** The production path is SVG-first; the DOM is for
   interaction, not for final pixels.
8. **Only Chromium was tested.** Font metrics and `background-size: cover` are
   stable, but Safari/Firefox need a pass before release. `color-mix()` and
   `backdrop-filter` should be resolved to hex/opaque fallbacks at build time.

---

## 9. Related prototypes

- [v3 — the cover, unprinted](v3/): genuine textless art and the original
  shelf language.
- [v4-wrap — continuous wrap](v4-wrap/): page/caliper geometry, measured fit,
  the typographic fallback.
- [v4-generative — can a model invent the art back?](v4-generative/): the two
  reviewed reconstructions.
- [v5 — provenance-aware shelf](v5/): the routing policy and the comparison
  chain.
- [bookcover-js deep audit](bookcover-js-deep/harness/HANDS-ON.md): the
  spine-only export, its clipping, and the MPL boundary.

**Deliberately not done:** no production code, tests, manifests or existing
specs were changed; no commits, tags or releases. v1–v5 are intact. The
prototype is a design study, not a shipped renderer.
