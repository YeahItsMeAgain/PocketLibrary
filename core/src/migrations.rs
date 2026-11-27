//! `PRAGMA user_version` migrations for the library database.
//!
//! Version 2 replaces the provisional path-derived identity used by ticket 02
//! with a real BLAKE3 content hash. Because those old hashes cannot be trusted,
//! the migration clears books and everything that depends on a book id (reading
//! state, annotations, book labels) and lets the launch scan rebuild the shelf
//! from the library folder. Shelves, labels and settings survive.

use rusqlite::Connection;

use crate::SCHEMA_VERSION;
use crate::diagnostics::{Level, log_event};
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

/// M5 adds online enrichment: file-derived originals that survive an online
/// cover or blurb, a per-field provenance table, and a cache of lookup results.
///
/// `books.cover_source` gains online and device values, and SQLite cannot alter
/// a CHECK constraint in place, so the table is rebuilt. Foreign keys are
/// switched off by [`migrate`] around this batch; the dependent tables keep
/// pointing at the new `books` table by name.
const MIGRATE_V4_TO_V5: &str = r#"
CREATE TABLE books_new (
    id                  INTEGER PRIMARY KEY,
    content_hash        TEXT NOT NULL UNIQUE,
    quick_key           TEXT,
    path                TEXT NOT NULL,
    format              TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
    title               TEXT NOT NULL,
    authors             TEXT NOT NULL DEFAULT '[]',
    series              TEXT,
    language            TEXT,
    description         TEXT,
    publisher           TEXT,
    published_date      TEXT,
    identifier          TEXT,
    page_count          INTEGER CHECK (page_count IS NULL OR page_count >= 0),
    cover_path          TEXT,
    cover_source        TEXT CHECK (cover_source IS NULL OR cover_source IN (
                            'embedded', 'rendered', 'generated',
                            'open_library', 'internet_archive', 'device')),
    added_at            INTEGER NOT NULL,
    shelf_id            INTEGER REFERENCES shelves(id) ON DELETE RESTRICT,
    slot_index          INTEGER CHECK (slot_index IS NULL OR slot_index >= 0),
    file_description    TEXT,
    file_cover_path     TEXT,
    file_cover_source   TEXT CHECK (file_cover_source IS NULL OR file_cover_source IN (
                            'embedded', 'rendered', 'generated',
                            'open_library', 'internet_archive', 'device')),
    CHECK ((shelf_id IS NULL) = (slot_index IS NULL))
);

INSERT INTO books_new (
    id, content_hash, quick_key, path, format, title, authors, series, language,
    description, publisher, published_date, identifier, page_count, cover_path,
    cover_source, added_at, shelf_id, slot_index,
    file_description, file_cover_path, file_cover_source
)
SELECT
    id, content_hash, quick_key, path, format, title, authors, series, language,
    description, publisher, published_date, identifier, page_count, cover_path,
    cover_source, added_at, shelf_id, slot_index,
    description, cover_path, cover_source
FROM books;

-- The old table's CHECK still accepts `wrap`/`full-bleed` but not `art`, so the
-- rename happens while copying into the new table rather than by UPDATE.
DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE INDEX idx_books_shelf_slot ON books (shelf_id, slot_index);
CREATE UNIQUE INDEX idx_books_shelf_slot_unique
    ON books (shelf_id, slot_index)
    WHERE shelf_id IS NOT NULL;
CREATE INDEX idx_books_quick_key ON books (quick_key) WHERE quick_key IS NOT NULL;
CREATE INDEX idx_books_title ON books (title COLLATE NOCASE);

CREATE TABLE book_enrichment (
    book_id             INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    source              TEXT NOT NULL,
    matched_key         TEXT,
    confidence          TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('ok', 'no_match', 'error')),
    applied_fields      TEXT NOT NULL DEFAULT '[]',
    attribution_label   TEXT,
    attribution_url     TEXT,
    cover_keys          TEXT NOT NULL DEFAULT '[]',
    fetched_at          INTEGER NOT NULL,
    PRIMARY KEY (book_id, source)
);

CREATE TABLE field_provenance (
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    field       TEXT NOT NULL CHECK (field IN ('description', 'cover')),
    source      TEXT NOT NULL,
    source_url  TEXT,
    PRIMARY KEY (book_id, field)
);
"#;

/// M6 adds the per-book spine presentation style. The column is nullable so a
/// database written before this migration keeps working; readers treat NULL as
/// the `wrap` default.
const MIGRATE_V5_TO_V6: &str = r#"
ALTER TABLE books ADD COLUMN spine_style TEXT
    CHECK (spine_style IS NULL OR spine_style IN ('wrap', 'full-bleed', 'cloth'));
"#;

