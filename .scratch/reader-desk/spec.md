# Reader controls: one reading desk, brass pull only

## Decision

The reader chrome is rebuilt as **R1 Reading desk**, chosen by the user on 2026-11-28: no top or
bottom bars, one 48dvh sheet opened by a brass pull (and the percentage), swipe down to close.

Source of truth:

- `prototype/design/reader-controls.html` — open `?v=r1&flow=reflow&sheet=open`
- `prototype/design/reader-controls.NOTES.md` — measurements, swipe behaviour, caveats
- `prototype/design/screenshots/reader-lab/r1b-*.png` — closed, open, night, largest type,
  contents, marks, swipe mid-drag, 320/390/430

The prototype lives on branch `prototype/reader-controls`; keep it, do not modify it.

## Problem being fixed

Settings exist but are unreachable in practice: `chrome` starts false, only a centre tap reveals
it, the hidden state is a faint 0% pill, and the revealed gradient bars put text underneath them.
The top bar crams four controls into 9–10px caps and 38px targets. The user's words: reading "has
no settings now", and the old bars "hid the text".

## Required behaviour

- **Closed state:** book only, plus a 3px progress hairline, the percentage, and the brass pull.
  The pull is the only other control; no `Aa`, no bars, no edge tab.
- **Pull:** oval brass plate 56×20 in a hit area of at least 76×44, dark slot, screws, highlight,
  matching the library's drawer pull. The percentage is its own 44×44 button. Both open the desk.
- **Sheet:** 48dvh, paper with a brass grip and a "swipe down to close" hint that retires after
  the first successful swipe. Header: book title in the display serif, `% · page` in small caps,
  Shelf action, close control, thin brass rule. Tabs TYPE / CONTENTS / MARKS (PAGE as well for
  PDF), the active tab marked with a hanging oxblood ribbon, not a generic tab.
- **Swipe to close:** pointer and touch drag on the header, grip, or body at `scrollTop === 0`;
  the sheet follows at ~0.85× and dismisses past 64px or 0.35px/ms, otherwise springs back over
  ~240ms. Scrolled body drags scroll. Scrim tap, Escape and back also close it. Restore focus to
  the pull.
- **Type panel:** reading mode as one brass two-state toggle; a size stepper with a live `Aa`
  specimen and 44px −/+; line-density preview buttons for spacing and margins; three typeface
  specimen rows; three printed paper theme swatches; a quiet summary footer. All changes apply
  live and survive close/reopen.
- **Contents / Marks:** chapter list with the current chapter; bookmarks and highlights, tapping
  jumps and closes the sheet.
- **PDF:** the PAGE tab carries zoom −/+, fit width, page n/m and the outline, in place of type.
- **Page behaviour:** in paginated EPUB the stage shrinks while the sheet is open (reflow), with
  the reading position preserved; in scrolled EPUB and PDF the sheet overlays the page, so no
  repagination and no jump. Closing restores the full stage.
- **Open in another app** moves into the desk (header menu or a quiet action), not a bar.
- Android/browser back closes the sheet before it exits the reader.

## Out of scope

- The Settings → Reader defaults screen, the settings schema, annotation/bookmark storage.
- Reader rendering internals (foliate/PDF.js), page-turn gestures, highlight popover redesign.
- Any spine or library change.

## Ownership

| Area | Files |
|---|---|
| Shared chrome | `src/reader/ReaderControls.tsx` (pull, sheet, hooks) |
| Readers | `src/reader/EpubReader.tsx`, `src/reader/PdfReader.tsx` |
| CSS | `src/styles/reader.css` |
| Nav | `src/navigation.ts` only if the sheet needs a back layer |
| Tests | `tests/e2e/reader.spec.ts`, `pdf-reader.spec.ts`, `reader-layout.spec.ts`, `navigation.spec.ts` |

Do not edit `src/App.css`, `package.json`, `core/**`, `src/library/**`, or the prototype branches.
If a shared test helper in `tests/e2e/ui-helpers.ts` or `library-helpers.ts` needs changing, report
it instead of editing it.

## Acceptance

- 390×844, 320×568, 430×932: closed and open, in reflow and overlay, zero chrome/text overlap in
  reflow, min tap target 44px, no horizontal overflow, no console errors.
- Swipe-down closes with a 100px drag and springs back with a 30px slow drag; scrolled body still
  scrolls; Escape, scrim and back close.
- Only the pull and percentage open the desk; there is no other route in the DOM.
- At 320 the primary controls (reading mode, size, theme) are above the fold; the rest scrolls.
- Paginated position survives open/close; scrolled and PDF never repaginate.
- Reader and PDF e2e specs plus `navigation.spec.ts` pass; `npm run build` and the three check
  scripts pass. The integrator runs the full `./scripts/check.sh`.
- Android device pass before release: touch swipe in the WebView, safe-area padding, foliate
  reflow at 48dvh.
