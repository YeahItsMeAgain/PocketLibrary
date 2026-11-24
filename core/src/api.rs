//! The transport-agnostic command API.
//!
//! This is the primary seam: Tauri commands wrap these methods, and integration
//! tests drive the same methods against a temporary database. Nothing here
//! depends on Tauri.

use std::path::Path;

use crate::error::{ApiError, ApiResult, Result};
use crate::models::{AppInfo, Book, Shelf};
use crate::service::Service;

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
}
