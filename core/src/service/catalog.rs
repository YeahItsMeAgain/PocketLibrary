//! Books, shelves and labels: the catalogue CRUD surface.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, Row, params};

use super::placement::{ordered_book_ids, reassign_slots};
use super::{LABEL_PALETTE, SHELF_CAPACITY, Service, shelf_capacity, unix_timestamp};
use crate::error::{Error, Result};
use crate::models::{
    Book, BookDetail, BookFormat, CoverSource, Label, LabelUsage, ReadingStatus, Shelf, SpineStyle,
};
use crate::source::{FileSource, collect_books};
use crate::{cover, metadata};

/// The one book projection, kept in one place so every query stays in sync.
const BOOK_COLUMNS: &str =
    "b.id, b.content_hash, b.quick_key, b.path, b.format, b.title, b.authors,
     b.series, b.language, b.description, b.publisher, b.published_date, b.identifier,
     b.page_count, b.cover_path, b.cover_source, b.file_cover_path, b.file_cover_source,
     b.file_description, b.added_at, b.shelf_id, b.slot_index,
     COALESCE(r.status, 'unread'), COALESCE(b.spine_style, 'wrap')";

const BOOK_SOURCE: &str = "FROM books b LEFT JOIN reading_state r ON r.book_id = b.id";

impl Service {
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

    /// One book by id, with its labels. The queue uses this instead of loading
    /// and labelling the whole catalogue for a single cache check.
    pub fn book(&self, id: i64) -> Result<Book> {
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
        Ok(book)
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

    /// Persist how a book's generated spine is presented. The database column
    /// stays nullable; writing an explicit style is always allowed.
    pub fn set_spine_style(&self, book_id: i64, style: SpineStyle) -> Result<()> {
        let conn = self.connection()?;
        ensure_book(&conn, book_id)?;
        conn.execute(
            "UPDATE books SET spine_style = ?1 WHERE id = ?2",
            params![style, book_id],
        )?;
        Ok(())
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

/// Reject a missing book early with the same `BookNotFound` every caller uses.
pub(super) fn ensure_book(conn: &Connection, book_id: i64) -> Result<()> {
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
        spine_style: row.get(23)?,
        spine_data_url: None,
        labels: Vec::new(),
    })
}
