//! Reading progress, annotations, bookmarks and per-book status.

use rusqlite::{OptionalExtension, Row, params};

use super::catalog::ensure_book;
use super::{Service, unix_timestamp};
use crate::error::{Error, Result};
use crate::models::{Annotation, AnnotationKind, Bookmark, ReadingState, ReadingStatus};

impl Service {
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
