# Reader controls — throwaway prototype notes

**Question:** how should a reader reach type / theme / contents settings without chrome hiding the text?

Open `prototype/design/reader-controls.html` directly (double-click works; tested over `file://`) or serve the worktree and visit:

```
python3 -m http.server 8772
http://127.0.0.1:8772/prototype/design/reader-controls.html?v=r1&flow=reflow
```

The bottom bench is prototype chrome, not part of any design. It switches direction (`R1 ›`), flow (`FLOW REFLOW / OVERLAY`), EPUB/PDF, and runs `Check`. The full state is always printed on the bench: direction, flow, theme, size, spacing, margin, mode, progress and page.

Useful URL parameters: `v=v0|r1|r2|r3`, `flow=reflow|overlay`, `theme=paper|sepia|night`, `size=0..4`, `spacing=0..2`, `margin=0|1`, `mode=paginated|scrolled`, `font=garamond|literata|source-serif`, `pdf=1`, `page=1..24`, `zoom=0.5..2.5`, `sheet=type|contents|marks|page`, `bars=1`, `coach=0`, `pct=0..100` (start at a reading percentage), `start=n` (start at a page).

No webfonts, network calls, filters or blend modes. Only transform/opacity transitions; `prefers-reduced-motion` collapses durations. State is in memory only.

> **Current state — Revised R1:** the R1 reading desk has been revised per the approved direction below. It is 48dvh, the brass pull and the percentage are the only ways in, swipe-down closes, and the sheet is redesigned as a reader's desk. See **“Revised R1 — reading desk (current)”** after the shared setup. The V0–R3 sections and the first Recommendation are kept as the first-round record.

## Shared setup

- The book is the release sample prose (“The lamp was lit before the rain began…” / “This file exists only to test PocketLibrary’s storage access…”) repeated through six chapters. At 390×844 / 19px / 1.6 / 26 it is 8 pages; at 320×568 it is 15; at 430×932 it is 6.
- The three palettes are the exact `READER_THEMES` values from `src/reader/settings.ts`: Paper `#f5eedc/#2c2418/#7a5b2c`, Sepia `#e8d7b4/#3b2b17/#76512a`, Night `#12100e/#d6c7aa/#c9a86a`.
- Fonts are the exact families from `READER_FONTS` (EB Garamond, Literata, Source Serif 4) followed by local serif fallbacks. **Caveat:** no webfonts are loaded, and this Linux Chromium has none of the three families installed, so all three render through a local serif. The prototype proves the live wiring, not the final glyph widths. Android WebView may also lack them; production should bundle them.
- Every direction reserves a visible band at the bottom of the reading stage. Chrome is never floated over a text line: bars are bands, the R1/R2 docks are rows below the stage, and the overlay sheet clips the stage at the dock line.
- Tap targets are 44×44 minimum in R1–R3. V0 is deliberately left at today’s 38px top-bar targets.
- Esc, browser/Android back, the scrim, the close button and Shelf all close the sheet. ArrowLeft/ArrowRight page in paginated mode. The sheet traps Tab and restores focus.
- Layout preserves the **reading percentage**, not the page index. At 57% of the old pagination, opening or closing the sheet returns to 57% of the new pagination.

## Revised R1 — reading desk (current)

The approved direction. Today's top and bottom bars are gone for good; there is no `Aa` tab, no swipe-up handle, no dock gesture. The only two ways into settings are the brass drawer pull at bottom centre and the percentage at bottom right. The page is clean when the desk is closed.

### What changed

