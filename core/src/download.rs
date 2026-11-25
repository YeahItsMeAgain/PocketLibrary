//! The download queue: resolve a Libgen result, fetch it over a resumable
//! HTTP/1.1 connection, validate the bytes, deduplicate and land the book.
//!
//! The network and the library folder are both seams. The HTTP side is a real
//! `wreq` client (browser-impersonated for the mirror pages, HTTP/1.1 for the
//! CDN); tests point it at a local fake server. The destination is
//! [`DownloadSink`], implemented by SAF on Android and by an in-memory fake in
//! tests. Nothing here needs Tauri.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use scraper::{Html, Selector};
use url::Url;
use wreq::header::{ACCEPT_ENCODING, CONTENT_RANGE, LOCATION, RANGE};
use wreq_util::Emulation;

use crate::error::{Error, Result};
use crate::models::{BookFormat, Download, DownloadRequest, Landing};
use crate::service::Service;

/// Where validated book bytes can be written. Implemented by the Android SAF
/// adapter; tests use a fake that can fail or pre-seed collisions.
pub trait DownloadSink: Send + Sync {
    /// Names already in the library folder root, for collision numbering.
    fn list_root(&self) -> Result<Vec<String>>;

    /// Write one complete, validated file. Implementations should use a
    /// temporary name and rename when their provider supports it.
    fn write_file(&self, name: &str, bytes: &[u8]) -> Result<()>;
}

/// The persisted queue plus the two-client resolver/downloader.
pub struct DownloadManager {
    service: Arc<Service>,
    temp_dir: PathBuf,
    page_client: wreq::Client,
    file_client: wreq::Client,
    cancel: Mutex<HashMap<i64, Arc<AtomicBool>>>,
    processing: AtomicBool,
    write_lock: Mutex<()>,
}

impl DownloadManager {
    pub(crate) fn new(service: Arc<Service>, temp_dir: PathBuf) -> Result<Self> {
        let page_client = wreq::Client::builder()
            .emulation(Emulation::Chrome136)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(wreq::redirect::Policy::none())
            .build()
            .map_err(|error| {
                eprintln!("pocketlibrary error (download_page_client): {error}");
                Error::Offline
            })?;
        let file_client = wreq::Client::builder()
            .http1_only()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .redirect(wreq::redirect::Policy::limited(8))
            .build()
            .map_err(|error| {
                eprintln!("pocketlibrary error (download_file_client): {error}");
                Error::Offline
            })?;
        Ok(Self {
            service,
            temp_dir,
            page_client,
            file_client,
            cancel: Mutex::new(HashMap::new()),
            processing: AtomicBool::new(false),
            write_lock: Mutex::new(()),
        })
    }

    /// Queue a result. A completed md5 is answered from download history; an
    /// already-queued md5 is returned instead of being queued twice.
    pub fn enqueue(&self, request: DownloadRequest) -> Result<Download> {
        if let Some(completed) = self.service.completed_download_for_md5(&request.md5)? {
            return self.service.insert_duplicate_download(
                &request,
                completed.book_id,
                completed.filename.as_deref(),
            );
        }
        self.service.insert_download(&request)
    }

    pub fn list(&self) -> Result<Vec<Download>> {
        self.service.list_downloads()
    }

    pub fn cancel(&self, id: i64) -> Result<()> {
        if let Some(flag) = self
            .cancel
            .lock()
            .map_err(|_| Error::LockPoisoned)?
            .get(&id)
        {
            flag.store(true, Ordering::SeqCst);
        }
        self.service.mark_download_cancelled(id)?;
        if let Ok(mut map) = self.cancel.lock() {
            map.remove(&id);
        }
        Ok(())
    }

    pub fn retry(&self, id: i64) -> Result<Download> {
        self.service.retry_download(id)
    }

    /// Run queued rows, at most two at a time, until the queue is empty.
    ///
    /// Only one loop runs per manager; a second call is a no-op. Interrupted
    /// rows are first returned to the queue so a relaunch resumes them.
    pub async fn process(&self, sink: &dyn DownloadSink) -> Result<()> {
        if self
            .processing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        let result = self.process_loop(sink).await;
        self.processing.store(false, Ordering::SeqCst);
        result
    }

