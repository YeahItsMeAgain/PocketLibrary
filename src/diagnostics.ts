/**
 * Small helpers shared by the diagnostics surfaces.
 *
 * The log itself lives in core; this module only decides when to nudge the
 * reader and how to turn a summary into friendly prose.
 */
import {
  platform,
  type AppInfo,
  type DiagnosticsExport,
  type DiagnosticsSummary,
} from "./platform";

export const DIAGNOSTICS_HINT_EVENT = "pocketlibrary:diagnostics-hint";

const HINT_KEY = "pocketlibrary.diagnosticsHintShown";
const HINT_AFTER_FAILURES = 3;

let sessionFailures = 0;
let captureInstalled = false;

/**
 * Count a user-visible failure. On the third one this session, fire a
 * one-time hint event; the seen flag is stored so a reload stays quiet.
 */
export function noteFailure(): boolean {
  sessionFailures += 1;
  let shown = false;
  try {
    shown = window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    shown = false;
  }
  if (shown || sessionFailures < HINT_AFTER_FAILURES) return false;
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // The hint is a nicety; private storage only means it may return.
  }
  window.dispatchEvent(new CustomEvent(DIAGNOSTICS_HINT_EVENT));
  return true;
}

/** Friendly result line for a share/save attempt. */
export function diagnosticsResultNotice(result: DiagnosticsExport): string {
  if (result.cancelled) {
    return result.method === "share"
      ? "Sharing cancelled. Nothing left the app."
      : "Export cancelled. Nothing was written.";
  }
  if (result.method === "share") {
    return "Diagnostics handed to the share sheet.";
  }
  return `Saved diagnostics to ${result.fileName}.`;
}

/** Human bytes for the Settings line. */
export function formatLogSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The short text behind "Copy summary". */
export function diagnosticsSummaryText(
  info: AppInfo | null,
  summary: DiagnosticsSummary,
): string {
  const version = info
    ? `${info.name} v${info.appVersion} (schema ${info.schemaVersion})`
    : "PocketLibrary";
  const last = summary.lastError
    ? summary.lastError.length > 300
      ? `${summary.lastError.slice(0, 300)}…`
      : summary.lastError
    : "none";
  return [
    version,
    `${summary.errors} ${summary.errors === 1 ? "error" : "errors"}, ${summary.warnings} ${summary.warnings === 1 ? "warning" : "warnings"} · log ${formatLogSize(summary.logBytes)}`,
    `Last error: ${last}`,
  ].join("\n");
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand?.("copy") ?? false;
  area.remove();
  if (!copied) throw new Error("clipboard unavailable");
}

/** Build and copy the summary, throwing if the browser refuses both paths. */
export async function copyDiagnosticsSummary(): Promise<string> {
  const [info, summary] = await Promise.all([
    platform.appInfo().catch(() => null),
    platform.diagnosticsSummary(),
  ]);
  const text = diagnosticsSummaryText(info, summary);
  await writeClipboard(text);
  return text;
}

/**
 * Record uncaught JS errors and unhandled rejections in the local log. Called
 * once from the entry point; command failures are already logged by the
 * platform adapter.
 */
export function installDiagnosticsCapture(): void {
  if (captureInstalled || typeof window === "undefined") return;
  captureInstalled = true;
  window.addEventListener("error", (event) => {
    const detail = `${event.message} (${event.filename || "unknown"}:${event.lineno}:${event.colno})`;
    void platform
      .logDiagnostic("error", "js_error", detail)
      .catch(() => {});
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const detail =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : typeof reason === "string"
          ? reason
          : (() => {
              try {
                return JSON.stringify(reason);
              } catch {
                return String(reason);
              }
            })();
    void platform
      .logDiagnostic("error", "js_unhandled_rejection", detail)
      .catch(() => {});
  });
}
