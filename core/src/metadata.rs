//! Embedded metadata and cover bytes for EPUB and PDF files.
//!
//! Extraction is deliberately forgiving: a file that cannot be opened at all is
//! rejected with a stable reason, while a readable file with thin metadata is
//! accepted and filled in from its filename. Online enrichment is deferred.

use std::io::Cursor;

use hayro::hayro_interpret::{InterpreterSettings, hayro_syntax::Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings, render};
use rbook::Epub;

use crate::models::{BookFormat, ScanIssueReason};

/// Metadata read from a file, before filename fallback is applied.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParsedMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub series: Option<String>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<String>,
    pub identifier: Option<String>,
    pub page_count: Option<i64>,
    /// The raw embedded cover image (PNG/JPEG) or a rendered PDF page.
    pub cover: Option<Vec<u8>>,
    /// Whether the cover bytes are an embedded image or a rendered page.
    pub cover_rendered: bool,
}

/// The result of reading a book file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedBook {
    pub metadata: ParsedMetadata,
}

/// Read metadata and a cover candidate from a book file.
///
/// The filename supplies `title` and `author` hints for fields the file leaves
/// empty; embedded values always win.
pub fn extract(format: BookFormat, bytes: &[u8], filename: &str) -> Result<ExtractedBook, ScanIssueReason> {
    let hints = parse_filename(filename);
    let mut parsed = match format {
        BookFormat::Epub => parse_epub(bytes)?,
        BookFormat::Pdf => parse_pdf(bytes)?,
    };

    if parsed.title.is_none() {
        parsed.title = hints.title;
    }
    if parsed.authors.is_empty()
        && let Some(author) = hints.author
    {
        parsed.authors.push(author);
    }
    if parsed.published_date.is_none() {
        parsed.published_date = hints.year;
    }
    parsed.title = parsed
        .title
        .map(|value| clean_text(&value))
        .filter(|value| !value.is_empty());
    parsed.authors = parsed
        .authors
        .into_iter()
        .map(|value| clean_text(&value))
        .filter(|value| !value.is_empty())
        .collect();
    parsed.series = parsed.series.and_then(clean_optional);
    parsed.language = parsed.language.and_then(clean_optional);
    parsed.description = parsed
        .description
        .map(|value| clean_description(&value))
        .filter(|value| !value.is_empty());
    parsed.publisher = parsed.publisher.and_then(clean_optional);
    parsed.identifier = parsed.identifier.and_then(clean_optional);

    Ok(ExtractedBook { metadata: parsed })
}

fn clean_optional(value: String) -> Option<String> {
    let cleaned = clean_text(&value);
    (!cleaned.is_empty()).then_some(cleaned)
}

fn parse_epub(bytes: &[u8]) -> Result<ParsedMetadata, ScanIssueReason> {
    let epub = Epub::options()
        .skip_toc(true)
        .read(Cursor::new(bytes.to_vec()))
        .map_err(|_| ScanIssueReason::InvalidEpub)?;

    let metadata = epub.metadata();
    let mut parsed = ParsedMetadata {
        title: metadata.title().map(|title| title.value().to_owned()),
        authors: metadata
            .creators()
            .map(|creator| creator.value().to_owned())
            .collect(),
        series: metadata
            .by_property("belongs-to-collection")
            .next()
            .or_else(|| metadata.by_property("calibre:series").next())
            .map(|entry| entry.value().to_owned()),
        language: metadata.language().map(|value| value.value().to_owned()),
        description: metadata
            .description()
            .map(|entry| entry.value().to_owned()),
        publisher: metadata
            .publishers()
            .next()
            .map(|entry| entry.value().to_owned()),
        published_date: metadata.published().map(|date| {
            let date = date.date();
            format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day())
        }),
        identifier: metadata
            .identifier()
            .or_else(|| metadata.identifiers().next())
            .map(|entry| entry.value().to_owned()),
        page_count: None,
        cover: epub
            .manifest()
            .cover_image()
            .and_then(|entry| entry.read_bytes().ok()),
        cover_rendered: false,
    };

    // An extension-less EPUB 2 cover is common enough to be worth a second
    // look: the manifest property is the spec path, but a missing cover should
    // never stop the book from landing.
    if parsed.cover.is_none() {
        parsed.cover = epub
            .manifest()
            .images()
            .next()
            .and_then(|entry| entry.read_bytes().ok());
    }

    Ok(parsed)
}

