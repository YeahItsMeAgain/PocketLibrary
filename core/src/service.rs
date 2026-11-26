//! The catalog service: the only writer of the library database.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::backup::{self, BackupPreview, BackupReport, ImportMode};
use crate::error::{Error, Result};
use crate::migrations;
use crate::models::{
    Annotation, AnnotationKind, AppInfo, Book, BookDetail, BookFormat, Bookmark, CoverSource,
    Download, DownloadRequest, Label, LabelUsage, Landing, LibraryStatus, Placement, ReadingState,
    ReadingStatus, ScanIssue, ScanIssueReason, ScanReport, Shelf,
};
use crate::source::{FileSource, ScannedBook, collect_books};
use crate::{APP_NAME, SCHEMA_VERSION, cover, identity, metadata};

/// The one book projection, kept in one place so every query stays in sync.
const BOOK_COLUMNS: &str =
    "b.id, b.content_hash, b.quick_key, b.path, b.format, b.title, b.authors,
     b.series, b.language, b.description, b.publisher, b.published_date, b.identifier,
     b.page_count, b.cover_path, b.cover_source, b.file_cover_path, b.file_cover_source,
     b.file_description, b.added_at, b.shelf_id, b.slot_index,
     COALESCE(r.status, 'unread')";

const BOOK_SOURCE: &str = "FROM books b LEFT JOIN reading_state r ON r.book_id = b.id";

const DOWNLOAD_COLUMNS: &str =
    "id, md5, title, authors, year, format, source, mirror_urls, state, mirror, bytes,
     total_bytes, error, error_code, book_id, filename, created_at, finished_at";

const LIBRARY_FOLDER_URI: &str = "library_folder_uri";
const LIBRARY_FOLDER_NAME: &str = "library_folder_name";
const SHELF_CAPACITY: &str = "shelf_capacity";
const DEFAULT_SHELF_CAPACITY: i64 = 12;
const DOWNLOAD_NAMING: &str = "download_naming";
const COVER_RENDERER_VERSION: &str = "cover_renderer_version";
/// Bump when cover extraction changes enough that cached covers must be made
/// again. Version 2 skips PDF title pages in favour of a jacket-like page.
const COVER_RENDERER_VERSION_CURRENT: &str = "2";

