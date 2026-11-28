# Shelf visual design — prototype notes

Throwaway prototype for ticket 06. Open `prototype/design/shelf-variants.html` directly in a browser to compare v1–v3, or `prototype/design/shelf-v4.html` for the refined single direction. No server, no build, no network at runtime.

`prototype/design/shelf-variants.html` is kept untouched for reference. v4 is the current direction: darker palette, real Victorian case, real covers, and compositor-only motion.

## V4 — Victorian night case (current direction)

**File**: `prototype/design/shelf-v4.html` · covers in `prototype/design/covers/` · phone-first 390×844.

### Palette

All values are the literal tokens in `:root`; everything is darker than v1–v3, and there are no cream walls or saturated primaries.

- Room: `#0b0908`, `#15100c`, `#211811`; page base `#080605` → `#050403`, with a deep radial vignette.
- Furniture: `#0d0805`, `#1a110b`, `#241810`, `#332316`, `#4a3521`, `#5c4229`.
- Brass: `#b08d57` base, `#c9a86a` highlight, `#7d6238` shadow.
- Paper / ink: `#e7dcc6`, `#c8b99e`, `#2a2118`.
- Labels: oxblood `#6e2b2b`, forest `#2f4a3c`, navy `#2b3a55`, mustard `#9a7b3f`, plum `#4a2f3a`, slate `#46505a`, dusty rose `#8a5a5a`.
- Spine colours are worn, desaturated derivatives of each cover's average colour, darkened by hand; each spine adds vertical leather weave, darker endcaps, two gilt rules and a warm highlight down the left edge. Finished seals and the shelf plaques use the brass ramp.

### Type

System serif only: `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Hoefler Text", Georgia, "Noto Serif", serif`. Display is small-caps/uppercase with generous tracking (`.13em–.36em`); body 12.5 px / 1.6; labels 4.9–6.8 px uppercase with `.18em–.3em` tracking. No sans-serif is used for display or running text.

### Furniture layers

The case is built as real cabinetry, not a single board:

1. **Crown** — cap, carved frieze with an inline-SVG acanthus medallion, dentil course, and a moulded cornice.
2. **Frame** — fluted pilasters on both sides with capital and base blocks plus brass hairlines.
3. **Bays** — recessed back panels with stile/rail panelling, warm lamp pools, book rows, and brass retaining rails with finials.
4. **Shelf** — a 9 px moulded lip (brass inlay), a 20 px heavy board, contact shadow, brass shelf plate, `Full · 12/12` plaque on shelf III, and carved SVG brackets under each board.
5. **Plinth** — stepped top, panelled body, dark foot.
6. **Wall** — near-black brown/black-green gradient, faint 78 px wall panelling, fixed vignette. Layers use CSS gradients, inset shadows and inline SVG; no images, no blend modes, no filters.

### Detail composition

V3's framed panel is kept (double gilt rules, corner brackets, top crest, kicker, ornament rule), but the real cover is the hero: `width: min(calc(73% + 23px), 270px)` of the panel, i.e. **265 px at a 390 px viewport — 72.5 % of the 366 px panel**. The cover has a spine fold, page block on two edges, soft static shadow, a halo arch behind it, and the percentage/gold sticker overlapping its lower-right corner. Body copy sits on the near-black panel in `#cdbfa4`; headings use `#e2cb96`.

### Motion

All animated properties are `transform` and `opacity`; no animated box-shadow, filter, background-position or layout property.

- Lift: **260 ms** `cubic-bezier(0.22, 1, 0.36, 1)`.
- Spine flight: **460 ms** same ease, with a 230 ms opacity fade delayed 170 ms.
- Panel open: **480 ms** transform + **320 ms** opacity, same ease.
- Close: **300 ms** `cubic-bezier(0.4, 0, 0.2, 1)` for transform, 240 ms for opacity.
- Filter/status changes only toggle opacity (220 ms) and never move books.
- Reduced motion collapses every duration to ~0 ms; the detail opens with no flight.

Opening sequence: the tapped spine is cloned into a fixed layer, dims on the shelf, lifts 13 px and tilts, then flies toward the centre while `rotateY(-44deg)` and scaling to 2.35×, fading as the framed panel rises and turns from `rotateY(-11deg)`. The `.detail-stage` stays `overflow: visible`, `opacity: 1`, `filter: none`, `clip-path: none`, `transform-style: preserve-3d`; only the `.panel` child fades. The shelf never reflows (`SHELF SHIFT 0`).