- **Sheet height 48dvh** (was 56dvh), applied to the CSS variable and to every reflow/overlay stage calculation in `applyChrome`. The sheet still has its brass top edge, paper face, grip, shadow and a safe-area-aware summary footer.
- **One entry point, two targets.** The pull and the percentage both call `showSheet`. Removed: the dock swipe-up, ArrowUp, the stage swipe-up, any `Aa`. The pull is the library's own drawer plate — 56×20 brass oval, dark slot, two screws, top highlight, inner and drop shadows — inside a **76×44** target. The percentage is a **44×44** button, right-aligned in the 44px dock band. The progress hairline stays at the very bottom; a 1px inset hairline seats the band.
- **Sheet rebuilt as a desk, not a form.**
  - 18px grip zone: 46×4 brass grip bar and a “Swipe down to close” hint at the right, 8px small caps, opacity fade after the first successful swipe.
  - Header: book title in the display serif (13.5px italic), percentage and page in 8px small caps beside it, Shelf as a quiet brass text action, a 44px close cross, and a thin brass rule underneath. Under 360px the Shelf label collapses to its arrow so the title keeps its measure.
  - Tabs: TYPE / CONTENTS / MARKS in 8.5px small caps; the active tab carries a small oxblood hanging ribbon (9×11) rather than a generic underline. PDF swaps TYPE for PAGE.
  - Reading mode: one compact two-state brass toggle, 44px high, with a sliding brass knob (`transform` only).
  - Size: a −/Aa/+ stepper with 44px ends and a live specimen at the chosen size, in the chosen face; the caption prints `19 px`.
  - Spacing: three previews whose ruled lines are spaced in proportion to 1.35 / 1.6 / 1.95, not words in boxes. Under 360px the spacing/margins row stacks so the 8px captions keep their measure.
  - Margins: two miniature pages whose text block is inset 8% / 18%, so Narrow vs Wide is visible at a glance.
  - Typeface: three specimen rows, each showing the book's first line (“The lamp was lit before the rain began.”) in its own face, with a small-caps name; the selected row gets a brass left rule.
  - Theme: three 44px paper swatches with the theme name printed on the paper in its own ink; the selected swatch gets a brass inset ring. Night stays dark.
  - Footer: a quiet ledger line — `19px · Normal · Narrow · Garamond · Paper` — replacing the explanatory prose. In PDF: `PDF · Fit width · Paper`.
  - Contents page numbers now derive from the current pagination (1, 4, 8, …), and the current chapter keeps a brass left rule.
- **Swipe down closes.** See the behaviour section below.
- **Closed state** is now the brass plate + small-caps percentage + progress hairline on a paper band; it reads as desk furniture, not a debug control.

### Measurements (48dvh)

| | 390×844 | 320×568 | 430×932 |
|---|---|---|---|
| sheet height | **405.1px** | **272.6px** | **447.4px** |
| body height / scroll height | 266 / 355 | 134 / 418 | 308 / 355 |
| closed stage | 736 | 460 | 824 |
| open reflow stage | 331 | 187.4 | 376.6 |
| closed pages | 8 | 15 | 6 |
| open reflow pages | **18** | **42** | **14** |
| visible lines, closed / open reflow / open overlay | 21 / 9 / 9 | 12 / 3 / 5 | 23 / 10 / 11 |
| min tap target | 44 | 44 | 44 |
| chrome × text overlaps, closed / open | 0 / 0 | 0 / 0 | 0 / 0 |
| document horizontal overflow | none | none | none |

The exact stage figures: at 390 the dock band is 331–375 and the reflow stage is 331px; at 320 the dock band is 187.4–231.4 and the stage is 187.4px; at 430 the dock band is 376.6–420.6 and the stage is 376.6px. (The sheet is 48% of the 844/568/932 viewport, and the bench takes 64px of the page.)

At 320×568 the sheet body is only **133.6px** tall. Reading mode, the size stepper and all three theme swatches are above the fold — measured — with the summary footer still visible. Spacing, margins and the typeface rows scroll; the secondary spacing/margins row stacks at this width so the captions fit. At 390 all of mode/size/theme/spacing/margins are above the fold and the typeface list starts in view; at 430 two typeface rows are visible and the third needs a small scroll.

