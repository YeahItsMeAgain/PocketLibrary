//! Online metadata enrichment: matching, confidence, covers, provenance and
//! the manual cover chooser's network surface.
//!
//! The module deliberately keeps network work behind [`MetadataProvider`]. The
//! catalog remains the only writer of the database; tests inject a fake
//! provider and never touch the public internet.

mod cache;
mod cover;
mod matching;
mod provider;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::models::{
    BookDetail, BookEnrichmentState, BookFormat, CoverSource, EnrichmentAttribution,
    EnrichmentCandidate, EnrichmentOutcome,
};
use crate::service::Service;

pub use matching::{find_isbn, normalise_isbn, normalise_title};
pub use provider::{
    LookupRequest, MetadataProvider, OpenLibraryProvider, ProviderCandidate, ProviderError,
    ProviderErrorKind, ProviderResult, ProviderSupplement,
};

use cache::{
    cached_enrichment, cached_outcome, enrichment_state, provenance_for, store_enrichment,
    unix_now, write_provenance,
};
use cover::{PendingDevice, data_url, restore_file_cover, source_to_cover};
pub(crate) use cache::state_for;
use matching::{Confidence, clean_blurb, confidence, publication_year};

pub const SOURCE_OPEN_LIBRARY: &str = "open_library";
pub const SOURCE_INTERNET_ARCHIVE: &str = "internet_archive";
pub const SOURCE_LABEL: &str = "Open Library";
pub const SOURCE_URL: &str = "https://openlibrary.org";
pub const BATCH_LIMIT: usize = 20;
const MAX_REVIEW_CANDIDATES: usize = 4;

type Shared<T> = Arc<T>;

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
    format: BookFormat,
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
            year: publication_year(snapshot),
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
            .and_then(|bytes| crate::cover::store(&self.service.cover_dir(), bytes));
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

    pub fn book_detail(&self, book_id: i64) -> Result<BookDetail> {
        self.service.get_book_detail(book_id, None)
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

fn snapshot(conn: &Connection, book_id: i64) -> Result<BookSnapshot> {
    let row = conn
        .query_row(
            "SELECT id, content_hash, title, authors, identifier, description, published_date,
                    path, cover_path, cover_source, file_cover_path, file_cover_source,
                    file_description, format
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
                    format: row.get(13)?,
                })
            },
        )
        .optional()?
        .ok_or(Error::BookNotFound { id: book_id })?;
    Ok(row)
}