### Covers and licences

36 public-domain titles, one real cover each, downloaded from **Standard Ebooks** on 2026-11-27. Standard Ebooks releases its ebook productions, including cover artwork, into the **public domain (CC0)**; the underlying paintings/designs are pre-1930 public-domain works. Files were resized to 900×1350 JPEG (quality ~85) and are referenced locally as `covers/<slug>.jpg`; there is no runtime network request. If a cover is ever missing, the prototype should fall back to a locally drawn SVG cover rather than a request.

Titles used: The Moonstone, Middlemarch, Jane Eyre, The Picture of Dorian Gray, Moby-Dick, Bleak House, The Woman in White, Frankenstein, Treasure Island, The Time Machine, Pride and Prejudice, Dracula, Wuthering Heights, Great Expectations, The Hound of the Baskervilles, North and South, The Scarlet Letter, The Turn of the Screw, The Tenant of Wildfell Hall, Silas Marner, Far from the Madding Crowd, Persuasion, The Age of Innocence, The Invisible Man, The Mysteries of Udolpho, A Study in Scarlet, Dr Jekyll and Mr Hyde, The Voyage of the Beagle, The Old Curiosity Shop, David Copperfield, The Mill on the Floss, Tess of the d'Urbervilles, The Return of the Native, Mansfield Park, Northanger Abbey, Sense and Sensibility.

Source pattern: `https://standardebooks.org/ebooks/<author>/<title>/downloads/cover.jpg` (Alice and Jekyll needed the image-catalogue path; all were verified as 200 and valid JPEGs).

### WebView risks

- 36 covers add ~6.9 MB to the prototype folder; they are only fetched on open, but a cold local read plus JPEG decode can flash a blank cover on slow storage. A future build should decode/preload the tapped cover before revealing the panel.
- The case uses many static gradients and multi-layer shadows across four bays. There are no blend modes or filters, which keeps scrolling cheaper than v1/v3, but near-black ramps can still band on 6-bit panels; if so, bake the wall/case into one pre-rendered bitmap and keep only book shadows live.
- `perspective` / `preserve-3d` and inline SVG `<use>` are supported in modern Chromium WebView; very old WebViews may flatten the panel turn. The fallback is a simple translate/opacity rise, which still works.
- System serif metrics differ between desktop Chromium and Android (Iowan/Palatino missing on Android), so tracked uppercase titles and spine truncation must be re-checked on a real device. Spine truncation is character-count based, not measured.
- `will-change` is left on the panel; on memory-constrained WebViews it should be removed after the open transition.
- The flight clone is reparented to `<body>`; if a future app shell uses a transformed ancestor, measure in viewport coordinates (as here) and keep the clone fixed.
- No sound. If added, keep it off by default and gate it behind a user gesture.

### Verification (v4, 2026-11-27)

- Chromium 390×844 @2×: 36 books, 3 stocked shelves + 1 empty, `Full · 12/12` plaque, no horizontal overflow at 320/360/390/430.
- `.detail-stage` computed: `overflow: visible`, `opacity: 1`, `filter: none`, `clip-path: none`, `transform-style: preserve-3d`.
- Cover at 390 px: 265 px wide / 366 px panel = 72.5 %.
- Filtering changed opacity only; 0 book positions moved. All three shelf samples opened their correct local cover (900×1350).
- No console/page errors; requests were only the HTML and local cover JPEGs. Reduced-motion opens instantly with no flight clone.
- All 36 cover paths resolve locally (HTTP 200, 900×1350) and are unique.
- The shared Cloudflare tunnel process was gone after the environment restart that interrupted this session, so `https://perth-fruit-raw-elimination.trycloudflare.com/...` still returns 000 and cannot be re-created at the same URL. The static server was restored on `:8765`; `http://127.0.0.1:8765/prototype/design/shelf-v4.html` returns 200. Screenshots: `screenshots/v4.png`, `v4-open.png`, `v4-open-finished.png`, `v4-bottom.png`.

The wall has three stocked shelves plus a fourth empty shelf demonstrating the empty state; the third shelf carries a small brass "Full · 10/10" plaque. Filtering only changes opacity; book positions were verified unchanged (32/32 identical left offsets before and after).

## Earlier iterations (superseded)

