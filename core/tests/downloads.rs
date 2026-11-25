//! Offline download-queue tests against a fake HTTP mirror and a fake sink.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use pocketlibrary_core::{
    Api, BookFormat, Download, DownloadRequest, DownloadSink, DownloadState, LibgenProvider,
};
use tempfile::TempDir;

const EPUB: &[u8] = include_bytes!("../../test-assets/sample.epub");
const SCRIPTED_EPUB: &[u8] = include_bytes!("../../test-assets/scripted.epub");
const PDF: &[u8] = include_bytes!("../../test-assets/sample.pdf");

#[derive(Clone, Debug)]
struct TestRequest {
    request_line: String,
    path: String,
    headers: HashMap<String, String>,
}

impl TestRequest {
    fn range(&self) -> Option<&str> {
        self.headers.get("range").map(String::as_str)
    }
}

struct Reply {
    status: u16,
    reason: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    declared_length: Option<usize>,
    omit_length: bool,
}

impl Reply {
    fn html(body: &str) -> Self {
        Self {
            status: 200,
            reason: "OK",
            headers: vec![("Content-Type".into(), "text/html".into())],
            body: body.as_bytes().to_vec(),
            declared_length: None,
            omit_length: false,
        }
    }

    fn file(content_type: &str, body: &[u8]) -> Self {
        Self {
            status: 200,
            reason: "OK",
            headers: vec![("Content-Type".into(), content_type.into())],
            body: body.to_vec(),
            declared_length: None,
            omit_length: false,
        }
    }

    fn file_without_length(content_type: &str, body: &[u8]) -> Self {
        Self {
            status: 200,
            reason: "OK",
            headers: vec![("Content-Type".into(), content_type.into())],
            body: body.to_vec(),
            declared_length: None,
            omit_length: true,
        }
    }

    fn redirect(location: &str) -> Self {
        Self {
            status: 307,
            reason: "Temporary Redirect",
            headers: vec![("Location".into(), location.into())],
            body: Vec::new(),
            declared_length: None,
            omit_length: false,
        }
    }

    fn status(status: u16, reason: &'static str) -> Self {
        Self {
            status,
            reason,
            headers: Vec::new(),
            body: Vec::new(),
            declared_length: None,
            omit_length: false,
        }
    }

    fn partial(body: &[u8], start: usize, total: usize) -> Self {
        let end = start + body.len() - 1;
        Self {
            status: 206,
            reason: "Partial Content",
            headers: vec![
                ("Content-Type".into(), "application/epub+zip".into()),
                (
                    "Content-Range".into(),
                    format!("bytes {start}-{end}/{total}"),
                ),
            ],
            body: body.to_vec(),
            declared_length: None,
            omit_length: false,
        }
    }

    fn truncated(content_type: &str, body: &[u8], declared: usize) -> Self {
        Self {
            status: 200,
            reason: "OK",
            headers: vec![("Content-Type".into(), content_type.into())],
            body: body.to_vec(),
            declared_length: Some(declared),
            omit_length: false,
        }
    }
}

struct TestServer {
    base: String,
    requests: Arc<Mutex<Vec<TestRequest>>>,
}

impl TestServer {
    fn start<F>(handler: F) -> Self
    where
        F: Fn(TestRequest) -> Reply + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake mirror");
        let port = listener.local_addr().expect("address").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        let handler = Arc::new(handler);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let seen = Arc::clone(&seen);
                let handler = Arc::clone(&handler);
                thread::spawn(move || handle(stream, handler, seen));
            }
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
            requests,
        }
    }

    fn requests(&self) -> Vec<TestRequest> {
        self.requests.lock().expect("requests").clone()
    }

    fn paths(&self) -> Vec<String> {
        self.requests()
            .into_iter()
            .map(|request| request.path)
            .collect()
    }
}

