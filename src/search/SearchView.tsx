import { useCallback, useEffect, useState } from "react";

import {
  isApiError,
  platform,
  type ApiError,
  type Download,
  type DownloadRequest,
  type LibgenResult,
  type SearchPage,
  type SearchQuery,
} from "../platform";
import { ReportAction } from "../Diagnostics";
import { noteFailure } from "../diagnostics";
import { DownloadQueue } from "../downloads/DownloadQueue";
import {
  EMPTY_SEARCH_FORM,
  SEARCH_FORMATS,
  SEARCH_LANGUAGES,
  type SearchForm,
  hasSearchTerm,
  searchErrorCopy,
  searchQueryFrom,
  supportedBookFormat,
} from "./query";
import { ResultDetail } from "./ResultDetail";

function SearchResultRow({
  result,
  onOpen,
}: {
  result: LibgenResult;
  onOpen: () => void;
}) {
  const author = result.authors.join("; ") || "Author unknown";
  return (
    <li>
      <button
        type="button"
        className="search-result"
        data-testid="search-result"
        onClick={onOpen}
      >
        <span className="search-result-title">{result.title}</span>
        <span className="search-result-meta">
          <span>{author}</span>
          <span>{result.year ?? "Year unknown"}</span>
          <span>{result.extension.toUpperCase()}</span>
          <span>{result.sizeText || "Size unknown"}</span>
          <span className="search-result-source">{result.source}</span>
        </span>
      </button>
    </li>
  );
}


interface SearchViewProps {
  onBack: () => void;
  downloads: Download[];
  onRefreshDownloads: () => Promise<Download[]>;
}

