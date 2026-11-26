//! Offline tests for the Open Library provider's request mapping.
//!
//! The real covers API changed: `/b/id/123-L.jpg` is served, but the old
//! `/b/id:123-L.jpg` form now returns 404. These tests drive the production
//! provider against a local fake server so the mapping cannot regress.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use pocketlibrary_core::{LookupRequest, MetadataProvider, OpenLibraryProvider};

#[derive(Clone)]
struct Reply {
    status: u16,
    reason: &'static str,
    content_type: &'static str,
    body: Vec<u8>,
}

impl Reply {
    fn json(body: &str) -> Self {
        Self {
            status: 200,
            reason: "OK",
            content_type: "application/json",
            body: body.as_bytes().to_vec(),
        }
    }

    fn image(body: &[u8]) -> Self {
        Self {
            status: 200,
            reason: "OK",
            content_type: "image/jpeg",
            body: body.to_vec(),
        }
    }

    fn not_found() -> Self {
        Self {
            status: 404,
            reason: "Not Found",
            content_type: "application/json",
            body: b"{\"error\":\"not found\"}".to_vec(),
        }
    }
}

struct FakeServer {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
}

impl FakeServer {
    fn start<F>(handler: F) -> Self
    where
        F: Fn(&str) -> Reply + Send + Sync + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake server");
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

    fn paths(&self) -> Vec<String> {
        self.requests.lock().expect("requests").clone()
    }
}

fn handle(
    mut stream: TcpStream,
    handler: Arc<dyn Fn(&str) -> Reply + Send + Sync>,
    seen: Arc<Mutex<Vec<String>>>,
) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
    let text = String::from_utf8_lossy(&buffer);
    let mut lines = text.lines();
    let path = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_owned();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    seen.lock().expect("requests").push(path.clone());

    let reply = handler(&path);
    let mut response = format!("HTTP/1.1 {} {}\r\n", reply.status, reply.reason);
    response.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
    response.push_str(&format!("Content-Type: {}\r\n", reply.content_type));
    response.push_str("Connection: close\r\n");
    if let Some(agent) = headers.get("user-agent") {
        response.push_str(&format!("X-Saw-User-Agent: {agent}\r\n"));
    }
    response.push_str("\r\n");
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(&reply.body);
    let _ = stream.flush();
}

fn provider(base: &str) -> OpenLibraryProvider {
    OpenLibraryProvider::with_bases(base, base, base).expect("provider")
}

#[test]
fn title_search_maps_cover_i_and_fetches_the_slashed_cover_path() {
    let search = r#"{"docs":[{"key":"/works/OL59863W","title":"The Dispossessed","author_name":["Ursula K. Le Guin"],"first_publish_year":1974,"cover_i":6979680,"edition_key":["OL60773020M"]}]}"#;
    let server = FakeServer::start(move |path| {
        if path.starts_with("/search.json?") {
            Reply::json(search)
        } else if path == "/b/id/6979680-L.jpg?default=false" {
            Reply::image(b"\xff\xd8\xff\xe0fake-jpeg")
        } else {
            Reply::not_found()
        }
    });
    let provider = provider(&server.base);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let candidates = runtime
        .block_on(provider.lookup(LookupRequest {
            isbn: None,
            edition_key: None,
            title: "The Dispossessed".to_owned(),
            authors: vec!["Ursula K. Le Guin".to_owned()],
            year: Some(1974),
        }))
        .expect("title lookup");
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].title, "The Dispossessed");
    assert_eq!(candidates[0].cover_keys, vec!["id:6979680"]);

    let bytes = runtime
        .block_on(provider.fetch_cover(candidates[0].cover_keys[0].clone()))
        .expect("fetch cover via id");
    assert!(bytes.starts_with(&[0xff, 0xd8]));
    assert!(
        server
            .paths()
            .iter()
            .any(|path| path == "/b/id/6979680-L.jpg?default=false"),
        "cover request paths were {:?}",
        server.paths()
    );
}

#[test]
fn isbn_and_olid_cover_keys_use_separate_path_segments() {
    let server = FakeServer::start(|path| match path {
        "/b/isbn/9780670839537-L.jpg?default=false" => Reply::image(b"\xff\xd8isbn"),
        "/b/olid/OL52963676M-L.jpg?default=false" => Reply::image(b"\xff\xd8olid"),
        _ => Reply::not_found(),
    });
    let provider = provider(&server.base);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");

    runtime
        .block_on(provider.fetch_cover("isbn:9780670839537".to_owned()))
        .expect("fetch cover via isbn");
    runtime
        .block_on(provider.fetch_cover("olid:OL52963676M".to_owned()))
        .expect("fetch cover via olid");

    let paths = server.paths();
    assert!(
        paths
            .iter()
            .any(|path| path == "/b/isbn/9780670839537-L.jpg?default=false"),
        "cover request paths were {paths:?}"
    );
    assert!(
        paths
            .iter()
            .any(|path| path == "/b/olid/OL52963676M-L.jpg?default=false"),
        "cover request paths were {paths:?}"
    );
}

#[test]
fn isbn_lookup_keeps_edition_cover_keys() {
    let edition = r#"{"key":"/books/OL52963676M","title":"Needful Things","covers":[14651900],"works":[{"key":"/works/OL81607W"}],"publishers":["Viking"],"publish_date":"1991"}"#;
    let server = FakeServer::start(move |path| {
        if path == "/isbn/9780670839537.json" {
            Reply::json(edition)
        } else {
            Reply::not_found()
        }
    });
    let provider = provider(&server.base);
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let candidates = runtime
        .block_on(provider.lookup(LookupRequest {
            isbn: Some("9780670839537".to_owned()),
            edition_key: None,
            title: String::new(),
            authors: Vec::new(),
            year: None,
        }))
        .expect("isbn lookup");
    assert_eq!(candidates.len(), 1);
    assert!(candidates[0]
        .cover_keys
        .contains(&"id:14651900".to_owned()));
    assert!(candidates[0]
        .cover_keys
        .contains(&"isbn:9780670839537".to_owned()));
}