fn handle(
    mut stream: TcpStream,
    handler: Arc<dyn Fn(TestRequest) -> Reply + Send + Sync>,
    seen: Arc<Mutex<Vec<TestRequest>>>,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
    let text = String::from_utf8_lossy(&buffer).into_owned();
    let mut lines = text.lines();
    let request_line = lines.next().unwrap_or_default().to_owned();
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    let request = TestRequest {
        request_line,
        path,
        headers,
    };
    seen.lock().expect("requests").push(request.clone());

    let reply = handler(request);
    let length = reply.declared_length.unwrap_or(reply.body.len());
    let mut response = format!("HTTP/1.1 {} {}\r\n", reply.status, reply.reason);
    if !reply.omit_length {
        response.push_str(&format!("Content-Length: {length}\r\n"));
    }
    response.push_str("Connection: close\r\n");
    for (name, value) in reply.headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    response.push_str("\r\n");
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(&reply.body);
    let _ = stream.flush();
}

#[derive(Default)]
struct FakeSink {
    files: Mutex<HashMap<String, Vec<u8>>>,
    writes: AtomicUsize,
    write_delay_ms: AtomicUsize,
}

impl FakeSink {
    fn with_file(name: &str, bytes: &[u8]) -> Self {
        let sink = Self::default();
        sink.files
            .lock()
            .expect("files")
            .insert(name.to_owned(), bytes.to_vec());
        sink
    }

    fn slow(&self, millis: usize) {
        self.write_delay_ms.store(millis, Ordering::SeqCst);
    }

    fn names(&self) -> Vec<String> {
        self.files.lock().expect("files").keys().cloned().collect()
    }

    fn file(&self, name: &str) -> Option<Vec<u8>> {
        self.files.lock().expect("files").get(name).cloned()
    }

    fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }
}

impl DownloadSink for FakeSink {
    fn list_root(&self) -> pocketlibrary_core::Result<Vec<String>> {
        Ok(self.names())
    }

    fn write_file(&self, name: &str, bytes: &[u8]) -> pocketlibrary_core::Result<()> {
        let delay = self.write_delay_ms.load(Ordering::SeqCst);
        if delay > 0 {
            thread::sleep(Duration::from_millis(delay as u64));
        }
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.files
            .lock()
            .expect("files")
            .insert(name.to_owned(), bytes.to_vec());
        Ok(())
    }
}

struct CancelOnWriteSink {
    inner: FakeSink,
    db: PathBuf,
    id: i64,
}

impl DownloadSink for CancelOnWriteSink {
    fn list_root(&self) -> pocketlibrary_core::Result<Vec<String>> {
        self.inner.list_root()
    }

    fn write_file(&self, name: &str, bytes: &[u8]) -> pocketlibrary_core::Result<()> {
        let api = Api::open(&self.db).expect("open cancelling API");
        api.cancel_download(self.id).expect("cancel during write");
        self.inner.write_file(name, bytes)
    }
}

fn database() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    (dir, path)
}

fn part_path(db: &Path, id: i64) -> PathBuf {
    db.parent()
        .expect("database parent")
        .join("downloads")
        .join(format!("{id}.part"))
}

fn api(path: &std::path::Path) -> Api {
    let provider =
        LibgenProvider::with_mirrors(vec!["http://127.0.0.1:1".into()]).expect("provider");
    Api::open_with_search(path, provider).expect("api")
}

fn request(server: &TestServer, md5: &str, format: BookFormat) -> DownloadRequest {
    DownloadRequest {
        md5: md5.to_owned(),
        title: "Rock Paper Scissors".into(),
        authors: vec!["Alice Feeney".into()],
        year: Some(2021),
        format,
        source: "libgen.li".into(),
        mirror_urls: vec![format!("{}/ads.php?md5={md5}", server.base)],
    }
}

fn run(api: &Api, sink: &dyn DownloadSink) {
    tokio::runtime::Runtime::new()
        .expect("runtime")
        .block_on(api.process_downloads(sink))
        .expect("process queue");
}

fn only_download(api: &Api) -> Download {
    let mut downloads = api.list_downloads().expect("list");
    assert_eq!(downloads.len(), 1, "one row");
    downloads.remove(0)
}

fn standard_mirror(server: &TestServer) -> String {
    format!("{}/ads.php?md5=abc", server.base)
}

