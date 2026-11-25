import type { Download, LibgenResult } from "../platform";
import { ReportAction } from "../Diagnostics";
import { useLayerExit } from "../navigation";
import { DownloadProgress } from "../downloads/DownloadQueue";
import { downloadStatusText } from "../downloads/format";
import { supportedBookFormat } from "./query";

export function ResultDetail({
  result,
  download,
  onClose,
  onDownload,
  onCancel,
  onRetry,
}: {
  result: LibgenResult;
  download: Download | null;
  onClose: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active =
    download?.state === "queued" || download?.state === "running";
  const supported = supportedBookFormat(result.extension) !== null;
  const close = useLayerExit(true, onClose);
  return (
    <div className="search-sheet-backdrop" onClick={close}>
      <section
        className="search-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Result details"
        data-testid="result-detail"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="search-sheet-head">
          <div>
            <p className="kicker">On the front desk</p>
            <h2>{result.title}</h2>
            <p className="search-sheet-author">
              {result.authors.join("; ") || "Author unknown"}
            </p>
          </div>
          <button
            type="button"
            className="sheet-close"
            data-testid="result-detail-close"
            aria-label="Close result details"
            onClick={close}
          >
            ×
          </button>
        </header>

        <dl className="search-detail-list">
          <div>
            <dt>Year</dt>
            <dd>{result.year ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd>{result.publisher ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{result.language ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{result.pages ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{result.extension.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{result.sizeText || "Unknown"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{result.source}</dd>
          </div>
          <div className="search-detail-md5">
            <dt>MD5</dt>
            <dd>{result.md5}</dd>
          </div>
        </dl>

        <section className="search-mirrors" aria-labelledby="mirror-heading">
          <h3 id="mirror-heading">Mirrors</h3>
          {result.mirrors.length === 0 ? (
            <p className="settings-note">No mirror links were listed.</p>
          ) : (
            <ul>
              {result.mirrors.map((mirror) => (
                <li key={mirror.url} data-testid="mirror-row">
                  <span className="mirror-label">{mirror.label}</span>
                  <span className="mirror-url">{mirror.url}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!supported ? (
          <p
            className="settings-note result-unsupported"
            data-testid="result-unsupported"
          >
            Pocket Library reads EPUB and PDF only. This edition is a{" "}
            {result.extension.toUpperCase()} file, so it cannot be added here.
          </p>
        ) : download ? (
          <div
            className={`result-download-state is-${download.state}`}
            data-testid="result-download-state"
          >
            <p>{downloadStatusText(download)}</p>
            {download.state === "running" || download.state === "queued" ? (
              <DownloadProgress download={download} />
            ) : null}
            {download.errorCode === "duplicate" ? (
              <p className="settings-note">
                The existing copy stays on your shelf; nothing new was added.
              </p>
            ) : null}
            {active ? (
              <button
                type="button"
                className="secondary-action"
                data-testid="result-download-cancel"
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : download.state === "failed" || download.state === "cancelled" ? (
              <>
                <button
                  type="button"
                  className="secondary-action"
                  data-testid="result-download-retry"
                  onClick={onRetry}
                >
                  Retry
                </button>
                {download.state === "failed" ? (
                  <ReportAction
                    testId="download-report"
                    label="Report"
                  />
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="primary-action search-download"
            data-testid="result-download"
            onClick={onDownload}
          >
            Download to library
          </button>
        )}
        <p className="settings-note">
          The file is fetched inside the app, checked for duplicates, named
          “Author - Title (Year)” and placed on the lowest shelf with room.
        </p>
      </section>
    </div>
  );
}

