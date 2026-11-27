//! Settings, the TTL/negative cache and the database rows behind enrichment.

use rusqlite::{Connection, OptionalExtension, params};

use super::{
    BATCH_LIMIT, BookSnapshot, CachedEnrichment, EnrichmentService, Provenance, SOURCE_LABEL,
    SOURCE_OPEN_LIBRARY, SOURCE_URL, attribution_for, attribution_label,
};
use crate::error::{Error, Result};
use crate::models::{
    BookEnrichmentState, CoverSource, EnrichmentMode, EnrichmentOutcome, EnrichmentSettings,
};

const SUCCESS_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
const NO_MATCH_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const ERROR_COOLDOWN_SECONDS: i64 = 15 * 60;

impl EnrichmentService {
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

    pub(super) fn record_no_match(&self, book_id: i64, snapshot: &BookSnapshot) -> Result<()> {
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

    pub(super) fn record_failure(
        &self,
        book_id: i64,
        _snapshot: &BookSnapshot,
        error: &super::provider::ProviderError,
    ) -> Result<()> {
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
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

pub(super) fn read_mode(conn: &Connection) -> Result<EnrichmentMode> {
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

pub(super) fn provenance_for(
    conn: &Connection,
    book_id: i64,
    field: &str,
) -> Result<(Provenance, Option<String>)> {
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

pub(super) fn cached_enrichment(
    conn: &Connection,
    book_id: i64,
) -> Result<Option<CachedEnrichment>> {
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

pub(super) fn store_enrichment(
    conn: &Connection,
    book_id: i64,
    cached: &CachedEnrichment,
) -> Result<()> {
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

pub(super) fn cached_outcome(
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

pub(super) fn write_provenance(
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

pub(super) fn enrichment_state(conn: &Connection, book_id: i64) -> Result<BookEnrichmentState> {
    let snapshot = super::snapshot(conn, book_id)?;
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
            .is_none_or(|value| value.trim().is_empty())
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
        let description_label = description_source_name
            .as_deref()
            .unwrap_or(SOURCE_OPEN_LIBRARY);
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

pub(super) fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
