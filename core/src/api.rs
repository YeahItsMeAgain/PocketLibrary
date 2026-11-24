//! The transport-agnostic command API.
//!
//! This is the primary seam: Tauri commands wrap these methods, and integration
//! tests drive the same methods against a temporary database. Nothing here
//! depends on Tauri.

use std::path::Path;

use crate::error::{ApiError, ApiResult, Result};
use crate::models::{AppInfo, Book, LibraryStatus, ScanReport, Shelf};
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
}