#[test]
fn a_result_downloads_through_the_307_chain_and_lands_on_the_lowest_shelf() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();

    let mut download_request = request(&server, "abc", BookFormat::Epub);
    download_request.mirror_urls = vec![standard_mirror(&server)];
    let download = api.enqueue_download(download_request).expect("enqueue");
    assert_eq!(download.state, DownloadState::Queued);
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Completed);
    assert_eq!(
        download.filename.as_deref(),
        Some("Alice Feeney - Rock Paper Scissors (2021).epub")
    );
    assert!(download.book_id.is_some());
    assert_eq!(download.bytes, EPUB.len() as u64);

    let file = sink
        .file("Alice Feeney - Rock Paper Scissors (2021).epub")
        .expect("written file");
    assert_eq!(file, EPUB);

    let books = api.list_books().expect("books");
    assert_eq!(books.len(), 1);
    assert!(
        !books[0].title.is_empty(),
        "landed through metadata extraction"
    );
    let shelves = api.list_shelves().expect("shelves");
    assert_eq!(shelves[0].ordinal, 0);
    assert_eq!(books[0].shelf_id, Some(shelves[0].id));

    let paths = server.paths();
    assert!(paths.iter().any(|path| path.starts_with("/ads.php")));
    assert!(
        paths
            .iter()
            .any(|path| path.contains("get.php") && path.contains("key=k1"))
    );
    assert!(paths.iter().any(|path| path.contains("/cdn/book.epub")));
    let cdn = server
        .requests()
        .into_iter()
        .find(|request| request.path.contains("/cdn/book.epub"))
        .expect("cdn request");
    assert!(
        cdn.request_line.ends_with("HTTP/1.1"),
        "downloads are HTTP/1.1: {}",
        cdn.request_line
    );
}

#[test]
fn a_truncated_download_fails_then_resumes_with_range() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else if let Some(range) = request.range() {
            let start = range
                .strip_prefix("bytes=")
                .and_then(|value| value.strip_suffix('-'))
                .and_then(|value| value.parse::<usize>().ok())
                .expect("range start");
            Reply::partial(&EPUB[start..], start, EPUB.len())
        } else {
            Reply::truncated("application/epub+zip", &EPUB[..100], EPUB.len())
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();

    let download = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);
    let failed = only_download(&api);
    assert_eq!(failed.state, DownloadState::Failed);
    assert_eq!(failed.error_code.as_deref(), Some("truncated_file"));
    assert_eq!(failed.bytes, 100);
    assert!(sink.writes() == 0);

    api.retry_download(download.id).expect("retry");
    run(&api, &sink);
    let completed = only_download(&api);
    assert_eq!(completed.state, DownloadState::Completed);
    assert!(server.requests().iter().any(|request| {
        request.path.contains("/cdn/book.epub") && request.range() == Some("bytes=100-")
    }));
    assert_eq!(
        sink.file("Alice Feeney - Rock Paper Scissors (2021).epub"),
        Some(EPUB.to_vec())
    );
}

#[test]
fn cancel_keeps_the_partial_and_retry_resumes_with_range() {
    let entered = Arc::new((Mutex::new(false), Condvar::new()));
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let entered_handler = Arc::clone(&entered);
    let release_handler = Arc::clone(&release);
    let server = TestServer::start(move |request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            let (lock, ready) = &*entered_handler;
            *lock.lock().expect("entered") = true;
            ready.notify_all();
            let (lock, ready) = &*release_handler;
            let mut released = lock.lock().expect("release");
            while !*released {
                released = ready.wait(released).expect("release wait");
            }
            if let Some(range) = request.range() {
                let start = range
                    .strip_prefix("bytes=")
                    .and_then(|value| value.strip_suffix('-'))
                    .and_then(|value| value.parse::<usize>().ok())
                    .expect("range start");
                Reply::partial(&EPUB[start..], start, EPUB.len())
            } else {
                Reply::file("application/epub+zip", EPUB)
            }
        }
    });
    let (_dir, path) = database();
    let api = Arc::new(api(&path));
    let download = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    let part = part_path(&path, download.id);
    fs::create_dir_all(part.parent().expect("part parent")).expect("part dir");
    fs::write(&part, &EPUB[..100]).expect("seed partial");

    let worker_api = Arc::clone(&api);
    let worker = thread::spawn(move || {
        let sink = FakeSink::default();
        tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(worker_api.process_downloads(&sink))
            .expect("process queue");
    });

    let (lock, ready) = &*entered;
    let mut started = lock.lock().expect("entered");
    while !*started {
        started = ready.wait(started).expect("entered wait");
    }
    drop(started);
    api.cancel_download(download.id).expect("cancel");
    let (lock, ready) = &*release;
    *lock.lock().expect("release") = true;
    ready.notify_all();
    worker.join().expect("worker");

    assert_eq!(only_download(&api).state, DownloadState::Cancelled);
    assert_eq!(
        fs::metadata(&part).expect("partial survives cancel").len(),
        100
    );

    api.retry_download(download.id).expect("retry");
    let sink = FakeSink::default();
    run(&api, &sink);
    assert_eq!(only_download(&api).state, DownloadState::Completed);
    assert!(server.requests().iter().any(|request| {
        request.path.contains("/cdn/book.epub") && request.range() == Some("bytes=100-")
    }));
    assert_eq!(
        sink.file("Alice Feeney - Rock Paper Scissors (2021).epub"),
        Some(EPUB.to_vec())
    );
}

