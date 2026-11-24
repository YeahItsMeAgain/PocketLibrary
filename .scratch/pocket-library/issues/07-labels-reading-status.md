# 07 — Labels and reading status

Type: grilling
Mode: HITL
Status: open
Blocked by:

## Question

Finalise the label model and the reading-status model, including how both appear physically.

Labels: creating from a book and from a manager; naming, colours, and sticker design; attaching several to one book; filtering semantics; rename/recolour/delete behaviour; whether labels have an order or a "pinned" state.

Reading status: the three values; the automatic rules (does opening a book set "reading"? does reaching the last page set "finished"? does reopening clear "finished"?); manual override and how it interacts with the derived value; whether status is a special label or a separate axis; the spine sticker/ribbon design; and the confirmed rule that a vanished file becomes "finished" rather than "missing", while the book record is never deleted.

Everything here should be expressible as a small state model the spec can carry.

## Answer

Resolved 2026-11-24.

### Labels

- Created from a book's flip ("add label", pick existing or type new) and managed centrally (rename, recolour, delete). A filter strip lives on the shelf.
- Rendered as a paper band on the lower spine: one per label, at most two visible plus a "+1" nub; name truncated on the spine, full name in the flip.
- Fixed palette of about eight muted Victorian colours (oxblood, forest, mustard, ink blue, sepia, and similar); no free colour picker.
- Filtering never moves books; it lays a brass-tag strip over the shelf. A label plus a status filter combine with AND; clearing is one tap.
- Deleting a label removes it from every book and deletes nothing else. Renaming propagates. A book can wear a label once. Labels have no order or pinning in M3.

### Reading status

Status is a **separate fixed axis**, not a label: `unread | reading | finished`. Labels stay free-form and user-managed; status is automatic and protected.

- First open in the reader → `reading`. Reaching the last page (or ≥98%) → `finished`. Reopening a finished book does not clear it. A manual set wins and sticks until the user changes it.
- A vanished file → `finished`; the book record is never deleted.
- **Shelf (spine):** nothing for unread, a red ribbon for reading, a gold seal for finished.
- **Cover (flip):** nothing for unread, a paper sticker showing the percentage while reading, a shiny gold achievement-style sticker when finished.

### Achievements

The user likes the achievement idea but it is post-v1. Parked in the map's Not yet specified; not part of M1–M4.
