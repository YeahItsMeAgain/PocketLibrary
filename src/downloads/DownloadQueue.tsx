import { useState } from "react";

import type { Download } from "../platform";
import { ReportAction } from "../Diagnostics";
import { downloadPercent, downloadStatusText } from "./format";

export function DownloadProgress({ download }: { download: Download }) {
  const percent = downloadPercent(download);
  return (
    <div
      className="download-progress"
      data-testid="download-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={`Download ${percent}%`}
    >
      <span className="download-progress-fill" style={{ width: `${percent}%` }} />
      <span className="download-progress-label">{percent}%</span>
    </div>
  );
}

interface DownloadQueueProps {
  downloads: Download[];
  onCancel: (download: Download) => void;
  onRetry: (download: Download) => void;
}

export function DownloadQueue({
  downloads,
  onCancel,
  onRetry,
}: DownloadQueueProps) {
  const [queueOpen, setQueueOpen] = useState(true);

  if (downloads.length === 0) return null;

  return (
    <section
      className="download-queue"
      data-testid="download-queue"
      aria-labelledby="download-queue-heading"
    >
      <div className="download-queue-head">
        <h3 id="download-queue-heading">The delivery hatch</h3>
        <span className="download-badge" data-testid="download-badge">
          {downloads.filter(
            (download) =>
              download.state === "queued" || download.state === "running",
          ).length}{" "}
          active
        </span>
        <button
          type="button"
          className="download-queue-toggle"
          data-testid="download-queue-toggle"
          aria-expanded={queueOpen}
          onClick={() => setQueueOpen((open) => !open)}
        >
          {queueOpen ? "Hide" : "Show"}
        </button>
      </div>
      {queueOpen ? (
        <ul className="download-queue-list">
          {downloads.map((download) => (
            <li
              key={download.id}
              className={`download-row is-${download.state}`}
              data-testid="download-row"
            >
              <div className="download-row-main">
                <span className="download-row-title">{download.title}</span>
                <span
                  className="download-row-status"
                  data-testid="download-status"
                >
                  {downloadStatusText(download)}
                </span>
                {download.state === "running" ? (
                  <DownloadProgress download={download} />
                ) : null}
              </div>
              {download.state === "queued" ||
              download.state === "running" ? (
                <button
                  type="button"
                  className="download-cancel"
                  data-testid="download-cancel"
                  onClick={() => onCancel(download)}
                >
                  Cancel
                </button>
              ) : download.state === "failed" ||
                download.state === "cancelled" ? (
                <>
                  <button
                    type="button"
                    className="download-retry"
                    data-testid="download-retry"
                    onClick={() => onRetry(download)}
                  >
                    Retry
                  </button>
                  {download.state === "failed" ? (
                    <ReportAction
                      testId="download-queue-report"
                      label="Report"
                      className="download-report"
                    />
                  ) : null}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
