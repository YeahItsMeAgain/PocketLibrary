# Placeholder-art previews — 2026-11-28 (rejected art, approved ribbon)

**These previews are historical and use placeholder art.** Every spine is the same
`test-assets/cover.jpg` tinted per book, so the seven books look alike. The user rejected this
preview set for the art, not for the ribbon: *"they all look the same now, nothing like the actual
book."* Do not use these to judge how a real jacket looks. They remain only as the first look at
the in-spine ribbon position.

The ribbon placement itself was approved: shared head slot, no shape or notch change, colour
(oxblood vs brass) is the intended distinction.

## Files

| File | What |
|---|---|
| `placeholder-shelf-390@2x.png` | Shelf at 390 CSS px, DPR 2: 3 reading, 2 finished, 2 unread |
| `placeholder-shelf-360@2x.png` | Same shelf at 360 CSS px, DPR 2 |
| `placeholder-shelf-320@2x.png` | Same shelf at 320 CSS px, DPR 2 |
| `placeholder-closeup-reading-finished@2x.png` | Head crop of adjacent reading + finished spines |
| `placeholder-closeup-full-spines@2x.png` | Full-height crop of the same two spines |
| `placeholder-report.json` | Per-book geometry and overlap report |

Books: Ready Player One (reading), The Picture of Dorian Gray (finished), The Shadow Friend
(reading), Dune (unread), Needful Things (finished), The Whisper Man (reading), Rock Paper
Scissors (unread).

## Implemented numbers

- **Box:** 8 x 26 px, `top: 0`, `right: 3px`, `z-index: 6`. Reading and finished use the identical
  box; only the ramp differs.
- **Notch:** reading `clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%)` (80% notch).
  The gold ribbon keeps its existing 82% notch.
- **Reading ramp:** `#4c0a0f 0%, #8e1b22 30%, #c3353d 50%, #8e1b22 72%, #4c0a0f 100%`,
  `box-shadow: 1px 1px 2px rgba(0,0,0,.55)`, 2px top sheen `rgba(255,205,180,.25)`.
- **Head reserve:** 28 px for reading and finished on every face, so the title starts at 28 px.
  Art is 10 px when unread; Cloth/Typography keep their 24 px unread head. Canvas metadata reports
  `headReserve = 28` and `markKind = reading-ribbon` for reading.
- The case-level cue layer (`.v4-cues` + `.spine-drape`) is deleted.

## Overlap check (from `placeholder-report.json`)

Every reading book: ribbon 8 x 26 at top 0 / right 3, title top 28, and `title: false`,
`author: false`, `labels: false`.

| Book | Status | Spine | Ribbon | Title top | Overlaps |
|---|---|---|---|---|---|
| Ready Player One | reading | 31 x 200 | 8 x 26 | 28 | none |
| The Shadow Friend | reading | 38.7 x 208.7 | 8 x 26 | 28.3 | none |
| The Whisper Man | reading | 28 x 210 | 8 x 26 | 28 | none |
| The Picture of Dorian Gray | finished | 31 x 200 | 8 x 26 (gold) | 28 | none |
| Needful Things | finished | 39.9 x 234 | 8 x 26 (gold) | 28.4 | none |
| Dune | unread | 33.7 x 206.6 | none | 10.2 | — |
| Rock Paper Scissors | unread | 29 x 201 | none | 10 | — |
