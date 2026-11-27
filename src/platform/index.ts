/**
 * Assemble the platform seam from its type, Tauri and mock modules.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

import {
  MOCK_APP_INFO,
  createMockPlatform,
  mockConfig,
  type MockConfig,
  type MockEnrichmentConfig,
  type MockSpineConfig,
  type MockUpdateConfig,
} from "./mock";
import { createTauriPlatform } from "./tauri";
import type { Invoke, Platform } from "./types";

export * from "./types";
export { createTauriPlatform };
export {
  MOCK_APP_INFO,
  type MockConfig,
  type MockEnrichmentConfig,
  type MockSpineConfig,
  type MockUpdateConfig,
};

function runningInTauri(): boolean {
  if (typeof window === "undefined") return false;
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

export function createPlatform(call: Invoke = invoke): Platform {
  return runningInTauri()
    ? createTauriPlatform(call)
    : createMockPlatform(mockConfig());
}

/** The platform the app is running against. */
export const platform: Platform = createPlatform();
