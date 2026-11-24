//! Models returned by the core service API.
//!
//! These types are the wire contract with the web UI (via Tauri commands), so
//! they serialise as camelCase.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// Identity and schema information about the running app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub app_version: String,
    pub schema_version: i64,
}

/// Supported book formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    Epub,
    Pdf,
}

impl BookFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "epub",
            Self::Pdf => "pdf",
        }
    }
}

impl ToSql for BookFormat {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for BookFormat {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "epub" => Ok(Self::Epub),
            "pdf" => Ok(Self::Pdf),
            other => Err(FromSqlError::Other(
                format!("unknown book format: {other}").into(),
            )),
        }
    }
}

/// The fixed reading-status axis. A vanished file becomes `finished`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadingStatus {
    Unread,
    Reading,
    Finished,
}

impl ToSql for ReadingStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let value = match self {
            Self::Unread => "unread",
            Self::Reading => "reading",
            Self::Finished => "finished",
        };
        Ok(ToSqlOutput::from(value))
    }
}

impl FromSql for ReadingStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "unread" => Ok(Self::Unread),
            "reading" => Ok(Self::Reading),
            "finished" => Ok(Self::Finished),
            other => Err(FromSqlError::Other(
                format!("unknown reading status: {other}").into(),
            )),
        }
    }
}

/// One book in the library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: i64,
    pub content_hash: String,
    pub quick_key: Option<String>,
    /// Filesystem path. Never serialised to the UI; `id` is the opaque handle.
    #[serde(skip)]
    pub path: String,
    pub format: BookFormat,
    pub title: String,
    pub authors: Vec<String>,
    pub series: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub identifier: Option<String>,
    /// Cached cover path. Never serialised to the UI.
    #[serde(skip)]
    pub cover_path: Option<String>,
    pub added_at: i64,
    pub shelf_id: Option<i64>,
    pub slot_index: Option<i64>,
    pub reading_status: ReadingStatus,
}

/// A fixed shelf (furniture, not a query).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub id: i64,
    pub ordinal: i64,
    pub capacity: i64,
}

/// What one rescan changed, in user-visible terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// Books currently on the shelves (including finished ones).
    pub total: usize,
    /// Files that were not in the catalog before this scan.
    pub added: usize,
    /// Known books whose file is gone; they are now marked finished.
    pub removed: usize,
}

/// Whether a library folder is usable right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryState {
    /// First run: no folder has ever been chosen.
    NeedsFolder,
    /// The persisted read/write grant is valid.
    Ready,
    /// A folder was chosen before, but the grant is gone or the folder moved.
    Disconnected,
}

/// The folder state shown by onboarding, the wall and Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub state: LibraryState,
    /// Display name only; the URI never crosses the wire.
    pub folder_name: Option<String>,
}
