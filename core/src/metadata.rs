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

/// Read metadata and a cover candidate from a book file.
///
/// The filename supplies `title` and `author` hints for fields the file leaves
/// empty; embedded values always win.
pub fn extract(
    format: BookFormat,
    bytes: &[u8],
    filename: &str,
) -> Result<ParsedMetadata, ScanIssueReason> {
    let hints = parse_filename(filename);
    let hint_title = hints
        .title
        .as_deref()
        .map(clean_text)
        .filter(|value| !value.is_empty());
    let mut parsed = match format {
        BookFormat::Epub => parse_epub(bytes)?,
        BookFormat::Pdf => parse_pdf(bytes)?,
    };

    let embedded_title = parsed
        .title
        .as_deref()
        .map(clean_text)
        .filter(|value| !value.is_empty());
    parsed.title = match (embedded_title, hint_title) {
        (Some(embedded), Some(hint)) if filename_title_extends_short_embedded(&embedded, &hint) => {
            Some(hint)
        }
        (Some(embedded), _) => Some(embedded),
        (None, hint) => hint,
    };
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

    Ok(parsed)
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
        description: metadata.description().map(|entry| entry.value().to_owned()),
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
    let info =
        lopdf::Document::load_metadata_mem(bytes).map_err(|_| ScanIssueReason::InvalidPdf)?;
    // Only the named junk cases are rejected; a real title is allowed to start
    // with "document" or mention a format.
    let filename_junk = |value: &str| {
        let lower = value.trim().to_ascii_lowercase();
        lower.is_empty() || lower == "untitled" || lower.starts_with("untitled ")
    };

    let publisher = custom_entry(&info, "Publisher");
    let series = custom_entry(&info, "Series");
    let language = custom_entry(&info, "Language");
    let identifier = custom_entry(&info, "Identifier");
    // `Microsoft Word - Draft.doc` is a producer artefact, not a title.
    let title = info.title.filter(|value| {
        !filename_junk(value)
            && !value
                .trim()
                .to_ascii_lowercase()
                .starts_with("microsoft word")
    });
    let authors = info
        .author
        .into_iter()
        .flat_map(|value| split_authors(&value))
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
        publisher,
        identifier,
        series,
        language,
        page_count: Some(i64::from(info.page_count)),
        cover,
        cover_rendered,
    })
}

/// Look up a non-standard Info dictionary entry by name, case-insensitively.
fn custom_entry(info: &lopdf::PdfMetadata, name: &str) -> Option<String> {
    info.custom
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name.as_bytes()))
        .and_then(|(_, value)| match value {
            lopdf::Object::String(bytes, _) | lopdf::Object::Name(bytes) => {
                String::from_utf8(bytes.clone()).ok()
            }
            _ => None,
        })
}

/// Split a PDF author field on semicolons and the word `and`.
///
/// Commas are deliberately kept: `Le Guin, Ursula K.` is one author, not two.
fn split_authors(value: &str) -> Vec<String> {
    let mut authors = Vec::new();
    for chunk in value.split(';') {
        for part in split_on_word(chunk, "and") {
            let part = part.trim();
            if !part.is_empty() {
                authors.push(part.to_owned());
            }
        }
    }
    authors
}

/// Split on a whole word, case-insensitively, keeping the surrounding text.
fn split_on_word<'a>(value: &'a str, word: &str) -> Vec<&'a str> {
    let lower = value.to_ascii_lowercase();
    let needle = word.to_ascii_lowercase();
    let mut parts = Vec::new();
    let mut start = 0;
    while let Some(found) = lower[start..].find(&needle) {
        let at = start + found;
        let before_ok = at == 0
            || !lower[..at]
                .chars()
                .next_back()
                .is_some_and(char::is_alphanumeric);
        let after = at + needle.len();
        let after_ok = after == lower.len()
            || !lower[after..]
                .chars()
                .next()
                .is_some_and(char::is_alphanumeric);
        if before_ok && after_ok {
            parts.push(&value[start..at]);
            start = after;
        } else {
            start = at + needle.len();
        }
    }
    parts.push(&value[start..]);
    parts
}

