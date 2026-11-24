# 12 — Backup and external-reader handoff

Type: grilling
Mode: HITL
Status: open
Blocked by: 09

## Question

Define backup/restore and the "open in another app" path.

Backup: what is exported (database, shelf layout, labels, reading positions, annotations, cached covers), the format and versioning, where the export is written, and how import handles an existing library and conflicts. Decide what is enough for M1 versus later.

External reader: how the file is handed off on Android (content URI via a share/open intent), what happens on return, and whether reading position is shared or left to the other app. Also decide the per-book action versus the global default (built-in reader by default).
