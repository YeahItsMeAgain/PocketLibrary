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

    #[error("library folder is unavailable: {message}")]
    SourceUnavailable { message: String },

    #[error("catalog service lock was poisoned")]
    LockPoisoned,

    #[error("book {id} does not exist")]
    BookNotFound { id: i64 },

    #[error("shelf capacity must be greater than zero")]
    InvalidCapacity,
}

impl Error {
    /// Stable, machine-readable code for the command API wire contract.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "database",
            Self::Io(_) => "io",
            Self::UnsupportedSchema { .. } => "unsupported_schema",
            Self::SourceUnavailable { .. } => "library_unavailable",
            Self::LockPoisoned => "lock",
            Self::BookNotFound { .. } => "book_not_found",
            Self::InvalidCapacity => "invalid_capacity",
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
            Self::SourceUnavailable { .. } => {
                "The library folder is unavailable. Reconnect it and try again."
            }
            Self::LockPoisoned => "The library is busy. Please try again.",
            Self::BookNotFound { .. } => "That book could not be found.",
            Self::InvalidCapacity => "Shelf capacity must be at least one book.",
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
