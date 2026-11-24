//! The catalog service: the only writer of the library database.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{Error, Result};
use crate::migrations;
use crate::models::{
    AppInfo, Book, BookDetail, BookFormat, CoverSource, Label, LibraryStatus, Placement,
    ReadingState, ReadingStatus, ScanIssue, ScanIssueReason, ScanReport, Shelf,
};
use crate::source::{FileSource, ScannedBook, collect_books};
use crate::{APP_NAME, SCHEMA_VERSION, cover, identity, metadata};

/// The one book projection, kept in one place so every query stays in sync.
const BOOK_COLUMNS: &str =
    "b.id, b.content_hash, b.quick_key, b.path, b.format, b.title, b.authors,
     b.series, b.language, b.description, b.publisher, b.published_date, b.identifier,
     b.page_count, b.cover_path, b.cover_source, b.added_at, b.shelf_id, b.slot_index,
     COALESCE(r.status, 'unread')";

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
        Ok(Self {
            conn: Mutex::new(conn),
            cover_dir,
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

    /// One book plus the cover bytes the detail panel needs.
    ///
    /// When the cache file is missing, `source` is used to re-extract or
    /// re-render the real cover; an unreadable book falls back to a generated
    /// plate. The stored `cover_source` is repaired at the same time.
    pub fn get_book_detail(&self, id: i64, source: Option<&dyn FileSource>) -> Result<BookDetail> {
        let mut book = {
            let conn = self.connection()?;
            conn.query_row(
                &format!("SELECT {BOOK_COLUMNS} {BOOK_SOURCE} WHERE b.id = ?1"),
                [id],
                book_from_row,
            )
            .optional()?
            .ok_or(Error::BookNotFound { id })?
        };

        let cached = book
            .cover_path
            .as_deref()
            .and_then(|path| fs::read(path).ok());

        let bytes = match cached {
            Some(bytes) => Some(bytes),
            None => {
                let restored = self.restore_cover(&book, source);
                if let Some((path, source)) = &restored {
                    book.cover_path = Some(path.to_string_lossy().into_owned());
                    book.cover_source = Some(*source);
                }
                restored.and_then(|(path, _)| fs::read(path).ok())
            }
        };

        let cover_data_url = bytes.map(|bytes| {
            format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        });

        Ok(BookDetail {
            book,
            cover_data_url,
        })
    }

    /// Rebuild a missing cover from the book file and record where it came from.
    fn restore_cover(
        &self,
        book: &Book,
        source: Option<&dyn FileSource>,
    ) -> Option<(PathBuf, CoverSource)> {
        let extracted = source.and_then(|source| {
            let scanned = collect_books(source)
                .ok()?
                .into_iter()
                .find(|entry| entry.path == book.path)?;
            let bytes = source.read_file(&scanned.handle).ok()?;
            metadata::extract(scanned.format, &bytes, &scanned.name).ok()
        });

        let embedded = extracted
            .as_ref()
            .and_then(|parsed| parsed.cover.as_deref());
        let embedded_source = match extracted.as_ref() {
            Some(parsed) if parsed.cover_rendered => CoverSource::Rendered,
            _ => CoverSource::Embedded,
        };
        let restored = cover::ensure(
            &self.cover_dir,
            &book.content_hash,
            embedded,
            embedded_source,
        )?;

        if let Ok(conn) = self.connection() {
            let _ = conn.execute(
                "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
                params![restored.0.to_string_lossy(), restored.1, book.id],
            );
        }
        Some(restored)
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

    /// The configured capacity for every shelf. Defaults to 12.
    pub fn shelf_capacity(&self) -> Result<i64> {
        let conn = self.connection()?;
        shelf_capacity(&conn)
    }

    /// Persist a new shelf capacity and apply it to every shelf.
    ///
    /// Shelves holding more books than the new capacity keep those books; they
    /// simply have no room for another. New shelves inherit this capacity.
    pub fn set_shelf_capacity(&self, capacity: i64) -> Result<i64> {
        if capacity < 1 {
            return Err(Error::InvalidCapacity);
        }
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![SHELF_CAPACITY, capacity.to_string(), unix_timestamp()],
        )?;
        tx.execute("UPDATE shelves SET capacity = ?1", [capacity])?;
        tx.commit()?;
        Ok(capacity)
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

    /// Walk `source` and reconcile the catalog with it by content hash.
    ///
    /// A renamed or moved file keeps its book id, shelf and reading state.
    /// Identical bytes at two paths produce one book. New hashes are parsed and
    /// placed on the lowest shelf with room. Hashes that vanished are marked
    /// finished and keep their records and spines. Running this twice changes
    /// nothing.
    pub fn scan(&self, source: &dyn FileSource) -> Result<ScanReport> {
        let found = collect_books(source)?;
        let now = unix_timestamp();
        let mut skipped = Vec::new();
        let mut hashed = Vec::with_capacity(found.len());

        // Quick keys already in the catalog let an unchanged rescan skip the
        // full read entirely. The full hash still decides duplicates.
        let known_quick_keys = {
            let conn = self.connection()?;
            let mut statement = conn
                .prepare("SELECT quick_key, content_hash FROM books WHERE quick_key IS NOT NULL")?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            rows.collect::<std::result::Result<HashMap<_, _>, _>>()?
        };

        for file in found {
            let quick = match source.read_quick(&file.handle) {
                Ok(quick) => quick,
                Err(_) => {
                    skipped.push(ScanIssue {
                        name: file.name,
                        reason: ScanIssueReason::Unreadable,
                    });
                    continue;
                }
            };
            let quick_key = identity::quick_key_from_parts(quick.length, &quick.head, &quick.tail);

            if let Some(content_hash) = known_quick_keys.get(&quick_key) {
                hashed.push(HashedFile {
                    quick_key,
                    content_hash: content_hash.clone(),
                    scanned: file,
                });
                continue;
            }

            match source.read_file(&file.handle) {
                Ok(bytes) => hashed.push(HashedFile {
                    quick_key: identity::quick_key(&bytes),
                    content_hash: identity::content_hash(&bytes),
                    scanned: file,
                }),
                Err(_) => skipped.push(ScanIssue {
                    name: file.name,
                    reason: ScanIssueReason::Unreadable,
                }),
            }
        }

        // Group by content so one file can never land twice. Groups keep first
        // discovery order, which is path order, so placement is stable.
        let mut order: Vec<String> = Vec::new();
        let mut groups: HashMap<String, Vec<HashedFile>> = HashMap::new();
        for file in hashed {
            let hash = file.content_hash.clone();
            if !groups.contains_key(&hash) {
                order.push(hash.clone());
            }
            groups.entry(hash).or_default().push(file);
        }

        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        let mut existing: HashMap<String, (i64, String)> = HashMap::new();
        {
            let mut statement = tx.prepare("SELECT content_hash, id, path FROM books")?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (hash, id, path) = row?;
                existing.insert(hash, (id, path));
            }
        }

        let mut shelves = load_shelf_slots(&tx)?;
        let capacity = shelf_capacity(&tx)?;
        let mut added = 0usize;
        let mut duplicates = 0usize;
        let mut placements = Vec::new();
        let mut touched: HashSet<String> = HashSet::new();

        for hash in order {
            let group = &groups[&hash];
            duplicates += group.len().saturating_sub(1);
            let representative = &group[0];

            if let Some((_id, known_path)) = existing.get(&hash) {
                touched.insert(hash.clone());
                if !group.iter().any(|file| &file.scanned.path == known_path) {
                    tx.execute(
                        "UPDATE books SET path = ?1, quick_key = ?2 WHERE content_hash = ?3",
                        params![representative.scanned.path, representative.quick_key, hash],
                    )?;
                }
                continue;
            }

            let bytes = match source.read_file(&representative.scanned.handle) {
                Ok(bytes) => bytes,
                Err(_) => {
                    skipped.push(ScanIssue {
                        name: representative.scanned.name.clone(),
                        reason: ScanIssueReason::Unreadable,
                    });
                    continue;
                }
            };
            let parsed = match metadata::extract(
                representative.scanned.format,
                &bytes,
                &representative.scanned.name,
            ) {
                Ok(parsed) => parsed,
                Err(reason) => {
                    skipped.push(ScanIssue {
                        name: representative.scanned.name.clone(),
                        reason,
                    });
                    continue;
                }
            };

            let cover = cover::ensure(
                &self.cover_dir,
                &hash,
                parsed.cover.as_deref(),
                if parsed.cover_rendered {
                    CoverSource::Rendered
                } else {
                    CoverSource::Embedded
                },
            );

            let (shelf_id, slot_index, shelf_ordinal, appended_shelf) =
                allocate_slot(&tx, &mut shelves, capacity)?;
            insert_book(
                &tx,
                NewBook {
                    scanned: &representative.scanned,
                    content_hash: &hash,
                    quick_key: &representative.quick_key,
                    metadata: &parsed,
                    cover: cover.as_ref(),
                    shelf_id,
                    slot_index,
                    added_at: now,
                },
            )?;
            let book_id = tx.last_insert_rowid();
            existing.insert(hash.clone(), (book_id, representative.scanned.path.clone()));
            placements.push(Placement {
                book_id,
                shelf_id,
                shelf_ordinal,
                appended_shelf,
            });
            touched.insert(hash.clone());
            added += 1;
        }

        let mut removed = 0usize;
        for (hash, (id, _path)) in &existing {
            if touched.contains(hash) {
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

        let total: i64 = tx.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
        tx.commit()?;

        Ok(ScanReport {
            total: total as usize,
            added,
            removed,
            duplicates,
            skipped,
            placements,
        })
    }

    /// Undo an automatic placement, removing the book record and the shelf
    /// that was appended for it.
    ///
    /// This never touches the book file: a later rescan simply adds it again.
    /// The undo is a no-op when the book has moved, is gone, or the shelf now
    /// holds another book. Only a non-seed trailing shelf can be removed.
    pub fn undo_placement(&self, book_id: i64, shelf_id: i64) -> Result<bool> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        let current_shelf: Option<i64> = tx
            .query_row(
                "SELECT shelf_id FROM books WHERE id = ?1",
                [book_id],
                |row| row.get(0),
            )
            .optional()?;
        if current_shelf != Some(shelf_id) {
            return Ok(false);
        }

        let shelf: Option<(i64, i64)> = tx
            .query_row(
                "SELECT ordinal, capacity FROM shelves WHERE id = ?1",
                [shelf_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((ordinal, _capacity)) = shelf else {
            return Ok(false);
        };
        let books_on_shelf: i64 = tx.query_row(
            "SELECT COUNT(*) FROM books WHERE shelf_id = ?1",
            [shelf_id],
            |row| row.get(0),
        )?;
        let last_ordinal: i64 = tx.query_row(
            "SELECT COALESCE(MAX(ordinal), -1) FROM shelves",
            [],
            |row| row.get(0),
        )?;
        if books_on_shelf != 1 || ordinal == 0 || ordinal != last_ordinal {
            return Ok(false);
        }

        tx.execute("DELETE FROM books WHERE id = ?1", [book_id])?;
        tx.execute("DELETE FROM shelves WHERE id = ?1", [shelf_id])?;
        tx.commit()?;
        Ok(true)
    }

    /// A book's reading position, defaulting to unread when it has no row.
    ///
    /// This is the seam the reading surface (ticket 06) will drive; ticket 03
    /// tests use it to prove a rename keeps progress and locator.
    pub fn reading_state(&self, book_id: i64) -> Result<ReadingState> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let state = conn
            .query_row(
                "SELECT status, status_source, progress, locator
                 FROM reading_state WHERE book_id = ?1",
                [book_id],
                |row| {
                    Ok(ReadingState {
                        status: row.get(0)?,
                        status_source: row.get(1)?,
                        progress: row.get(2)?,
                        locator: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(state.unwrap_or(ReadingState {
            status: ReadingStatus::Unread,
            status_source: "auto".to_owned(),
            progress: 0.0,
            locator: None,
        }))
    }

    /// Set reading status, progress and locator, as a manual override.
    pub fn set_reading_state(
        &self,
        book_id: i64,
        status: ReadingStatus,
        progress: f64,
        locator: Option<&str>,
    ) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        conn.execute(
            "INSERT INTO reading_state (book_id, status, status_source, progress, locator, last_opened_at)
             VALUES (?1, ?2, 'manual', ?3, ?4, ?5)
             ON CONFLICT(book_id) DO UPDATE SET
                 status = excluded.status,
                 status_source = 'manual',
                 progress = excluded.progress,
                 locator = excluded.locator,
                 last_opened_at = excluded.last_opened_at",
            params![book_id, status, progress, locator, unix_timestamp()],
        )?;
        Ok(())
    }

    /// Every label, in creation order.
    pub fn list_labels(&self) -> Result<Vec<Label>> {
        let conn = self.connection()?;
        let mut statement = conn
            .prepare("SELECT id, name, colour, created_at FROM labels ORDER BY created_at, id")?;
        let labels = statement
            .query_map([], label_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(labels)
    }

    /// Create a reusable label.
    pub fn create_label(&self, name: &str, colour: &str) -> Result<Label> {
        let conn = self.connection()?;
        conn.execute(
            "INSERT INTO labels (name, colour, created_at) VALUES (?1, ?2, ?3)",
            params![name, colour, unix_timestamp()],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, name, colour, created_at FROM labels WHERE id = ?1",
            [id],
            label_from_row,
        )
        .map_err(Error::from)
    }

    /// Attach a label to a book; attaching twice is a no-op.
    pub fn attach_label(&self, book_id: i64, label_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO book_labels (book_id, label_id) VALUES (?1, ?2)",
            params![book_id, label_id],
        )?;
        Ok(())
    }

    /// Labels worn by one book, in creation order.
    pub fn labels_for_book(&self, book_id: i64) -> Result<Vec<Label>> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let mut statement = conn.prepare(
            "SELECT l.id, l.name, l.colour, l.created_at
             FROM labels l JOIN book_labels bl ON bl.label_id = l.id
             WHERE bl.book_id = ?1
             ORDER BY l.created_at, l.id",
        )?;
        let labels = statement
            .query_map([book_id], label_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(labels)
    }
}

fn ensure_book(conn: &Connection, book_id: i64) -> Result<()> {
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM books WHERE id = ?1", [book_id], |row| {
            row.get(0)
        })
        .optional()?;
    match exists {
        Some(_) => Ok(()),
        None => Err(Error::BookNotFound { id: book_id }),
    }
}

fn label_from_row(row: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(0)?,
        name: row.get(1)?,
        colour: row.get(2)?,
        created_at: row.get(3)?,
    })
}

struct HashedFile {
    scanned: ScannedBook,
    content_hash: String,
    quick_key: String,
}

struct ShelfSlots {
    id: i64,
    ordinal: i64,
    capacity: i64,
    used: HashSet<i64>,
}

fn load_shelf_slots(conn: &Connection) -> Result<Vec<ShelfSlots>> {
    let mut shelves = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT id, ordinal, capacity FROM shelves ORDER BY ordinal")?;
        let rows = statement.query_map([], |row| {
            Ok(ShelfSlots {
                id: row.get(0)?,
                ordinal: row.get(1)?,
                capacity: row.get(2)?,
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
) -> Result<(i64, i64, i64, bool)> {
    // Lowest shelf with room, in ordinal order.
    for shelf in shelves.iter_mut() {
        if (shelf.used.len() as i64) < shelf.capacity {
            let mut slot = 0;
            while shelf.used.contains(&slot) {
                slot += 1;
            }
            shelf.used.insert(slot);
            return Ok((shelf.id, slot, shelf.ordinal, false));
        }
    }

    // Every shelf is full: append one and put the book at its first slot.
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
        ordinal,
        capacity,
        used: HashSet::from([0]),
    });
    Ok((id, 0, ordinal, true))
}

/// Everything needed to insert one newly discovered book.
struct NewBook<'a> {
    scanned: &'a ScannedBook,
    content_hash: &'a str,
    quick_key: &'a str,
    metadata: &'a metadata::ParsedMetadata,
    cover: Option<&'a (PathBuf, CoverSource)>,
    shelf_id: i64,
    slot_index: i64,
    added_at: i64,
}

fn insert_book(conn: &Connection, book: NewBook<'_>) -> Result<()> {
    let NewBook {
        scanned,
        content_hash,
        quick_key,
        metadata,
        cover,
        shelf_id,
        slot_index,
        added_at,
    } = book;
    let authors = serde_json::to_string(&metadata.authors)
        .map_err(|error| Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error)))?;
    let cover_path = cover.map(|(path, _)| path.to_string_lossy().into_owned());
    let cover_source = cover.map(|(_, source)| *source);
    // The final fallback must never show the extension on a shelf.
    let fallback_title = scanned
        .name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(&scanned.name);

    conn.execute(
        "INSERT INTO books (
             content_hash, quick_key, path, format, title, authors, series, language,
             description, publisher, published_date, identifier, page_count, cover_path,
             cover_source, added_at, shelf_id, slot_index
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            content_hash,
            quick_key,
            scanned.path,
            scanned.format,
            metadata.title.as_deref().unwrap_or(fallback_title),
            authors,
            metadata.series,
            metadata.language,
            metadata.description,
            metadata.publisher,
            metadata.published_date,
            metadata.identifier,
            metadata.page_count,
            cover_path,
            cover_source,
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
        page_count: row.get(13)?,
        cover_path: row.get(14)?,
        cover_source: row.get(15)?,
        added_at: row.get(16)?,
        shelf_id: row.get(17)?,
        slot_index: row.get(18)?,
        reading_status: row.get::<_, ReadingStatus>(19)?,
    })
}
