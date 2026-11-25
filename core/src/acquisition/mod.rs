//! Libgen acquisition: search over the live LG+ mirrors.
//!
//! The provider is deliberately separate from the catalog: it never writes to
//! SQLite, and the UI reaches it through the same command API as everything
//! else. The download queue lives in `crate::download`; this module only
//! resolves search results.

mod mirror;
mod parse;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use wreq::header::ETAG;
use wreq_util::Emulation;

use crate::error::{Error, Result};
pub use mirror::MirrorHealth;
use mirror::{
    BOOTSTRAP_MIRRORS, HealthRegistry, Mirror, SLUM_STATUS_URL, SlumState, order_mirrors,
};
pub use parse::{LibgenResult, MirrorLink, SearchQuery};
use parse::{ParseOutcome, parse_search_page, search_url};

/// Libgen always serves 25 rows per page; `res` is ignored.
pub const PAGE_SIZE: u32 = 25;

/// One page of search results after client-side filtering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub results: Vec<LibgenResult>,
    pub page: u32,
    pub per_page: u32,
    /// The mirror's own count for the whole query, before client filters.
    pub total: u64,
    /// False when the badge was missing and `total` is only a lower bound.
    pub total_is_exact: bool,
    /// Rows the mirror returned on this page before filters.
    pub on_page_before_filters: usize,
    /// True when language/format/year removed at least one row.
    pub filters_applied: bool,
    /// Host that answered, e.g. `libgen.li`.
    pub source_mirror: String,
    /// Per-device health for the five compiled mirrors (for diagnostics).
    pub health: Vec<MirrorHealth>,
}

/// A Libgen search client with mirror failover and a local health registry.
pub struct LibgenProvider {
    client: wreq::Client,
    mirrors: Vec<Mirror>,
    registry: Mutex<HealthRegistry>,
    slum: Arc<Mutex<SlumState>>,
    slum_url: String,
    use_slum: bool,
}

impl LibgenProvider {
    /// Production provider: five compiled mirrors, Chrome TLS/browser
    /// impersonation, SLUM as a background hint.
    pub fn new() -> Result<Self> {
        Self::build(
            BOOTSTRAP_MIRRORS
                .iter()
                .map(|base| Mirror::new(*base))
                .collect(),
            true,
        )
    }

    /// Test/development provider with explicit mirror bases and no SLUM.
    pub fn with_mirrors(bases: Vec<String>) -> Result<Self> {
        if bases.is_empty() {
            return Err(Error::AllMirrorsFailed { attempts: 0 });
        }
        Self::build(bases.into_iter().map(Mirror::new).collect(), false)
    }

    fn build(mirrors: Vec<Mirror>, use_slum: bool) -> Result<Self> {
        let client = wreq::Client::builder()
            .emulation(Emulation::Chrome136)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(wreq::redirect::Policy::limited(5))
            .build()
            .map_err(|error| {
                eprintln!("pocketlibrary error (acquisition_client): {error}");
                Error::Offline
            })?;
        Ok(Self {
            client,
            mirrors,
            registry: Mutex::new(HealthRegistry::new()),
            slum: Arc::new(Mutex::new(SlumState::default())),
            slum_url: SLUM_STATUS_URL.to_owned(),
            use_slum,
        })
    }

    /// Point the SLUM hint at another URL. Used by tests; production never
    /// needs this.
    pub fn with_slum_url(mut self, url: impl Into<String>) -> Self {
        self.slum_url = url.into();
        self.use_slum = true;
        self
    }