#[test]
fn a_truncated_file_is_rejected_without_writing_to_the_library() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::truncated("application/epub+zip", &EPUB[..200], EPUB.len())
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Failed);
    assert_eq!(download.error_code.as_deref(), Some("truncated_file"));
    assert_eq!(sink.writes(), 0);
}

#[test]
fn wrong_magic_bytes_are_rejected() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", b"this is not a zip")
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    let queued = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Failed);
    assert_eq!(download.error_code.as_deref(), Some("wrong_magic"));
    assert_eq!(sink.writes(), 0);
    assert!(
        !part_path(&path, queued.id).exists(),
        "a wrong-magic part must be deleted so a retry starts clean"
    );
}

#[test]
fn a_missing_content_length_is_rejected_as_truncated() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file_without_length("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Failed);
    assert_eq!(download.error_code.as_deref(), Some("truncated_file"));
    assert_eq!(sink.writes(), 0);
}

#[test]
fn an_expired_key_is_reminted_from_the_ads_page() {
    let ads = Arc::new(AtomicUsize::new(0));
    let ads_handler = Arc::clone(&ads);
    let server = TestServer::start(move |request| {
        if request.path.starts_with("/ads.php") {
            let mint = ads_handler.fetch_add(1, Ordering::SeqCst) + 1;
            Reply::html(&format!("<a href=\"/get.php?md5=abc&key=k{mint}\">GET</a>"))
        } else if request.path.starts_with("/get.php") {
            if request.path.contains("key=k1") {
                Reply::redirect("/cdn/k1")
            } else {
                Reply::redirect("/cdn/k2")
            }
        } else if request.path.starts_with("/cdn/k1") {
            Reply::status(403, "Forbidden")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Completed);
    assert_eq!(ads.load(Ordering::SeqCst), 2, "a fresh key was minted");
    assert!(server.paths().iter().any(|path| path.contains("/cdn/k2")));
}

#[test]
fn a_completed_md5_is_answered_from_history_without_fetching_again() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);
    let first = only_download(&api);
    let requests_before = server.requests().len();

    let duplicate = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue duplicate");
    assert_eq!(duplicate.state, DownloadState::Completed);
    assert_eq!(duplicate.error_code.as_deref(), Some("duplicate"));
    assert_eq!(duplicate.book_id, first.book_id);
    assert_eq!(
        server.requests().len(),
        requests_before,
        "pre-check touches no network"
    );
    assert_eq!(api.list_books().expect("books").len(), 1);
}

#[test]
fn identical_bytes_from_another_md5_are_discarded_after_the_blake3_check() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=other&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "first", BookFormat::Epub))
        .expect("enqueue first");
    run(&api, &sink);
    let first = only_download(&api);

    api.enqueue_download(request(&server, "other", BookFormat::Epub))
        .expect("enqueue second");
    run(&api, &sink);
    let downloads = api.list_downloads().expect("list");
    let second = downloads
        .iter()
        .find(|download| download.md5 == "other")
        .expect("second row");
    assert_eq!(second.state, DownloadState::Completed);
    assert_eq!(second.error_code.as_deref(), Some("duplicate"));
    assert_eq!(second.book_id, first.book_id);
    assert_eq!(
        sink.writes(),
        1,
        "the duplicate was never written to the folder"
    );
    assert_eq!(api.list_books().expect("books").len(), 1);
}

