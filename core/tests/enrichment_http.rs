//! HTTP seam tests for the production Open Library provider.
//!
//! A local TCP server stands in for Open Library, its covers CDN and the
//! Internet Archive. No test touches the public internet.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use pocketlibrary_core::{
    MetadataProvider, OpenLibraryProvider, ProviderErrorKind, ProviderSupplement,
};

#[derive(Clone)]
struct Reply {
    status: u16,
    content_type: Option<String>,
    body: Vec<u8>,
    extra_headers: Vec<(String, String)>,
    content_length: Option<usize>,
}

impl Reply {
    fn json(body: &str) -> Self {
        Self {
            status: 200,
            content_type: Some("application/json".to_owned()),
            body: body.as_bytes().to_vec(),
            extra_headers: Vec::new(),
            content_length: None,
        }
    }

    fn status(code: u16) -> Self {
        Self {
            status: code,
            content_type: Some("text/plain".to_owned()),
            body: b"nope".to_vec(),
            extra_headers: Vec::new(),
            content_length: None,
        }
    }

    fn bytes(content_type: &str, body: Vec<u8>) -> Self {
        Self {
            status: 200,
            content_type: Some(content_type.to_owned()),
            body,
            extra_headers: Vec::new(),
            content_length: None,
        }
    }

    fn with_header(mut self, name: &str, value: &str) -> Self {
        self.extra_headers.push((name.to_owned(), value.to_owned()));
        self
    }
}

struct FakeServer {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
}

impl FakeServer {
    fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake server");
        let port = listener.local_addr().expect("address").port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        thread::spawn(move || {
            for reply in replies {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                handle(stream, reply, &seen);
            }
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
            requests,
        }
    }

    fn requests(&self) -> Vec<String> {
        self.requests.lock().expect("requests").clone()
    }
}

fn handle(mut stream: TcpStream, reply: Reply, seen: &Arc<Mutex<Vec<String>>>) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
    seen.lock()
        .expect("requests")
        .push(String::from_utf8_lossy(&buffer).into_owned());

    let reason = match reply.status {
        200 => "OK",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "Status",
    };
    let length = reply.content_length.unwrap_or(reply.body.len());
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        reply.status, reason, length
    );
    if let Some(content_type) = reply.content_type {
        headers.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    for (name, value) in reply.extra_headers {
        headers.push_str(&format!("{name}: {value}\r\n"));
    }
    headers.push_str("\r\n");
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(&reply.body);
    let _ = stream.flush();
}

fn provider(server: &FakeServer) -> OpenLibraryProvider {
    OpenLibraryProvider::with_bases(&server.base, &server.base, &server.base)
        .expect("provider")
        .with_user_agent("PocketLibrary/test (+https://example.invalid)")
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
}

const EDITION_JSON: &str = r#"{
  "key": "/books/OL1397864M",
  "title": "Zen speaks",
  "by_statement": "by William Shakespeare",
  "publishers": ["Harper & Row"],
  "publish_date": "1974",
  "covers": [240726],
  "description": {"value": "<p>A quiet <b>revolution</b>.</p>"},
  "works": [{"key": "/works/OL1866073W"}],
  "ocaid": "zenspeaksshoutso0000caiz"
}"#;

#[test]
fn an_isbn_lookup_reads_the_edition_and_identifies_the_app() {
    let server = FakeServer::start(vec![Reply::json(EDITION_JSON)]);
    let provider = provider(&server);
    let request = pocketlibrary_core::LookupRequest {
        isbn: Some("9780306406157".to_owned()),
        ..Default::default()
    };
    let candidates = runtime()
        .block_on(provider.lookup(request))
        .expect("lookup");
    assert_eq!(candidates.len(), 1);
    let candidate = &candidates[0];
    assert_eq!(candidate.title, "Zen speaks");
    assert_eq!(candidate.authors, vec!["by William Shakespeare"]);
    assert_eq!(candidate.year, Some(1974));
    assert_eq!(candidate.publisher.as_deref(), Some("Harper & Row"));
    assert!(candidate.cover_keys.contains(&"id:240726".to_owned()));
    assert!(
        candidate
            .cover_keys
            .contains(&"isbn:9780306406157".to_owned())
    );
    assert_eq!(candidate.ocaid.as_deref(), Some("zenspeaksshoutso0000caiz"));
    let requests = server.requests();
    assert!(requests[0].starts_with("GET /isbn/9780306406157.json"));
    assert!(
        requests[0]
            .to_ascii_lowercase()
            .contains("user-agent: pocketlibrary/test"),
        "the app identifies itself: {}",
        requests[0]
    );
}

