//! Online metadata enrichment: matching, confidence, covers, provenance and
//! the manual cover chooser's network surface.
//!
//! The module deliberately keeps network work behind [`MetadataProvider`]. The
//! catalog remains the only writer of the database; tests inject a fake
//! provider and never touch the public internet.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use futures_util::future::BoxFuture;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::cover::{self, CoverRejection};
use crate::error::{Error, Result};
use crate::models::{
    BookDetail, BookEnrichmentState, CoverChoices, CoverLookupOutcome, CoverOption, CoverSource,
    DeviceCoverPreview, EnrichmentAttribution, EnrichmentCandidate, EnrichmentMode,
    EnrichmentOutcome, EnrichmentSettings,
};
use crate::service::Service;

pub const SOURCE_OPEN_LIBRARY: &str = "open_library";
pub const SOURCE_INTERNET_ARCHIVE: &str = "internet_archive";
pub const SOURCE_LABEL: &str = "Open Library";
pub const SOURCE_URL: &str = "https://openlibrary.org";
pub const BATCH_LIMIT: usize = 20;
const SUCCESS_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
const NO_MATCH_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const ERROR_COOLDOWN_SECONDS: i64 = 15 * 60;
const MAX_REVIEW_CANDIDATES: usize = 4;

// ---------------------------------------------------------------------------
// Provider seam
// ---------------------------------------------------------------------------

/// What to ask a provider for: an ISBN, a known edition/work key, or a title
/// and author search. At most one of `isbn`/`edition_key` is set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LookupRequest {
    pub isbn: Option<String>,
    pub edition_key: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i64>,
}

/// An Internet Archive item linked to a matched Open Library edition.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderSupplement {
    pub description: Option<String>,
    pub cover_keys: Vec<String>,
    pub source_url: String,
    pub access_restricted: bool,
}

/// One provider record before confidence matching.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderCandidate {
    /// Stable provider-relative key, e.g. `open_library:/books/OL...M`.
    pub key: String,
    pub source: String,
    pub edition_key: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i64>,
    pub publisher: Option<String>,
    pub description: Option<String>,
    pub cover_keys: Vec<String>,
    pub source_url: String,
    pub ocaid: Option<String>,
    pub supplement: Option<ProviderSupplement>,
}

impl ProviderCandidate {
    pub fn open_library(key: impl Into<String>, title: impl Into<String>) -> Self {
        let key = key.into();
        Self {
            source_url: format!("{SOURCE_URL}{key}"),
            key: format!("open_library:{key}"),
            source: SOURCE_OPEN_LIBRARY.to_owned(),
            title: title.into(),
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderErrorKind {
    Offline,
    Timeout,
    RateLimited,
    Status(u16),
    Malformed,
    TooLarge,
    BadContentType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderError {
    pub kind: ProviderErrorKind,
    pub retry_after_seconds: Option<u64>,
}

impl ProviderError {
    pub fn offline() -> Self {
        Self {
            kind: ProviderErrorKind::Offline,
            retry_after_seconds: None,
        }
    }

    pub fn status(code: u16, retry_after_seconds: Option<u64>) -> Self {
        let kind = if code == 429 {
            ProviderErrorKind::RateLimited
        } else {
            ProviderErrorKind::Status(code)
        };
        Self {
            kind,
            retry_after_seconds,
        }
    }

    pub fn malformed() -> Self {
        Self {
            kind: ProviderErrorKind::Malformed,
            retry_after_seconds: None,
        }
    }

    /// Only temporary faults are retried.
    pub fn retryable(&self) -> bool {
        matches!(
            self.kind,
            ProviderErrorKind::Offline
                | ProviderErrorKind::Timeout
                | ProviderErrorKind::RateLimited
                | ProviderErrorKind::Status(500..=599)
        )
    }

    pub fn code(&self) -> &'static str {
        match self.kind {
            ProviderErrorKind::Offline => "offline",
            ProviderErrorKind::Timeout => "timeout",
            ProviderErrorKind::RateLimited => "rate_limited",
            ProviderErrorKind::Status(401) => "unauthorized",
            ProviderErrorKind::Status(403) => "forbidden",
            ProviderErrorKind::Status(404) => "not_found",
            ProviderErrorKind::Status(429) => "rate_limited",
            ProviderErrorKind::Status(_) => "source_error",
            ProviderErrorKind::Malformed => "malformed",
            ProviderErrorKind::TooLarge => "too_large",
            ProviderErrorKind::BadContentType => "bad_content_type",
        }
    }

    pub fn message(&self) -> &'static str {
        match self.kind {
            ProviderErrorKind::Offline => {
                "You're offline. The book is still here; details were not updated."
            }
            ProviderErrorKind::Timeout => "Open Library did not answer in time. Try again in a moment.",
            ProviderErrorKind::RateLimited => {
                "Open Library asked the app to slow down. Try again in a moment."
            }
            ProviderErrorKind::Status(401 | 403) => {
                "Open Library refused this lookup. The file's details are unchanged."
            }
            ProviderErrorKind::Status(404) => "No online match found for this edition.",
            ProviderErrorKind::Status(_) => {
                "Open Library could not answer just now. The file's details are unchanged."
            }
            ProviderErrorKind::Malformed => {
                "Open Library sent a record the app could not read. The file's details are unchanged."
            }
            ProviderErrorKind::TooLarge | ProviderErrorKind::BadContentType => {
                "The cover offered for this edition was not usable. The file's cover is unchanged."
            }
        }
    }
}

pub type ProviderResult<T> = std::result::Result<T, ProviderError>;

/// The provider surface. Production has one general provider (Open Library)
/// plus its edition-linked Internet Archive supplement.
pub trait MetadataProvider: Send + Sync {
    fn lookup<'a>(&'a self, request: LookupRequest) -> BoxFuture<'a, ProviderResult<Vec<ProviderCandidate>>>;
    fn fetch_cover<'a>(&'a self, key: String) -> BoxFuture<'a, ProviderResult<Vec<u8>>>;
    fn supplement<'a>(&'a self, ocaid: String) -> BoxFuture<'a, ProviderResult<ProviderSupplement>>;
}

// ---------------------------------------------------------------------------
// A production Open Library provider
// ---------------------------------------------------------------------------

type Shared<T> = Arc<T>;

/// Open Library plus the Internet Archive supplement. Base URLs are
/// configurable so a local fake server can exercise the HTTP seam.
pub struct OpenLibraryProvider {
    client: wreq::Client,
    base: String,
    covers_base: String,
    archive_base: String,
    user_agent: String,
    metadata_gate: tokio::sync::Mutex<Instant>,
    cover_gate: tokio::sync::Mutex<Instant>,
    archive_gate: tokio::sync::Mutex<Instant>,
}

impl OpenLibraryProvider {
    pub fn new() -> Result<Self> {
        Self::with_bases(
            "https://openlibrary.org",
            "https://covers.openlibrary.org",
            "https://archive.org",
        )
    }

    pub fn with_bases(
        base: impl Into<String>,
        covers_base: impl Into<String>,
        archive_base: impl Into<String>,
    ) -> Result<Self> {
        let client = wreq::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(wreq::redirect::Policy::limited(5))
            .build()
            .map_err(|_| Error::Offline)?;
        Ok(Self {
            client,
            base: base.into().trim_end_matches('/').to_owned(),
            covers_base: covers_base.into().trim_end_matches('/').to_owned(),
            archive_base: archive_base.into().trim_end_matches('/').to_owned(),
            user_agent: format!(
                "PocketLibrary/{} (+https://github.com/YeahItsMeAgain/PocketLibrary)",
                env!("CARGO_PKG_VERSION")
            ),
            metadata_gate: tokio::sync::Mutex::new(Instant::now() - Duration::from_secs(1)),
            cover_gate: tokio::sync::Mutex::new(Instant::now() - Duration::from_secs(4)),
            archive_gate: tokio::sync::Mutex::new(Instant::now() - Duration::from_secs(2)),
        })
    }

