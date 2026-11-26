//! Command-level enrichment and cover-chooser tests with a fake provider.
//! No test touches the public internet.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use common::{FakeDir, epub_with, needful_things_pdf, png_cover};
use futures_util::future::BoxFuture;
use pocketlibrary_core::{
    Api, CoverSource, EnrichmentMode, EnrichmentOutcome, MetadataProvider,
    ProviderCandidate, ProviderError, ProviderErrorKind, ProviderResult, ProviderSupplement,
};
use tempfile::TempDir;

#[derive(Default)]
struct FakeProvider {
    candidates: Mutex<Vec<ProviderCandidate>>,
    requests: Mutex<Vec<String>>,
    cover_requests: Mutex<Vec<String>>,
    cover: Mutex<Vec<u8>>,
    failure: Mutex<Option<ProviderError>>,
    transient_failures: AtomicUsize,
    supplement: Mutex<Option<ProviderSupplement>>,
    lookup_delay_ms: AtomicUsize,
}

impl FakeProvider {
    fn with_candidate(candidate: ProviderCandidate) -> Arc<Self> {
        Arc::new(Self {
            candidates: Mutex::new(vec![candidate]),
            cover: Mutex::new(portrait_cover()),
            ..Self::default()
        })
    }

    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    fn set_failure(&self, error: ProviderError) {
        *self.failure.lock().unwrap() = Some(error);
    }

    fn set_transient(&self, count: usize) {
        self.transient_failures.store(count, Ordering::SeqCst);
    }

    fn cover_requests(&self) -> Vec<String> {
        self.cover_requests.lock().unwrap().clone()
    }

    fn set_lookup_delay(&self, millis: usize) {
        self.lookup_delay_ms.store(millis, Ordering::SeqCst);
    }
}

impl MetadataProvider for FakeProvider {
    fn lookup<'a>(
        &'a self,
        request: pocketlibrary_core::LookupRequest,
    ) -> BoxFuture<'a, ProviderResult<Vec<ProviderCandidate>>> {
        self.requests.lock().unwrap().push(format!("{request:?}"));
        Box::pin(async move {
            let delay = self.lookup_delay_ms.load(Ordering::SeqCst);
            if delay > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(delay as u64)).await;
            }
            if self.transient_failures.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok() {
                return Err(ProviderError {
                    kind: ProviderErrorKind::Status(503),
                    retry_after_seconds: None,
                });
            }
            if let Some(error) = self.failure.lock().unwrap().clone() {
                return Err(error);
            }
            Ok(self.candidates.lock().unwrap().clone())
        })
    }

    fn fetch_cover<'a>(&'a self, key: String) -> BoxFuture<'a, ProviderResult<Vec<u8>>> {
        self.cover_requests.lock().unwrap().push(key);
        Box::pin(async move { Ok(self.cover.lock().unwrap().clone()) })
    }

    fn supplement<'a>(&'a self, _ocaid: String) -> BoxFuture<'a, ProviderResult<ProviderSupplement>> {
        Box::pin(async move {
            Ok(self
                .supplement
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_default())
        })
    }
}

fn portrait_cover() -> Vec<u8> {
    png_cover(500, 750)
}

fn candidate(title: &str, authors: &[&str]) -> ProviderCandidate {
    ProviderCandidate {
        key: format!("open_library:/books/OL{title}M"),
        source: "open_library".to_owned(),
        edition_key: Some(format!("open_library:/books/OL{title}M")),
        title: title.to_owned(),
        authors: authors.iter().map(|value| (*value).to_owned()).collect(),
        year: Some(1974),
        publisher: Some("Harper & Row".to_owned()),
        description: Some("<p>A quiet <b>revolution</b>.</p>".to_owned()),
        cover_keys: vec!["id:123".to_owned()],
        source_url: format!("https://openlibrary.org/books/OL{title}M"),
        ..ProviderCandidate::default()
    }
}

fn database_with_provider(provider: Arc<FakeProvider>) -> (TempDir, Api) {
    let dir = TempDir::new().expect("temporary directory");
    let path = dir.path().join("library.db");
    let api = Api::open_with_enrichment(&path, provider).expect("open catalog");
    (dir, api)
}

