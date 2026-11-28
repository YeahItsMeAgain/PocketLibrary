# 01 — Ship S1 smoked leather with reading drape and gold finished ribbon

> **Superseded in part by [`02-reading-head-ribbon.md`](02-reading-head-ribbon.md).** The reading
> cue B drape described here shipped in 0.1.19 and was replaced in 0.1.20 by the in-spine oxblood
> head ribbon (cue A). Everything else in this ticket still applies.

Status: ready-for-agent
Type: task

Feature: `.scratch/spine-s1-gold-ribbon/spec.md`. Read it first, then the prototype files it
names. This ticket is the whole change; do not split it.

Worktree: `/mnt/ssd2/Projects/PocketLibrary-spine-build`, branch `feat/spine-s1`. Never write to
the main checkout or to `../PocketLibrary-reader-build`.

## What to build

1. **S1 Art face in CSS + `Shelf.tsx`.** Full-height art under the head-to-tail warm scrim, gold
   hairlines, no foot band, author and label chips on the bottom 30% of the scrim. Title box 10px
   head (unread/reading) or 28px (finished), 70% foot. Replace the `.spine-band-bottom` treatment
   for Art rather than layering another opaque surface on top of it.
2. **Reading cue B.** An 8×16px oxblood drape visible below the book, over the lip and board.
   `.v4-cavity` is `overflow: hidden`; choose the cleaner of (a) a scoped `overflow: visible` on the
   cavity with a verified non-overflowing shelf, or (b) a cue layer inside the case that positions
   the drape from the book's measured rect. Do not clip it, and do not change the shelf's height or
   the board/lip stacking.
3. **Finished cue D.** 8×26px gold ribbon in the reserved head band at `right: 3px`, notched tip,
   1px dark edge, 2px sheen. Remove the medallion from Art. Apply the same drape/gold language to
   Cloth and Typography so status means the same thing on every face.
4. **Canvas parity.** Update `src/library/spine/styles.ts`, `text.ts`, `geometry.ts`, `draw.ts`
   so `SpineCanvas` (Studio preview, style tiles, shelf-size strip) paints the same faces, scrim,
   head reserve, marks and author. Update `SpineCanvas`'s published data attributes honestly.
5. **Title fit fixes.** Single long word shrinks one column; per-column tracking capped at 0.12em;
   the rendered run can never leave the title box. Same behaviour in the canvas fit.
6. **Docs.** Amend the Art paragraph in `docs/adr/0005-on-device-spine-engine.md`; update the Art,
   Spine style, ribbon and seal entries in `GLOSSARY.md` (finished is now a gold ribbon, reading a
   drape). Keep the wording short and factual.

## Tests

- Update the four spine e2e specs for the new DOM/marks and add: no title clipping at 27px with a
  40-character title and an 18-character word; RTL; reading drape clear of the title; finished gold
  ribbon clear of the title; canvas/shelf parity for scrim and foot geometry.
- Run `npm run build`, `npm run check:contract`, `npm run check:docs`, `npm run check:structure`,
  and the spine e2e specs. Capture shelf screenshots at 320/360/390/430.

## Definition of done

- The shipped shelf is visually the lab's `?v=s1&cue=b&seal=d`, including the gold ribbon's brass
  read at 27px and the red tails below the reading books.
- No title clipped, no mark in a title box, no foot bar, no horizontal overflow.
- Studio and shelf agree; tests and the four checks pass; screenshots attached to the report.
- No commit; the integrator commits.
