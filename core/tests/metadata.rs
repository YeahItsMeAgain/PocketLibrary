mod common;

use base64::Engine as _;
use common::{
    FakeDir, database, epub_with, epub_with_plain_image, epub2_with, minimal_epub, pdf_with,
    pdf_with_info, png_cover, rich_epub,
};
use pocketlibrary_core::{BookFormat, CoverSource};

fn data_url_bytes(url: &str) -> Vec<u8> {
    let encoded = url
        .strip_prefix("data:image/jpeg;base64,")
        .expect("cover is a JPEG data URL");
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("cover data URL is valid base64")
}

#[test]
fn epub_metadata_and_embedded_cover_reach_the_detail_view() {
    let (_dir, api) = database();
    let cover = png_cover(120, 180);
    let source = FakeDir::new().file_with(
        "Le Guin - The Dispossessed (1974).epub",
        rich_epub(Some(&cover)),
    );
    api.scan(&source).expect("scan rich epub");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "The Dispossessed");
    assert_eq!(book.authors, vec!["Ursula K. Le Guin"]);
    assert_eq!(book.series.as_deref(), Some("Hainish"));
    assert_eq!(book.language.as_deref(), Some("en"));
    assert_eq!(book.publisher.as_deref(), Some("Harper & Row"));
    assert_eq!(book.published_date.as_deref(), Some("1974-05-01"));
    assert!(
        book.identifier
            .as_deref()
            .is_some_and(|value| value.starts_with("urn:uuid:")),
        "the EPUB identifier is persisted"
    );
    let description = book.description.as_deref().expect("description");
    assert!(description.contains("A quiet revolution"), "{description}");
    assert!(!description.contains('<'), "markup is stripped");
    assert_eq!(book.cover_source, Some(CoverSource::Embedded));

    let detail = api
        .get_book_detail(book.id, Some(&source))
        .expect("book detail");
    let url = detail.cover_data_url.expect("cover data URL");
    let bytes = data_url_bytes(&url);
    assert!(bytes.starts_with(&[0xff, 0xd8]), "cover is a JPEG");
    let decoded = image::load_from_memory(&bytes).expect("decode cover");
    assert!(decoded.width() <= 600 && decoded.height() <= 900);
}

#[test]
fn a_short_embedded_title_yields_to_the_full_filename_title() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "Alex North - The Whisper Man ebook (2019).epub",
        epub_with(
            "whisper-man",
            &[
                "<dc:title>MAN</dc:title>".to_owned(),
                "<dc:creator>Alex North</dc:creator>".to_owned(),
            ],
            None,
        ),
    );
    api.scan(&source).expect("scan truncated title");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "The Whisper Man");
    assert_eq!(book.authors, vec!["Alex North"]);
    assert_eq!(book.published_date.as_deref(), Some("2019"));
}

#[test]
fn a_normal_embedded_title_beats_an_acquired_filename() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "Alex North - Wrong Filename ebook (2019).epub",
        epub_with(
            "whisper-man-normal",
            &["<dc:title>The Whisper Man</dc:title>".to_owned()],
            None,
        ),
    );
    api.scan(&source).expect("scan normal title");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "The Whisper Man");
}

#[test]
fn an_epub_without_a_cover_gets_a_generated_plate() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with("plain.epub", minimal_epub("plain"));
    api.scan(&source).expect("scan plain epub");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "plain", "filename fills the missing title");
    assert_eq!(book.cover_source, Some(CoverSource::Generated));
    assert!(book.authors.is_empty());

    let detail = api
        .get_book_detail(book.id, Some(&source))
        .expect("book detail");
    let bytes = data_url_bytes(&detail.cover_data_url.expect("cover"));
    assert!(bytes.starts_with(&[0xff, 0xd8]));
}

#[test]
fn pdf_metadata_page_count_and_rendered_cover_are_read() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "Ada Lovelace - Fallback Title (2001).pdf",
        pdf_with("marker", Some("A PDF Book"), Some("Ada Lovelace")),
    );
    api.scan(&source).expect("scan pdf");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.format, BookFormat::Pdf);
    assert_eq!(book.title, "A PDF Book", "embedded beats filename");
    assert_eq!(book.authors, vec!["Ada Lovelace"]);
    assert_eq!(book.page_count, Some(1));
    assert_eq!(book.cover_source, Some(CoverSource::Rendered));

    let detail = api
        .get_book_detail(book.id, Some(&source))
        .expect("book detail");
    let bytes = data_url_bytes(&detail.cover_data_url.expect("cover"));
    assert!(bytes.starts_with(&[0xff, 0xd8]));
}

#[test]
fn pdf_without_embedded_metadata_falls_back_to_the_filename() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file_with(
        "Some Author - Some Title (1999).pdf",
        pdf_with("bare", None, None),
    ))
    .expect("scan bare pdf");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "Some Title");
    assert_eq!(book.authors, vec!["Some Author"]);
    assert_eq!(book.published_date.as_deref(), Some("1999"));
    assert_eq!(book.page_count, Some(1));
}

#[test]
fn deleting_the_cover_cache_restores_the_real_cover_on_reopen() {
    let (_dir, api) = database();
    let cover = png_cover(120, 180);
    let source = FakeDir::new().file_with("rich.epub", rich_epub(Some(&cover)));
    api.scan(&source).expect("scan rich epub");

    let book = api.list_books().expect("list books").remove(0);
    let first = api
        .get_book_detail(book.id, Some(&source))
        .expect("first detail");
    let first_url = first.cover_data_url.expect("cover");
    let original = data_url_bytes(&first_url);
    let cache_path = book.cover_path.clone().expect("cache path is stored");
    std::fs::remove_file(&cache_path).expect("delete cached cover");

    let reopened = api
        .get_book_detail(book.id, Some(&source))
        .expect("reopened detail");
    assert_eq!(
        reopened.book.cover_source,
        Some(CoverSource::Embedded),
        "the database records the restored source"
    );
    assert_eq!(
        reopened.cover_data_url.expect("cover"),
        first_url,
        "the real cover is re-extracted, not a generated plate"
    );
    assert!(std::path::Path::new(&cache_path).is_file());
    assert!(!original.is_empty());
}

