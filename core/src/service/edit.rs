//! Reader edits to a book's core fields.

use rusqlite::params;

use super::Service;
use crate::error::{Error, Result};
use crate::models::{BookDetail, BookEdit, MAX_BOOK_TITLE_LENGTH};

impl Service {
    /// Apply the Edit layer's core-field changes to one book.
    ///
    /// Fields absent from `changes` keep their current value; an explicit
    /// `page_count: Some(None)` clears the page count. Cleaned values are
    /// compared with the catalogue first, so a no-op performs no write. The
    /// refreshed detail lets the caller re-render from one snapshot.
    ///
    /// These columns have no per-field provenance in the schema, so no
    /// manual-edit marker is invented. Cover and blurb provenance is untouched.
    pub fn update_book(&self, book_id: i64, changes: &BookEdit) -> Result<BookDetail> {
        let current = self.book(book_id)?;

        let title = match &changes.title {
            Some(title) => valid_title(title)?,
            None => current.title.clone(),
        };
        let authors = match &changes.authors {
            Some(authors) => clean_authors(authors),
            None => current.authors.clone(),
        };
        let page_count = match changes.page_count {
            Some(Some(count)) if count <= 0 => return Err(Error::InvalidPageCount),
            Some(page_count) => page_count,
            None => current.page_count,
        };

        if title == current.title && authors == current.authors && page_count == current.page_count
        {
            return self.get_book_detail(book_id, None);
        }

        let authors_json = serde_json::to_string(&authors).map_err(|error| {
            Error::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })?;
        {
            let conn = self.connection()?;
            conn.execute(
                "UPDATE books SET title = ?1, authors = ?2, page_count = ?3 WHERE id = ?4",
                params![title, authors_json, page_count, book_id],
            )?;
        }
        self.get_book_detail(book_id, None)
    }
}

fn valid_title(title: &str) -> Result<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_BOOK_TITLE_LENGTH {
        return Err(Error::InvalidBookTitle);
    }
    Ok(trimmed.to_owned())
}

fn clean_authors(authors: &[String]) -> Vec<String> {
    authors
        .iter()
        .map(|author| author.trim())
        .filter(|author| !author.is_empty())
        .map(str::to_owned)
        .collect()
}
