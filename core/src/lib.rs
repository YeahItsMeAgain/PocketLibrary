//! PocketLibrary core: the SQLite catalog behind the command API.
//!
//! This crate deliberately has no Tauri dependency so it can be built and
//! tested on a headless host.

pub mod acquisition;
mod api;
mod backup;
mod cover;
mod download;
mod error;
mod identity;
mod metadata;
mod migrations;
mod models;
mod service;
mod source;

pub use acquisition::{
    LibgenProvider, LibgenResult, MirrorHealth, MirrorLink, PAGE_SIZE, SearchPage, SearchQuery,
};
pub use api::Api;
pub use backup::{
    BACKUP_EXTENSION, BACKUP_FORMAT_VERSION, BackupPreview, BackupReport, ImportMode,
};
pub use download::{DownloadManager, DownloadSink, proposed_filename, unique_filename};
pub use error::{ApiError, ApiResult, Error, Result};
pub use identity::{QUICK_SPAN, content_hash, quick_key, quick_key_from_parts};
pub use models::{
    Annotation, AnnotationKind, AppInfo, Book, BookDetail, BookFormat, Bookmark, CoverSource,
    Download, DownloadRequest, DownloadState, Label, LabelUsage, Landing, LibraryState,
    LibraryStatus, Placement, ReadingState, ReadingStatus, ScanIssue, ScanIssueReason, ScanReport,
    Shelf,
};
pub use service::DEFAULT_DOWNLOAD_NAMING;
pub use source::{FileSource, QuickBytes, SourceEntry, SourceKind};

/// The schema version this build knows how to create and read.
pub const SCHEMA_VERSION: i64 = 4;

/// User-facing application name.
pub const APP_NAME: &str = "PocketLibrary";