The title is full at 390 (180px) and truncates to “The Lamplighter'…” at 320 (129px available). Text measure at 320 is unchanged at 268px ≈ 25 characters, because the reading margins did not move.

### Swipe behaviour

- Drag targets: the sheet grip and header, or the body **only while `sheetBody.scrollTop === 0`**. Dragging a scrolled body scrolls it normally; return to the top to dismiss.
- The sheet follows at **0.85 × finger distance** (a 100px drag shows 85px of travel) with no transition while dragging. The scrim fades with the drag from 1 down to 0.08.
- Dismiss if **vertical travel ≥ 64px**, or if travel is > 16px and the last-150ms velocity is **≥ 0.35px/ms**. Otherwise it springs back to 0 over the normal 0.24s `transform` transition. Only downward travel starts a drag; upward travel is left to the body's scroll.
- Pointer events handle mouse/pen; touch events handle touch, and `preventDefault` on an active downward `touchmove` takes the gesture away from the scroller. A drag that starts on a button suppresses that button's click; a normal tap never does.
- Scrim tap, Escape, the close cross, Shelf and Android/browser back still close. The first successful swipe also fades the hint and sets the in-memory “seen” flag.
- Verified with mouse and synthetic CDP touch: 100px header drag closes; 30px slow drag springs back; 100px on the body at scroll top closes; the same drag on a scrolled body does not; a drag starting on the mode switch closes without changing the mode.

### Screenshots (390×844 at dpr 3 unless named)

- `r1b-closed.png`, `r1b-open.png`
- `r1b-night.png`, `r1b-largest.png`
- `r1b-contents.png`, `r1b-marks.png`
- `r1b-swipe-mid.png` (mid-drag at 85px of travel), `r1b-swipe-closed.png`
- `r1b-320x568-closed.png`, `r1b-320x568-open.png`
- `r1b-430x932-open.png`
- `r1b-open-overlay.png` (extra: the scrolled/PDF flow)
- `r1b-check-report.png`, `r1b-pdf-page.png` (extra: the Check report and the PDF PAGE tab at 125%)

### Known rough edges (revised R1)

1. **Reflow still re-lays out the book**, though less violently: 8→18 pages at 390, 15→42 at 320 (was 8→24 and 15→72 at 56dvh). The percentage is preserved; the page number is not. Overlay still hides the lower page (9 painted lines at 390).
2. **320 is still a tight sheet.** The primary three groups fit, but spacing, margins and the whole typeface list require scrolling inside a 134px body. The header title truncates and Shelf is arrow-only below 360px.
3. **The hint is per-session.** Reloading shows it again, and it only retires after a swipe — a reader who closes by scrim/close sees it every time.
4. **Touch was verified with synthetic Chromium touch events.** Real Android WebView / iOS gesture arbitration around the scrollable body still deserves a device pass.
5. **Fonts remain unproven.** All three faces still fall back to local serifs on this Linux box; the specimen rows prove the live wiring, not final glyph widths.
6. **The pull is still a physical metaphor, not a label.** The percentage is the only alternative entry. This is the approved decision, not an open question; keep the accessible name “Open the reading desk”.
7. **V0/R2/R3 are comparison scaffolding.** They remain in the file and are never visible in R1; R1 has no secondary affordance.

## V0 — today (baseline, not a candidate)

Hidden: full page, 3px progress line, faint 0% pill bottom-right, nothing else. Revealed by centre tap: gradient top bar (`← Shelf / Contents / 0% / Open in another app`) and bottom bar (`Aa Type / ◐ Paper / ▽ Bookmark`) floating over the page. The top-bar buttons are 38px high, straight from `reader.css`.

Measurements at 390×844, 19px:

- Closed: 0 chrome/text overlaps, but no visible cue beyond the 0% pill.
- Revealed: **2 text lines / 2 pairs** under the translucent gradient top bar (the chapter kicker and title); the bar is 48px high.
- Minimum tap target revealed: **38×38px** (three top-bar buttons).
- Sheet open (if you use the Aa button): 0 overlaps; the sheet itself works.

