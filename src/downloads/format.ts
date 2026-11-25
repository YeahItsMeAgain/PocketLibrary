import type { Download } from "../platform";

export function downloadPercent(download: Download): number {
  if (download.state === "completed") return 100;
  if (!download.totalBytes || download.totalBytes <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((download.bytes / download.totalBytes) * 100)),
  );
}

export function downloadStatusText(download: Download): string {
  switch (download.state) {
    case "queued":
      return "Queued";
    case "running":
      return download.error ?? `Downloading ${downloadPercent(download)}%`;
    case "completed":
      return download.errorCode === "duplicate"
        ? "Already in your library"
        : "Added to library";
    case "failed":
      return download.error ?? "The download failed.";
    case "cancelled":
      return "Cancelled";
  }
}
