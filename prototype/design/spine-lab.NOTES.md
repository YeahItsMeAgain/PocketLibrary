# Spine Lab — an Art face that carries type at 27–36 px

Throwaway UI prototype for the question:

> **How should an Art spine show a legible title, author and labels, plus reading and finished status, at 27–36 px wide?**

Open `prototype/design/spine-lab.html` directly, or serve it and use `?v=v0|s1|s2|s3|s4&cue=a|b|c&seal=a|b|c|d|e|f`. The page now opens on **`?v=s1&cue=a&seal=d`** — the chosen S1 binding with the gold head ribbon. The bottom switcher writes the same parameters to the URL. No build, no network, local assets only. This file is not production code; `prototype/design/NOTES.md` is the existing v4 shelf record and is untouched.

The short answer: **S1 Smoked leather** is the chosen binding. Its finished side is now **D, the gold head ribbon** (2026-11-28 update below): it keeps the art uncovered and full-height, passes worst-band contrast on all seven books (minimum 6.40:1), puts no ribbon in the title box, and reads as a ribbon rather than a sticker. The earlier S1 + set A record below is kept as the pre-note baseline. **S3 gilt plate** is the title-first alternative; **S4 cloth** is the fallback if shelf art is dropped; **S2 half-bound** is the most convincing binding and the clear failure at 27 px; **V0** is not shippable unchanged, because today's ribbon and seal overlap the title on five of seven books.

## Material and constants

- Case furniture is ported from `src/styles/wall.css`: crown, crest, cavity, panelled back, pilasters, lamp, 9 px lip, 18 px board, plate, 10 px plinth, carved brackets. The only omissions are the SVG turbulence noise and `filter: drop-shadow` on the crest, because this lab forbids filters and blend modes. The case is identical in every variant.
- Spine base, ribbon, seal, foot band and Art layout are ported from `src/styles/spines.css`; the title fit follows `fitSpineTitle` in `src/library/Shelf.tsx`.
- Seven books, in the given order and widths, heights 205–238 px:
  The Whisper Man 33×232 (finished), Ready Player One 29×214 (reading), The Shadow Friend 27×205 (reading), Everyone in My Family Has Killed Someone 31×226 (reading), The Collector 35×238 (finished), Needful Things 28×208 (unread), The Picture of Dorian Gray 30×219 (unread).
- The art is the real 52×236 engine strips at 2× (104×472) in `spine-lab-art/`, drawn with `object-fit: fill`. No text is generated into the art. **One strip is not fully text-free:** `ready-player-one.jpg` retains large cover lettering ("AL…", "FEE…") at the head. It is kept because it is the actual engine output, and it is evidence that the 4.5:1 residual-text check can let display lettering through. S2's window shows it most clearly; S1 turns it into a ghost; S3's plate hides only the title area; S4 drops it.
- Six stress spines at exactly 27 px: a 40-character title, the 18-character single word "Characteristically", an RTL Hebrew title, a book with no author, one with no labels, and one with no art (typographic fallback).
- The only layout deviation from the app is that the main row is centred (`justify-content: center`); `src/styles/wall.css` uses flex-start (the older `shelf-v4.html` prototype used space-between). With seven books the centred row reads as a deliberate shelf; the case, widths and heights are untouched.
- No CSS `filter`, `backdrop-filter`, `mix-blend-mode` or `background-blend-mode` anywhere: verified by scanning computed styles (0 offenders).
- All motion is transform/opacity; the only transition is a 1 px press on switcher buttons, and it collapses under `prefers-reduced-motion` (0 animations, 1e-06 s transition).
- The system serif stack is the app's (`Iowan Old Style → Palatino → Book Antiqua → Palatino → Hoefler → Georgia → Noto Serif`). These numbers are Linux Chromium metrics; Android Noto Serif metrics will differ slightly, as the v4 notes already warn.

## How the measurements were taken

The panel at the bottom of the page is generated from the live DOM after `document.fonts.ready`, at 390×844 unless stated. Every row prints:

- **W×H** — the spine's actual client size.
- **Title px** — the size `fitTitle` chose, after one column, balanced two columns, shrink-to-fit, never truncate. The fit is the app's algorithm with two lab fixes noted below.
- **Contrast median / worst** — title ink against its real backing. The art strips were sampled once into 64 vertical bands of median RGB over the central 71 % of the strip; the panel composites those bands with the scrim for S1, uses the plate colour for S3, the lightest end of the solid head for S2, the cloth `c1` for S4, and the raw art for V0. It reports the median band under the glyph run and the worst band. For V0 the ink is the app's adaptive choice: the same 16×64 median-luma sample and the 0.22 threshold.
- **Title bbox** — the glyph run's width × height (union of both columns), with three ticks: the text box is inside the spine, the run is inside the text box, and no status mark enters them. `✓` means all three.
- **Foot px** — the foot band/zone height and material (`band`, `scrim`, `tint`, `cloth`).
- **Gap / Δy** — the horizontal gap to the next book's foot and the vertical offset between their foot tops. This is the black-bar test. A 1 px gap with a shared near-black is the V0 problem.
- **Mark** — for V0 only, the mark's overlap with the title box / with the glyphs, in px. Elsewhere `—` means clear.
- **Gold** (D/E/F only) — the ribbon bbox, the gap to the title box, whether it enters the box or the glyph run, the gold base and sheen contrast against its actual backing (S1 composite for D/F, the shelf lip/board for E), and the relative luminance of the gold base, gold sheen and cream title.