This is the state the ticket describes: there is no discoverable settings path in the hidden state, and once revealed the bars are a translucent layer over the page rather than part of it.

## R1 — Reading desk (first round, superseded)

> The first-round R1 is kept for comparison. The current R1 is **Revised R1** above: 48dvh, no Aa, swipe-down close, redesigned sheet.

**Structure:** no top or bottom bars, ever. A persistent 3px progress line at the bottom, a 44×18 brass pull centred above it (44×44 hit target) and the percentage. Tap the pull, swipe up on the dock (or the page in paginated mode), or press ArrowUp/Enter to open a 56dvh sheet. The sheet header carries Shelf, the book title, %/page and close; tabs are Type / Contents / Marks, plus Page in PDF mode. Type exposes 5 sizes, 3 spacings, 2 margins, 3 typefaces, 3 themes and 2 reading modes, all applied live. Contents highlights the current chapter; Marks has three fake bookmarks.

**Measurements (390×844):**

| | closed | sheet open, reflow | sheet open, overlay |
|---|---|---|---|
| chrome/text overlaps | 0 | 0 | 0 |
| visible text lines | 21 | 6 | 8 (clipped) |
| pages | 8 | 24 | 8 |
| stage / page height | 736 / 702 | 263 / 229 | 736 / 702 (clip at 264) |
| text moved | — | **yes** (repaginated) | **no** |
| min tap target | 44 | 44 | 44 |
| text measure @320 | 268px · ≈25 chars | same | same |

At 57% (page 5/8) opening the sheet lands on page 14/24, still 57%. Closing returns to page 5/8. The percentage is stable; the page boundary is not.

**Trade-offs.** This is the only direction where the reading state has no bars and still has a persistent, visible handle. The pull is directly in the reading flow and cannot be confused with the page; the % is a second cue. Reflow keeps every line visible, but opening a 56dvh sheet nearly triples the page count (8→24 at 390; 15→72 at 320), so the page boundary jumps and the book feels re-laid out. At 320×568 the open sheet leaves 108px of text height after the 44px dock — about three lines, and a chapter opener can consume all of it. Overlay avoids the repagination and page-number jump, but the sheet covers the lower two-thirds of the page; at 390 it hides about 13 of the page’s 21 visible lines. The check reports 0 visible overlaps because the stage is clipped exactly at the dock, not because the page is still there.

**Best at:** calm, bar-free reading; a genuinely visible settings handle; one place for type, contents and marks.

**Worst at:** the 56dvh sheet is too tall for 568px phones; reflow is visibly jumpy (8→24 pages) and the page number changes.

## R2 — Margin tab

**Structure:** no bars. A 32×56 “Aa” tab (44×56 target) sits vertically centred in a reserved 52px right margin, with a hairline and % at the bottom. Tapping opens a 48px-wide vertical type tray in the margin: close, A−/A+, spacing, margins, typeface, theme, mode, contents. Everything is one tap and nothing overlays a line. Contents/Marks still use the shared sheet.

**Measurements (390×844):**

| | closed | tray open | sheet open, reflow | sheet open, overlay |
|---|---|---|---|---|
| overlaps | 0 | 0 | 0 | 0 |
| visible lines | 21 | 21 | 6 | 8 (clipped) |
| pages | 9 | 9 | 27 | 9 |
| min target | 44 | 44 | 44 | 44 |
| text measure @320 | 216px · ≈20 chars | same | same | same |

The 52px gutter costs 52px of measure on every page: 286px vs R1’s 338px at 390, 216px vs 268px at 320. At 320 with the largest type and wide margins the measure falls to **≈10 characters per line**, which is not a reading column.

