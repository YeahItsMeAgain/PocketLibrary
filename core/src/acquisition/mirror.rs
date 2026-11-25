//! Mirror order and per-device health.
//!
//! SLUM's `status.json` is a coarse, homepage-only hint. The compiled five-host
//! list is the cold-start truth and every real request updates local health.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// The compiled bootstrap order. `.la` and `.gl` are Cloudflare-protected and
/// therefore last, never first.
pub const BOOTSTRAP_MIRRORS: [&str; 5] = [
    "https://libgen.li",
    "https://libgen.bz",
    "https://libgen.vg",
    "https://libgen.la",
    "https://libgen.gl",
];

pub const SLUM_STATUS_URL: &str = "https://open-slum.org/status.json";

/// How long a SLUM snapshot is trusted before a background refresh.
pub const SLUM_TTL: Duration = Duration::from_secs(10 * 60);
const INITIAL_COOLDOWN: Duration = Duration::from_secs(15);
const MAX_COOLDOWN: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub struct Mirror {
    pub base: String,
    pub host: String,
}

impl Mirror {
    pub fn new(base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_owned();
        let host = base
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(&base)
            .split('/')
            .next()
            .unwrap_or(&base)
            .to_owned();
        Self { base, host }
    }
}

/// A live health view for diagnostics and tests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorHealth {
    pub host: String,
    pub failures: u32,
    pub cooling_down: bool,
    pub last_success: bool,
}

#[derive(Debug, Clone, Default)]
struct HealthEntry {
    failures: u32,
    cooldown_until: Option<Instant>,
    last_success: Option<Instant>,
}

/// Per-device success/failure memory. Two consecutive transient failures put a
/// host into exponential cooldown; any success resets it.
#[derive(Debug, Default)]
pub struct HealthRegistry {
    entries: HashMap<String, HealthEntry>,
}

impl HealthRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn entry(&mut self, host: &str) -> &mut HealthEntry {
        self.entries.entry(host.to_owned()).or_default()
    }

    pub fn record_failure(&mut self, host: &str) {
        let entry = self.entry(host);
        entry.failures = entry.failures.saturating_add(1);
        if entry.failures >= 2 {
            let exponent = (entry.failures - 2).min(5);
            let base = INITIAL_COOLDOWN
                .checked_mul(1u32 << exponent)
                .unwrap_or(MAX_COOLDOWN)
                .min(MAX_COOLDOWN);
            // Deterministic per-host jitter keeps retries from synchronising
            // without needing a random-number dependency.
            let jitter = (host.bytes().map(u32::from).sum::<u32>() % 20) as f64 / 100.0;
            entry.cooldown_until = Some(Instant::now() + base.mul_f64(1.0 + jitter));
        }
    }

    pub fn record_success(&mut self, host: &str) {
        let entry = self.entry(host);
        entry.failures = 0;
        entry.cooldown_until = None;
        entry.last_success = Some(Instant::now());
    }

    /// 0 = trial (a cooled host whose timer has expired), 1 = healthy,
    /// 2 = cooling down.
    fn rank(&self, host: &str, now: Instant) -> u8 {
        let Some(entry) = self.entries.get(host) else {
            return 1;
        };
        match entry.cooldown_until {
            Some(until) if until > now => 2,
            Some(_) => 0,
            None => 1,
        }
    }

    pub fn snapshot(&self, mirrors: &[Mirror]) -> Vec<MirrorHealth> {
        let now = Instant::now();
        mirrors
            .iter()
            .map(|mirror| {
                let entry = self.entries.get(&mirror.host).cloned().unwrap_or_default();
                MirrorHealth {
                    host: mirror.host.clone(),
                    failures: entry.failures,
                    cooling_down: entry.cooldown_until.is_some_and(|until| until > now),
                    last_success: entry.last_success.is_some(),
                }
            })
            .collect()
    }
}

/// The parsed shape of `https://open-slum.org/status.json` that we need.
#[derive(Debug, Deserialize)]
struct SlumStatus {
    #[serde(default)]
    generated_at: Option<String>,
    #[serde(default)]
    sites: Vec<SlumSite>,
}

#[derive(Debug, Deserialize)]
struct SlumSite {
    id: String,
    #[serde(default)]
    domains: Vec<SlumDomain>,
}

#[derive(Debug, Deserialize)]
struct SlumDomain {
    #[serde(default)]
    url: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    collecting: bool,
    #[serde(default)]
    last_check: Option<SlumCheck>,
}

#[derive(Debug, Deserialize)]
struct SlumCheck {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    body_contains_pass: Option<bool>,
    #[serde(default)]
    protection_type: Option<String>,
}

