//! Offline parsing and URL building for the Libgen LG+ search page.
//!
//! The live mirrors serve the same nine-column `#tablelibgen` table. Keeping
//! this module pure makes every parser and pagination test run without a
//! network.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

use super::mirror::BOOTSTRAP_MIRRORS;
use crate::error::{Error, Result};

/// One mirror link attached to a search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorLink {
    pub label: String,
    pub url: String,
}

/// A single file row from a Libgen search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibgenResult {
    pub md5: String,
    pub title: String,
    pub authors: Vec<String>,
    pub publisher: Option<String>,
    pub year: Option<u16>,
    pub language: Option<String>,
    pub pages: Option<u32>,
    /// Human size exactly as the mirror printed it, e.g. `3 MB`.
    pub size_text: String,
    /// Rounded byte estimate parsed from `size_text`; the download queue will
    /// replace it with the exact `content-length` in ticket 11.
    pub size_bytes: Option<u64>,
    pub extension: String,
    pub file_id: Option<u64>,
    /// Mirror host that produced this row, e.g. `libgen.li`.
    pub source: String,
    pub mirrors: Vec<MirrorLink>,
}

/// A parsed page of results. `total` is the mirror's unfiltered total.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSearchPage {
    pub results: Vec<LibgenResult>,
    pub total: u64,
    pub total_is_exact: bool,
    /// File rows the mirror returned on this page, before any rows were
    /// dropped for an unsupported format.
    pub rows_returned: usize,
    /// Rows dropped because the extension is not EPUB or PDF.
    pub unsupported_rows: usize,
}

/// What a fetched response turned out to contain.
#[derive(Debug)]
pub(crate) enum ParseOutcome {
    Page(ParsedSearchPage),
    /// A genuine zero-result page (valid search, no matching rows).
    Empty,
    /// A Cloudflare / DDoS-Guard interstitial rather than results.
    Challenge,
    /// The page is not a recognisable LG+ search result.
    Unrecognised,
}

/// Fields the user can supply. Libgen only honours some of them server-side;
/// language, format and the year range are applied after parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub year_from: Option<u16>,
    #[serde(default)]
    pub year_to: Option<u16>,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub isbn: String,
    #[serde(default)]
    pub md5: String,
    #[serde(default = "first_page")]
    pub page: u32,
}

fn first_page() -> u32 {
    1
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            title: String::new(),
            author: String::new(),
            year_from: None,
            year_to: None,
            language: String::new(),
            format: String::new(),
            publisher: String::new(),
            isbn: String::new(),
            md5: String::new(),
            page: first_page(),
        }
    }
}

impl SearchQuery {
    /// True when there is nothing to search for.
    pub fn is_empty(&self) -> bool {
        [
            &self.query,
            &self.title,
            &self.author,
            &self.publisher,
            &self.md5,
        ]
        .iter()
        .all(|value| value.trim().is_empty())
            && normalize_isbn(&self.isbn).is_empty()
    }

    /// Validate before touching the network.
    pub fn validate(&self) -> Result<()> {
        if self.is_empty() {
            return Err(Error::EmptySearch);
        }
        if self.page == 0 {
            return Err(Error::EmptySearch);
        }
        Ok(())
    }

    /// Language/format/year are not server-side filters on LG+.
    pub fn has_client_filters(&self) -> bool {
        !self.language.trim().is_empty()
            || !self.format.trim().is_empty()
            || self.year_from.is_some()
            || self.year_to.is_some()
    }

    /// Apply the filters Libgen ignores. A result with an unknown year is
    /// dropped when a year range was requested, because it cannot be proven
    /// to belong in the range.
    pub fn matches_filters(&self, result: &LibgenResult) -> bool {
        if !self.format.trim().is_empty() {
            let wanted = self.format.trim().to_ascii_lowercase();
            if result.extension.to_ascii_lowercase() != wanted {
                return false;
            }
        }
        if !self.language.trim().is_empty()
            && !language_matches(&self.language, result.language.as_deref())
        {
            return false;
        }
        if self.year_from.is_some() || self.year_to.is_some() {
            let Some(year) = result.year else {
                return false;
            };
            if self.year_from.is_some_and(|from| year < from) {
                return false;
            }
            if self.year_to.is_some_and(|to| year > to) {
                return false;
            }
        }
        true
    }
}

