//! Small key/value settings and the library folder token.

use super::Service;
use crate::error::{Error, Result};
use crate::models::LibraryStatus;

const LIBRARY_FOLDER_URI: &str = "library_folder_uri";
const LIBRARY_FOLDER_NAME: &str = "library_folder_name";
const DOWNLOAD_NAMING: &str = "download_naming";

/// The naming pattern used when the user has not chosen one.
pub const DEFAULT_DOWNLOAD_NAMING: &str = "{author} - {title} ({year})";

impl Service {
    /// The persisted library folder token (a SAF tree URI inside the app).
    pub fn library_folder(&self) -> Result<Option<String>> {
        self.setting(LIBRARY_FOLDER_URI)
    }

    /// Remember the chosen library folder and its display name.
    pub fn set_library_folder(&self, uri: &str, name: &str) -> Result<()> {
        self.put_setting(LIBRARY_FOLDER_URI, uri)?;
        self.put_setting(LIBRARY_FOLDER_NAME, name)
    }

    /// The folder name shown in the UI, if a folder has been chosen.
    pub fn library_folder_name(&self) -> Result<Option<String>> {
        self.setting(LIBRARY_FOLDER_NAME)
    }

    /// The pattern used to name newly downloaded files.
    ///
    /// Placeholders are `{author}`, `{title}` and `{year}`. A missing or blank
    /// setting falls back to [`DEFAULT_DOWNLOAD_NAMING`].
    pub fn download_naming(&self) -> Result<String> {
        Ok(self
            .setting(DOWNLOAD_NAMING)?
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_DOWNLOAD_NAMING.to_owned()))
    }

    /// Persist a new download naming pattern.
    ///
    /// Only `{author}`, `{title}` and `{year}` are placeholders. Blank
    /// patterns, unknown placeholders and unbalanced braces are rejected with
    /// `invalid_download_naming` instead of silently producing odd filenames.
    pub fn set_download_naming(&self, pattern: &str) -> Result<String> {
        let pattern = pattern.trim();
        if pattern.is_empty() || !valid_download_naming(pattern) {
            return Err(Error::InvalidDownloadNaming);
        }
        self.put_setting(DOWNLOAD_NAMING, pattern)?;
        Ok(pattern.to_owned())
    }

    /// What the UI should show for the library folder right now.
    pub fn library_status(&self, grant_valid: bool) -> Result<LibraryStatus> {
        let folder_name = self.library_folder_name()?;
        let state = if folder_name.is_none() {
            crate::models::LibraryState::NeedsFolder
        } else if grant_valid {
            crate::models::LibraryState::Ready
        } else {
            crate::models::LibraryState::Disconnected
        };
        Ok(LibraryStatus { state, folder_name })
    }
}

/// A naming pattern may use only the three documented placeholders, and every
/// opening brace needs a matching close.
fn valid_download_naming(pattern: &str) -> bool {
    let mut rest = pattern;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            return false;
        };
        if !matches!(&after[..end], "author" | "title" | "year") {
            return false;
        }
        rest = &after[end + 1..];
    }
    !rest.contains('}')
}
