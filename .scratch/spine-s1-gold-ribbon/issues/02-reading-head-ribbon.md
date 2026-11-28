# Reading mark: in-spine oxblood head ribbon (cue A)

**Opened:** 2026-11-28
**Status:** fixed in 0.1.20
**Decision owner:** user

## Report

On the device the reading status mark sat in the wrong place:

> "the red ribbon is not located correctly"

Asked to describe it:

> "Detached from the book's foot, it should be located like the gold ribbon, now
> it's not on the book even."

## Cause

0.1.19 shipped the spine lab's **cue B**: an 8×31px oxblood drape rendered in a
case-level layer because `.v4-cavity` clips. It started 4px above the book's
foot and hung 27px over the shelf lip and board. On a real phone it read as a
loose red strip floating below the book rather than a marker on the book.

## Fix

Use the lab's **cue A** instead: an 8×26px oxblood head ribbon inside the spine,
in the same slot as the finished gold ribbon (`top: 0`, `right: 3px`), with the
lab's 80% notch, oxblood ramp and 2px top sheen. Reading and finished are
exclusive, so sharing the head slot is safe. Reading books now reserve the same
28px head as finished, so the ribbon never touches a title glyph.

Deleted with the old mark:

- `ShelfCues` and its measuring / resize / intersection / mutation-observer code
- the case-level `.v4-cues` layer and its CSS
- the `.spine-drape is-inline` drag-ghost copy
- the drape half of the filter dim sweep in `LibraryWall`
- `READING_DRAPE` / the 10px reading reserve in the canvas path

## Evidence

- `evidence/placeholder-shelf-390@2x.png`, `placeholder-shelf-320@2x.png`,
  `placeholder-shelf-360@2x.png`: first look at the in-spine ribbon. **Placeholder art:** one
  jacket tinted per book, not the user's shelf; rejected only for the art, not for the ribbon
  position. Labelled in `evidence/placeholder-notes.md`.
- `evidence/placeholder-closeup-reading-finished@2x.png`: reading and finished share the head slot.
- `evidence/placeholder-notes.md`: box, notch, ramp, head reserve and overlap report.
- `evidence/real-notes.md` with `real-shelf-390@2x.png`, `real-shelf-360@2x.png`,
  `real-closeup-rpo-needful@2x.png` and `real-closeup-rpo-whisper@2x.png`: the seven-book shelf
  with one resolved real jacket per book and the user's statuses.

## Contract

Exactly the reading books render `[data-testid="spine-reading-ribbon"]`; its box
is 8×26 at `top: 0` / `right: 3px`, fully inside the spine and above the title
box; nothing status-related is painted outside a spine. The canvas reports
`data-mark-kind="reading-ribbon"` and `data-head-reserve="28.00"`.

Tests: `tests/e2e/spine-presentation.spec.ts` ("reading is an oxblood head
ribbon in the finished ribbon's slot"), `spine-style-sync`, `spine-studio`,
`library-flow`, `spine-renderer`.