fn language_matches(wanted: &str, actual: Option<&str>) -> bool {
    let Some(actual) = actual else {
        return false;
    };
    let wanted = wanted.trim().to_ascii_lowercase();
    let actual = actual.trim().to_ascii_lowercase();
    if wanted == actual {
        return true;
    }
    // Accept ISO-ish codes for the common cases without pretending to be a
    // full language table.
    match wanted.as_str() {
        "en" | "eng" => actual.starts_with("english"),
        "fr" | "fre" | "fra" => actual.starts_with("french"),
        "de" | "ger" | "deu" => actual.starts_with("german"),
        "es" | "spa" => actual.starts_with("spanish"),
        "it" | "ita" => actual.starts_with("italian"),
        "ru" | "rus" => actual.starts_with("russian"),
        "pt" | "por" => actual.starts_with("portuguese"),
        _ => false,
    }
}

/// Build `GET /index.php` for one page of results.
///
/// `publisher` and `ISBN` are folded in where LG+ supports them. `columns[]`
/// scopes the free-text terms to title/author/publisher, which is the only
/// field filtering the server honours.
///
/// The basic search box is labelled "Title or author", so it always sends
/// `columns[]=t&columns[]=a`. Leaving `columns[]` off makes LG+ search every
/// field, including year and publisher, which turns `1984` into hundreds of
/// thousands of rows.
///
/// Text searches also restrict `topics[]` to the book topics (Libgen, Fiction,
/// Fiction RUS). LG+ otherwise includes comics, magazines, standards and
/// scientific articles, and the parser has to discard those rows because the
/// app only opens EPUB and PDF.
pub fn search_url(base: &str, query: &SearchQuery) -> String {
    let mut params: Vec<(String, String)> = Vec::new();

    let md5 = query.md5.trim().to_ascii_lowercase();
    let isbn = normalize_isbn(&query.isbn);
    if !md5.is_empty() {
        params.push(("req".into(), format!("md5:{md5}")));
        params.push(("gmode".into(), "1".into()));
    } else if !isbn.is_empty() {
        params.push(("req".into(), isbn));
        params.push(("columns[]".into(), "i".into()));
    } else {
        let has_query = !query.query.trim().is_empty();
        let mut terms: Vec<String> = Vec::new();
        if !query.title.trim().is_empty() {
            terms.push(query.title.trim().to_owned());
        }
        if !query.author.trim().is_empty() {
            terms.push(query.author.trim().to_owned());
        }
        if !query.publisher.trim().is_empty() {
            terms.push(query.publisher.trim().to_owned());
        }
        if has_query {
            terms.push(query.query.trim().to_owned());
        }
        params.push(("req".into(), terms.join(" ")));

        let mut columns: Vec<&str> = Vec::new();
        if !query.title.trim().is_empty() || has_query {
            columns.push("t");
        }
        if !query.author.trim().is_empty() || has_query {
            columns.push("a");
        }
        if !query.publisher.trim().is_empty() {
            columns.push("p");
        }
        for column in columns {
            params.push(("columns[]".into(), column.into()));
        }

        for topic in ["l", "f", "r"] {
            params.push(("topics[]".into(), topic.into()));
        }
    }

    params.push(("res".into(), "25".into()));
    if query.page > 1 {
        params.push(("page".into(), query.page.to_string()));
    }

    let encoded = params
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}/index.php?{encoded}", base.trim_end_matches('/'))
}

/// ISBNs are printed with hyphens on the book and pasted with them, but LG+
/// only matches the bare digits (plus a trailing `X`). Keep alphanumerics and
/// drop spaces, hyphens and the various dash characters.
fn normalize_isbn(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_uppercase())
        .collect()
}

