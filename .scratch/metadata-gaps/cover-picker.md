# PocketLibrary — Manual cover chooser

Status: ready-for-agent
Tracker: local `.scratch/metadata-gaps/`
Blocked by: none
Related: `.scratch/metadata-gaps/spec.md` (automatic cover/blurb enrichment)

## Problem Statement

Automatic metadata lookup can find a real cover for a book whose file has only a generated plate, but
it cannot know when a catalogue’s idea of “the right edition” is not the book in my hand. A wrong or
generic cover is worse than the plain jacket plate. I need a deliberate way to open the cover in the
Flip and replace it myself, without turning automatic lookup into a blind carousel of guesses.

I also need to be able to put the original back. The book file is the source of truth, and I do not
want a manual choice to become a one-way edit that survives rescans, restores or a later refresh.

## Solution

Make the cover itself a control in the Flip. Tapping it opens a small cover chooser showing the
current cover and a short, explicit list of alternatives:

- the cover embedded in or rendered from the book file, when one exists;
- the generated jacket plate;
- a few keyless online cover candidates tied to the book’s matched edition or a clearly labelled
  Open Library search result;
- optionally, an image chosen from the device.

Every candidate is previewed at phone size inside the existing 600×900 cover cache frame, with an
explicit **Use this cover** action. Choosing one preserves where it came from, marks the choice as
manual so automatic enrichment never replaces it, and updates the Flip immediately. **Reset to
original** restores the file’s own cover and source; when the file has no cover, the generated plate is
restored instead.

The chooser is the safety valve for ambiguous or wrong-edition matches. Automatic metadata lookup
stays conservative and never opens the chooser, never cycles covers, and never replaces a real
embedded or PDF-rendered cover.

## User Stories

1. As the reader, I want to tap the cover in the Flip to open a cover chooser, so that changing it is a
   direct, discoverable action.
2. As the reader, I want a “Change cover” item in the Flip’s overflow as a second entry point, so that
   the action is reachable even if I do not think to tap the image.
3. As the reader, I want the chooser to show the current cover first, so that I always know what I am
   about to replace.
4. As the reader, I want to see the book’s original embedded or rendered cover as a candidate, so that
   I can return to what the file actually contains.
5. As the reader, I want the generated jacket plate offered when there is no file cover, so that I can
   undo a real-cover choice and return to the honest fallback.
6. As the reader, I want a “Reset to original” action when a source cover exists, so that one tap
   restores the file’s own cover.
7. As the reader, I want “Use generated plate” when the file has no cover, so that reset still has a
   clear meaning.
8. As the reader, I want a few keyless Open Library cover candidates for the matched edition, so that
   I can fix a missing or ugly cover without leaving the app.
9. As the reader, I want each online candidate labelled with its source, edition title, author and year,
   so that I can avoid choosing a different edition’s jacket.
10. As the reader, I want an explicit “Find covers” action if I open the chooser before a match exists,
    so that the app does not make a network request just because I tapped the cover.
11. As the reader, I want online candidates limited to a small, ordered set, so that the chooser is a
    decision, not an endless gallery.
12. As the reader, I want a clearly labelled “Search Open Library” fallback when the edition is
    ambiguous, so that I can pick the right edition deliberately.
13. As the reader, I want search results to show enough edition detail to distinguish them, so that I
    do not choose a cover by thumbnail alone.
14. As the reader, I want to choose an image from my device, so that I can use a scan, photo or
    alternate jacket I already have.
15. As the reader, I want the device picker to be the Android system picker, so that the app does not
    need broad storage access.
16. As the reader, I want a chosen device image to stay local, so that it is never uploaded anywhere.
17. As the reader, I want every candidate previewed at phone size in the existing cover frame, so that
    I see how it will actually look on the shelf and in the Flip.
18. As the reader, I want the preview fitted without cropping the artwork, so that titles and author
    names near the edges are not cut off.
19. As the reader, I want an explicit “Use this cover” button, so that browsing candidates cannot
    change the book by accident.
20. As the reader, I want the current cover marked as current, so that I do not “choose” it again by
    mistake.
21. As the reader, I want to cancel the chooser without changing anything, so that opening it is safe.
22. As the reader, I want a broken, tiny or unreadable candidate rejected with a clear message, so that
    a bad image cannot replace a good cover.
23. As the reader, I want a low-resolution or landscape image to be allowed only with a clear warning,
    so that I can still make an informed manual choice.
24. As the reader, I want the chosen cover cached in the existing 600×900 JPEG cache, so that the shelf
    and Flip stay fast and consistent.
