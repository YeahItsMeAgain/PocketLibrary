//! Models returned by the core service API.
//!
//! These types are the wire contract with the web UI (via Tauri commands), so
//! they serialise as camelCase.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

/// Identity and schema information about the running app.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub app_version: String,
    pub schema_version: i64,
}

/// Supported book formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    Epub,
    Pdf,
}

impl BookFormat {
    fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "epub",
            Self::Pdf => "pdf",
        }
    }
}

impl ToSql for BookFormat {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for BookFormat {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "epub" => Ok(Self::Epub),
            "pdf" => Ok(Self::Pdf),
            other => Err(FromSqlError::Other(
                format!("unknown book format: {other}").into(),
            )),
        }
    }
}

/// The fixed reading-status axis. A vanished file becomes `finished`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadingStatus {
    Unread,
    Reading,
    Finished,
}

impl ToSql for ReadingStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let value = match self {
            Self::Unread => "unread",
            Self::Reading => "reading",
            Self::Finished => "finished",
        };
        Ok(ToSqlOutput::from(value))
    }
}

impl FromSql for ReadingStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "unread" => Ok(Self::Unread),
            "reading" => Ok(Self::Reading),
            "finished" => Ok(Self::Finished),
            other => Err(FromSqlError::Other(
                format!("unknown reading status: {other}").into(),
            )),
        }
    }
}

/// Where a cached cover came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoverSource {
    /// An image embedded in the EPUB.
    Embedded,
    /// Page one of a PDF, rasterised by hayro.
    Rendered,
    /// A locally drawn stand-in when extraction failed.
    Generated,
    /// A cover downloaded from a matched Open Library edition.
    OpenLibrary,
    /// A cover downloaded from an Internet Archive item linked by `ocaid`.
    InternetArchive,
    /// An image the reader chose from this device.
    Device,
}

impl CoverSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Embedded => "embedded",
            Self::Rendered => "rendered",
            Self::Generated => "generated",
            Self::OpenLibrary => "open_library",
            Self::InternetArchive => "internet_archive",
            Self::Device => "device",
        }
    }

    /// Whether this cover came from outside the book file.
    pub fn is_online(self) -> bool {
        matches!(self, Self::OpenLibrary | Self::InternetArchive)
    }

    /// Whether the file itself supplied this cover.
    pub fn is_file_derived(self) -> bool {
        matches!(self, Self::Embedded | Self::Rendered)
    }
}

impl ToSql for CoverSource {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for CoverSource {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "embedded" => Ok(Self::Embedded),
            "rendered" => Ok(Self::Rendered),
            "generated" => Ok(Self::Generated),
            "open_library" => Ok(Self::OpenLibrary),
            "internet_archive" => Ok(Self::InternetArchive),
            "device" => Ok(Self::Device),
            other => Err(FromSqlError::Other(
                format!("unknown cover source: {other}").into(),
            )),
        }
    }
}

/// How a generated spine is presented on the shelf and in detail.
///
/// The database stores the wire spelling (`wrap`, `full-bleed`, `cloth`); a
/// NULL column reads back as the `Wrap` default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpineStyle {
    #[default]
    Wrap,
    FullBleed,
    Cloth,
}

impl SpineStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wrap => "wrap",
            Self::FullBleed => "full-bleed",
            Self::Cloth => "cloth",
        }
    }
}

impl ToSql for SpineStyle {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for SpineStyle {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "wrap" => Ok(Self::Wrap),
            "full-bleed" => Ok(Self::FullBleed),
            "cloth" => Ok(Self::Cloth),
            other => Err(FromSqlError::Other(
                format!("unknown spine style: {other}").into(),
            )),
        }
    }
}

/// How eagerly PocketLibrary looks up online details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnrichmentMode {
    /// No automatic lookup. A per-book action still works when pressed.
    Off,
    /// The Flip offers a lookup action; nothing happens until it is pressed.
    Ask,
    /// Look up when the Flip opens if a blurb or cover is still missing.
    Automatic,
}

impl EnrichmentMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Ask => "ask",
            Self::Automatic => "automatic",
        }
    }
}