    /// Search one page across the mirrors in health order.
    pub async fn search(&self, query: &SearchQuery) -> Result<SearchPage> {
        query.validate()?;
        self.maybe_refresh_slum();

        let ordered = {
            let registry = self.registry.lock().map_err(|_| Error::LockPoisoned)?;
            let slum = self.slum.lock().map_err(|_| Error::LockPoisoned)?;
            order_mirrors(&self.mirrors, &registry, &slum)
        };

        let mut attempts = 0usize;
        let mut offline_attempts = 0usize;
        let mut last_format_error: Option<String> = None;

        for mirror in ordered {
            attempts += 1;
            match self.fetch_page(&mirror, query).await {
                Ok(html) => match parse_search_page(&html, &mirror.base) {
                    ParseOutcome::Page(parsed) => {
                        self.record_success(&mirror)?;
                        let on_page_before_filters = parsed.results.len();
                        let results: Vec<_> = parsed
                            .results
                            .into_iter()
                            .filter(|result| query.matches_filters(result))
                            .collect();
                        let filters_applied =
                            query.has_client_filters() && results.len() != on_page_before_filters;
                        return Ok(SearchPage {
                            results,
                            page: query.page,
                            per_page: PAGE_SIZE,
                            total: parsed.total,
                            total_is_exact: parsed.total_is_exact,
                            on_page_before_filters,
                            filters_applied,
                            source_mirror: mirror.host.clone(),
                            health: self.health_snapshot()?,
                        });
                    }
                    ParseOutcome::Empty => {
                        // A valid zero-result page is a success, not a broken
                        // mirror. Do not cycle the other four hosts.
                        self.record_success(&mirror)?;
                        return Ok(SearchPage {
                            results: Vec::new(),
                            page: query.page,
                            per_page: PAGE_SIZE,
                            total: 0,
                            total_is_exact: true,
                            on_page_before_filters: 0,
                            filters_applied: false,
                            source_mirror: mirror.host.clone(),
                            health: self.health_snapshot()?,
                        });
                    }
                    ParseOutcome::Challenge => {
                        self.record_failure(&mirror)?;
                    }
                    ParseOutcome::Unrecognised => {
                        self.record_failure(&mirror)?;
                        last_format_error = Some(mirror.host.clone());
                    }
                },
                Err(FetchError::Offline) => {
                    offline_attempts += 1;
                    self.record_failure(&mirror)?;
                }
                Err(FetchError::Status(status)) => {
                    eprintln!(
                        "pocketlibrary: Libgen mirror {} answered {status}",
                        mirror.host
                    );
                    self.record_failure(&mirror)?;
                }
            }
        }

        if attempts > 0 && offline_attempts == attempts {
            return Err(Error::Offline);
        }
        if let Some(mirror) = last_format_error {
            return Err(Error::MirrorFormatChanged { mirror });
        }
        Err(Error::AllMirrorsFailed { attempts })
    }

    /// Probe `status.json` now. This is best-effort: a hint must never fail a
    /// search, so a SLUM outage is swallowed.
    pub async fn refresh_health_hint(&self) {
        if !self.use_slum {
            return;
        }
        let etag = self
            .slum
            .lock()
            .ok()
            .and_then(|state| state.etag().map(str::to_owned));
        refresh_slum(&self.client, &self.slum_url, &self.slum, etag).await;
    }

    fn maybe_refresh_slum(&self) {
        if !self.use_slum {
            return;
        }
        let stale = self
            .slum
            .lock()
            .map(|state| !state.is_fresh(std::time::Instant::now()))
            .unwrap_or(false);
        if !stale {
            return;
        }
        let etag = self
            .slum
            .lock()
            .ok()
            .and_then(|state| state.etag().map(str::to_owned));
        let client = self.client.clone();
        let url = self.slum_url.clone();
        let slum = Arc::clone(&self.slum);
        // Non-blocking: this search proceeds on the compiled/known order.
        tokio::spawn(async move {
            refresh_slum(&client, &url, &slum, etag).await;
        });
    }

    async fn fetch_page(
        &self,
        mirror: &Mirror,
        query: &SearchQuery,
    ) -> std::result::Result<String, FetchError> {
        let url = search_url(&mirror.base, query);
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| FetchError::Offline)?;
        let status = response.status();
        if !status.is_success() {
            return Err(FetchError::Status(status.as_u16()));
        }
        let html = response.text().await.map_err(|_| FetchError::Offline)?;
        Ok(html)
    }

    fn record_success(&self, mirror: &Mirror) -> Result<()> {
        self.registry
            .lock()
            .map_err(|_| Error::LockPoisoned)?
            .record_success(&mirror.host);
        Ok(())
    }

    fn record_failure(&self, mirror: &Mirror) -> Result<()> {
        self.registry
            .lock()
            .map_err(|_| Error::LockPoisoned)?
            .record_failure(&mirror.host);
        Ok(())
    }

    fn health_snapshot(&self) -> Result<Vec<MirrorHealth>> {
        let registry = self.registry.lock().map_err(|_| Error::LockPoisoned)?;
        Ok(registry.snapshot(&self.mirrors))
    }
}

enum FetchError {
    Offline,
    Status(u16),
}

async fn refresh_slum(
    client: &wreq::Client,
    url: &str,
    slum: &Arc<Mutex<SlumState>>,
    etag: Option<String>,
) {
    let mut request = client.get(url).timeout(Duration::from_secs(8));
    if let Some(etag) = etag {
        request = request.header(wreq::header::IF_NONE_MATCH, etag);
    }
    let Ok(response) = request.send().await else {
        return;
    };
    if response.status() == wreq::StatusCode::NOT_MODIFIED {
        if let Ok(mut state) = slum.lock() {
            state.touch();
        }
        return;
    }
    if !response.status().is_success() {
        return;
    }
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let Ok(body) = response.text().await else {
        return;
    };
    if let Ok(mut state) = slum.lock() {
        state.store(&body, etag);
    }
}