    async fn process_loop(&self, sink: &dyn DownloadSink) -> Result<()> {
        self.service.recover_downloads()?;
        loop {
            let batch = self.service.claim_queued_downloads(2)?;
            if batch.is_empty() {
                break;
            }
            let work = batch.iter().map(|download| self.run_one(download, sink));
            futures_util::future::join_all(work).await;
        }
        Ok(())
    }

    async fn run_one(&self, download: &Download, sink: &dyn DownloadSink) {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancel.lock() {
            map.insert(download.id, Arc::clone(&flag));
        }
        let outcome = self.fetch_and_land(download, &flag, sink).await;
        if let Ok(mut map) = self.cancel.lock() {
            map.remove(&download.id);
        }
        if flag.load(Ordering::SeqCst) {
            // Keep the `.part`: a retry resumes from it with a Range request.
            let _ = self.service.mark_download_cancelled(download.id);
            return;
        }
        if let Err(error) = outcome {
            let code = error.code();
            eprintln!(
                "pocketlibrary: download {} failed ({code}): {error}",
                download.id
            );
            let _ = self
                .service
                .fail_download(download.id, code, &message_for(&error));
        }
    }

    async fn fetch_and_land(
        &self,
        download: &Download,
        cancel: &AtomicBool,
        sink: &dyn DownloadSink,
    ) -> Result<()> {
        self.ensure_temp_dir()?;
        let part = self.part_path(download.id);

        let mirrors = if download.mirror_urls.is_empty() {
            vec![String::new()]
        } else {
            download.mirror_urls.clone()
        };
        let mut last_error = None;
        let mut landed = false;
        for (index, mirror) in mirrors.into_iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                return Ok(());
            }
            let host = mirror_host(&mirror);
            let note = (index > 0).then_some("Trying another mirror…");
            let _ = self
                .service
                .update_download_attempt(download.id, &host, note);
            // The key can expire between minting and fetching; one fresh mint
            // per mirror is enough before failing over.
            for _attempt in 0..2 {
                if cancel.load(Ordering::SeqCst) {
                    return Ok(());
                }
                let result = async {
                    let url = self.resolve(&mirror).await?;
                    self.fetch_to_part(download, &url, &part, cancel).await
                }
                .await;
                match result {
                    Ok(()) => {
                        landed = true;
                        break;
                    }
                    Err(Error::DownloadExpiredKey) => {
                        last_error = Some(Error::DownloadExpiredKey);
                        continue;
                    }
                    Err(error) => {
                        last_error = Some(error);
                        break;
                    }
                }
            }
            if landed {
                break;
            }
        }
        if !landed {
            return Err(last_error.unwrap_or(Error::DownloadMirrorFailed {
                message: "no mirror could serve the file".to_owned(),
            }));
        }
        if cancel.load(Ordering::SeqCst) {
            return Ok(());
        }

        let bytes = fs::read(&part).map_err(|error| Error::DownloadDisk {
            message: error.to_string(),
        })?;
        if let Err(error) = self.validate_magic(download.format, &bytes) {
            // Never let a retry append to bytes that are not this book.
            self.remove_part(download.id);
            return Err(error);
        }

        if let Some(book_id) = self
            .service
            .find_book_by_hash(&crate::identity::content_hash(&bytes))?
        {
            let filename = self
                .service
                .book_path(book_id)
                .ok()
                .or_else(|| download.filename.clone());
            self.service.complete_download(
                download.id,
                book_id,
                filename.as_deref().unwrap_or(""),
                true,
            )?;
            self.remove_part(download.id);
            return Ok(());
        }

        let filename = {
            // Hold the lock across the write so two concurrent downloads
            // cannot both choose the same free name.
            let _guard = self.write_lock.lock().map_err(|_| Error::LockPoisoned)?;
            let filename = unique_filename(sink.list_root()?, &proposed_filename(download));
            sink.write_file(&filename, &bytes)?;
            filename
        };

        let landing = match self.service.land_download(&filename, &bytes) {
            Ok(landing) => landing,
            Err(error @ Error::DownloadInvalidBook) => {
                self.remove_part(download.id);
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        match landing {
            Landing::Added { book_id, .. } => {
                self.service
                    .complete_download(download.id, book_id, &filename, false)?;
            }
            Landing::Duplicate { book_id } => {
                self.service
                    .complete_download(download.id, book_id, &filename, true)?;
            }
        }
        self.remove_part(download.id);
        Ok(())
    }

    fn ensure_temp_dir(&self) -> Result<()> {
        fs::create_dir_all(&self.temp_dir).map_err(|error| Error::DownloadDisk {
            message: error.to_string(),
        })
    }

    fn part_path(&self, id: i64) -> PathBuf {
        self.temp_dir.join(format!("{id}.part"))
    }

    fn remove_part(&self, id: i64) {
        let _ = fs::remove_file(self.part_path(id));
    }

    /// Resolve `ads.php` to the short-lived `get.php` link, then follow its
    /// redirect without downloading the CDN payload here.
    async fn resolve(&self, mirror_url: &str) -> Result<String> {
        let mut get_url = if is_get_url(mirror_url) {
            mirror_url.to_owned()
        } else {
            let mut current = mirror_url.to_owned();
            let mut found = None;
            for _ in 0..5 {
                let response = self
                    .page_client
                    .get(&current)
                    .send()
                    .await
                    .map_err(|_| Error::Offline)?;
                let status = response.status();
                if status.is_redirection() {
                    current = join_url(&current, &header(&response, LOCATION)?)?;
                    continue;
                }
                if !status.is_success() {
                    return Err(Error::DownloadMirrorFailed {
                        message: format!("ads page answered {status}"),
                    });
                }
                let body = response.text().await.map_err(|_| Error::Offline)?;
                found = extract_get_url(&body, &current);
                break;
            }
            found.ok_or_else(|| Error::DownloadMirrorFailed {
                message: "the ads page had no download link".to_owned(),
            })?
        };

        // Some mirrors redirect the ads link straight to get.php. Keep the
        // resolution bounded.
        for _ in 0..3 {
            let response = self
                .page_client
                .get(&get_url)
                .send()
                .await
                .map_err(|_| Error::Offline)?;
            let status = response.status();
            if status.is_redirection() {
                return join_url(&get_url, &header(&response, LOCATION)?);
            }
            if matches!(status.as_u16(), 401 | 403 | 404 | 410) {
                return Err(Error::DownloadExpiredKey);
            }
            if status.as_u16() == 416 {
                return Err(Error::DownloadExpiredKey);
            }
            if !status.is_success() {
                return Err(Error::DownloadMirrorFailed {
                    message: format!("get.php answered {status}"),
                });
            }
            let content_type = response
                .headers()
                .get(wreq::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();
            if content_type.contains("html") || content_type.is_empty() {
                let body = response.text().await.map_err(|_| Error::Offline)?;
                if let Some(next) = extract_get_url(&body, &get_url)
                    && next != get_url
                {
                    get_url = next;
                    continue;
                }
                return Err(Error::DownloadMirrorFailed {
                    message: "get.php did not redirect to a file".to_owned(),
                });
            }
            // A streaming get.php: let the file client fetch it.
            return Ok(get_url);
        }
        Err(Error::DownloadMirrorFailed {
            message: "too many download redirects".to_owned(),
        })
    }

    async fn fetch_to_part(
        &self,
        download: &Download,
        url: &str,
        part: &Path,
        cancel: &AtomicBool,
    ) -> Result<()> {
        let mut existing = fs::metadata(part).map(|meta| meta.len()).unwrap_or(0);
        let mut request = self
            .file_client
            .get(url)
            .header(ACCEPT_ENCODING, "identity");
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let response = request.send().await.map_err(|_| Error::Offline)?;
        let status = response.status();
        if matches!(status.as_u16(), 401 | 403 | 404 | 410 | 416) {
            return Err(Error::DownloadExpiredKey);
        }
        if !(status.is_success() || status.as_u16() == 206) {
            return Err(Error::DownloadMirrorFailed {
                message: format!("file request answered {status}"),
            });
        }

        let content_range = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .map(parse_content_range);
        let total;
        if status.as_u16() == 206 {
            match content_range.flatten() {
                Some((start, length, full)) => {
                    if start != existing {
                        // The server ignored our offset; restart honestly.
                        existing = 0;
                        let _ = fs::remove_file(part);
                    }
                    total = full.unwrap_or(start + length);
                }
                None => {
                    return Err(Error::DownloadTruncated);
                }
            }
        } else {
            // A full response replaces any partial file. Without a declared
            // length we cannot distinguish a complete body from a truncated
            // one, so reject it rather than trusting the local file size.
            existing = 0;
            let Some(length) = response.content_length() else {
                return Err(Error::DownloadTruncated);
            };
            total = length;
        }

        self.service
            .update_download_progress(download.id, existing, Some(total))?;
        if existing > 0 && existing == total {
            return Ok(());
        }

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(existing > 0)
            .truncate(existing == 0)
            .open(part)
            .map_err(|error| Error::DownloadDisk {
                message: error.to_string(),
            })?;

        let mut written = existing;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::SeqCst) {
                return Ok(());
            }
            let chunk = chunk.map_err(|_| Error::DownloadTruncated)?;
            file.write_all(&chunk)
                .map_err(|error| Error::DownloadDisk {
                    message: error.to_string(),
                })?;
            written += chunk.len() as u64;
            self.service
                .update_download_progress(download.id, written, Some(total))?;
            if written > total {
                return Err(Error::DownloadTruncated);
            }
        }
        file.flush().map_err(|error| Error::DownloadDisk {
            message: error.to_string(),
        })?;
        drop(file);

        if written != total {
            return Err(Error::DownloadTruncated);
        }

        // Check the first bytes while they are still on our side of the fence.
        let mut head = [0u8; 8];
        let mut head_file = fs::File::open(part).map_err(|error| Error::DownloadDisk {
            message: error.to_string(),
        })?;
        let read = head_file.read(&mut head).unwrap_or(0);
        if let Err(error) = validate_magic(download.format, &head[..read]) {
            // Wrong magic means HTML, a parked page, or another book. Drop the
            // partial so a retry cannot append a clean file to garbage.
            let _ = fs::remove_file(part);
            return Err(error);
        }
        Ok(())
    }

    fn validate_magic(&self, format: BookFormat, bytes: &[u8]) -> Result<()> {
        validate_magic(format, bytes)
    }
}

