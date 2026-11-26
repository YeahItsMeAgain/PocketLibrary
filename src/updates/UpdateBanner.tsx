import type { DownloadedUpdate, UpdateCheck } from "../platform";
import { extractHighlights } from "./updateNotes";
import "./UpdateBanner.css";

interface UpdateBannerProps {
  info: UpdateCheck;
  downloaded: DownloadedUpdate | null;
  onSeeUpdate: () => void;
  onDismiss: (version: string) => void;
}

export function UpdateBanner({
  info,
  downloaded,
  onSeeUpdate,
  onDismiss,
}: UpdateBannerProps) {
  const version = info.latestVersion ?? "newer";
  const highlights = extractHighlights(info.notes);
  const downloadedThisVersion = downloaded?.version === info.latestVersion;

  return (
    <aside
      className="update-banner"
      role="status"
      aria-live="polite"
      data-testid="update-banner"
    >
      <div className="update-banner-copy">
        <p className="update-banner-kicker">A new edition is ready</p>
        <p className="update-banner-version">
          PocketLibrary <span>v{version}</span>
        </p>
        <ul className="update-banner-highlights">
          {highlights.map((highlight, index) => (
            <li key={`${index}-${highlight}`}>{highlight}</li>
          ))}
        </ul>
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="update-banner-see"
          data-testid="update-banner-action"
          onClick={onSeeUpdate}
        >
          {downloadedThisVersion ? "See install" : "See update"}
        </button>
        <button
          type="button"
          className="update-banner-dismiss"
          aria-label={`Dismiss update notice for version ${version}`}
          data-testid="update-banner-dismiss"
          onClick={() => onDismiss(version)}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </aside>
  );
}