/// Render a jacket-like page to a PNG at roughly 600 px wide.
///
/// PDF page one is often a text-only title page. Sample the first few pages
/// and choose the first one with substantial ink and colour, which is much
/// more likely to be the jacket than a wall of title-page text. If no page
/// looks jacket-like, keep page one so unusual PDFs still get a cover.
fn render_pdf_cover(bytes: &[u8]) -> Option<Vec<u8>> {
    const CANDIDATE_PAGES: usize = 4;
    const COVER_SCORE: f32 = 0.18;

    let pdf = Pdf::new(bytes.to_vec()).ok()?;
    let pages = pdf.pages();
    if pages.is_empty() {
        return None;
    }
    let index = (0..pages.len().min(CANDIDATE_PAGES))
        .find(|index| page_cover_score(&pages[*index]).is_some_and(|score| score >= COVER_SCORE))?;
    let page = &pages[index];
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

/// Score how much a page looks like a printed jacket rather than a title page.
/// Colour carries most of the signal; ink stops an almost-blank page from
/// winning just because its few pixels are coloured.
fn page_cover_score(page: &hayro::hayro_syntax::page::Page<'_>) -> Option<f32> {
    const SAMPLE_WIDTH: f32 = 120.0;

    let (width, _height) = page.render_dimensions();
    if !width.is_finite() || width <= 0.0 {
        return None;
    }
    let scale = (SAMPLE_WIDTH / width).clamp(0.02, 1.0);
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
    let data = pixmap.data_as_u8_slice();
    let mut sampled = 0u32;
    let mut ink = 0u32;
    let mut colour = 0u32;
    for pixel in data.as_chunks::<4>().0 {
        let (red, green, blue, alpha) = (pixel[0], pixel[1], pixel[2], pixel[3]);
        if alpha == 0 {
            continue;
        }
        sampled += 1;
        if u16::from(red) + u16::from(green) + u16::from(blue) < 720 {
            ink += 1;
        }
        let max = red.max(green).max(blue);
        let min = red.min(green).min(blue);
        if max - min > 18 {
            colour += 1;
        }
    }
    let total = sampled.max(1) as f32;
    let ink_fraction = ink as f32 / total;
    let colour_fraction = colour as f32 / total;
    Some(ink_fraction * (0.35 + colour_fraction))
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

/// The publication year carried by a filename such as `Author - Title (1991)`.
///
/// This is a better match signal for PDFs than their `CreationDate`, which is
/// the scan or export timestamp rather than the book's publication year.
pub(crate) fn filename_year(filename: &str) -> Option<i64> {
    parse_filename(filename).year?.parse().ok()
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
            strip_trailing_acquisition_words(title),
        ),
        _ => (None, strip_trailing_acquisition_words(&title_part)),
    };

    FilenameHints {
        title: (!title.is_empty()).then_some(title),
        author,
        year,
    }
}

/// Drop trailing acquisition markers such as `ebook` from a filename title.
///
/// Libgen rows often append a format word to the title. A lone title that is
/// itself the marker is kept, so a book genuinely named `Ebook` is untouched.
fn strip_trailing_acquisition_words(value: &str) -> String {
    let mut value = collapse_spaces(value);
    while let Some((before, last)) = value.rsplit_once(' ') {
        let word =
            last.trim_matches(|character: char| !character.is_alphanumeric() && character != '-');
        if word.eq_ignore_ascii_case("ebook") || word.eq_ignore_ascii_case("e-book") {
            value = before.trim_end().to_owned();
        } else {
            break;
        }
    }
    value
}

/// Whether a filename title clearly completes a suspiciously short embedded
/// title, as with an EPUB whose title is only `MAN` but whose filename says
/// `The Whisper Man`.
///
/// Embedded metadata stays authoritative unless it is a whole-word suffix of a
/// longer filename title and is at most two words long. That covers truncated
/// or suffix-only titles without letting a filename override a real one.
fn filename_title_extends_short_embedded(embedded: &str, hint: &str) -> bool {
    let embedded_words = embedded.split_whitespace().count();
    let hint_words = hint.split_whitespace().count();
    if embedded_words == 0 || embedded_words > 2 || hint_words <= embedded_words {
        return false;
    }

    let embedded = embedded.to_lowercase();
    let hint = hint.to_lowercase();
    if embedded == hint {
        return false;
    }
    let Some(prefix) = hint.strip_suffix(&embedded) else {
        return false;
    };
    prefix
        .chars()
        .next_back()
        .is_some_and(|character| !character.is_alphanumeric())
}

/// The title a rescan should use for an already-indexed book, if the stored
/// title is a truncated embedded title that the current filename completes.
///
/// Returns `None` for normal titles so a rescan never rewrites them.
pub(crate) fn repaired_filename_title(current_title: &str, filename: &str) -> Option<String> {
    let hint = parse_filename(filename).title?;
    title_from_hint(current_title, &hint)
}

/// Complete a short stored title from any trusted title hint, such as an
/// acquisition history row or a filename. Returns `None` when the hint does
/// not clearly extend the stored title.
pub(crate) fn title_from_hint(current_title: &str, hint: &str) -> Option<String> {
    let cleaned = clean_text(hint);
    let candidate = clean_text(&strip_trailing_acquisition_words(&cleaned));
    if candidate.is_empty() {
        return None;
    }
    let current = clean_text(current_title);
    filename_title_extends_short_embedded(&current, &candidate).then_some(candidate)
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
    fn trailing_acquisition_words_are_stripped_from_filename_titles() {
        assert_eq!(
            parse_filename("Alex North - The Whisper Man ebook (2019).epub"),
            FilenameHints {
                title: Some("The Whisper Man".to_owned()),
                author: Some("Alex North".to_owned()),
                year: Some("2019".to_owned()),
            }
        );
        assert_eq!(
            parse_filename("Some Title e-book.epub"),
            FilenameHints {
                title: Some("Some Title".to_owned()),
                author: None,
                year: None,
            }
        );
    }

    #[test]
    fn pdf_authors_split_on_semicolons_and_and_but_not_commas() {
        assert_eq!(
            split_authors("Le Guin, Ursula K.; Ada Lovelace"),
            vec!["Le Guin, Ursula K.", "Ada Lovelace"]
        );
        assert_eq!(
            split_authors("Ursula K. Le Guin and Ada Lovelace"),
            vec!["Ursula K. Le Guin", "Ada Lovelace"]
        );
        assert_eq!(
            split_authors("Le Guin, Ursula K."),
            vec!["Le Guin, Ursula K."]
        );
    }

    #[test]
    fn descriptions_lose_markup_and_whitespace() {
        assert_eq!(
            clean_description("<p>A&nbsp;quiet&nbsp;<b>room</b>.</p>"),
            "A quiet room ."
        );
    }
}