fn message_for(error: &Error) -> String {
    match error {
        Error::DownloadMirrorFailed { .. } => {
            "Trying another mirror failed. Try again in a moment.".to_owned()
        }
        Error::DownloadExpiredKey => {
            "The download key expired. Retry to mint a new one.".to_owned()
        }
        Error::DownloadTruncated => {
            "The file arrived incomplete. Retry to resume where it stopped.".to_owned()
        }
        Error::DownloadWrongMagic { .. } => {
            "The mirror sent a file that is not the requested book.".to_owned()
        }
        Error::DownloadDisk { .. } => {
            "The book could not be written to the library folder.".to_owned()
        }
        Error::Offline => "The network is unavailable. Your shelf is unaffected.".to_owned(),
        other => other.to_string(),
    }
}

fn validate_magic(format: BookFormat, bytes: &[u8]) -> Result<()> {
    let matches = match format {
        BookFormat::Epub => bytes.starts_with(b"PK\x03\x04"),
        BookFormat::Pdf => bytes.starts_with(b"%PDF-"),
    };
    if matches {
        Ok(())
    } else {
        Err(Error::DownloadWrongMagic {
            format: match format {
                BookFormat::Epub => "EPUB".to_owned(),
                BookFormat::Pdf => "PDF".to_owned(),
            },
        })
    }
}

