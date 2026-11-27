# Wrap check — real engine evidence, six styles

Throwaway harness under `.scratch/spine-engine/wrap-check/`. Every tile is drawn by the
proven prototype renderer (`app-renderers/renderer/renderer.js`, reused verbatim) from the
real `spine/` host run: `art.jpg` + `final.crop_box_work` from `run.json`, front from the
evidence `source.jpg`.

- Grid tile: **52 × 236 px**. Wrap is the wrap sheet's spine column at its real page-count width
  (11–33 px), centred in the slot — not stretched.
- Shelf strip: **33 × 236 px** slot with the wrap spine drawn to fill it, the way a fixed shelf slot would.
- Wrap sheets: **338–360 × 236** CSS px, rendered at 4× in `large-wrap-sheet.png`.
- Screenshots: `shot-390.png`, `shot-320.png`, `large-wrap-sheet.png`; variant: `textless-shot-390.png`, `textless-shot-320.png`, `textless-large-wrap-sheet.png`.
- Console errors: none.

## Follow-up: was the wrap tested after the text was removed?

Short answer: **yes for the spine and the back, no for the front — until this variant.** Both panels
that carry the art spine were already drawn from the engine's `art.jpg`. The front is drawn from the
published `source.jpg` by design.

### 1. Input proof — what was rendered, and whether removal happened

`art.jpg` is the engine's working art; `source.jpg` is the working copy of the published cover.
Full SHA-256 of the bytes actually rendered:

| Book | run.json route | verdict | qa.json | art.jpg SHA-256 | art == source | art.jpg is… | Printed text in art? |
|---|---|---|---|---|---|---|---|
| The Great Gatsby | text-free crop | pass | pass · crop mask 0.0% · art OCR [] | `5c0f4b343955a9ba00d6d98a725f7cc531170c7cb933587bd7a7ee283098f989` | **yes** | none — crop route returns the original cover | yes — printed text remains outside the crop |
| Dune | text-free crop | pass | pass · crop mask 0.0% · art OCR [] | `79f0cdb0bdaa0063a028904c81ee54f9d807502fbbefe9b77772ac970cb3b291` | **yes** | none — crop route returns the original cover | yes — printed text remains outside the crop |
| Pride and Prejudice | text-free crop | pass | pass · crop mask 0.0% · art OCR [] | `d756f85eb90bc4614c3c4a70695ef35096845a820c801a0cc587c1c21ebf55de` | **yes** | none — crop route returns the original cover | yes — printed text remains outside the crop |
| Rock Paper Scissors | inpaint | review | review · crop mask 57.0% · art OCR [] | `6311838ae8223b72caf1e4919052135dc1d9253c09149b7d6366227059d944f7` | no | MI-GAN inpaint output | no — removed by MI-GAN |
| The War of the Worlds | inpaint | pass | pass · crop mask 6.2% · art OCR "RA" 0.61 | `afe7379cf33861674cfedf027592c1cd22046d976649cdfca6fcc86c3e8ad8ef` | no | MI-GAN inpaint output | no — removed by MI-GAN |
| The Hobbit | inpaint | pass | pass · crop mask 22.6% · art OCR [] | `e0d1d9e7272fcd0be26e42bc4a31d4e426dc2624fc49ddb0f095fcceba018400` | no | MI-GAN inpaint output | no — removed by MI-GAN |

Only the three **inpaint** books have a post-removal `art.jpg`. For the three **crop** books `art.jpg` is byte-identical to `source.jpg`: the crop route selects a text-free window but writes back the original cover, so the art still contains the printed cover text outside that window. The wrap's spine is drawn from the crop window, so the spine itself is text-free on all six; the front is not.

### 2. What each Wrap panel uses (verified in code)

| Panel | Source | Code | Note |
|---|---|---|---|
| Front | source.jpg — the published cover | `renderer.js:569–586 · const simg = book._img.source || art` | The only panel drawn from the original cover. May still contain printed text; spec.md:180 requires it. |
| Spine | art.jpg at final.crop_box_work | `renderer.js:564 · drawArt() → artCropRect() → book._img.art` | Post-removal for inpaint; original cover for crop. Text-free on all six. |
| Back | art.jpg, blurred to 24×34 | `renderer.js:549–561 · const art = book._img.art || book._img.source` | Post-removal for inpaint; original cover for crop. Deliberately blurred. |

