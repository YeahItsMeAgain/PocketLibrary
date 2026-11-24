# 06: Labels and reading status

**What to build:** Reusable coloured labels and a fixed reading status, both visible on the shelf. Labels filter without moving books. Status updates automatically from reading and can be overridden by hand.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Labels can be created, renamed, recoloured, attached, detached, and deleted; deleting a label touches no book
- [ ] A book can wear several labels; a label appears once per book
- [ ] Spines show at most two label bands plus a "+1" nub; the detail shows full names with readable contrast
- [ ] Filtering dims non-matching books, never moves them, combines label + status with AND, and clears in one action
- [ ] Opening a book sets reading; the last page or ≥98% sets finished; reopening does not clear finished
- [ ] A manual status override wins and persists; a vanished file becomes finished and is never deleted
- [ ] Shelf shows ribbon for reading and gold seal for finished; the open cover shows a percentage sticker, or a gold sticker when finished
- [ ] Reading status is absent from the book detail
