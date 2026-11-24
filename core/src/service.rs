//! The catalog service: the only writer of the library database.

use std::fs;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, Row};

use crate::error::{Error, Result};
use crate::migrations;
use crate::models::{AppInfo, Book, BookFormat, Shelf};
use crate::{APP_NAME, SCHEMA_VERSION};

/// The one book projection, kept in one place so every query stays in sync.
const BOOK_COLUMNS: &str = "id, content_hash, quick_key, path, format, title, authors,
     series, language, description, publisher, published_date, identifier,
     cover_path, added_at, shelf_id, slot_index";

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
             FROM books
             ORDER BY shelf_id IS NULL, shelf_id, slot_index, title COLLATE NOCASE, id"
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
    })
}
