# Real-jacket shelf render — 2026-11-28

Presentation evidence only, captured after 0.1.20 shipped. The shelf is the real app
(Vite dev build of the tagged working tree) with mock books, one real jacket per book, and the
exact order and statuses from the user's shelf. No production code was changed for this render.

## Files

| File | What |
|---|---|
| `real-shelf-390@2x.png` | Seven-book shelf at 390 CSS px, DPR 2 |
| `real-shelf-360@2x.png` | Same shelf at 360 CSS px, DPR 2 |
| `real-closeup-rpo-needful@2x.png` | RPO + Needful Things, full spine height, 2x |
| `real-closeup-rpo-whisper@2x.png` | RPO (oxblood) + The Whisper Man (brass), same slot |
| `real-report.json` | Per-book ribbon/geometry/overlap report |

Books in shelf order: The Collector (finished), The Whisper Man (finished), Needful Things
(reading), I Am Pilgrim (reading), The Shadow Friend (unread), Everyone In My Family Has Killed
Someone (reading), Ready Player One (reading).

## Resolved jackets

Open Library search (`/search.json?title=…&author=…`), then
`covers.openlibrary.org/b/id/<cover_i>-L.jpg`; RPO by ISBN, as requested.

| Book | Identifier | Cover id | Notes |
|---|---|---|---|
| The Collector | ISBN 9780330295680 | 9530690 | Pan UK paperback (cream photo jacket) |
| The Whisper Man | — | 8758647 | Open Library files Alex North under Steve Mosby (pen name) |
| Needful Things | ISBN 9780453008594 | 297609 | White/black King jacket (audiobook edition) |
| I Am Pilgrim | — | 9128395 | US Atria jacket |
| The Shadow Friend | ISBN 9780718189976 | 15179414 | UK Michael Joseph jacket; also filed under Steve Mosby |
| Everyone In My Family Has Killed Someone | — | 13260574 | Green jacket |
| Ready Player One | ISBN 9780099560432 | 8750149 | UK Arrow Books, 2012 stacks jacket |

Jackets are saved at `/tmp/opencode/covers/<slug>.jpg`; each 52:236 strip is at
`/tmp/opencode/spine-strips/<slug>.jpg` (104×472, centre crop of the full-height plate).

## What the render shows

- **Box and reserve hold on real art.** Every ribbon is 8×26 at `top: 0`, `right: 3px`; reading
  books start the title at 28px, the two finished books at 28px, and the unread Shadow Friend at
  10px. `real-report.json` reports `title: false`, `author: false`, `labels: false` for all seven.
- **Oxblood over busy art.** The ribbon is legible on RPO's orange/white stacks, I Am Pilgrim's
  cyan fingerprint, Everyone's green tools, Needful's white/black jacket, and the dark Shadow
  Friend/Whisper Man art. The brass ribbon reads strongly on The Collector's cream jacket.
- **Raw crop keeps jacket typography.** The strip is the shelf's 52:236 crop, not the engine's
  text-free reconstruction, so the jacket's own printed title can sit under the app's vertical
  title/author (e.g. The Collector's "THE COLLECTOR" at the foot, RPO's giant cover letters).
  That is art underneath the type, not a ribbon collision; the engine removes it in production.
- **Close-up status note.** The requested pair is RPO + Needful Things, but in the requested shelf
  Needful Things is **reading**, so both ribbons are oxblood. `real-closeup-rpo-whisper@2x.png`
  pairs RPO (reading) with The Whisper Man (finished) to show oxblood and brass in the same slot.
