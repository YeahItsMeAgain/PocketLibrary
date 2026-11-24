//! PocketLibrary core: the SQLite catalogue behind the command API.
//!
//! This crate deliberately has no Tauri dependency so it can be built and
//! tested on a headless host.

mod error;
mod migrations;
mod models;
mod service;

pub use error::{Error, Result};
pub use models::{AppInfo, Book, BookFormat, Shelf};
pub use service::Service;

/// The schema version this build knows how to create and read.
pub const SCHEMA_VERSION: i64 = 1;

/// User-facing application name.
pub const APP_NAME: &str = "PocketLibrary";
