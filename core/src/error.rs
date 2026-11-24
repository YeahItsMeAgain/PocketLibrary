//! Typed errors for the core service.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

/// Everything that can go wrong in the catalogue service.
#[derive(Debug, Error)]
pub enum Error {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    #[error(
        "database schema version {found} is newer than this app supports ({supported})"
    )]
    UnsupportedSchema { found: i64, supported: i64 },

    #[error("catalogue service lock was poisoned")]
    LockPoisoned,
}
