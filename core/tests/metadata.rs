mod common;

use base64::Engine as _;
use common::{FakeDir, database, png_cover, rich_epub, minimal_epub, pdf_with};
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
    api.scan(&FakeDir::new().file_with(
        "Le Guin - The Dispossessed (1974).epub",
        rich_epub(Some(&cover)),
    ))
    .expect("scan rich epub");

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

    let detail = api.get_book_detail(book.id).expect("book detail");
    let url = detail.cover_data_url.expect("cover data URL");
    let bytes = data_url_bytes(&url);
    assert!(bytes.starts_with(&[0xff, 0xd8]), "cover is a JPEG");
    let decoded = image::load_from_memory(&bytes).expect("decode cover");
    assert!(decoded.width() <= 600 && decoded.height() <= 900);
}

#[test]
fn an_epub_without_a_cover_gets_a_generated_plate() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file_with("plain.epub", minimal_epub("plain")))
        .expect("scan plain epub");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.title, "plain", "filename fills the missing title");
    assert_eq!(book.cover_source, Some(CoverSource::Generated));
    assert!(book.authors.is_empty());

    let detail = api.get_book_detail(book.id).expect("book detail");
    let bytes = data_url_bytes(&detail.cover_data_url.expect("cover"));
    assert!(bytes.starts_with(&[0xff, 0xd8]));
}

#[test]
fn pdf_metadata_page_count_and_rendered_cover_are_read() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file_with(
        "Ada Lovelace - Fallback Title (2001).pdf",
        pdf_with("marker", Some("A PDF Book"), Some("Ada Lovelace")),
    ))
    .expect("scan pdf");

    let book = api.list_books().expect("list books").remove(0);
    assert_eq!(book.format, BookFormat::Pdf);
    assert_eq!(book.title, "A PDF Book", "embedded beats filename");
    assert_eq!(book.authors, vec!["Ada Lovelace"]);
    assert_eq!(book.page_count, Some(1));
    assert_eq!(book.cover_source, Some(CoverSource::Rendered));

    let detail = api.get_book_detail(book.id).expect("book detail");
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
fn a_missing_book_detail_reports_a_typed_error() {
    let (_dir, api) = database();

    let error = api
        .get_book_detail(999)
        .expect_err("missing book must fail");
    assert_eq!(error.code, "book_not_found");
    assert!(!error.message.contains("999"), "the wire message stays calm");
}

#[test]
fn books_never_serialise_their_paths_or_cover_paths() {
    let (_dir, api) = database();
    api.scan(&FakeDir::new().file("secret.epub"))
        .expect("scan");
    let book = api.list_books().expect("list books").remove(0);

    let json = serde_json::to_value(&book).expect("book json");
    let object = json.as_object().expect("object");
    assert!(!object.contains_key("path"));
    assert!(!object.contains_key("coverPath"));

    let detail = api.get_book_detail(book.id).expect("detail");
    let json = serde_json::to_value(&detail).expect("detail json");
    let object = json.as_object().expect("object");
    assert!(!object.contains_key("path"));
    assert!(!object.contains_key("coverPath"));
    assert!(object.contains_key("coverDataUrl"));
}