/// The naming pattern used when the user has not chosen one.
pub const DEFAULT_DOWNLOAD_NAMING: &str = "{author} - {title} ({year})";

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

    /// Every book known to the library, in shelf order.
    pub fn list_books(&self) -> Result<Vec<Book>> {
        let conn = self.connection()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {BOOK_COLUMNS}
             {BOOK_SOURCE}
             ORDER BY b.shelf_id IS NULL, b.shelf_id, b.slot_index, b.title COLLATE NOCASE, b.id"
        ))?;

        let mut books = statement
            .query_map([], book_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut labels = all_book_labels(&conn)?;
        for book in &mut books {
            book.labels = labels.remove(&book.id).unwrap_or_default();
        }
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
            let mut book = conn
                .query_row(
                    &format!("SELECT {BOOK_COLUMNS} {BOOK_SOURCE} WHERE b.id = ?1"),
                    [id],
                    book_from_row,
                )
                .optional()?
                .ok_or(Error::BookNotFound { id })?;
            book.labels = labels_for_book_conn(&conn, id)?;
            book
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
            enrichment: {
                let conn = self.connection()?;
                crate::enrichment::state_for(&conn, id)?
            },
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
                "UPDATE books SET cover_path = ?1, cover_source = ?2,
                                  file_cover_path = ?1, file_cover_source = ?2
                 WHERE id = ?3",
                params![restored.0.to_string_lossy(), restored.1, book.id],
            );
        }
        Some(restored)
    }

    /// Books that still have a blurb or cover gap, for the capped foreground
    /// "Fill missing details" queue. Manual covers are respected by the write
    /// policy, not filtered from the queue.
    pub fn enrichment_targets(&self, limit: usize) -> Result<Vec<Book>> {
        let limit = limit.clamp(1, crate::enrichment::BATCH_LIMIT);
        let conn = self.connection()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {BOOK_COLUMNS}
             {BOOK_SOURCE}
             WHERE b.description IS NULL OR trim(b.description) = ''
                OR b.cover_path IS NULL OR b.cover_source = 'generated'
             ORDER BY b.added_at, b.id
             LIMIT ?1"
        ))?;
        let mut books = statement
            .query_map([limit as i64], book_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut labels = all_book_labels(&conn)?;
        for book in &mut books {
            book.labels = labels.remove(&book.id).unwrap_or_default();
        }
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

    /// Move a book to a shelf and final slot index.
    ///
    /// The target slot is the book's final position on that shelf. Moving a
    /// book compacts the source shelf and shifts the target shelf so both stay
    /// contiguous; a cross-shelf move needs one free slot on the target.
    /// Only the book's placement changes: status, labels, progress and locator
    /// stay untouched.
    pub fn move_book(&self, book_id: i64, shelf_id: i64, slot_index: i64) -> Result<()> {
        if slot_index < 0 {
            return Err(Error::InvalidTarget {
                book_id,
                shelf_id,
                slot_index,
            });
        }
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        let source_shelf: Option<i64> = tx
            .query_row(
                "SELECT shelf_id FROM books WHERE id = ?1",
                [book_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(Error::BookNotFound { id: book_id })?;

        let capacity: i64 = tx
            .query_row(
                "SELECT capacity FROM shelves WHERE id = ?1",
                [shelf_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(Error::InvalidTarget {
                book_id,
                shelf_id,
                slot_index,
            })?;

        let same_shelf = source_shelf == Some(shelf_id);
        let mut target_ids = ordered_book_ids(&tx, shelf_id)?;
        if !same_shelf && target_ids.len() as i64 >= capacity {
            return Err(Error::ShelfFull { id: shelf_id });
        }

        // Remove from the source list first so indices are final positions
        // among the other books, which is what the UI computes from the gap.
        if same_shelf {
            if let Some(position) = target_ids.iter().position(|id| *id == book_id) {
                target_ids.remove(position);
            }
        } else if let Some(source_id) = source_shelf {
            // Park the moving book out of the source shelf's contiguous range
            // before the remaining books close the gap behind it.
            tx.execute(
                "UPDATE books SET slot_index = ?1 WHERE id = ?2",
                params![1_000_000_000 + book_id, book_id],
            )?;
            let mut source_ids = ordered_book_ids(&tx, source_id)?;
            source_ids.retain(|id| *id != book_id);
            reassign_slots(&tx, &source_ids, source_id)?;
        }

        let target_len = target_ids.len() as i64;
        if slot_index > target_len {
            return Err(Error::InvalidTarget {
                book_id,
                shelf_id,
                slot_index,
            });
        }
        let insert_at = slot_index as usize;
        target_ids.insert(insert_at, book_id);

        reassign_slots(&tx, &target_ids, shelf_id)?;

        tx.commit()?;
        Ok(())
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

    /// The pattern used to name newly downloaded files.
    ///
    /// Placeholders are `{author}`, `{title}` and `{year}`. A missing or blank
    /// setting falls back to [`DEFAULT_DOWNLOAD_NAMING`].
    pub fn download_naming(&self) -> Result<String> {
        Ok(self
            .setting(DOWNLOAD_NAMING)?
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_DOWNLOAD_NAMING.to_owned()))
    }

    /// Persist a new download naming pattern.
    ///
    /// Only `{author}`, `{title}` and `{year}` are placeholders. Blank
    /// patterns, unknown placeholders and unbalanced braces are rejected with
    /// `invalid_download_naming` instead of silently producing odd filenames.
    pub fn set_download_naming(&self, pattern: &str) -> Result<String> {
        let pattern = pattern.trim();
        if pattern.is_empty() || !valid_download_naming(pattern) {
            return Err(Error::InvalidDownloadNaming);
        }
        self.put_setting(DOWNLOAD_NAMING, pattern)?;
        Ok(pattern.to_owned())
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

        let needs_cover_refresh = read_setting(&tx, COVER_RENDERER_VERSION)?.as_deref()
            != Some(COVER_RENDERER_VERSION_CURRENT);
        let mut existing: HashMap<String, ExistingBook> = HashMap::new();
        {
            let mut statement = tx
                .prepare("SELECT content_hash, id, path, title, format, cover_source FROM books")?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ExistingBook {
                        id: row.get(1)?,
                        path: row.get(2)?,
                        title: row.get(3)?,
                        format: row.get(4)?,
                        cover_source: row.get(5)?,
                    },
                ))
            })?;
            for row in rows {
                let (hash, book) = row?;
                existing.insert(hash, book);
            }
        }

        let mut shelves = load_shelf_slots(&tx)?;
        let capacity = shelf_capacity(&tx)?;
        let mut added = 0usize;
        let mut removed = 0usize;
        let mut relinked = 0usize;
        let mut duplicates = 0usize;
        let mut placements = Vec::new();
        let mut touched: HashSet<String> = HashSet::new();

        for hash in order {
            let group = &groups[&hash];
            duplicates += group.len().saturating_sub(1);
            let representative = &group[0];

            if let Some(known) = existing.get(&hash) {
                touched.insert(hash.clone());
                if let Some(title) =
                    metadata::repaired_filename_title(&known.title, &representative.scanned.name)
                {
                    tx.execute(
                        "UPDATE books SET title = ?1 WHERE id = ?2",
                        params![title, known.id],
                    )?;
                }
                if needs_cover_refresh
                    && known.format == BookFormat::Pdf
                    && known.cover_source == Some(CoverSource::Rendered)
                    && let Ok(bytes) = source.read_file(&representative.scanned.handle)
                    && let Ok(parsed) = metadata::extract(
                        representative.scanned.format,
                        &bytes,
                        &representative.scanned.name,
                    )
                {
                    let cached = cover::cover_path(&self.cover_dir, &hash);
                    let _ = fs::remove_file(cached);
                    let refreshed = cover::ensure(
                        &self.cover_dir,
                        &hash,
                        parsed.cover.as_deref(),
                        if parsed.cover_rendered {
                            CoverSource::Rendered
                        } else {
                            CoverSource::Embedded
                        },
                    );
                    if let Some((cover_path, cover_source)) = refreshed {
                        tx.execute(
                            "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
                            params![cover_path.to_string_lossy(), cover_source, known.id],
                        )?;
                    }
                }
                if !group.iter().any(|file| &file.scanned.path == &known.path) {
                    tx.execute(
                        "UPDATE books SET path = ?1, quick_key = ?2 WHERE content_hash = ?3",
                        params![representative.scanned.path, representative.quick_key, hash],
                    )?;
                    relinked += 1;
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
            existing.insert(
                hash.clone(),
                ExistingBook {
                    id: book_id,
                    path: representative.scanned.path.clone(),
                    title: parsed.title.clone().unwrap_or_default(),
                    format: representative.scanned.format,
                    cover_source: cover.as_ref().map(|(_, source)| *source),
                },
            );
            placements.push(Placement {
                book_id,
                shelf_id,
                shelf_ordinal,
                appended_shelf,
            });
            touched.insert(hash.clone());
            added += 1;
        }

        for (hash, known) in &existing {
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
                params![known.id, now],
            )?;
            removed += changed;
        }

        if needs_cover_refresh {
            tx.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![
                    COVER_RENDERER_VERSION,
                    COVER_RENDERER_VERSION_CURRENT,
                    unix_timestamp()
                ],
            )?;
        }

        let total: i64 = tx.query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))?;
        tx.commit()?;

        Ok(ScanReport {
            total: total as usize,
            added,
            relinked,
            removed,
            duplicates,
            skipped,
            placements,
        })
    }

    /// Put interrupted rows back in the queue. A row that was running when the
    /// process died keeps its bytes so the next attempt can use a Range.
    pub fn recover_downloads(&self) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE downloads SET state = 'queued', updated_at = ?1 WHERE state = 'running'",
            [unix_timestamp()],
        )?;
        Ok(())
    }

    /// Persist a queued download. An active row for the same md5 is returned
    /// instead of being queued twice.
    pub fn insert_download(&self, request: &DownloadRequest) -> Result<Download> {
        let conn = self.connection()?;
        if let Some(existing) = active_download_for_md5(&conn, &request.md5)? {
            return Ok(existing);
        }
        let authors = serde_json::to_string(&request.authors).map_err(|error| {
            Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO downloads (
                 md5, title, authors, year, format, source, mirror_urls, state,
                 bytes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', 0, ?8, ?8)",
            params![
                request.md5.trim().to_ascii_lowercase(),
                request.title,
                authors,
                request.year,
                request.format,
                request.source,
                serde_json::to_string(&request.mirror_urls).unwrap_or_else(|_| "[]".to_owned()),
                now
            ],
        )?;
        let id = conn.last_insert_rowid();
        Ok(download_by_id(&conn, id)?)
    }

    /// Record a completed duplicate without touching the network.
    pub fn insert_duplicate_download(
        &self,
        request: &DownloadRequest,
        book_id: Option<i64>,
        filename: Option<&str>,
    ) -> Result<Download> {
        let conn = self.connection()?;
        if let Some(existing) = active_download_for_md5(&conn, &request.md5)? {
            return Ok(existing);
        }
        let authors = serde_json::to_string(&request.authors).map_err(|error| {
            Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO downloads (
                 md5, title, authors, year, format, source, mirror_urls, state,
                 bytes, error, error_code, book_id, filename, created_at, updated_at, finished_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'completed', 0,
                       'Already in your library', 'duplicate', ?8, ?9, ?10, ?10, ?10)",
            params![
                request.md5.trim().to_ascii_lowercase(),
                request.title,
                authors,
                request.year,
                request.format,
                request.source,
                serde_json::to_string(&request.mirror_urls).unwrap_or_else(|_| "[]".to_owned()),
                book_id,
                filename.and_then(download_basename),
                now
            ],
        )?;
        let id = conn.last_insert_rowid();
        Ok(download_by_id(&conn, id)?)
    }

    /// The newest completed download for an md5, used for the pre-fetch check.
    pub fn completed_download_for_md5(&self, md5: &str) -> Result<Option<Download>> {
        let conn = self.connection()?;
        let row = conn
            .query_row(
                &format!(
                    "SELECT {DOWNLOAD_COLUMNS} FROM downloads
                     WHERE md5 = ?1 COLLATE NOCASE AND state = 'completed'
                     ORDER BY finished_at DESC, id DESC LIMIT 1"
                ),
                [md5.trim()],
                download_from_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn list_downloads(&self) -> Result<Vec<Download>> {
        let conn = self.connection()?;
        let mut statement = conn.prepare(&format!(
            "SELECT {DOWNLOAD_COLUMNS} FROM downloads
             ORDER BY created_at DESC, id DESC"
        ))?;
        let rows = statement
            .query_map([], download_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Move up to `limit` queued rows into `running` and return them.
    pub fn claim_queued_downloads(&self, limit: usize) -> Result<Vec<Download>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let conn = self.connection()?;
        let ids: Vec<i64> = {
            let mut statement = conn.prepare(
                "SELECT id FROM downloads WHERE state = 'queued'
                 ORDER BY created_at, id LIMIT ?1",
            )?;
            let rows = statement.query_map([limit as i64], |row| row.get::<_, i64>(0))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let now = unix_timestamp();
        for id in &ids {
            conn.execute(
                "UPDATE downloads SET state = 'running', updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
        }
        ids.into_iter()
            .map(|id| download_by_id(&conn, id).map_err(Error::from))
            .collect()
    }

    pub fn update_download_progress(&self, id: i64, bytes: u64, total: Option<u64>) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE downloads SET bytes = ?1, total_bytes = COALESCE(?2, total_bytes),
                                  updated_at = ?3
             WHERE id = ?4 AND state = 'running'",
            params![
                bytes as i64,
                total.map(|value| value as i64),
                unix_timestamp(),
                id
            ],
        )?;
        Ok(())
    }

    /// Record which mirror a running row is using, and optionally a transient
    /// note that the UI can show while failover is in progress.
    pub fn update_download_attempt(&self, id: i64, mirror: &str, note: Option<&str>) -> Result<()> {
        let conn = self.connection()?;
        conn.execute(
            "UPDATE downloads SET mirror = ?1, error = ?2, updated_at = ?3
             WHERE id = ?4 AND state = 'running'",
            params![mirror, note, unix_timestamp(), id],
        )?;
        Ok(())
    }

    pub fn complete_download(
        &self,
        id: i64,
        book_id: i64,
        filename: &str,
        duplicate: bool,
    ) -> Result<()> {
        let conn = self.connection()?;
        let now = unix_timestamp();
        let (error, code) = if duplicate {
            (Some("Already in your library"), Some("duplicate"))
        } else {
            (None, None)
        };
        // Only a bare filename may cross the command wire. A caller that hands
        // us a library path (or nothing at all) records no filename.
        let filename = download_basename(filename);
        conn.execute(
            "UPDATE downloads SET state = 'completed', book_id = ?1, filename = ?2,
                                  error = ?3, error_code = ?4, finished_at = ?5, updated_at = ?5
             WHERE id = ?6 AND state <> 'cancelled'",
            params![book_id, filename, error, code, now, id],
        )?;
        Ok(())
    }

    pub fn fail_download(&self, id: i64, code: &str, message: &str) -> Result<()> {
        let conn = self.connection()?;
        let now = unix_timestamp();
        conn.execute(
            "UPDATE downloads SET state = 'failed', error = ?1, error_code = ?2,
                                  finished_at = ?3, updated_at = ?3
             WHERE id = ?4 AND state <> 'cancelled'",
            params![message, code, now, id],
        )?;
        Ok(())
    }

    pub fn mark_download_cancelled(&self, id: i64) -> Result<()> {
        let conn = self.connection()?;
        let now = unix_timestamp();
        conn.execute(
            "UPDATE downloads SET state = 'cancelled', error = NULL, error_code = NULL,
                                  finished_at = ?1, updated_at = ?1
             WHERE id = ?2 AND state IN ('queued', 'running', 'failed')",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn retry_download(&self, id: i64) -> Result<Download> {
        let conn = self.connection()?;
        let changed = conn.execute(
            "UPDATE downloads SET state = 'queued', error = NULL, error_code = NULL,
                                  mirror = NULL, finished_at = NULL, updated_at = ?1
             WHERE id = ?2 AND state IN ('failed', 'cancelled')",
            params![unix_timestamp(), id],
        )?;
        if changed == 0 {
            return Err(Error::DownloadNotFound { id });
        }
        Ok(download_by_id(&conn, id)?)
    }

    /// The catalogue id for a content hash, used for the post-download dedupe.
    pub fn find_book_by_hash(&self, hash: &str) -> Result<Option<i64>> {
        find_book_by_hash(self, hash)
    }

    /// Hash and ingest a downloaded file, placing it like a scan would.
    ///
    /// If the bytes already exist, nothing is written to the catalogue and the
    /// existing book is returned so the queue can link to it.
    pub fn land_download(&self, filename: &str, bytes: &[u8]) -> Result<Landing> {
        let format = match Path::new(filename)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref()
        {
            Some("epub") => BookFormat::Epub,
            Some("pdf") => BookFormat::Pdf,
            _ => return Err(Error::DownloadInvalidBook),
        };
        let content_hash = identity::content_hash(bytes);
        if let Some(book_id) = find_book_by_hash(self, &content_hash)? {
            return Ok(Landing::Duplicate { book_id });
        }
        let parsed =
            metadata::extract(format, bytes, filename).map_err(|_| Error::DownloadInvalidBook)?;
        let cover = cover::ensure(
            &self.cover_dir,
            &content_hash,
            parsed.cover.as_deref(),
            if parsed.cover_rendered {
                CoverSource::Rendered
            } else {
                CoverSource::Embedded
            },
        );
        let quick_key = identity::quick_key(bytes);
        let scanned = ScannedBook {
            name: filename.to_owned(),
            path: filename.to_owned(),
            handle: String::new(),
            format,
        };

        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        let mut shelves = load_shelf_slots(&tx)?;
        let capacity = shelf_capacity(&tx)?;
        let (shelf_id, slot_index, shelf_ordinal, _) = allocate_slot(&tx, &mut shelves, capacity)?;
        insert_book(
            &tx,
            NewBook {
                scanned: &scanned,
                content_hash: &content_hash,
                quick_key: &quick_key,
                metadata: &parsed,
                cover: cover.as_ref(),
                shelf_id,
                slot_index,
                added_at: unix_timestamp(),
            },
        )?;
        let book_id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(Landing::Added {
            book_id,
            shelf_id,
            shelf_ordinal,
        })
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

    /// Set a status by hand; the manual source wins over later auto updates.
    pub fn set_reading_status(&self, book_id: i64, status: ReadingStatus) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO reading_state
                 (book_id, status, status_source, progress, finished_at)
             VALUES (?1, ?2, 'manual', 0, ?3)
             ON CONFLICT(book_id) DO UPDATE SET
                 status = excluded.status,
                 status_source = 'manual',
                 finished_at = CASE
                     WHEN excluded.status = 'finished'
                     THEN COALESCE(reading_state.finished_at, excluded.finished_at)
                     ELSE reading_state.finished_at
                 END",
            params![book_id, status, now],
        )?;
        Ok(())
    }

    /// The reader's auto-on-open rule: first open marks a book reading.
    ///
    /// A manual override wins, and a finished book is never knocked back to
    /// reading. The reader wiring lands in ticket 07; this is the operation.
    pub fn record_open(&self, book_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        conn.execute(
            "INSERT INTO reading_state
                 (book_id, status, status_source, progress, last_opened_at)
             VALUES (?1, 'reading', 'auto', 0, ?2)
             ON CONFLICT(book_id) DO UPDATE SET
                 status = CASE
                     WHEN reading_state.status_source = 'manual'
                          OR reading_state.status = 'finished'
                     THEN reading_state.status
                     ELSE 'reading'
                 END,
                 last_opened_at = excluded.last_opened_at",
            params![book_id, unix_timestamp()],
        )?;
        Ok(())
    }

    /// Record reader progress; the last page or >=98% marks the book finished.
    ///
    /// Manual overrides still win. Reaching the end again does not clear
    /// finished, and a vanished file is handled by [`Service::scan`].
    pub fn record_progress(
        &self,
        book_id: i64,
        progress: f64,
        locator: Option<&str>,
    ) -> Result<ReadingStatus> {
        let progress = progress.clamp(0.0, 1.0);
        let current = self.reading_state(book_id)?;
        let next = if current.status_source == "manual" {
            current.status
        } else if progress >= 0.98 || current.status == ReadingStatus::Finished {
            ReadingStatus::Finished
        } else {
            ReadingStatus::Reading
        };
        let conn = self.connection()?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO reading_state
                 (book_id, status, status_source, progress, locator, last_opened_at, finished_at)
             VALUES (?1, ?2, 'auto', ?3, ?4, ?5,
                 CASE WHEN ?2 = 'finished' THEN ?5 ELSE NULL END)
             ON CONFLICT(book_id) DO UPDATE SET
                 status = excluded.status,
                 progress = excluded.progress,
                 locator = excluded.locator,
                 last_opened_at = excluded.last_opened_at,
                 finished_at = CASE
                     WHEN excluded.status = 'finished'
                     THEN COALESCE(reading_state.finished_at, excluded.finished_at)
                     ELSE reading_state.finished_at
                 END",
            params![book_id, next, progress, locator, now],
        )?;
        Ok(next)
    }

    /// The logical library-relative path of a book, for the reader shell.
    ///
    /// This never crosses the command wire: the shell uses it to read bytes and
    /// then returns only the bytes to the web UI.
    pub fn book_path(&self, book_id: i64) -> Result<String> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let path = conn.query_row("SELECT path FROM books WHERE id = ?1", [book_id], |row| {
            row.get(0)
        })?;
        Ok(path)
    }

    /// Forget a book and compact its shelf. The shell deletes the file and
    /// cover first; this only owns the catalogue side of the operation.
    pub fn delete_book(&self, book_id: i64) -> Result<()> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        ensure_book(&tx, book_id)?;
        let (shelf_id, cover_path): (Option<i64>, Option<String>) = tx.query_row(
            "SELECT shelf_id, cover_path FROM books WHERE id = ?1",
            [book_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        tx.execute("DELETE FROM books WHERE id = ?1", [book_id])?;
        if let Some(shelf_id) = shelf_id {
            let remaining = ordered_book_ids(&tx, shelf_id)?;
            reassign_slots(&tx, &remaining, shelf_id)?;
        }
        tx.commit()?;
        if let Some(path) = cover_path {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }

    /// Every live bookmark for a book, oldest first.
    pub fn list_bookmarks(&self, book_id: i64) -> Result<Vec<Bookmark>> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let mut statement = conn.prepare(
            "SELECT id, book_id, locator, created_at
             FROM annotations
             WHERE book_id = ?1 AND kind = 'bookmark'
             ORDER BY created_at, id",
        )?;
        let bookmarks = statement
            .query_map([book_id], |row| {
                Ok(Bookmark {
                    id: row.get(0)?,
                    book_id: row.get(1)?,
                    locator: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(bookmarks)
    }

    /// Add a bookmark using the versioned locator JSON produced by the reader.
    pub fn add_bookmark(&self, book_id: i64, locator: &str) -> Result<Bookmark> {
        let locator = locator.trim();
        if locator.is_empty() {
            return Err(Error::InvalidReaderLocator);
        }
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO annotations
                 (book_id, kind, colour, note, locator, created_at, updated_at)
             VALUES (?1, 'bookmark', NULL, NULL, ?2, ?3, ?3)",
            params![book_id, locator, now],
        )?;
        Ok(Bookmark {
            id: conn.last_insert_rowid(),
            book_id,
            locator: locator.to_owned(),
            created_at: now,
        })
    }

    /// Delete one bookmark. Highlights and notes are untouched.
    pub fn delete_bookmark(&self, book_id: i64, bookmark_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let changed = conn.execute(
            "DELETE FROM annotations
             WHERE id = ?1 AND book_id = ?2 AND kind = 'bookmark'",
            params![bookmark_id, book_id],
        )?;
        if changed == 0 {
            return Err(Error::BookmarkNotFound { id: bookmark_id });
        }
        Ok(())
    }

    /// Every highlight and note for a book, oldest first.
    pub fn list_annotations(&self, book_id: i64) -> Result<Vec<Annotation>> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let mut statement = conn.prepare(
            "SELECT id, book_id, kind, colour, note, locator, created_at, updated_at
             FROM annotations
             WHERE book_id = ?1 AND kind IN ('highlight', 'note')
             ORDER BY created_at, id",
        )?;
        let annotations = statement
            .query_map([book_id], annotation_from_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(annotations)
    }

    /// Create a highlight or note. Bookmarks keep their separate route.
    pub fn create_annotation(
        &self,
        book_id: i64,
        kind: AnnotationKind,
        colour: Option<&str>,
        note: Option<&str>,
        locator: &str,
    ) -> Result<Annotation> {
        if kind == AnnotationKind::Bookmark {
            return Err(Error::InvalidAnnotationKind {
                kind: kind.as_str().to_owned(),
            });
        }
        let locator = locator.trim();
        if locator.is_empty() {
            return Err(Error::InvalidReaderLocator);
        }
        let note = note.map(str::trim).filter(|value| !value.is_empty());
        let colour = colour.map(str::trim).filter(|value| !value.is_empty());
        let kind = if note.is_some() {
            AnnotationKind::Note
        } else {
            kind
        };
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let now = unix_timestamp();
        conn.execute(
            "INSERT INTO annotations
                 (book_id, kind, colour, note, locator, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![book_id, kind, colour, note, locator, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(Annotation {
            id,
            book_id,
            kind,
            colour: colour.map(str::to_owned),
            note: note.map(str::to_owned),
            locator: locator.to_owned(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Update a highlight or note.
    ///
    /// `None` keeps a field, an empty string clears it. Setting note text turns
    /// the annotation into a note; clearing it turns it back into a highlight.
    pub fn update_annotation(
        &self,
        book_id: i64,
        annotation_id: i64,
        colour: Option<&str>,
        note: Option<&str>,
        locator: Option<&str>,
    ) -> Result<Annotation> {
        let locator = match locator {
            Some(value) if value.trim().is_empty() => return Err(Error::InvalidReaderLocator),
            Some(value) => Some(value.trim().to_owned()),
            None => None,
        };
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let mut annotation = conn
            .query_row(
                "SELECT id, book_id, kind, colour, note, locator, created_at, updated_at
                 FROM annotations
                 WHERE id = ?1 AND book_id = ?2 AND kind IN ('highlight', 'note')",
                params![annotation_id, book_id],
                annotation_from_row,
            )
            .optional()?
            .ok_or(Error::AnnotationNotFound { id: annotation_id })?;

        if let Some(value) = colour {
            annotation.colour = Some(value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
        }
        if let Some(value) = note {
            let trimmed = value.trim();
            annotation.note = Some(trimmed)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            annotation.kind = if annotation.note.is_some() {
                AnnotationKind::Note
            } else {
                AnnotationKind::Highlight
            };
        }
        if let Some(value) = locator {
            annotation.locator = value;
        }
        annotation.updated_at = unix_timestamp();
        conn.execute(
            "UPDATE annotations
             SET kind = ?1, colour = ?2, note = ?3, locator = ?4, updated_at = ?5
             WHERE id = ?6 AND book_id = ?7",
            params![
                annotation.kind,
                annotation.colour,
                annotation.note,
                annotation.locator,
                annotation.updated_at,
                annotation_id,
                book_id
            ],
        )?;
        Ok(annotation)
    }

    /// Delete one highlight or note. Bookmarks are untouched.
    pub fn delete_annotation(&self, book_id: i64, annotation_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        let changed = conn.execute(
            "DELETE FROM annotations
             WHERE id = ?1 AND book_id = ?2 AND kind IN ('highlight', 'note')",
            params![annotation_id, book_id],
        )?;
        if changed == 0 {
            return Err(Error::AnnotationNotFound { id: annotation_id });
        }
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

    /// Every label with the number of books wearing it.
    pub fn label_usage(&self) -> Result<Vec<LabelUsage>> {
        let conn = self.connection()?;
        let mut statement = conn.prepare(
            "SELECT l.id, l.name, l.colour, l.created_at, COUNT(bl.book_id)
             FROM labels l LEFT JOIN book_labels bl ON bl.label_id = l.id
             GROUP BY l.id
             ORDER BY l.created_at, l.id",
        )?;
        let labels = statement
            .query_map([], |row| {
                Ok(LabelUsage {
                    label: label_from_row_at(row, 0)?,
                    book_count: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(labels)
    }

    /// Create a reusable label from the fixed palette.
    pub fn create_label(&self, name: &str, colour: &str) -> Result<Label> {
        let name = valid_label_name(name)?;
        validate_label_colour(colour)?;
        let conn = self.connection()?;
        if label_name_taken(&conn, &name, None)? {
            return Err(Error::LabelExists { name });
        }
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

    /// Rename a label. The new name must still be unique.
    pub fn rename_label(&self, label_id: i64, name: &str) -> Result<Label> {
        let name = valid_label_name(name)?;
        let conn = self.connection()?;
        ensure_label(&conn, label_id)?;
        if label_name_taken(&conn, &name, Some(label_id))? {
            return Err(Error::LabelExists { name });
        }
        conn.execute(
            "UPDATE labels SET name = ?1 WHERE id = ?2",
            params![name, label_id],
        )?;
        conn.query_row(
            "SELECT id, name, colour, created_at FROM labels WHERE id = ?1",
            [label_id],
            label_from_row,
        )
        .map_err(Error::from)
    }

    /// Recolour a label from the fixed palette.
    pub fn recolour_label(&self, label_id: i64, colour: &str) -> Result<Label> {
        validate_label_colour(colour)?;
        let conn = self.connection()?;
        ensure_label(&conn, label_id)?;
        conn.execute(
            "UPDATE labels SET colour = ?1 WHERE id = ?2",
            params![colour, label_id],
        )?;
        conn.query_row(
            "SELECT id, name, colour, created_at FROM labels WHERE id = ?1",
            [label_id],
            label_from_row,
        )
        .map_err(Error::from)
    }

    /// Delete a label and every association. No book is touched.
    pub fn delete_label(&self, label_id: i64) -> Result<()> {
        let conn = self.connection()?;
        let changed = conn.execute("DELETE FROM labels WHERE id = ?1", [label_id])?;
        if changed == 0 {
            return Err(Error::LabelNotFound { id: label_id });
        }
        Ok(())
    }

    /// Attach a label to a book; attaching twice is a no-op.
    pub fn attach_label(&self, book_id: i64, label_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        ensure_label(&conn, label_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO book_labels (book_id, label_id) VALUES (?1, ?2)",
            params![book_id, label_id],
        )?;
        Ok(())
    }

    /// Detach a label from a book; detaching a missing association is a no-op.
    pub fn detach_label(&self, book_id: i64, label_id: i64) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        conn.execute(
            "DELETE FROM book_labels WHERE book_id = ?1 AND label_id = ?2",
            params![book_id, label_id],
        )?;
        Ok(())
    }

    /// Labels worn by one book, in creation order.
    pub fn labels_for_book(&self, book_id: i64) -> Result<Vec<Label>> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        labels_for_book_conn(&conn, book_id)
    }

    /// Books matching every selected label and, optionally, the status axis.
    ///
    /// Multiple labels combine with AND, as do labels and status. An empty
    /// selection returns every book id in shelf order.
    pub fn filter_books(
        &self,
        label_ids: &[i64],
        status: Option<ReadingStatus>,
    ) -> Result<Vec<i64>> {
        let conn = self.connection()?;
        let mut sql = String::from(
            "SELECT b.id FROM books b
             LEFT JOIN reading_state r ON r.book_id = b.id
             WHERE 1 = 1",
        );
        let mut values: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(status) = status {
            sql.push_str(" AND COALESCE(r.status, 'unread') = ?");
            let text = match status {
                ReadingStatus::Unread => "unread",
                ReadingStatus::Reading => "reading",
                ReadingStatus::Finished => "finished",
            };
            values.push(rusqlite::types::Value::Text(text.to_owned()));
        }
        for label_id in label_ids {
            sql.push_str(
                " AND EXISTS (
                    SELECT 1 FROM book_labels bl
                    WHERE bl.book_id = b.id AND bl.label_id = ?
                 )",
            );
            values.push((*label_id).into());
        }
        sql.push_str(
            " ORDER BY b.shelf_id IS NULL, b.shelf_id, b.slot_index,
              b.title COLLATE NOCASE, b.id",
        );
        let mut statement = conn.prepare(&sql)?;
        let ids = statement
            .query_map(rusqlite::params_from_iter(values), |row| row.get(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ids)
    }
}

fn find_book_by_hash(service: &Service, hash: &str) -> Result<Option<i64>> {
    let conn = service.connection()?;
    let id = conn
        .query_row(
            "SELECT id FROM books WHERE content_hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()?;
    Ok(id)
}

fn active_download_for_md5(conn: &Connection, md5: &str) -> Result<Option<Download>> {
    let row = conn
        .query_row(
            &format!(
                "SELECT {DOWNLOAD_COLUMNS} FROM downloads
                 WHERE md5 = ?1 COLLATE NOCASE AND state IN ('queued', 'running')
                 ORDER BY id DESC LIMIT 1"
            ),
            [md5.trim()],
            download_from_row,
        )
        .optional()?;
    Ok(row)
}

fn download_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Download> {
    conn.query_row(
        &format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads WHERE id = ?1"),
        [id],
        download_from_row,
    )
}

fn download_from_row(row: &Row<'_>) -> rusqlite::Result<Download> {
    let authors_json: String = row.get(3)?;
    let authors = serde_json::from_str(&authors_json).unwrap_or_default();
    Ok(Download {
        id: row.get(0)?,
        md5: row.get(1)?,
        title: row.get(2)?,
        authors,
        year: row.get::<_, Option<i64>>(4)?.map(|year| year as u16),
        format: row.get(5)?,
        source: row.get(6)?,
        mirror_urls: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
        state: row.get(8)?,
        mirror: row.get(9)?,
        bytes: row.get::<_, i64>(10)? as u64,
        total_bytes: row.get::<_, Option<i64>>(11)?.map(|value| value as u64),
        error: row.get(12)?,
        error_code: row.get(13)?,
        book_id: row.get(14)?,
        // Legacy rows may hold a library path; the wire never sees one.
        filename: row
            .get::<_, Option<String>>(15)?
            .as_deref()
            .and_then(download_basename)
            .map(str::to_owned),
        created_at: row.get(16)?,
        finished_at: row.get(17)?,
    })
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

fn ensure_label(conn: &Connection, label_id: i64) -> Result<()> {
    let exists: Option<i64> = conn
        .query_row("SELECT id FROM labels WHERE id = ?1", [label_id], |row| {
            row.get(0)
        })
        .optional()?;
    match exists {
        Some(_) => Ok(()),
        None => Err(Error::LabelNotFound { id: label_id }),
    }
}

fn valid_label_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidLabelName);
    }
    Ok(trimmed.to_owned())
}

fn validate_label_colour(colour: &str) -> Result<()> {
    if LABEL_PALETTE.contains(&colour) {
        Ok(())
    } else {
        Err(Error::InvalidLabelColour {
            colour: colour.to_owned(),
        })
    }
}

fn label_name_taken(conn: &Connection, name: &str, excluding: Option<i64>) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM labels WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
        params![name, excluding.unwrap_or(-1)],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

fn annotation_from_row(row: &Row<'_>) -> rusqlite::Result<Annotation> {
    Ok(Annotation {
        id: row.get(0)?,
        book_id: row.get(1)?,
        kind: row.get(2)?,
        colour: row.get(3)?,
        note: row.get(4)?,
        locator: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn label_from_row(row: &Row<'_>) -> rusqlite::Result<Label> {
    label_from_row_at(row, 0)
}

fn label_from_row_at(row: &Row<'_>, offset: usize) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(offset)?,
        name: row.get(offset + 1)?,
        colour: row.get(offset + 2)?,
        created_at: row.get(offset + 3)?,
    })
}

fn labels_for_book_conn(conn: &Connection, book_id: i64) -> Result<Vec<Label>> {
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

fn all_book_labels(conn: &Connection) -> Result<HashMap<i64, Vec<Label>>> {
    let mut statement = conn.prepare(
        "SELECT bl.book_id, l.id, l.name, l.colour, l.created_at
         FROM book_labels bl JOIN labels l ON l.id = bl.label_id
         ORDER BY l.created_at, l.id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, label_from_row_at(row, 1)?))
    })?;
    let mut labels: HashMap<i64, Vec<Label>> = HashMap::new();
    for row in rows {
        let (book_id, label) = row?;
        labels.entry(book_id).or_default().push(label);
    }
    Ok(labels)
}

struct HashedFile {
    scanned: ScannedBook,
    content_hash: String,
    quick_key: String,
}

struct ExistingBook {
    id: i64,
    path: String,
    title: String,
    format: BookFormat,
    cover_source: Option<CoverSource>,
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

fn ordered_book_ids(conn: &Connection, shelf_id: i64) -> Result<Vec<i64>> {
    let mut statement = conn.prepare(
        "SELECT id FROM books WHERE shelf_id = ?1 ORDER BY slot_index, title COLLATE NOCASE, id",
    )?;
    let ids = statement
        .query_map([shelf_id], |row| row.get(0))?
        .collect::<std::result::Result<Vec<i64>, _>>()?;
    Ok(ids)
}

fn reassign_slots(conn: &Connection, ids: &[i64], shelf_id: i64) -> Result<()> {
    // The table has UNIQUE(shelf_id, slot_index) and a slot >= 0 check. Park
    // every affected book on a unique far-away slot before writing the final
    // contiguous order, so a forward move cannot transiently collide with the
    // slot it is passing.
    for id in ids {
        conn.execute(
            "UPDATE books SET shelf_id = ?1, slot_index = ?2 WHERE id = ?3",
            params![shelf_id, 1_000_000_000 + id, id],
        )?;
    }
    for (slot, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE books SET shelf_id = ?1, slot_index = ?2 WHERE id = ?3",
            params![shelf_id, slot as i64, id],
        )?;
    }
    Ok(())
}

/// A naming pattern may use only the three documented placeholders, and every
/// opening brace needs a matching close.
fn valid_download_naming(pattern: &str) -> bool {
    let mut rest = pattern;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            return false;
        };
        if !matches!(&after[..end], "author" | "title" | "year") {
            return false;
        }
        rest = &after[end + 1..];
    }
    !rest.contains('}')
}

/// The last component of a path, or `None` when there is nothing to show.
fn download_basename(value: &str) -> Option<&str> {
    let name = value.rsplit(['/', '\\']).next().unwrap_or(value).trim();
    if name.is_empty() || name == "." || name == ".." {
        None
    } else {
        Some(name)
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
             cover_source, added_at, shelf_id, slot_index,
             file_cover_path, file_cover_source, file_description
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
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
            slot_index,
            cover_path,
            cover_source,
            metadata.description,
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
        file_cover_path: row.get(16)?,
        file_cover_source: row.get(17)?,
        file_description: row.get(18)?,
        added_at: row.get(19)?,
        shelf_id: row.get(20)?,
        slot_index: row.get(21)?,
        reading_status: row.get::<_, ReadingStatus>(22)?,
        labels: Vec::new(),
    })
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
