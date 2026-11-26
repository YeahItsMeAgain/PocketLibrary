import { useCallback, useEffect, useRef, useState } from "react";

import {
  isApiError,
  platform,
  type DownloadedUpdate,
  type UpdateCheck,
} from "../platform";
import { noteFailure } from "../diagnostics";

export interface UpdateCheckState {
  info: UpdateCheck | null;
  checking: boolean;
  error: string | null;
  lastChecked: Date | null;
  downloaded: DownloadedUpdate | null;
}

export interface UpdateCheckController extends UpdateCheckState {
  /** Run the metadata-only check; manual checks log a failure. */
  runCheck: (manual: boolean) => Promise<void>;
  setDownloaded: (value: DownloadedUpdate | null) => void;
}

const CHECK_ERROR =
  "Couldn't check for updates. Check your connection and try again.";

/**
 * One update check per launch, requested after the shell has painted.
 *
 * The banner and Settings both read the same result. A manual check from
 * Settings refreshes it for both surfaces, but opening Settings never starts a
 * second automatic request.
 */
export function useUpdateCheck(start: boolean): UpdateCheckController {
  const [info, setInfo] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [downloaded, setDownloadedState] = useState<DownloadedUpdate | null>(
    null,
  );
  const inFlight = useRef(false);
  const launchCheckSettled = useRef(false);
  const launchCheckScheduled = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setError(null);
    try {
      const next = await platform.checkForUpdate();
      setInfo(next);
      setLastChecked(new Date());
      setDownloadedState((current) =>
        current && current.version === next.latestVersion ? current : null,
      );
    } catch (caught) {
      if (manual) noteFailure();
      setError(isApiError(caught) ? caught.message : CHECK_ERROR);
    } finally {
      inFlight.current = false;
      launchCheckSettled.current = true;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!start || launchCheckScheduled.current) return;
    launchCheckScheduled.current = true;
    // The effect already runs after the first shelf commit; the frame keeps
    // the metadata request behind that paint rather than racing it.
    window.requestAnimationFrame(() => {
      if (!launchCheckSettled.current) void runCheck(false);
    });
  }, [start, runCheck]);

  const setDownloaded = useCallback((value: DownloadedUpdate | null) => {
    setDownloadedState(value);
  }, []);

  return {
    info,
    checking,
    error,
    lastChecked,
    downloaded,
    runCheck,
    setDownloaded,
  };
}