Everything from **Shared decisions** down to **Navigation & acquisition flows** records the v1–v3 comparison and the first v4 attempts from 2026-11-24. The current `shelf-v4.html` is now a single-direction rewrite (section at the top of this file); the earlier multi-variant v4 remains recoverable from git history. `flows.html` is a separate prototype built on that earlier v4 and is untouched.

## Shared decisions (all variants)

- **Structure**: header → sticky brass filter strip (2 rows: labels + status) → three fixed shelf cavities → empty shelf. Vertical page scroll, no horizontal overflow, no endless rows.
- **Books**: 27–36 px wide, 196–238 px tall, aligned to the shelf board, a few leaning 1–2°. Spines are generated from title/author + a curated cover palette; label bands show max two + a `+1` nub; reading = red ribbon; finished = embossed gold seal. Long spine titles ellipsize at a word boundary; authors use surname only.
- **Flip**: tap a spine → a fixed-position clone lifts off the shelf and flies to the cover position (580 ms transform, 320 ms fade delayed 220 ms) → a 3D detail stage turns in from `rotateY(-34deg)`. Close returns the spine. Escape / backdrop / close / Return-to-shelf all close.
- **Detail content**: generated cover, full title/author/year, blurb, progress bar, status, labels, edition/shelf/format/label count, paper percentage sticker (reading) or gold sticker (finished). Unread shows no sticker.
- **3D safety**: `.detail-stage` is `overflow: visible`, `opacity: 1`, `filter: none`, `clip-path: none`, `transform-style: preserve-3d`. Fades happen on the scrim; clipping (none currently) would go on an outer wrapper.
- **Type**: no webfonts. Display + body = Iowan Old Style → Palatino → Book Antiqua → Georgia → Noto Serif. This is a deliberate risk: glyph widths differ between Chromium/Linux and Android WebView. Avoid a browser-default look with small-caps eyebrows, wide letter-spacing, italics and ornamental rules.
- **Spacing**: 4 px base. Page gutter 11–13 px. Filter chip height 34 px; close target 44 px; switcher 46 px. Shelf cavity 248–264 px tall; board 12–17 px.
- **Motion**: one shared language — `cubic-bezier(.2,.8,.2,1)` for openings/lifts, 550–620 ms; 300–340 ms fades and closes; 150–200 ms press feedback. Reduced-motion collapses all durations to ~0.
- **Sound**: none in the prototype. If added, one optional soft paper/wood tick on flip, off by default.

## Variant 1 — Dark oak & brass

**Palette**: wall `#2c1a10 → #120a06`; recess `#120a06 → #1b0f08`; oak `#6b4227/#4b2b17/#301a0d`, board `#59331c/#3c2111/#241409`; brass `#c9a55a`, highlight `#f0d9a7`, shadow `#8f6f3b`; paper `#f4ead4 → #e2d2b1`; ink `#36281a`; label colours oxblood `#69202c`, crime `#2c4256`, essays `#7a5826`, poetry `#4a3255`, sea `#2a4a45`, travel `#59432a`.

**Type**: 30 px uppercase display masthead, 9 px letterspaced small-caps subtitle; 23 px detail title; 11.5 px/1.5 blurb; 5.3 px spine label abbreviations. Gold-on-leather for display only; body copy always on paper.

**Elevation**: deep and warm. Shelf board `0 13px 20px rgba(0,0,0,.62)`; recess `inset 0 22px 34px rgba(0,0,0,.82)`; spine `0 7px 9px -3px rgba(0,0,0,.55)`; open spread `0 42px 60px rgba(0,0,0,.65)`. Additive radial "lamp pools" per shelf, no single page-wide light.

**Motion**: brightest of the three in feel; the spine flight is most legible against the dark wall. Detail stage takes 620 ms, 34° turn.

**Good at**: it is unmistakably a Victorian reading room; leather/gilt/brass read instantly at 27 px spine widths; paper detail page is highly legible; status ribbons/seals pop; most emotionally convincing.

**Android risks**: many large radial gradients, `mix-blend-mode` noise overlays and multi-layer `box-shadow` on 32 spines. On a mid-range WebView this is the most likely variant to drop frames while scrolling. Mitigate by baking wall/shelf textures into one pre-rendered bitmap, removing blend modes, and reducing each spine to two shadows. Near-black masses can smear on cheaper LCD panels.

## Variant 2 — Daylit study

