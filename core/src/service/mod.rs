//! The catalog service: the only writer of the library database.
//!
//! `Service` is the single handle. Each submodule adds an `impl Service`
//! block for one concern, so the public API stays on one type.

mod catalog;
mod downloads;
mod edit;
mod placement;
mod reading;
mod scan;
mod settings;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use crate::backup::{self, BackupPreview, BackupReport, ImportMode};
use crate::error::{Error, Result};
use crate::metadata;
use crate::migrations;
use crate::models::AppInfo;
use crate::{APP_NAME, SCHEMA_VERSION};

pub use settings::DEFAULT_DOWNLOAD_NAMING;

/// The fixed eight-colour label palette. Every colour clears 5.56:1 against
/// the cream label text, so the UI never needs a free colour picker.
pub const LABEL_PALETTE: &[&str] = &[
    "#6e2630", // oxblood
    "#294735", // forest
    "#6b4d18", // mustard
    "#26384f", // ink blue
    "#57402d", // sepia
    "#4a2a45", // plum
    "#214d4c", // teal
    "#333336", // charcoal
];

const SHELF_CAPACITY: &str = "shelf_capacity";
const DEFAULT_SHELF_CAPACITY: i64 = 12;

/// Handle to an open library database.
///
/// The connection is guarded so a `Service` can be shared by Tauri's managed
/// state across command invocations.
pub struct Service {
    conn: Mutex<Connection>,
    cover_dir: PathBuf,
}

impl Service {
    /// Open (creating if needed) the library database at `path`.
    ///
    /// Parent directories are created, pragmas applied, and migrations run.
    /// Covers live in a sibling `covers/` directory under app data.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }

        let cover_dir = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."))
            .join("covers");
        let conn = Connection::open(path)?;
        Self::from_connection(conn, cover_dir)
    }

    fn from_connection(mut conn: Connection, cover_dir: PathBuf) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::migrate(&mut conn)?;
        Self::repair_truncated_titles(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            cover_dir,
        })
    }

    /// Repair titles that were indexed from a truncated embedded title, using
    /// the acquisition history or filename that is already in the catalogue.
    ///
    /// This runs once when the database opens so an update fixes existing
    /// libraries without waiting for the user to rescan. Normal titles never
    /// match the repair rule and are left alone.
    fn repair_truncated_titles(conn: &Connection) -> Result<()> {
        let mut statement = conn.prepare(
            "SELECT b.id, b.title, b.path,
                    (SELECT d.title FROM downloads d
                      WHERE d.book_id = b.id AND trim(d.title) <> ''
                      ORDER BY d.id DESC LIMIT 1)
             FROM books b",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut repairs = Vec::new();
        for row in rows {
            let (id, title, path, acquired_title) = row?;
            let filename = path.rsplit(['/', '\\']).next().unwrap_or(&path);
            let hint = acquired_title
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(filename);
            if let Some(repaired) = metadata::title_from_hint(&title, hint)
                && repaired != title
            {
                repairs.push((id, repaired));
            }
        }
        drop(statement);
        for (id, title) in repairs {
            conn.execute(
                "UPDATE books SET title = ?1 WHERE id = ?2",
                params![title, id],
            )?;
        }
        Ok(())
    }

    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| Error::LockPoisoned)
    }

    /// The app-data cover cache. Covers are content-addressed, never written
    /// into the library folder or a book file.
    pub(crate) fn cover_dir(&self) -> &Path {
        &self.cover_dir
    }

    /// Identity and schema information for the running app.
    pub fn app_info(&self) -> Result<AppInfo> {
        Ok(AppInfo {
            name: APP_NAME.to_owned(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            schema_version: self.schema_version()?,
        })
    }

    /// Serialise the catalogue into a `.pocketlibrary` archive.
    ///
    /// The read runs inside one transaction so the manifest is a consistent
    /// snapshot. Covers are optional; books are never included.
    pub fn export_backup(&self) -> Result<Vec<u8>> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        let bytes = backup::export(&tx, &self.cover_dir)?;
        tx.commit()?;
        Ok(bytes)
    }

    /// Inspect an archive and report matched/new books before applying it.
    pub fn preview_backup(&self, bytes: &[u8]) -> Result<BackupPreview> {
        let conn = self.connection()?;
        backup::preview(&conn, bytes)
    }

    /// Apply an archive as a merge or a replace, all in one transaction.
    pub fn import_backup(&self, bytes: &[u8], mode: ImportMode) -> Result<BackupReport> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        let report = backup::import(&tx, &self.cover_dir, bytes, mode)?;
        tx.commit()?;
        Ok(report)
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
}

fn read_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let value = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(value)
}

pub(super) fn shelf_capacity(conn: &Connection) -> Result<i64> {
    Ok(read_setting(conn, SHELF_CAPACITY)?
        .and_then(|value| value.parse().ok())
        .filter(|capacity| *capacity > 0)
        .unwrap_or(DEFAULT_SHELF_CAPACITY))
}

pub(super) fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_repairs_a_truncated_title_from_download_history() {
        let dir = tempfile::TempDir::new().expect("temporary directory");
        let path = dir.path().join("library.db");
        let service = Service::open(&path).expect("open service");
        {
            let conn = service.connection().expect("connection");
            conn.execute(
                "INSERT INTO books (content_hash, path, format, title, authors, added_at)
                 VALUES ('hash', 'Alex North - The Whisper Man (2019).epub', 'epub', 'MAN', '[]', 1)",
                [],
            )
            .expect("insert book");
            let book_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO downloads
                    (md5, title, format, source, mirror_urls, state, bytes, book_id, created_at, updated_at)
                 VALUES ('md5', 'The Whisper Man ebook', 'epub', 'libgen.vg', '[]', 'completed', 1, ?1, 1, 1)",
                [book_id],
            )
            .expect("insert download");
        }
        drop(service);

        let reopened = Service::open(&path).expect("reopen service");
        let books = reopened.list_books().expect("list books");
        assert_eq!(books[0].title, "The Whisper Man");
    }

    #[test]
    fn opening_leaves_a_normal_title_alone() {
        let dir = tempfile::TempDir::new().expect("temporary directory");
        let path = dir.path().join("library.db");
        let service = Service::open(&path).expect("open service");
        {
            let conn = service.connection().expect("connection");
            conn.execute(
                "INSERT INTO books (content_hash, path, format, title, authors, added_at)
                 VALUES ('hash', 'Something Else.epub', 'epub', 'The Whisper Man', '[]', 1)",
                [],
            )
            .expect("insert book");
        }
        drop(service);

        let reopened = Service::open(&path).expect("reopen service");
        assert_eq!(
            reopened.list_books().expect("list books")[0].title,
            "The Whisper Man"
        );
    }
}