/// M7 renames the art style to `art` and adds `typography`, removing the
/// retired `full-bleed` value. Every `wrap` or `full-bleed` row folds into
/// `art`; `cloth`, `typography` and NULL survive unchanged (NULL still means
/// the Art default). SQLite cannot alter a CHECK constraint in place, so
/// `books` is rebuilt exactly as M5 does it: every column, index and the
/// foreign keys from dependent tables are kept.
const MIGRATE_V6_TO_V7: &str = r#"
CREATE TABLE books_new (
    id                  INTEGER PRIMARY KEY,
    content_hash        TEXT NOT NULL UNIQUE,
    quick_key           TEXT,
    path                TEXT NOT NULL,
    format              TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
    title               TEXT NOT NULL,
    authors             TEXT NOT NULL DEFAULT '[]',
    series              TEXT,
    language            TEXT,
    description         TEXT,
    publisher           TEXT,
    published_date      TEXT,
    identifier          TEXT,
    page_count          INTEGER CHECK (page_count IS NULL OR page_count >= 0),
    cover_path          TEXT,
    cover_source        TEXT CHECK (cover_source IS NULL OR cover_source IN (
                            'embedded', 'rendered', 'generated',
                            'open_library', 'internet_archive', 'device')),
    added_at            INTEGER NOT NULL,
    shelf_id            INTEGER REFERENCES shelves(id) ON DELETE RESTRICT,
    slot_index          INTEGER CHECK (slot_index IS NULL OR slot_index >= 0),
    file_description    TEXT,
    file_cover_path     TEXT,
    file_cover_source   TEXT CHECK (file_cover_source IS NULL OR file_cover_source IN (
                            'embedded', 'rendered', 'generated',
                            'open_library', 'internet_archive', 'device')),
    spine_style         TEXT CHECK (spine_style IS NULL OR spine_style IN (
                            'art', 'cloth', 'typography')),
    CHECK ((shelf_id IS NULL) = (slot_index IS NULL))
);

INSERT INTO books_new (
    id, content_hash, quick_key, path, format, title, authors, series, language,
    description, publisher, published_date, identifier, page_count, cover_path,
    cover_source, added_at, shelf_id, slot_index,
    file_description, file_cover_path, file_cover_source, spine_style
)
SELECT
    id, content_hash, quick_key, path, format, title, authors, series, language,
    description, publisher, published_date, identifier, page_count, cover_path,
    cover_source, added_at, shelf_id, slot_index,
    file_description, file_cover_path, file_cover_source,
    CASE spine_style
        WHEN 'wrap' THEN 'art'
        WHEN 'full-bleed' THEN 'art'
        ELSE spine_style
    END
FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE INDEX idx_books_shelf_slot ON books (shelf_id, slot_index);
CREATE UNIQUE INDEX idx_books_shelf_slot_unique
    ON books (shelf_id, slot_index)
    WHERE shelf_id IS NOT NULL;
