//! PocketLibrary core: the SQLite catalog behind the command API.
//!
//! This crate deliberately has no Tauri dependency so it can be built and
//! tested on a headless host.

pub mod acquisition;
mod api;
mod backup;
mod cover;
pub mod diagnostics;
mod download;
mod enrichment;
mod error;
mod identity;
mod metadata;
mod migrations;
mod models;
mod service;
mod source;
pub mod spine_cache;
pub mod spine_queue;
pub mod spine_strip;
pub mod updates;

pub use acquisition::{
    LibgenProvider, LibgenResult, MirrorHealth, MirrorLink, PAGE_SIZE, SearchPage, SearchQuery,
};
pub use api::Api;
pub use backup::{
    BACKUP_EXTENSION, BACKUP_FORMAT_VERSION, BackupPreview, BackupReport, ImportMode,
};
pub use download::{DownloadManager, DownloadSink, proposed_filename, unique_filename};
pub use enrichment::{
    BATCH_LIMIT, EnrichmentService, LookupRequest, MetadataProvider, OpenLibraryProvider,
    ProviderCandidate, ProviderError, ProviderErrorKind, ProviderResult, ProviderSupplement,
    SOURCE_INTERNET_ARCHIVE, SOURCE_LABEL, SOURCE_OPEN_LIBRARY, SOURCE_URL, find_isbn,
    normalise_isbn, normalise_title,
};
pub use error::{ApiError, ApiResult, Error, Result};
pub use identity::{QUICK_SPAN, content_hash, quick_key, quick_key_from_parts};
pub use models::{
    Annotation, AnnotationKind, AppInfo, Book, BookDetail, BookEdit, BookEnrichmentState,
    BookFormat, Bookmark, CoverChoices, CoverLookupOutcome, CoverOption, CoverSource,
    DeviceCoverPreview, Download, DownloadRequest, DownloadState, EnrichmentAttribution,
    EnrichmentCandidate, EnrichmentMode, EnrichmentOutcome, EnrichmentSettings, Label, LabelUsage,
    Landing, LibraryState, LibraryStatus, MAX_BOOK_TITLE_LENGTH, Placement, ReadingState,
    ReadingStatus, ScanIssue, ScanIssueReason, ScanReport, Shelf, SpineStyle,
};
pub use service::DEFAULT_DOWNLOAD_NAMING;
pub use source::{FileSource, QuickBytes, SourceEntry, SourceKind};

/// The schema version this build knows how to create and read.
pub const SCHEMA_VERSION: i64 = 6;

/// User-facing application name.
pub const APP_NAME: &str = "PocketLibrary";
