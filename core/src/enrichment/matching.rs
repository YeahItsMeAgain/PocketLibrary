//! Confidence matching, title/author normalisation, ISBN handling and blurb
//! cleaning.

use unicode_normalization::UnicodeNormalization;

use super::provider::{first_year, ProviderCandidate};
use super::BookSnapshot;
use crate::models::BookFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Confidence {
    High,
    Medium,
    None,
}

fn fold(value: &str) -> String {
    value
        .nfkd()
        .filter(|c| !c.is_combining_marks())
        .flat_map(char::to_lowercase)
        .collect()
}

trait CombiningMark {
    fn is_combining_marks(&self) -> bool;
}

impl CombiningMark for char {
    fn is_combining_marks(&self) -> bool {
        matches!(*self as u32, 0x0300..=0x036f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff | 0x20d0..=0x20ff)
    }
}

/// Case-fold, strip diacritics and punctuation, remove a leading article and
/// collapse whitespace. A subtitle is dropped after `:` or an em dash.
pub fn normalise_title(value: &str) -> String {
    let mut folded = fold(value);
    if let Some((main, subtitle)) = folded.split_once(':') {
        if main.trim().split_whitespace().count() >= 2 {
            folded = main.to_owned();
        } else {
            let _ = subtitle;
        }
    }
    if let Some((main, _subtitle)) = folded.split_once('—') {
        if main.trim().split_whitespace().count() >= 2 {
            folded = main.to_owned();
        }
    }
    let words: Vec<String> = folded
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    let mut words = words;
    if words.len() > 1
        && matches!(
            words.first().map(String::as_str),
            Some("the" | "a" | "an" | "le" | "la" | "les" | "der" | "die" | "das")
        )
    {
        words.remove(0);
    }
    if words.len() > 1
        && matches!(
            words.last().map(String::as_str),
            Some("the" | "a" | "an" | "le" | "la" | "les" | "der" | "die" | "das")
        )
    {
        words.pop();
    }
    words.join(" ")
}

fn title_similarity(left: &str, right: &str) -> f64 {
    let left = normalise_title(left);
    let right = normalise_title(right);
    if left == right {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    // Token overlap plus a length penalty is enough for book titles and keeps
    // common words from producing a confident mismatch.
    let left_words: Vec<&str> = left.split_whitespace().collect();
    let right_words: Vec<&str> = right.split_whitespace().collect();
    let hits = left_words
        .iter()
        .filter(|word| right_words.contains(word))
        .count();
    let overlap = hits as f64 / left_words.len().max(right_words.len()) as f64;
    let length_ratio = left.len().min(right.len()) as f64 / left.len().max(right.len()) as f64;
    overlap * 0.7 + length_ratio * 0.3
}

fn surname(author: &str) -> String {
    let folded = fold(author);
    folded
        .split_whitespace()
        .next_back()
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn author_matches(file_authors: &[String], candidate_authors: &[String]) -> bool {
    if file_authors.is_empty() || candidate_authors.is_empty() {
        return file_authors.is_empty();
    }
    file_authors.iter().any(|file| {
        let file_surname = surname(file);
        !file_surname.is_empty()
            && candidate_authors.iter().any(|candidate| {
                let candidate_surname = surname(candidate);
                !candidate_surname.is_empty()
                    && (candidate_surname.contains(&file_surname)
                        || file_surname.contains(&candidate_surname))
            })
    })
}

pub(super) fn clean_blurb(raw: &str) -> Option<String> {
    let mut text = String::with_capacity(raw.len());
    let mut in_tag = false;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                // Keep paragraph boundaries as newlines.
                let mut tag = String::new();
                for next in chars.by_ref() {
                    if next == '>' {
                        break;
                    }
                    tag.push(next);
                }
                let name = tag
                    .trim()
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(name.as_str(), "p" | "br" | "div" | "li" | "h1" | "h2" | "h3") {
                    text.push('\n');
                }
                in_tag = false;
            }
            '&' => {
                let mut entity = String::new();
                while let Some(next) = chars.next() {
                    if next == ';' || entity.len() > 10 {
                        break;
                    }
                    entity.push(next);
                }
                text.push(match entity.as_str() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" | "#39" => '\'',
                    "nbsp" => ' ',
                    "mdash" => '—',
                    "ndash" => '–',
                    "hellip" => '…',
                    _ => ' ',
                });
                in_tag = in_tag || false;
            }
            _ => text.push(c),
        }
    }
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            line.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect();
    let mut cleaned = lines.join("\n\n");
    cleaned = cleaned.trim().to_owned();
    if cleaned.is_empty() {
        return None;
    }
    let lower = cleaned.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "about the author" | "look inside" | "table of contents"
    ) || lower.starts_with("http://")
        || lower.starts_with("https://")
    {
        return None;
    }
    const MAX_CHARS: usize = 4000;
    if cleaned.chars().count() > MAX_CHARS {
        cleaned = cleaned.chars().take(MAX_CHARS).collect::<String>();
        cleaned = cleaned.trim_end().to_owned();
    }
    Some(cleaned)
}