The fit uses `maxFont = min(11.8, max(7, spineWidth × 0.34))`, a 92 % target for one column, 94 % per column for two, the app's 6.4 px readable floor and 2.8 px minimum. Two deliberate lab deviations from the current app:

1. **Column tracking is capped at 0.12 em.** The app tracks each two-column half to 94 % of the run, which can spread a short half into "M a n". The cap keeps a short half readable. The cap is why S2's short titles no longer look like letters dropped down the spine.
2. **A single 18-character word shrinks one column to fit.** The app's two-column code has no split for a single word and can return a run that overflows; the stress row caught this. This is a real fix to carry back into `fitSpineTitle`.

## V0 — today's 0.1.17 Art face (the control)

**Mechanism.** Art runs to the head; a 27 % near-black foot (`#1b140e → #090604`) with a gold hairline carries the full author over two balanced lines and up to two full-name chips at 4 px. The title box is a 1 px inset from 3 px to foot + 3 px (73 % of the spine). Ink is sampled from the strip (median luma > 0.22 → dark `#2a1a10`, else cream `#f4e6c4`) with a 1 px contrasting halo. Reading is the 8×38 saturated ribbon at the top right; finished is the 15 px gold seal at foot + 8 px.

| Book | W×H | Title px | Contrast med/worst | Title bbox | Foot px | Gap / Δy | Mark |
|---|---:|---:|---:|---:|---:|---:|---|
| The Whisper Man | 33×232 | 11.2 | 13.6 / 2.9 | 14.0×149.9 ✓ | 63 band | 1.0 / 4.9 | ✗ 15/14 |
| Ready Player One | 29×214 | 9.9 | 10.2 / 1.8 | 11.0×137.9 ✓ | 58 band | 1.0 / 2.4 | ✗ 35/28.8 |
| The Shadow Friend | 27×205 | 9.2 | 5.1 / 2.0 | 11.0×132.5 ✓ | 55 band | 1.0 / −5.7 | ✗ 35/29.4 |
| Everyone in My Family… | 31×226 | 10.5 | 8.2 / 3.1 | 21.9×149.5 ✓ | 61 band | 1.0 / −3.2 | ✗ 35/30.3 |
| The Collector | 35×238 | 11.8 | 2.5 / 1.6 | 14.0×154.5 ✓ | 64 band | 1.0 / 8.1 | ✗ 15/14 |
| Needful Things | 28×208 | 9.5 | 12.7 / 1.4 | 11.0×134.3 ✓ | 56 band | 1.0 / −3.0 | — |
| The Picture of Dorian Gray | 30×219 | 9.4 | 2.5 / 1.3 | 11.0×142.0 ✓ | 59 band | — | — |

**What V0 gets wrong — measured, not asserted.**

- **Worst-band contrast fails all seven**, from 1.34:1 (Dorian) to 2.94:1 (Whisper Man). Median contrast passes five of seven; Alice 2.5:1 and Dorian 2.5:1 fail even the median. The strip's central median is bright enough to choose dark ink (0.37 and 0.321), but the actual title region is dark and mottled. A 1 px halo cannot rescue a 1.3:1 backing. This is the core failure of "adaptive ink + halo" on real engine output.
- **The marks collide with the title on five of seven books.** The 38 px ribbon enters the title box on all three reading books and hits the glyphs by 28.8–30.3 px. The 15 px seal floats 8 px above the band and covers the last glyph of "The Whisper Man" ("n") and "The Collector" ("r") by 14 px. No title is truncated and every bbox is inside the spine, but the marks are painted over the type.
- **The foot bands form a near-black bar.** They are 55–64 px tall with 1.0 px gaps and vertical steps of −5.7 to 8.1 px. They do not technically touch, but the identical near-black makes the bottom of the shelf read as one strip.
- The ribbon is the only thing that says "reading" at 27 px; the seal is the only thing that says "finished". Both are recognisable, but both eat the title.

## S1 — Smoked leather (recommended)

**Mechanism.** The art is full height under a warm near-black scrim: `rgba(22,13,8,.64)` at the head to `rgba(14,8,4,.84)` at the tail, a plain linear gradient (no filter, no blend). Gold hairlines at head and tail. No foot band: the bottom 30 % is simply the darkest part of the scrim, and the author + chips sit on it. The title box is 10 px after a foot seal, 24 px after a head rule/roundel, or 28 px after a head ribbon, then to 70 %. The cream title has a 1 px soft shadow, not a halo. Contrast is fixed by the scrim; the art survives as texture, not as a picture. The scrim runs 64→84 %, a little past the 65–80 % guide at the tail: the extra depth is for the author and chips, while the title itself ends at 70 % where the scrim is about 76 %.