**Palette**: plaster `#f0e7d4 → #ddd0b6`; window light `rgba(255,255,255,.2–.42)` diagonal bands; pale oak frame `#d4ba8e/#bd9c69/#a17e4f`; cavity `#eee4d0 → #d8c9ad`; board `#d8bf96/#bd9e6c/#92713f`; brass `#d9c49a/#c2a678/#a98a59`; ink `#3b3225`; paper `#fcf8ec → #eadec4`; cloth spines are the same palettes lifted ~45 % toward cream.

**Type**: 38 px display masthead with italic "Library"; 8 px kicker at .38 em; 26 px detail title; 12.5 px/1.58 blurb. Labels switch from coloured bands to cream paper labels with a colour edge; rules are thin hairlines, not gold.

**Elevation**: soft and directional. Frame `0 18px 26px -12px rgba(86,64,32,.45)`; cavity `inset 0 10px 18px rgba(92,70,38,.20)`; spine `0 6px 8px -3px rgba(80,60,30,.4)`; sheet `0 26px 50px rgba(92,70,38,.26)`.

**Motion**: 550 ms sheet rise with a 7° X-tilt; lighter, less theatrical than V1.

**Good at**: calm, restful, extremely readable; cloth bindings and paper labels feel like a private study rather than a dark pub; lowest visual fatigue for long browsing; likely the cheapest to render (fewer shadows, flatter surfaces).

**Android risks**: cream-on-cream can lose hierarchy in daylight; the muted cloth spines reduce cover-palette differentiation, so scanning by colour is weaker. The large masthead + two-row filter consume ~210 px of 844, leaving less shelf above the fold. Thin hairlines may disappear at 1× DPR.

## Variant 3 — Gothic gilt

**Palette**: wall `#0a1410 → #040806` with a faint diagonal-damask weave; recess `#0c1712 → #060c09`; gold `#c9a13f`, highlight `#e8ca7d`, shadow `#8f7333`; board `#241a0d`; parchment text `#d7c69e`; detail frame near-black green with gold double rules.

**Type**: 27 px uppercase display at .16 em; 8 px kicker at .42 em; 24 px uppercase detail title at .04 em; 12 px/1.62 body in warm parchment. Gold is reserved for title/rules/ornament; body copy stays light parchment.

**Elevation**: theatrical. Shelf recess `inset 0 22px 32px rgba(0,0,0,.75)` + gold glow; board `0 14px 20px rgba(0,0,0,.75)`; detail frame `0 30px 60px rgba(0,0,0,.6)` + `inset 0 0 40px`. Arched niches, double gilt rules, corner brackets, diamond tooling on every spine.

**Motion**: same 550–620 ms curves, but the frame lands with a 22 px rise + 0.97 scale; the most "curtain" like entrance.

**Good at**: dramatic, collectible, ceremonial; the arch/cornice shape gives the wall a real architectural identity; gold seals and tooling feel like treasure. Strongest "special object" feeling when a book opens.

**Android risks**: highest GPU cost and highest legibility risk. Near-black gradient ramps band badly on 6-bit panels; thin gold hairlines shimmer or vanish; gold text at 5 px is ornamental only (never information). Dramatic darkness may be tiring for everyday use. More decor per spine than V1 → slower scroll on mid-range WebView.

## Recommendation

**V1 Dark oak & brass** is the strongest base. It is the only variant that reads as "Victorian reading room" before any text is read, while keeping the paper detail page genuinely legible and the spine system practical. Steal V2's restrained masthead/typography and lighter paper labels for calmer everyday use, and V3's seal, diamond tooling and arch silhouette as small accents. Keep V3's full darkness and gold-on-black body copy out of production.

## Legibility rules the variants imply

1. Body copy never sits directly on wood, cloth or noise: it goes on paper/parchment or a plate.
2. Texture/noise overlays stay below text layers; keep them under ~10 % opacity on reading surfaces.
3. Spine text gets a 1 px dark (dark variants) or light (V2) shadow; label bands are colour + 4-character abbreviation, never the only carrier of meaning.
4. Gold is a display/accent colour; body text uses paper/ink. Minimum body size 11.5 px (12 px+ preferred).
5. Small-caps eyebrows ≥8 px with ≥.18 em tracking; never set running text in all caps.
6. Percentage/status is duplicated (sticker + text/aria label) so colour-blind users can read it.

## Verification notes (phone viewport, 390×844 @3×)