Shipped Wrap **already used `art.jpg` for the spine and the back**. Only the front is drawn from `source.jpg` (the published cover), which is also what the app spec requires (`spec.md:180`, front = the published cover, unchanged). So the spine — where the title-contrast failure lives — has always been the engine's post-removal image. The variant isolates the one panel that was not: the front.

### 3. Textless-wrap variant

Same `renderWrap` geometry and typography; the front reference is swapped to `art.jpg` for the draw
only (`renderWrapTextless`). Screenshots: `textless-shot-390.png`, `textless-shot-320.png`, `textless-large-wrap-sheet.png`.

| Book | Front panel Δ vs shipped | Spine Δ | Back Δ | Spine local contrast | What changed |
|---|---:|---:|---:|---:|---|
| The Great Gatsby | 0 | 0 | 0 | 11.73 | Nothing — crop route, art.jpg is the same bytes |
| Dune | 0 | 0 | 0 | 2.08 | Nothing — crop route, art.jpg is the same bytes |
| Pride and Prejudice | 0 | 0 | 0 | 2.45 | Nothing — crop route, art.jpg is the same bytes |
| Rock Paper Scissors | 22.2 | 0 | 0 | 7.09 | Front becomes blank snow; title survives only on the spine |
| The War of the Worlds | 8.3 | 0 | 0 | 1.01 | Front loses its title; MI-GAN patch visible; spine identical |
| The Hobbit | 8.7 | 0 | 0 | 10.49 | Front loses title/author; art intact |

A zero spine Δ means the pixels are identical: only the front panel changes, and only on the
inpaint books. Backs are also unchanged. Spine local contrast repeats within ±0.05 between runs
because the renderer's paper grain is random; the War of the Worlds value is 1.01 in both.

### 4. Corrected answer for the two named cases

**The War of the Worlds — still fails, and it is typography, not leftover text.** The **1.01:1 failure persists** in the textless variant. It is **renderer-drawn typography, not leftover cover text**. Proof: the spine panel is pixel-identical (Δ 0) between shipped Wrap and the variant; the cream title is set by `renderWrap` across the art's bright sky (band p90 231.8). QA finds no residual OCR in `art.jpg` apart from one low-confidence "RA" (0.61), and the printed title band was removed — the "WORLDS" that vanishes is the renderer's own type.

**Dune — still shows the giant letterforms.** They are **leftover printed cover art, not renderer type**. Dune is a crop-route book: `art.jpg` is byte-identical to `source.jpg`, so no generative removal ever touched it. The letterforms survive inside the chosen crop window because the detector never boxed display type and the recogniser is blind to them. The variant is pixel-identical (Δ 0). The renderer's own "DUNE" title is 7.8 px; the giant letters are roughly 30 px wide and part of the bitmap.