fn is_get_url(url: &str) -> bool {
    url.contains("get.php")
}

fn mirror_host(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown mirror".to_owned())
}

fn header(response: &wreq::Response, name: wreq::header::HeaderName) -> Result<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| Error::DownloadMirrorFailed {
            message: "the mirror omitted a redirect location".to_owned(),
        })
}

fn join_url(base: &str, next: &str) -> Result<String> {
    if let Ok(absolute) = Url::parse(next) {
        return Ok(absolute.to_string());
    }
    Url::parse(base)
        .and_then(|base| base.join(next))
        .map(|url| url.to_string())
        .map_err(|_| Error::DownloadMirrorFailed {
            message: format!("bad redirect target {next}"),
        })
}

fn extract_get_url(html: &str, base: &str) -> Option<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("a[href]").ok()?;
    for element in document.select(&selector) {
        let href = element.value().attr("href")?;
        if href.contains("get.php") && href.contains("md5=") {
            return join_url(base, href).ok();
        }
    }
    None
}

/// Parse `bytes 100-199/500` into `(start, length, total)`.
fn parse_content_range(value: &str) -> Option<(u64, u64, Option<u64>)> {
    let rest = value.trim().strip_prefix("bytes")?.trim();
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let start = start.trim().parse::<u64>().ok()?;
    let end = end.trim().parse::<u64>().ok()?;
    let total = if total.trim() == "*" {
        None
    } else {
        Some(total.trim().parse::<u64>().ok()?)
    };
    Some((start, end.saturating_sub(start) + 1, total))
}