#[test]
fn queued_rows_survive_a_restart_and_still_run() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    {
        let api = api(&path);
        api.enqueue_download(request(&server, "abc", BookFormat::Epub))
            .expect("enqueue");
        assert_eq!(
            api.list_downloads().expect("list")[0].state,
            DownloadState::Queued
        );
    }

    let reopened = api(&path);
    let sink = FakeSink::default();
    run(&reopened, &sink);
    assert_eq!(only_download(&reopened).state, DownloadState::Completed);
}

#[test]
fn at_most_two_downloads_run_at_once() {
    let active = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let active_handler = Arc::clone(&active);
    let peak_handler = Arc::clone(&peak);
    let server = TestServer::start(move |request| {
        if request.path.starts_with("/ads.php") {
            let md5 = request.path.split("md5=").nth(1).unwrap_or("x");
            Reply::html(&format!("<a href=\"/get.php?md5={md5}&key=k\">GET</a>"))
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            let current = active_handler.fetch_add(1, Ordering::SeqCst) + 1;
            peak_handler.fetch_max(current, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(120));
            active_handler.fetch_sub(1, Ordering::SeqCst);
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    for md5 in ["one", "two", "three"] {
        api.enqueue_download(request(&server, md5, BookFormat::Epub))
            .expect("enqueue");
    }
    run(&api, &sink);

    assert_eq!(peak.load(Ordering::SeqCst), 2, "two concurrent downloads");
    let downloads = api.list_downloads().expect("list");
    assert_eq!(downloads.len(), 3);
    assert!(
        downloads
            .iter()
            .all(|download| download.state == DownloadState::Completed)
    );
}

#[test]
fn a_collision_gets_a_number_before_the_extension() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::with_file(
        "Alice Feeney - Rock Paper Scissors (2021).epub",
        b"an existing book",
    );
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(
        download.filename.as_deref(),
        Some("Alice Feeney - Rock Paper Scissors (2021) (2).epub")
    );
    assert!(
        sink.file("Alice Feeney - Rock Paper Scissors (2021) (2).epub")
            .is_some()
    );
}

#[test]
fn a_custom_naming_pattern_names_the_landed_file() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.set_download_naming("{title} [{author}] {year}")
        .expect("custom naming");
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(
        download.filename.as_deref(),
        Some("Rock Paper Scissors [Alice Feeney] 2021.epub")
    );
    assert!(
        sink.file("Rock Paper Scissors [Alice Feeney] 2021.epub")
            .is_some()
    );
}

#[test]
fn duplicate_rows_never_serialise_a_library_path() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=x&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "first", BookFormat::Epub))
        .expect("enqueue first");
    run(&api, &sink);
    let first = only_download(&api);
    let library_path = "/storage/emulated/0/Books/Private/Alice.epub";
    let conn = rusqlite::Connection::open(&path).expect("open database");
    conn.execute(
        "UPDATE books SET path = ?1 WHERE id = ?2",
        rusqlite::params![library_path, first.book_id],
    )
    .expect("set library path");
    conn.execute(
        "UPDATE downloads SET filename = ?1 WHERE id = ?2",
        rusqlite::params![library_path, first.id],
    )
    .expect("seed a legacy path row");

    api.enqueue_download(request(&server, "second", BookFormat::Epub))
        .expect("enqueue a second md5 with identical bytes");
    run(&api, &sink);
    let duplicate = api
        .list_downloads()
        .expect("list")
        .into_iter()
        .find(|download| download.md5 == "second")
        .expect("duplicate row");
    assert_eq!(duplicate.error_code.as_deref(), Some("duplicate"));
    assert_eq!(
        duplicate.filename, None,
        "a duplicate has no new file to name"
    );

    let json = serde_json::to_string(&api.list_downloads().expect("list")).expect("serialise");
    assert!(!json.contains("Private"), "no library path in {json}");
    assert!(
        !json.contains("storage/emulated"),
        "no library path in {json}"
    );
    for download in api.list_downloads().expect("list") {
        if let Some(filename) = download.filename {
            assert!(
                !filename.contains('/') && !filename.contains('\\'),
                "filename leaks a path separator: {filename}"
            );
        }
    }
}

