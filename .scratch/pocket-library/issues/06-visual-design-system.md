# 06 — Victorian visual design system

Type: prototype
Mode: HITL
Status: resolved
Blocked by:

## Question

What does "vintage Victorian library" mean concretely enough to build?

Produce several radically different UI variations for the user to react to, then settle a design language: materials (oak, leather, brass, paper, glass), typography (display, body, UI), palette, lighting and shadow, shelf perspective, how a cover becomes a spine (crop, tint, texture, wear), sticker/ribbon visuals, the book flip, page-turn motion, and sound if any.

Deliver design tokens (colour, type scale, spacing, elevation, motion durations/easings) and a short motion specification, plus rules for keeping text legible on textured surfaces. This ticket owns the look; 01 owns the interaction.

## Feedback on first prototype (2026-11-24)

- Book/spine colours from variant 1 are the best; the overall palette is ugly.
- Everything must be darker.
- The shelf must look like Victorian furniture, not a plain board.
- Taking a book out must show the **real cover**, not a generated one.
- The detail view from variant 3 is the right composition, but the cover must be much larger.
- Animations are wonky; they must be silky smooth.

Direction: one refined variant (v4) combining V1 spine colours, a darker refined palette, ornate shelving, V3's framed detail panel with a large real cover, and compositor-only motion.

## Answer

Resolved 2026-11-24. Prototype: `prototype/design/shelf-v4.html` (variants 1-3 kept in `shelf-variants.html` for reference); tokens and iteration notes in `prototype/design/NOTES.md`.

**Direction: "Refined reading room" (v4).** Dark Victorian library, phone-first.

- **Palette:** near-black aubergine/plum room (`#150e16 → #0e0810 → #09050b`), casework `#3a2540 → #271731 → #190f20`, brass `#c9a86a`, aged cream `#f4e6c4`, oxblood accents. No green cast. Book spines in worn jewel tones (violet, aubergine, wine, mulberry, navy, forest, ochre).
- **Furniture:** Victorian casework built from layered gradients plus inline SVG: cornice with palmette crest, fluted pilasters and capitals, panelled recess, moulded shelf lip, brass hairline, plinth, carved scroll brackets. Fixed shelves, finite wall.
- **Typography:** display serif (Iowan/Palatino/Georgia stack) for titles, small-caps letterspaced labels; spine titles 9.6-10.8 px at weight 600 in cream-gold, authors 7.4 px, tuned to avoid clipping on 27 px spines.
- **Labels:** each label keeps its own colour as a spine band and a detail chip; cream text at 7.5 px/700 on spines and 12.5 px in the detail, dark + brass edges, minimum measured contrast 5.56:1. Labels filter without moving books.
- **Status:** fixed axis, shown on the shelf only (ribbon reading, gold seal finished); the status row is removed from the book detail.
- **Book detail:** variant 3's framed composition, real cover art as the hero (~80% of the frame), progress sticker, blurb, progress bar, coloured labels, edition strip, and a full-width oxblood **Read / Continue reading** CTA. A labelled **← Back to shelf** sits at the top.
- **Reader:** aged-paper placeholder reader with title bar, page navigation, brass progress bar, and a labelled **← Shelf** control.
- **Motion:** compositor-only transform/opacity. Scrim 260 ms; panel `translateY(18px) scale(.985)` → identity in 480 ms `cubic-bezier(.2,.8,.2,1)`; opacity 240 ms; no flight clone, no non-uniform scaling, no bounce. Reduced motion is instant. The variant switcher hides while a book or the reader is open.
- **Verification:** no console errors, no horizontal overflow at 360/390/430 px, labels readable and fitted, no spine clipping, both back controls work, real covers render.

This is the design language the spec should carry; 01 (shelf interaction) refines behaviour on top of it.
