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
  path: string;
  format: BookFormat;
  title: string;
  authors: string[];
  series: string | null;
  language: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  identifier: string | null;
  coverPath: string | null;
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

const tauriPlatform: Platform = {
  appInfo: () => invoke<AppInfo>("app_info"),
  listBooks: () => invoke<Book[]>("list_books"),
  listShelves: () => invoke<Shelf[]>("list_shelves"),
};

export const MOCK_APP_INFO: AppInfo = {
  name: "PocketLibrary",
  appVersion: "0.1.0",
  schemaVersion: 1,
};

const mockPlatform: Platform = {
  appInfo: async () => MOCK_APP_INFO,
  listBooks: async () => [],
  listShelves: async () => [],
};

function runningInTauri(): boolean {
  if (typeof window === "undefined") return false;
  return isTauri() || "__TAURI_INTERNALS__" in window;
}

export function createPlatform(): Platform {
  return runningInTauri() ? tauriPlatform : mockPlatform;
}

/** The platform the app is running against. */
export const platform: Platform = createPlatform();
