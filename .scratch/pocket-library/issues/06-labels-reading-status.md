# 06: Labels and reading status

**What to build:** Reusable coloured labels and a fixed reading status, both visible on the shelf. Labels filter without moving books. Status updates automatically from reading and can be overridden by hand.

**Blocked by:** 04

**Status:** awaiting-device-test

- [x] Labels can be created, renamed, recoloured, attached, detached, and deleted; deleting a label touches no book
- [x] A book can wear several labels; a label appears once per book
- [x] Spines show at most two label bands plus a "+1" nub; the detail shows full names with readable contrast
- [x] Filtering dims non-matching books, never moves them, combines label + status with AND, and clears in one action
- [ ] Opening a book sets reading; the last page or ≥98% sets finished; reopening does not clear finished
- [x] A manual status override wins and persists; a vanished file becomes finished and is never deleted
- [x] Shelf shows ribbon for reading and gold seal for finished; the open cover shows a percentage sticker, or a gold sticker when finished
- [x] Reading status is absent from the book detail

## Notes

**Core.** The catalog now exposes label usage counts, rename, recolour, delete, attach and detach through the command API. Colours are validated against one fixed eight-swatch palette (all clear 5.56:1 against cream text), names are trimmed and unique case-insensitively, attaching twice is a no-op, and deleting a label cascades only through `book_labels`. `filter_books(label_ids, status)` returns book ids in shelf order, requiring every selected label (AND) plus the optional status. `Book` now carries its labels so the wall renders bands from one `list_books` call.

Reading status stays a separate axis. `set_reading_status` writes a manual override that later auto updates cannot replace. `record_open` and `record_progress` implement the ticket-07 auto rules in the service: first open marks reading, ≥98% or the last page marks finished, reopening never clears finished, and manual beats auto. The reader is deliberately not wired yet.

**UI.** A compact brass filter strip above the shelves offers label chips with usage counts, status chips, a live match count, one-tap clear and **Manage labels**. Filtering only adds a dim class to non-matching spines; the model order and geometry are untouched, so drag still works. The label manager supports create, inline rename, palette recolour and delete. Spines show up to two truncated coloured paper bands plus a `+1` nub alongside the existing ribbon/seal. The detail renders full-name cream-on-colour chips with attach/detach, a paper percentage or gold cover sticker, and a status control in the cover area rather than a metadata row.

**Tests.** `core/tests/labels.rs` covers CRUD, duplicate attach, usage counts, delete leaving books, the fixed palette, manual override persistence, auto open/finish, and label × status filter intersections. `tests/e2e/labels.spec.ts` covers create/attach/spine band, filter dimming without movement plus status AND, delete leaving books, all three sticker states, and the manage-labels rename/recolour flow. Host `cargo test`, `npx tsc --noEmit`, `npm run build` and all 23 Playwright tests pass.

**Deferred to 07.** The reader does not yet call `record_open` or `record_progress`, so the auto-on-open/last-page UI box stays unticked; the service operations exist and are tested.

**Device-only checks.** Touch hit targets for the filter strip and palette swatches, the feel of dimmed-but-draggable spines, label-band legibility at narrow spine widths, and the cover sticker's contrast on real covers still need a 390x844 phone pass.