| Book | W×H | Title px | Contrast med/worst | Title bbox | Foot px | Gap / Δy | Mark |
|---|---:|---:|---:|---:|---:|---:|---|
| The Whisper Man | 33×232 | 11.2 | 15.1 / 9.5 | 14.0×136.1 ✓ | 70 scrim | 1.0 / 5.4 | — |
| Ready Player One | 29×214 | 9.9 | 8.4 / 7.2 | 11.0×108.5 ✓ | 64 scrim | 1.0 / 2.7 | — |
| The Shadow Friend | 27×205 | 9.2 | 9.0 / 6.4 | 11.0×103.0 ✓ | 62 scrim | 1.0 / −6.3 | — |
| Everyone in My Family… | 31×226 | 9.1 | 9.1 / 6.5 | 19.5×118.5 ✓ | 68 scrim | 1.0 / −3.6 | — |
| The Collector | 35×238 | 11.8 | 12.1 / 8.2 | 14.0×140.8 ✓ | 71 scrim | 1.0 / 9.0 | — |
| Needful Things | 28×208 | 9.5 | 14.3 / 8.5 | 11.0×121.4 ✓ | 62 scrim | 1.0 / −3.3 | — |
| The Picture of Dorian Gray | 30×219 | 8.5 | 13.2 / 9.8 | 10.0×128.0 ✓ | 66 scrim | — | — |

**Read.** All seven titles are inside, unclipped, and above 6.4 px; all seven pass 4.5:1 on the worst band, with the floor at 6.40:1 (The Shadow Friend, where the scrim is lightest and the strip is pale). No mark enters the title box. The foot has no band, so there is no bar. The art is recognisable at 390: the Whisper Man woman/door, the RPO orange, the Alice flowers. At 27 px it is texture and palette, which is the honest ceiling for a 64–84 % scrim.

**Cost.** The scrim removes 64–84 % of the art. S1's 30 % foot + head reserve gives smaller titles than V0 on unread books: Dorian 8.5 px vs 9.4 px, because V0 spends only 3 px above the title. The body of the spine is quieter and more uniform than V0; the cover art no longer carries the shelf's colour.

## S2 — Half-bound

**Mechanism.** A solid palette leather head (0–42 %) and foot (66–100 %), with the art confined to a framed 42–66 % window: 3 px reveal, a 1 px inset gold rule and a 0.6 px inner shadow. The title sits on the solid head; the author and chips sit on the solid foot. There is no type over art. The foot is 34 %, the tallest of the four.

| Book | W×H | Title px | Contrast med/worst | Title bbox | Foot px | Gap / Δy | Mark |
|---|---:|---:|---:|---:|---:|---:|---|
| The Whisper Man | 33×232 | 7.6 | 11.5 / 11.5 | 9.0×75.5 ✓ | 79 band | 1.0 / 6.1 | — |
| Ready Player One | 29×214 | 8.5 | 12.2 / 12.2 | 18.0×53.6 ✓ | 73 band | 1.0 / 3.1 | — |
| The Shadow Friend | 27×205 | 7.1 | 10.7 / 10.7 | 15.7×49.9 ✓ | 70 band | 1.0 / −7.1 | — |
| Everyone in My Family… | 31×226 | **4.5** | 12.6 / 12.6 | 9.2×58.3 ✓ | 77 band | 1.0 / −4.1 | — |
| The Collector | 35×238 | 10.3 | 9.0 / 9.0 | 12.0×78.3 ✓ | 81 band | 1.0 / 10.2 | — |
| Needful Things | 28×208 | 7.7 | 10.6 / 10.6 | 9.0×66.2 ✓ | 71 band | 1.0 / −3.7 | — |
| The Picture of Dorian Gray | 30×219 | 8.8 | 10.9 / 10.9 | 18.3×72.4 ✓ | 75 band | — | — |

**Read.** This is the most convincing piece of bookbinding on the shelf: a real framed art window, solid leather above and below, a gilt rule, no type over art, and per-book colour that breaks the bar. Short titles are 7.1–10.3 px and readable. Contrast is 9.0–12.6:1 because the title is always on solid leather.

**Failure.** The 40-character title at 31 px lands at **4.5 px**, below the app's 6.4 px floor; at 27 px the 40-character stress title is 5.8 px, the single word 5.0 px, the no-art fallback 5.4 px. The head simply does not have the run: 42 % of a 205–238 px spine minus a 28 px ribbon reserve is 48–78 px. Half-binding at 27–35 px works for short titles only; it needs a taller head (or no head reserve, i.e. cue B) before it can carry a 40-character title. Even with cue B (the drape, 10 px head reserve) the 40-character title only reaches 5.8 px.

The foot is 34 %, which pushes the author/labels up and makes the foot read heavier than the other variants; that is the half-bound look, not a bug.

## S3 — Gilt label plate

