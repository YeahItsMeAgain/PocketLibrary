import { useCallback, useEffect, useRef, useState } from "react";

import { isApiError, platform } from "../platform";
import { noteFailure } from "../diagnostics";
import type { UpdateCheckController } from "../updates/useUpdateCheck";
import {
  extractHighlights,
  parseReleaseNotes,
  type ReleaseNoteBlock,
} from "../updates/updateNotes";
import "./UpdateSection.css";

interface DownloadProgress {
  downloaded: number;
  total: number;
}

/** Human bytes for the download line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A stable release date, independent of the machine's locale. */
export function formatUpdateDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

function ReleaseNoteBlocks({ blocks }: { blocks: ReleaseNoteBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading =
            block.level <= 2 ? "h4" : block.level <= 4 ? "h5" : "h6";
          return <Heading key={`heading-${index}`}>{block.text}</Heading>;
        }
        if (block.type === "list") {
          return (
            <ul key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={`paragraph-${index}`}>{block.text}</p>;
      })}
    </>
  );
}

interface UpdateSectionProps {
  update: UpdateCheckController;
  updateFocusRequest: number;
}

export function UpdateSection({
  update,
  updateFocusRequest,
}: UpdateSectionProps) {
  const {
    info,
    checking,
    error: checkError,
    lastChecked,
    downloaded,
  } = update;
  const setDownloaded = update.setDownloaded;
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installStarted, setInstallStarted] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A check is shared with the banner. When its result changes, any per-check
  // install state and download line are stale; the verified download itself is
  // kept by app-shell state if it belongs to this version.
  useEffect(() => {
    setInstallStarted(false);
    setInstallError(null);
    setPermissionNeeded(false);
    setDownloadError(null);
    setProgress(null);
  }, [info]);

  useEffect(() => {
    if (updateFocusRequest <= 0) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    heading.scrollIntoView({
      block: "start",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [updateFocusRequest]);

  const startDownload = useCallback(async () => {
    if (!info?.available || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    setInstallStarted(false);
    setInstallError(null);
    setPermissionNeeded(false);
    setProgress({ downloaded: 0, total: info.size ?? 0 });
    try {
      const result = await platform.downloadUpdate((event) => {
        if (event.event === "started") {
          setProgress({ downloaded: 0, total: event.data.total });
        } else if (event.event === "progress") {
          setProgress((current) => ({
            downloaded: event.data.downloaded,
            total: event.data.contentLength ?? current?.total ?? 0,
          }));
        } else {
          setProgress({
            downloaded: event.data.bytes,
            total: event.data.bytes,
          });
        }
      });
      setDownloaded(result);
      setProgress({ downloaded: result.bytes, total: result.bytes });
    } catch (error) {
      noteFailure();
      setProgress(null);
      setDownloadError(
        errorMessage(
          error,
          "The update could not be downloaded. Check your connection and try again.",
        ),
      );
    } finally {
      setDownloading(false);
    }
  }, [downloading, info, setDownloaded]);

  const installNow = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    setInstallError(null);
    setPermissionNeeded(false);
    try {
      await platform.installUpdate();
      setInstallStarted(true);
    } catch (error) {
      if (isApiError(error) && error.code === "installPermission") {
        setPermissionNeeded(true);
      } else {
        noteFailure();
        setInstallError(
          errorMessage(
            error,
            "Android could not open the installer. Please try again.",
          ),
        );
      }
    } finally {
      setInstalling(false);
    }
  }, [installing]);

  const busy = checking || downloading || installing;
  const percent =
    progress && progress.total > 0
      ? Math.min(
          100,
          Math.round((progress.downloaded / progress.total) * 100),
        )
      : 0;

  let statusText: string;
  if (checking) {
    statusText = "Checking for updates…";
  } else if (checkError) {
    statusText = "The update check failed.";
  } else if (info?.available) {
    statusText = `Version ${info.latestVersion ?? "newer"} is available.`;
  } else if (info) {
    statusText = "You're up to date.";
  } else {
    statusText = "Not checked yet.";
  }

  const hasNotes = Boolean(info?.notes?.trim());
  const noteBlocks = hasNotes ? parseReleaseNotes(info?.notes) : [];
  const noteHighlights = hasNotes ? extractHighlights(info?.notes) : [];

  return (
    <section
      className="settings-section update-section"
      aria-labelledby="settings-updates"
      data-testid="settings-updates"
    >
      <h3
        ref={headingRef}
        id="settings-updates"
        tabIndex={-1}
      >
        Updates
      </h3>
      <p className="settings-note">
        Checks the release manifest when the app opens. Nothing downloads until
        you ask, and Android always shows its own install prompt.
      </p>
      <dl className="settings-list">
        <div className="setting-row">
          <dt>Current version</dt>
          <dd data-testid="update-current-version">
            {info?.currentVersion ? `v${info.currentVersion}` : "…"}
          </dd>
        </div>
        {info?.available ? (
          <>
            <div className="setting-row">
              <dt>Available</dt>
              <dd data-testid="update-latest-version">
                v{info.latestVersion ?? "newer"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Released</dt>
              <dd data-testid="update-date">
                {formatUpdateDate(info.pubDate) || "Unknown"}
              </dd>
            </div>
            <div className="setting-row">
              <dt>Size</dt>
              <dd data-testid="update-size">
                {typeof info.size === "number"
                  ? formatBytes(info.size)
                  : "Unknown"}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      <p
        className="update-status"
        role="status"
        aria-live="polite"
        data-testid="update-status"
      >
        {statusText}
      </p>
      {lastChecked ? (
        <p className="settings-note" data-testid="update-last-checked">
          Last checked{" "}
          {lastChecked.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      ) : null}

      {checkError ? (
        <p
          className="action-error update-error"
          role="alert"
          data-testid="update-error"
        >
          {checkError}
        </p>
      ) : null}

      {info?.available && hasNotes ? (
        <div className="update-notes" data-testid="update-notes">
          <p className="update-notes-title">What's new</p>
          <ul className="update-highlights" data-testid="update-highlights">
            {noteHighlights.map((highlight, index) => (
              <li key={`${index}-${highlight}`}>{highlight}</li>
            ))}
          </ul>
          {noteBlocks.length > 0 ? (
            <details
              className="update-notes-details"
              data-testid="update-notes-details"
            >
              <summary data-testid="update-notes-toggle">
                Full release notes
              </summary>
              <div
                className="update-notes-full"
                data-testid="update-notes-full"
              >
                <ReleaseNoteBlocks blocks={noteBlocks} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {downloading || (progress && downloaded) ? (
        <div className="update-download">
          <div
            className="update-progress"
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={progress?.total ?? 0}
            aria-valuenow={progress?.downloaded ?? 0}
            aria-valuetext={`${percent}%`}
            data-testid="update-progress"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p
            className="settings-note update-progress-text"
            aria-live="polite"
            data-testid="update-progress-text"
          >
            {downloading
              ? `Downloading… ${formatBytes(progress?.downloaded ?? 0)} of ${formatBytes(progress?.total ?? 0)}`
              : `Downloaded ${formatBytes(downloaded?.bytes ?? 0)}. Ready to install.`}
          </p>
        </div>
      ) : null}

      {downloadError ? (
        <p
          className="action-error update-error"
          role="alert"
          data-testid="update-download-error"
        >
          {downloadError}
        </p>
      ) : null}

      {permissionNeeded ? (
        <div
          className="update-permission"
          role="alert"
          data-testid="update-permission"
        >
          <p>
            Android needs permission to install unknown apps. Open the settings
            screen, allow it for PocketLibrary, then come back and retry.
          </p>
          <button
            type="button"
            className="primary-action"
            data-testid="update-retry-install"
            disabled={installing}
            onClick={() => void installNow()}
          >
            {installing ? "Opening…" : "Retry install"}
          </button>
        </div>
      ) : null}

      {installError ? (
        <p
          className="action-error update-error"
          role="alert"
          data-testid="update-install-error"
        >
          {installError}
        </p>
      ) : null}

      {installStarted ? (
        <p
          className="settings-note update-notice"
          role="status"
          data-testid="update-install-notice"
        >
          Installer opened. Follow Android's prompts to finish the update.
        </p>
      ) : null}

      <div className="settings-actions update-actions">
        <button
          type="button"
          className="secondary-action"
          data-testid="update-check"
          disabled={busy}
          onClick={() => void update.runCheck(true)}
        >
          {checking ? "Checking…" : checkError ? "Try check again" : "Check for updates"}
        </button>
        {info?.available && !downloaded ? (
          <button
            type="button"
            className="primary-action"
            data-testid="update-download"
            disabled={busy}
            onClick={() => void startDownload()}
          >
            {downloading
              ? `Downloading… ${percent}%`
              : downloadError
                ? "Try download again"
                : "Download update"}
          </button>
        ) : null}
        {downloaded ? (
          <button
            type="button"
            className="primary-action"
            data-testid="update-install"
            disabled={busy || permissionNeeded}
            onClick={() => void installNow()}
          >
            {installing ? "Opening installer…" : `Install v${downloaded.version}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
