# 16: Shelf visual fidelity

**What to build:** Wholesale port of the approved "Refined reading room" prototype (`prototype/design/shelf-v4.html`, interactions from `flows.html`) into the real app. The current UI is a wiring skeleton; the prototype is the design contract. This is not a polish pass and not a reinterpretation. At 390x844 the result should be visually indistinguishable from the prototype, with the real app data and interactions.

**Blocked by:** 05, 06, 08, 13

**Status:** ready-for-agent

- [ ] Spines vary deterministically in width, height, colour and material; no two adjacent books are identical flat rectangles. Worn cloth/leather gradients, darker endcaps and gilt rules/bands.
- [ ] Spine colours are derived from the book (cover-led where available, format/hash fallback) and stay muted and legible.
- [ ] Bookcase furniture matches the prototype: cornice with crest, fluted pilasters/capitals, carved brackets, panelled recessed back, moulded shelf lip, brass hairline/rail, plinth, warm lamp pools and contact shadows.
- [ ] Labels render as coloured paper bands with cream text; reading ribbon and gold finished seal match the prototype; the detail cover carries the percentage/gold sticker.
- [ ] Filter strip, count, clear action and Manage labels match the prototype's scale and hierarchy; it does not dominate the shelf.
- [ ] The one-time drag hint is smaller, sits clear of the shelf/drawer, and never returns after dismissal.
- [ ] Drawer pull and drawer match the prototype exactly: brass hardware, live finger-following drag both directions, snap threshold, scrim, back/Escape, one-time hint. No floating pill.
- [ ] The shelf scrolls and lifts with the prototype's feel and timings; press/lift/drop/hover states match.
- [ ] Motion timings and easings are taken from the prototype, not approximated: scrim 260 ms, detail 480 ms, no bounce; transform/opacity only.
- [ ] Book detail matches the prototype: framed composition, real cover as hero, blurb, metadata, chips, Read/Continue, labelled Back to shelf.
- [ ] Motion: composite-only, panel 480 ms, scrim 260 ms, no bounce; reduced motion instant.
- [ ] Playwright screenshots at 390x844 for empty wall, populated wall, filtered wall, finished/reading spines and detail; no horizontal overflow.
- [ ] Signed release APK built and the public URL verified.

**Notes:** Reuse the prototype's CSS, SVG and interaction code as the source of truth; port it into the React shell rather than writing new styles. Keep the existing data wiring, commands, drag logic, filters, placement and reader. Do not regress functionality. Verify with side-by-side screenshots against `shelf-v4.html` at 390x844 for: empty wall, populated wall, filtered wall, reading/finished spines, drawer open, book detail. Reviewer compares against the prototype, not against the old app.
