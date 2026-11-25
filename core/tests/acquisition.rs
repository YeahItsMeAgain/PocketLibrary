//! Offline acquisition tests: fixtures, paging, filters, failover and the
//! typed command-API errors. No test touches the public internet.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use pocketlibrary_core::{Api, Error, LibgenProvider, SearchQuery};
use tempfile::TempDir;

const PAGE_ONE: &str = include_str!("fixtures/libgen-rock-paper-scissors.html");
const PAGE_TWO: &str = include_str!("fixtures/libgen-rock-paper-scissors-p2.html");

#[derive(Clone)]
enum Reply {
    Html(String),
    Status(u16),
}

struct FakeServer {
    base: String,
    host: String,
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
            // Keep the listener alive for any extra probe without answering.
            let _ = &listener;
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
            host: format!("127.0.0.1:{port}"),
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
    let request = String::from_utf8_lossy(&buffer).into_owned();
    seen.lock().expect("requests").push(request);

    let (status, body) = match reply {
        Reply::Html(body) => ("200 OK", body),
        Reply::Status(code) => (
            match code {
                503 => "503 Service Unavailable",
                403 => "403 Forbidden",
                _ => "500 Internal Server Error",
            },
            "unavailable".to_owned(),
        ),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

fn provider(mirrors: Vec<&FakeServer>) -> LibgenProvider {
    LibgenProvider::with_mirrors(mirrors.iter().map(|server| server.base.clone()).collect())
        .expect("provider")
}

fn rock_paper_scissors() -> SearchQuery {
    SearchQuery {
        title: "Rock Paper Scissors".into(),
        author: "Alice Feeney".into(),
        ..SearchQuery::default()
    }
}

fn database() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    (dir, path)
}

#[test]
fn parses_the_live_fixture_and_extracts_every_field() {
    let server = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let page = runtime
        .block_on(provider(vec![&server]).search(&rock_paper_scissors()))
        .expect("search");

    assert_eq!(page.total, 43);
    assert!(page.total_is_exact);
    assert_eq!(page.per_page, 25);
    assert_eq!(page.results.len(), 18, "only EPUB and PDF rows are offered");
    assert_eq!(page.source_mirror, server.host);
    assert!(
        page.results
            .iter()
            .all(|result| matches!(result.extension.as_str(), "epub" | "pdf"))
    );

    let flatiron = page
        .results
        .iter()
        .find(|result| result.md5 == "a1423442916f2f3def9517a3bf4dee48")
        .expect("the Flatiron EPUB");
    assert_eq!(flatiron.title, "Rock Paper Scissors");
    assert_eq!(flatiron.authors, vec!["Alice Feeney"]);
    assert_eq!(
        flatiron.publisher.as_deref(),
        Some("HarperCollins Publishers")
    );
    assert_eq!(flatiron.year, Some(2021));
    assert_eq!(flatiron.language.as_deref(), Some("English"));
    assert_eq!(flatiron.pages, Some(106));
    assert_eq!(flatiron.extension, "epub");
    assert_eq!(flatiron.size_text, "3 MB");
    assert_eq!(flatiron.size_bytes, Some(3_000_000));
    assert_eq!(flatiron.file_id, Some(98756682));
    assert!(flatiron.mirrors.iter().any(|mirror| {
        mirror
            .url
            .contains("ads.php?md5=a1423442916f2f3def9517a3bf4dee48")
    }));
    assert!(
        flatiron
            .mirrors
            .iter()
            .all(|mirror| !mirror.url.contains("annas")),
        "Anna's Archive must never be an acquisition path"
    );
}

#[test]
fn unsupported_formats_and_non_libgen_mirrors_are_dropped_at_parse_time() {
    let server = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let page = runtime
        .block_on(provider(vec![&server]).search(&rock_paper_scissors()))
        .expect("search");

    assert!(
        page.results
            .iter()
            .all(|result| matches!(result.extension.as_str(), "epub" | "pdf")),
        "mobi, azw3 and other formats never enter the download queue"
    );
    assert!(page.results.iter().all(|result| {
        result.mirrors.iter().all(|mirror| {
            mirror.url.contains("ads.php")
                && !mirror.url.contains("randombook")
                && !mirror.url.contains("libgen.pw")
                && !mirror.url.contains("libgen.me")
                && !mirror.url.contains("annas")
        })
    }));
}

#[test]
fn page_two_has_8_supported_rows_and_no_overlap() {
    let first = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let second = FakeServer::start(vec![Reply::Html(PAGE_TWO.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    let page_one = runtime
        .block_on(provider(vec![&first]).search(&rock_paper_scissors()))
        .expect("page one");
    let mut query = rock_paper_scissors();
    query.page = 2;
    let page_two = runtime
        .block_on(provider(vec![&second]).search(&query))
        .expect("page two");

    assert_eq!(page_one.results.len(), 18);
    assert_eq!(page_two.results.len(), 8);
    assert_eq!(page_two.total, 43);
    assert!(
        page_two
            .results
            .iter()
            .all(|row| { !page_one.results.iter().any(|other| other.md5 == row.md5) })
    );
    assert_eq!(
        second.requests()[0].lines().next(),
        Some(
            "GET /index.php?req=Rock+Paper+Scissors+Alice+Feeney&columns%5B%5D=t&columns%5B%5D=a&res=25&page=2 HTTP/1.1"
        )
    );
}

#[test]
fn client_filters_are_applied_after_parsing_with_honest_counts() {
    let server = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let query = SearchQuery {
        title: "Rock Paper Scissors".into(),
        author: "Alice Feeney".into(),
        format: "epub".into(),
        language: "en".into(),
        year_from: Some(2021),
        year_to: Some(2021),
        ..SearchQuery::default()
    };
    let page = runtime
        .block_on(provider(vec![&server]).search(&query))
        .expect("filtered search");

    assert_eq!(page.total, 43, "the mirror's unfiltered count");
    assert_eq!(page.on_page_before_filters, 18);
    assert!(page.filters_applied);
    assert!(!page.results.is_empty());
    assert!(page.results.len() < 18);
    assert!(page.results.iter().all(|row| {
        row.extension == "epub"
            && row.year == Some(2021)
            && row.language.as_deref() == Some("English")
    }));
}

#[test]
fn a_failed_mirror_fails_over_to_the_next_one() {
    let broken = FakeServer::start(vec![Reply::Status(503)]);
    let healthy = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let page = runtime
        .block_on(provider(vec![&broken, &healthy]).search(&rock_paper_scissors()))
        .expect("failover search");

    assert_eq!(page.results.len(), 18);
    assert!(!broken.requests().is_empty());
    assert!(!healthy.requests().is_empty());
    let broken_health = page
        .health
        .iter()
        .find(|health| health.host == broken.host)
        .expect("health entry");
    assert!(broken_health.failures > 0);
}

#[test]
fn all_mirrors_failing_is_a_typed_command_api_error() {
    let broken_one = FakeServer::start(vec![Reply::Status(503)]);
    let broken_two = FakeServer::start(vec![Reply::Status(403)]);
    let (_dir, path) = database();
    let provider = provider(vec![&broken_one, &broken_two]);
    let api = Api::open_with_search(&path, provider).expect("api");
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    let error = runtime
        .block_on(api.search_libgen(rock_paper_scissors()))
        .expect_err("every mirror failed");
    assert_eq!(error.code, "all_mirrors_failed");
    assert!(error.message.to_lowercase().contains("mirror"));
}

#[test]
fn a_genuine_no_results_page_is_not_a_mirror_failure() {
    let server = FakeServer::start(vec![Reply::Html(
        "<html><body><h2>No files found</h2></body></html>".to_owned(),
    )]);
    let (_dir, path) = database();
    let api = Api::open_with_search(&path, provider(vec![&server])).expect("api");
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    let page = runtime
        .block_on(api.search_libgen(rock_paper_scissors()))
        .expect("empty search succeeds");
    assert!(page.results.is_empty());
    assert_eq!(page.total, 0);
    assert_eq!(server.requests().len(), 1, "must not cycle dead mirrors");
}

#[test]
fn empty_query_is_rejected_before_any_request() {
    let server = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let (_dir, path) = database();
    let api = Api::open_with_search(&path, provider(vec![&server])).expect("api");
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    let error = runtime
        .block_on(api.search_libgen(SearchQuery::default()))
        .expect_err("empty query");
    assert_eq!(error.code, "empty_search");
    assert!(server.requests().is_empty());
}

#[test]
fn the_client_sends_browser_like_headers_for_cloudflare_mirrors() {
    let server = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    runtime
        .block_on(provider(vec![&server]).search(&rock_paper_scissors()))
        .expect("search");

    let request = server.requests()[0].to_ascii_lowercase();
    assert!(request.contains("chrome/"), "browser UA: {request}");
    assert!(
        request.contains("accept-language"),
        "browser headers: {request}"
    );
}

#[test]
fn slum_hint_prefers_a_tier_zero_mirror_over_a_down_one() {
    // Both mirrors answer, so only ordering decides which one is tried first.
    let down = FakeServer::start(vec![Reply::Html(PAGE_ONE.to_owned())]);
    let healthy = FakeServer::start(vec![Reply::Html(PAGE_TWO.to_owned())]);
    // Rewrite the snapshot so `down` is DOWN and `healthy` is UP. The URLs in
    // the fixture do not match our local ports, so use a generated snapshot.
    let down_host = down.base.trim_start_matches("http://");
    let healthy_host = healthy.base.trim_start_matches("http://");
    let snapshot = format!(
        r#"{{"generated_at":"2026-11-25T00:14:15Z","sites":[{{"id":"libgen","domains":[
            {{"url":"http://{down_host}","status":"DOWN","collecting":false,"last_check":{{"timestamp":"2026-11-25T00:13:19Z","body_contains_pass":false,"protection_type":null}}}},
            {{"url":"http://{healthy_host}","status":"UP","collecting":false,"last_check":{{"timestamp":"2026-11-25T00:13:19Z","body_contains_pass":true,"protection_type":null}}}}
        ]}}]}}"#
    );
    let status = FakeServer::start(vec![Reply::Html(snapshot)]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let provider = LibgenProvider::with_mirrors(vec![down.base.clone(), healthy.base.clone()])
        .expect("provider")
        .with_slum_url(format!("{}/status.json", status.base));
    runtime.block_on(provider.refresh_health_hint());
    let page = runtime
        .block_on(provider.search(&rock_paper_scissors()))
        .expect("search");

    assert_eq!(down.requests().len(), 0, "DOWN mirror is tried last");
    assert_eq!(healthy.requests().len(), 1);
    assert_eq!(page.results.len(), 8, "the healthy mirror answered first");
}

#[test]
fn parse_errors_are_typed_for_a_broken_mirror() {
    let broken = FakeServer::start(vec![Reply::Html("<html>parked</html>".to_owned())]);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let error = runtime
        .block_on(provider(vec![&broken]).search(&rock_paper_scissors()))
        .expect_err("not a search page");
    assert!(matches!(error, Error::MirrorFormatChanged { .. }));
}

/// Manual smoke test against the live LG+ mirrors. Ignored so CI stays offline.
/// Run with:
/// `cargo test --test acquisition live_search -- --ignored --nocapture`
#[test]
#[ignore = "network: run manually before a release"]
fn live_search_returns_the_acceptance_epub() {
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let provider = LibgenProvider::new().expect("provider");
    let page = runtime
        .block_on(provider.search(&rock_paper_scissors()))
        .expect("live search");
    println!(
        "{} results, total {}, from {}",
        page.results.len(),
        page.total,
        page.source_mirror
    );
    assert!(
        page.results
            .iter()
            .any(|result| result.md5 == "a1423442916f2f3def9517a3bf4dee48"),
        "expected the Flatiron EPUB in the first page"
    );
}