#[test]
fn an_unreadable_book_falls_back_to_a_generated_cover() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with("rich.epub", rich_epub(Some(&png_cover(60, 90))));
    api.scan(&source).expect("scan rich epub");
    let book = api.list_books().expect("list books").remove(0);
    let cached = data_url_bytes(
        &api.get_book_detail(book.id, Some(&source))
            .expect("first detail")
            .cover_data_url
            .expect("cover"),
    );
    std::fs::remove_file(book.cover_path.expect("cache path")).expect("delete cover");

    let detail = api
        .get_book_detail(book.id, Some(&FakeDir::new()))
        .expect("detail without the file");
    assert_eq!(detail.book.cover_source, Some(CoverSource::Generated));
    let fallback = data_url_bytes(&detail.cover_data_url.expect("generated cover"));
    assert_ne!(fallback, cached, "the plate replaces the missing cover");
}

#[test]
fn an_epub_two_package_supplies_legacy_metadata() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "legacy.epub",
        epub2_with(
            "legacy",
            &[
                "<dc:title>A Wizard of Earthsea</dc:title>".to_owned(),
                "<dc:creator>Ursula K. Le Guin</dc:creator>".to_owned(),
                "<dc:language>en-GB</dc:language>".to_owned(),
                "<dc:publisher>Parnassus Press</dc:publisher>".to_owned(),
                "<dc:identifier>ISBN:9780395276532</dc:identifier>".to_owned(),
                r#"<meta name="calibre:series" content="Earthsea"/>"#.to_owned(),
            ],
        ),
    );
    api.scan(&source).expect("scan epub 2");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "A Wizard of Earthsea");
    assert_eq!(book.authors, vec!["Ursula K. Le Guin"]);
    assert_eq!(book.series.as_deref(), Some("Earthsea"));
    assert_eq!(book.language.as_deref(), Some("en-GB"));
    assert_eq!(book.publisher.as_deref(), Some("Parnassus Press"));
    assert_eq!(book.identifier.as_deref(), Some("urn:uuid:legacy"));
}

#[test]
fn a_manifest_image_without_cover_properties_is_the_cover_fallback() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "plain-image.epub",
        epub_with_plain_image("plain-image", &png_cover(90, 120)),
    );
    api.scan(&source).expect("scan epub with a plain image");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.cover_source, Some(CoverSource::Embedded));
    let detail = api
        .get_book_detail(book.id, Some(&source))
        .expect("book detail");
    let bytes = data_url_bytes(&detail.cover_data_url.expect("cover"));
    assert!(bytes.starts_with(&[0xff, 0xd8]));
}

#[test]
fn a_rich_pdf_fills_series_language_publisher_identifier_and_page_count() {
    let (_dir, api) = database();
    let source = FakeDir::new().file_with(
        "rich.pdf",
        pdf_with_info(
            "marker",
            &[
                ("Title", "The Left Hand of Darkness"),
                ("Author", "Le Guin, Ursula K.; Ada Lovelace"),
                ("Publisher", "Ace Books"),
                ("Language", "en"),
                ("Series", "Hainish"),
                ("Identifier", "ISBN:9780441478125"),
                ("CreationDate", "D:19690101000000"),
            ],
            3,
        ),
    );
    api.scan(&source).expect("scan rich pdf");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "The Left Hand of Darkness");
    assert_eq!(
        book.authors,
        vec!["Le Guin, Ursula K.", "Ada Lovelace"],
        "commas inside a name do not split the author"
    );
    assert_eq!(book.series.as_deref(), Some("Hainish"));
    assert_eq!(book.language.as_deref(), Some("en"));
    assert_eq!(book.publisher.as_deref(), Some("Ace Books"));
    assert_eq!(book.identifier.as_deref(), Some("ISBN:9780441478125"));
    assert_eq!(book.published_date.as_deref(), Some("1969"));
    assert_eq!(book.page_count, Some(3));
}

#[test]
fn a_missing_book_detail_reports_a_typed_error() {
    let (_dir, api) = database();

    let error = api
        .get_book_detail(999, None)
        .expect_err("missing book must fail");
    assert_eq!(error.code, "book_not_found");
    assert!(
        !error.message.contains("999"),
        "the wire message stays calm"
    );
}

#[test]
fn books_never_serialise_their_paths_or_cover_paths() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file("secret.epub")).expect("scan");
    let book = api.list_books().expect("list books").remove(0);

    let json = serde_json::to_value(&book).expect("book json");
    let object = json.as_object().expect("object");
    assert!(!object.contains_key("path"));
    assert!(!object.contains_key("coverPath"));
    assert!(!object.contains_key("quickKey"), "scan internals stay home");
    assert!(!object.contains_key("coverSource"));

    let detail = api.get_book_detail(book.id, None).expect("detail");
    let json = serde_json::to_value(&detail).expect("detail json");
    let object = json.as_object().expect("object");
    assert!(!object.contains_key("path"));
    assert!(!object.contains_key("coverPath"));
    assert!(!object.contains_key("quickKey"));
    assert!(!object.contains_key("coverSource"));
    assert!(object.contains_key("coverDataUrl"));
}
