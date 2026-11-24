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
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

pub type ApiResult<T> = std::result::Result<T, ApiError>;