fn add_book(
    api: &Api,
    path: &str,
    metadata: &[String],
    cover: Option<&[u8]>,
) -> pocketlibrary_core::Book {
    let source = FakeDir::new().file_with(path, epub_with(path, metadata, cover));
    api.scan(&source).expect("scan");
    api.list_books().expect("list books").remove(0)
}

fn add_pdf_book(api: &Api, path: &str, bytes: Vec<u8>) -> pocketlibrary_core::Book {
    let source = FakeDir::new().file_with(path, bytes);
    api.scan(&source).expect("scan pdf");
    api.list_books().expect("list books").remove(0)
}

fn needful_things_candidate() -> ProviderCandidate {
    ProviderCandidate {
        key: "open_library:/books/OL52963676M".to_owned(),
        source: "open_library".to_owned(),
        edition_key: Some("open_library:/books/OL52963676M".to_owned()),
        title: "Needful Things".to_owned(),
        // The real `/isbn/9780670839537.json` edition record has no author
        // names, only work and author links.
        authors: Vec::new(),
        year: Some(1991),
        publisher: Some("Viking".to_owned()),
        description: Some("<p>A newcomer opens a shop in Castle Rock.</p>".to_owned()),
        cover_keys: vec![
            "id:14651900".to_owned(),
            "isbn:9780670839537".to_owned(),
            "olid:OL52963676M".to_owned(),
        ],
        source_url: "https://openlibrary.org/books/OL52963676M".to_owned(),
        ..ProviderCandidate::default()
    }
}

fn basic_metadata(title: &str, author: &str, year: &str) -> Vec<String> {
    vec![
        format!("<dc:title>{title}</dc:title>"),
        format!("<dc:creator>{author}</dc:creator>"),
        format!("<dc:date>{year}</dc:date>"),
    ]
}

#[test]
fn offline_details_make_zero_provider_calls() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let settings = api.enrichment_settings().expect("settings");
    assert_eq!(settings.mode, EnrichmentMode::Off);
    assert!(provider.requests().is_empty(), "opening a library must not call a provider");
    assert!(book.description.is_none());
}

#[test]
fn a_high_confidence_match_fills_only_missing_blurb_and_cover() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Applied { fields, .. } => {
            assert_eq!(fields, vec!["description", "cover"]);
        }
        other => panic!("expected applied, got {other:?}"),
    }

    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(
        detail.book.description.as_deref(),
        Some("A quiet revolution.")
    );
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.enrichment.has_file_cover == false);
    assert!(detail.enrichment.attribution.is_some());
    assert_eq!(detail.book.file_cover_source, Some(CoverSource::Generated));
}

#[test]
fn a_needful_things_isbn_match_without_author_names_fills_its_cover() {
    let provider = FakeProvider::with_candidate(needful_things_candidate());
    *provider.cover.lock().unwrap() = png_cover(339, 500);
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_pdf_book(
        &api,
        "Stephen King - Needful Things (1991).pdf",
        needful_things_pdf(Some("ISBN:9780670839537")),
    );
    assert_eq!(book.cover_source, Some(CoverSource::Generated));

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Applied { fields, .. } => {
            assert_eq!(fields, vec!["description", "cover"]);
        }
        other => panic!("expected the ISBN match to apply, got {other:?}"),
    }

    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.cover_data_url.is_some());
    let attribution = detail.enrichment.attribution.expect("attribution");
    assert!(attribution.label.contains("Open Library"));
    assert!(attribution.url.contains("openlibrary.org"));
}

#[test]
fn a_needful_things_title_match_ignores_the_pdf_creation_date() {
    let provider = FakeProvider::with_candidate(ProviderCandidate {
        key: "open_library:/works/OL81607W".to_owned(),
        source: "open_library".to_owned(),
        edition_key: Some("open_library:/books/OL60561812M".to_owned()),
        title: "Needful Things".to_owned(),
        authors: vec!["Stephen King".to_owned()],
        year: Some(1991),
        publisher: Some("Viking".to_owned()),
        description: Some("<p>A newcomer opens a shop in Castle Rock.</p>".to_owned()),
        cover_keys: vec!["id:8404327".to_owned()],
        source_url: "https://openlibrary.org/works/OL81607W".to_owned(),
        ..ProviderCandidate::default()
    });
    *provider.cover.lock().unwrap() = png_cover(330, 500);
    let (_dir, api) = database_with_provider(provider);
    let book = add_pdf_book(
        &api,
        "Stephen King - Needful Things (1991).pdf",
        needful_things_pdf(None),
    );
    // The PDF's CreationDate is 2011, but the filename year is the publication
    // hint the matcher must use.
    assert_eq!(book.published_date.as_deref(), Some("2011"));
    assert_eq!(book.cover_source, Some(CoverSource::Generated));

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(
        matches!(outcome, EnrichmentOutcome::Applied { .. }),
        "the 1991 edition should match, got {outcome:?}"
    );
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.cover_data_url.is_some());
}

