//! Typed errors for the core catalog.

use serde::Serialize;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong in the catalog service.
#[derive(Debug, Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database schema version {found} is newer than this app supports ({supported})")]
    UnsupportedSchema { found: i64, supported: i64 },

    #[error("the backup archive is corrupt: {message}")]
    ArchiveCorrupt { message: String },

    #[error("backup format version {found} is not supported (this app supports {supported})")]
    ArchiveUnsupportedVersion { found: i64, supported: i64 },

    #[error("this file is not a PocketLibrary backup")]
    ArchiveWrongSchema,

    #[error("library folder is unavailable: {message}")]
    SourceUnavailable { message: String },

    #[error("catalog service lock was poisoned")]
    LockPoisoned,

    #[error("book {id} does not exist")]
    BookNotFound { id: i64 },

    #[error("shelf capacity must be greater than zero")]
    InvalidCapacity,

    #[error("book {book_id} cannot move to shelf {shelf_id} slot {slot_index}")]
    InvalidTarget {
        book_id: i64,
        shelf_id: i64,
        slot_index: i64,
    },

    #[error("shelf {id} has no room for another book")]
    ShelfFull { id: i64 },

    #[error("label {id} does not exist")]
    LabelNotFound { id: i64 },

    #[error("label name {name:?} is already used")]
    LabelExists { name: String },

    #[error("a label needs a non-empty name")]
    InvalidLabelName,

    #[error("label colour {colour:?} is not in the fixed palette")]
    InvalidLabelColour { colour: String },

    #[error("a reader locator cannot be empty")]
    InvalidReaderLocator,

    #[error("bookmark {id} does not exist")]
    BookmarkNotFound { id: i64 },

    #[error("a search needs at least one term")]
    EmptySearch,

    #[error("the network is unavailable")]
    Offline,

    #[error("no Libgen mirror answered after {attempts} attempts")]
    AllMirrorsFailed { attempts: usize },

    #[error("Libgen mirror {mirror} returned an unrecognised page")]
    MirrorFormatChanged { mirror: String },

    #[error("the download mirror failed: {message}")]
    DownloadMirrorFailed { message: String },

    #[error("the download key expired")]
    DownloadExpiredKey,

    #[error("the downloaded file was truncated")]
    DownloadTruncated,

    #[error("the downloaded file is not a valid {format}")]
    DownloadWrongMagic { format: String },

    #[error("the downloaded file could not be written: {message}")]
    DownloadDisk { message: String },

    #[error("this file is already in the library")]
    DownloadDuplicate { book_id: i64 },

    #[error("download {id} does not exist")]
    DownloadNotFound { id: i64 },

    #[error("the downloaded file could not be read as a book")]
    DownloadInvalidBook,
}

impl Error {
    /// Stable, machine-readable code for the command API wire contract.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::UnsupportedSchema { .. } => "unsupported_schema",
            Self::ArchiveCorrupt { .. } => "archive_corrupt",
            Self::ArchiveUnsupportedVersion { .. } => "archive_unsupported_version",
            Self::ArchiveWrongSchema => "archive_wrong_schema",
            Self::SourceUnavailable { .. } => "library_unavailable",
            Self::LockPoisoned => "lock",
            Self::BookNotFound { .. } => "book_not_found",
            Self::InvalidCapacity => "invalid_capacity",
            Self::InvalidTarget { .. } => "invalid_target",
            Self::ShelfFull { .. } => "shelf_full",
            Self::LabelNotFound { .. } => "label_not_found",
            Self::LabelExists { .. } => "label_exists",
            Self::InvalidLabelName => "invalid_label_name",
            Self::InvalidLabelColour { .. } => "invalid_label_colour",
            Self::InvalidReaderLocator => "invalid_reader_locator",
            Self::BookmarkNotFound { .. } => "bookmark_not_found",
            Self::EmptySearch => "empty_search",
            Self::Offline => "offline",
            Self::AllMirrorsFailed { .. } => "all_mirrors_failed",
            Self::MirrorFormatChanged { .. } => "mirror_format_changed",
            Self::DownloadMirrorFailed { .. } => "mirror_failed",
            Self::DownloadExpiredKey => "expired_key",
            Self::DownloadTruncated => "truncated_file",
            Self::DownloadWrongMagic { .. } => "wrong_magic",
            Self::DownloadDisk { .. } => "disk",
            Self::DownloadDuplicate { .. } => "duplicate",
            Self::DownloadNotFound { .. } => "download_not_found",
            Self::DownloadInvalidBook => "invalid_book",
        }
    }

    /// Stable user-facing text. Details (which may contain paths) stay in logs.
    fn user_message(&self) -> &'static str {
        match self {
            Self::Database(_) => "The library database could not be updated.",
            Self::Io(_) => "A file operation failed.",
            Self::UnsupportedSchema { .. } => {
                "This library was created by a newer version of PocketLibrary."
            }
            Self::ArchiveCorrupt { .. } => "That backup file is damaged and cannot be restored.",
            Self::ArchiveUnsupportedVersion { .. } => {
                "This backup was made by a different version of PocketLibrary."
            }
            Self::ArchiveWrongSchema => "That file is not a PocketLibrary backup.",
            Self::SourceUnavailable { .. } => {
                "The library folder is unavailable. Reconnect it and try again."
            }
            Self::LockPoisoned => "The library is busy. Please try again.",
            Self::BookNotFound { .. } => "That book could not be found.",
            Self::InvalidCapacity => "Shelf capacity must be at least one book.",
            Self::InvalidTarget { .. } => "That book cannot be placed there.",
            Self::ShelfFull { .. } => "That shelf is already full.",
            Self::LabelNotFound { .. } => "That label could not be found.",
            Self::LabelExists { .. } => "A label with that name already exists.",
            Self::InvalidLabelName => "A label needs a name.",
            Self::InvalidLabelColour { .. } => "Choose one of the printed label colours.",
            Self::InvalidReaderLocator => "The reading position could not be saved.",
            Self::BookmarkNotFound { .. } => "That bookmark could not be found.",
            Self::EmptySearch => "Enter a title, author, ISBN or MD5 to search.",
            Self::Offline => {
                "No network connection. Libgen search needs a connection; your shelf is still available."
            }
            Self::AllMirrorsFailed { .. } => {
                "Every Libgen mirror refused or timed out. Try again in a moment."
            }
            Self::MirrorFormatChanged { .. } => {
                "A Libgen mirror answered, but its results could not be read."
            }
            Self::DownloadMirrorFailed { .. } => {
                "The download mirror refused or timed out. Try again."
            }
            Self::DownloadExpiredKey => "The download key expired. Try again to mint a fresh one.",
            Self::DownloadTruncated => {
                "The file arrived incomplete. Retry to resume where it stopped."
            }
            Self::DownloadWrongMagic { .. } => {
                "The mirror sent a file that is not the requested book."
            }
            Self::DownloadDisk { .. } => "The book could not be written to the library folder.",
            Self::DownloadDuplicate { .. } => "That book is already in your library.",
            Self::DownloadNotFound { .. } => "That download could not be found.",
            Self::DownloadInvalidBook => "The downloaded file could not be read as a book.",
        }
    }
}

/// An error returned by the command API: a stable code plus a readable message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
}

impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        let code = error.code();
        // Keep the detailed cause (SAF text, paths, SQL) in logs, never on the wire.
        eprintln!("pocketlibrary error ({code}): {error}");
        Self {
            code,
            message: error.user_message().to_owned(),
        }
    }
}

pub type ApiResult<T> = std::result::Result<T, ApiError>;