/// Tier ordering from SLUM. Lower is preferred. Unknown hosts are neutral.
fn slum_tier(domain: &SlumDomain) -> Option<u8> {
    if domain.collecting || domain.url.is_empty() {
        return None;
    }
    let check = domain.last_check.as_ref()?;
    // A snapshot without a check timestamp is not evidence.
    check.timestamp.as_ref()?;
    let protected = check.protection_type.is_some();
    match domain.status.as_str() {
        "UP" if check.body_contains_pass == Some(true) && !protected => Some(0),
        "UP" | "PROTECTED" => Some(1),
        "DEGRADED" => Some(2),
        "DOWN" | "TIMEOUT" => Some(3),
        _ => None,
    }
}

/// Extract host -> tier from a SLUM snapshot.
pub fn slum_ranks(body: &str) -> (HashMap<String, u8>, Option<String>) {
    let Ok(status) = serde_json::from_str::<SlumStatus>(body) else {
        return (HashMap::new(), None);
    };
    let mut ranks = HashMap::new();
    for site in status.sites.iter().filter(|site| site.id == "libgen") {
        for domain in &site.domains {
            if let Some(tier) = slum_tier(domain) {
                let host = domain
                    .url
                    .split_once("://")
                    .map(|(_, rest)| rest)
                    .unwrap_or(&domain.url)
                    .trim_end_matches('/')
                    .to_owned();
                ranks.insert(host, tier);
            }
        }
    }
    (ranks, status.generated_at)
}

/// Cached SLUM hint. This never gates a search: a cold cache means the
/// compiled order is used and a refresh happens in the background.
#[derive(Debug, Default)]
pub struct SlumState {
    fetched_at: Option<Instant>,
    etag: Option<String>,
    ranks: HashMap<String, u8>,
}

impl SlumState {
    pub fn is_fresh(&self, now: Instant) -> bool {
        self.fetched_at
            .is_some_and(|fetched| now.duration_since(fetched) < SLUM_TTL)
    }

    pub fn etag(&self) -> Option<&str> {
        self.etag.as_deref()
    }

    pub fn ranks(&self) -> &HashMap<String, u8> {
        &self.ranks
    }

    pub fn store(&mut self, body: &str, etag: Option<String>) {
        let (ranks, _generated_at) = slum_ranks(body);
        if !ranks.is_empty() {
            self.ranks = ranks;
            self.etag = etag;
            self.fetched_at = Some(Instant::now());
        }
    }

    pub fn touch(&mut self) {
        self.fetched_at = Some(Instant::now());
    }
}

/// Order mirrors by local health first, then the SLUM tier hint, then the
/// compiled order. A fresh local success always outranks a stale snapshot.
pub fn order_mirrors(
    mirrors: &[Mirror],
    registry: &HealthRegistry,
    slum: &SlumState,
) -> Vec<Mirror> {
    let now = Instant::now();
    let mut ranked: Vec<(u8, u8, usize, Mirror)> = mirrors
        .iter()
        .enumerate()
        .map(|(index, mirror)| {
            let health = registry.rank(&mirror.host, now);
            let hint = slum.ranks().get(&mirror.host).copied().unwrap_or(1);
            (health, hint, index, mirror.clone())
        })
        .collect();
    ranked.sort_by_key(|(health, hint, index, _)| (*health, *hint, *index));
    ranked.into_iter().map(|(_, _, _, mirror)| mirror).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_libgen_tiers_from_a_snapshot() {
        let body = include_str!("../../tests/fixtures/slum-status.json");
        let (ranks, generated) = slum_ranks(body);
        assert_eq!(ranks.get("libgen.li"), Some(&0));
        assert_eq!(ranks.get("libgen.bz"), Some(&0));
        assert_eq!(ranks.get("libgen.vg"), Some(&0));
        assert_eq!(ranks.get("libgen.la"), Some(&1));
        assert_eq!(ranks.get("libgen.gl"), Some(&1));
        assert!(generated.is_some());
    }

    #[test]
    fn two_failures_cool_a_host_and_success_resets_it() {
        let mut registry = HealthRegistry::new();
        registry.record_failure("libgen.li");
        assert!(!registry.snapshot(&[Mirror::new("https://libgen.li")])[0].cooling_down);
        registry.record_failure("libgen.li");
        assert!(registry.snapshot(&[Mirror::new("https://libgen.li")])[0].cooling_down);
        registry.record_success("libgen.li");
        let snapshot = registry.snapshot(&[Mirror::new("https://libgen.li")]);
        assert!(!snapshot[0].cooling_down);
        assert_eq!(snapshot[0].failures, 0);
    }
}