fn parse_pdf(bytes: &[u8]) -> Result<ParsedMetadata, ScanIssueReason> {
    let info = lopdf::Document::load_metadata_mem(bytes).map_err(|_| ScanIssueReason::InvalidPdf)?;
    let filename_junk = |value: &str| {
        let lower = value.trim().to_ascii_lowercase();
        lower.is_empty()
            || lower == "untitled"
            || lower.starts_with("untitled ")
            || lower.starts_with("microsoft word")
            || lower.starts_with("document")
            || lower.ends_with(".dvi")
    };

    let title = info.title.filter(|value| !filename_junk(value));
    let authors = info
        .author
        .into_iter()
        .flat_map(|value| {
            value
                .split([';', ','])
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect();

    let (cover, cover_rendered) = match render_pdf_cover(bytes) {
        Some(cover) => (Some(cover), true),
        None => (None, false),
    };

    Ok(ParsedMetadata {
        title,
        authors,
        description: info.subject,
        published_date: info.creation_date.as_deref().and_then(pdf_year),
        publisher: None,
        identifier: None,
        series: None,
        language: None,
        page_count: Some(i64::from(info.page_count)),
        cover,
        cover_rendered,
    })
}

/// Render page one to a PNG at roughly 600 px wide. Failure is never fatal.
fn render_pdf_cover(bytes: &[u8]) -> Option<Vec<u8>> {
    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let page = pdf.pages().first()?;
    let (width, _height) = page.render_dimensions();
    if !width.is_finite() || width <= 0.0 {
        return None;
    }
    let scale = (600.0 / width).clamp(0.2, 4.0);
    let cache = RenderCache::new();
    let pixmap = render(
        page,
        &cache,
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: WHITE,
        },
    );
    pixmap.into_png().ok()
}

/// Pull a four-digit year out of a PDF `D:YYYY...` date.
fn pdf_year(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(char::is_ascii_digit).take(4).collect();
    (digits.len() == 4).then_some(digits)
}

/// Hints parsed from a filename such as `Author - Title (Year).epub`.
#[derive(Debug, Default, PartialEq, Eq)]
struct FilenameHints {
    title: Option<String>,
    author: Option<String>,
    year: Option<String>,
}

fn parse_filename(filename: &str) -> FilenameHints {
    let stem = filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename);
    let mut cleaned = stem.replace('_', " ");

    // Common acquisition junk that must not end up in a title.
    for junk in [
        "(z-lib.org)",
        "(z-lib)",
        "[z-lib.org]",
        "[libgen]",
        "(libgen)",
        "(annas-archive)",
        "[annas-archive]",
        "_annas_archive",
    ] {
        cleaned = replace_ignore_ascii_case(&cleaned, junk, " ");
    }
    cleaned = strip_trailing_brackets(&cleaned, '[');

    let (mut title_part, mut year) = (cleaned.trim().to_owned(), None);
    if let Some((before, inside)) = split_trailing_parenthetical(&title_part)
        && inside.len() == 4
        && inside.chars().all(|c| c.is_ascii_digit())
    {
        year = Some(inside.to_owned());
        title_part = before.trim().to_owned();
    }
    if let Some((before, inside)) = split_trailing_parenthetical(&title_part)
        && !inside.is_empty()
        && year.is_some()
    {
        title_part = before.trim().to_owned();
    }

    let (author, title) = match title_part.split_once(" - ") {
        Some((author, title)) if !author.trim().is_empty() && !title.trim().is_empty() => (
            Some(collapse_spaces(author)),
            collapse_spaces(title),
        ),
        _ => (None, collapse_spaces(&title_part)),
    };

    FilenameHints {
        title: (!title.is_empty()).then_some(title),
        author,
        year,
    }
}

fn split_trailing_parenthetical(value: &str) -> Option<(&str, &str)> {
    let value = value.trim_end();
    if !value.ends_with(')') {
        return None;
    }
    let open = value.rfind('(')?;
    Some((&value[..open], &value[open + 1..value.len() - 1]))
}

fn strip_trailing_brackets(value: &str, open: char) -> String {
    let close = if open == '[' { ']' } else { ')' };
    let mut value = value.trim().to_owned();
    while value.ends_with(close) {
        let Some(start) = value.rfind(open) else {
            break;
        };
        value.truncate(start);
        value = value.trim_end().to_owned();
    }
    value
}

fn replace_ignore_ascii_case(haystack: &str, needle: &str, replacement: &str) -> String {
    let lower_haystack = haystack.to_ascii_lowercase();
    let lower_needle = needle.to_ascii_lowercase();
    let mut result = String::with_capacity(haystack.len());
    let mut cursor = 0;
    while let Some(found) = lower_haystack[cursor..].find(&lower_needle) {
        let start = cursor + found;
        result.push_str(&haystack[cursor..start]);
        result.push_str(replacement);
        cursor = start + needle.len();
    }
    result.push_str(&haystack[cursor..]);
    result
}

fn collapse_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_text(value: &str) -> String {
    collapse_spaces(value)
}

/// Turn HTML-ish descriptions into a readable plain-text blurb.
fn clean_description(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    collapse_spaces(&decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_hints_read_author_title_and_year() {
        assert_eq!(
            parse_filename("Ursula K. Le Guin - The Dispossessed (1974).epub"),
            FilenameHints {
                title: Some("The Dispossessed".to_owned()),
                author: Some("Ursula K. Le Guin".to_owned()),
                year: Some("1974".to_owned()),
            }
        );
        assert_eq!(
            parse_filename("Just A Title.pdf"),
            FilenameHints {
                title: Some("Just A Title".to_owned()),
                author: None,
                year: None,
            }
        );
    }

    #[test]
    fn acquisition_junk_is_stripped_from_filenames() {
        let hints = parse_filename("Author - Real Title (2001) [z-lib.org].epub");
        assert_eq!(hints.title.as_deref(), Some("Real Title"));
        assert_eq!(hints.author.as_deref(), Some("Author"));
        assert_eq!(hints.year.as_deref(), Some("2001"));
    }

    #[test]
    fn descriptions_lose_markup_and_whitespace() {
        assert_eq!(
            clean_description("<p>A&nbsp;quiet&nbsp;<b>room</b>.</p>"),
            "A quiet room ."
        );
    }
}
