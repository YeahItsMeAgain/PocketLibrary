# 09 — Local data model and storage

Type: grilling
Mode: HITL
Status: open
Blocked by: 01, 07

## Question

Define the SQLite schema and on-disk storage layout.

Cover: books, shelves (ordered, with capacity and a name), placements (book on shelf at position), labels, book-label joins, reading status and its derivation, reading positions, annotations (future), acquisition/download records, and settings. Decide keys and identity, dedupe behaviour, migration strategy, what belongs in the database versus the filesystem (covers, cached extractions), where the database lives, and how the index survives a folder rescan.

The output is a schema draft with the main queries the UI needs (shelf render, filter by label/status, continue reading) and the migration rule for future versions.

## Answer

Resolved 2026-11-24.

**Storage:** SQLite `library.db` in app-private storage, WAL mode. Rust owns the schema and all queries; the web layer talks through commands. Books stay in the SAF folder; cover images are content-addressed files in app data; the DB stores paths and hashes only.

**Tables (draft):**

- `books`: `id` (internal), `content_hash` (BLAKE3, unique), `path` (mutable), `format`, embedded metadata fields, `cover_path`, `added_at`, `shelf_id`, `slot_index`.
- `shelves`: `id`, `ordinal`, `capacity`. Shelves are first-class and persisted, even though they are never sorted or named. A new row is appended when the lowest shelf with room is full. Default capacity 12, stored in settings.
- `labels`: `id`, `name` (unique), `colour`, `created_at`.
- `book_labels`: `book_id`, `label_id`, primary key both.
- `reading_state`: `book_id` PK, `status` (`unread|reading|finished`), `status_source` (`auto|manual`), `progress`, `locator` (JSON: foliate CFI + quote + progression), `last_opened_at`, `finished_at`.
- `annotations`: `id`, `book_id`, `kind` (`highlight|note|bookmark`), `colour`, `note`, `locator` (JSON), `created_at`, `updated_at`. Created in M1 even though the UI is M4.
- `downloads`: `id`, `md5`, `title`, `source`, `state`, `bytes`, `error`, `created_at`, `finished_at`; survives restart.
- `settings`: key-value table; no JSON blob.

**Identity:** internal `id` is the reference for shelves, labels, progress and annotations; `content_hash` is unique and survives rename/move; `path` is just the current location. Re-importing identical bytes is a duplicate.

**Migrations:** `PRAGMA user_version` with ordered Rust migrations.

**Media:** no EPUB/PDF copies; covers cached as content-addressed files, paths in the DB.