/// RFC 3986 form encoding; spaces become `+` like the Libgen search form.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn challenge_markers(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("cf-mitigated")
        || lower.contains("<title>just a moment")
        || lower.contains("ddos-guard")
        || lower.contains("attention required! | cloudflare")
        || lower.contains("enable javascript and cookies to continue")
}

fn looks_empty(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("no files found")
        || lower.contains("nothing found")
        || lower.contains("no results found")
}

/// Parse a search response. `base` is used to make relative mirror links
/// absolute and to label the source host.
pub(crate) fn parse_search_page(body: &str, base: &str) -> ParseOutcome {
    if challenge_markers(body) {
        return ParseOutcome::Challenge;
    }

    let document = Html::parse_document(body);
    let table_selector = Selector::parse("#tablelibgen").expect("static selector");
    let Some(table) = document.select(&table_selector).next() else {
        if looks_empty(body) {
            return ParseOutcome::Empty;
        }
        return ParseOutcome::Unrecognised;
    };

    let tbody_selector = Selector::parse("tbody tr").expect("static selector");
    let row_selector = Selector::parse("tr").expect("static selector");
    let cell_selector = Selector::parse("td").expect("static selector");
    let anchor_selector = Selector::parse("a").expect("static selector");

    let rows: Vec<_> = {
        let body_rows: Vec<_> = table.select(&tbody_selector).collect();
        if body_rows.is_empty() {
            table
                .select(&row_selector)
                .filter(|row| row.select(&cell_selector).count() >= 9)
                .collect()
        } else {
            body_rows
        }
    };

    let host = host_label(base);
    let mut results = Vec::new();
    let mut rows_returned = 0usize;
    let mut unsupported_rows = 0usize;
    for row in rows {
        let cells: Vec<_> = row.select(&cell_selector).collect();
        if cells.len() < 9 {
            continue;
        }
        rows_returned += 1;

        let title = cells[0]
            .select(&anchor_selector)
            .next()
            .map(|anchor| normalize(&anchor.text().collect::<String>()))
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| normalize(&cells[0].text().collect::<String>()));

        let authors = normalize(&cells[1].text().collect::<String>())
            .split(';')
            .map(|author| author.trim().to_owned())
            .filter(|author| !author.is_empty())
            .collect::<Vec<_>>();

        let publisher = text_of(&cells[2]);
        let year = parse_year(text_of(&cells[3]).as_deref().unwrap_or(""));
        let language = text_of(&cells[4]);
        let pages = parse_pages(text_of(&cells[5]).as_deref().unwrap_or(""));
        let size_cell = &cells[6];
        let size_text = normalize(&size_cell.text().collect::<String>());
        let file_id = size_cell
            .select(&anchor_selector)
            .next()
            .and_then(|anchor| anchor.value().attr("href"))
            .and_then(parse_file_id);
        let extension = normalize(&cells[7].text().collect::<String>()).to_ascii_lowercase();

        if title.is_empty() {
            continue;
        }
        if !matches!(extension.as_str(), "epub" | "pdf") {
            unsupported_rows += 1;
            continue;
        }

        let mut md5 = None;
        let mut links = Vec::new();
        for anchor in cells[8].select(&anchor_selector) {
            let Some(href) = anchor.value().attr("href") else {
                continue;
            };
            // Only the LG+ ads.php endpoint is an in-app acquisition path.
            // Randombook, libgen.pw, libgen.me and Anna's Archive are dropped.
            if !href.contains("ads.php") {
                continue;
            }
            let url = absolute(base, href);
            if md5.is_none() {
                md5 = parse_md5(href);
            }
            if links.iter().any(|link: &MirrorLink| link.url == url) {
                continue;
            }
            let label = host_label(&url);
            links.push(MirrorLink { label, url });
        }

        let Some(md5) = md5 else {
            continue;
        };
        expand_libgen_mirrors(&mut links, base, &md5);

        results.push(LibgenResult {
            md5,
            title,
            authors,
            publisher,
            year,
            language,
            pages,
            size_text: size_text.clone(),
            size_bytes: parse_size(&size_text),
            extension,
            file_id,
            source: host.clone(),
            mirrors: links,
        });
    }

    let parsed_total = parse_total(body);
    let total_is_exact = parsed_total.is_some();
    let total = parsed_total.unwrap_or(results.len() as u64);

    if results.is_empty() && rows_returned == 0 && (!total_is_exact || total == 0) {
        return ParseOutcome::Empty;
    }

    ParseOutcome::Page(ParsedSearchPage {
        results,
        total,
        total_is_exact,
        rows_returned,
        unsupported_rows,
    })
}