25. As the reader, I want the book file left untouched, so that choosing a cover never modifies my
    library.
26. As the reader, I want my chosen cover marked as manual, so that later automatic enrichment,
    refresh, batch or rescan never replaces it.
27. As the reader, I want the source of my chosen cover remembered, so that the Flip can say “Cover
    from Open Library” or “Cover chosen from this device”.
28. As the reader, I want “Reset to original” to also restore the original provenance, so that the Flip
    stops attributing a cover to a source that no longer supplied it.
29. As the reader, I want a failed online cover lookup to leave the chooser and current cover intact, so
    that a network problem is not destructive.
30. As the reader, I want rate-limit and offline messages in the chooser, so that I know why no online
    candidates appeared.
31. As the reader, I want online candidates fetched only when I ask, so that tapping the cover does not
    silently send my book to a service.
32. As the reader, I want the chooser to work fully offline for local, generated and previously cached
    covers, so that cover correction does not depend on a connection.
33. As the reader, I want the chooser to use the same Open Library rate limits and attribution as
    automatic lookup, so that the app remains a good citizen.
34. As the reader, I want the chooser to be the only place a real embedded or rendered cover is
    replaced, so that automatic metadata lookup can never silently swap it.
35. As the reader, I want the chooser visually consistent with the Victorian Flip, so that it feels like
    part of the reading room.
36. As the reader, I want large touch targets and screen-reader labels for every candidate and action,
    so that the chooser is usable with the rest of the app.
37. As the reader, I want reduced-motion support, so that opening and closing the chooser is comfortable.
38. As the reader, I want my manually chosen cover backed up and restored, so that a reinstall does not
    lose a correction I made by hand.
39. As the reader, I want “Reset to original” to remain available after a restore, so that a backup
    never traps me with a cover I no longer want.
40. As the reader, I want automatic lookup and the manual chooser to agree about provenance, so that
    “manual” always wins and the UI never claims a cover came from the wrong place.

## Implementation Decisions

### Entry points and interaction

- Tapping the cover in the Flip opens the cover chooser. The cover frame gets a visible affordance
  (a small brass “Change cover” label or equivalent) without disturbing the composition.
- The existing overflow menu gains a “Change cover…” item as a keyboard/accessibility-friendly second
  entry point.
- The chooser is a bottom sheet or an in-place layer consistent with the existing Flip motion. It is
  dismissible by the scrim, Android back, Escape and a visible close control. Opening it does not
  change the book.
- The sheet has four groups, in order:
  1. **Current** — the cover currently shown, marked as current.
  2. **From this book** — the embedded/rendered file cover when one exists, and the generated plate
     when no file cover exists.
  3. **From Open Library** — a small set of edition-linked candidates, with a “Find covers” action if
     none have been loaded, plus a clearly labelled “Search Open Library” path for ambiguous editions.
  4. **From this device** — a system image-picker action.
- The selected candidate is previewed in the existing phone-sized cover frame. **Use this cover** is
  the only action that writes. Cancel/dismiss leaves everything unchanged.
- Automatic lookup never opens this sheet, never auto-selects a candidate, and never starts a cover
  carousel.

### Candidate sources

- **File cover.** The embedded EPUB cover or PDF-rendered page, if present. This is the default and
  the reset target. Re-selecting it is equivalent to resetting to the file cover.
- **Generated plate.** The deterministic aubergine/brass plate used when extraction fails. It remains
  available as an explicit choice and as the reset target when there is no file cover.
- **Open Library edition covers.** Prefer covers attached to the matched edition key. Show at most
  four candidates, in a stable order (edition cover list order, de-duplicated by cover ID). Each shows
  the source and enough edition context to judge it.
- **Open Library search covers.** If the book has no high-confidence edition match, the sheet may
  offer a “Search Open Library” action. Results show title, author, year, publisher and cover; selecting
  a result is an explicit edition choice. This is a manual path only and never feeds the automatic
  confidence rules.
- **Device image.** Use the Android system photo/file picker through the existing platform seam. The
  picker returns an opaque token or bytes; the UI never receives a filesystem path. The image is
  copied into the app’s cover cache and never uploaded.
- Only keyless sources are allowed. No API-key field, OAuth token, paid source or hidden shared secret
  is introduced.

### Preview and cover cache

- Preview all candidates in the existing 600×900 cover frame at phone size, using the same
  contain-style fit as the Flip. Do not crop the artwork by default.
- The chosen image is decoded, validated and normalised into the existing content-addressed JPEG cache
  (600×900, JPEG q80, neutral plate for letterboxing). This is the same cache and pipeline used by
  file and automatic online covers.