CREATE INDEX idx_books_quick_key ON books (quick_key) WHERE quick_key IS NOT NULL;
CREATE INDEX idx_books_title ON books (title COLLATE NOCASE);
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
        log_event(
            Level::Error,
            "migrations",
            &format!("database schema {version} is newer than supported {SCHEMA_VERSION}"),
        );
        return Err(Error::UnsupportedSchema {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    if version == 0 {
        log_event(
            Level::Info,
            "migrations",
            &format!("created a new schema at version {SCHEMA_VERSION}"),
        );
    } else {
        log_event(
            Level::Info,
            "migrations",
            &format!("upgraded database schema {version} -> {SCHEMA_VERSION}"),
        );
    }

    // SQLite refuses to change foreign-key enforcement inside a transaction, so
    // the books rebuilds (v5 for `cover_source`, v7 for `spine_style`) happen
    // with enforcement off. Existing child rows are preserved and resolve the
    // new table by name.
    let rebuild_books = version < 7;
    if rebuild_books {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
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
    if version < 5 {
        tx.execute_batch(MIGRATE_V4_TO_V5)?;
    }
    if version < 6 {
        tx.execute_batch(MIGRATE_V5_TO_V6)?;
    }
    if version < 7 {
        tx.execute_batch(MIGRATE_V6_TO_V7)?;
    }
    tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    tx.commit()?;
    if rebuild_books {
        conn.pragma_update(None, "foreign_keys", "ON")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build the exact schema M6 left behind: version 2 plus every later batch.
    fn version_six(conn: &Connection) {
        conn.execute_batch(SCHEMA_V2).expect("version-two schema");
        conn.execute_batch(MIGRATE_V2_TO_V3)
            .expect("downloads rebuild");
        conn.execute_batch(MIGRATE_V3_TO_V4).expect("mirror column");
        conn.execute_batch(MIGRATE_V4_TO_V5)
            .expect("enrichment rebuild");
        conn.execute_batch(MIGRATE_V5_TO_V6)
            .expect("spine style column");
        conn.pragma_update(None, "user_version", 6)
            .expect("mark as version six");
    }

    #[test]
    fn version_five_gains_the_three_spine_styles() {
        let mut conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(SCHEMA_V2).expect("version-two schema");
        conn.execute_batch(MIGRATE_V2_TO_V3)
            .expect("downloads rebuild");
        conn.execute_batch(MIGRATE_V3_TO_V4).expect("mirror column");
        conn.execute_batch(MIGRATE_V4_TO_V5)
            .expect("enrichment rebuild");
        conn.pragma_update(None, "user_version", 5)
            .expect("mark as version five");

        migrate(&mut conn).expect("migrate to the current version");

        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read version");
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(version, 7);

        conn.execute(
            "INSERT INTO books (content_hash, path, format, title, authors, added_at)
             VALUES ('hash', 'book.epub', 'epub', 'A Book', '[]', 1)",
            [],
        )
        .expect("insert book");
        let style: Option<String> = conn
            .query_row("SELECT spine_style FROM books", [], |row| row.get(0))
            .expect("read style");
        assert_eq!(style, None, "NULL means the Art default");

        conn.execute(
            "UPDATE books SET spine_style = 'art' WHERE content_hash = 'hash'",
            [],
        )
        .expect("art is a valid style");
        conn.execute(
            "UPDATE books SET spine_style = 'cloth' WHERE content_hash = 'hash'",
            [],
        )
        .expect("cloth is a valid style");
        conn.execute(
            "UPDATE books SET spine_style = 'typography' WHERE content_hash = 'hash'",
            [],
        )
        .expect("typography is a valid style");
        conn.execute(
            "UPDATE books SET spine_style = 'wrap' WHERE content_hash = 'hash'",
            [],
        )
        .expect_err("wrap is no longer a valid style");
        conn.execute(
            "UPDATE books SET spine_style = 'full-bleed' WHERE content_hash = 'hash'",
            [],
        )
        .expect_err("full-bleed is no longer a valid style");
        conn.execute(
            "UPDATE books SET spine_style = 'hybrid' WHERE content_hash = 'hash'",
            [],
        )
        .expect_err("unknown styles are rejected");
    }

    #[test]
    fn version_six_migrates_art_and_keeps_styles_and_children() {
        let mut conn = Connection::open_in_memory().expect("in-memory database");
        version_six(&conn);

        for (id, style) in [
            (1, Some("wrap")),
            (2, Some("cloth")),
            (3, None),
            (4, Some("full-bleed")),
        ] {
            conn.execute(
                "INSERT INTO books (
                    id, content_hash, path, format, title, authors, added_at,
                    shelf_id, slot_index, spine_style
                 ) VALUES (?1, ?2, ?3, 'epub', ?4, '[]', 1, 1, ?5, ?6)",
                rusqlite::params![
                    id,
                    format!("hash-{id}"),
                    format!("book-{id}.epub"),
                    format!("Book {id}"),
                    id - 1,
                    style
                ],
            )
            .expect("insert pre-migration book");
        }
        conn.execute(
            "INSERT INTO reading_state (book_id, status) VALUES (1, 'reading')",
            [],
        )
        .expect("child reading state");
        conn.execute(
            "INSERT INTO labels (id, name, colour, created_at)
             VALUES (1, 'Read', '#6e2630', 1)",
            [],
        )
        .expect("child label");
        conn.execute(
            "INSERT INTO book_labels (book_id, label_id) VALUES (2, 1)",
            [],
        )
        .expect("book label");

        migrate(&mut conn).expect("migrate six to seven");

        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read version");
        assert_eq!(version, 7);

        let styles: Vec<Option<String>> = conn
            .prepare("SELECT spine_style FROM books ORDER BY id")
            .expect("prepare styles")
            .query_map([], |row| row.get(0))
            .expect("query styles")
            .collect::<rusqlite::Result<_>>()
            .expect("read styles");
        assert_eq!(
            styles,
            vec![
                Some("art".into()),
                Some("cloth".into()),
                None,
                Some("art".into())
            ],
            "wrap and full-bleed become art; cloth and NULL survive"
        );

        conn.execute(
            "UPDATE books SET spine_style = 'typography' WHERE id = 3",
            [],
        )
        .expect("typography is accepted");
        conn.execute("UPDATE books SET spine_style = 'wrap' WHERE id = 3", [])
            .expect_err("wrap is rejected");
        conn.execute(
            "UPDATE books SET spine_style = 'full-bleed' WHERE id = 3",
            [],
        )
        .expect_err("full-bleed is rejected");
        conn.execute("UPDATE books SET spine_style = 'hybrid' WHERE id = 3", [])
            .expect_err("unknown styles are still rejected");

        let reading: String = conn
            .query_row(
                "SELECT status FROM reading_state WHERE book_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("child reading state survives");
        assert_eq!(reading, "reading");
        let labels: i64 = conn
            .query_row("SELECT COUNT(*) FROM book_labels", [], |row| row.get(0))
            .expect("book label survives");
        assert_eq!(labels, 1);

        // The indices are recreated on the rebuilt table.
        let indices: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = 'books'
                   AND name IN (
                     'idx_books_shelf_slot', 'idx_books_shelf_slot_unique',
                     'idx_books_quick_key', 'idx_books_title'
                   )",
                [],
                |row| row.get(0),
            )
            .expect("read indices");
        assert_eq!(indices, 4);
    }
}