**Trade-offs.** The fastest path to type: the Aa is visible in the margin, one tap opens a tray that never touches the text. The tray is compact and legible as icons, but its 6–7px captions are below the project’s 8px small-caps rule and require learning (aria labels and the bench state carry the meaning). The permanent gutter is the real cost: every page is narrower, and on a 320px phone the measure drops to ~20 characters even at the default size. Contents/Marks fall back to the shared sheet, so R2 still needs R1’s sheet for the full settings story.

**Best at:** direct, no-sheet type access; a physical “margin tool” feel; never covering a line.

**Worst at:** permanently narrow measure; small icon captions; largest + wide at 320 is unusable.

## R3 — Refined bars

**Structure:** centre tap toggles solid-paper top and bottom bars. Top: Shelf / title / % / Contents / “…” (Open in another app expands the top bar by 44px); bottom: Aa / theme / bookmark. Icon-first, 44px targets. Auto-hides after 5s. A one-time coach (“Tap the page for controls”) and a permanent tiny Aa in the 44px footline make it discoverable. Bars are bands above/below the stage, never translucent overlays.

**Measurements (390×844):**

| | bars hidden | bars visible | sheet open, reflow | sheet open, overlay |
|---|---|---|---|---|
| overlaps | 0 | 0 | 0 | 0 |
| visible lines | 21 | 18 | 6 | 8 (clipped) |
| pages | 8 | 9 | 24 | 8 |
| stage top / bottom | 0 / 44 | 56 / 64 | 0 / 44 | 0 / 44 |
| text moved | — | yes (8→9 pages) | yes | no |
| min target | 44 | 44 | 44 | 44 |

**Trade-offs.** The most familiar and discoverable option: the bars look like controls, the title and % are in the top bar, the “…” menu has a home for Open in another app. Solid bands mean no line is ever under a bar. It still costs chrome: the footline is 44px even when closed, the bars take 120px when open, and every reveal/hide repaginates the page (8→9 pages at 390). Opening the sheet from the bars hides them and shows the footline, so the text jumps twice (bars disappear, sheet appears). Auto-hide can also take the controls away while the reader is deciding.

**Best at:** discoverability and convention; no occlusion; a clear “Shelf / title / contents” header.

**Worst at:** the most chrome and the most layout movement; 44px footline + 120px bars is a lot of a 568px screen.

## Reflow vs overlay (all directions)

`FLOW REFLOW` shrinks the reading stage while the sheet is open; `FLOW OVERLAY` leaves the stage at full height and clips it at the sheet’s dock line. Both preserve the reading percentage on open/close.

- Reflow at 390: 8 pages → 24 pages; visible text 21 → 6 lines; page boundary jumps (page 5/8 becomes 14/24). Nothing is hidden; the page is genuinely re-laid out.
- Overlay at 390: still 8 pages; the current page is intact behind the sheet, but only 8 lines are painted; the rest is clipped and not readable until the sheet closes.
- At 320: reflow 15 → 72 pages, 108px of text (≈3 lines); overlay still 15 pages, same 3 visible lines.
- Scrolled mode and PDF: reflow only shortens the viewport — there is no column to repaginate, so the text does not re-wrap. The check reports “viewport shortened; text did not re-wrap.”
- PDF: the Page sheet has zoom −/+, Fit width, page n/m, theme and Outline. At 390 the page is 358×506 at Fit width; 50% is 179×253, 150% is 537×759 (scrollWidth 569), 200% is 716×1012 (scrollWidth 748). Document overflow stays at 0; the PDF viewport scrolls internally.

## The Check button

`Check` closes everything, measures the closed state, opens the sheet (or V0 bars / R2 tray), measures again, restores the previous state and prints:

