//! The provider seam and the production Open Library/Internet Archive client.

use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;

use super::{SOURCE_OPEN_LIBRARY, SOURCE_URL};
use crate::cover;
use crate::error::{Error, Result};

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

        // The edition often has no description or cover of its own; one work
        // request fills either gap. An edition without `covers` still carries
        // synthetic `isbn:`/`olid:` keys, so testing `cover_keys.is_empty()`
        // would miss the work cover even when both fallbacks 404 (as they do
        // for the UK Rock Paper Scissors edition).
        let has_cover_id = |keys: &[String]| keys.iter().any(|key| key.starts_with("id:"));
        if (candidate.description.is_none() || !has_cover_id(&candidate.cover_keys))
            && let Some(work) = edition
                .get("works")
                .and_then(|value| value.as_array())
                .and_then(|values| values.first())
                .and_then(|value| value.get("key"))
                .and_then(|value| value.as_str())
        {
            Self::gate(&self.metadata_gate, Duration::from_millis(360)).await;
            if let Ok(value) = self.get_json(format!("{}{}", self.base, work)).await {
                if candidate.description.is_none() {
                    candidate.description = edition_description(&value);
                }
                if !has_cover_id(&candidate.cover_keys) {
                    let work_covers: Vec<String> = edition_cover_keys(&value, None)
                        .into_iter()
                        .filter(|key| key.starts_with("id:"))
                        .collect();
                    for key in work_covers.into_iter().rev() {
                        if !candidate.cover_keys.contains(&key) {
                            candidate.cover_keys.insert(0, key);
                        }
                    }
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
        let mut candidate = ProviderCandidate::open_library(key.clone(), title);
        candidate.authors = result
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

pub(super) fn first_year(value: &str) -> Option<i64> {
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
                // Cover keys are `id:123`, `isbn:...` or `olid:...`, while the
                // covers API wants them as separate path segments:
                // `/b/id/123-L.jpg`. A colon in the path now returns 404.
                let path = key.replacen(':', "/", 1);
                format!("{}/b/{path}-L.jpg?default=false", self.covers_base)
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