impl ToSql for EnrichmentMode {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for EnrichmentMode {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "off" => Ok(Self::Off),
            "ask" => Ok(Self::Ask),
            "automatic" => Ok(Self::Automatic),
            other => Err(FromSqlError::Other(
                format!("unknown enrichment mode: {other}").into(),
            )),
        }
    }
}

/// The persisted online-details setting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichmentSettings {
    pub mode: EnrichmentMode,
    /// The only general-purpose source this build ships with.
    pub source_label: String,
    pub source_url: String,
    /// The widest foreground batch this build will run.
    pub batch_limit: usize,
}

/// Where an online field came from, for the attribution line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichmentAttribution {
    pub label: String,
    pub url: String,
    pub fields: Vec<String>,
}

/// One candidate offered for review or manual cover selection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichmentCandidate {
    /// Provider-relative key, safe to send back to accept this candidate.
    pub key: String,
    pub source: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i64>,
    pub publisher: Option<String>,
    pub has_cover: bool,
    /// A short-lived preview for the review sheet. Never a filesystem path.
    pub cover_data_url: Option<String>,
    pub source_url: String,
}

/// The result of one lookup. Every state the Flip must show is explicit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum EnrichmentOutcome {
    Applied {
        source: String,
        fields: Vec<String>,
        attribution: Option<EnrichmentAttribution>,
    },
    NeedsReview {
        candidates: Vec<EnrichmentCandidate>,
        attribution: EnrichmentAttribution,
    },
    NoMatch {
        source: String,
        reason: String,
    },
    Unavailable {
        source: String,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after_seconds: Option<u64>,
    },
    Cancelled,
}

/// Safe enrichment state attached to a book detail response.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEnrichmentState {
    /// The file supplied a cover that must not be replaced automatically.
    pub has_file_cover: bool,
    pub file_cover_source: Option<CoverSource>,
    pub cover_source: Option<CoverSource>,
    /// True when the cover was chosen by the reader and is protected.
    pub cover_manual: bool,
    /// `manual` or an online source name for the blurb, when not file-derived.
    pub description_source: Option<String>,
    pub description_url: Option<String>,
    pub cover_url: Option<String>,
    /// True when the blurb or cover is still a gap.
    pub has_gap: bool,
    /// Attribution for the fields currently shown, when they came online.
    pub attribution: Option<EnrichmentAttribution>,
}

/// One choice in the manual cover chooser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverOption {
    /// Stable key: `original`, `generated`, `online:<key>`, `device:<token>`.
    pub key: String,
    /// `embedded`, `rendered`, `generated`, `open_library`, `internet_archive`, `device`.
    pub source: String,
    pub label: String,
    pub detail: Option<String>,
    pub preview_data_url: Option<String>,
    pub is_current: bool,
    pub is_original: bool,
    /// Provider candidate this image belongs to, when online.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_key: Option<String>,
    /// Provider-relative cover key, used only to fetch the chosen bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_cover_key: Option<String>,
    /// Public edition/item page for attribution and reset provenance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    /// Present when the image needs an explicit acknowledgement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Everything the cover chooser needs before it makes a network request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverChoices {
    pub current: Option<CoverOption>,
    /// The file's own cover, or the generated plate when the file has none.
    pub original: CoverOption,
    /// Cached edition candidates, if a previous lookup left them.
    pub online: Vec<CoverOption>,
    pub source_label: String,
}

/// The result of an explicit Open Library cover lookup in the chooser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum CoverLookupOutcome {
    Found {
        candidates: Vec<CoverOption>,
        attribution: EnrichmentAttribution,
    },
    Unavailable {
        source: String,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after_seconds: Option<u64>,
    },
    NoMatch {
        source: String,
        reason: String,
    },
    Cancelled,
}

/// A device image waiting for the reader's explicit warning acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCoverPreview {
    pub token: String,
    pub preview_data_url: String,
    pub width: u32,
    pub height: u32,
    pub warning: Option<String>,
}