**Distinction.** Leftover cover text/art = pixels already in `art.jpg` (Dune's `DUNE`, the WotW MI-GAN patch).
Renderer typography = the cream `THE WAR OF THE WORLDS` set by `renderWrap` on the spine. The WotW
failure is the second; Dune's is the first.

### 5. Verdict

Using the post-removal art on every panel fixes **neither** problem. The War of the Worlds is a **typography/contrast** bug — it needs a scrim or contrast-aware ink (or Cloth/Hybrid). Dune is a **pipeline/detection** gap — it needs the crop moved off the display type, or Cloth; no ink change helps. The corrected ship answer is unchanged: Wrap is not shippable as-is for these six books, though four of six spines are fine. A fully textless front (the variant) also removes the cover title from the front of the three inpaint books, which is not the app's design.


## Answer

**Does Wrap look good enough to ship as the default for these six books? — No / with exceptions.**

Not as-is. Four of the six spines work: Gatsby's rule strip plus type identifies the book, Pride reads as a warm portrait, Hobbit is the best in the set, and Rock Paper Scissors is legible even though it is the review case. The blocker is that the wrap's ink is chosen from the **average** art colour, not the pixels under the letter: The War of the Worlds passes QA yet its last word ("WORLDS") sits on the bright sky at **1.01:1** and disappears at 33 px; Dune (2.05:1) and Pride (2.45:1) are also under 3:1 locally. Dune additionally keeps the giant DUNE letterforms inside the crop, so the spine competes with its own title. A contrast-aware ink or a soft scrim behind the spine type would make Wrap shippable; the fold seam and front-cover gutters are detail-view issues, not shelf blockers.

**Safer alternates for the review cases.** **Cloth** is the safest review fallback: a uniform sampled field with foil type (5.3–12.6:1), no crop dependence, no seams — it is the spec's fallback for a reason. **Hybrid** is the best-looking safe alternate: an art window plus a measured paper label (10.9–11.3:1 on every book), so it keeps cover-derived art while guaranteeing legible type. Full-bleed (13.4–15.9:1) and Editorial (15.5:1) are legibility-safe but their rail covers 38–44% of a 52 px spine, so they read as type panels, not art spines.

**Single biggest visual problem.** The wrap picks one ink colour from the **average** backdrop and then draws it across art with a huge luminance range. On The War of the Worlds the cream title crosses the bright sky at 1.01:1 — "WORLDS" is effectively invisible at 33 px on a book the pipeline passed. The renderer's own contrast figure (5.0:1 vs the average) hides this. The runner-up is the hard fold: the spine is a crop from elsewhere on the cover, so it does not continue into the published front (front-fold deltas 18–49) and non-2:3 covers get dark gutters inside the front panel (Dune, 13 px each side).

## Per-book Wrap verdict

| Book | Route / QA | Native spine | Fold Δ back / front | Wrap verdict | Note |
|---|---|---:|---:|---|---|
| The Great Gatsby | text-free crop / pass | 11 px · 10.2 mm | 110.3 (strong) / 29.7 (visible) | **ship** | White rule strip; title type carries it. Local 11.7:1. |
| Dune | text-free crop / pass | 33 px · 32.1 mm | 51.3 (strong) / 46.7 (strong) | **do not ship as-is** | Decorative DUNE letterforms dominate; small title at 2.05:1 local. |
| Pride and Prejudice | text-free crop / pass | 24 px · 22.8 mm | 60.3 (strong) / 34.3 (visible) | **ship with note** | Lovely portrait strip; cream title crosses a bright shoulder (2.45:1). |
| Rock Paper Scissors | inpaint / review | 18 px · 17.2 mm | 124.7 (strong) / 19.3 (subtle) | **review / Cloth safer** | Legible dark ink on snow (7.1:1) but the strip does not identify the book. |
| The War of the Worlds | inpaint / pass | 11 px · 10.8 mm | 64.3 (strong) / 48.7 (strong) | **do not ship as-is** | "WORLDS" is cream on the bright sky at 1.01:1 and vanishes at 33 px. |
| The Hobbit | inpaint / pass | 17 px · 16.7 mm | 18.3 (subtle) / 18.0 (subtle) | **ship** | Best in the set: black stripes, red sun, cream type 10.5:1. |

## What looks broken

- **Text clipped: none.** Every style's title fit ratio is ≤ 0.97 at 52 px; the renderer's min-size clamp never overflows.
- **Unreadable at 33 px: The War of the Worlds (pass).** "WORLDS" is drawn at 1.01:1 over the bright sky; it disappears. Dune (2.05:1) and Pride (2.45:1) are below the 3:1 line but still readable.
- **Wrong crop: none.** The rendered art matches the pipeline's own spine-2x on all six (mean abs RGB diff 2.6–4.9).
- **Blank spine: none.** The thinnest is Gatsby at 11 px, still 99% non-dark. Textless is type-free but not blank.
- **Giant decorative type: Dune.** The pipeline crop keeps the large DUNE letterforms; at 33 px they are the spine's dominant mark and compete with the real title.
- **Seam lines: yes, at the front fold.** The spine is a crop from elsewhere on the cover, so it does not continue the published front. Front-fold deltas: Hobbit 18.0 (subtle), RPS 19.3 (subtle), Gatsby 29.7, Pride 34.3 (visible), Dune 46.7, War of the Worlds 48.7 (strong). Back folds are strong on five books because the back is deliberately blurred.
- **Front-cover gutters: Dune.** A 0.558-aspect source cannot fill the 2:3 front panel, so the compositor leaves dark blurred bars about 13 px wide on each side of the front cover.

## All six styles, measured

Ratios: `fit` is the renderer's own limiting ratio (line length or thickness / box; > 1 means
it overflowed at the minimum size). Contrast is the renderer's ink-vs-field WCAG ratio.
`33 px` is the effective title size at the 33 px shelf slot.

