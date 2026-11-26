//! Local diagnostics log and one-tap export.
//!
//! The log is deliberately plain text and family-only: paths and book titles
//! are useful, so they are kept. Secrets (keystore passwords, tokens) and book
//! contents are never written. The file rotates by size and age so a long-lived
//! install cannot grow without bound.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{Error, Result};

/// Soft cap for `diagnostics.log`; maintain trims to ~75% once crossed.
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
/// Entries older than this are dropped when the log is opened or pruned.
pub const MAX_AGE_DAYS: i64 = 7;
const MAX_AGE_MS: i64 = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const TRIM_TARGET_BYTES: usize = (MAX_LOG_BYTES as usize) * 3 / 4;
const SESSION_FILE: &str = "diagnostics.session";
const EXPORT_FILE: &str = "pocketlibrary-diagnostics.zip";

/// Severity stored in the log. Warnings and errors feed recent failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error,
    Warn,
    Info,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "ERROR",
            Self::Warn => "WARN",
            Self::Info => "INFO",
        }
    }

    /// Parse a JS command value; unknown values are treated as info.
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "error" => Self::Error,
            "warn" | "warning" => Self::Warn,
            _ => Self::Info,
        }
    }
}

/// A screen-friendly snapshot of the current log.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub log_bytes: u64,
    pub log_lines: usize,
    pub errors: usize,
    pub warnings: usize,
    /// The full last error line, including its timestamp.
    pub last_error: Option<String>,
    pub last_error_at: Option<String>,
}

/// Machine/version identity attached to `summary.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsEnvironment {
    pub app_name: String,
    pub app_version: String,
    pub schema_version: i64,
    /// Android release ("14") or "not Android" on a desktop build.
    pub android: String,
    /// Device model ("Pixel 8") or the host OS/arch on desktop.
    pub device: String,
    pub counts: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportSummary<'a> {
    #[serde(flatten)]
    environment: &'a DiagnosticsEnvironment,
    generated_at: String,
    log: &'a DiagnosticsSummary,
}

/// The app-level rolling log. Cheap to clone via [`Arc`].
#[derive(Debug)]
pub struct Diagnostics {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Diagnostics {
    /// Open (creating parents for) a log at `path`.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn session_path(&self) -> PathBuf {
        self.path.with_file_name(SESSION_FILE)
    }

    /// Append one line. File errors are swallowed: diagnostics must never make
    /// the app fail.
    pub fn append(&self, level: Level, event: &str, message: &str) {
        self.append_at(SystemTime::now(), level, event, message);
    }

    fn append_at(&self, now: SystemTime, level: Level, event: &str, message: &str) {
        let line = format!(
            "{} {} {}: {}\n",
            format_timestamp(now),
            level.as_str(),
            sanitize(event),
            sanitize(message)
        );
        {
            let _guard = self
                .lock
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let _ = fs::create_dir_all(self.path.parent().unwrap_or_else(|| Path::new(".")));
            let _ = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .and_then(|mut file| file.write_all(line.as_bytes()));
        }
        self.maintain_if_oversized(now);
    }

    /// Start a session and report whether the previous one lacked its clean
    /// shutdown marker.
    pub fn start_session(&self) -> Result<bool> {
        let now = SystemTime::now();
        self.prune(now);
        let marker = self.session_path();
        let unexpected = marker.exists();
        if unexpected {
            self.append_at(
                now,
                Level::Error,
                "session",
                "previous session ended unexpectedly",
            );
        }
        self.append_at(now, Level::Info, "session", "start");
        fs::write(&marker, format_timestamp(now))?;
        Ok(unexpected)
    }

    /// Record a clean shutdown and remove the crash marker.
    pub fn end_session(&self) {
        self.append(Level::Info, "session", "clean shutdown");
        let _ = fs::remove_file(self.session_path());
    }

    /// True while the current session has a running marker on disk.
    pub fn session_marker_exists(&self) -> bool {
        self.session_path().exists()
    }