#[test]
fn a_second_book_lands_on_the_next_shelf_when_the_first_is_full() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            let md5 = request.path.split("md5=").nth(1).unwrap_or("x");
            Reply::html(&format!("<a href=\"/get.php?md5={md5}&key=k\">GET</a>"))
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book")
        } else if request.path.contains("pdf") {
            Reply::file("application/pdf", PDF)
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    api.set_shelf_capacity(1).expect("capacity");
    let sink = FakeSink::default();

    // The fake mirror serves EPUB for both md5s; use a PDF-only mirror path
    // for the second result so the bytes differ.
    api.enqueue_download(request(&server, "epub", BookFormat::Epub))
        .expect("enqueue epub");
    run(&api, &sink);
    let mut pdf_request = request(&server, "pdf", BookFormat::Pdf);
    // Point the second download at a PDF-specific CDN path.
    let pdf_server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=pdf&key=k\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/pdf")
        } else {
            Reply::file("application/pdf", PDF)
        }
    });
    pdf_request.mirror_urls = vec![format!("{}/ads.php?md5=pdf", pdf_server.base)];
    api.enqueue_download(pdf_request).expect("enqueue pdf");
    run(&api, &sink);

    let books = api.list_books().expect("books");
    assert_eq!(books.len(), 2);
    let mut ordinals: Vec<i64> = books
        .iter()
        .map(|book| {
            api.list_shelves()
                .expect("shelves")
                .into_iter()
                .find(|shelf| Some(shelf.id) == book.shelf_id)
                .expect("shelf")
                .ordinal
        })
        .collect();
    ordinals.sort();
    assert_eq!(ordinals, vec![0, 1]);
}

#[test]
fn a_broken_download_mirror_fails_over_to_the_next_one() {
    let broken = TestServer::start(|_request| Reply::status(503, "Service Unavailable"));
    let healthy = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    let mut download_request = request(&healthy, "abc", BookFormat::Epub);
    download_request.mirror_urls = vec![
        format!("{}/ads.php?md5=abc", broken.base),
        format!("{}/ads.php?md5=abc", healthy.base),
    ];
    api.enqueue_download(download_request).expect("enqueue");
    run(&api, &sink);

    assert_eq!(only_download(&api).state, DownloadState::Completed);
    assert!(!broken.requests().is_empty(), "the first mirror was tried");
    assert!(
        !healthy.requests().is_empty(),
        "the second mirror served it"
    );
    let download = only_download(&api);
    assert_eq!(
        download.mirror.as_deref(),
        healthy.base.trim_start_matches("http://").split(':').next(),
        "the row remembers the mirror that served it"
    );
}

