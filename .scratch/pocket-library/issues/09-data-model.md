# 09 — Local data model and storage

Type: grilling
Mode: HITL
Status: open
Blocked by: 01, 07

## Question

Define the SQLite schema and on-disk storage layout.

Cover: books, shelves (ordered, with capacity and a name), placements (book on shelf at position), labels, book-label joins, reading status and its derivation, reading positions, annotations (future), acquisition/download records, and settings. Decide keys and identity, dedupe behaviour, migration strategy, what belongs in the database versus the filesystem (covers, cached extractions), where the database lives, and how the index survives a folder rescan.

The output is a schema draft with the main queries the UI needs (shelf render, filter by label/status, continue reading) and the migration rule for future versions.
