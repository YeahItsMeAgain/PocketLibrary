//! The acquisition download queue and landing a finished file.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, params};

use super::placement::{NewBook, allocate_slot, insert_book, load_shelf_slots};
use super::{Service, shelf_capacity, unix_timestamp};
use crate::error::{Error, Result};
use crate::models::{BookFormat, CoverSource, Download, DownloadRequest, Landing};
use crate::source::ScannedBook;
use crate::{cover, identity, metadata};

const DOWNLOAD_COLUMNS: &str =
    "id, md5, title, authors, year, format, source, mirror_urls, state, mirror, bytes,
     total_bytes, error, error_code, book_id, filename, created_at, finished_at";

impl Service {
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

/// The last component of a path, or `None` when there is nothing to show.
fn download_basename(value: &str) -> Option<&str> {
    let name = value.rsplit(['/', '\\']).next().unwrap_or(value).trim();
    if name.is_empty() || name == "." || name == ".." {
        None
    } else {
        Some(name)
    }
}
