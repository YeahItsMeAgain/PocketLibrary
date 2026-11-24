# 16: Shelf visual fidelity

**What to build:** Port the approved "Refined reading room" prototype (`prototype/design/shelf-v4.html`, with interactions from `flows.html`) into the real app so the installed APK looks like the design, not a flat wireframe. This is a fidelity pass, not a redesign.

**Blocked by:** 05, 06, 08, 13

**Status:** ready-for-agent

- [ ] Spines vary deterministically in width, height, colour and material; no two adjacent books are identical flat rectangles. Worn cloth/leather gradients, darker endcaps and gilt rules/bands.
- [ ] Spine colours are derived from the book (cover-led where available, format/hash fallback) and stay muted and legible.
- [ ] Bookcase furniture matches the prototype: cornice with crest, fluted pilasters/capitals, carved brackets, panelled recessed back, moulded shelf lip, brass hairline/rail, plinth, warm lamp pools and contact shadows.
- [ ] Labels render as coloured paper bands with cream text; reading ribbon and gold finished seal match the prototype; the detail cover carries the percentage/gold sticker.
- [ ] Filter strip, count, clear action and Manage labels match the prototype's scale and hierarchy; it does not dominate the shelf.
- [ ] The one-time drag hint is smaller, sits clear of the shelf/drawer, and never returns after dismissal.
- [ ] Drawer pull and drawer match the prototype's brass hardware, not a large floating pill.
- [ ] Book detail matches the prototype: framed composition, real cover as hero, blurb, metadata, chips, Read/Continue, labelled Back to shelf.
- [ ] Motion: composite-only, panel 480 ms, scrim 260 ms, no bounce; reduced motion instant.
- [ ] Playwright screenshots at 390x844 for empty wall, populated wall, filtered wall, finished/reading spines and detail; no horizontal overflow.
- [ ] Signed release APK built and the public URL verified.

**Notes:** The current app already has the palette, shelf frame, label/status logic and detail plumbing. This ticket is primarily spine rendering, furniture depth, type scale and spacing. Reuse the prototype's CSS/SVG rather than inventing a new look. Do not regress drag, filters, placement or the reader.