- **Chrome × text overlaps:** intersection of every visible chrome surface (bars, dock, sheet, tab/tray, V0 pill) with every painted text-line rectangle. Text is clipped to the stage and page-clip; in overlay it is also clipped at the dock line. Reports lines and pairs; target is 0/0.
- **Minimum tap target:** bounding box of every visible button/input in the reader, plus any under 44px.
- **Text measure @320:** the page column width at a 320px viewport for the current margin/gutter, with an estimated characters-per-line from canvas measurement.
- **Text moved when controls opened:** a fingerprint of every chapter/paragraph rectangle before and after. Reflow = yes (repagination); overlay = no (clipped); scrolled/PDF reflow = no re-wrap.
- **Horizontal overflow, window errors, pages, progress.**

The report also prints the measured state and a verdict. The bench and report are prototype chrome and excluded from the measurements.

**Overlay honesty note:** the raw text boxes still extend under the sheet in overlay; the checker counts only painted lines, clipped at the dock. That is the correct reading of “visible chrome never covers a line”, but it is not the same as “nothing is hidden”: overlay hides the lower page.

## Verification (Playwright/Chromium)

All screenshots are 390×844 at dpr 3 unless named otherwise, in `screenshots/reader-lab/`. The revised R1 shots are the `r1b-*` set; the first-round `r1-*` shots are kept.

### Revised R1 checks

- **Matrix:** 390/320/430 × reflow/overlay — closed and open overlaps **0 lines / 0 pairs**, min tap target **44px**, no document overflow, 0 window errors, 0 console errors. Checked through the in-page `Check` button (`window.__lastCheck`).
- **48dvh:** sheet 405.1 / 272.6 / 447.4px at 390 / 320 / 430; open reflow pages 18 / 42 / 14; closed 8 / 15 / 6.
- **320×568 fold:** `type-mode`, `size-down`, `size-up` and `type-theme` are inside the 133.6px body rect; spacing and margins are not. Measured with `getBoundingClientRect`, not eyeballed.
- **Swipe:** header 100px → closed; header 30px slow → still open and `--drag` cleared; body at scrollTop 0 100px → closed; body scrolled 80px + 100px drag → still open (scrolls instead); drag from the mode switch → closes without changing mode. Same with synthetic CDP touch events (`hasTouch`, `isMobile`).
- **Other closes:** scrim, Escape and browser back all close; the open sheet pushes history and back returns to the page.
- **Hint:** visible on first open; after the first swipe-close it gets `is-gone` and stays hidden for the rest of the session.
- **Reduced motion:** sheet `transition-duration: 1e-06s`; swipe still dismisses; no errors.
- **`file://`:** opens, Esc closes, Check returns 0/0, 44px and no overflow.
- **Regression:** contents jump closes the sheet at 44%; marks render 3 items; PDF switches to the PAGE tab, zoom 100→125%, summary follows to `PDF · 125% · Sepia`.

### First-round checks (kept)

- **Matrix:** R1/R2/R3 × reflow/overlay — closed overlaps 0, open overlaps 0, min target 44, no document overflow, no window errors, no console errors.
- **Reflow:** text moved = yes (paginated); **overlay:** text moved = no.
- **R2 tray** open: 0 overlaps, 0 under-44 controls.
- **R3 bars** visible at 390 and 320: 0 overlaps; 44px targets; title truncates at 320.
- **320×568** (R1): closed 0 / open 0, min 44, measure 268px ≈25 chars, 15 pages closed / 72 pages open.
- **430×932** (R1): closed 0 / open 0, min 44, 6 pages closed / 18 open.
- **PDF at 175%** with the Page sheet open: 0 overlaps, min 44, no document overflow.
- **Interactions:** pull, dock swipe, ArrowUp, ArrowRight, Esc, browser back, R2 tab/tray/steppers, R3 centre tap/5s auto-hide/“…” menu/permanent Aa, contents jump, marks, largest type live, PDF next/zoom/fit/outline — all pass.
- **`file://`** double-click load: sheet opens, Esc closes, check returns 0/0 and 44px.
- **Reduced motion:** sheet transition duration 1e-06s; no errors.
- **V0 baseline (expected failures):** revealed bars cover 2 lines, min top target 38px. V0 is not counted as a pass.

