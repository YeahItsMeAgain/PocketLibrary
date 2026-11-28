# 01 — Replace the reader bars with the reading desk

Status: ready-for-agent
Type: task

Feature: `.scratch/reader-desk/spec.md`. Read it first, then the prototype files it names. This
ticket is the whole change; do not split it.

Worktree: `/mnt/ssd2/Projects/PocketLibrary-reader-build`, branch `feat/reader-desk`. Never write
to the main checkout or to `../PocketLibrary-spine-build`.

## What to build

1. **`ReaderControls.tsx`** grows the shared pieces: `ReaderPull` (brass plate, progress hairline,
   percentage, hit areas), `ReaderDesk` (48dvh sheet, grip, header, tabs, swipe-to-close, scrim,
   focus restore), and the hooks both readers need. Keep `useReaderExit`.
2. **Remove the top and bottom bars** from `EpubReader.tsx` and `PdfReader.tsx` and their
   `reader.css` rules. Nothing outside the pull, percentage and desk may open settings.
3. **Move the contents:** Contents, bookmarks, highlights (Marks), and Open in another app into
   the desk; PDF gets a PAGE tab with zoom, fit width, page jump and outline.
4. **Type controls live:** the lab's type panel (mode toggle, size stepper with `Aa`, spacing and
   margin previews, typeface specimens, theme swatches, summary footer) wired to the existing
   `ReaderSettings` and `applyReaderSettings`.
5. **Reflow / overlay:** paginated EPUB shortens the stage while the desk is open and preserves
   the locator; scrolled EPUB and PDF overlay. Closing restores the stage. Update the old
   "revealing chrome must not shift the surface" assertion to the new rule.
6. **Back behaviour:** the sheet closes on Escape, scrim and back before the reader exits; focus
   returns to the pull.

## Tests

- Rewrite the chrome portions of `reader.spec.ts`, `pdf-reader.spec.ts`, `reader-layout.spec.ts`
  and the reader part of `navigation.spec.ts`.
- Add: swipe-down dismiss (touch drag 100px) and spring-back (30px); no-overlap check at
  390/320/430; 44px minimum targets; only the pull/percentage open the desk; position preserved
  across open/close; sheet closed before reader exit on back.
- Run `npm run build`, the three check scripts, and the reader/PDF/navigation specs. Capture
  screenshots at 320/390/430, light and night, largest type, contents, marks, PDF zoom.

## Definition of done

- The reader matches the lab's revised R1: no bars, brass pull, 48dvh desk, swipe-down, the
  reading page never covered while reading.
- Both readers use the same components; no duplicated chrome markup.
- Tests and checks pass; screenshots attached; no commit (the integrator commits).
