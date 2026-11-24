/**
 * The single seam between the React UI and the Rust command API.
 *
 * Every screen talks to `platform`, never to Tauri directly. On a phone the
 * Tauri implementation forwards to `invoke`; in a browser (Vite dev and
 * Playwright) the mock answers with the same types so the UI is testable
 * without a device.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  appVersion: string;
  schemaVersion: number;
}

export type BookFormat = "epub" | "pdf";

/** Mirrors `pocketlibrary_core::Book` (camelCase on the wire). */
export interface Book {
  id: number;
  contentHash: string;
  quickKey: string | null;
  format: BookFormat;
  title: string;
  authors: string[];
  series: string | null;
  language: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  identifier: string | null;
  addedAt: number;
  shelfId: number | null;
  slotIndex: number | null;
}

/** Mirrors `pocketlibrary_core::Shelf`. */
export interface Shelf {
  id: number;
  ordinal: number;
  capacity: number;
}

export interface Platform {
  appInfo(): Promise<AppInfo>;
  listBooks(): Promise<Book[]>;
  listShelves(): Promise<Shelf[]>;
}

export type Invoke = typeof invoke;

/**
 * Build the Tauri adapter around an invoke function.
 *
 * Injecting the function lets tests drive the real adapter without a device.
 */
export function createTauriPlatform(call: Invoke): Platform {
  return {
    appInfo: () => call<AppInfo>("app_info"),
    listBooks: () => call<Book[]>("list_books"),
    listShelves: () => call<Shelf[]>("list_shelves"),
  };
}

export const MOCK_APP_INFO: AppInfo = {
  name: "PocketLibrary",
  appVersion: "0.1.0",
  schemaVersion: 1,
};

/** Mirrors the one shelf seeded by migration v1 on a fresh database. */
const MOCK_SHELVES: Shelf[] = [{ id: 1, ordinal: 0, capacity: 12 }];

const mockPlatform: Platform = {
  appInfo: async () => MOCK_APP_INFO,
  listBooks: async () => [],
  listShelves: async () => MOCK_SHELVES,
};

function runningInTauri(): boolean {
  if (typeof window === "undefined") return false;
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

export function createPlatform(call: Invoke = invoke): Platform {
  return runningInTauri() ? createTauriPlatform(call) : mockPlatform;
}

/** The platform the app is running against. */
export const platform: Platform = createPlatform();