/// `Author - Title (Year).ext`, with a placeholder when fields are missing.
pub fn proposed_filename(download: &Download) -> String {
    let author = download
        .authors
        .first()
        .map(|author| author.trim())
        .filter(|author| !author.is_empty())
        .unwrap_or("Unknown author");
    let title = download.title.trim();
    let title = if title.is_empty() { "Untitled" } else { title };
    let year = download
        .year
        .map(|year| format!(" ({year})"))
        .unwrap_or_default();
    let extension = match download.format {
        BookFormat::Epub => "epub",
        BookFormat::Pdf => "pdf",
    };
    let stem = sanitize(&format!("{author} - {title}{year}"));
    format!("{stem}.{extension}")
}

fn sanitize(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut last_space = false;
    for ch in value.chars() {
        let replacement = if ch.is_control()
            || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        {
            ' '
        } else {
            ch
        };
        if replacement == ' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        out.push(replacement);
        if out.chars().count() >= 160 {
            break;
        }
    }
    let trimmed = out.trim_matches(|ch: char| ch == ' ' || ch == '.');
    if trimmed.is_empty() {
        "Untitled".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Insert ` (2)`, ` (3)`… before the extension until the name is free.
pub fn unique_filename(existing: Vec<String>, proposed: &str) -> String {
    let taken: Vec<String> = existing
        .into_iter()
        .map(|name| name.trim().to_ascii_lowercase())
        .collect();
    if !taken.contains(&proposed.to_ascii_lowercase()) {
        return proposed.to_owned();
    }
    let (stem, extension) = proposed.rsplit_once('.').unwrap_or((proposed, ""));
    for number in 2..1000 {
        let candidate = if extension.is_empty() {
            format!("{stem} ({number})")
        } else {
            format!("{stem} ({number}).{extension}")
        };
        if !taken.contains(&candidate.to_ascii_lowercase()) {
            return candidate;
        }
    }
    proposed.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::DownloadState;

    #[test]
    fn filename_is_sanitised_and_year_is_optional() {
        let download = Download {
            id: 1,
            md5: "x".into(),
            title: "A/B: C?".into(),
            authors: vec!["Ada Lovelace".into()],
            year: Some(1843),
            format: BookFormat::Epub,
            source: "libgen.li".into(),
            mirror_urls: vec!["https://libgen.li/ads.php?md5=x".into()],
            state: DownloadState::Queued,
            mirror: None,
            bytes: 0,
            total_bytes: None,
            error: None,
            error_code: None,
            book_id: None,
            filename: None,
            created_at: 0,
            finished_at: None,
        };
        assert_eq!(
            proposed_filename(&download),
            "Ada Lovelace - A B C (1843).epub"
        );
    }

    #[test]
    fn collisions_get_a_number_before_the_extension() {
        assert_eq!(
            unique_filename(vec!["A - B (2020).epub".into()], "A - B (2020).epub"),
            "A - B (2020) (2).epub"
        );
        assert_eq!(
            unique_filename(
                vec!["a - b (2020).epub".into(), "A - B (2020) (2).epub".into()],
                "A - B (2020).epub"
            ),
            "A - B (2020) (3).epub"
        );
    }

    #[test]
    fn content_range_is_parsed() {
        assert_eq!(
            parse_content_range("bytes 100-199/500"),
            Some((100, 100, Some(500)))
        );
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((0, 10, None)));
    }
}