// ---------------------------------------------------------------------------
// ISBN handling
// ---------------------------------------------------------------------------

/// Find the first plausible ISBN in a metadata identifier or filename.
pub fn find_isbn(value: &str) -> Option<String> {
    let chars: Vec<char> = value.chars().collect();
    let mut start = 0;
    while start < chars.len() {
        if !chars[start].is_ascii_digit() {
            start += 1;
            continue;
        }
        let mut end = start;
        while end < chars.len()
            && (chars[end].is_ascii_digit() || matches!(chars[end], '-' | ' ' | 'X' | 'x'))
        {
            end += 1;
        }
        let raw: String = chars[start..end].iter().collect();
        if let Some(isbn) = normalise_isbn(&raw) {
            return Some(isbn);
        }
        start = end.max(start + 1);
    }
    None
}

/// Validate an ISBN-10 or ISBN-13 and normalise it to ISBN-13.
pub fn normalise_isbn(value: &str) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, 'X' | 'x'))
        .map(|c| c.to_ascii_uppercase())
        .collect();
    match cleaned.len() {
        10 => {
            let mut sum = 0u32;
            for (index, c) in cleaned.chars().enumerate() {
                let digit = if c == 'X' && index == 9 {
                    10
                } else {
                    c.to_digit(10)?
                };
                sum += digit * (10 - index as u32);
            }
            if sum % 11 != 0 {
                return None;
            }
            let core = format!("978{}", &cleaned[..9]);
            Some(core_with_check_digit(core))
        }
        13 => {
            if !cleaned.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            if !valid_isbn13(&cleaned) {
                return None;
            }
            Some(cleaned)
        }
        _ => None,
    }
}

fn core_with_check_digit(core: String) -> String {
    let sum: u32 = core
        .chars()
        .enumerate()
        .map(|(index, c)| {
            let digit = c.to_digit(10).unwrap_or(0);
            if index % 2 == 0 { digit } else { digit * 3 }
        })
        .sum();
    let check = (10 - (sum % 10)) % 10;
    format!("{core}{check}")
}