    /// Override the identifying User-Agent, used by tests.
    pub fn with_user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = user_agent.into();
        self
    }

    async fn gate(gate: &tokio::sync::Mutex<Instant>, interval: Duration) {
        let mut last = gate.lock().await;
        let now = Instant::now();
        let ready = *last + interval;
        if ready > now {
            tokio::time::sleep(ready - now).await;
        }
        *last = Instant::now();
    }

    async fn get_json(&self, url: String) -> ProviderResult<serde_json::Value> {
        let response = self
            .client
            .get(url)
            .header(wreq::header::USER_AGENT, &self.user_agent)
            .header(wreq::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    ProviderError {
                        kind: ProviderErrorKind::Timeout,
                        retry_after_seconds: None,
                    }
                } else {
                    ProviderError::offline()
                }
            })?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return Err(ProviderError::status(status, retry_after(&response)));
        }
        let content_type = response
            .headers()
            .get(wreq::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if let Some(content_type) = content_type
            && !content_type.to_ascii_lowercase().contains("json")
        {
            return Err(ProviderError {
                kind: ProviderErrorKind::BadContentType,
                retry_after_seconds: None,
            });
        }
        let bytes = response.bytes().await.map_err(|_| ProviderError::offline())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(ProviderError {
                kind: ProviderErrorKind::TooLarge,
                retry_after_seconds: None,
            });
        }
        serde_json::from_slice(&bytes).map_err(|_| ProviderError::malformed())
    }

    async fn edition_candidate(&self, edition: &serde_json::Value, isbn: Option<&str>) -> Option<ProviderCandidate> {
        let key = edition.get("key")?.as_str()?.to_owned();
        let title = edition
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        if title.is_empty() && isbn.is_none() {
            return None;
        }
        let mut candidate = ProviderCandidate::open_library(key.clone(), title);
        candidate.authors = edition_authors(edition);
        candidate.year = edition_year(edition);
        candidate.publisher = edition
            .get("publishers")
            .and_then(|value| value.as_array())
            .and_then(|values| values.first())
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        candidate.description = edition_description(edition);
        candidate.cover_keys = edition_cover_keys(edition, isbn);
        candidate.edition_key = Some(format!("open_library:{key}"));
        candidate.ocaid = edition
            .get("ocaid")
            .and_then(|value| value.as_str())
            .map(str::to_owned);

        // The edition often has no description; one work request fills it.
        if candidate.description.is_none()
            && let Some(work) = edition
                .get("works")
                .and_then(|value| value.as_array())
                .and_then(|values| values.first())
                .and_then(|value| value.get("key"))
                .and_then(|value| value.as_str())
        {
            Self::gate(&self.metadata_gate, Duration::from_millis(360)).await;
            if let Ok(value) = self.get_json(format!("{}{}", self.base, work)).await {
                candidate.description = edition_description(&value);
                if candidate.cover_keys.is_empty() {
                    candidate.cover_keys = edition_cover_keys(&value, isbn);
                }
            }
        }

        if candidate.description.is_none()
            && let Some(ocaid) = candidate.ocaid.clone()
            && let Ok(supplement) = self.supplement(ocaid).await
            && !supplement.access_restricted
        {
            candidate.supplement = Some(supplement);
        }
        Some(candidate)
    }

    fn search_candidate(&self, result: &serde_json::Value) -> Option<ProviderCandidate> {
        let key = result.get("key")?.as_str()?.to_owned();
        let title = result
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        if title.is_empty() {
            return None;
        }
        let mut candidate = ProviderCandidate::open_library(key.clone(), title);        candidate.authors = result
            .get("author_name")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        candidate.year = result.get("first_publish_year").and_then(|value| value.as_i64());
        candidate.publisher = result
            .get("publisher")
            .and_then(|value| value.as_array())
            .and_then(|values| values.first())
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        candidate.description = result.get("description").and_then(description_value);
        candidate.edition_key = result
            .get("edition_key")
            .and_then(|value| value.as_array())
            .and_then(|values| values.first())
            .and_then(|value| value.as_str())
            .map(|key| format!("open_library:/books/{key}"));
        if let Some(cover) = result.get("cover_i").and_then(|value| value.as_i64()) {
            candidate.cover_keys.push(format!("id:{cover}"));
        }
        Some(candidate)
    }
}

fn description_value(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    value
        .get("value")
        .and_then(|inner| inner.as_str())
        .map(str::to_owned)
}

fn edition_description(value: &serde_json::Value) -> Option<String> {
    value.get("description").and_then(description_value)
}

fn edition_authors(value: &serde_json::Value) -> Vec<String> {
    let mut authors = Vec::new();
    if let Some(statement) = value.get("by_statement").and_then(|value| value.as_str()) {
        authors.push(statement.to_owned());
    }
    if authors.is_empty()
        && let Some(values) = value.get("authors").and_then(|value| value.as_array())
    {
        for entry in values {
            if let Some(name) = entry.get("name").and_then(|value| value.as_str()) {
                authors.push(name.to_owned());
            }
        }
    }
    authors
}

fn edition_year(value: &serde_json::Value) -> Option<i64> {
    value
        .get("publish_date")
        .and_then(|value| value.as_str())
        .or_else(|| value.get("first_publish_year").and_then(|value| value.as_str()))
        .and_then(first_year)
        .or_else(|| value.get("first_publish_year").and_then(|value| value.as_i64()))
}

fn edition_cover_keys(value: &serde_json::Value, isbn: Option<&str>) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(covers) = value.get("covers").and_then(|value| value.as_array()) {
        for cover in covers {
            if let Some(id) = cover.as_i64()
                && id > 0
            {
                keys.push(format!("id:{id}"));
            }
        }
    }
    if let Some(isbn) = isbn {
        keys.push(format!("isbn:{isbn}"));
    }
    if let Some(key) = value.get("key").and_then(|value| value.as_str())
        && let Some(olid) = key.strip_prefix("/books/")
    {
        keys.push(format!("olid:{olid}"));
    }
    keys.dedup();
    keys
}

fn first_year(value: &str) -> Option<i64> {
    let digits: String = value
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.len() >= 4 {
        digits[..4].parse().ok()
    } else {
        None
    }
}

fn retry_after(response: &wreq::Response) -> Option<u64> {
    response
        .headers()
        .get(wreq::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok())
}

impl MetadataProvider for OpenLibraryProvider {
    fn lookup<'a>(&'a self, request: LookupRequest) -> BoxFuture<'a, ProviderResult<Vec<ProviderCandidate>>> {
        Box::pin(async move {
            if let Some(isbn) = request.isbn.as_deref() {
                Self::gate(&self.metadata_gate, Duration::from_millis(360)).await;
                let value = self
                    .get_json(format!("{}/isbn/{isbn}.json", self.base))
                    .await?;
                return Ok(self
                    .edition_candidate(&value, Some(isbn))
                    .await
                    .into_iter()
                    .collect());
            }

            if let Some(key) = request.edition_key.as_deref() {
                let path = key
                    .strip_prefix("open_library:")
                    .unwrap_or(key)
                    .to_owned();
                Self::gate(&self.metadata_gate, Duration::from_millis(360)).await;
                let value = self.get_json(format!("{}{}", self.base, path)).await?;
                return Ok(self.edition_candidate(&value, None).await.into_iter().collect());
            }

            let mut query = Vec::new();
            if !request.title.trim().is_empty() {
                query.push(format!("title:{}", request.title.trim()));
            }
            for author in &request.authors {
                if !author.trim().is_empty() {
                    query.push(format!("author:{}", author.trim()));
                    break;
                }
            }
            if query.is_empty() {
                return Ok(Vec::new());
            }
            let encoded = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("q", &query.join(" "))
                .append_pair(
                    "fields",
                    "key,title,author_name,first_publish_year,publisher,cover_i,edition_key,description",
                )
                .append_pair("limit", "8")
                .finish();
            Self::gate(&self.metadata_gate, Duration::from_millis(360)).await;
            let value = self
                .get_json(format!("{}/search.json?{encoded}", self.base))
                .await?;
            let candidates = value
                .get("docs")
                .and_then(|value| value.as_array())
                .map(|docs| {
                    docs.iter()
                        .filter_map(|doc| self.search_candidate(doc))
                        .collect()
                })
                .unwrap_or_default();
            Ok(candidates)
        })
    }

    fn fetch_cover<'a>(&'a self, key: String) -> BoxFuture<'a, ProviderResult<Vec<u8>>> {
        Box::pin(async move {
            let url = if let Some(archive_id) = key.strip_prefix("ia:") {
                Self::gate(&self.archive_gate, Duration::from_millis(1100)).await;
                format!("{}/services/img/{archive_id}", self.archive_base)
            } else {
                Self::gate(&self.cover_gate, Duration::from_secs(3)).await;
                format!("{}/b/{key}-L.jpg?default=false", self.covers_base)
            };
            let response = self
                .client
                .get(url)
                .header(wreq::header::USER_AGENT, &self.user_agent)
                .send()
                .await
                .map_err(|error| {
                    if error.is_timeout() {
                        ProviderError {
                            kind: ProviderErrorKind::Timeout,
                            retry_after_seconds: None,
                        }
                    } else {
                        ProviderError::offline()
                    }
                })?;
            let status = response.status().as_u16();
            if !response.status().is_success() {
                return Err(ProviderError::status(status, retry_after(&response)));
            }
            let content_type = response
                .headers()
                .get(wreq::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            if let Some(content_type) = &content_type {
                let lower = content_type.to_ascii_lowercase();
                if !lower.starts_with("image/") {
                    return Err(ProviderError {
                        kind: ProviderErrorKind::BadContentType,
                        retry_after_seconds: None,
                    });
                }
            }
            if let Some(length) = response.content_length()
                && length > cover::MAX_ONLINE_COVER_BYTES as u64
            {
                return Err(ProviderError {
                    kind: ProviderErrorKind::TooLarge,
                    retry_after_seconds: None,
                });
            }
            let bytes = response.bytes().await.map_err(|_| ProviderError::offline())?;
            if bytes.len() > cover::MAX_ONLINE_COVER_BYTES {
                return Err(ProviderError {
                    kind: ProviderErrorKind::TooLarge,
                    retry_after_seconds: None,
                });
            }
            Ok(bytes.to_vec())
        })
    }

    fn supplement<'a>(&'a self, ocaid: String) -> BoxFuture<'a, ProviderResult<ProviderSupplement>> {
        Box::pin(async move {
            Self::gate(&self.archive_gate, Duration::from_millis(1100)).await;
            let value = self
                .get_json(format!("{}/metadata/{ocaid}", self.archive_base))
                .await?;
            let access_restricted = value
                .get("access-restricted-item")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let description = value.get("description").and_then(|value| {
                if let Some(text) = value.as_str() {
                    Some(text.to_owned())
                } else if let Some(items) = value.as_array() {
                    Some(
                        items
                            .iter()
                            .filter_map(|item| item.as_str())
                            .collect::<Vec<_>>()
                            .join("\n"),
                    )
                } else {
                    None
                }
            });
            Ok(ProviderSupplement {
                description,
                cover_keys: vec![format!("ia:{ocaid}")],
                source_url: format!("https://archive.org/details/{ocaid}"),
                access_restricted,
            })
        })
    }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Confidence {
    High,
    Medium,
    None,
}

