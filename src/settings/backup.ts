import type { BackupImport, BackupReport } from "../platform";

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function backupReportNotice(report: BackupReport): string {
  if (report.mode === "replace") {
    const cleared =
      report.replaced === 1
        ? "1 previous book cleared"
        : `${report.replaced} previous books cleared`;
    return `Library data replaced: ${report.new} new, ${report.matched} matched, ${cleared}. No book files were moved.`;
  }
  const skipped =
    report.skipped > 0
      ? `, ${report.skipped} newer reading position${report.skipped === 1 ? "" : "s"} kept`
      : "";
  return `Merge complete: ${report.new} new, ${report.matched} matched${skipped}. Nothing was deleted.`;
}

export function backupImportNotice(outcome: BackupImport): string {
  const summary = backupReportNotice(outcome.report);
  if (outcome.scanError) {
    return `${summary} Rescan after import could not run: ${outcome.scanError}`;
  }
  if (!outcome.scan) return summary;
  const linked =
    outcome.scan.relinked > 0
      ? outcome.scan.relinked === 1
        ? "1 imported book linked to its file"
        : `${outcome.scan.relinked} imported books linked to their files`
      : null;
  const details = [
    linked,
    outcome.scan.added > 0
      ? `${outcome.scan.added} new book${outcome.scan.added === 1 ? "" : "s"} found`
      : null,
    outcome.scan.removed > 0
      ? `${outcome.scan.removed} missing book${outcome.scan.removed === 1 ? "" : "s"} marked finished`
      : null,
  ].filter(Boolean);
  const result =
    details.length > 0
      ? details.join(", ")
      : `${outcome.scan.total} books on the shelves`;
  return `${summary} Rescan after import: ${result}.`;
}

