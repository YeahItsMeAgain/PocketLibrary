//! Cover keys, fetching, validation handoff and the manual cover chooser.

use std::collections::HashSet;

use base64::Engine as _;
use rusqlite::params;

use super::cache::{cached_enrichment, write_provenance};
use super::provider::ProviderCandidate;
use super::{
    BookSnapshot, EnrichmentOutcome, EnrichmentService, MAX_REVIEW_CANDIDATES,
    SOURCE_INTERNET_ARCHIVE, SOURCE_LABEL, SOURCE_OPEN_LIBRARY, attribution_for,
    provider_to_error, snapshot, unavailable,
};
use crate::cover::{self, CoverRejection};
use crate::error::{Error, Result};
use crate::models::{
    CoverChoices, CoverLookupOutcome, CoverOption, CoverSource, DeviceCoverPreview,
};

#[derive(Debug, Clone)]
pub(super) struct PendingDevice {
    book_id: i64,
    cover: Vec<u8>,
    warning: Option<String>,
}

// ---------------------------------------------------------------------------
// Shared cover candidate fetch
// ---------------------------------------------------------------------------

/// One cover key to try, paired with whether it came from an Internet Archive
/// supplement. Order is the order the caller must try them in: edition/work
/// keys first (work `id:` covers sit at the front of `cover_keys`), then
/// supplement keys.
fn cover_candidate_keys(candidate: &ProviderCandidate) -> Vec<(String, bool)> {
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
    keys
}

#[derive(Debug, Clone, Copy)]
enum CoverCheck {
    /// Automatic enrichment: a cover must pass the strict online gate.
    Automatic,
    /// Manual chooser: low-resolution and off-ratio covers are accepted with a
    /// warning the reader must acknowledge.
    Manual,
}

struct FetchedCover {
    key: String,
    from_supplement: bool,
    cover: Vec<u8>,
    width: u32,
    height: u32,
    warning: Option<String>,
}

enum CoverFetchError {
    /// The provider had nothing for this key; skip quietly.
    Unavailable,
    /// Bytes arrived but were not a usable cover.
    Rejected,
}

impl EnrichmentService {
    /// Fetch one key and run it through the validation gate for `check`.
    async fn fetch_cover(
        &self,
        key: String,
        from_supplement: bool,
        check: CoverCheck,
    ) -> std::result::Result<FetchedCover, CoverFetchError> {
        let bytes = self
            .provider
            .fetch_cover(key.clone())
            .await
            .map_err(|_| CoverFetchError::Unavailable)?;
        match check {
            CoverCheck::Automatic => {
                let cover =
                    cover::validate_online(&bytes, None).map_err(|_| CoverFetchError::Rejected)?;
                Ok(FetchedCover {
                    key,
                    from_supplement,
                    cover,
                    width: 0,
                    height: 0,
                    warning: None,
                })
            }
            CoverCheck::Manual => {
                let (cover, width, height, warning) =
                    cover::prepare_manual(&bytes).map_err(|_| CoverFetchError::Rejected)?;
                Ok(FetchedCover {
                    key,
                    from_supplement,
                    cover,
                    width,
                    height,
                    warning,
                })
            }
        }
    }

    /// Walk the candidate's keys in order and return the first usable cover.
    /// This and [`Self::lookup_cover_candidates`] share both the key order
    /// ([`cover_candidate_keys`]) and the fetch/validate path, so the automatic
    /// path and the chooser can never disagree about which cover is first.
    pub(super) async fn first_usable_cover(
        &self,
        candidate: &ProviderCandidate,
        strict: bool,
    ) -> Option<(Vec<u8>, String, bool)> {
        let check = if strict {
            CoverCheck::Automatic
        } else {
            CoverCheck::Manual
        };
        for (key, from_supplement) in cover_candidate_keys(candidate) {
            match self.fetch_cover(key, from_supplement, check).await {
                Ok(fetched) => {
                    return Some((fetched.cover, fetched.key, fetched.from_supplement));
                }
                Err(CoverFetchError::Rejected) => {
                    crate::diagnostics::log_event(
                        crate::diagnostics::Level::Warn,
                        "enrichment_cover",
                        "rejected an online cover candidate",
                    );
                }
                Err(CoverFetchError::Unavailable) => {}
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Cover chooser
// ---------------------------------------------------------------------------

impl EnrichmentService {
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
        let mut seen_keys = HashSet::new();
        'candidates: for candidate in candidates.iter() {
            for (key, from_supplement) in cover_candidate_keys(candidate) {
                if options.len() >= MAX_REVIEW_CANDIDATES {
                    break 'candidates;
                }
                if !self.is_current(book_id, generation) {
                    return Ok(CoverLookupOutcome::Cancelled);
                }
                if !seen_keys.insert(key.clone()) {
                    continue;
                }
                let Ok(fetched) = self.fetch_cover(key, from_supplement, CoverCheck::Manual).await
                else {
                    continue;
                };
                let source = if fetched.from_supplement {
                    SOURCE_INTERNET_ARCHIVE
                } else {
                    SOURCE_OPEN_LIBRARY
                };
                let url = if fetched.from_supplement {
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
                let width = fetched.width;
                let height = fetched.height;
                options.push(CoverOption {
                    key: format!("online:{source}:{}", fetched.key),
                    source: source.to_owned(),
                    label: if candidate.title.trim().is_empty() {
                        "Open Library cover".to_owned()
                    } else {
                        candidate.title.clone()
                    },
                    detail: (!detail.is_empty()).then_some(detail),
                    preview_data_url: Some(data_url(&fetched.cover)),
                    is_current: false,
                    is_original: false,
                    candidate_key: Some(candidate.key.clone()),
                    provider_cover_key: Some(fetched.key),
                    source_url: Some(url),
                    warning: fetched
                        .warning
                        .map(|warning| format!("{warning} ({width}×{height})")),
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
}

fn cover_error(error: CoverRejection) -> Error {
    Error::CoverRejected {
        message: error.message().to_owned(),
    }
}

// ---------------------------------------------------------------------------
// Cover option helpers
// ---------------------------------------------------------------------------

fn cover_option_for_path(
    _conn: &rusqlite::Connection,
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
    conn: &rusqlite::Connection,
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

fn ensure_generated(
    cache_dir: &std::path::Path,
    snapshot: &BookSnapshot,
) -> Result<String> {
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

pub(super) fn restore_file_cover(
    conn: &rusqlite::Connection,
    cache_dir: &std::path::Path,
    book_id: i64,
) -> Result<()> {
    use rusqlite::OptionalExtension;

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

pub(super) fn source_to_cover(source: &str) -> CoverSource {
    match source {
        SOURCE_INTERNET_ARCHIVE => CoverSource::InternetArchive,
        SOURCE_OPEN_LIBRARY => CoverSource::OpenLibrary,
        "device" => CoverSource::Device,
        "embedded" => CoverSource::Embedded,
        "rendered" => CoverSource::Rendered,
        _ => CoverSource::Generated,
    }
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

pub(super) fn data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
