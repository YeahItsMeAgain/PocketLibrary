//! The transport-agnostic command API.
//!
//! This is the primary seam: Tauri commands wrap these methods, and integration
//! tests drive the same methods against a temporary database. Nothing here
//! depends on Tauri.

use std::path::Path;

use crate::error::{ApiError, ApiResult, Result};
use crate::models::{
    AppInfo, Book, BookDetail, Label, LibraryStatus, ReadingState, ReadingStatus, ScanReport, Shelf,
};
use crate::service::Service;
use crate::source::FileSource;

/// Handle to the catalog command API.
pub struct Api {
    service: Service,
}

impl Api {
    /// Open (creating if needed) the catalog database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {
            service: Service::open(path)?,
        })
    }

    /// Identity and schema information for the running app.
    pub fn app_info(&self) -> ApiResult<AppInfo> {
        self.service.app_info().map_err(ApiError::from)
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

    /// Attach a label to a book.
    pub fn attach_label(&self, book_id: i64, label_id: i64) -> ApiResult<()> {
        self.service
            .attach_label(book_id, label_id)
            .map_err(ApiError::from)
    }

    /// Labels worn by one book.
    pub fn labels_for_book(&self, book_id: i64) -> ApiResult<Vec<Label>> {
        self.service
            .labels_for_book(book_id)
            .map_err(ApiError::from)
    }
}