#[test]
fn an_embedded_blurb_and_real_cover_survive_a_lookup() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let cover = png_cover(400, 600);
    let mut metadata = basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974");
    metadata.push("<dc:description>Publisher's own blurb.</dc:description>".to_owned());
    let book = add_book(&api, "The Dispossessed.epub", &metadata, Some(&cover));

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::NoMatch { .. }));

    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.description.as_deref(), Some("Publisher's own blurb."));
    assert_eq!(detail.book.cover_source, Some(CoverSource::Embedded));
    assert_eq!(detail.book.file_cover_source, Some(CoverSource::Embedded));
}

#[test]
fn a_real_cover_keeps_its_bytes_while_a_missing_blurb_is_filled() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let cover = png_cover(400, 600);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        Some(&cover),
    );
    let before = api.get_book_detail(book.id, None).expect("detail").cover_data_url;

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Applied { fields, .. } => assert_eq!(fields, vec!["description"]),
        other => panic!("expected blurb-only apply, got {other:?}"),
    }
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Embedded));
    assert_eq!(detail.cover_data_url, before);
}

#[test]
fn a_manual_blurb_edit_survives_a_forced_refresh() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    api.edit_blurb(book.id, Some("My own note about this edition."))
        .expect("edit");

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, true)).expect("refresh");
    assert!(matches!(outcome, EnrichmentOutcome::NoMatch { .. }));
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(
        detail.book.description.as_deref(),
        Some("My own note about this edition.")
    );
    assert_eq!(detail.enrichment.description_source.as_deref(), Some("manual"));
}

#[test]
fn reverting_restores_the_file_blurb_and_generated_plate() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let mut metadata = basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974");
    metadata.push("<dc:description>File blurb.</dc:description>".to_owned());
    let book = add_book(&api, "The Dispossessed.epub", &metadata, None);

    // The file blurb blocks a description write, but the generated cover is a gap.
    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::Applied { .. }));
    api.revert_enrichment(book.id).expect("revert");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.description.as_deref(), Some("File blurb."));
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
    assert_eq!(detail.enrichment.attribution, None);
}

#[test]
fn ambiguous_candidates_return_review_and_write_nothing() {
    let first = candidate("The Dispossessed", &["Ursula K. Le Guin"]);
    let mut second = candidate("The Dispossessed", &["Ursula K. Le Guin"]);
    second.key = "open_library:/books/OLSecondM".to_owned();
    second.edition_key = Some("open_library:/books/OLSecondM".to_owned());
    second.source_url = "https://openlibrary.org/books/OLSecondM".to_owned();
    second.cover_keys = vec!["id:456".to_owned()];
    let provider = Arc::new(FakeProvider {
        candidates: Mutex::new(vec![first, second]),
        cover: Mutex::new(portrait_cover()),
        ..FakeProvider::default()
    });
    let (_dir, api) = database_with_provider(provider);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::NeedsReview { candidates, .. } => {
            assert_eq!(candidates.len(), 2);
            assert!(candidates[0].cover_data_url.is_some());
        }
        other => panic!("expected review, got {other:?}"),
    }
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert!(detail.book.description.is_none());
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
}