    pub fn summary(&self) -> DiagnosticsSummary {
        let bytes = fs::read(&self.path).unwrap_or_default();
        let text = String::from_utf8_lossy(&bytes);
        let mut summary = DiagnosticsSummary {
            log_bytes: bytes.len() as u64,
            ..DiagnosticsSummary::default()
        };
        for line in text.lines() {
            let line = line.trim_end();
            if line.is_empty() {
                continue;
            }
            summary.log_lines += 1;
            if let Some((at, rest)) = split_line(line) {
                if rest.starts_with(Level::Error.as_str()) {
                    summary.errors += 1;
                    summary.last_error = Some(line.to_owned());
                    summary.last_error_at = Some(at.to_owned());
                } else if rest.starts_with(Level::Warn.as_str()) {
                    summary.warnings += 1;
                }
            }
        }
        summary
    }

    /// The last `limit` warnings and errors, oldest first.
    pub fn recent_failures(&self, limit: usize) -> Vec<String> {
        let text = self.read_text();
        let mut failures: Vec<String> = text
            .lines()
            .filter(|line| {
                split_line(line)
                    .map(|(_, rest)| {
                        rest.starts_with(Level::Error.as_str())
                            || rest.starts_with(Level::Warn.as_str())
                    })
                    .unwrap_or(false)
            })
            .map(str::to_owned)
            .collect();
        let start = failures.len().saturating_sub(limit);
        failures.split_off(start)
    }

    /// Empty the log. The session marker is left alone so a crash is still
    /// detected after a user clears old entries.
    pub fn clear(&self) {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = fs::write(&self.path, b"");
    }

    /// Build the shareable zip: log, JSON summary and recent failures.
    pub fn export_zip(&self, environment: &DiagnosticsEnvironment) -> Result<Vec<u8>> {
        let now = SystemTime::now();
        self.prune(now);
        let summary = self.summary();
        let log = self.read_text();
        let failures = self.recent_failures(20).join("\n");
        // The spine module keeps its own low-level log next to `spine/`.
        // Include it so a JNI/extraction failure arrives with diagnostics even
        // when the app-level log never saw it.
        let spine_log = self
            .path
            .parent()
            .map(|data_dir| data_dir.join("spine").join("spine.log"))
            .and_then(|path| fs::read(path).ok());
        let exported = ExportSummary {
            environment,
            generated_at: format_timestamp(now),
            log: &summary,
        };
        let summary_json = serde_json::to_vec_pretty(&exported).unwrap_or_else(|_| b"{}".to_vec());

        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("diagnostics.txt", options)
            .map_err(zip_error)?;
        zip.write_all(log.as_bytes())?;
        zip.start_file("summary.json", options).map_err(zip_error)?;
        zip.write_all(&summary_json)?;
        zip.start_file("recent-failures.txt", options)
            .map_err(zip_error)?;
        zip.write_all(failures.as_bytes())?;
        if let Some(spine_log) = spine_log {
            zip.start_file("spine.log", options).map_err(zip_error)?;
            zip.write_all(&spine_log)?;
        }
        let cursor = zip.finish().map_err(zip_error)?;
        Ok(cursor.into_inner())
    }

    /// Drop sessions/log lines older than [`MAX_AGE_DAYS`], then trim to the
    /// size cap from the newest line backwards.
    pub fn prune(&self, now: SystemTime) {
        let _guard = self
            .lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original = fs::read(&self.path).unwrap_or_default();
        if original.is_empty() {
            return;
        }
        let text = String::from_utf8_lossy(&original);
        let cutoff = epoch_ms(now).saturating_sub(MAX_AGE_MS);
        let mut kept: Vec<&str> = text
            .split_inclusive('\n')
            .filter(|line| line_epoch_ms(line).is_none_or(|at| at >= cutoff))
            .collect();
        let mut total: usize = kept.iter().map(|line| line.len()).sum();
        if total > MAX_LOG_BYTES as usize {
            let mut start = kept.len();
            let mut size = 0;
            while start > 0 {
                let len = kept[start - 1].len();
                if size + len > TRIM_TARGET_BYTES {
                    break;
                }
                size += len;
                start -= 1;
            }
            kept = kept.split_off(start);
            total = size;
        }
        if total as u64 != original.len() as u64 || kept.len() != text.lines().count() {
            let _ = fs::write(&self.path, kept.concat());
        }
    }

    fn maintain_if_oversized(&self, now: SystemTime) {
        let oversized = fs::metadata(&self.path)
            .map(|metadata| metadata.len() > MAX_LOG_BYTES)
            .unwrap_or(false);
        if oversized {
            self.prune(now);
        }
    }

