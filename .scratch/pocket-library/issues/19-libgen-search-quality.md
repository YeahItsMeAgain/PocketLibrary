# 19: Libgen search quality

**What to fix:** Libgen search feels unreliable even when the mirrors are up. Search hits the wrong fields, comics crowd out books, filters appear to return nothing, and the UI hides rows without explaining why.

**Status:** resolved

## What was wrong

The mirrors and parser were healthy: the ignored live test still returned
`18 results, total 43, from libgen.li` and the expected Flatiron EPUB. The
problems were in the query the app built and in what it did with each page.

### 1. The basic box searched every field

`search_url` only sent `columns[]` for advanced fields. A basic-box-only query
sent `req=…` with no `columns[]`, which makes LG+ search title, author, series,
year, publisher and ISBN.

Live measurements (2026-11-25):

| Query | No columns (before) | Title only |
|---|---:|---:|
| `1984` | 833,584 | 63,835 |
| `harpercollins` | 154,446 | 487 |
| `Alice Feeney` | 266 | 3 |

So a year-like title matched years, and an author matched every field. The
field was labelled "Title or author" but did not behave that way.

### 2. Comics were included and then silently discarded

No `topics[]` was sent, so LG+ used all topics. Page 1 for `The Hobbit` was
11 cbr, 6 cbz, 5 epub and 3 pdf. The parser keeps only EPUB/PDF, so 17 of 25
rows vanished with no explanation. Restricting to the book topics
(`topics[]=l&topics[]=f&topics[]=r`) gives 22 supported rows on the same page.

### 3. Filters only saw the current 25-row page

Language/format/year are applied after parsing. A filtered page could say
"0 matches on this page" while the badge claimed thousands, and the user had to
page through 25-row windows. This is still true — LG+ has no server-side
language/format/year filter — but the counts now explain the gap.

### 4. The pager depended on rows the parser kept

When the total badge is missing, `hasNextPage` used
`results.length === perPage`. Because unsupported formats are dropped, that
almost never matched, so Next could disappear while more pages existed.

### 5. Hyphenated ISBNs found nothing

`978-0-00-837100-5` returned 0 rows; `9780008371005` returned 17. Only
whitespace was trimmed.

## What changed

- **Basic search is scoped to title + author.** A non-empty basic box always
  contributes `columns[]=t&columns[]=a` (`core/src/acquisition/parse.rs`).
- **Text searches request books only.** The same branch sends
  `topics[]=l&topics[]=f&topics[]=r`, excluding comics, magazines, standards and
  scientific articles. MD5 and ISBN lookups stay exact and unscoped.
- **ISBNs are normalised.** Spaces, hyphens and dash characters are removed
  and the check character is uppercased before the request.
- **Dropped rows are measured.** `SearchPage` now carries `rowsReturned` and
  `unsupportedRows`. The summary reads e.g. `7 non-EPUB/PDF hidden`, and a page
  with no supported rows says why instead of looking like a dead search.
- **Paging uses the raw row count.** With an inexact total, Next stays enabled
  while the mirror returned a full 25-row page.
- **Copy explains the scope.** The intro says searches cover titles/authors and
  return books only.

## Verification

- `cargo test --test acquisition` — 12 passed, 1 network test ignored.
- `cargo test --test acquisition live_search -- --ignored` — `18 results,
  total 43, from libgen.li`, acceptance EPUB present.
- `cargo test` — full core suite passed.
- `cargo clippy --lib` / `--test acquisition` with `-D warnings` — clean.
  (`--all-targets` still trips a pre-existing `useless_format` in
  `tests/annotations.rs:95`, untouched here.)
- `npx tsc --noEmit` — pass.
- `npx playwright test tests/e2e/search.spec.ts` — 16 passed, including new
  cases for the non-EPUB/PDF note, an all-unsupported page, and an inexact-total
  page that still pages forward.