#[test]
fn a_no_match_is_cached_and_does_not_repeat_within_the_ttl() {
    let provider = Arc::new(FakeProvider {
        candidates: Mutex::new(Vec::new()),
        cover: Mutex::new(portrait_cover()),
        ..FakeProvider::default()
    });
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let first = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(first, EnrichmentOutcome::NoMatch { .. }));
    let second = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(second, EnrichmentOutcome::NoMatch { .. }));
    assert_eq!(provider.requests().len(), 1, "negative cache prevents a repeat request");

    let forced = runtime().block_on(api.lookup_enrichment(book.id, true)).expect("refresh");
    assert!(matches!(forced, EnrichmentOutcome::NoMatch { .. }));
    assert_eq!(provider.requests().len(), 2, "force bypasses the TTL");
}

#[test]
fn a_rate_limit_is_reported_and_not_cached_as_no_match() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    provider.set_failure(ProviderError {
        kind: ProviderErrorKind::RateLimited,
        retry_after_seconds: Some(7),
    });
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Unavailable {
            code,
            retry_after_seconds,
            message,
            ..
        } => {
            assert_eq!(code, "rate_limited");
            assert_eq!(retry_after_seconds, Some(7));
            assert!(message.contains("slow down"));
        }
        other => panic!("expected unavailable, got {other:?}"),
    }
    // The cooldown is not a no-match; a forced refresh asks again.
    *provider.failure.lock().unwrap() = None;
    let retried = runtime().block_on(api.lookup_enrichment(book.id, true)).expect("retry");
    assert!(matches!(retried, EnrichmentOutcome::Applied { .. }));
}

#[test]
fn a_temporary_fault_is_retried_within_the_lookup() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    provider.set_transient(1);
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::Applied { .. }));
    assert_eq!(provider.requests().len(), 2, "one transient failure, then a retry");
}

#[test]
fn a_permanent_refusal_is_not_retried() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    provider.set_failure(ProviderError {
        kind: ProviderErrorKind::Status(403),
        retry_after_seconds: None,
    });
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::Unavailable { code, .. } if code == "forbidden"));
    // A forced refresh does not retry a permanent refusal within the same call.
    let _ = runtime().block_on(api.lookup_enrichment(book.id, true)).expect("lookup");
}

#[test]
fn cancellation_during_lookup_writes_nothing() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    provider.set_lookup_delay(80);
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let outcome = runtime.block_on(async {
        let api = &api;
        let lookup = api.lookup_enrichment(book.id, false);
        let book_id = book.id;
        let cancel = async {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            api.cancel_enrichment(book_id).expect("cancel");
        };
        tokio::join!(lookup, cancel).0.expect("lookup")
    });
    assert!(matches!(outcome, EnrichmentOutcome::Cancelled));
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert!(detail.book.description.is_none());
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
}

#[test]
fn invalid_and_landscape_covers_leave_the_generated_plate() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    *provider.cover.lock().unwrap() = png_cover(800, 300);
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Applied { fields, .. } => assert_eq!(fields, vec!["description"]),
        other => panic!("expected blurb-only apply, got {other:?}"),
    }
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
}

#[test]
fn cover_choices_show_current_and_original_sources() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(provider);
    let cover = png_cover(400, 600);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        Some(&cover),
    );
    let choices = api.cover_choices(book.id).expect("choices");
    assert!(choices.current.is_some());
    assert_eq!(choices.original.source, "embedded");
    assert!(choices.original.is_original);
}

#[test]
fn the_manual_chooser_can_apply_and_reset_an_online_cover() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let cover = png_cover(400, 600);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        Some(&cover),
    );

    let found = runtime().block_on(api.lookup_cover_candidates(book.id)).expect("find covers");
    let option = match found {
        pocketlibrary_core::CoverLookupOutcome::Found { mut candidates, .. } => candidates.remove(0),
        other => panic!("expected covers, got {other:?}"),
    };
    assert!(option.preview_data_url.is_some());
    runtime()
        .block_on(api.apply_cover_choice(book.id, option.clone(), true))
        .expect("apply cover");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.enrichment.cover_manual);

    // Automatic enrichment may fill a missing blurb, but it may not replace a
    // manual cover.
    let outcome = runtime().block_on(api.lookup_enrichment(book.id, true)).expect("lookup");
    match outcome {
        EnrichmentOutcome::Applied { fields, .. } => {
            assert_eq!(fields, vec!["description"]);
        }
        EnrichmentOutcome::NoMatch { .. } => {}
        other => panic!("unexpected outcome {other:?}"),
    }
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.enrichment.cover_manual);

    api.reset_cover(book.id).expect("reset");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Embedded));
    assert!(!detail.enrichment.cover_manual);
}

