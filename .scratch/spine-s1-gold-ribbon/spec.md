# Spine presentation: S1 smoked leather, reading drape, gold finished ribbon

## Decision

The Art spine is redesigned in place as **S1 Smoked leather** with **reading cue B** (oxblood
drape past the shelf lip) and **finished cue D** (gold ribbon in the reserved head band).
Chosen by the user after the spine lab, 2026-11-28.

The design is a throwaway prototype and is the source of truth for the look:

- `prototype/design/spine-lab.html` — open `?v=s1&cue=b&seal=d`
- `prototype/design/spine-lab.NOTES.md` — mechanisms and measurements
- `prototype/design/screenshots/spine-lab/s1-gold-d.png`, `s1-gold-d-cue-b.png`,
  `s1-gold-d-closeup.png`, `s1-gold-d-320x568.png`

The prototype lives on branch `prototype/spine-redesign`; keep it, do not modify it.

## Problem being fixed

Today's Art face paints raw engine art full height and puts the title on it with adaptive ink and
a 1px halo. On real engine output that fails: worst-band contrast 1.3–2.9:1, reading ribbons cover
28–30px of title glyphs on all three reading books, finished seals cover the last letters of two
titles, and the identical 27% near-black foot band across seven books reads as one bar. The title
fit also clips in the app on narrow spines (seen on "Needful Things" in the user's screenshot).

## Required look (from the lab)

- **Art ground:** full-height cached strip, unchanged image, under a warm near-black scrim
  `rgba(22,13,8,0.64)` at the head to `rgba(14,8,4,0.84)` at the tail; gold hairlines at head and
  tail. No filter, no blend mode.
- **No foot band on Art.** The bottom 30% is the darker part of the same scrim; the full author on
  two lines and the label chips sit on it. No translucent/opaque band rectangle, no gold band rule.
- **Title box:** top at 10px for unread and reading, 28px for finished (the head ribbon reserve);
  bottom at 70% − 4px. One column, then balanced two columns; shrink-to-fit; never truncate or clip.
- **Reading:** 8×31px oxblood drape: 4px over the book foot, 27px over the lip and board, matching
  the lab's `height = 31px`. No mark in the title area. It lives in a non-clipping cue layer because
  `.v4-cavity` is `overflow: hidden`.
- **Finished:** 8×26px gold ribbon at `right: 3px`, notched swallowtail, brass ramp
  `#8a6a2e → #b08d4a → #d2ac62 → #f0dcae`, 1px dark edge, 2px inner sheen. It lives in the
  reserved 28px head band and never enters the title box.
- **Status language is shared by Art, Cloth and Typography** so one shelf is consistent: reading is
  the drape, finished is the gold head ribbon, unread has neither. Cloth/Typography keep their
  boards and typography.
- **Author and labels:** full author over two balanced lines (shrink only to fit, 6.2–6.8px);
  labels stay colour chips with 4–5 letter codes at 5px, on the scrim.

## Canvas parity

`SpineStudio` © `SpineCanvas` renders the same faces with canvas (`src/library/spine/styles.ts`,
`text.ts`, `geometry.ts`, `draw.ts`). The shelf and the Studio previews must agree: scrim, no foot
band, head reserve, gold finished ribbon, drape reading mark, title fit and author treatment.
`SpineCanvas` already publishes `data-scrim`, `data-contrast`, `data-band*`, `data-art*`; update
those values honestly and add whatever the tests need for the new marks.

## Title fitting fixes

Carry back the two lab fixes into `fitSpineTitle` (Shelf) and the canvas fit:

1. A single long word shrinks one column to fit instead of returning an overflowing two-column run.
2. Cap per-column tracking at 0.12em so a short half is not spread into "M a n".

Verify at 27px with a 40-character title, an 18-character single word, and an RTL Hebrew title.
No glyph may leave the title box.

## Out of scope

- Rust/core generation, engine routes, the 52×236 contract.
- The detail panel, cover chooser, label manager beyond status-mark consistency.
- New spine styles; only the three existing ones.

## Ownership

| Area | Files |
|---|---|
| Shelf | `src/library/Shelf.tsx`, `src/library/spine.ts`, `src/library/LibraryWall.tsx` |
| CSS | `src/styles/spines.css`, `src/styles/wall.css` |
| Canvas | `src/library/spine/*.ts`, `src/library/SpineStudio.tsx` |
| Tests | `tests/e2e/spine-presentation.spec.ts`, `spine-renderer.spec.ts`, `spine-style-sync.spec.ts`, `spine-studio.spec.ts` |
| Docs | `docs/adr/0005-on-device-spine-engine.md`, `GLOSSARY.md` |

Do not edit `src/App.css`, `package.json`, `core/**`, `src/reader/**`, or the prototype branches.

## Acceptance

- `?v=s1&cue=b&seal=d` from the lab is recognisably what ships: shelf screenshot at 360/390 shows
  the scrim, gold ribbons at the head of finished books, oxblood tails under reading books, no
  foot band, no mark touching a title.
- 390/360/320/430: zero horizontal overflow; every title inside its box; 0 label/title collisions;
  worst title contrast ≥4.5:1 against the composited scrim.
- Reading and finished are distinguishable without colour: position (head vs tail) and shape
  (ribbon vs ribbon) plus `aria-label`/title text. Remember reading and finished are exclusive.
- Studio previews match the shelf; canvas metadata reports the same scrim/foot/head geometry.
- `npm run build`, `npm run check:contract`, `npm run check:docs`, `npm run check:structure`, and
  the four spine e2e specs pass. The integrator runs the full `./scripts/check.sh`.
- Android device pass before release: Noto Serif metrics, DPR and the drape over the shelf lip.