#[test]
fn a_title_search_uses_one_narrow_search_request() {
    let server = FakeServer::start(vec![Reply::json(
        r#"{"docs":[{
            "key": "/works/OL8052318W",
            "title": "Zen speaks",
            "author_name": ["William Shakespeare"],
            "first_publish_year": 1974,
            "publisher": ["Harper & Row"],
            "cover_i": 240727,
            "edition_key": ["OL7440033M"]
        }]}"#,
    )]);
    let provider = provider(&server);
    let request = pocketlibrary_core::LookupRequest {
        title: "Zen speaks".to_owned(),
        authors: vec!["William Shakespeare".to_owned()],
        year: Some(1974),
        ..Default::default()
    };
    let candidates = runtime()
        .block_on(provider.lookup(request))
        .expect("lookup");
    assert_eq!(candidates.len(), 1);
    assert_eq!(
        candidates[0].edition_key.as_deref(),
        Some("open_library:/books/OL7440033M")
    );
    assert!(candidates[0].cover_keys.contains(&"id:240727".to_owned()));
    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].contains("/search.json?"));
    assert!(requests[0].contains("fields="));
}

#[test]
fn a_rate_limit_surfaces_retry_after_without_retrying_the_provider() {
    let server = FakeServer::start(vec![Reply::status(429).with_header("Retry-After", "9")]);
    let provider = provider(&server);
    let request = pocketlibrary_core::LookupRequest {
        isbn: Some("9780306406157".to_owned()),
        ..Default::default()
    };
    let error = runtime()
        .block_on(provider.lookup(request))
        .expect_err("429 is an error");
    assert_eq!(error.kind, ProviderErrorKind::RateLimited);
    assert_eq!(error.retry_after_seconds, Some(9));
    assert_eq!(
        server.requests().len(),
        1,
        "the provider itself does not retry"
    );
}

#[test]
fn a_malformed_record_is_a_typed_error() {
    let server = FakeServer::start(vec![Reply::json("{ not json")]);
    let provider = provider(&server);
    let request = pocketlibrary_core::LookupRequest {
        isbn: Some("9780306406157".to_owned()),
        ..Default::default()
    };
    let error = runtime()
        .block_on(provider.lookup(request))
        .expect_err("malformed JSON");
    assert_eq!(error.kind, ProviderErrorKind::Malformed);
}

#[test]
fn an_html_error_page_is_not_accepted_as_json() {
    let server = FakeServer::start(vec![Reply {
        status: 200,
        content_type: Some("text/html; charset=utf-8".to_owned()),
        body: b"<html>not a record</html>".to_vec(),
        extra_headers: Vec::new(),
        content_length: None,
    }]);
    let provider = provider(&server);
    let request = pocketlibrary_core::LookupRequest {
        isbn: Some("9780306406157".to_owned()),
        ..Default::default()
    };
    let error = runtime()
        .block_on(provider.lookup(request))
        .expect_err("wrong content type");
    assert_eq!(error.kind, ProviderErrorKind::BadContentType);
}

#[test]
fn a_cover_with_the_wrong_content_type_is_refused_before_decode() {
    let server = FakeServer::start(vec![Reply::bytes(
        "text/html",
        b"<html>not an image</html>".to_vec(),
    )]);
    let provider = provider(&server);
    let error = runtime()
        .block_on(provider.fetch_cover("id:240726".to_owned()))
        .expect_err("html is not a cover");
    assert_eq!(error.kind, ProviderErrorKind::BadContentType);
}

#[test]
fn an_oversized_cover_is_refused_from_its_content_length() {
    let body = vec![0u8; 8];
    let server = FakeServer::start(vec![Reply {
        status: 200,
        content_type: Some("image/jpeg".to_owned()),
        body,
        extra_headers: Vec::new(),
        content_length: Some(4 * 1024 * 1024),
    }]);
    let provider = provider(&server);
    let error = runtime()
        .block_on(provider.fetch_cover("id:240726".to_owned()))
        .expect_err("oversized");
    assert_eq!(error.kind, ProviderErrorKind::TooLarge);
}

#[test]
fn the_internet_archive_supplement_respects_access_restrictions() {
    let server = FakeServer::start(vec![Reply::json(
        r#"{
            "metadata": {},
            "description": ["Line one", "Line two"],
            "access-restricted-item": true
        }"#,
    )]);
    let provider = provider(&server);
    let supplement = runtime()
        .block_on(provider.supplement("zenspeaksshoutso0000caiz".to_owned()))
        .expect("supplement");
    assert!(supplement.access_restricted);
    assert_eq!(
        supplement.description.as_deref(),
        Some("Line one\nLine two")
    );
    assert_eq!(
        supplement.cover_keys,
        vec!["ia:zenspeaksshoutso0000caiz".to_owned()]
    );
    assert_eq!(
        supplement.source_url,
        "https://archive.org/details/zenspeaksshoutso0000caiz"
    );
}

#[test]
fn a_500_is_retryable_but_a_404_is_not() {
    let retryable = pocketlibrary_core::ProviderError::status(503, None);
    assert!(retryable.retryable());
    let permanent = pocketlibrary_core::ProviderError::status(404, None);
    assert!(!permanent.retryable());
    let _ = Duration::ZERO;
    let _ = ProviderSupplement::default();
}