/// A live LG+ result only prints the ads link for the host that answered. The
/// md5 is portable, so expand it to every compiled mirror in failover order and
/// let the download queue retry the file on each one.
fn expand_libgen_mirrors(links: &mut Vec<MirrorLink>, base: &str, md5: &str) {
    if !BOOTSTRAP_MIRRORS
        .iter()
        .any(|mirror| host_label(mirror) == host_label(base))
    {
        return;
    }
    let mut ordered = Vec::with_capacity(BOOTSTRAP_MIRRORS.len());
    for mirror in BOOTSTRAP_MIRRORS {
        let label = host_label(mirror);
        let link = links
            .iter()
            .find(|link| host_label(&link.url) == label)
            .cloned()
            .unwrap_or_else(|| MirrorLink {
                label: label.clone(),
                url: format!("{}/ads.php?md5={md5}", mirror.trim_end_matches('/')),
            });
        ordered.push(link);
    }
    *links = ordered;
}

fn text_of(cell: &scraper::ElementRef<'_>) -> Option<String> {
    let text = normalize(&cell.text().collect::<String>());
    (!text.is_empty()).then_some(text)
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_year(value: &str) -> Option<u16> {
    let digits: String = value
        .chars()
        .skip_while(|ch| !ch.is_ascii_digit())
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    let year = digits.parse::<u16>().ok()?;
    (1000..=2100).contains(&year).then_some(year)
}

fn parse_pages(value: &str) -> Option<u32> {
    let digits: String = value.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let pages = digits.parse::<u32>().ok()?;
    (pages > 0).then_some(pages)
}

fn parse_file_id(href: &str) -> Option<u64> {
    let start = href.find("id=")? + 3;
    href[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}

fn parse_md5(href: &str) -> Option<String> {
    let start = href.find("md5=")? + 4;
    let candidate: String = href[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_hexdigit())
        .collect();
    (candidate.len() == 32).then(|| candidate.to_ascii_lowercase())
}

fn parse_size(text: &str) -> Option<u64> {
    let lower = text.trim().to_ascii_lowercase().replace(',', ".");
    let number: String = lower
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect();
    let value = number.parse::<f64>().ok()?;
    let multiplier = if lower.contains("gb") {
        1_000_000_000.0
    } else if lower.contains("mb") {
        1_000_000.0
    } else if lower.contains("kb") {
        1_000.0
    } else {
        1.0
    };
    let bytes = (value * multiplier).round();
    (bytes > 0.0).then_some(bytes as u64)
}

fn parse_total(body: &str) -> Option<u64> {
    // The badge is `Files <span class="badge badge-primary">43</span>`.
    // Search for that exact shape; "Files" also appears in the navigation and
    // the search-form labels.
    let index = body.find("Files <span")?;
    let rest = &body[index..];
    let open = rest.find('>')?;
    let after = &rest[open + 1..];
    let digits: String = after.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn absolute(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        href.to_owned()
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            href.trim_start_matches('/')
        )
    }
}

fn host_label(url: &str) -> String {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(without_scheme)
        .trim_start_matches("www.")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_spaces_and_brackets() {
        assert_eq!(encode("Rock Paper"), "Rock+Paper");
        assert_eq!(encode("columns[]"), "columns%5B%5D");
    }

    #[test]
    fn md5_search_uses_google_mode() {
        let query = SearchQuery {
            md5: "A1423442916F2F3DEF9517A3BF4DEE48".into(),
            ..SearchQuery::default()
        };
        let url = search_url("https://libgen.li/", &query);
        assert_eq!(
            url,
            "https://libgen.li/index.php?req=md5%3Aa1423442916f2f3def9517a3bf4dee48&gmode=1&res=25"
        );
    }

    #[test]
    fn title_author_page_url() {
        let query = SearchQuery {
            title: "Rock Paper Scissors".into(),
            author: "Alice Feeney".into(),
            page: 2,
            ..SearchQuery::default()
        };
        let url = search_url("https://libgen.bz", &query);
        assert!(url.contains("columns%5B%5D=t"));
        assert!(url.contains("columns%5B%5D=a"));
        assert!(url.contains("topics%5B%5D=l"));
        assert!(url.contains("topics%5B%5D=f"));
        assert!(url.contains("topics%5B%5D=r"));
        assert!(url.ends_with("res=25&page=2"));
    }

    #[test]
    fn basic_query_is_scoped_to_title_and_author_and_books() {
        let query = SearchQuery {
            query: "1984".into(),
            ..SearchQuery::default()
        };
        let url = search_url("https://libgen.li/", &query);
        assert_eq!(
            url,
            "https://libgen.li/index.php?req=1984&columns%5B%5D=t&columns%5B%5D=a&topics%5B%5D=l&topics%5B%5D=f&topics%5B%5D=r&res=25"
        );
    }

    #[test]
    fn publisher_search_stays_in_the_publisher_column() {
        let query = SearchQuery {
            publisher: "HarperCollins".into(),
            ..SearchQuery::default()
        };
        let url = search_url("https://libgen.li", &query);
        assert!(url.contains("req=HarperCollins&columns%5B%5D=p&"));
        assert!(!url.contains("columns%5B%5D=t"));
        assert!(!url.contains("columns%5B%5D=a"));
    }

    #[test]
    fn isbn_search_strips_hyphens_and_spaces() {
        for (input, expected) in [
            ("978-0-00-837100-5", "9780008371005"),
            (" 978 0 00 837100 5 ", "9780008371005"),
            ("0-00-837100-x", "000837100X"),
        ] {
            let query = SearchQuery {
                isbn: input.into(),
                ..SearchQuery::default()
            };
            let url = search_url("https://libgen.li", &query);
            assert_eq!(
                url,
                format!("https://libgen.li/index.php?req={expected}&columns%5B%5D=i&res=25"),
                "{input} should normalise to {expected}"
            );
        }
    }

    #[test]
    fn counts_rows_dropped_for_unsupported_formats() {
        let body = include_str!("../../tests/fixtures/libgen-rock-paper-scissors.html");
        let ParseOutcome::Page(page) = parse_search_page(body, "https://libgen.li") else {
            panic!("expected a search page");
        };
        assert_eq!(page.rows_returned, 25);
        assert_eq!(page.unsupported_rows, 7);
        assert_eq!(page.results.len(), 18);
    }

    #[test]
    fn parses_human_sizes() {
        assert_eq!(parse_size("3 MB"), Some(3_000_000));
        assert_eq!(parse_size("783 kB"), Some(783_000));
        assert_eq!(parse_size("1.2 GB"), Some(1_200_000_000));
    }

    #[test]
    fn a_live_result_expands_to_every_compiled_download_mirror() {
        let body = include_str!("../../tests/fixtures/libgen-rock-paper-scissors.html");
        let ParseOutcome::Page(page) = parse_search_page(body, "https://libgen.li") else {
            panic!("expected a search page");
        };
        let result = page
            .results
            .iter()
            .find(|result| result.md5 == "a1423442916f2f3def9517a3bf4dee48")
            .expect("the Flatiron EPUB");
        assert_eq!(result.mirrors.len(), 5);
        let hosts: Vec<&str> = result
            .mirrors
            .iter()
            .map(|mirror| mirror.label.as_str())
            .collect();
        assert_eq!(
            hosts,
            vec![
                "libgen.li",
                "libgen.bz",
                "libgen.vg",
                "libgen.la",
                "libgen.gl"
            ]
        );
        assert!(result.mirrors.iter().all(|mirror| {
            mirror
                .url
                .contains("ads.php?md5=a1423442916f2f3def9517a3bf4dee48")
        }));
    }
}
