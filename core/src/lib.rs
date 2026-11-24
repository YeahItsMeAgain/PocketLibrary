//! PocketLibrary core: the SQLite catalog behind the command API.
//!
//! This crate deliberately has no Tauri dependency so it can be built and
//! tested on a headless host.

mod api;
mod cover;
mod error;
mod identity;
mod metadata;
mod migrations;
mod models;
mod service;
mod source;

pub use api::Api;
pub use error::{ApiError, ApiResult, Error, Result};
pub use identity::{QUICK_SPAN, content_hash, quick_key, quick_key_from_parts};
pub use models::{
    AppInfo, Book, BookDetail, BookFormat, CoverSource, Label, LabelUsage, LibraryState,
    LibraryStatus, Placement, ReadingState, ReadingStatus, ScanIssue, ScanIssueReason, ScanReport,
    Shelf,
};
pub use source::{FileSource, QuickBytes, SourceEntry, SourceKind};

/// The schema version this build knows how to create and read.
pub const SCHEMA_VERSION: i64 = 2;

/// User-facing application name.
pub const APP_NAME: &str = "PocketLibrary";