- Reject unreadable, corrupt, zero-byte, animated or unsupported-format images with a clear message.
  Reject extremely small images by default (for example below 200×300). Allow a low-resolution or
  landscape image only after an explicit warning, because the reader may deliberately choose a scan
  or photograph.
- Keep the source bytes until the transaction commits, then make the new cache file the active cover
  and clean up any unreferenced temporary file. A failed write leaves the old cover active.
- Online candidate thumbnails are ephemeral session data; only the chosen cover is added to the
  catalogue cache. Do not bulk-download a gallery.

### Provenance, protection and reset

- A chosen cover records both **where it came from** (`embedded`, `rendered`, `generated`,
  `open_library`, `device`) and **that it was chosen manually**. The manual flag is the protection
  bit; the source is for attribution.
- The manual flag prevents automatic enrichment, refresh, batch or rescan from replacing the cover.
  Automatic lookup may still refresh a missing blurb; it may not touch a manually chosen cover.
- “Use this cover” is an explicit replacement, even when the current cover is a real embedded or
  rendered cover. This is the only path allowed to replace a real cover.
- **Reset to original** restores the file’s embedded/rendered cover and its original source when one
  exists. If the file has no cover, the action becomes **Use generated plate** and restores the
  generated source. Reset clears the manual cover flag and the manual source attribution.
- Resetting does not alter the book file, its other metadata, labels, reading state or placement.
- If the original file cover later changes because the file itself changed on a rescan, the chooser’s
  original candidate should reflect the new file cover; a manual cover remains manual until reset.
- Backups include the manually chosen cover and its provenance. The cover cache is content-addressed,
  so the existing backup cover handling can carry it without exposing paths.

### Online lookup inside the chooser

- If a matched edition with cover candidates already exists from automatic enrichment, the sheet may
  use those cached candidates without a new request. Otherwise it shows **Find covers** and waits for
  an explicit tap.
- Fetch at most one edition’s cover list per open, followed by at most four cover thumbnails. For a
  search path, one Open Library search request returns the candidate editions; fetch a thumbnail only
  for the result the reader selects or for a short visible list.
- Use the same Open Library `User-Agent`, rate limits and cover-download pacing as automatic
  enrichment. If a cover list or thumbnail fails, show the failure in the sheet and keep the current
  cover. Do not retry indefinitely.
- Cancellation closes the sheet’s requests. A late candidate or thumbnail is discarded if the sheet
  has closed or the book has changed.
- No online request is made merely by opening the cover; the reader must press **Find covers** or
  **Search Open Library**. Tapping the cover is not consent to send the book anywhere. This explicit
  per-action lookup is allowed even when automatic online details are Off; it is a manual request,
  not a background mode.

### Platform and service seam

- Reuse the existing `Platform` adapter between the web UI and the Tauri command API; do not call Tauri
  directly from React.
- The core command API gains a small cover-choice surface:
  - list available local cover sources and the current choice for a book;
  - look up keyless Open Library cover candidates for a book, on explicit request;
  - apply a chosen local, generated, online or device-image cover;
  - reset to the original file cover or generated plate.
- A device image crosses the seam as an opaque token or bytes with a short-lived preview, mirroring the
  backup picker’s token pattern. No raw path reaches the web layer.
- Applying a cover is transactional and idempotent: applying the same source twice is safe; a stale
  token from a closed sheet is rejected.
- The UI receives safe candidate metadata (label, source, edition context, preview URL/data) and never
  a filesystem path, API key or internal cover path.

### Data model

- Reuse the existing internal `cover_source` concept and extend it with `open_library`,
  `internet_archive` and `device` alongside `embedded`, `rendered` and `generated`.
- Add a per-book manual-cover marker or provenance row so the write rule survives refreshes and
  restores. The marker records that the current cover was chosen by the reader; the source records
  where the bytes came from.
- A manual cover that is reset returns to the file cover or generated plate and clears the marker.
- No schema change is needed for the cache file itself; the existing content-addressed cover path is
  reused.

### Visual and accessibility details

- The chooser follows the Victorian reading-room language: cream text, brass rules, muted surfaces,
  serif labels and the existing motion curve. It is not a generic photo grid.
- Candidate tiles have large touch targets, visible focus states, descriptive `aria-label`s (for
  example “Use the embedded cover” or “Preview Open Library cover for the 2019 Harper edition”), and
  a clear current/selected state.
- The phone-sized preview keeps the same aspect ratio as the Flip. Reduced motion makes opening and
  selection instant.