/// One book in the library.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: i64,
    pub content_hash: String,
    /// Scan-side quick fingerprint. Never serialised to the UI.
    #[serde(skip)]
    pub quick_key: Option<String>,
    /// Filesystem path. Never serialised to the UI; `id` is the opaque handle.
    #[serde(skip)]
    pub path: String,
    pub format: BookFormat,
    pub title: String,
    pub authors: Vec<String>,
    pub series: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub identifier: Option<String>,
    /// Page count, read from a PDF; EPUBs are reflowable and have none.
    pub page_count: Option<i64>,
    /// How this book's generated spine is presented. Defaults to Wrap.
    #[serde(default)]
    pub spine_style: SpineStyle,
    /// The cached 52 x 236 strip for this book, when one exists.
    ///
    /// The shell stamps this while listing so the wall can paint immediately
    /// from the list payload; it is never read from SQLite and never a path.
    #[serde(default)]
    pub spine_data_url: Option<String>,
    /// Cached cover path. Never serialised to the UI.
    #[serde(skip)]
    pub cover_path: Option<String>,
    /// Where the cached cover came from. Kept in the model for the scan and the
    /// detail refresh; the UI has no use for it on the wire.
    #[serde(skip)]
    pub cover_source: Option<CoverSource>,
    /// The cover the book file itself supplied, kept even when an online or
    /// manual cover is active so revert can restore it.
    #[serde(skip)]
    pub file_cover_path: Option<String>,
    #[serde(skip)]
    pub file_cover_source: Option<CoverSource>,
    /// The blurb the book file itself supplied.
    #[serde(skip)]
    pub file_description: Option<String>,
    pub added_at: i64,
    pub shelf_id: Option<i64>,
    pub slot_index: Option<i64>,
    pub reading_status: ReadingStatus,
    /// Labels worn by this book, in creation order.
    pub labels: Vec<Label>,
}

/// The longest title the Edit layer accepts, in characters.
pub const MAX_BOOK_TITLE_LENGTH: usize = 500;

/// Optional core-field changes submitted by the Edit layer.
///
/// An absent field keeps its current value. `page_count` distinguishes an
/// absent value (keep) from an explicit `null` (clear) because the Edit layer
/// must be able to remove a page count that does not apply.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEdit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_present_page_count"
    )]
    pub page_count: Option<Option<i64>>,
}

/// Keep a present `null` distinct from a missing field when deserialising.
fn deserialize_present_page_count<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<Option<i64>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<i64>::deserialize(deserializer).map(Some)
}

/// A book plus everything the detail panel needs.
///
/// The cover arrives as a data URL so the UI never learns a filesystem path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetail {
    #[serde(flatten)]
    pub book: Book,
    pub cover_data_url: Option<String>,
    /// Safe enrichment state: sources, gaps and protection, never paths.
    pub enrichment: BookEnrichmentState,
}

/// Why one file did not become a book.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanIssueReason {
    /// The source could not read the file.
    Unreadable,
    /// The file says EPUB but its container or package is broken.
    InvalidEpub,
    /// The file says PDF but its structure cannot be read.
    InvalidPdf,
}

impl ScanIssueReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unreadable => "unreadable",
            Self::InvalidEpub => "invalid_epub",
            Self::InvalidPdf => "invalid_pdf",
        }
    }
}

/// A file that was left off the shelf, with a stable reason code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    /// File name only; never a full path.
    pub name: String,
    pub reason: ScanIssueReason,
}

/// A fixed shelf (furniture, not a query).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub id: i64,
    pub ordinal: i64,
    pub capacity: i64,
}

/// Where one newly imported book landed, so append behavior can be observed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub book_id: i64,
    pub shelf_id: i64,
    pub shelf_ordinal: i64,
    /// True when this scan had to append the shelf to make room.
    pub appended_shelf: bool,
}

/// A reusable coloured label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: i64,
    pub name: String,
    pub colour: String,
    pub created_at: i64,
}

/// A label together with how many books wear it, for the manager surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelUsage {
    #[serde(flatten)]
    pub label: Label,
    pub book_count: i64,
}

/// What an annotation is for. Bookmarks are the same table with their own
/// narrow CRUD surface; highlights and notes carry a colour, note and locator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    Highlight,
    Note,
    Bookmark,
}

