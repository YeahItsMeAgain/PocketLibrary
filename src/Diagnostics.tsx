import { useCallback, useState } from "react";

import { diagnosticsResultNotice, noteFailure } from "./diagnostics";
import { platform } from "./platform";

interface ReportActionProps {
  /** Stable test id for the button. */
  testId: string;
  label?: string;
  className?: string;
}

/**
 * One tap from any failure surface to the same diagnostics export used in
 * Settings. The result is a short status line, not a path.
 */
export function ReportAction({
  testId,
  label = "Report",
  className = "secondary-action",
}: ReportActionProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const report = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await platform.sendDiagnostics();
      setNotice(diagnosticsResultNotice(result));
    } catch {
      noteFailure();
      setNotice("Diagnostics could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <span className="report-action">
      <button
        type="button"
        className={className}
        data-testid={testId}
        disabled={busy}
        onClick={() => void report()}
      >
        {busy ? "Preparing…" : label}
      </button>
      {notice ? (
        <span
          className="report-notice"
          role="status"
          data-testid={`${testId}-notice`}
        >
          {notice}
        </span>
      ) : null}
    </span>
  );
}