## Known failures / caveats

1. **V0 is the baseline, not a candidate.** It is measured as a failure on purpose (2 lines under the bars, 38px top targets).
2. **The 56dvh sheet is too tall on 568px phones.** At 320×568 the reflow stage is 108px (≈3 lines), and a chapter opener can consume it. The same is true in all directions because the sheet height is shared. Recommendation: 48dvh, a two-stage sheet, or a drag handle that expands. **Resolved in Revised R1: the sheet is 48dvh and the stage is 187px at 320×568.**
3. **R1 reflow is genuinely jumpy:** 8→24 pages at 390, 15→72 at 320. The reading percentage is preserved, but the page number and page boundary are not. Overlay avoids the jump by hiding the lower page (≈13 of 21 lines at 390).
4. **R2 costs measure on every page:** 216px at 320 (≈20 characters) vs R1’s 268px (≈25); largest + wide is ≈10 characters. The tray captions are 6–7px.
5. **R3 still costs 44px closed / 120px open, and repaginates on every bar toggle (8→9 pages).** Opening the sheet from the bars causes a second layout change.
6. **Fonts are unproven.** The three stacks are wired, but no webfonts are loaded and the Linux test box falls back to one local serif for all three. Glyph widths and line breaks will change on Android with bundled fonts.
7. **PDF reflow is only a viewport change.** A PDF has no column to repaginate; the flow switch shrinks the viewer rather than re-laying out the page.
8. **The check’s overlay result is a visible-line result.** It does not claim the hidden page is still readable. The raw boxes extend under the sheet.
9. **The prototype is in-memory only.** Reloading resets the settings; the URL carries most of the state, but not the sheet/tray/bars open state.

## Recommendation

> **Superseded by the decision above.** R1 is adopted; the 48dvh change is in Revised R1, and the proposed secondary Aa was explicitly rejected — the brass pull and percentage are the only entry points. The text below is the first-round recommendation, kept for context.

**R1 Reading desk is the right base.** It is the only direction where the reading state has no bars, the settings handle stays visible as part of the page furniture, and type/contents/marks all live in one place. The 44×18 brass pull + 0% is a better answer to “there are no settings” than a bar the reader has to discover by tapping the page.

Two changes before it ships:

1. **Shorten the sheet to ~48dvh** (or make it a two-stage sheet with a drag handle). At 390 that leaves roughly 8–10 lines rather than 6; at 320 it leaves ~4–5 rather than 3, and the 8→24 page jump becomes less violent. The prototype uses 56dvh because the direction specified it, so the 320 open screenshot is the worst case.
2. **Add R3’s permanent tiny Aa as a secondary affordance** next to the % (44px target), or a one-time “Pull for type” coach on the brass pull. R1’s pull is visible but not self-explanatory; R3’s footline Aa is.

Default to **reflow for paginated** reading: it never hides the current page, and the percentage-preserving layout makes the jump a page-boundary change rather than a loss of place. Keep **overlay** as the choice for scrolled mode and PDF, where there is no column to repaginate and the sheet can simply float.

**R3 is the conventional fallback** if the team cannot accept repagination: solid bars never cover a line, 44px targets, the coach mark and the permanent Aa solve discoverability. It is more chrome and more layout movement than R1, but less radical.

**Do not make R2 the primary.** The margin tab is a good shortcut, but the 52px gutter costs 52px of measure on every page (286 vs 338 at 390; 216 vs 268 at 320) and largest + wide collapses to ~10 characters. Keep the margin tab as an optional type shortcut; it is not worth the permanent column loss as the only settings path.

The one thing all three directions agree on: **never float a translucent bar over the text.** V0’s revealed bars are the anti-pattern. Bands, a clipped sheet, or a reflowed page are all preferable to grading text under a gradient.