| Book | Style | Rendered | Title px | 33 px | fit | Contrast | Local | Flags | Verdict |
|---|---|:--:|---:|---:|---:|---:|---:|---|---|
| The Great Gatsby | Wrap | yes | 7.8 | 23.4 | 0.74 | 10.9 | 11.62 | — | Ship. Bland crop, but the type identifies the book and reads at 33 px. |
| The Great Gatsby | Hybrid | yes | 11.2 | 7.1 | 0.51 | 11.3 | — | — | Ship. Cream paper label, 11.3:1; cleanest of the safe options. |
| The Great Gatsby | Full-bleed | yes | 9.4 | 6.0 | 0.86 | 13.4 | — | — | Legible 13.4:1, but the rail covers 38% of a 52 px spine. |
| The Great Gatsby | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | A white strip with rules: no identity at all. |
| The Great Gatsby | Cloth | yes | 11.2 | 7.1 | 0.55 | 5.3 | — | — | Quiet charcoal cloth, 5.3:1; safe fallback. |
| The Great Gatsby | Editorial | yes | 9.2 | 5.8 | 0.71 | 15.5 | — | — | Dark rail plus art, 15.5:1; legible but generic. |
| Dune | Wrap | yes | 7.8 | 7.8 | 0.20 | 4.0 | 2.08 | low-contrast | Giant DUNE letterforms fill the spine; the small title competes with them and reads 2.05:1 against the band. |
| Dune | Hybrid | yes | 11.2 | 7.1 | 0.34 | 11.1 | — | — | Good: paper label keeps the title safe, art window keeps the orange. |
| Dune | Full-bleed | yes | 9.4 | 6.0 | 0.42 | 14.6 | — | — | Bold and legible (14.6:1); the rail sits over the DUNE letterforms. |
| Dune | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | Recognisable Dune art, no title; decorative letters still enormous. |
| Dune | Cloth | yes | 11.2 | 7.1 | 0.18 | 7.8 | — | — | Brown cloth, 7.8:1; safe but unrelated to the cover. |
| Dune | Editorial | yes | 9.2 | 5.8 | 0.36 | 15.5 | — | — | Legible, art + rail; the rail crops the letterforms. |
| Pride and Prejudice | Wrap | yes | 7.8 | 10.7 | 0.72 | 5.4 | 2.45 | low-contrast | Ship with note: warm portrait, but the title crosses a bright shoulder at 2.45:1. |
| Pride and Prejudice | Hybrid | yes | 11.2 | 7.1 | 0.52 | 11.1 | — | — | Best of the set: paper label, 11.1:1, art keeps the faces. |
| Pride and Prejudice | Full-bleed | yes | 9.4 | 6.0 | 0.89 | 15.0 | — | — | Art plus rail, 15:1; the rail covers the second figure. |
| Pride and Prejudice | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | Beautiful but anonymous at 52 px. |
| Pride and Prejudice | Cloth | yes | 11.2 | 7.1 | 0.56 | 9.4 | — | — | Warm brown cloth, 9.4:1; safe. |
| Pride and Prejudice | Editorial | yes | 9.2 | 5.8 | 0.72 | 15.5 | — | — | 15.5:1, art + dark rail; loses the right-hand figure. |
| Rock Paper Scissors | Wrap | yes | 7.8 | 14.3 | 0.76 | 8.9 | 7.09 | — | Legible dark ink on snow (7.1:1), but it reads as a textured strip, not Rock Paper Scissors. Keep the review note and Use Cloth. |
| Rock Paper Scissors | Hybrid | yes | 11.2 | 7.1 | 0.53 | 11.3 | — | — | The art window is snow; the paper label identifies it. Safest good-looking option. |
| Rock Paper Scissors | Full-bleed | yes | 9.4 | 6.0 | 0.93 | 13.6 | — | — | Legible rail over snow; still anonymous. |
| Rock Paper Scissors | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | Snow texture with a red edge: no identity. |
| Rock Paper Scissors | Cloth | yes | 11.2 | 7.1 | 0.57 | 5.9 | — | — | Grey-brown cloth, 5.9:1; safe fallback. |
| Rock Paper Scissors | Editorial | yes | 9.2 | 5.8 | 0.74 | 15.5 | — | — | Rail at 15.5:1 over snow; legible, anonymous. |
| The War of the Worlds | Wrap | yes | 7.8 | 23.4 | 0.84 | 5.0 | 1.01 | low-contrast | The last word sits on the bright sky at 1.01:1 and disappears at 33 px. Pass verdict, unreadable title. |
| The War of the Worlds | Hybrid | yes | 11.2 | 7.1 | 0.60 | 11.1 | — | — | Paper label, 11.1:1; the safest alternate and keeps the burning city. |
| The War of the Worlds | Full-bleed | yes | 8.8 | 5.6 | 0.97 | 15.0 | — | — | 15:1 rail; legible but the rail covers the right of the city. |
| The War of the Worlds | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | Strong art, no title; recognisable at 52 px. |
| The War of the Worlds | Cloth | yes | 11.2 | 7.1 | 0.65 | 9.1 | — | — | Warm brown cloth, 9.1:1; safe. |
| The War of the Worlds | Editorial | yes | 9.2 | 5.8 | 0.80 | 15.5 | — | — | 15.5:1 over art; legible. |
| The Hobbit | Wrap | yes | 7.8 | 15.1 | 0.42 | 13.2 | 10.49 | — | Ship. Black stripes and red sun, cream type at 10.5:1; reads at 33 px. |
| The Hobbit | Hybrid | yes | 11.2 | 7.1 | 0.36 | 10.9 | — | — | Cream label plus black art, 10.9:1; very good. |
| The Hobbit | Full-bleed | yes | 9.4 | 6.0 | 0.49 | 15.9 | — | — | Art plus rail, 15.9:1; the rail hides the mountains. |
| The Hobbit | Textless | yes | 0.0 | 0.0 | 0.00 | — | — | — | Recognisable art; no title. |
| The Hobbit | Cloth | yes | 11.2 | 7.1 | 0.36 | 12.6 | — | — | Very dark cloth, 12.6:1; nearly black, but legible. |
| The Hobbit | Editorial | yes | 9.2 | 5.8 | 0.41 | 15.5 | — | — | 15.5:1; legible, but the dark rail merges with the black art. |