    fn read_text(&self) -> String {
        let bytes = fs::read(&self.path).unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// The file name suggested by every export surface.
pub fn export_file_name() -> &'static str {
    EXPORT_FILE
}

fn split_line(line: &str) -> Option<(&str, &str)> {
    let (at, rest) = line.split_once(' ')?;
    Some((at, rest))
}

fn sanitize(text: &str) -> String {
    text.replace('\r', "").replace('\n', "\\n")
}

fn zip_error(error: zip::result::ZipError) -> Error {
    Error::Io(std::io::Error::other(error))
}

fn epoch_ms(now: SystemTime) -> i64 {
    now.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn format_timestamp(now: SystemTime) -> String {
    let total_seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = total_seconds.div_euclid(86_400);
    let seconds = total_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds / 3600;
    let minute = (seconds % 3600) / 60;
    let second = seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn line_epoch_ms(line: &str) -> Option<i64> {
    let at = line.get(0..20)?;
    if at.as_bytes().get(4) != Some(&b'-')
        || at.as_bytes().get(10) != Some(&b'T')
        || at.as_bytes().get(19) != Some(&b'Z')
    {
        return None;
    }
    let year: i64 = at.get(0..4)?.parse().ok()?;
    let month: i64 = at.get(5..7)?.parse().ok()?;
    let day: i64 = at.get(8..10)?.parse().ok()?;
    let hour: i64 = at.get(11..13)?.parse().ok()?;
    let minute: i64 = at.get(14..16)?.parse().ok()?;
    let second: i64 = at.get(17..19)?.parse().ok()?;
    Some((days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second) * 1000)
}

// Civil-date conversion (Howard Hinnant's algorithms), UTC only.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let adjusted = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * adjusted + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/* --------------------------------------------------------------- process */

static GLOBAL: OnceLock<Arc<Diagnostics>> = OnceLock::new();

/// Install the process-wide logger used by migrations, downloads and panics.
pub fn install_global(diagnostics: Arc<Diagnostics>) {
    let _ = GLOBAL.set(diagnostics);
}

/// The global logger, if the shell installed one. Core tests leave it unset.
pub fn global() -> Option<&'static Arc<Diagnostics>> {
    GLOBAL.get()
}

/// Best-effort event for modules that cannot take a logger parameter.
pub fn log_event(level: Level, event: &str, message: &str) {
    if let Some(diagnostics) = global() {
        diagnostics.append(level, event, message);
    }
}

fn record_panic(diagnostics: &Diagnostics, message: &str) {
    diagnostics.append(Level::Error, "panic", message);
}

/// Chain a panic hook that records the payload and source location before the
/// previous hook runs. Release builds use `panic = "abort"`, so the hook must
/// write synchronously and not allocate excessively.
pub fn install_panic_hook(diagnostics: Arc<Diagnostics>) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown location".to_owned());
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_owned()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "non-string panic payload".to_owned()
        };
        record_panic(&diagnostics, &format!("{payload} at {location}"));
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::time::Duration;

    use tempfile::tempdir;
    use zip::ZipArchive;

    use super::*;