- Required captures: `screenshots/v1.png`, `v2.png`, `v3.png`, `v1-open.png`. Extra: `v1-full.png`, `v2-full.png`, `v3-full.png`, `v1-filtered.png`, `v1-finished.png`, `v2-open.png`, `v3-open.png`.
- Console errors: none. Requests: only the local HTML (no fonts/images/network).
- 32 books, 3 stocked shelves + empty demo, 1 full plaque in every variant; no horizontal overflow.
- On phone, the floating prototype switcher overlays the lower third of a shelf at 390×844 — expected for the prototype bar, not part of the design.
- The first viewport shows roughly two shelves; the third and the empty state need a scroll, which is intended for a fixed wall.

## Variant 4 — Refined reading room (2026-11-24)

Built as `shelf-v4.html` (copy of `shelf-variants.html` plus a scoped `html[data-v="4"]` layer). `?v=4` is the default on this file; 1–3 remain switchable.

**Palette**: wall `#080b09 → #030504` with a faint gold damask; recess `#0b100c → #040705`; casework `#4b3720/#332415/#160e06`; brass `#c9a55a`, highlight `#e3cb92`, shadow `#8f7333`; parchment text `#d8c8a4`; accents oxblood/forest/navy/mustard/plum kept from the V1 palettes. V1 spines get a flat neutral overlay (no `filter`) so they sit darker and slightly desaturated in the room.

**Furniture**: layered-gradient casework, no images. Thick cavetto cornice with an inline-SVG palmette crest, fluted side pilasters with capitals, panelled recessed back, moulded shelf lip, thick board with brass hairline, plinth, and carved scroll brackets in inline SVG. Books are unchanged in position and size above 380 px.

**Real covers**: 16 of the 32 titles resolve to `covers/*.jpg` by title (`COVERS` map); the rest fall back to the generated cover inside the same frame. The cover is `min(268px, 80%)` of the detail frame (`256 px` measured at 390 px), with a spine hinge, page block, inset bevel and soft ground shadow; the reading/percentage or finished sticker sits on the lower-right corner.

**Motion**: no flight clone in v4. Spine lift/out is the shared 320 ms opacity/transform; detail scrim fades 260 ms linear; the framed panel enters with `translateY(18px) scale(.985) → 0/1` over 480 ms `cubic-bezier(.2,.8,.2,1)` and `opacity` over 240 ms. Only transform/opacity animate. Reduced motion opens instantly.

**Still rough**: small screens under 380 px scale book widths down (0.9/0.8) to avoid clipping; the sticky prototype switcher still covers the lower shelf; the furniture detail is gradient-only (no real beveled depth); cover images are unfiltered and can be much brighter than the room.

## V4 revision — feedback round (2026-11-24)

**Palette**: removed the green cast. Base is now neutral warm charcoal / dark walnut: wall `#140e09 → #0a0806 → #060403`, recess `#120d09 → #0b0806 → #060403`, page/body `#0a0806`, detail scrim warm `rgba(108,72,40,.5)` over `rgba(6,4,3,.975)`, panel `rgba(22,15,10,.97)` with a brass lamp radial. Filter strip `#171009 → #100b07 → #070403`. Greens are gone from the vignette, cavity, scrim, plate, empty-state and panel; brass (`#c9a55a`, `#e3cb92`) and oxblood (`#731d21`) carry the accents. V1 spine colours and cover mapping are unchanged.

**Spine labels**: paper bands now use a `#f3e6c7 → #d8c096` aged-paper gradient with dark ink `#241a10`, 12 px tall, 7 px / 700 sans, 1 px label-colour edge. No band clips at 390 px.

**Detail labels**: full label names on aged paper (`#f4e9cf → #dfcca6`), ink `#2b2115`, 12.5 px, 6×11 px padding, brass border with a 3 px label-colour edge. Status row (`Reading status` + pill) is removed from the v4 detail; the shelf ribbon/seal and cover progress sticker remain.

**Reader**: a full-width oxblood **Continue reading** / **Read** button (52 px, brass edge, book icon) follows the metadata. It opens a fixed reader overlay: dark walnut top bar with ←/× controls and title, a 3 px brass progress bar (page 1–3, percent), and a scrollable aged-paper sheet with placeholder prose and Previous/Next paging. Escape or either back/close control returns to the detail; closing the detail also tears down the reader. The floating variant switcher fades/slides out while a detail or reader is open. All new motion is transform/opacity only and collapses under `prefers-reduced-motion`.