**Mechanism.** Art full height. A near-black plate (`#17100c → #221610`) runs from 24 px to foot + 3 px, with a double gilt rule (1 px gold, 1 px dark, 1 px gold) at 1–3 px inside its edge; the title runs inside the plate at 28 px to 70 %. The foot is 30 % and is a **per-book tint** (92–96 % of the book's `foot1/foot2`, so a hint of art remains), not one shared black. The title box is full-width and fixed at 28 px, so the plate composition does not change with status.

| Book | W×H | Title px | Contrast med/worst | Title bbox | Foot px | Gap / Δy | Mark |
|---|---:|---:|---:|---:|---:|---:|---|
| The Whisper Man | 33×232 | 11.2 | 14.3 / 14.3 | 14.0×119.6 ✓ | 70 tint | 1.0 / 5.4 | — |
| Ready Player One | 29×214 | 9.9 | 14.3 / 14.3 | 11.0×108.5 ✓ | 64 tint | 1.0 / 2.7 | — |
| The Shadow Friend | 27×205 | 9.2 | 14.3 / 14.3 | 11.0×103.0 ✓ | 62 tint | 1.0 / −6.3 | — |
| Everyone in My Family… | 31×226 | 9.1 | 14.3 / 14.3 | 19.5×118.5 ✓ | 68 tint | 1.0 / −3.6 | — |
| The Collector | 35×238 | 11.8 | 14.3 / 14.3 | 14.0×124.3 ✓ | 71 tint | 1.0 / 9.0 | — |
| Needful Things | 28×208 | 9.5 | 14.3 / 14.3 | 11.0×104.9 ✓ | 62 tint | 1.0 / −3.3 | — |
| The Picture of Dorian Gray | 30×219 | 7.4 | 14.3 / 14.3 | 9.0×111.3 ✓ | 66 tint | — | — |

**Read.** The most certain title on the shelf: 14.3:1 on every book, independent of the art, no collisions, no small type on the main shelf. The plate and double rule read immediately as a Victorian label. The per-book foot tints avoid the black bar; the foot is still a band (30 %) but it is not one black.

**Cost.** The plate covers the art from 24 px to 70 %; at 27 px the art is visible only at the head, in 2 px side gutters, and faintly through the 92 % foot tint. It is an **art spine with a label**, not an art-first spine. S3 also pays a fixed 28 px head reserve, so unread titles are smaller than S1 (Dorian 7.4 vs 8.5) even though the title contrast is better. If the user wants the plate look, this is the direction; if the cover art is the point, S1 wins.

## S4 — Publisher's binding

**Mechanism.** No art on the shelf. A woven cloth/leather board in the book's palette, double gilt rules at the head (19/19.7 px) and tail (23.3/24 px), foil title on solid cloth from 28 px to 70 %, full author in tracked small caps, and 4–5 letter label codes. The cover belongs to the detail view. There is no foot band; a gilt rule at 70 % separates the author zone.

| Book | W×H | Title px | Contrast med/worst | Title bbox | Foot px | Gap / Δy | Mark |
|---|---:|---:|---:|---:|---:|---:|---|
| The Whisper Man | 33×232 | 11.2 | 10.0 / 10.0 | 13.0×119.6 ✓ | 70 cloth | 1.0 / 5.4 | — |
| Ready Player One | 29×214 | 9.9 | 10.7 / 10.7 | 11.0×108.6 ✓ | 64 cloth | 1.0 / 2.7 | — |
| The Shadow Friend | 27×205 | 9.2 | 9.3 / 9.3 | 11.0×103.0 ✓ | 62 cloth | 1.0 / −6.3 | — |
| Everyone in My Family… | 31×226 | 9.9 | 11.0 / 11.0 | 20.3×118.5 ✓ | 68 cloth | 1.0 / −3.6 | — |
| The Collector | 35×238 | 11.8 | 7.8 / 7.8 | 14.0×124.2 ✓ | 71 cloth | 1.0 / 9.0 | — |
| Needful Things | 28×208 | 9.5 | 9.3 / 9.3 | 11.0×104.8 ✓ | 62 cloth | 1.0 / −3.3 | — |
| The Picture of Dorian Gray | 30×219 | 8.1 | 9.5 / 9.5 | 10.0×111.3 ✓ | 66 cloth | — | — |

**Read.** The most legible type of the four after S3 (7.8–11.8 px, 7.8–11.0:1), the cleanest shelf, and the natural home for the existing Cloth style. It has no art, so it is not an answer to "how should an Art spine…" except as the honest fallback the ADR already keeps. It is also the cheapest to paint: no image, no scrim, no plate.

## Binding comparison

| | V0 | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|
| Art on the shelf | full, raw | full, smoked | framed window | full, behind plate | none |
| Title box height (px) | 132–155 | 103–141 | 50–78 | 103–124 | 103–124 |
| Title px (7 books) | 9.2–11.8 | 8.5–11.8 | **4.5**–10.3 | 7.4–11.8 | 8.1–11.8 |
| Worst contrast, min | **1.34** | **6.40** | 8.96 | 14.25 | 7.83 |
| Titles ≥4.5:1, worst / median | 0 / 5 | 7 / 7 | 7 / 7 | 7 / 7 | 7 / 7 |
| Titles <6.4 px | 0 | 0 | **1** | 0 | 0 |
| Mark collisions (box / glyph) | **5 / 5** | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Foot material | 27 % black band | 30 % scrim | 34 % solid | 30 % tint | cloth |
| Foot bar? | **yes, shared black** | no band | per-book | per-book | no band |

Every variant has 7/7 titles inside the spine and inside the text box, no clipping and no truncated labels. The only failures are V0's contrast/marks and S2's title size on the long book.

## Status cues

The switcher separates the reading cue and the finished seal, so all nine combinations were measured. Every combination on S1 is 7/7 inside, 7/7 at ≥4.5:1, 0 mark collisions, 0 clipped titles. The difference is **title cost** and **author cost**.

| Set | Reading mark | Head reserve | Finished mark | Head reserve | Author |
|---|---|---:|---|---:|---|
| A | 8×26 oxblood ribbon, notched tail | 28 px | 11 px brass medallion centred above the author | 10 px | 6.2 px, full |
| B | ribbon tail hangs over the lip and board | 10 px | 10 px brass medallion beside the author, with a gilt tie | 10 px | **4.2 px, clipped** |
| C | 2 px oxblood/gilt head rule | 24 px | 15 px embossed gilt ring + hairline | 24 px | 6.2 px, full |

Measured on S1, cue A vs B vs C (finished seal A):

| Cue | Family title px | Family title box | Family worst contrast | Hound title box | Hound worst contrast |
|---|---:|---:|---:|---:|---:|
| A ribbon | 9.07 | 118.5 | 6.50 | 103.0 | 6.40 |
| B drape | **10.37** | **135.4** | 6.50 | **119.5** | 5.61 |
| C rule | 9.37 | 122.3 | 6.50 | 106.8 | 6.07 |

The drape reclaims 18 px of run because it does not need a head band; that is worth +1.3 px on the 40-character family title. It also lowers the worst contrast on the reading books (5.61 on Hound vs 6.40 for the ribbon) because the run now reaches the lighter head of the scrim. Still above 4.5.

**Set B's finished treatment fails the author.** Beside the 10 px medallion the author column is 11–13 px wide at 33–35 px spines. `fitAuthor` drops to the 4.2 px floor and the measured `scrollWidth` still exceeds `clientWidth` on all four finished spines (Whisper Man 13 vs 11, The Collector 15 vs 13, both stress finished books too). The foot clips it. The medallion is honest; the author is not.

**Set C's finished roundel costs 13 px of title.** The finished title boxes fall from 136.1/140.8 (seal A) to 123.2/127.9 (seal C) on Whisper Man/The Collector. Whisper Man's worst-band contrast rises from 9.47 to 11.81 because its run starts lower in the darker scrim; The Collector's stays 8.19. The 2 px reading rule is the quietest mark at 27 px and the easiest to miss at a glance; the roundel is distinct but reads a little like an eyelet.

All three sets are distinguishable without colour: a notched tab at the head, a tail over the board, and a thin line; a filled disc above the author, a disc beside the author, and a hollow ring. At 27 px the shapes survive; the 2 px rule is the weakest. The new finished-only **D/E/F** gold ribbons are measured in the 2026-11-28 section below; the a/b/c record here is unchanged.

## Stress row (S1, cue A/seal A)

| Spine | W×H | Title px | Contrast med/worst | Title bbox | Foot | Gap / Δy |
|---|---:|---:|---:|---:|---:|---:|
| Forty Characters Make A Long Spine Title (40) | 27×232 | 9.2 | 12.1 / 8.2 | 19.6×139.2 ✓ | 70 | 1.0 / 6.6 |
| Characteristically (18-char word) | 27×210 | 9.2 | 14.3 / 9.1 | 11.0×105.8 ✓ | 63 | 1.0 / −3.6 |
| השם של הוורד (RTL) | 27×222 | 9.2 | 13.1 / 9.8 | 11.0×113.1 ✓ | 67 | 1.0 / 6.6 |
| The Book With No Author | 27×200 | 8.0 | 8.4 / 6.5 | 10.0×115.9 ✓ | 60 | 1.0 / −4.2 |
| The Book With No Labels | 27×214 | 8.8 | 12.1 / 8.2 | 10.0×125.2 ✓ | 64 | 1.0 / 2.4 |
| The Book Without Any Art (fallback) | 27×206 | 7.0 | 10.6 / 10.6 | 9.0×103.0 ✓ | 62 | — |

All six are inside, unclipped, ≥6.4 px, above 4.5:1, with no mark collision and no truncated label. The 40-character title is the proof that S1's two-column mode is the reason the bottom half of the shelf is usable: it gets 9.18 px in two columns on a 27 px spine. The 18-character word also gets 9.18 px; it never truncates. The no-author book loses its author row and the foot just centres the chip. The no-art book is the documented typographic fallback: palette cloth, cream title, chips, ribbon, 7.0 px. The RTL title fits and the Hebrew author is mirrored in the foot, but the glyphs are rotated with the vertical run (see limitations).

## Recommendation

**Binding: S1 Smoked leather.** It is the only direction that keeps the art visually full-height (uncovered) while solving legibility: a fixed 6.4:1 floor across these seven strips, no mark collisions, no band bar, no new plate. S3 also passes, but its plate covers most of the art; S2 keeps a window; S4 drops art. It also costs nothing in furniture or new data. The price is honest: the art becomes texture, the shelf loses the bright cover colours, and unread books get 8.5 px rather than 9.4 px because S1 pays for its head/foot.

The default is now `?v=s1&cue=a&seal=d` (gold D); set A remains `?v=s1&cue=a&seal=a`, and the mixed reading-B/finished-A version is `?v=s1&cue=b&seal=a`. **2026-11-28 update:** the finished side has moved to the gold ribbon; see “Finished as a gold ribbon” below. The earlier **status set A** record (head ribbon + foot medallion) is kept for comparison. **Status: set A** (head ribbon + foot medallion) for a coherent shipping set. It keeps the full author at 6.2 px, keeps the finished title at 136/141 px, and has zero collisions. It costs 18 px of title on reading books. If the user is willing to mix the axes, the strongest measured combination is **reading B + finished A**: the drape gives the title its 18 px back (family 9.07 → 10.37) and the foot medallion leaves the author alone. The drape's cost is three ribbon tails over the board; at 390 with three reading books it is noticeable, but it is the clearest "reading" silhouette at 27 px.

**Second choice: S3 gilt plate** if the user wants a label-forward shelf and title certainty over art. It is 14.3:1 on every title, all main titles ≥7.4 px, and per-book foot tints break the bar. The plate covers most of the art; that is the trade.

**S4 cloth** is the right fallback when art is absent or not wanted; it is the clearest type of all and exactly the existing Cloth style. **S2 half-bound** should not be chosen for 27 px general shelving: the 40-character title is 4.5 px and even the stress 18-character word is 5.0 px. It would work at ≥31 px spines or with short titles only. **V0** should not ship unchanged: five of seven books have a mark over the title, and the worst-band contrast fails every book.

## Finished as a gold ribbon — 2026-11-28 update

The user picked S1 and asked: “s1 is great, maybe let's try it with a golden ribbon instead of a sticker.” S1 is unchanged — same scrim, gold hairlines, title-box rules, no foot band, same authors/chips. Only the finished treatment is new. The page now opens on `?v=s1&cue=a&seal=d`; the earlier V0/S1/S2/S3/S4 record above is at its original states.

**D — Head gold ribbon.** 8×26, top right, inside the same 28 px head band as reading cue A. Brass gradient `#8a6a2e → #b08d4a → #d2ac62 → #f0dcae → #d2ac62 → #8a6a2e`, a 1 px `#3a280f` edge, a notched swallowtail, and a 2 px inner sheen down the left edge. No filter or blend. The title box runs 28 px to 70 %.

**E — Tail gold ribbon.** 8×16 visible: 2 px at the foot of the spine and 14 px over the lip/board, in the same drape placement as reading cue B. No head mark, so the title box stays at 10 px to 70 %. The tail does not touch the type.

**F — Head gold tuck.** 8×14, top right, tucked under the head edge with a 2 px fold shadow and no notch. Title box 16 px to 70 %.

| Finished | Ribbon bbox | Head reserve | Title bbox height, Whisper / Collector | Title px | Title contrast (med/worst) | Gold base vs backing, worst (Whisper / Collector) | At 27 px |
|---|---|---:|---:|---:|---:|---:|---|
| A medallion (old) | 15 px foot | 10 px | 136.1 / 140.8 | 11.2 / 11.8 | 15.1/9.5, 12.1/8.2 | — | — |
| D head gold ribbon | **8×26** | 28 px | 119.6 / 124.3 | 11.2 / 11.8 | 15.2/11.8, 11.9/8.2 | **5.48 / 7.00** | 8×26, 7.06 |
| E tail gold ribbon | **8×16** | 10 px | 136.1 / 140.8 | 11.2 / 11.8 | 15.1/9.5, 12.1/8.2 | **5.35 / 5.35** (board) | 8×16, 5.35 |
| F head gold tuck | **8×14** | 16 px | 130.6 / 135.2 | 11.2 / 11.8 | 15.2/11.5, 12.1/8.2 | **5.98 / 7.15** | 8×14, 7.15 |

All figures at 390×844, S1, cue A, on the two main finished books; the 27 px column is the stress-row finished pair (st-long 8×26/7.06 and st-nolabels 8×26/7.0 for D; both 5.35 for E; both 7.15 for F). Title contrast is unchanged or slightly better than seal A because the run starts lower in the darker scrim.

**Ribbon vs title box — clear.** D and F sit 2.0 px above the title box; E is 71.6 / 73.4 px below it (below the spine foot). The measured `boxHit` and `runHit` are 0 for every finished book at 390 and 27 px. The title box containment proof is unchanged and still 7/7.

**Ribbon vs the gold hairlines at 27 px.** The S1 head hairline is a 1 px line at 7–8 px. D is 8×26 with a 1 px `#3a280f` edge and a notched tail: at 27 px it is 30 % of the spine width and 26 px tall, so the silhouette separates even where the hairline crosses its top. F is also 8 px wide but only 14 px tall and has no notch; it reads as a small gilt tab rather than a ribbon, and is the least separated. E never meets a head hairline — it is 14 px below the spine, over the board.

**Gold, not cream.** The base is `#d2ac62` (relative luminance **0.441**), the sheen `#f0dcae` (**0.728**), the title cream `#f4e6c4` (**0.798**). The base and the 1 px dark edge own the 8 px width; the sheen is only 2 px. At 27 px and at 390 the ribbon reads brass/gold; the sheen is the only cream-adjacent value, and it is not enough to turn the mark cream. The 2× close-up (`s1-gold-d-closeup.png`) shows this on the dark Whisper art and the pale Collector art.

**Scope.** Gold is an S1 mark. D/F sit on the head art; with S1's 64–84 % scrim their worst gold base contrast is 5.48:1 and 5.98:1. On S3 or V0, where the head art is unscrimmed, the same gold base falls to 1.70–3.86:1 against the strip (measured when those bindings are combined with D/F), so D/F should be scoped to S1 — or to S2/S4 where the head is solid — unless a plate/scrim is added. E is unaffected because its backing is the shelf lip/board (5.35:1). The gold section is therefore a validation of the chosen S1 binding, not a universal seal.

**Status pairing.** D and reading cue A share the same 8×26 head geometry by design. In the default `cue A + seal D` shelf the two ribbons differ by gold's much higher luminance (0.441 vs the dark oxblood) and the bright sheen/edge, not by shape. The requested `s1-gold-d-cue-b.png` shows the strongest pairing: gold at the head, oxblood at the foot, so position and colour both carry the status. If status must be shape-coded, use reading B with D.

**Ship D.** It is the only one that reads as a ribbon at 27 px: notched swallowtail, 26 px of gold, 1 px dark edge, 5.48:1 minimum against the art-scrim backing, no title collision, and all seven titles still ≥6.4 px and ≥4.5:1. Its cost is 16–17 px of finished title run (136→120, 141→124), visible only as less tracking on the two finished books because the type stays at 11.2/11.8. **E** is the title-friendliest second choice (no head cost, 5.35:1 over the board) but only 16 px at the shelf edge; it is the one to take if the head must stay clean. **F** is the cheapest at 16 px but reads as a gilt tab, not a ribbon; do not ship F as the primary finished cue.

## Honest trade-offs at 27 px

1. **The title is the only thing that is truly legible.** Authors are 4.2–6.8 px (6.2 px in S1/S3/S4; 4.2 px and clipped in seal B). Labels are 5 px four/five-letter codes in S1–S4; V0's full names are 4 px. At 27 px, the author is a signature and the labels are colour + a short code, not reading copy. The brief asks for "legible title, author and labels"; the title is; the author is only just; the labels are codes.
2. **S1's 64 % scrim is at the limit.** The worst measured contrast is 6.40:1 on The Shadow Friend's pale art. A 60 % scrim would drop below 4.5 on that book. The tail is 84 %, slightly past the 65–80 % guide, to keep the author/chips legible; the title ends at 70 % (~76 % scrim). Do not lighten either end without re-measuring the strip, not the palette.
3. **S2 is the most beautiful and the least usable.** Its head is 42 % of a 205–238 px spine; after a 28 px ribbon reserve the 40-character title gets 48–78 px and 4.5 px type. It needs a taller head or a wider spine. The framed window is worth keeping for short titles.
4. **S3 covers the art.** The plate runs from 24 px to 70 %; at 27 px the art is a head sliver, two 2 px gutters, and a 92 % foot tint. The double rule costs 3 px of side width, which is why the text area is 21 px at 27 px and only two columns at 9.18 px fit.
5. **The app's two-column tracking is risky.** The lab caps column tracking at 0.12 em; without the cap, S2 produced "M a n" (a short half spread to 94 % of the run). If the app keeps the current tracking rule, long titles in the half-bound/plate layouts will look worse than these screenshots.
6. **The app's fit has no single-word path.** The 18-character stress word exposed it: the app's two-column branch returns a run that does not fit when `splitBalanced` returns null. The lab shrinks one column instead. This is a concrete fix to carry into `fitSpineTitle`.
7. **One-column preference leaves type on the table.** The app only splits when one column would fall below 6.4 px. On S1's 30 px Dorian spine that produces 8.5 px one column; two columns at ~10 px would be more legible but change the run. A future rule could split below 8 px for 27–31 px spines.
8. **RTL is measured, not designed.** The Hebrew title fits and the foot mirrors, but the glyphs are rotated with `writing-mode: vertical-rl; text-orientation: mixed`. A Hebrew reader should review the spine convention; the app's RTL direction detection is not exercised by this vertical renderer. The fit and containment are correct.
9. **The foot-bar problem is a colour problem, not a gap problem.** Every variant has 1.0 px gaps. V0's bands read as one bar because they share one near-black and their tops step by −5.7 to +8.1 px. S2/S3/S4 use per-book colours and read as separate bindings; S1 has no band. If V0 keeps its band, tint it per book or align its top across the shelf.
10. **The adaptive ink threshold is not enough.** V0 chooses dark ink on Alice and Dorian from a median of 0.37/0.321, but the actual title regions are dark and mottled: 2.5:1. A 1 px halo cannot fix a 1.3:1 backing. Art spines need a scrim or a plate; sampling alone is not a solution.
11. **The shelf is seven books in a case sized for a full row.** The row is centred; `wall.css` uses flex-start. The plaque says "7 volumes", not "Full", because the case is not full. The extra space is honest, but a real shelf with seven books would show it too.
12. **One strip still has cover lettering.** `ready-player-one.jpg` keeps "AL…"/"FEE…" at the head. At 29 px it is a ghost under S1's scrim and a clear graphic in S2's window. The 4.5:1 residual-text gate passes it, so "text-free" is not guaranteed for display type; S1/S2 make that visible, S4 is the only direction that removes it. If the engine cannot guarantee text-free strips, the shelf needs a scrim/plate strategy, not adaptive ink.
13. **Chromium/Linux metrics.** The numbers are from Chromium with the system serif fallback. Android's Noto Serif will shift advances and could push a title from one column to two or change a 6.4 to a 6.2. Re-measure on the device before fixing a threshold.

## Verification (2026-11-28)

Server: `python3 -m http.server 8771` from the worktree root; page at `http://127.0.0.1:8771/prototype/design/spine-lab.html`.

Playwright/Chromium, 390×844 @ dpr 3 unless stated:

- Console errors: none on any captured state. No horizontal overflow at 320, 390 or 430.
- All 7 main titles in every captured variant and cue/seal combination, and all 6 stress titles at S1 (and in the measured S2/S3/S4 rows), are inside the spine and the title box, unclipped, with no truncated labels.
- Worst-band contrast ≥4.5:1 on all 7 main titles for S1–S4 (S1 minimum 6.40, S2 8.96, S3 14.25, S4 7.83). V0 is the control and fails: 0/7 on the worst band, 5/7 on the median, 5/7 mark collisions (5 on glyphs). This is reported as the finding, not asserted as a pass.
- Mark collisions in the title box: 0 for every S1–S4 cue/seal combination; 5 for V0 A/A.
- Title sizes below 6.4 px: S1 0, S2 1 main (4.47) + 3 stress, S3 0, S4 0, V0 0.
- Author columns clipped: seal B 4/4 finished (4.2 px floor); seal A/C 0.
- CSS filter/blend scan: 0 offenders (`filter`, `backdrop-filter`, `mix-blend-mode`, `background-blend-mode` all absent).
- Reduced motion: 0 running animations, button transition 1e-06 s.
- `file://` double-click: all 24 `<img>` elements load, the lab initialises, clicking S1 → B → C updates the URL and the measurements, no overflow.
- URL round-trip: `?v=s1&cue=b&seal=c` on load and after switching; `history.replaceState` is guarded for `file://`.
- 320×568 and 430×932 of S1: 7/7 inside and 7/7 contrast, no overflow.
- **Gold pass (2026-11-28):** no console errors, no page overflow. D/E/F each 7/7 inside and 7/7 ≥4.5 on the worst band; gold bbox exactly 8×26 (D), 8×16 (E), 8×14 (F); title gap 2.0 px for D/F and 71.6/73.4 px for E; `boxHit`/`runHit` 0. Gold base contrast vs its actual backing: D 5.48:1 worst (Whisper) and 7.00:1 (Collector); E 5.35:1 over the board; F 5.98:1 and 7.15:1. At 27 px the finished stress pair measures 8×26/7.06 (D), 8×16/5.35 (E), 8×14/7.15 (F). Gold base L 0.441 vs cream 0.798. Default page opens `?v=s1&cue=a&seal=d`; close-up 3 groups / 6 clones / 2 D marks / 2 F marks / 2 E tails; 320×568 seal D passes; `file://` default and switches still work.

Screenshots in `prototype/design/screenshots/spine-lab/`:

`v0.png`, `s1.png`, `s2.png`, `s3.png`, `s4.png` (390×844, cue A/seal A); `cue-a.png`, `cue-b.png`, `cue-c.png`, `seal-a.png`, `seal-b.png`, `seal-c.png`; `s1-cue-b-seal-b.png`, `s1-cue-c-seal-c.png` (full set views); `stress-row.png` (element, 3×); `s1-320x568.png`, `s1-430x932.png`; `v0-measurements.png`, `s1-measurements.png`, `s2-measurements.png`, `s3-measurements.png`, `s4-measurements.png`; **gold update:** `s1-gold-d.png`, `s1-gold-e.png`, `s1-gold-f.png`, `s1-gold-d-cue-b.png`, `s1-gold-d-closeup.png` (520×680, 2× CSS), `s1-gold-d-320x568.png`, `s1-gold-d-measurements.png`.

The measured JSON is in the page's `window.__lab` (`rows` + `summary`) and in the temporary verification script used to produce this note; the panel itself prints the same numbers.

## Files

- `prototype/design/spine-lab.html` — the one-file prototype (markup, CSS, JS, embedded art samples).
- `prototype/design/spine-lab-art/*.jpg` — the eight real engine strips, untouched.
- `prototype/design/screenshots/spine-lab/*.png` — the captures above.
- This note. `prototype/design/NOTES.md`, `src/**`, `core/**`, `docs/**` and `package.json` were not touched.