fn valid_isbn13(value: &str) -> bool {
    let sum: u32 = value
        .chars()
        .enumerate()
        .map(|(index, c)| {
            let digit = c.to_digit(10).unwrap_or(0);
            if index % 2 == 0 { digit } else { digit * 3 }
        })
        .sum();
    sum % 10 == 0
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/// The year to check a candidate against.
///
/// A PDF's `CreationDate` is a scan/export timestamp, so a year in the filename
/// (the acquisition naming pattern) is the better publication-year hint. This
/// also repairs books already in the catalogue without rewriting their row.
pub(super) fn publication_year(snapshot: &BookSnapshot) -> Option<i64> {
    let filename_year = if snapshot.format == BookFormat::Pdf {
        crate::metadata::filename_year(&snapshot.path)
    } else {
        None
    };
    filename_year.or_else(|| snapshot.published_date.as_deref().and_then(first_year))
}

pub(super) fn confidence(snapshot: &BookSnapshot, candidate: &ProviderCandidate) -> Confidence {
    let file_authors = &snapshot.authors;
    let author_ok = author_matches(file_authors, &candidate.authors);
    let similarity = title_similarity(&snapshot.title, &candidate.title);
    let year_ok = match (publication_year(snapshot), candidate.year) {
        (Some(file_year), Some(candidate_year)) => (file_year - candidate_year).abs() <= 1,
        _ => true,
    };

    if let Some(isbn) = snapshot.identifier.as_deref().and_then(find_isbn) {
        if candidate.cover_keys.iter().any(|key| key == &format!("isbn:{isbn}")) {
            // Open Library edition records usually link authors by key and omit
            // their names. An exact ISBN is already the strongest key, so a
            // missing author list is not a conflict as long as the title agrees.
            if similarity >= 0.9 && (author_ok || candidate.authors.is_empty()) {
                return Confidence::High;
            }
            return Confidence::Medium;
        }
    }
    if similarity >= 0.98 && author_ok && year_ok {
        return Confidence::High;
    }
    if similarity >= 0.7 || (author_ok && similarity >= 0.4) {
        return Confidence::Medium;
    }
    Confidence::None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot_with(title: &str, authors: &[&str], identifier: Option<&str>) -> BookSnapshot {
        BookSnapshot {
            id: 1,
            content_hash: "hash".to_owned(),
            title: title.to_owned(),
            authors: authors.iter().map(|value| (*value).to_owned()).collect(),
            identifier: identifier.map(str::to_owned),
            description: None,
            published_date: None,
            path: String::new(),
            cover_path: None,
            cover_source: None,
            file_cover_path: None,
            file_cover_source: None,
            file_description: None,
            format: BookFormat::Epub,
        }
    }

    #[test]
    fn isbn10_and_isbn13_normalise_to_the_same_key() {
        assert_eq!(
            normalise_isbn("0-306-40615-2").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(
            normalise_isbn("978-0-306-40615-7").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(normalise_isbn("9780306406158"), None);
    }

    #[test]
    fn finds_isbn_inside_a_noisy_identifier() {
        assert_eq!(
            find_isbn("urn:isbn:9780306406157").as_deref(),
            Some("9780306406157")
        );
        assert_eq!(find_isbn("no identifier here"), None);
    }

    #[test]
    fn titles_ignore_articles_punctuation_subtitles_and_case() {
        assert_eq!(normalise_title("The Whisper Man"), "whisper man");
        assert_eq!(normalise_title("Whisper Man, The"), "whisper man");
        assert_eq!(normalise_title("Whisper Man: A Novel"), "whisper man");
        assert_eq!(normalise_title("Whisper Man — A Novel"), "whisper man");
        assert_eq!(normalise_title("ÉTÉ"), "ete");
    }

    #[test]
    fn surname_matching_is_forgiving_but_not_blind() {
        assert!(author_matches(
            &["Ursula K. Le Guin".to_owned()],
            &["Ursula Le Guin".to_owned()]
        ));
        assert!(!author_matches(
            &["Ursula K. Le Guin".to_owned()],
            &["Stephen King".to_owned()]
        ));
    }

    #[test]
    fn blurbs_are_plain_text_and_bounded() {
        let cleaned = clean_blurb("<p>A quiet &amp; <b>revolution</b>.</p><p>Second.</p>")
            .expect("blurb");
        assert_eq!(cleaned, "A quiet & revolution.\n\nSecond.");
        assert!(clean_blurb("   ").is_none());
        assert!(clean_blurb("https://example.com/book").is_none());
        let long = "word ".repeat(2000);
        assert!(clean_blurb(&long).expect("long").chars().count() <= 4000);
    }

    #[test]
    fn confidence_prefers_exact_titles_and_matching_authors() {
        let snapshot = snapshot_with("The Dispossessed", &["Ursula K. Le Guin"], None);
        let exact = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Ursula K. Le Guin".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &exact), Confidence::High);
        let wrong_author = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Stephen King".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &wrong_author), Confidence::Medium);
    }

    #[test]
    fn isbn_edition_candidates_are_high_when_title_and_author_agree() {
        let snapshot = snapshot_with("The Dispossessed", &["Ursula K. Le Guin"], Some("9780306406157"));
        let exact = ProviderCandidate {
            title: "The Dispossessed".to_owned(),
            authors: vec!["Ursula K. Le Guin".to_owned()],
            cover_keys: vec!["isbn:9780306406157".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &exact), Confidence::High);
    }

    #[test]
    fn an_isbn_match_without_author_names_still_needs_the_title_to_agree() {
        let snapshot = snapshot_with(
            "Needful Things",
            &["Stephen King"],
            Some("9780670839537"),
        );
        let same_book = ProviderCandidate {
            title: "Needful Things".to_owned(),
            authors: Vec::new(),
            cover_keys: vec!["isbn:9780670839537".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &same_book), Confidence::High);

        let other_book = ProviderCandidate {
            title: "The Stand".to_owned(),
            authors: Vec::new(),
            cover_keys: vec!["isbn:9780670839537".to_owned()],
            ..ProviderCandidate::default()
        };
        assert_eq!(confidence(&snapshot, &other_book), Confidence::Medium);
    }
}