fn fold(value: &str) -> String {
    value
        .nfkd()
        .filter(|c| !c.is_combining_marks())
        .flat_map(char::to_lowercase)
        .collect()
}

trait CombiningMark {
    fn is_combining_marks(&self) -> bool;
}

impl CombiningMark for char {
    fn is_combining_marks(&self) -> bool {
        matches!(*self as u32, 0x0300..=0x036f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff)
    }
}

/// Case-fold, strip diacritics and punctuation, remove a leading article and
/// collapse whitespace. A subtitle is dropped after `:` or an em dash.
pub fn normalise_title(value: &str) -> String {
    let mut folded = fold(value);
    if let Some((main, subtitle)) = folded.split_once(':') {
        if main.trim().split_whitespace().count() >= 2 {
            folded = main.to_owned();
        } else {
            let _ = subtitle;
        }
    }
    if let Some((main, _subtitle)) = folded.split_once('—') {
        if main.trim().split_whitespace().count() >= 2 {
            folded = main.to_owned();
        }
    }
    let words: Vec<String> = folded
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let mut words = words;
    if words.len() > 1
        && matches!(
            words.first().map(String::as_str),
            Some("the" | "a" | "an" | "le" | "la" | "les" | "der" | "die" | "das")
        )
    {
        words.remove(0);
    }
    if words.len() > 1
        && matches!(
            words.last().map(String::as_str),
            Some("the" | "a" | "an" | "le" | "la" | "les" | "der" | "die" | "das")
        )
    {
        words.pop();
    }
    words.join(" ")
}

fn title_similarity(left: &str, right: &str) -> f64 {
    let left = normalise_title(left);
    let right = normalise_title(right);
    if left == right {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    // Token overlap plus a length penalty is enough for book titles and keeps
    // common words from producing a confident mismatch.
    let left_words: Vec<&str> = left.split_whitespace().collect();
    let right_words: Vec<&str> = right.split_whitespace().collect();
    let hits = left_words
        .iter()
        .filter(|word| right_words.contains(word))
        .count();
    let overlap = hits as f64 / left_words.len().max(right_words.len()) as f64;
    let length_ratio = left.len().min(right.len()) as f64 / left.len().max(right.len()) as f64;
    overlap * 0.7 + length_ratio * 0.3
}

fn surname(author: &str) -> String {
    let folded = fold(author);
    folded
        .split_whitespace()
        .next_back()
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn author_matches(file_authors: &[String], candidate_authors: &[String]) -> bool {
    if file_authors.is_empty() || candidate_authors.is_empty() {
        return file_authors.is_empty();
    }
    file_authors.iter().any(|file| {
        let file_surname = surname(file);
        !file_surname.is_empty()
            && candidate_authors.iter().any(|candidate| {
                let candidate_surname = surname(candidate);
                !candidate_surname.is_empty()
                    && (candidate_surname.contains(&file_surname)
                        || file_surname.contains(&candidate_surname))
            })
    })
}

fn clean_blurb(raw: &str) -> Option<String> {
    let mut text = String::with_capacity(raw.len());
    let mut in_tag = false;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                // Keep paragraph boundaries as newlines.
                let mut tag = String::new();
                for next in chars.by_ref() {
                    if next == '>' {
                        break;
                    }
                    tag.push(next);
                }
                let name = tag
                    .trim()
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(name.as_str(), "p" | "br" | "div" | "li" | "h1" | "h2" | "h3") {
                    text.push('\n');
                }
                in_tag = false;
            }
            '&' => {
                let mut entity = String::new();
                while let Some(next) = chars.next() {
                    if next == ';' || entity.len() > 10 {
                        break;
                    }
                    entity.push(next);
                }
                text.push(match entity.as_str() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" | "#39" => '\'',
                    "nbsp" => ' ',
                    "mdash" => '—',
                    "ndash" => '–',
                    "hellip" => '…',
                    _ => ' ',
                });
                in_tag = in_tag || false;
            }
            _ => text.push(c),
        }
    }
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            line.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect();
    let mut cleaned = lines.join("\n\n");
    cleaned = cleaned.trim().to_owned();
    if cleaned.is_empty() {
        return None;
    }
    let lower = cleaned.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "about the author" | "look inside" | "table of contents"
    ) || lower.starts_with("http://")
        || lower.starts_with("https://")
    {
        return None;
    }
    const MAX_CHARS: usize = 4000;
    if cleaned.chars().count() > MAX_CHARS {
        cleaned = cleaned.chars().take(MAX_CHARS).collect::<String>();
        cleaned = cleaned.trim_end().to_owned();
    }
    Some(cleaned)
}

// ---------------------------------------------------------------------------
// ISBN handling
// ---------------------------------------------------------------------------

/// Find the first plausible ISBN in a metadata identifier or filename.
pub fn find_isbn(value: &str) -> Option<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut start = 0;
    while start < chars.len() {
        if !chars[start].is_ascii_digit() {
            start += 1;
            continue;
        }
        let mut end = start;
        while end < chars.len()
            && (chars[end].is_ascii_digit() || matches!(chars[end], '-' | ' ' | 'X' | 'x'))
        {
            end += 1;
        }
        let raw: String = chars[start..end].iter().collect();
        if let Some(isbn) = normalise_isbn(&raw) {
            return Some(isbn);
        }
        start = end.max(start + 1);
    }
    None
}

/// Validate an ISBN-10 or ISBN-13 and normalise it to ISBN-13.
pub fn normalise_isbn(value: &str) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, 'X' | 'x'))
        .map(|c| c.to_ascii_uppercase())
        .collect();
    match cleaned.len() {
        10 => {
            let mut sum = 0u32;
            for (index, c) in cleaned.chars().enumerate() {
                let digit = if c == 'X' && index == 9 {
                    10
                } else {
                    c.to_digit(10)?
                };
                sum += digit * (10 - index as u32);
            }
            if sum % 11 != 0 {
                return None;
            }
            let core = format!("978{}", &cleaned[..9]);
            Some(core_with_check_digit(core))
        }
        13 => {
            if !cleaned.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            if !valid_isbn13(&cleaned) {
                return None;
            }
            Some(cleaned)
        }
        _ => None,
    }
}

fn core_with_check_digit(core: String) -> String {
    let sum: u32 = core
        .chars()
        .enumerate()
        .map(|(index, c)| {
            let digit = c.to_digit(10).unwrap_or(0);
            if index % 2 == 0 { digit } else { digit * 3 }
        })
        .sum();
    let check = (10 - (sum % 10)) % 10;
    format!("{core}{check}")
}