## What the screenshots show

- `shot-390.png` — full page at 390 px: six tiles, each wrap sheet, 33 px shelf strip.
- `shot-320.png` — the same at 320 px; the tile grid wraps to four columns.
- `large-wrap-sheet.png` — all six back/spine/front sheets at 4× render, 2100 px wide.

What they show: the wrap sheets have a hard front fold (the spine crop does not continue the published cover), the War of the Worlds spine title's top half washes out, Dune's decorative letterforms crowd the spine, and the backs are a consistent blurred field plus vellum card. The 52 px grid shows each style at the same size; the Wrap tile is the real page-count spine width (11–33 px) centred in the slot, not stretched.

## Method notes

- Wrap canvas is `wrapGeometry(pages)`: 6 × 9 in trim, 0.100 mm/leaf, 1.2 mm cover allowance,
  clamped spine 10–40 px at 236 px height. Front is the published cover; back is the blurred
  v8 art plus the vellum card; spine is the text-free crop.
- The 52 px comparison tile crops the wrap sheet's spine column and centres it at its real
  page-count width (11–33 px) in the 52 px slot. The 33 px shelf strip instead stretches that
  spine to fill the slot, which is how a fixed-width shelf tile would draw it.
- `crop-mismatch` compares the type-free art tile against the pipeline's own `spine-2x.jpg`
  (mean abs RGB diff, central 84%). It flags a renderer that picks a different window than
  `final.crop_box_work`; no book tripped it (2.6–4.9).
- Seam deltas compare the median per-row RGB difference of columns 2 px either side of each
  fold: < 20 subtle, 20–35 visible, > 35 strong. Back folds are expected to be visible because
  the back panel is deliberately blurred; the front fold is the continuity test.
- Measurements come from `measurements.json`, captured in headless Chromium at 390 and 320 px.
