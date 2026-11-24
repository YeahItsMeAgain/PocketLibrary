//! The catalog service: the only writer of the library database.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{Error, Result};
use crate::migrations;
use crate::models::{AppInfo, Book, BookFormat, LibraryStatus, ReadingStatus, ScanReport, Shelf};
use crate::source::{FileSource, ScannedBook, collect_books};
use crate::{APP_NAME, SCHEMA_VERSION};

/// The one book projection, kept in one place so every query stays in sync.
const BOOK_COLUMNS: &str =
    "b.id, b.content_hash, b.quick_key, b.path, b.format, b.title, b.authors,
     b.series, b.language, b.description, b.publisher, b.published_date, b.identifier,
     b.cover_path, b.added_at, b.shelf_id, b.slot_index, COALESCE(r.status, 'unread')";

const BOOK_SOURCE: &str = "FROM books b LEFT JOIN reading_state r ON r.book_id = b.id";

const LIBRARY_FOLDER_URI: &str = "library_folder_uri";
const LIBRARY_FOLDER_NAME: &str = "library_folder_name";
const SHELF_CAPACITY: &str = "shelf_capacity";
const DEFAULT_SHELF_CAPACITY: i64 = 12;

/// Handle to an open library database.
///
/// The connection is guarded so a `Service` can be shared by Tauri's managed
/// state across command invocations.
pub struct Service {
    conn: Mutex<Connection>,
}

impl Service {
    /// Open (creating if needed) the library database at `path`.
    ///
    /// Parent directories are created, pragmas applied, and migrations run.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::migrate(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| Error::LockPoisoned)
    }

    /// Identity and schema information for the running app.
    pub fn app_info(&self) -> Result<AppInfo> {
        Ok(AppInfo {
            name: APP_NAME.to_owned(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            schema_version: self.schema_version()?,
        })
    }

    fn schema_version(&self) -> Result<i64> {
        let conn = self.connection()?;
        let version = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != SCHEMA_VERSION {
            return Err(Error::UnsupportedSchema {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
        Ok(version)
    }

    /// Every book known to the library, in shelf order.
    pub fn list_books(&self) -> Result<Vec<Book>> {
        let conn = self.connection()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {BOOK_COLUMNS}
             {BOOK_SOURCE}
             ORDER BY b.shelf_id IS NULL, b.shelf_id, b.slot_index, b.title COLLATE NOCASE, b.id"
        ))?;

        let books = statement
            .query_map([], book_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(books)
    }

    /// Every shelf in ordinal order.
    pub fn list_shelves(&self) -> Result<Vec<Shelf>> {
        let conn = self.connection()?;
        let mut statement =
            conn.prepare("SELECT id, ordinal, capacity FROM shelves ORDER BY ordinal")?;

        let shelves = statement
            .query_map([], |row| {
                Ok(Shelf {
                    id: row.get(0)?,
                    ordinal: row.get(1)?,
                    capacity: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(shelves)
    }

    fn setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.connection()?;
        read_setting(&conn, key)
    }

    fn put_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, unix_timestamp()],
        )?;
        Ok(())
    }

    /// The persisted library folder token (a SAF tree URI inside the app).
    pub fn library_folder(&self) -> Result<Option<String>> {
        self.setting(LIBRARY_FOLDER_URI)
    }

    /// Remember the chosen library folder and its display name.
    pub fn set_library_folder(&self, uri: &str, name: &str) -> Result<()> {
        self.put_setting(LIBRARY_FOLDER_URI, uri)?;
        self.put_setting(LIBRARY_FOLDER_NAME, name)
    }

    /// The folder name shown in the UI, if a folder has been chosen.
    pub fn library_folder_name(&self) -> Result<Option<String>> {
        self.setting(LIBRARY_FOLDER_NAME)
    }

    /// What the UI should show for the library folder right now.
    pub fn library_status(&self, grant_valid: bool) -> Result<LibraryStatus> {
        let folder_name = self.library_folder_name()?;
        let state = if folder_name.is_none() {
            crate::models::LibraryState::NeedsFolder
        } else if grant_valid {
            crate::models::LibraryState::Ready
        } else {
            crate::models::LibraryState::Disconnected
        };
        Ok(LibraryStatus { state, folder_name })
    }

    /// Walk `source` and reconcile the catalog with it.
    ///
    /// New files become books on the lowest shelf with room. Known books keep
    /// their placement. Files that vanished are marked finished and their
    /// records and spines are kept. Running this twice changes nothing.
    pub fn scan(&self, source: &dyn FileSource) -> Result<ScanReport> {
        let found = collect_books(source)?;
        let now = unix_timestamp();
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        let mut existing: HashMap<String, i64> = HashMap::new();
        {
            let mut statement = tx.prepare("SELECT id, path FROM books")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(0)?))
            })?;
            for row in rows {
                let (path, id) = row?;
                existing.insert(path, id);
            }
        }

        let mut shelves = load_shelf_slots(&tx)?;
        let capacity = shelf_capacity(&tx)?;
        let mut added = 0usize;

        for book in &found {
            if existing.contains_key(&book.path) {
                continue;
            }

            let (shelf_id, slot_index) = allocate_slot(&tx, &mut shelves, capacity)?;
            insert_book(&tx, book, shelf_id, slot_index, now)?;
            added += 1;
        }

        let seen: HashSet<&str> = found.iter().map(|book| book.path.as_str()).collect();
        let mut removed = 0usize;
        for (path, id) in &existing {
            if seen.contains(path.as_str()) {
                continue;
            }
            // A finished book stays finished. For the first transition, update
            // only the status so an in-progress read keeps its progress and
            // manual/automatic source.
            let changed = tx.execute(
                "INSERT INTO reading_state (book_id, status, status_source, progress, finished_at)
                 VALUES (?1, 'finished', 'auto', 1, ?2)
                 ON CONFLICT(book_id) DO UPDATE SET
                     status = 'finished',
                     finished_at = excluded.finished_at
                 WHERE reading_state.status <> 'finished'",
                params![id, now],
            )?;
            removed += changed;
        }

        tx.commit()?;

        Ok(ScanReport {
            total: existing.len() + added,
            added,
            removed,
        })
    }
}