fn valid_isbn13(value: &str) -> bool {
    let sum: u32 = value
        .chars()
        .enumerate()
        .map(|(index, c)| {
            let digit = c.to_digit(10).unwrap_or(0);
            if index % 2 == 0 { digit } else { digit * 3 }
        })
        .sum();
    sum % 10 == 0
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

#[allow(dead_code)]
struct BookSnapshot {
    id: i64,
    content_hash: String,
    title: String,
    authors: Vec<String>,
    identifier: Option<String>,
    description: Option<String>,
    published_date: Option<String>,
    path: String,
    cover_path: Option<String>,
    cover_source: Option<CoverSource>,
    file_cover_path: Option<String>,
    file_cover_source: Option<CoverSource>,
    file_description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provenance {
    Manual,
    Online,
    File,
}

#[derive(Debug, Clone)]
struct CachedEnrichment {
    source: String,
    matched_key: Option<String>,
    confidence: String,
    status: String,
    applied_fields: Vec<String>,
    attribution_label: Option<String>,
    attribution_url: Option<String>,
    cover_keys: Vec<String>,
    fetched_at: i64,
}

#[derive(Debug, Clone)]
struct PendingDevice {
    book_id: i64,
    cover: Vec<u8>,
    warning: Option<String>,
}

/// Owns provider calls, cancellation generations, retry pacing and the
/// transaction boundary for writes.
pub struct EnrichmentService {
    service: Arc<Service>,
    provider: Shared<dyn MetadataProvider>,
    generations: Mutex<HashMap<i64, u64>>,
    retry_delays: Vec<Duration>,
    device_pending: Mutex<HashMap<String, PendingDevice>>,
    next_device_token: Mutex<u64>,
}

impl EnrichmentService {
    pub fn new(service: Arc<Service>, provider: Shared<dyn MetadataProvider>) -> Self {
        Self {
            service,
            provider,
            generations: Mutex::new(HashMap::new()),
            retry_delays: vec![
                Duration::from_secs(1),
                Duration::from_secs(4),
                Duration::from_secs(12),
            ],
            device_pending: Mutex::new(HashMap::new()),
            next_device_token: Mutex::new(1),
        }
    }

    /// Production service: Open Library plus its linked Internet Archive read.
    pub fn production(service: Arc<Service>) -> Result<Self> {
        let provider = OpenLibraryProvider::new()?;
        Ok(Self::new(service, Arc::new(provider)))
    }

    /// Tests use zero retry delays so transient-failure cases stay fast.
    pub fn with_zero_retry_delays(mut self) -> Self {
        self.retry_delays = vec![Duration::ZERO; 3];
        self
    }

    pub fn settings(&self) -> Result<EnrichmentSettings> {
        let conn = self.service.connection()?;
        let mode = read_mode(&conn)?;
        Ok(EnrichmentSettings {
            mode,
            source_label: SOURCE_LABEL.to_owned(),
            source_url: SOURCE_URL.to_owned(),
            batch_limit: BATCH_LIMIT,
        })
    }

    pub fn set_mode(&self, mode: EnrichmentMode) -> Result<EnrichmentSettings> {
        {
            let conn = self.service.connection()?;
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES ('enrichment_mode', ?1, unixepoch())
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                [mode.as_str()],
            )?;
        }
        self.settings()
    }

    fn begin(&self, book_id: i64) -> Result<u64> {
        let mut generations = self.generations.lock().map_err(|_| Error::LockPoisoned)?;
        let next = generations.entry(book_id).or_insert(0);
        *next += 1;
        Ok(*next)
    }

    fn is_current(&self, book_id: i64, generation: u64) -> bool {
        self.generations
            .lock()
            .map(|generations| generations.get(&book_id).copied() == Some(generation))
            .unwrap_or(false)
    }

    /// Invalidate any in-flight lookup. A late response writes nothing.
    pub fn cancel(&self, book_id: i64) -> Result<()> {
        self.begin(book_id)?;
        Ok(())
    }

    pub fn state_for_book(&self, book_id: i64) -> Result<BookEnrichmentState> {
        let conn = self.service.connection()?;
        enrichment_state(&conn, book_id)
    }

    /// Look up one book. `force` bypasses the TTL and revalidates.
    pub async fn lookup(&self, book_id: i64, force: bool) -> Result<EnrichmentOutcome> {
        let generation = self.begin(book_id)?;
        let snapshot = {
            let conn = self.service.connection()?;
            snapshot(&conn, book_id)?
        };
        let provenance = {
            let conn = self.service.connection()?;
            (
                provenance_for(&conn, book_id, "description")?.0,
                provenance_for(&conn, book_id, "cover")?.0,
            )
        };

        let cached = {
            let conn = self.service.connection()?;
            cached_enrichment(&conn, book_id)?
        };
        if !force
            && let Some(cached) = &cached
            && let Some(outcome) = cached_outcome(cached, &snapshot, &provenance)
        {
            return Ok(outcome);
        }

        let mut request = self.lookup_request(&snapshot);
        if request.isbn.is_none()
            && let Some(key) = cached.as_ref().and_then(|cached| cached.matched_key.clone())
        {
            request.edition_key = Some(key);
        }
        if request.isbn.is_none() && request.edition_key.is_none() && request.title.trim().is_empty() {
            return Ok(EnrichmentOutcome::NoMatch {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                reason: "no_title".to_owned(),
            });
        }

        let candidates = match self.lookup_with_retry(request).await {
            Ok(candidates) => candidates,
            Err(error) => {
                if !self.is_current(book_id, generation) {
                    return Ok(EnrichmentOutcome::Cancelled);
                }
                self.record_failure(book_id, &snapshot, &error)?;
                return Ok(unavailable(&error));
            }
        };
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }
        if candidates.is_empty() {
            self.record_no_match(book_id, &snapshot)?;
            return Ok(EnrichmentOutcome::NoMatch {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                reason: "no_result".to_owned(),
            });
        }

        let mut ranked: Vec<(Confidence, ProviderCandidate)> = candidates
            .into_iter()
            .map(|candidate| (confidence(&snapshot, &candidate), candidate))
            .filter(|(confidence, _)| *confidence != Confidence::None)
            .collect();
        ranked.sort_by(|a, b| {
            let rank = |confidence: Confidence| match confidence {
                Confidence::High => 0,
                Confidence::Medium => 1,
                Confidence::None => 2,
            };
            rank(a.0).cmp(&rank(b.0))
        });

        let highs: Vec<&(Confidence, ProviderCandidate)> = ranked
            .iter()
            .filter(|(confidence, _)| *confidence == Confidence::High)
            .collect();
        let high = if highs.len() == 1 {
            Some(highs[0].1.clone())
        } else {
            // Two equally good editions: never pick the first cover. They are
            // downgraded to an explicit review choice below.
            None
        };

        if let Some(candidate) = high {
            let outcome = self
                .apply_candidate(
                    book_id,
                    &snapshot,
                    &provenance,
                    candidate.clone(),
                    false,
                    force,
                    generation,
                )
                .await?;
            if !matches!(outcome, EnrichmentOutcome::Cancelled) {
                return Ok(outcome);
            }
            return Ok(EnrichmentOutcome::Cancelled);
        }

        let review: Vec<ProviderCandidate> = ranked
            .iter()
            .filter(|(confidence, _)| *confidence != Confidence::None)
            .take(MAX_REVIEW_CANDIDATES)
            .map(|(_, candidate)| candidate.clone())
            .collect();
        if review.is_empty() {
            self.record_no_match(book_id, &snapshot)?;
            return Ok(EnrichmentOutcome::NoMatch {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                reason: "no_confident_match".to_owned(),
            });
        }

        let attribution = attribution_for(&SOURCE_LABEL, &review[0].source_url, Vec::new());
        let candidates = self.preview_candidates(&review).await;
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }
        Ok(EnrichmentOutcome::NeedsReview {
            candidates,
            attribution,
        })
    }

    fn lookup_request(&self, snapshot: &BookSnapshot) -> LookupRequest {
        let isbn = snapshot
            .identifier
            .as_deref()
            .and_then(find_isbn)
            .or_else(|| find_isbn(&snapshot.path));
        LookupRequest {
            isbn,
            edition_key: None,
            title: snapshot.title.clone(),
            authors: snapshot.authors.clone(),
            year: snapshot
                .published_date
                .as_deref()
                .and_then(first_year),
        }
    }

    async fn lookup_with_retry(&self, request: LookupRequest) -> std::result::Result<Vec<ProviderCandidate>, ProviderError> {
        let mut attempt = 0;
        loop {
            match self.provider.lookup(request.clone()).await {
                Ok(candidates) => return Ok(candidates),
                Err(error) if error.retryable() && attempt < self.retry_delays.len() => {
                    let delay = error
                        .retry_after_seconds
                        .map(Duration::from_secs)
                        .unwrap_or(self.retry_delays[attempt]);
                    if !delay.is_zero() {
                        tokio::time::sleep(delay).await;
                    }
                    attempt += 1;
                }
                Err(error) => return Err(error),
            }
        }
    }

    async fn preview_candidates(&self, candidates: &[ProviderCandidate]) -> Vec<EnrichmentCandidate> {
        let mut previews = Vec::new();
        for candidate in candidates {
            let cover = self.cover_preview(candidate).await;
            previews.push(candidate_view(candidate, cover));
        }
        previews
    }

    async fn cover_preview(&self, candidate: &ProviderCandidate) -> Option<String> {
        let (bytes, _, _) = self.first_usable_cover(candidate, false).await?;
        Some(data_url(&bytes))
    }

    async fn first_usable_cover(
        &self,
        candidate: &ProviderCandidate,
        strict: bool,
    ) -> Option<(Vec<u8>, String, bool)> {
        let mut keys: Vec<(String, bool)> = candidate
            .cover_keys
            .iter()
            .cloned()
            .map(|key| (key, false))
            .collect();
        if let Some(supplement) = &candidate.supplement {
            if !supplement.access_restricted {
                keys.extend(supplement.cover_keys.iter().cloned().map(|key| (key, true)));
            }
        }
        for (key, from_supplement) in keys {
            let Ok(bytes) = self.provider.fetch_cover(key.clone()).await else {
                continue;
            };
            let accepted = if strict {
                cover::validate_online(&bytes, None).ok()
            } else {
                cover::prepare_manual(&bytes).ok().map(|(cover, _, _, _)| cover)
            };
            if let Some(cover) = accepted {
                return Some((cover, key, from_supplement));
            }
            crate::diagnostics::log_event(
                crate::diagnostics::Level::Warn,
                "enrichment_cover",
                "rejected an online cover candidate",
            );
        }
        None
    }

    #[allow(clippy::too_many_arguments)]
    async fn apply_candidate(
        &self,
        book_id: i64,
        snapshot: &BookSnapshot,
        provenance: &(Provenance, Provenance),
        mut candidate: ProviderCandidate,
        explicit: bool,
        force: bool,
        generation: u64,
    ) -> Result<EnrichmentOutcome> {
        let description_gap = match provenance.0 {
            Provenance::Manual => false,
            Provenance::Online => force || explicit,
            Provenance::File => snapshot.description.as_deref().map_or(true, |value| value.trim().is_empty()),
        };
        let cover_gap = match provenance.1 {
            Provenance::Manual => false,
            Provenance::Online => force || explicit,
            Provenance::File => snapshot.cover_source != Some(CoverSource::Embedded)
                && snapshot.cover_source != Some(CoverSource::Rendered),
        };

        // Fill a missing IA supplement lazily when the provider has an ocaid.
        if candidate.supplement.is_none()
            && let Some(ocaid) = candidate.ocaid.clone()
            && let Ok(supplement) = self.provider.supplement(ocaid).await
            && !supplement.access_restricted
        {
            candidate.supplement = Some(supplement);
        }
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }

        let mut fields = Vec::new();
        let mut description_source = candidate.source.clone();
        let mut description_url = candidate.source_url.clone();
        let mut cleaned_description = candidate.description.as_deref().and_then(clean_blurb);
        if cleaned_description.is_none()
            && let Some(supplement) = &candidate.supplement
            && !supplement.access_restricted
        {
            cleaned_description = supplement.description.as_deref().and_then(clean_blurb);
            if cleaned_description.is_some() {
                description_source = SOURCE_INTERNET_ARCHIVE.to_owned();
                description_url = supplement.source_url.clone();
            }
        }

        let mut cover_bytes = None;
        let mut cover_source = candidate.source.clone();
        let mut cover_url = candidate.source_url.clone();
        if cover_gap
            && let Some((bytes, _key, from_supplement)) =
                self.first_usable_cover(&candidate, true).await
        {
            cover_bytes = Some(bytes);
            if from_supplement {
                cover_source = SOURCE_INTERNET_ARCHIVE.to_owned();
                if let Some(supplement) = &candidate.supplement {
                    cover_url = supplement.source_url.clone();
                }
            }
        }
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }

        let cover_path = cover_bytes
            .as_deref()
            .and_then(|bytes| cover::store(&self.service.cover_dir(), bytes));
        let write_description = description_gap
            && cleaned_description.is_some()
            && snapshot.description.as_deref() != cleaned_description.as_deref();
        let write_cover = cover_gap
            && cover_path.is_some()
            && cover_path.as_deref().map(|path| path.to_string_lossy().into_owned())
                != snapshot.cover_path;
        if !write_description && !write_cover {
            if explicit {
                return Ok(EnrichmentOutcome::NoMatch {
                    source: SOURCE_OPEN_LIBRARY.to_owned(),
                    reason: "nothing_to_fill".to_owned(),
                });
            }
            // A forced refresh that revalidates to the same bytes is a
            // successful no-op; keep the cached success instead of replacing
            // it with a negative cache entry.
            if !force {
                self.record_no_match(book_id, snapshot)?;
            }
            return Ok(EnrichmentOutcome::NoMatch {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                reason: if force {
                    "nothing_changed".to_owned()
                } else {
                    "nothing_missing".to_owned()
                },
            });
        }

        let mut conn = self.service.connection()?;
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }
        let tx = conn.transaction()?;
        if write_description {
            tx.execute(
                "UPDATE books SET description = ?1 WHERE id = ?2",
                params![cleaned_description, book_id],
            )?;
            write_provenance(&tx, book_id, "description", &description_source, Some(&description_url))?;
            fields.push("description".to_owned());
        }
        if write_cover
            && let Some(path) = &cover_path
        {
            tx.execute(
                "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
                params![path.to_string_lossy(), source_to_cover(&cover_source), book_id],
            )?;
            write_provenance(&tx, book_id, "cover", &cover_source, Some(&cover_url))?;
            fields.push("cover".to_owned());
        }
        let label = attribution_label(&fields, &description_source, &cover_source);
        let url = if fields.first().map(String::as_str) == Some("description") {
            description_url.clone()
        } else {
            cover_url.clone()
        };
        store_enrichment(
            &tx,
            book_id,
            &CachedEnrichment {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                matched_key: candidate.edition_key.clone(),
                confidence: "high".to_owned(),
                status: "ok".to_owned(),
                applied_fields: fields.clone(),
                attribution_label: Some(label.clone()),
                attribution_url: Some(url.clone()),
                cover_keys: candidate.cover_keys.clone(),
                fetched_at: unix_now(),
            },
        )?;
        tx.commit()?;

        Ok(EnrichmentOutcome::Applied {
            source: SOURCE_OPEN_LIBRARY.to_owned(),
            fields,
            attribution: Some(attribution_for(&label, &url, vec![])),
        })
    }

    /// Apply a reviewed candidate explicitly, only to fields that are gaps.
    pub async fn accept_candidate(&self, book_id: i64, key: &str) -> Result<EnrichmentOutcome> {
        let generation = self.begin(book_id)?;
        let snapshot = {
            let conn = self.service.connection()?;
            snapshot(&conn, book_id)?
        };
        let provenance = {
            let conn = self.service.connection()?;
            (
                provenance_for(&conn, book_id, "description")?.0,
                provenance_for(&conn, book_id, "cover")?.0,
            )
        };
        let candidates = self
            .lookup_with_retry(self.lookup_request(&snapshot))
            .await
            .map_err(provider_to_error)?;
        let candidate = candidates
            .into_iter()
            .find(|candidate| candidate.key == key)
            .ok_or_else(|| Error::EnrichmentCandidateExpired)?;
        if !self.is_current(book_id, generation) {
            return Ok(EnrichmentOutcome::Cancelled);
        }
        self.apply_candidate(
            book_id,
            &snapshot,
            &provenance,
            candidate,
            true,
            true,
            generation,
        )
        .await
    }

    fn record_no_match(&self, book_id: i64, snapshot: &BookSnapshot) -> Result<()> {
        let conn = self.service.connection()?;
        store_enrichment(
            &conn,
            book_id,
            &CachedEnrichment {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                matched_key: None,
                confidence: "none".to_owned(),
                status: "no_match".to_owned(),
                applied_fields: Vec::new(),
                attribution_label: None,
                attribution_url: None,
                cover_keys: Vec::new(),
                fetched_at: unix_now(),
            },
        )?;
        let _ = snapshot;
        Ok(())
    }

    fn record_failure(&self, book_id: i64, _snapshot: &BookSnapshot, error: &ProviderError) -> Result<()> {
        // A permanent refusal is not cached as a no-match either; only a short
        // cooldown keeps a retry from storming the source.
        let conn = self.service.connection()?;
        store_enrichment(
            &conn,
            book_id,
            &CachedEnrichment {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                matched_key: None,
                confidence: "none".to_owned(),
                status: "error".to_owned(),
                applied_fields: Vec::new(),
                attribution_label: None,
                attribution_url: None,
                cover_keys: Vec::new(),
                fetched_at: unix_now(),
            },
        )?;
        let _ = error;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Blurb and revert
    // ------------------------------------------------------------------

    /// Save a reader-edited blurb. `None` or blank clears the blurb and the
    /// manual marker, without filling anything in the same action.
    pub fn edit_blurb(&self, book_id: i64, text: Option<&str>) -> Result<()> {
        let mut conn = self.service.connection()?;
        let tx = conn.transaction()?;
        let cleaned = text.and_then(clean_blurb);
        match cleaned {
            Some(value) => {
                tx.execute(
                    "UPDATE books SET description = ?1 WHERE id = ?2",
                    params![value, book_id],
                )?;
                write_provenance(&tx, book_id, "description", "manual", None)?;
            }
            None => {
                tx.execute("UPDATE books SET description = NULL WHERE id = ?1", [book_id])?;
                tx.execute(
                    "DELETE FROM field_provenance WHERE book_id = ?1 AND field = 'description'",
                    [book_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Revert online-derived blurb and cover. Manual edits and manual covers are
    /// untouched.
    pub fn revert(&self, book_id: i64) -> Result<()> {
        let mut conn = self.service.connection()?;
        let tx = conn.transaction()?;
        let description = provenance_for(&tx, book_id, "description")?;
        if description.0 != Provenance::Manual {
            let file_description: Option<String> = tx
                .query_row(
                    "SELECT file_description FROM books WHERE id = ?1",
                    [book_id],
                    |row| row.get(0),
                )
                .optional()?
                .flatten();
            tx.execute(
                "UPDATE books SET description = ?1 WHERE id = ?2",
                params![file_description, book_id],
            )?;
            tx.execute(
                "DELETE FROM field_provenance WHERE book_id = ?1 AND field = 'description'",
                [book_id],
            )?;
        }
        let cover = provenance_for(&tx, book_id, "cover")?;
        if cover.0 != Provenance::Manual {
            restore_file_cover(&tx, self.service.cover_dir(), book_id)?;
            tx.execute(
                "DELETE FROM field_provenance WHERE book_id = ?1 AND field = 'cover'",
                [book_id],
            )?;
        }
        tx.execute("DELETE FROM book_enrichment WHERE book_id = ?1", [book_id])?;
        tx.commit()?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Cover chooser
    // ------------------------------------------------------------------

    pub fn cover_choices(&self, book_id: i64) -> Result<CoverChoices> {
        let conn = self.service.connection()?;
        let snapshot = snapshot(&conn, book_id)?;
        let current = cover_option_for_path(
            &conn,
            book_id,
            snapshot.cover_path.as_deref(),
            snapshot.cover_source,
            true,
        );
        let original = original_option(
            &conn,
            book_id,
            &snapshot,
            self.service.cover_dir(),
        );
        let mut online = Vec::new();
        if let Some(cached) = cached_enrichment(&conn, book_id)?
            && cached.status == "ok"
            && !cached.cover_keys.is_empty()
        {
            for key in cached.cover_keys.into_iter().take(MAX_REVIEW_CANDIDATES) {
                online.push(CoverOption {
                    key: format!("online:{SOURCE_OPEN_LIBRARY}:{key}"),
                    source: SOURCE_OPEN_LIBRARY.to_owned(),
                    label: "Open Library cover".to_owned(),
                    detail: None,
                    preview_data_url: None,
                    is_current: false,
                    is_original: false,
                    candidate_key: None,
                    provider_cover_key: Some(key),
                    source_url: cached.attribution_url.clone(),
                    warning: None,
                });
            }
        }
        Ok(CoverChoices {
            current,
            original,
            online,
            source_label: SOURCE_LABEL.to_owned(),
        })
    }

    /// Explicit "Find covers". No request is made merely by opening the sheet.
    pub async fn lookup_cover_candidates(&self, book_id: i64) -> Result<CoverLookupOutcome> {
        let generation = self.begin(book_id)?;
        let snapshot = {
            let conn = self.service.connection()?;
            snapshot(&conn, book_id)?
        };
        let request = self.lookup_request(&snapshot);
        let candidates = match self.lookup_with_retry(request).await {
            Ok(candidates) => candidates,
            Err(error) => return Ok(match unavailable(&error) {
                EnrichmentOutcome::Unavailable {
                    source,
                    code,
                    message,
                    retry_after_seconds,
                } => CoverLookupOutcome::Unavailable {
                    source,
                    code,
                    message,
                    retry_after_seconds,
                },
                _ => unreachable!(),
            }),
        };
        if !self.is_current(book_id, generation) {
            return Ok(CoverLookupOutcome::Cancelled);
        }
        let mut options = Vec::new();
        let mut seen_keys = std::collections::HashSet::new();
        'candidates: for candidate in candidates.iter() {
            let mut keys: Vec<(String, bool)> = candidate
                .cover_keys
                .iter()
                .cloned()
                .map(|key| (key, false))
                .collect();
            if let Some(supplement) = &candidate.supplement
                && !supplement.access_restricted
            {
                keys.extend(supplement.cover_keys.iter().cloned().map(|key| (key, true)));
            }
            for (key, from_supplement) in keys {
                if options.len() >= MAX_REVIEW_CANDIDATES {
                    break 'candidates;
                }
                if !self.is_current(book_id, generation) {
                    return Ok(CoverLookupOutcome::Cancelled);
                }
                if !seen_keys.insert(key.clone()) {
                    continue;
                }
                let Ok(bytes) = self.provider.fetch_cover(key.clone()).await else {
                    continue;
                };
                let Ok((cover, width, height, warning)) = cover::prepare_manual(&bytes) else {
                    continue;
                };
                let source = if from_supplement {
                    SOURCE_INTERNET_ARCHIVE
                } else {
                    SOURCE_OPEN_LIBRARY
                };
                let url = if from_supplement {
                    candidate
                        .supplement
                        .as_ref()
                        .map(|supplement| supplement.source_url.clone())
                        .unwrap_or_else(|| candidate.source_url.clone())
                } else {
                    candidate.source_url.clone()
                };
                let detail = [
                    candidate.authors.join(" · ").trim().to_owned(),
                    candidate.year.map(|year| year.to_string()).unwrap_or_default(),
                    candidate.publisher.clone().unwrap_or_default(),
                ]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
                options.push(CoverOption {
                    key: format!("online:{source}:{key}"),
                    source: source.to_owned(),
                    label: if candidate.title.trim().is_empty() {
                        "Open Library cover".to_owned()
                    } else {
                        candidate.title.clone()
                    },
                    detail: (!detail.is_empty()).then_some(detail),
                    preview_data_url: Some(data_url(&cover)),
                    is_current: false,
                    is_original: false,
                    candidate_key: Some(candidate.key.clone()),
                    provider_cover_key: Some(key),
                    source_url: Some(url),
                    warning: warning.map(|warning| {
                        format!("{warning} ({width}×{height})")
                    }),
                });
            }
        }
        if !self.is_current(book_id, generation) {
            return Ok(CoverLookupOutcome::Cancelled);
        }
        if options.is_empty() {
            return Ok(CoverLookupOutcome::NoMatch {
                source: SOURCE_OPEN_LIBRARY.to_owned(),
                reason: "no_cover".to_owned(),
            });
        }
        Ok(CoverLookupOutcome::Found {
            candidates: options,
            attribution: attribution_for(
                SOURCE_LABEL,
                &candidates[0].source_url,
                Vec::new(),
            ),
        })
    }

    pub async fn apply_cover_choice(
        &self,
        book_id: i64,
        choice: &CoverOption,
        acknowledged: bool,
    ) -> Result<()> {
        if let Some(warning) = &choice.warning
            && !acknowledged
        {
            return Err(Error::CoverNeedsAcknowledgement {
                message: warning.clone(),
            });
        }
        let snapshot = {
            let conn = self.service.connection()?;
            snapshot(&conn, book_id)?
        };
        let new_path: Option<String>;
        let new_source: Option<CoverSource>;
        let mut provenance_source: Option<&str> = None;
        let mut source_url = choice.source_url.clone();
        match choice.source.as_str() {
            "embedded" | "rendered" | "generated" | "original" => {
                if choice.key == "generated" || snapshot.file_cover_path.is_none() {
                    new_path = Some(ensure_generated(&self.service.cover_dir(), &snapshot)?);
                    new_source = Some(CoverSource::Generated);
                } else {
                    new_path = snapshot.file_cover_path.clone();
                    new_source = snapshot.file_cover_source;
                }
            }
            "device" => {
                let token = choice
                    .key
                    .strip_prefix("device:")
                    .ok_or(Error::CoverTokenInvalid)?;
                let pending = {
                    let mut pending = self.device_pending.lock().map_err(|_| Error::LockPoisoned)?;
                    let value = pending.remove(token).ok_or(Error::CoverTokenInvalid)?;
                    if value.book_id != book_id {
                        return Err(Error::CoverTokenInvalid);
                    }
                    if value.warning.is_some() && !acknowledged {
                        return Err(Error::CoverNeedsAcknowledgement {
                            message: value.warning.unwrap_or_default(),
                        });
                    }
                    value
                };
                let Some(path) = cover::store(&self.service.cover_dir(), &pending.cover) else {
                    return Err(Error::CoverWriteFailed);
                };
                new_path = Some(path.to_string_lossy().into_owned());
                new_source = Some(CoverSource::Device);
                provenance_source = Some("manual");
                source_url = None;
            }
            _ => {
                let key = choice
                    .provider_cover_key
                    .clone()
                    .ok_or(Error::CoverTokenInvalid)?;
                let bytes = self
                    .provider
                    .fetch_cover(key)
                    .await
                    .map_err(provider_to_error)?;
                let (cover, _width, _height, warning) =
                    cover::prepare_manual(&bytes).map_err(cover_error)?;
                if warning.is_some() && !acknowledged {
                    return Err(Error::CoverNeedsAcknowledgement {
                        message: warning.unwrap_or_default(),
                    });
                }
                let Some(path) = cover::store(&self.service.cover_dir(), &cover) else {
                    return Err(Error::CoverWriteFailed);
                };
                new_path = Some(path.to_string_lossy().into_owned());
                new_source = Some(source_to_cover(&choice.source));
                provenance_source = Some("manual");
            }
        }
        let Some(path) = new_path else {
            return Err(Error::CoverWriteFailed);
        };
        let Some(source) = new_source else {
            return Err(Error::CoverWriteFailed);
        };
        let mut conn = self.service.connection()?;
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
            params![path, source, book_id],
        )?;
        match provenance_source {
            Some("manual") => write_provenance(
                &tx,
                book_id,
                "cover",
                "manual",
                source_url.as_deref(),
            )?,
            _ => {
                tx.execute(
                    "DELETE FROM field_provenance WHERE book_id = ?1 AND field = 'cover'",
                    [book_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn prepare_device_cover(&self, book_id: i64, bytes: &[u8]) -> Result<DeviceCoverPreview> {
        let (cover, width, height, warning) = cover::prepare_manual(bytes).map_err(cover_error)?;
        let mut counter = self
            .next_device_token
            .lock()
            .map_err(|_| Error::LockPoisoned)?;
        let token = format!("device-{book_id}-{}", *counter);
        *counter += 1;
        {
            let mut pending = self.device_pending.lock().map_err(|_| Error::LockPoisoned)?;
            pending.insert(
                token.clone(),
                PendingDevice {
                    book_id,
                    cover: cover.clone(),
                    warning: warning.clone(),
                },
            );
        }
        Ok(DeviceCoverPreview {
            token,
            preview_data_url: data_url(&cover),
            width,
            height,
            warning,
        })
    }

    pub fn reset_cover(&self, book_id: i64) -> Result<()> {
        let mut conn = self.service.connection()?;
        let tx = conn.transaction()?;
        restore_file_cover(&tx, self.service.cover_dir(), book_id)?;
        tx.execute(
            "DELETE FROM field_provenance WHERE book_id = ?1 AND field = 'cover'",
            [book_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn book_detail(&self, book_id: i64) -> Result<BookDetail> {
        self.service.get_book_detail(book_id, None)
    }
}

fn unavailable(error: &ProviderError) -> EnrichmentOutcome {
    let source = if error.kind == ProviderErrorKind::Status(429)
        || error.kind == ProviderErrorKind::RateLimited
    {
        SOURCE_OPEN_LIBRARY
    } else {
        SOURCE_OPEN_LIBRARY
    };
    EnrichmentOutcome::Unavailable {
        source: source.to_owned(),
        code: error.code().to_owned(),
        message: error.message().to_owned(),
        retry_after_seconds: error.retry_after_seconds,
    }
}

fn provider_to_error(error: ProviderError) -> Error {
    Error::EnrichmentUnavailable {
        code: error.code().to_owned(),
        message: error.message().to_owned(),
    }
}

fn cover_error(error: CoverRejection) -> Error {
    Error::CoverRejected {
        message: error.message().to_owned(),
    }
}

fn attribution_for(label: &str, url: &str, fields: Vec<String>) -> EnrichmentAttribution {
    EnrichmentAttribution {
        label: label.to_owned(),
        url: url.to_owned(),
        fields,
    }
}

fn attribution_label(fields: &[String], description_source: &str, cover_source: &str) -> String {
    let describe = |source: &str| match source {
        SOURCE_OPEN_LIBRARY => "Open Library",
        SOURCE_INTERNET_ARCHIVE => "Internet Archive",
        _ => "an online source",
    };
    let has_description = fields.iter().any(|field| field == "description");
    let has_cover = fields.iter().any(|field| field == "cover");
    match (has_description, has_cover) {
        (true, true) if description_source == cover_source => {
            format!("Cover and blurb from {}", describe(description_source))
        }
        (true, true) => format!(
            "Cover from {} · Blurb from {}",
            describe(cover_source),
            describe(description_source)
        ),
        (true, false) => format!("Blurb from {}", describe(description_source)),
        (false, true) => format!("Cover from {}", describe(cover_source)),
        (false, false) => String::new(),
    }
}

fn candidate_view(candidate: &ProviderCandidate, cover: Option<String>) -> EnrichmentCandidate {
    EnrichmentCandidate {
        key: candidate.key.clone(),
        source: candidate.source.clone(),
        title: candidate.title.clone(),
        authors: candidate.authors.clone(),
        year: candidate.year,
        publisher: candidate.publisher.clone(),
        has_cover: candidate.cover_keys.iter().any(|_| true)
            || candidate
                .supplement
                .as_ref()
                .is_some_and(|supplement| !supplement.cover_keys.is_empty()),
        cover_data_url: cover,
        source_url: candidate.source_url.clone(),
    }
}

fn confidence(snapshot: &BookSnapshot, candidate: &ProviderCandidate) -> Confidence {
    let file_authors = &snapshot.authors;
    let author_ok = author_matches(file_authors, &candidate.authors);
    let similarity = title_similarity(&snapshot.title, &candidate.title);
    let year_ok = match (
        snapshot.published_date.as_deref().and_then(first_year),
        candidate.year,
    ) {
        (Some(file_year), Some(candidate_year)) => (file_year - candidate_year).abs() <= 1,
        _ => true,
    };

    if let Some(isbn) = snapshot.identifier.as_deref().and_then(find_isbn) {
        if candidate.cover_keys.iter().any(|key| key == &format!("isbn:{isbn}")) {
            if similarity >= 0.9 && author_ok {
                return Confidence::High;
            }
            return Confidence::Medium;
        }
    }
    if similarity >= 0.98 && author_ok && year_ok {
        return Confidence::High;
    }
    if similarity >= 0.7 || (author_ok && similarity >= 0.4) {
        return Confidence::Medium;
    }
    Confidence::None
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

fn read_mode(conn: &Connection) -> Result<EnrichmentMode> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'enrichment_mode'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match value.as_deref() {
        Some("ask") => EnrichmentMode::Ask,
        Some("automatic") => EnrichmentMode::Automatic,
        _ => EnrichmentMode::Off,
    })
}

fn snapshot(conn: &Connection, book_id: i64) -> Result<BookSnapshot> {
    let row = conn
        .query_row(
            "SELECT id, content_hash, title, authors, identifier, description, published_date,
                    path, cover_path, cover_source, file_cover_path, file_cover_source,
                    file_description
             FROM books WHERE id = ?1",
            [book_id],
            |row| {
                let authors: String = row.get(3)?;
                Ok(BookSnapshot {
                    id: row.get(0)?,
                    content_hash: row.get(1)?,
                    title: row.get(2)?,
                    authors: serde_json::from_str(&authors).unwrap_or_default(),
                    identifier: row.get(4)?,
                    description: row.get(5)?,
                    published_date: row.get(6)?,
                    path: row.get(7)?,
                    cover_path: row.get(8)?,
                    cover_source: row.get(9)?,
                    file_cover_path: row.get(10)?,
                    file_cover_source: row.get(11)?,
                    file_description: row.get(12)?,
                })
            },
        )
        .optional()?
        .ok_or(Error::BookNotFound { id: book_id })?;
    Ok(row)
}

fn provenance_for(conn: &Connection, book_id: i64, field: &str) -> Result<(Provenance, Option<String>)> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT source, source_url FROM field_provenance WHERE book_id = ?1 AND field = ?2",
            params![book_id, field],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        Some((source, url)) if source == "manual" => (Provenance::Manual, url),
        Some((_, url)) => (Provenance::Online, url),
        None => (Provenance::File, None),
    })
}

fn provenance_source(conn: &Connection, book_id: i64, field: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT source FROM field_provenance WHERE book_id = ?1 AND field = ?2",
        params![book_id, field],
        |row| row.get(0),
    )
    .optional()
    .map_err(Error::from)
}

fn cached_enrichment(conn: &Connection, book_id: i64) -> Result<Option<CachedEnrichment>> {
    conn.query_row(
        "SELECT source, matched_key, confidence, status, applied_fields,
                attribution_label, attribution_url, cover_keys, fetched_at
         FROM book_enrichment WHERE book_id = ?1
         ORDER BY fetched_at DESC LIMIT 1",
        [book_id],
        |row| {
            let applied: String = row.get(4)?;
            let cover_keys: String = row.get(7)?;
            Ok(CachedEnrichment {
                source: row.get(0)?,
                matched_key: row.get(1)?,
                confidence: row.get(2)?,
                status: row.get(3)?,
                applied_fields: serde_json::from_str(&applied).unwrap_or_default(),
                attribution_label: row.get(5)?,
                attribution_url: row.get(6)?,
                cover_keys: serde_json::from_str(&cover_keys).unwrap_or_default(),
                fetched_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(Error::from)
}

fn store_enrichment(conn: &Connection, book_id: i64, cached: &CachedEnrichment) -> Result<()> {
    conn.execute(
        "INSERT INTO book_enrichment
             (book_id, source, matched_key, confidence, status, applied_fields,
              attribution_label, attribution_url, cover_keys, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(book_id, source) DO UPDATE SET
             matched_key = excluded.matched_key,
             confidence = excluded.confidence,
             status = excluded.status,
             applied_fields = excluded.applied_fields,
             attribution_label = excluded.attribution_label,
             attribution_url = excluded.attribution_url,
             cover_keys = excluded.cover_keys,
             fetched_at = excluded.fetched_at",
        params![
            book_id,
            cached.source,
            cached.matched_key,
            cached.confidence,
            cached.status,
            serde_json::to_string(&cached.applied_fields).unwrap_or_else(|_| "[]".to_owned()),
            cached.attribution_label,
            cached.attribution_url,
            serde_json::to_string(&cached.cover_keys).unwrap_or_else(|_| "[]".to_owned()),
            cached.fetched_at,
        ],
    )?;
    Ok(())
}

fn cached_outcome(
    cached: &CachedEnrichment,
    snapshot: &BookSnapshot,
    provenance: &(Provenance, Provenance),
) -> Option<EnrichmentOutcome> {
    let age = unix_now() - cached.fetched_at;
    match cached.status.as_str() {
        "ok" if age < SUCCESS_TTL_SECONDS => {
            let mut fields = Vec::new();
            if provenance.0 == Provenance::Online && snapshot.description.is_some() {
                fields.push("description".to_owned());
            }
            if provenance.1 == Provenance::Online {
                fields.push("cover".to_owned());
            }
            if fields.is_empty() {
                return Some(EnrichmentOutcome::NoMatch {
                    source: SOURCE_OPEN_LIBRARY.to_owned(),
                    reason: "nothing_missing".to_owned(),
                });
            }
            Some(EnrichmentOutcome::Applied {
                source: cached.source.clone(),
                fields,
                attribution: Some(attribution_for(
                    cached.attribution_label.as_deref().unwrap_or(SOURCE_LABEL),
                    cached.attribution_url.as_deref().unwrap_or(SOURCE_URL),
                    Vec::new(),
                )),
            })
        }
        "no_match" if age < NO_MATCH_TTL_SECONDS => Some(EnrichmentOutcome::NoMatch {
            source: SOURCE_OPEN_LIBRARY.to_owned(),
            reason: "cached".to_owned(),
        }),
        "error" if age < ERROR_COOLDOWN_SECONDS => Some(EnrichmentOutcome::Unavailable {
            source: SOURCE_OPEN_LIBRARY.to_owned(),
            code: "cooldown".to_owned(),
            message: "Open Library could not be reached a moment ago. Try again shortly."
                .to_owned(),
            retry_after_seconds: Some((ERROR_COOLDOWN_SECONDS - age) as u64),
        }),
        _ => None,
    }
}

fn write_provenance(
    conn: &Connection,
    book_id: i64,
    field: &str,
    source: &str,
    source_url: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO field_provenance (book_id, field, source, source_url)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id, field) DO UPDATE SET
             source = excluded.source, source_url = excluded.source_url",
        params![book_id, field, source, source_url],
    )?;
    Ok(())
}

fn enrichment_state(conn: &Connection, book_id: i64) -> Result<BookEnrichmentState> {
    let snapshot = snapshot(conn, book_id)?;
    let description = provenance_for(conn, book_id, "description")?;
    let cover = provenance_for(conn, book_id, "cover")?;
    let description_source_name = provenance_source(conn, book_id, "description")?;
    let cover_source_name = provenance_source(conn, book_id, "cover")?;
    let has_file_cover = snapshot
        .file_cover_source
        .is_some_and(CoverSource::is_file_derived);
    let has_gap = description.0 == Provenance::File
        && snapshot
            .description
            .as_deref()
            .map_or(true, |value| value.trim().is_empty())
        || (cover.0 != Provenance::Manual
            && snapshot.cover_source != Some(CoverSource::Embedded)
            && snapshot.cover_source != Some(CoverSource::Rendered));
    let description_source = match description.0 {
        Provenance::Manual => Some("manual".to_owned()),
        Provenance::Online => Some(
            description_source_name
                .clone()
                .unwrap_or_else(|| SOURCE_OPEN_LIBRARY.to_owned()),
        ),
        Provenance::File => None,
    };
    let cover_url = match cover.0 {
        Provenance::Manual | Provenance::Online => cover.1.clone(),
        Provenance::File => None,
    };
    let mut fields = Vec::new();
    if description.0 == Provenance::Online {
        fields.push("description".to_owned());
    }
    if cover.0 == Provenance::Online {
        fields.push("cover".to_owned());
    }
    let attribution = if fields.is_empty() {
        None
    } else {
        let description_label = description_source_name.as_deref().unwrap_or(SOURCE_OPEN_LIBRARY);
        let cover_label = cover_source_name.as_deref().unwrap_or(SOURCE_OPEN_LIBRARY);
        let label = attribution_label(&fields, description_label, cover_label);
        Some(attribution_for(
            &label,
            cover_url
                .as_deref()
                .or(description.1.as_deref())
                .unwrap_or(SOURCE_URL),
            fields,
        ))
    };
    Ok(BookEnrichmentState {
        has_file_cover,
        file_cover_source: snapshot.file_cover_source,
        cover_source: snapshot.cover_source,
        cover_manual: cover.0 == Provenance::Manual,
        description_source,
        description_url: description.1,
        cover_url,
        has_gap,
        attribution,
    })
}

/// Safe state for a book detail response. Called by the catalog service so the
/// Flip can decide whether a gap exists without another command.
pub(crate) fn state_for(conn: &Connection, book_id: i64) -> Result<BookEnrichmentState> {
    enrichment_state(conn, book_id)
}

fn source_to_cover(source: &str) -> CoverSource {
    match source {
        SOURCE_INTERNET_ARCHIVE => CoverSource::InternetArchive,
        SOURCE_OPEN_LIBRARY => CoverSource::OpenLibrary,
        "device" => CoverSource::Device,
        "embedded" => CoverSource::Embedded,
        "rendered" => CoverSource::Rendered,
        _ => CoverSource::Generated,
    }
}

fn cover_option_for_path(
    _conn: &Connection,
    _book_id: i64,
    path: Option<&str>,
    source: Option<CoverSource>,
    is_current: bool,
) -> Option<CoverOption> {
    let path = path?;
    let bytes = std::fs::read(path).ok()?;
    let preview = data_url(&bytes);
    Some(CoverOption {
        key: "current".to_owned(),
        source: source.map(source_name).unwrap_or("generated").to_owned(),
        label: "Current cover".to_owned(),
        detail: Some(source.map(source_description).unwrap_or("Current cover").to_owned()),
        preview_data_url: Some(preview),
        is_current,
        is_original: false,
        candidate_key: None,
        provider_cover_key: None,
        source_url: None,
        warning: None,
    })
}

fn original_option(
    conn: &Connection,
    book_id: i64,
    snapshot: &BookSnapshot,
    cache_dir: &std::path::Path,
) -> CoverOption {
    let _ = (conn, book_id);
    if let Some(path) = snapshot.file_cover_path.as_deref()
        && let Ok(bytes) = std::fs::read(path)
    {
        let source = snapshot.file_cover_source.unwrap_or(CoverSource::Generated);
        let is_generated = source == CoverSource::Generated;
        return CoverOption {
            key: if is_generated { "generated".to_owned() } else { "original".to_owned() },
            source: source_name(source).to_owned(),
            label: if is_generated {
                "Generated jacket plate".to_owned()
            } else {
                "Cover from this book".to_owned()
            },
            detail: Some(source_description(source).to_owned()),
            preview_data_url: Some(data_url(&bytes)),
            is_current: false,
            is_original: true,
            candidate_key: None,
            provider_cover_key: None,
            source_url: None,
            warning: None,
        };
    }
    // A generated plate is always available as the honest fallback.
    let bytes = cover::generated(&snapshot.content_hash);
    let _ = cover::store(cache_dir, &bytes);
    CoverOption {
        key: "generated".to_owned(),
        source: "generated".to_owned(),
        label: "Generated jacket plate".to_owned(),
        detail: Some("The plain jacket used when no cover exists.".to_owned()),
        preview_data_url: Some(data_url(&bytes)),
        is_current: false,
        is_original: true,
        candidate_key: None,
        provider_cover_key: None,
        source_url: None,
        warning: None,
    }
}

fn ensure_generated(cache_dir: &std::path::Path, snapshot: &BookSnapshot) -> Result<String> {
    if snapshot.file_cover_source == Some(CoverSource::Generated)
        && let Some(path) = snapshot.file_cover_path.clone()
        && std::path::Path::new(&path).is_file()
    {
        return Ok(path);
    }
    let bytes = cover::generated(&snapshot.content_hash);
    let path = cover::store(cache_dir, &bytes).ok_or(Error::CoverWriteFailed)?;
    Ok(path.to_string_lossy().into_owned())
}

fn restore_file_cover(conn: &Connection, cache_dir: &std::path::Path, book_id: i64) -> Result<()> {
    let (content_hash, file_path, file_source): (String, Option<String>, Option<CoverSource>) = conn
        .query_row(
            "SELECT content_hash, file_cover_path, file_cover_source FROM books WHERE id = ?1",
            [book_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
        .ok_or(Error::BookNotFound { id: book_id })?;
    let (path, source) = match (file_path, file_source) {
        (Some(path), Some(source)) if std::path::Path::new(&path).is_file() => (path, source),
        _ => {
            let bytes = cover::generated(&content_hash);
            let path = cover::store(cache_dir, &bytes).ok_or(Error::CoverWriteFailed)?;
            (path.to_string_lossy().into_owned(), CoverSource::Generated)
        }
    };
    conn.execute(
        "UPDATE books SET cover_path = ?1, cover_source = ?2 WHERE id = ?3",
        params![path, source, book_id],
    )?;
    Ok(())
}

fn source_name(source: CoverSource) -> &'static str {
    match source {
        CoverSource::Embedded => "embedded",
        CoverSource::Rendered => "rendered",
        CoverSource::Generated => "generated",
        CoverSource::OpenLibrary => "open_library",
        CoverSource::InternetArchive => "internet_archive",
        CoverSource::Device => "device",
    }
}

fn source_description(source: CoverSource) -> &'static str {
    match source {
        CoverSource::Embedded => "The cover embedded in this book.",
        CoverSource::Rendered => "The cover rendered from this PDF.",
        CoverSource::Generated => "The plain jacket used when no cover exists.",
        CoverSource::OpenLibrary => "A cover chosen from Open Library.",
        CoverSource::InternetArchive => "A cover chosen from a linked Internet Archive scan.",
        CoverSource::Device => "A cover chosen from this device.",
    }
}

fn data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

// Keep serde available for future cache rows without a second import site.
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
struct Unused;

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot_with(title: &str, authors: &[&str], identifier: Option<&str>) -> BookSnapshot {
        BookSnapshot {
            id: 1,
            content_hash: "hash".to_owned(),
            title: title.to_owned(),
            authors: authors.iter().map(|value| (*value).to_owned()).collect(),
            identifier: identifier.map(str::to_owned),
            description: None,
            published_date: None,
            path: String::new(),
            cover_path: None,
            cover_source: None,
            file_cover_path: None,
            file_cover_source: None,
            file_description: None,
        }
    }

    #[test]
    fn isbn10_and_isbn13_normalise_to_the_same_key() {
        assert_eq!(
            normalise_isbn("0-306-40615-2").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(
            normalise_isbn("978-0-306-40615-7").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(normalise_isbn("9780306406158"), None);
    }

    #[test]
    fn finds_isbn_inside_a_noisy_identifier() {
        assert_eq!(
            find_isbn("urn:isbn:9780306406157").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(find_isbn("no identifier here"), None);
    }

    #[test]
    fn titles_ignore_articles_punctuation_subtitles_and_case() {
        assert_eq!(normalise_title("The Whisper Man"), "whisper man");
        assert_eq!(normalise_title("Whisper Man, The"), "whisper man");
        assert_eq!(normalise_title("Whisper Man: A Novel"), "whisper man");
        assert_eq!(normalise_title("Whisper Man — A Novel"), "whisper man");
        assert_eq!(normalise_title("ÉTÉ"), "ete");
    }

    #[test]
    fn surname_matching_is_forgiving_but_not_blind() {
        assert!(author_matches(
            &["Ursula K. Le Guin".to_owned()],
            &["Ursula Le Guin".to_owned()]
        ));
        assert!(!author_matches(
            &["Ursula K. Le Guin".to_owned()],
            &["Stephen King".to_owned()]
        ));
    }

    #[test]
    fn blurbs_are_plain_text_and_bounded() {
        let cleaned = clean_blurb("<p>A quiet &amp; <b>revolution</b>.</p><p>Second.</p>")
            .expect("blurb");
        assert_eq!(cleaned, "A quiet & revolution.\n\nSecond.");
        assert!(clean_blurb("   ").is_none());
        assert!(clean_blurb("https://example.com/book").is_none());
        let long = "word ".repeat(2000);
        assert!(clean_blurb(&long).expect("long").chars().count() <= 4000);
    }

    #[test]
    fn confidence_prefers_exact_titles_and_matching_authors() {
        let snapshot = snapshot_with("The Dispossessed", &["Ursula K. Le Guin"], None);
        let exact = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Ursula K. Le Guin".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &exact), Confidence::High);
        let wrong_author = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Stephen King".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &wrong_author), Confidence::Medium);
    }

    #[test]
    fn isbn_edition_candidates_are_high_when_title_and_author_agree() {
        let snapshot = snapshot_with("The Dispossessed", &["Ursula K. Le Guin"], Some("9780306406157"));
        let exact = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Ursula K. Le Guin".to_owned()],
            cover_keys: vec!["isbn:9780306406157".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &exact), Confidence::High);
    }
}
