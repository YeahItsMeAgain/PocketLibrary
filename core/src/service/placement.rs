//! Shelf slot allocation and the insert shared by scans and downloads.
//!
//! Slots are always kept contiguous per shelf; the helpers park books on a
//! far-away index before writing final positions so unique constraints hold
//! mid-transaction.

use std::collections::HashSet;
use std::path::PathBuf;

use rusqlite::{Connection, params};

use crate::error::{Error, Result};
use crate::metadata;
use crate::models::CoverSource;
use crate::source::ScannedBook;

pub(super) struct ShelfSlots {
    id: i64,
    ordinal: i64,
    capacity: i64,
    used: HashSet<i64>,
}

pub(super) fn load_shelf_slots(conn: &Connection) -> Result<Vec<ShelfSlots>> {
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

pub(super) fn ordered_book_ids(conn: &Connection, shelf_id: i64) -> Result<Vec<i64>> {
    let mut statement = conn.prepare(
        "SELECT id FROM books WHERE shelf_id = ?1 ORDER BY slot_index, title COLLATE NOCASE, id",
    )?;
    let ids = statement
        .query_map([shelf_id], |row| row.get(0))?
        .collect::<std::result::Result<Vec<i64>, _>>()?;
    Ok(ids)
}

pub(super) fn reassign_slots(conn: &Connection, ids: &[i64], shelf_id: i64) -> Result<()> {
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

pub(super) fn allocate_slot(
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
pub(super) struct NewBook<'a> {
    pub(super) scanned: &'a ScannedBook,
    pub(super) content_hash: &'a str,
    pub(super) quick_key: &'a str,
    pub(super) metadata: &'a metadata::ParsedMetadata,
    pub(super) cover: Option<&'a (PathBuf, CoverSource)>,
    pub(super) shelf_id: i64,
    pub(super) slot_index: i64,
    pub(super) added_at: i64,
}

pub(super) fn insert_book(conn: &Connection, book: NewBook<'_>) -> Result<()> {
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
             file_cover_path, file_cover_source, file_description, spine_style
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 'wrap')",
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
