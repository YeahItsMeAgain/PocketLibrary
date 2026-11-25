//! `PRAGMA user_version` migrations for the library database.
//!
//! Version 2 replaces the provisional path-derived identity used by ticket 02
//! with a real BLAKE3 content hash. Because those old hashes cannot be trusted,
//! the migration clears books and everything that depends on a book id (reading
//! state, annotations, book labels) and lets the launch scan rebuild the shelf
//! from the library folder. Shelves, labels and settings survive.

use rusqlite::Connection;

use crate::SCHEMA_VERSION;
use crate::error::{Error, Result};

const SCHEMA_V2: &str = r#"
CREATE TABLE shelves (
    id        INTEGER PRIMARY KEY,
    ordinal   INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
    capacity  INTEGER NOT NULL DEFAULT 12 CHECK (capacity > 0)
);

-- A fresh library opens with one empty shelf, ready for the first book.
INSERT INTO shelves (ordinal, capacity) VALUES (0, 12);

CREATE TABLE books (
    id              INTEGER PRIMARY KEY,
    content_hash    TEXT NOT NULL UNIQUE,
    quick_key       TEXT,
    path            TEXT NOT NULL,
    format          TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
    title           TEXT NOT NULL,
    authors         TEXT NOT NULL DEFAULT '[]',
    series          TEXT,
    language        TEXT,
    description     TEXT,
    publisher       TEXT,
    published_date  TEXT,
    identifier      TEXT,
    page_count      INTEGER CHECK (page_count IS NULL OR page_count >= 0),
    cover_path      TEXT,
    cover_source    TEXT CHECK (cover_source IS NULL OR cover_source IN ('embedded', 'rendered', 'generated')),
    added_at        INTEGER NOT NULL,
    shelf_id        INTEGER REFERENCES shelves(id) ON DELETE RESTRICT,
    slot_index      INTEGER CHECK (slot_index IS NULL OR slot_index >= 0),
    CHECK ((shelf_id IS NULL) = (slot_index IS NULL))
);

CREATE INDEX idx_books_shelf_slot ON books (shelf_id, slot_index);
CREATE UNIQUE INDEX idx_books_shelf_slot_unique
    ON books (shelf_id, slot_index)
    WHERE shelf_id IS NOT NULL;
CREATE INDEX idx_books_quick_key ON books (quick_key) WHERE quick_key IS NOT NULL;
CREATE INDEX idx_books_title ON books (title COLLATE NOCASE);

CREATE TABLE labels (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    colour      TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE book_labels (
    book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    label_id  INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, label_id)
);

CREATE INDEX idx_book_labels_label ON book_labels (label_id);

CREATE TABLE reading_state (
    book_id          INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'unread'
                     CHECK (status IN ('unread', 'reading', 'finished')),
    status_source    TEXT NOT NULL DEFAULT 'auto'
                     CHECK (status_source IN ('auto', 'manual')),
    progress         REAL NOT NULL DEFAULT 0
                     CHECK (progress >= 0 AND progress <= 1),
    locator          TEXT,
    last_opened_at   INTEGER,
    finished_at      INTEGER
);

CREATE INDEX idx_reading_state_status ON reading_state (status);

CREATE TABLE annotations (
    id          INTEGER PRIMARY KEY,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'bookmark')),
    colour      TEXT,
    note        TEXT,
    locator     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_annotations_book ON annotations (book_id, created_at);

CREATE TABLE downloads (
    id          INTEGER PRIMARY KEY,
    md5         TEXT,
    title       TEXT NOT NULL,
    source      TEXT,
    state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued', 'downloading', 'completed', 'failed', 'cancelled')),
    bytes       INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    created_at  INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE INDEX idx_downloads_state ON downloads (state, created_at);
CREATE INDEX idx_downloads_md5 ON downloads (md5) WHERE md5 IS NOT NULL;

CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

INSERT INTO settings (key, value, updated_at)
VALUES ('shelf_capacity', '12', unixepoch());
"#;

/// Ticket 11 rebuilds the provisional downloads table with the queue fields the
/// resolver and UI need. Pre-M2 rows had no history worth keeping.
const MIGRATE_V2_TO_V3: &str = r#"
DROP TABLE IF EXISTS downloads;
CREATE TABLE downloads (
    id          INTEGER PRIMARY KEY,
    md5         TEXT NOT NULL,
    title       TEXT NOT NULL,
    authors     TEXT NOT NULL DEFAULT '[]',
    year        INTEGER,
    format      TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
    source      TEXT NOT NULL DEFAULT '',
    mirror_urls TEXT NOT NULL DEFAULT '[]',
    state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    bytes       INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER,
    error       TEXT,
    error_code  TEXT,
    book_id     INTEGER REFERENCES books(id) ON DELETE SET NULL,
    filename    TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    finished_at INTEGER
);
CREATE INDEX idx_downloads_state ON downloads (state, created_at);
CREATE INDEX idx_downloads_md5 ON downloads (md5);
"#;

/// Ticket 11 follow-up: remember which mirror a row is using so failover is
/// visible in the queue instead of only surfacing as a terminal error.
const MIGRATE_V3_TO_V4: &str = r#"
ALTER TABLE downloads ADD COLUMN mirror TEXT;
"#;

/// Pre-release reset: path-derived hashes are invalid, so dependent book data
/// goes with the books. Labels, shelves and settings are intentionally kept.
const MIGRATE_V1_TO_V2: &str = r#"
DELETE FROM book_labels;
DELETE FROM annotations;
DELETE FROM reading_state;
DELETE FROM books;
ALTER TABLE books ADD COLUMN page_count INTEGER
    CHECK (page_count IS NULL OR page_count >= 0);
ALTER TABLE books ADD COLUMN cover_source TEXT
    CHECK (cover_source IS NULL OR cover_source IN ('embedded', 'rendered', 'generated'));
"#;

/// Bring the database up to [`SCHEMA_VERSION`], or fail if it is newer.
///
/// The migration runs in one transaction, so a failed fresh install leaves no
/// half-built catalog. Reopening an already-migrated database is a no-op.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version > SCHEMA_VERSION {
        return Err(Error::UnsupportedSchema {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    let tx = conn.transaction()?;
    if version == 0 {
        tx.execute_batch(SCHEMA_V2)?;
    } else if version == 1 {
        tx.execute_batch(MIGRATE_V1_TO_V2)?;
    }
    if version < 3 {
        tx.execute_batch(MIGRATE_V2_TO_V3)?;
    }
    if version < 4 {
        tx.execute_batch(MIGRATE_V3_TO_V4)?;
    }
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()?;
    Ok(())
}
