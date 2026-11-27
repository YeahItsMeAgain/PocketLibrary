/**
 * Internal helpers shared by the Tauri and mock platform implementations.
 * Not re-exported from the platform barrel.
 */
import type { DiagnosticsExport, Platform } from "./types";
import { isApiError } from "./types";

export interface SavedDiagnostics {
  fileName: string;
  bytes: number;
}

/** Mirrors the shell's native-share result; `null` means unsupported. */
export interface SharedDiagnostics {
  fileName: string;
  bytes: number;
}

export function errorText(error: unknown): string {
  if (isApiError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Wrap every platform method so a rejected command is written to the local log.
 * Successful calls stay quiet. `logDiagnostic` is excluded to avoid a loop.
 */
export function traced(
  base: Platform,
  onFailure: (method: string, error: unknown) => void,
): Platform {
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== "function" || name === "logDiagnostic") {
      wrapped[name] = value;
      continue;
    }
    wrapped[name] = (...args: unknown[]) => {
      let result: unknown;
      try {
        result = (value as (...inner: unknown[]) => unknown).apply(base, args);
      } catch (error) {
        onFailure(name, error);
        throw error;
      }
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          onFailure(name, error);
          throw error;
        });
      }
      return result;
    };
  }
  return wrapped as unknown as Platform;
}

export function asArrayBuffer(value: ArrayBuffer | number[]): ArrayBuffer {
  return value instanceof ArrayBuffer
    ? value
    : new Uint8Array(value).buffer;
}

/**
 * Let the native shell open its share chooser first. When it reports that
 * sharing is unsupported (desktop) or fails, fall back to the shell's system
 * save picker. The caller never sees a raw path either way.
 */
export async function shareOrSaveDiagnostics(
  fileName: string,
  fallbackBytes: number,
  share: () => Promise<SharedDiagnostics | null>,
  save: () => Promise<SavedDiagnostics | null>,
): Promise<DiagnosticsExport> {
  let shared: SharedDiagnostics | null = null;
  try {
    shared = await share();
  } catch {
    // A refused native share falls through to the save picker.
  }
  if (shared) {
    return {
      fileName: shared.fileName,
      bytes: shared.bytes,
      method: "share",
      cancelled: false,
    };
  }
  const saved = await save();
  if (!saved) {
    return { fileName, bytes: fallbackBytes, method: "save", cancelled: true };
  }
  return {
    fileName: saved.fileName,
    bytes: saved.bytes,
    method: "save",
    cancelled: false,
  };
}