## V4 final iteration — purple room, colour labels, clearer spines, visible exit (2026-11-24)

**Palette**: the warm-brown scene is now deep Victorian purple. Page/body `#0e0810`; wall `#150e16 → #0e0810 → #09050b`; filter strip `#1d1220 → #150e16 → #0e0810`; recess `#1a1020 → #120a16 → #0b060e`; casework `#3a2540 → #271731 → #190f20 → #100812` (board `#3d2846 → #2a1832 → #180d20`); detail scrim `rgba(88,44,96,.46)` over `rgba(10,5,14,.975)`, panel `rgba(30,18,38,.97)`; reader `#1a1022 → #0c0712`. Brass is now `#c9a86a` (highlight `#ecd6a6`), paper/cream `#f4e6c4`/`#f8edd6`, oxblood accents retained. The green-leaning spine palettes were swapped for violet, aubergine, wine and mulberry slate; no green hex remains in the v4 room, scrim, furniture or reader chrome.

**Labels**: the coloured labels are back. Spine bands are `13 px` tall with the label colour as a solid background, cream label text (`--li`, 7.5 px / 700 sans), dark separation edge plus a 1 px brass outer ring; each band is the full spine width. Detail chips use the full label name, label colour background, cream text, 12.5 px, brass border. Measured text contrast on the labels: Essays 5.56:1, Crime 8.06:1, Gothic 9.4:1 (AA pass). Bands shrink to 6.9 px under 380 px so they never clip.

**Spine type**: titles are 9.6 / 10.2 / 10.8 px by spine width, weight 600, cream-gold `#f4e6c4`, tight tracking and a stronger dark shadow; authors are 7.4 px `#dfcda8`, max 60 px tall. Spine truncation now reserves room for title + author and was tuned to stop mid-glyph clipping on the narrowest 27 px spines.

**Back to shelf**: the detail panel opens with a 44 px brass-bordered **← Back to shelf** button at the top (the fixed × remains as secondary). In the reader, the bare arrow is now a labelled **← Shelf** control that tears down both reader and detail back to the wall; the reader × still closes only the reader. Both are visible without hover.

**Verified** (Playwright/Chromium, 390×844 and 360×844): no console errors, no horizontal overflow, all label bands/chips fit, no clipped spine titles/authors, detail back and reader back both reach the shelf, local and public URLs return 200.

## Navigation & acquisition flows — drawer + front desk (2026-11-24)

Throwaway `prototype/design/flows.html`, built on `shelf-v4.html` without modifying v4.

- **Drawer**: no tab bar. A small brass pull sits at the bottom centre; tap, drag it upward, or swipe up from a 30 px invisible edge strip. The rail carries Library / Search / Settings. Scrim tap, downward swipe on the rail, or Library closes it. A one-time brass hint ("Swipe up to open the drawer") shows after load and dismisses on the first interaction. Transform/opacity only, v4 easing, reduced motion collapses all of it.
- **Front desk**: Search slides a full-screen sheet with query + collapsible advanced fields (title, author, publisher, year range, language, format, ISBN) and 9 fake Libgen records, including Rock Paper Scissors / Alice Feeney / 2021 / EPUB / 2.1 MB / Libgen. A row opens a result sheet with generated cover, blurb, metadata, libgen.li + libgen.bz mirrors and the Download CTA.
- **Download**: in-sheet progress bar with percentage and Cancel (marks the queue item failed), then "Added to library". A brass badge in the search header shows active downloads and opens the running/completed/failed ledger (seeded with one of each).
- **New spine**: completion replaces the empty Shelf IV cavity with a real generated spine, a `NEW` band and a `1/10 · New` plate. "Return to shelf" closes the sheets, glides the shelf into view and re-runs the arrival glow. The masthead volume count increments.
- **Settings**: library folder + Rescan (fake completion toast), font-size stepper, reader theme, download naming, Export/Import, About.
- **Verified**: Playwright/Chromium at 390×844 and 320×700 — tap/swipe opens the drawer, downward swipe closes it, search filters, result and download complete, queue shows running/completed/failed, spine appears, detail + reader still work, no console errors, no horizontal overflow; local and public URLs return 200.
- **Rough**: queue history is seeded, settings toggles are cosmetic, and the drawer rail's live drag is pointer-only (no keyboard gesture equivalent; Enter/Space on the pull still opens it).