#[test]
fn a_device_image_is_staged_then_applied_with_provenance() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(provider);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let preview = api
        .prepare_device_cover(book.id, &portrait_cover())
        .expect("stage device cover");
    assert!(preview.warning.is_none());
    runtime()
        .block_on(api.apply_device_cover(book.id, &preview.token, false))
        .expect("apply device");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Device));
    assert!(detail.enrichment.cover_manual);

    // A stale token is rejected.
    let error = runtime()
        .block_on(api.apply_device_cover(book.id, &preview.token, true))
        .expect_err("stale token");
    assert_eq!(error.code, "cover_token_invalid");
}

#[test]
fn a_small_device_image_is_refused_and_a_landscape_one_needs_acknowledgement() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(provider);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let tiny = api.prepare_device_cover(book.id, &png_cover(80, 120));
    assert!(tiny.is_err());

    let landscape = api
        .prepare_device_cover(book.id, &png_cover(800, 300))
        .expect("landscape preview");
    assert!(landscape.warning.is_some());
    let error = runtime()
        .block_on(api.apply_device_cover(book.id, &landscape.token, false))
        .expect_err("needs acknowledgement");
    assert_eq!(error.code, "cover_needs_acknowledgement");
}

#[test]
fn cover_choices_make_no_network_request_until_find_covers() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    api.cover_choices(book.id).expect("choices");
    assert!(provider.requests().is_empty());
    assert!(provider.cover_requests().is_empty());
    let _ = runtime().block_on(api.lookup_cover_candidates(book.id)).expect("find");
    assert!(!provider.requests().is_empty());
}

#[test]
fn settings_round_trip_through_all_three_modes() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(provider);
    assert_eq!(api.enrichment_settings().unwrap().mode, EnrichmentMode::Off);
    for mode in [EnrichmentMode::Ask, EnrichmentMode::Automatic, EnrichmentMode::Off] {
        let saved = api.set_enrichment_mode(mode).expect("save mode");
        assert_eq!(saved.mode, mode);
        assert_eq!(api.enrichment_settings().unwrap().mode, mode);
    }
    assert_eq!(api.enrichment_settings().unwrap().source_label, "Open Library");
}

#[test]
fn the_target_queue_is_capped_and_skips_complete_books() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(provider);
    let cover = png_cover(400, 600);
    let mut complete = basic_metadata("A Complete Book", "An Author", "2000");
    complete.push("<dc:description>Already here.</dc:description>".to_owned());
    add_book(&api, "Complete.epub", &complete, Some(&cover));
    add_book(
        &api,
        "Gap.epub",
        &basic_metadata("A Gap Book", "Another Author", "2001"),
        None,
    );
    let targets = api.enrichment_targets(20).expect("targets");
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].title, "A Gap Book");
}

#[test]
fn a_cached_attribution_is_present_only_when_an_online_field_was_used() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );
    let before = api.get_book_detail(book.id, None).expect("detail");
    assert!(before.enrichment.attribution.is_none());
    runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    let after = api.get_book_detail(book.id, None).expect("detail");
    assert!(after.enrichment.attribution.is_some());
    assert!(
        after
            .enrichment
            .attribution
            .as_ref()
            .unwrap()
            .fields
            .contains(&"description".to_owned())
    );
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
}