    fn fixed_time() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_700_000_000)
    }

    #[test]
    fn append_counts_levels_and_escapes_newlines() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        diagnostics.append(Level::Info, "startup", "version 0.1.1");
        diagnostics.append(Level::Warn, "folder", "grant\nrenewed");
        diagnostics.append(Level::Error, "scan", "could not read /books/a.epub");

        let summary = diagnostics.summary();
        assert_eq!(summary.log_lines, 3);
        assert_eq!(summary.warnings, 1);
        assert_eq!(summary.errors, 1);
        assert!(
            summary
                .last_error
                .as_deref()
                .unwrap()
                .contains("/books/a.epub")
        );
        assert!(diagnostics.read_text().contains("grant\\nrenewed"));
    }

    #[test]
    fn rotation_keeps_the_newest_lines_under_the_cap() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        let filler = "x".repeat(4096);
        for index in 0..700 {
            diagnostics.append(Level::Info, "bulk", &format!("{index} {filler}"));
        }
        let bytes = fs::metadata(diagnostics.path()).unwrap().len();
        assert!(bytes <= MAX_LOG_BYTES, "log grew to {bytes} bytes");
        let text = diagnostics.read_text();
        assert!(text.contains("699 "));
        assert!(
            !text.contains("bulk: 0 xxxx"),
            "oldest line survived rotation"
        );
    }

    #[test]
    fn old_entries_are_dropped_by_age() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        let old = format_timestamp(fixed_time() - Duration::from_secs(8 * 86_400));
        let fresh = fixed_time_line();
        fs::write(
            diagnostics.path(),
            format!("{old} INFO ancient: too old\n{fresh} INFO fresh: kept\n"),
        )
        .unwrap();
        diagnostics.prune(fixed_time());
        let text = diagnostics.read_text();
        assert!(!text.contains("ancient"));
        assert!(text.contains("fresh"));
    }

    fn fixed_time_line() -> String {
        format_timestamp(fixed_time())
    }

    #[test]
    fn export_zip_has_the_three_expected_files() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        diagnostics.append(Level::Error, "download", "Book One failed");
        diagnostics.append(Level::Info, "download", "Book Two completed");
        fs::create_dir_all(dir.path().join("spine")).unwrap();
        fs::write(
            dir.path().join("spine").join("spine.log"),
            "123 ensure_models: error: no JNI context\n",
        )
        .unwrap();
        let environment = DiagnosticsEnvironment {
            app_name: "PocketLibrary".to_owned(),
            app_version: "0.1.1".to_owned(),
            schema_version: 4,
            android: "14".to_owned(),
            device: "Pixel 8".to_owned(),
            counts: BTreeMap::from([("books".to_owned(), 12)]),
        };
        let zip = diagnostics.export_zip(&environment).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(zip)).unwrap();
        let mut diagnostics_txt = String::new();
        archive
            .by_name("diagnostics.txt")
            .unwrap()
            .read_to_string(&mut diagnostics_txt)
            .unwrap();
        assert!(diagnostics_txt.contains("Book One failed"));
        let mut failures_text = String::new();
        archive
            .by_name("recent-failures.txt")
            .unwrap()
            .read_to_string(&mut failures_text)
            .unwrap();
        assert!(failures_text.contains("Book One failed"));
        assert!(!failures_text.contains("Book Two completed"));
        let mut summary_text = String::new();
        archive
            .by_name("summary.json")
            .unwrap()
            .read_to_string(&mut summary_text)
            .unwrap();
        assert!(summary_text.contains("\"appVersion\": \"0.1.1\""));
        assert!(summary_text.contains("\"device\": \"Pixel 8\""));
        assert!(summary_text.contains("\"counts\""));
        assert!(summary_text.contains("\"errors\": 1"));
        let mut spine_text = String::new();
        archive
            .by_name("spine.log")
            .unwrap()
            .read_to_string(&mut spine_text)
            .unwrap();
        assert!(spine_text.contains("ensure_models: error"));
    }

    #[test]
    fn previous_session_without_clean_end_is_reported() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        assert!(!diagnostics.start_session().unwrap());
        assert!(diagnostics.session_marker_exists());
        // A second launch without end_session is the crash case.
        assert!(diagnostics.start_session().unwrap());
        assert!(
            diagnostics
                .read_text()
                .contains("previous session ended unexpectedly")
        );
        diagnostics.end_session();
        assert!(!diagnostics.session_marker_exists());
        assert!(diagnostics.read_text().contains("clean shutdown"));
        assert!(!diagnostics.start_session().unwrap());
    }

    #[test]
    fn recent_failures_are_capped_at_twenty() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        for index in 0..30 {
            diagnostics.append(Level::Error, "test", &format!("failure {index}"));
        }
        let failures = diagnostics.recent_failures(20);
        assert_eq!(failures.len(), 20);
        assert!(failures[0].contains("failure 10"));
        assert!(failures[19].contains("failure 29"));
        assert_eq!(diagnostics.summary().errors, 30);
    }

    #[test]
    fn clear_empties_the_log() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        let _ = diagnostics.start_session();
        diagnostics.append(Level::Error, "test", "gone");
        diagnostics.clear();
        assert_eq!(diagnostics.summary().log_bytes, 0);
        assert_eq!(diagnostics.summary().log_lines, 0);
        assert!(diagnostics.session_marker_exists());
    }

    #[test]
    fn panic_marker_records_payload_and_location() {
        let dir = tempdir().unwrap();
        let diagnostics = Diagnostics::new(dir.path().join("diagnostics.log"));
        record_panic(&diagnostics, "boom at src/main.rs:42");
        let summary = diagnostics.summary();
        assert_eq!(summary.errors, 1);
        assert!(summary.last_error.unwrap().contains("panic: boom"));
    }
}
