//! `PRAGMA user_version` migrations for the library database.

use rusqlite::Connection;

use crate::error::{Error, Result};
use crate::SCHEMA_VERSION;

const SCHEMA_V1: &str = r#"
CREATE TABLE shelves (
    id        INTEGER PRIMARY KEY,
    ordinal   INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
    capacity  INTEGER NOT NULL DEFAULT 12 CHECK (capacity > 0)
);

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
    cover_path      TEXT,
    added_at        INTEGER NOT NULL,
    shelf_id        INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
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

/// Bring the database up to [`SCHEMA_VERSION`], or fail if it is newer.
///
/// The migration runs in one transaction, so a failed fresh install leaves no
/// half-built catalogue. Reopening an already-migrated database is a no-op.
pub fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version != 0 {
        return Err(Error::UnsupportedSchema {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    let tx = conn.transaction()?;
    tx.execute_batch(SCHEMA_V1)?;
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()?;
    Ok(())
}