impl AnnotationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Highlight => "highlight",
            Self::Note => "note",
            Self::Bookmark => "bookmark",
        }
    }
}

impl ToSql for AnnotationKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for AnnotationKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "highlight" => Ok(Self::Highlight),
            "note" => Ok(Self::Note),
            "bookmark" => Ok(Self::Bookmark),
            other => Err(FromSqlError::Other(
                format!("unknown annotation kind: {other}").into(),
            )),
        }
    }
}

/// One durable bookmark. Bookmarks are annotations with `kind = 'bookmark'`;
/// the locator is a versioned JSON document (CFI + quote fallback).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    pub locator: String,
    pub created_at: i64,
}

/// A highlight or note attached to a range of an EPUB.
///
/// The locator is a Readium-shaped JSON document (href, CFI fragment,
/// progression/position, quoted text plus W3C TextQuote/TextPosition
/// selectors). Core treats it as opaque; the reader repairs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: i64,
    pub book_id: i64,
    pub kind: AnnotationKind,
    pub colour: Option<String>,
    pub note: Option<String>,
    pub locator: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A book's reading position and status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingState {
    pub status: ReadingStatus,
    pub status_source: String,
    pub progress: f64,
    pub locator: Option<String>,
}

/// What one rescan changed, in user-visible terms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// Books currently on the shelves (including finished ones).
    pub total: usize,
    /// Files that were not in the catalog before this scan.
    pub added: usize,
    /// Known books whose local file path was filled in or changed. A restored
    /// book starts pathless and is re-linked by content hash on the next scan.
    pub relinked: usize,
    /// Known books whose file is gone; they are now marked finished.
    pub removed: usize,
    /// Repeated copies of bytes already in the library; only one book is kept.
    pub duplicates: usize,
    /// Files skipped because they could not be read or parsed.
    pub skipped: Vec<ScanIssue>,
    /// Where this scan put each newly added book, in scan order.
    pub placements: Vec<Placement>,
}

/// Whether a library folder is usable right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryState {
    /// First run: no folder has ever been chosen.
    NeedsFolder,
    /// The persisted read/write grant is valid.
    Ready,
    /// A folder was chosen before, but the grant is gone or the folder moved.
    Disconnected,
}

/// The folder state shown by onboarding, the wall and Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub state: LibraryState,
    /// Display name only; the URI never crosses the wire.
    pub folder_name: Option<String>,
}

/// A persisted download queue item. The queue survives relaunch; a row that was
/// running when the app stopped is recovered to `queued` and resumed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl ToSql for DownloadState {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for DownloadState {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(FromSqlError::Other(
                format!("unknown download state: {other}").into(),
            )),
        }
    }
}

/// What the search result hands to the queue. Mirrors are the `ads.php` links
/// printed on the result; the resolver follows them to the CDN.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub md5: String,
    pub title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub year: Option<u16>,
    pub format: BookFormat,
    #[serde(default)]
    pub source: String,
    /// The `ads.php` mirror URLs, in the order printed by the result.
    #[serde(default)]
    pub mirror_urls: Vec<String>,
}

/// One download row as exposed to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: i64,
    pub md5: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u16>,
    pub format: BookFormat,
    pub source: String,
    /// Mirror URLs the resolver should try, in order. Kept for retry/resume.
    pub mirror_urls: Vec<String>,
    pub state: DownloadState,
    /// Host currently serving, or last tried by, this download.
    pub mirror: Option<String>,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    /// Terminal failure text, or a transient note such as
    /// "Trying another mirror…" while a row is still running.
    pub error: Option<String>,
    /// Stable reason code for a failure or a duplicate completion.
    pub error_code: Option<String>,
    /// The existing or newly landed book, when the download reached one.
    pub book_id: Option<i64>,
    pub filename: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}

/// Where a downloaded file landed, or which existing book it matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Landing {
    Added {
        book_id: i64,
        shelf_id: i64,
        shelf_ordinal: i64,
    },
    Duplicate {
        book_id: i64,
    },
}