struct ShelfSlots {
    id: i64,
    capacity: i64,
    used: HashSet<i64>,
}

fn load_shelf_slots(conn: &Connection) -> Result<Vec<ShelfSlots>> {
    let mut shelves = Vec::new();
    {
        let mut statement = conn.prepare("SELECT id, capacity FROM shelves ORDER BY ordinal")?;
        let rows = statement.query_map([], |row| {
            Ok(ShelfSlots {
                id: row.get(0)?,
                capacity: row.get(1)?,
                used: HashSet::new(),
            })
        })?;
        for row in rows {
            shelves.push(row?);
        }
    }

    let mut statement =
        conn.prepare("SELECT shelf_id, slot_index FROM books WHERE shelf_id IS NOT NULL")?;
    let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
    for row in rows {
        let (shelf_id, slot_index) = row?;
        if let Some(shelf) = shelves.iter_mut().find(|shelf| shelf.id == shelf_id) {
            shelf.used.insert(slot_index);
        }
    }
    Ok(shelves)
}

fn read_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let value = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(value)
}

fn shelf_capacity(conn: &Connection) -> Result<i64> {
    Ok(read_setting(conn, SHELF_CAPACITY)?
        .and_then(|value| value.parse().ok())
        .filter(|capacity| *capacity > 0)
        .unwrap_or(DEFAULT_SHELF_CAPACITY))
}

fn allocate_slot(
    conn: &Connection,
    shelves: &mut Vec<ShelfSlots>,
    capacity: i64,
) -> Result<(i64, i64)> {
    for shelf in shelves.iter_mut() {
        if (shelf.used.len() as i64) < shelf.capacity {
            let mut slot = 0;
            while shelf.used.contains(&slot) {
                slot += 1;
            }
            shelf.used.insert(slot);
            return Ok((shelf.id, slot));
        }
    }

    let ordinal: i64 = conn.query_row(
        "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM shelves",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO shelves (ordinal, capacity) VALUES (?1, ?2)",
        params![ordinal, capacity],
    )?;
    let id = conn.last_insert_rowid();
    shelves.push(ShelfSlots {
        id,
        capacity,
        used: HashSet::from([0]),
    });
    Ok((id, 0))
}

fn insert_book(
    conn: &Connection,
    book: &ScannedBook,
    shelf_id: i64,
    slot_index: i64,
    added_at: i64,
) -> Result<()> {
    // Ticket 02 uses a stable, opaque path key so rescans are idempotent.
    // Ticket 03 replaces this with the BLAKE3 content hash.
    let placeholder_hash = blake3::hash(book.path.as_bytes()).to_hex().to_string();
    conn.execute(
        "INSERT INTO books (content_hash, path, format, title, authors, added_at, shelf_id, slot_index)
         VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?7)",
        params![
            placeholder_hash,
            book.path,
            book.format,
            book.title,
            added_at,
            shelf_id,
            slot_index
        ],
    )?;
    Ok(())
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn book_from_row(row: &Row<'_>) -> rusqlite::Result<Book> {
    let authors_json: String = row.get(6)?;
    let authors = serde_json::from_str(&authors_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;

    Ok(Book {
        id: row.get(0)?,
        content_hash: row.get(1)?,
        quick_key: row.get(2)?,
        path: row.get(3)?,
        format: row.get::<_, BookFormat>(4)?,
        title: row.get(5)?,
        authors,
        series: row.get(7)?,
        language: row.get(8)?,
        description: row.get(9)?,
        publisher: row.get(10)?,
        published_date: row.get(11)?,
        identifier: row.get(12)?,
        cover_path: row.get(13)?,
        added_at: row.get(14)?,
        shelf_id: row.get(15)?,
        slot_index: row.get(16)?,
        reading_status: row.get::<_, ReadingStatus>(17)?,
    })
}