#[test]
fn failover_exposes_a_transient_reason_and_the_mirror_in_use() {
    let entered = Arc::new((Mutex::new(false), Condvar::new()));
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let entered_handler = Arc::clone(&entered);
    let release_handler = Arc::clone(&release);
    let broken = TestServer::start(|_request| Reply::status(503, "Service Unavailable"));
    let healthy = TestServer::start(move |request| {
        if request.path.starts_with("/ads.php") {
            let (lock, ready) = &*entered_handler;
            *lock.lock().expect("entered") = true;
            ready.notify_all();
            let (lock, ready) = &*release_handler;
            let mut released = lock.lock().expect("release");
            while !*released {
                released = ready.wait(released).expect("release wait");
            }
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = Arc::new(api(&path));
    let mut download_request = request(&healthy, "abc", BookFormat::Epub);
    download_request.mirror_urls = vec![
        format!("{}/ads.php?md5=abc", broken.base),
        format!("{}/ads.php?md5=abc", healthy.base),
    ];
    let download = api.enqueue_download(download_request).expect("enqueue");

    let worker_api = Arc::clone(&api);
    let worker = thread::spawn(move || {
        let sink = FakeSink::default();
        tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(worker_api.process_downloads(&sink))
            .expect("process queue");
    });

    let (lock, ready) = &*entered;
    let mut started = lock.lock().expect("entered");
    while !*started {
        started = ready.wait(started).expect("entered wait");
    }
    drop(started);
    let row = api
        .list_downloads()
        .expect("list")
        .into_iter()
        .find(|row| row.id == download.id)
        .expect("row");
    assert_eq!(row.state, DownloadState::Running);
    assert_eq!(row.error.as_deref(), Some("Trying another mirror…"));
    assert_eq!(
        row.mirror.as_deref(),
        healthy.base.trim_start_matches("http://").split(':').next()
    );

    let (lock, ready) = &*release;
    *lock.lock().expect("release") = true;
    ready.notify_all();
    worker.join().expect("worker");
    assert_eq!(only_download(&api).state, DownloadState::Completed);
}

#[test]
fn a_mirror_that_fails_mid_file_is_replaced_by_a_fresh_mint() {
    let first = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=first\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/missing")
        } else {
            Reply::status(503, "Service Unavailable")
        }
    });
    let second = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=second\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    let mut download_request = request(&second, "abc", BookFormat::Epub);
    download_request.mirror_urls = vec![
        format!("{}/ads.php?md5=abc", first.base),
        format!("{}/ads.php?md5=abc", second.base),
    ];
    api.enqueue_download(download_request).expect("enqueue");
    run(&api, &sink);

    assert_eq!(only_download(&api).state, DownloadState::Completed);
    assert!(
        first.paths().iter().any(|path| path.contains("key=first")),
        "the first mirror minted its own key"
    );
    assert!(
        second
            .paths()
            .iter()
            .any(|path| path.contains("key=second")),
        "the second mirror was asked for a fresh key"
    );
    assert_eq!(
        sink.file("Alice Feeney - Rock Paper Scissors (2021).epub"),
        Some(EPUB.to_vec())
    );
}