export function SearchView({
  onBack,
  downloads,
  onRefreshDownloads,
}: SearchViewProps) {
  const [form, setForm] = useState<SearchForm>(EMPTY_SEARCH_FORM);
  const [advanced, setAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState<SearchQuery | null>(null);
  const [pageData, setPageData] = useState<SearchPage | null>(null);
  const [selected, setSelected] = useState<LibgenResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (field: keyof SearchForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const downloadFor = (result: LibgenResult) =>
    downloads.find(
      (download) => download.md5.toLowerCase() === result.md5.toLowerCase(),
    ) ?? null;

  const enqueue = async (result: LibgenResult) => {
    const format = supportedBookFormat(result.extension);
    if (!format) {
      setError({
        code: "unsupported_format",
        message: `Pocket Library reads EPUB and PDF only. This edition is a ${result.extension.toUpperCase()} file.`,
      });
      return;
    }
    const mirrors = result.mirrors
      .filter((link) => link.url.includes("ads.php"))
      .map((link) => link.url);
    const request: DownloadRequest = {
      md5: result.md5,
      title: result.title,
      authors: result.authors,
      year: result.year,
      format,
      source: result.source,
      mirrorUrls: mirrors.length > 0 ? mirrors : result.mirrors.map((link) => link.url),
    };
    try {
      await platform.enqueueDownload(request);
      await onRefreshDownloads().catch(() => {});
    } catch (rejection) {
      noteFailure();
      setError(
        isApiError(rejection)
          ? rejection
          : {
              code: "unknown",
              message: "The download could not be queued.",
            },
      );
    }
  };

  const cancelDownload = async (download: Download) => {
    try {
      await platform.cancelDownload(download.id);
      await onRefreshDownloads();
    } catch {
      // The next poll corrects the row.
    }
  };

  const retryDownload = async (download: Download) => {
    try {
      await platform.retryDownload(download.id);
      await onRefreshDownloads();
    } catch {
      // The next poll corrects the row.
    }
  };

  const runSearch = useCallback(
    async (query: SearchQuery) => {
      setBusy(true);
      setError(null);
      setSelected(null);
      try {
        const next = await platform.searchLibgen(query);
        setPageData(next);
        setSubmitted(query);
      } catch (rejection) {
        setPageData(null);
        noteFailure();
        setError(
          isApiError(rejection)
            ? rejection
            : {
                code: "unknown",
                message: "The front desk could not be reached.",
              },
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const submit = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!hasSearchTerm(form) || busy) return;
    void runSearch(searchQueryFrom(form, 1));
  };

  const turnPage = (nextPage: number) => {
    if (!submitted || busy || nextPage < 1) return;
    void runSearch({ ...submitted, page: nextPage });
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const canSearch = hasSearchTerm(form) && !busy;
  const total = pageData?.total ?? 0;
  const unsupportedRows = pageData?.unsupportedRows ?? 0;
  const hasNextPage =
    pageData !== null &&
    (pageData.totalIsExact
      ? pageData.page * pageData.perPage < total
      : pageData.rowsReturned === pageData.perPage);
  const hiddenByFilters =
    pageData !== null && pageData.filtersApplied
      ? Math.max(0, pageData.onPageBeforeFilters - pageData.results.length)
      : 0;
  const showPager =
    pageData !== null && (pageData.page > 1 || hasNextPage);
  const clearFilters = () => {
    if (busy) return;
    const next = { ...form, format: "", language: "", yearFrom: "", yearTo: "" };
    setForm(next);
    if (hasSearchTerm(next)) void runSearch(searchQueryFrom(next, 1));
  };
  const pager = pageData && showPager ? (
    <nav className="search-pager" aria-label="Result pages">
      <button
        type="button"
        className="secondary-action"
        data-testid="search-prev"
        disabled={busy || pageData.page <= 1}
        onClick={() => turnPage(pageData.page - 1)}
      >
        Previous
      </button>
      <span data-testid="search-page">Page {pageData.page}</span>
      <button
        type="button"
        className="secondary-action"
        data-testid="search-next"
        disabled={busy || !hasNextPage}
        onClick={() => turnPage(pageData.page + 1)}
      >
        Next
      </button>
    </nav>
  ) : null;

  return (
    <main
      id="library-main"
      className="search-view search-main"
      data-testid="search-view"
    >
      <section className="search-card">
        <button
          type="button"
          className="settings-back"
          data-testid="search-back"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span> Back to shelf
        </button>
        <p className="kicker">The Acquisition Desk</p>
        <h2>Search Libgen</h2>
        <div className="rule" aria-hidden="true">
          <span>❧</span>
        </div>
        <p className="search-intro">
          Ask the five LG+ mirrors at once. Searches cover titles and authors
          and return books only; comics, magazines and standards are excluded.
          Formats, language and years are filtered here, because Libgen ignores
          those fields.
        </p>

        <form className="search-form" onSubmit={submit}>
          <label className="search-field search-field-wide" htmlFor="search-query">
            <span>Title or author</span>
            <input
              id="search-query"
              data-testid="search-query"
              type="search"
              value={form.query}
              placeholder="e.g. Rock Paper Scissors"
              autoComplete="off"
              onChange={(event) => update("query", event.target.value)}
            />
          </label>

          <button
            type="button"
            className="search-advanced-toggle"
            data-testid="search-advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced((open) => !open)}
          >
            {advanced ? "Hide advanced fields" : "Advanced fields"}
            <span aria-hidden="true">{advanced ? " ▴" : " ▾"}</span>
          </button>

          <div className="search-advanced" hidden={!advanced}>
            <label className="search-field">
              <span>Title</span>
              <input
                data-testid="search-title"
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Author</span>
              <input
                data-testid="search-author"
                value={form.author}
                onChange={(event) => update("author", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year from</span>
              <input
                data-testid="search-year-from"
                inputMode="numeric"
                value={form.yearFrom}
                onChange={(event) => update("yearFrom", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Year to</span>
              <input
                data-testid="search-year-to"
                inputMode="numeric"
                value={form.yearTo}
                onChange={(event) => update("yearTo", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>Language</span>
              <select
                data-testid="search-language"
                value={form.language}
                onChange={(event) => update("language", event.target.value)}
              >
                <option value="">Any language</option>
                {SEARCH_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Format</span>
              <select
                data-testid="search-format"
                value={form.format}
                onChange={(event) => update("format", event.target.value)}
              >
                <option value="">Any format</option>
                {SEARCH_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Publisher</span>
              <input
                data-testid="search-publisher"
                value={form.publisher}
                onChange={(event) => update("publisher", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>ISBN</span>
              <input
                data-testid="search-isbn"
                inputMode="numeric"
                value={form.isbn}
                onChange={(event) => update("isbn", event.target.value)}
              />
            </label>
            <label className="search-field">
              <span>MD5</span>
              <input
                data-testid="search-md5"
                value={form.md5}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => update("md5", event.target.value)}
              />
            </label>
          </div>

          <button
            type="submit"
            className="primary-action search-submit"
            data-testid="search-submit"
            disabled={!canSearch}
          >
            {busy ? "Searching the mirrors…" : "Search"}
          </button>
        </form>

        {error ? (
          <div className="search-state" data-testid="search-error" role="alert">
            <h3>{searchErrorCopy(error).title}</h3>
            <p>{searchErrorCopy(error).body}</p>
            <button
              type="button"
              className="secondary-action"
              data-testid="search-retry"
              onClick={() => submit()}
              disabled={!canSearch}
            >
              Try again
            </button>
            <ReportAction testId="search-report" label="Report" />
          </div>
        ) : null}

        {!error && pageData && pageData.results.length === 0 ? (
          <>
            <div className="search-state" data-testid="search-empty">
              <h3>
                {unsupportedRows > 0 && pageData.onPageBeforeFilters === 0
                  ? "No EPUB or PDF on this page"
                  : total === 0
                    ? "No files found"
                    : "0 matches on this page"}
              </h3>
              <p>
                {total === 0 && unsupportedRows === 0
                  ? "The mirrors answered honestly: nothing matches that search."
                  : hiddenByFilters > 0
                    ? `${hiddenByFilters} of ${pageData.onPageBeforeFilters} books on this page were hidden by your filters.${unsupportedRows > 0 ? ` ${unsupportedRows} more were not EPUB or PDF.` : ""}`
                    : unsupportedRows > 0
                      ? `${unsupportedRows} of ${pageData.rowsReturned} rows on this page are not EPUB or PDF, so there is nothing to show here.${hasNextPage ? " Try the next page." : ""}`
                      : pageData.page > 1
                        ? "The mirrors listed more files, but this page arrived empty. Turn back a page."
                        : "The mirrors listed more files, but this page arrived empty."}
              </p>
              {pageData.filtersApplied ? (
                <button
                  type="button"
                  className="secondary-action"
                  data-testid="search-clear-filters"
                  onClick={clearFilters}
                  disabled={busy}
                >
                  Clear format, language and year filters
                </button>
              ) : null}
            </div>
            {pager}
          </>
        ) : null}

        {!error && pageData && pageData.results.length > 0 ? (
          <section className="search-results" aria-labelledby="results-heading">
            <div className="search-summary">
              <h3 id="results-heading">Front desk ledger</h3>
              <p data-testid="search-counts">
                <strong>{total}</strong>{" "}
                {pageData.totalIsExact ? "files" : "or more files"} at Libgen ·{" "}
                {pageData.results.length} shown on this page
                {hiddenByFilters > 0
                  ? ` · ${hiddenByFilters} hidden by your filters`
                  : ""}
                {unsupportedRows > 0
                  ? ` · ${unsupportedRows} non-EPUB/PDF hidden`
                  : ""}
                {" · "}
                answered by {pageData.sourceMirror}
              </p>
            </div>
            <ul className="search-list">
              {pageData.results.map((result) => (
                <SearchResultRow
                  key={result.md5}
                  result={result}
                  onOpen={() => setSelected(result)}
                />
              ))}
            </ul>
            {pager}
          </section>
        ) : null}

        {!error && !pageData ? (
          <p className="search-idle">
            The desk is ready. Search by title or author, or open the advanced
            fields for year, language, format, publisher, ISBN and MD5.
          </p>
        ) : null}
      </section>

      <DownloadQueue
        downloads={downloads}
        onCancel={(download) => void cancelDownload(download)}
        onRetry={(download) => void retryDownload(download)}
      />

      {selected ? (
        <ResultDetail
          result={selected}
          download={downloadFor(selected)}
          onClose={() => setSelected(null)}
          onDownload={() => void enqueue(selected)}
          onCancel={() => {
            const download = downloadFor(selected);
            if (download) void cancelDownload(download);
          }}
          onRetry={() => {
            const download = downloadFor(selected);
            if (download) void retryDownload(download);
          }}
        />
      ) : null}
    </main>
  );
}