#[test]
fn a_conflicting_author_returns_review_and_writes_nothing() {
    let provider =
        FakeProvider::with_candidate(candidate("The Dispossessed", &["Stephen King"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    match outcome {
        EnrichmentOutcome::NeedsReview { candidates, .. } => {
            assert_eq!(candidates.len(), 1);
            assert_eq!(candidates[0].authors, vec!["Stephen King".to_owned()]);
        }
        other => panic!("expected review for a conflicting author, got {other:?}"),
    }
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert!(detail.book.description.is_none());
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
}

#[test]
fn the_chooser_can_restore_the_generated_plate() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let found = runtime().block_on(api.lookup_cover_candidates(book.id)).expect("find covers");
    let option = match found {
        pocketlibrary_core::CoverLookupOutcome::Found { mut candidates, .. } => {
            candidates.remove(0)
        }
        other => panic!("expected covers, got {other:?}"),
    };
    runtime()
        .block_on(api.apply_cover_choice(book.id, option, true))
        .expect("apply");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.enrichment.cover_manual);

    let choices = api.cover_choices(book.id).expect("choices");
    assert_eq!(choices.original.source, "generated");
    api.reset_cover(book.id).expect("reset");
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
    assert!(!detail.enrichment.cover_manual);
}

#[test]
fn the_internet_archive_supplement_is_linked_to_an_ocaid_and_respects_access() {
    let mut candidate = candidate("The Dispossessed", &["Ursula K. Le Guin"]);
    candidate.description = None;
    candidate.cover_keys.clear();
    candidate.ocaid = Some("dispossessed00lein".to_owned());
    let provider = FakeProvider::with_candidate(candidate);
    *provider.supplement.lock().unwrap() = Some(ProviderSupplement {
        description: Some("<p>An archive scan's description.</p>".to_owned()),
        cover_keys: vec!["ia:dispossessed00lein".to_owned()],
        source_url: "https://archive.org/details/dispossessed00lein".to_owned(),
        access_restricted: false,
    });
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::Applied { .. }));
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.cover_source, Some(CoverSource::InternetArchive));
    assert_eq!(
        detail.book.description.as_deref(),
        Some("An archive scan's description.")
    );
    let attribution = detail.enrichment.attribution.expect("attribution");
    assert!(attribution.label.contains("Internet Archive"));
    assert!(attribution.url.contains("archive.org"));
}

#[test]
fn an_access_restricted_supplement_adds_nothing() {
    let mut candidate = candidate("The Dispossessed", &["Ursula K. Le Guin"]);
    candidate.description = None;
    candidate.cover_keys.clear();
    candidate.ocaid = Some("restricted00lein".to_owned());
    let provider = FakeProvider::with_candidate(candidate);
    *provider.supplement.lock().unwrap() = Some(ProviderSupplement {
        description: Some("Restricted scan text.".to_owned()),
        cover_keys: vec!["ia:restricted00lein".to_owned()],
        source_url: "https://archive.org/details/restricted00lein".to_owned(),
        access_restricted: true,
    });
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        None,
    );

    let outcome = runtime().block_on(api.lookup_enrichment(book.id, false)).expect("lookup");
    assert!(matches!(outcome, EnrichmentOutcome::NoMatch { .. }));
    let detail = api.get_book_detail(book.id, None).expect("detail");
    assert!(detail.book.description.is_none());
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
}

#[test]
fn manual_cover_provenance_survives_a_backup_round_trip() {
    let provider = FakeProvider::with_candidate(candidate("The Dispossessed", &["Ursula K. Le Guin"]));
    let (_dir, api) = database_with_provider(Arc::clone(&provider));
    let cover = png_cover(400, 600);
    let book = add_book(
        &api,
        "The Dispossessed.epub",
        &basic_metadata("The Dispossessed", "Ursula K. Le Guin", "1974"),
        Some(&cover),
    );
    let found = runtime().block_on(api.lookup_cover_candidates(book.id)).expect("find");
    let option = match found {
        pocketlibrary_core::CoverLookupOutcome::Found { mut candidates, .. } => {
            candidates.remove(0)
        }
        other => panic!("expected covers, got {other:?}"),
    };
    runtime()
        .block_on(api.apply_cover_choice(book.id, option, true))
        .expect("apply");
    api.edit_blurb(book.id, Some("My own note."))
        .expect("edit blurb");
    let bytes = api.export_backup().expect("export");

    let (restore_dir, restored) = database_with_provider(provider);
    restored
        .import_backup(&bytes, pocketlibrary_core::ImportMode::Replace)
        .expect("import");
    let book = restored.list_books().expect("books").remove(0);
    let detail = restored.get_book_detail(book.id, None).expect("detail");
    assert_eq!(detail.book.description.as_deref(), Some("My own note."));
    assert_eq!(detail.book.cover_source, Some(CoverSource::OpenLibrary));
    assert!(detail.enrichment.cover_manual);
    assert_eq!(detail.enrichment.description_source.as_deref(), Some("manual"));
    drop(restore_dir);
}
