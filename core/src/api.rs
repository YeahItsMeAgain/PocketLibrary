//! The transport-agnostic command API.
//!
//! This is the primary seam: Tauri commands wrap these methods, and integration
//! tests drive the same methods against a temporary database. Nothing here
//! depends on Tauri.

use std::path::Path;
use std::sync::Arc;

use crate::acquisition::{LibgenProvider, SearchPage, SearchQuery};
use crate::backup::{BackupPreview, BackupReport, ImportMode};
use crate::download::{DownloadManager, DownloadSink};
use crate::error::{ApiError, ApiResult, Result};
use crate::models::{
    Annotation, AnnotationKind, AppInfo, Book, BookDetail, Bookmark, Download, DownloadRequest,
    Label, LabelUsage, LibraryStatus, ReadingState, ReadingStatus, ScanReport, Shelf,
};
use crate::service::Service;
use crate::source::FileSource;

/// Handle to the catalog command API.
pub struct Api {
    service: Arc<Service>,
    acquisition: LibgenProvider,
    downloads: DownloadManager,
}

impl Api {
    /// Open (creating if needed) the catalog database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        Self::build(path, LibgenProvider::new()?)
    }

    /// Open with an explicit search provider. Integration tests use this to
    /// point the five mirrors at a local fake HTTP server.
    pub fn open_with_search(path: impl AsRef<Path>, acquisition: LibgenProvider) -> Result<Self> {
        let path = path.as_ref();
        Self::build(path, acquisition)
    }

    fn build(path: &Path, acquisition: LibgenProvider) -> Result<Self> {
        let service = Arc::new(Service::open(path)?);
        let temp_dir = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."))
            .join("downloads");
        let downloads = DownloadManager::new(Arc::clone(&service), temp_dir)?;
        Ok(Self {
            service,
            acquisition,
            downloads,
        })
    }

    /// Search Libgen through the production provider.
    pub async fn search_libgen(&self, query: SearchQuery) -> ApiResult<SearchPage> {
        self.acquisition
            .search(&query)
            .await
            .map_err(ApiError::from)
    }

    /// Queue a search result for download.
    pub fn enqueue_download(&self, request: DownloadRequest) -> ApiResult<Download> {
        self.downloads.enqueue(request).map_err(ApiError::from)
    }

    /// Every download row, newest first.
    pub fn list_downloads(&self) -> ApiResult<Vec<Download>> {
        self.downloads.list().map_err(ApiError::from)
    }

    /// Cancel a queued or running download.
    pub fn cancel_download(&self, id: i64) -> ApiResult<()> {
        self.downloads.cancel(id).map_err(ApiError::from)
    }

    /// Put a failed or cancelled download back in the queue.
    pub fn retry_download(&self, id: i64) -> ApiResult<Download> {
        self.downloads.retry(id).map_err(ApiError::from)
    }

    /// Return interrupted rows to the queue before the first process run.
    pub fn recover_downloads(&self) -> ApiResult<()> {
        self.service.recover_downloads().map_err(ApiError::from)
    }

    /// Run the queue to completion, two files at a time.
    pub async fn process_downloads(&self, sink: &dyn DownloadSink) -> ApiResult<()> {
        self.downloads.process(sink).await.map_err(ApiError::from)
    }

    /// Identity and schema information for the running app.
    pub fn app_info(&self) -> ApiResult<AppInfo> {
        self.service.app_info().map_err(ApiError::from)
    }

    /// Export catalogue metadata and optional covers as a `.pocketlibrary`
    /// archive. Book files are never included.
    pub fn export_backup(&self) -> ApiResult<Vec<u8>> {
        self.service.export_backup().map_err(ApiError::from)
    }

    /// Inspect an archive without changing the library.
    pub fn preview_backup(&self, bytes: &[u8]) -> ApiResult<BackupPreview> {
        self.service.preview_backup(bytes).map_err(ApiError::from)
    }

    /// Apply an archive as a merge or a replace.
    pub fn import_backup(&self, bytes: &[u8], mode: ImportMode) -> ApiResult<BackupReport> {
        self.service
            .import_backup(bytes, mode)
            .map_err(ApiError::from)
    }

    /// Every book known to the library, in shelf order.
    pub fn list_books(&self) -> ApiResult<Vec<Book>> {
        self.service.list_books().map_err(ApiError::from)
    }

    /// Every shelf in ordinal order.
    pub fn list_shelves(&self) -> ApiResult<Vec<Shelf>> {
        self.service.list_shelves().map_err(ApiError::from)
    }

    /// One book plus a data-URL cover, for the detail panel.
    ///
    /// `source` lets a missing cover cache be rebuilt from the real file.
    pub fn get_book_detail(
        &self,
        id: i64,
        source: Option<&dyn FileSource>,
    ) -> ApiResult<BookDetail> {
        self.service
            .get_book_detail(id, source)
            .map_err(ApiError::from)
    }

    /// Reconcile the catalog with the chosen library folder.
    pub fn scan(&self, source: &dyn FileSource) -> ApiResult<ScanReport> {
        self.service.scan(source).map_err(ApiError::from)
    }

    /// The configured shelf capacity.
    pub fn shelf_capacity(&self) -> ApiResult<i64> {
        self.service.shelf_capacity().map_err(ApiError::from)
    }

    /// Persist and apply a new shelf capacity.
    pub fn set_shelf_capacity(&self, capacity: i64) -> ApiResult<i64> {
        self.service
            .set_shelf_capacity(capacity)
            .map_err(ApiError::from)
    }

    /// The pattern used to name downloaded files.
    pub fn download_naming(&self) -> ApiResult<String> {
        self.service.download_naming().map_err(ApiError::from)
    }

    /// Persist a new download naming pattern.
    pub fn set_download_naming(&self, pattern: &str) -> ApiResult<String> {
        self.service
            .set_download_naming(pattern)
            .map_err(ApiError::from)
    }

    /// Move a book to a shelf and final slot index.
    ///
    /// The book keeps its identity, reading state, labels and progress; only
    /// its shelf and slot change.
    pub fn move_book(&self, book_id: i64, shelf_id: i64, slot_index: i64) -> ApiResult<()> {
        self.service
            .move_book(book_id, shelf_id, slot_index)
            .map_err(ApiError::from)
    }

    /// Remember the chosen library folder token and display name.
    pub fn set_library_folder(&self, uri: &str, name: &str) -> ApiResult<()> {
        self.service
            .set_library_folder(uri, name)
            .map_err(ApiError::from)
    }

    /// The persisted library folder token, if one was chosen.
    pub fn library_folder(&self) -> ApiResult<Option<String>> {
        self.service.library_folder().map_err(ApiError::from)
    }

    /// Build the UI-facing folder state from a grant check.
    pub fn library_status(&self, grant_valid: bool) -> ApiResult<LibraryStatus> {
        self.service
            .library_status(grant_valid)
            .map_err(ApiError::from)
    }

    /// A book's reading position, defaulting to unread.
    pub fn reading_state(&self, id: i64) -> ApiResult<ReadingState> {
        self.service.reading_state(id).map_err(ApiError::from)
    }

    /// Set a book's reading status, progress and locator.
    pub fn set_reading_state(
        &self,
        id: i64,
        status: ReadingStatus,
        progress: f64,
        locator: Option<&str>,
    ) -> ApiResult<()> {
        self.service
            .set_reading_state(id, status, progress, locator)
            .map_err(ApiError::from)
    }

    /// Every label.
    pub fn list_labels(&self) -> ApiResult<Vec<Label>> {
        self.service.list_labels().map_err(ApiError::from)
    }

    /// Create a reusable label.
    pub fn create_label(&self, name: &str, colour: &str) -> ApiResult<Label> {
        self.service
            .create_label(name, colour)
            .map_err(ApiError::from)
    }

    /// Every label with how many books wear it.
    pub fn label_usage(&self) -> ApiResult<Vec<LabelUsage>> {
        self.service.label_usage().map_err(ApiError::from)
    }

    /// Rename a label.
    pub fn rename_label(&self, label_id: i64, name: &str) -> ApiResult<Label> {
        self.service
            .rename_label(label_id, name)
            .map_err(ApiError::from)
    }

    /// Recolour a label from the fixed palette.
    pub fn recolour_label(&self, label_id: i64, colour: &str) -> ApiResult<Label> {
        self.service
            .recolour_label(label_id, colour)
            .map_err(ApiError::from)
    }

    /// Delete a label and its associations, touching no book.
    pub fn delete_label(&self, label_id: i64) -> ApiResult<()> {
        self.service.delete_label(label_id).map_err(ApiError::from)
    }

    /// Attach a label to a book.
    pub fn attach_label(&self, book_id: i64, label_id: i64) -> ApiResult<()> {
        self.service
            .attach_label(book_id, label_id)
            .map_err(ApiError::from)
    }

    /// Detach a label from a book.
    pub fn detach_label(&self, book_id: i64, label_id: i64) -> ApiResult<()> {
        self.service
            .detach_label(book_id, label_id)
            .map_err(ApiError::from)
    }

    /// Labels worn by one book.
    pub fn labels_for_book(&self, book_id: i64) -> ApiResult<Vec<Label>> {
        self.service
            .labels_for_book(book_id)
            .map_err(ApiError::from)
    }

    /// Book ids matching all selected labels and the optional status.
    pub fn filter_books(
        &self,
        label_ids: &[i64],
        status: Option<ReadingStatus>,
    ) -> ApiResult<Vec<i64>> {
        self.service
            .filter_books(label_ids, status)
            .map_err(ApiError::from)
    }

    /// Set a manual reading status that later auto updates cannot override.
    pub fn set_reading_status(&self, book_id: i64, status: ReadingStatus) -> ApiResult<()> {
        self.service
            .set_reading_status(book_id, status)
            .map_err(ApiError::from)
    }

    /// The book's library-relative path, used only by the shell to read bytes.
    pub fn book_path(&self, book_id: i64) -> ApiResult<String> {
        self.service.book_path(book_id).map_err(ApiError::from)
    }

    /// Forget a book and compact its shelf. The shell deletes the file first.
    pub fn delete_book(&self, book_id: i64) -> ApiResult<()> {
        self.service.delete_book(book_id).map_err(ApiError::from)
    }

    /// Every live bookmark for a book.
    pub fn list_bookmarks(&self, book_id: i64) -> ApiResult<Vec<Bookmark>> {
        self.service.list_bookmarks(book_id).map_err(ApiError::from)
    }

    /// Add a bookmark from the reader's versioned locator JSON.
    pub fn add_bookmark(&self, book_id: i64, locator: &str) -> ApiResult<Bookmark> {
        self.service
            .add_bookmark(book_id, locator)
            .map_err(ApiError::from)
    }

    /// Delete one bookmark.
    pub fn delete_bookmark(&self, book_id: i64, bookmark_id: i64) -> ApiResult<()> {
        self.service
            .delete_bookmark(book_id, bookmark_id)
            .map_err(ApiError::from)
    }

    /// Every highlight and note for a book, oldest first.
    pub fn list_annotations(&self, book_id: i64) -> ApiResult<Vec<Annotation>> {
        self.service
            .list_annotations(book_id)
            .map_err(ApiError::from)
    }

    /// Create a highlight or note with a Readium-shaped locator.
    pub fn create_annotation(
        &self,
        book_id: i64,
        kind: AnnotationKind,
        colour: Option<&str>,
        note: Option<&str>,
        locator: &str,
    ) -> ApiResult<Annotation> {
        self.service
            .create_annotation(book_id, kind, colour, note, locator)
            .map_err(ApiError::from)
    }

    /// Update colour, note or a repaired locator. `None` keeps a field.
    pub fn update_annotation(
        &self,
        book_id: i64,
        annotation_id: i64,
        colour: Option<&str>,
        note: Option<&str>,
        locator: Option<&str>,
    ) -> ApiResult<Annotation> {
        self.service
            .update_annotation(book_id, annotation_id, colour, note, locator)
            .map_err(ApiError::from)
    }

    /// Delete one highlight or note, leaving bookmarks alone.
    pub fn delete_annotation(&self, book_id: i64, annotation_id: i64) -> ApiResult<()> {
        self.service
            .delete_annotation(book_id, annotation_id)
            .map_err(ApiError::from)
    }

    /// The reader's auto-on-open operation (wired in ticket 07).
    pub fn record_open(&self, book_id: i64) -> ApiResult<()> {
        self.service.record_open(book_id).map_err(ApiError::from)
    }

    /// Record reading progress; >=98% or the last page finishes the book.
    pub fn record_progress(
        &self,
        book_id: i64,
        progress: f64,
        locator: Option<&str>,
    ) -> ApiResult<ReadingStatus> {
        self.service
            .record_progress(book_id, progress, locator)
            .map_err(ApiError::from)
    }
}
