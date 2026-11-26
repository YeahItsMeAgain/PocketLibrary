import { useEffect, useRef } from "react";

import { platform } from "../platform";

/**
 * Online details are always automatic now, with no user-facing mode control.
 * Force the mode once per launch, as soon as the library is available, so an
 * existing install that stored "off" or "ask" moves to automatic too.
 *
 * The write is fire-and-forget: a network or database failure must never block
 * the shelf, and success stays silent.
 */
export function useAutomaticEnrichment(libraryReady: boolean) {
  const forced = useRef(false);

  useEffect(() => {
    if (!libraryReady || forced.current) return;
    forced.current = true;
    void platform.setEnrichmentMode("automatic").catch(() => {
      // Keep the shelf usable; a later launch retries the reconciliation.
    });
  }, [libraryReady]);
}
