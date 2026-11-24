# 12 — Backup and external-reader handoff

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 09

## Question

Define backup/restore and the "open in another app" path.

Backup: what is exported (database, shelf layout, labels, reading positions, annotations, cached covers), the format and versioning, where the export is written, and how import handles an existing library and conflicts. Decide what is enough for M1 versus later.

External reader: how the file is handed off on Android (content URI via a share/open intent), what happens on return, and whether reading position is shared or left to the other app. Also decide the per-book action versus the global default (built-in reader by default).

## Answer

Resolved 2026-11-24.

- **Backup contents:** one versioned `.pocketlibrary` zip containing `manifest.json` — shelves and placements, labels, reading state and positions, annotations, settings, download history — plus optional cached covers. Books themselves are not included; they already live in the library folder. The manifest carries a schema version for migration.
- **Export/import transport:** system file picker (SAF) for both save and restore, so the user can choose Downloads, Drive, SD card, etc. The share sheet is an optional extra. Nothing is written into the library folder automatically.
- **Import:** merge by content hash by default — keep existing entries, add missing ones, show matched/new counts, never delete. Never overwrite a newer reading position. A clearly labelled "Replace current library data" action exists behind explicit confirmation.
- **Automation:** explicit export is the contract. Android auto-backup may additionally capture the SQLite DB as a free safety net, but the app never depends on it.
- **External reader:** hand off the file as a content URI through the Android chooser. Built-in reader remains the default. No reading-position sync; on return the book is marked `reading` unless already `finished`. The book detail keeps the last in-app position.