- Errors and warnings use the app’s existing note/alert styling and are announced to screen readers.

## Testing Decisions

- **Good tests assert what the reader sees and what changes in the book, not private helpers.** For
  this feature: “opening the cover sheet shows the current cover and original cover”, “using an Open
  Library candidate updates the Flip and marks the cover manual”, “reset restores the embedded cover
  and source”, “cancelling writes nothing”.
- **Primary seam: the core command API.** Extend the existing command-API tests with a fake cover
  provider and a fake device-image source. Prefer command-level assertions over testing image codecs or
  the sheet internals directly. The existing `Api::open_with_search` pattern is the prior art for
  injecting test providers.
- **Secondary seam: the web `Platform` mock.** Add cover-choice methods and scenarios to the existing
  Playwright platform mock so the sheet can be tested without Rust or a device.
- **Command-API cases:**
  - listing local sources returns embedded/rendered when present, generated when not, and marks the
    current source;
  - applying the embedded/rendered original sets `embedded`/`rendered` and clears the manual flag;
  - applying the generated plate sets `generated` and clears the manual flag;
  - applying an Open Library candidate caches the image, sets `open_library`, and marks it manual;
  - applying a device image copies it into the cache, sets `device`, and marks it manual;
  - a manually chosen cover is not replaced by automatic enrichment, refresh, batch or rescan;
  - reset restores the file cover and original source when one exists;
  - reset restores the generated plate when no file cover exists;
  - a broken, oversized, animated or unsupported image is rejected and the old cover remains;
  - a low-resolution/landscape device image requires the explicit warning path;
  - a stale or reused device-image token is rejected;
  - cancelling or closing the sheet leaves the old cover and provenance unchanged;
  - an online failure leaves the current cover and shows a retryable message;
  - rate-limit and offline responses do not retry forever or write anything;
  - provenance survives a backup/restore round trip;
  - no key or paid source is called anywhere in the flow.
- **Playwright cases:** tap the cover to open the sheet; see current and original; preview an online
  candidate; press “Use this cover” and see the Flip update plus the manual/provenance line; press
  reset and see the original return; choose a device image and cancel the system picker; verify that
  opening the sheet makes no network request until “Find covers” is pressed; exercise keyboard focus,
  screen-reader labels, back/Escape dismissal and reduced motion.
- **Prior art:** `core/tests/metadata.rs` for cover cache and data-URL behavior, `core/tests/scan.rs`
  for file-derived covers and rescan behavior, `core/tests/backup.rs` for cover round trips, and the
  Playwright platform mock for UI states. Do not add component-level tests below the platform seam.

## Out of Scope

- Full image editing (cropping, rotation, colour correction, filters, AI upscaling, generative fill).
- Writing a chosen cover into the EPUB/PDF file, a sidecar file, or the library folder.
- Bulk cover replacement across many books, automatic cover carousels, or background cover crawling.
- Uploading a device image to any service, sharing covers, or a public cover library.
- Keyed or paid cover services, user API keys, OAuth accounts, or a shared secret.
- Changing title, author, blurb or other metadata in this chooser; blurb editing belongs to the
  automatic enrichment spec.
- Ratings, reviews, prices, marketplace links, audiobook covers, or DRM removal.
- Changing shelf placement, reading status, labels or annotations.
- iOS, desktop and web builds.

## Further Notes

- **Why a chooser, not automatic cover cycling?** A thumbnail is not proof of the right edition. The
  automatic path can upgrade a generated/missing cover on a high-confidence match, but a real cover
  is only replaced by a person who can see the book. The chooser is the deliberate safety valve and
  also the recovery path from a wrong automatic match.
- **Original is sacred.** The file cover is always retained as the reset target. A manual choice is a
  presentation override, not a destructive edit of the book file.
- **Privacy.** Opening the chooser is local. Online candidates are fetched only after **Find covers**
  or **Search Open Library**, under the same Open Library `User-Agent`, rate limits and attribution as
  automatic enrichment. A device image never leaves the phone.
- **Licensing.** Open Library cover candidates keep their source label and a link to the matched
  edition. Internet Archive candidates, if offered through a linked `ocaid`, keep the item link and
  respect access/licence restrictions. A device image is the reader’s own material.
- **Source of truth.** When this ticket and the automatic enrichment spec disagree about who may
  replace a real cover, this ticket wins: only the explicit manual chooser may do it.
- **Delivery.** Ship this chooser with or immediately after automatic enrichment. Without it, a
  high-confidence wrong edition has no safe recovery path, and the automatic feature would encourage
  exactly the blind cover carousel the product wants to avoid.
