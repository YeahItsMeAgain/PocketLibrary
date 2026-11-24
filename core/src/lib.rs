//! PocketLibrary core: the SQLite catalog behind the command API.
//!
//! This crate deliberately has no Tauri dependency so it can be built and
//! tested on a headless host.

mod api;
mod error;
mod migrations;
mod models;
mod service;

pub use api::Api;
pub use error::{ApiError, ApiResult, Error, Result};
pub use models::{AppInfo, Book, BookFormat, Shelf};

/// The schema version this build knows how to create and read.
pub const SCHEMA_VERSION: i64 = 1;

/// User-facing application name.
pub const APP_NAME: &str = "PocketLibrary";
