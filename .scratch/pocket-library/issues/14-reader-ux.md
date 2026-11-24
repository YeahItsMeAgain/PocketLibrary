# 14 — Reader experience and optional features

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 05

## Question

Finalise the reader's user experience, then the optional annotation features.

M1: TOC, typography controls, light/sepia/dark themes, page-versus-scroll mode, progress, resume, bookmarks, tap zones, and "open in another app". Decide the chrome (always visible, tap-to-reveal, or physical metaphor), how the reader is entered and left, and the PDF-specific controls.

Later/optional: highlight colours, notes attached to highlights, in-book search, TTS, and annotation export. For each, define the interaction and what the data model must already support, so M4 does not force a reader rewrite.

## Answer

Resolved 2026-11-24.

- **Chrome:** immersive. Tap the centre to reveal a slim top bar (← Shelf, Contents, progress) and bottom bar (type, theme, bookmark); tap again or tap the page to hide.
- **Modes:** paginated by default with horizontal swipe and tap zones; vertical scroll is an option. The choice is global, set in Settings or the reader's type panel, and remembered. No per-book prompt.
- **Tap zones:** left third previous, right third next, centre toggles chrome. On the first/last page the zone does nothing.
- **Contents:** one sheet with two tabs. Chapters (TOC, current chapter highlighted, tap to jump) and Bookmarks (chapter + %, tap to jump, delete to remove). The bookmark button drops a ribbon on the current page.
- **Themes:** Paper, Sepia, Night.
- **Typography:** five text sizes, three line spacings, two margin widths.
- **Fonts:** three bundled serifs — EB Garamond, Literata, Source Serif — total under ~1.5 MB.
- **PDF:** same shell and experience as EPUB wherever the format allows — same chrome, tap zones, modes, Contents/bookmarks, progress, resume and themes (Paper/Sepia/Night applied as a colour wash). Font size becomes zoom (fit-width + pinch), because PDF layout is fixed. No text reflow and no PDF annotations in M1.
- **Open in another app:** available from the book detail and the reader's top bar; the built-in reader remains the global default.
- **Later/optional:** highlights, notes, in-book search, TTS, annotation export; the data model already supports them.