#[test]
fn concurrent_downloads_with_the_same_name_get_distinct_files() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            let md5 = request
                .path
                .split("md5=")
                .nth(1)
                .unwrap_or("x")
                .split('&')
                .next()
                .unwrap_or("x");
            Reply::html(&format!("<a href=\"/get.php?md5={md5}&key=k\">GET</a>"))
        } else if request.path.starts_with("/get.php") {
            let md5 = request
                .path
                .split("md5=")
                .nth(1)
                .unwrap_or("x")
                .split('&')
                .next()
                .unwrap_or("x");
            Reply::redirect(&format!("/cdn/{md5}"))
        } else if request.path.contains("/cdn/one") {
            Reply::file("application/epub+zip", EPUB)
        } else {
            Reply::file("application/epub+zip", SCRIPTED_EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    sink.slow(150);
    api.enqueue_download(request(&server, "one", BookFormat::Epub))
        .expect("enqueue first");
    api.enqueue_download(request(&server, "two", BookFormat::Epub))
        .expect("enqueue second");
    run(&api, &sink);

    let downloads = api.list_downloads().expect("list");
    assert_eq!(downloads.len(), 2);
    assert!(
        downloads
            .iter()
            .all(|download| download.state == DownloadState::Completed)
    );
    let mut names = sink.names();
    names.sort();
    assert_eq!(
        names,
        vec![
            "Alice Feeney - Rock Paper Scissors (2021) (2).epub".to_owned(),
            "Alice Feeney - Rock Paper Scissors (2021).epub".to_owned(),
        ]
    );
}

#[test]
fn a_mirror_that_fails_once_then_serves_the_file_completes_without_a_manual_retry() {
    let ads_attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&ads_attempts);
    let server = TestServer::start(move |request| {
        if request.path.starts_with("/ads.php") {
            if counter.fetch_add(1, Ordering::SeqCst) == 0 {
                Reply::status(500, "Internal Server Error")
            } else {
                Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
            }
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    api.enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Completed);
    assert!(
        ads_attempts.load(Ordering::SeqCst) >= 2,
        "the transient 500 was retried"
    );
    assert_eq!(
        sink.file("Alice Feeney - Rock Paper Scissors (2021).epub"),
        Some(EPUB.to_vec())
    );
}

#[test]
fn exhausting_every_mirror_on_every_pass_still_fails_with_the_existing_message() {
    let first_attempts = Arc::new(AtomicUsize::new(0));
    let second_attempts = Arc::new(AtomicUsize::new(0));
    let first_counter = Arc::clone(&first_attempts);
    let second_counter = Arc::clone(&second_attempts);
    let first = TestServer::start(move |_request| {
        first_counter.fetch_add(1, Ordering::SeqCst);
        Reply::status(500, "Internal Server Error")
    });
    let second = TestServer::start(move |_request| {
        second_counter.fetch_add(1, Ordering::SeqCst);
        Reply::status(503, "Service Unavailable")
    });
    let (_dir, path) = database();
    let api = api(&path);
    let sink = FakeSink::default();
    let mut download_request = request(&first, "abc", BookFormat::Epub);
    download_request.mirror_urls = vec![
        format!("{}/ads.php?md5=abc", first.base),
        format!("{}/ads.php?md5=abc", second.base),
    ];
    api.enqueue_download(download_request).expect("enqueue");
    run(&api, &sink);

    let download = only_download(&api);
    assert_eq!(download.state, DownloadState::Failed);
    assert_eq!(download.error_code.as_deref(), Some("mirror_failed"));
    assert_eq!(
        download.error.as_deref(),
        Some("Trying another mirror failed. Try again in a moment.")
    );
    assert!(
        first_attempts.load(Ordering::SeqCst) >= 2,
        "the first mirror was included in another pass"
    );
    assert!(
        second_attempts.load(Ordering::SeqCst) >= 2,
        "the second mirror was included in another pass"
    );
}

#[test]
fn cancelling_while_waiting_to_retry_stops_promptly_without_another_request() {
    let seen = Arc::new((Mutex::new(false), Condvar::new()));
    let seen_handler = Arc::clone(&seen);
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&attempts);
    let server = TestServer::start(move |_request| {
        counter.fetch_add(1, Ordering::SeqCst);
        let (lock, ready) = &*seen_handler;
        *lock.lock().expect("seen") = true;
        ready.notify_all();
        Reply::status(500, "Internal Server Error")
    });
    let (_dir, path) = database();
    let api = Arc::new(api(&path));
    let download = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");

    let worker_api = Arc::clone(&api);
    let worker = thread::spawn(move || {
        let sink = FakeSink::default();
        tokio::runtime::Runtime::new()
            .expect("runtime")
            .block_on(worker_api.process_downloads(&sink))
            .expect("process queue");
    });

    let (lock, ready) = &*seen;
    let mut started = lock.lock().expect("seen");
    while !*started {
        started = ready.wait(started).expect("seen wait");
    }
    drop(started);
    let cancelled_at = std::time::Instant::now();
    api.cancel_download(download.id).expect("cancel");
    worker.join().expect("worker");

    assert!(
        cancelled_at.elapsed() < Duration::from_millis(150),
        "cancellation waited out the retry backoff"
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 1, "no retry pass ran");
    assert_eq!(only_download(&api).state, DownloadState::Cancelled);
}

#[test]
fn a_cancelled_row_is_not_overwritten_by_a_late_completion() {
    let server = TestServer::start(|request| {
        if request.path.starts_with("/ads.php") {
            Reply::html("<a href=\"/get.php?md5=abc&key=k1\">GET</a>")
        } else if request.path.starts_with("/get.php") {
            Reply::redirect("/cdn/book.epub")
        } else {
            Reply::file("application/epub+zip", EPUB)
        }
    });
    let (_dir, path) = database();
    let api = api(&path);
    let download = api
        .enqueue_download(request(&server, "abc", BookFormat::Epub))
        .expect("enqueue");
    let sink = CancelOnWriteSink {
        inner: FakeSink::default(),
        db: path.clone(),
        id: download.id,
    };
    run(&api, &sink);

    assert_eq!(only_download(&api).state, DownloadState::Cancelled);
}
