/**
 * Storage Spike — diagnostic screen for ticket 10 (Android SAF library folder).
 *
 * This is deliberately a single, plain component with no product design. It is
 * meant to be deleted once the SAF flow is proven on a real phone.
 *
 * Everything here runs through `tauri-plugin-android-fs-api` 30.2.0.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { EntryMetadataWithUri, FsUri } from "tauri-plugin-android-fs-api";
import * as AndroidFs from "tauri-plugin-android-fs-api";
import "./StorageSpike.css";

const LS_KEY = "pocketlibrary.storage-spike.library-uri";
const TEST_FILE = "pocketlibrary-spike.txt";
const MAX_DEPTH = 32;
const MAX_ENTRIES = 50_000;
const HASH_BYTES = 64 * 1024;

type LogKind = "info" | "ok" | "warn" | "error";
type LogLine = { at: string; kind: LogKind; text: string };

type BookHit = {
  uri: FsUri;
  path: string;
  format: "epub" | "pdf";
  byteLength: number;
};

type ScanResult = {
  epub: number;
  pdf: number;
  totalBytes: number;
  elapsedMs: number;
  first: BookHit[];
};

type GrantState =
  | "not-chosen"
  | "checking"
  | "read-write"
  | "session-only"
  | "revoked"
  | "unavailable";

function now(): string {
  return new Date().toISOString().slice(11, 23);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function loadStoredUri(): FsUri | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FsUri;
    return parsed && typeof parsed.uri === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function storeUri(uri: FsUri | null): void {
  try {
    if (uri) localStorage.setItem(LS_KEY, JSON.stringify(uri));
    else localStorage.removeItem(LS_KEY);
  } catch {
    // localStorage failure is not fatal for the spike
  }
}

function extOf(name: string): "epub" | "pdf" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".pdf")) return "pdf";
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function scanBooks(
  root: FsUri,
  onProgress: (message: string) => void,
): Promise<ScanResult> {
  const started = performance.now();
  let epub = 0;
  let pdf = 0;
  let totalBytes = 0;
  let visited = 0;
  let truncated = false;
  const first: BookHit[] = [];

  const walk = async (dir: FsUri, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      onProgress(`Stopped at depth ${MAX_DEPTH} (${prefix || "/"})`);
      return;
    }
    if (truncated) return;

    let entries: EntryMetadataWithUri[];
    try {
      entries = await AndroidFs.readDir(dir);
    } catch (error) {
      onProgress(`Could not read "${prefix || "/"}": ${describeError(error)}`);
      return;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_ENTRIES) {
        truncated = true;
        onProgress(`Entry cap reached (${MAX_ENTRIES}); scan stopped early.`);
        return;
      }

      if (entry.type === "Dir") {
        if (entry.name.startsWith(".")) continue;
        const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        await walk(entry.uri, childPath, depth + 1);
        continue;
      }

      const format = extOf(entry.name);
      if (!format) continue;

      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (format === "epub") epub += 1;
      else pdf += 1;
      totalBytes += entry.byteLength;
      if (first.length < 5) {
        first.push({ uri: entry.uri, path, format, byteLength: entry.byteLength });
      }
    }
  };

  await walk(root, "", 0);
  return {
    epub,
    pdf,
    totalBytes,
    elapsedMs: Math.round(performance.now() - started),
    first,
  };
}

export default function StorageSpike() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [chosen, setChosen] = useState<FsUri | null>(() => loadStoredUri());
  const [grant, setGrant] = useState<GrantState>("checking");
  const [version, setVersion] = useState("…");
  const [busy, setBusy] = useState<string | null>(null);
  const firstBooks = useRef<BookHit[]>([]);

  const addLog = useCallback((kind: LogKind, text: string) => {
    setLog((lines) => [{ at: now(), kind, text }, ...lines].slice(0, 250));
  }, []);

  const checkGrant = useCallback(
    async (uri: FsUri | null, quiet = false): Promise<GrantState> => {
      if (!uri) {
        setGrant("not-chosen");
        if (!quiet) addLog("warn", "No library folder chosen yet. Pick one first.");
        return "not-chosen";
      }
      setGrant("checking");
      try {
        const persisted = await AndroidFs.checkPersistedPickerUriPermission(
          uri,
          "ReadAndWrite",
        );
        const session = await AndroidFs.checkPickerUriPermission(uri, "ReadAndWrite");
        if (persisted) {
          setGrant("read-write");
          if (!quiet) addLog("ok", "Persisted read/write grant is still valid.");
          return "read-write";
        }
        if (session) {
          setGrant("session-only");
          if (!quiet)
            addLog(
              "warn",
              "Access works for this launch, but the persisted read/write grant is missing. Re-pick the folder to persist it.",
            );
          return "session-only";
        }
        setGrant("revoked");
        if (!quiet)
          addLog(
            "error",
            "Read/write permission is revoked or the folder was moved/deleted. Re-pick the folder.",
          );
        return "revoked";
      } catch (error) {
        setGrant("unavailable");
        if (!quiet) addLog("error", `Grant check failed: ${describeError(error)}`);
        return "unavailable";
      }
    },
    [addLog],
  );

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown (not Tauri?)"));
    void checkGrant(loadStoredUri(), true);
  }, [checkGrant]);

  // Re-check when the app becomes visible again (e.g. returning from Android
  // settings after revoking the grant).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void checkGrant(loadStoredUri(), true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [checkGrant]);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    addLog("info", `${label}…`);
    try {
      await fn();
    } catch (error) {
      addLog("error", `${label} failed: ${describeError(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const pickFolder = () =>
    run("Pick library folder", async () => {
      const picked = await AndroidFs.showOpenDirPicker({ localOnly: false });
      if (!picked) {
        addLog("warn", "Picker cancelled; nothing changed.");
        return;
      }
      await AndroidFs.persistPickerUriPermission(picked);
      const previous = loadStoredUri();
      if (previous && previous.uri !== picked.uri) {
        await AndroidFs.releasePersistedPickerUriPermission(previous).catch(() => false);
      }
      storeUri(picked);
      setChosen(picked);
      const name = await AndroidFs.getName(picked).catch(() => "(unnamed)");
      addLog("ok", `Selected "${name}" and persisted its read/write grant.`);
      addLog("info", `URI: ${picked.uri}`);
      await checkGrant(picked);
    });

  const checkPersisted = () =>
    run("Check persisted grant", async () => {
      const uri = loadStoredUri();
      if (!uri) {
        addLog("warn", "No folder chosen. Pick a library folder first.");
        return;
      }
      setChosen(uri);
      await checkGrant(uri);
      const all = await AndroidFs.listAllPersistedPickerUriPermissions();
      if (all.length === 0) {
        addLog("warn", "Android reports no persisted URI permissions for this app.");
      } else {
        addLog("info", `Android reports ${all.length} persisted grant(s):`);
        for (const p of all) {
          addLog(
            "info",
            `  ${p.type} read=${p.hasReadPermission} write=${p.hasWritePermission} ${p.uri.uri}`,
          );
        }
      }
    });

  const listBooks = () =>
    run("List books", async () => {
      const uri = loadStoredUri();
      if (!uri) {
        addLog("warn", "No folder chosen. Pick a library folder first.");
        return;
      }
      const result = await scanBooks(uri, (message) => addLog("warn", message));
      firstBooks.current = result.first;
      addLog(
        "ok",
        `Scan done in ${result.elapsedMs} ms: ${result.epub} EPUB, ${result.pdf} PDF, ${result.epub + result.pdf} total, ${formatBytes(result.totalBytes)}.`,
      );
      if (result.epub + result.pdf === 0) {
        addLog("warn", "No .epub or .pdf files found (empty library or nothing matching).");
      }
      for (const book of result.first) {
        addLog("info", `  ${book.format.toUpperCase()} ${formatBytes(book.byteLength)}  ${book.path}`);
      }
      if (result.first.length === 0 && result.epub + result.pdf > 0) {
        addLog("info", "(first names unavailable)");
      }
    });

  const readBook = () =>
    run("Read a book", async () => {
      let book = firstBooks.current[0];
      if (!book) {
        const uri = loadStoredUri();
        if (!uri) {
          addLog("warn", "No folder chosen. Pick a library folder first.");
          return;
        }
        addLog("info", "No scan cached yet; scanning first.");
        const result = await scanBooks(uri, (message) => addLog("warn", message));
        firstBooks.current = result.first;
        book = result.first[0];
        addLog(
          "info",
          `Scan: ${result.epub} EPUB, ${result.pdf} PDF in ${result.elapsedMs} ms.`,
        );
      }
      if (!book) {
        addLog("warn", "No EPUB/PDF available to read.");
        return;
      }

      const started = performance.now();
      const stream = await AndroidFs.openReadFileStream(book.uri, {
        bufferByteLength: HASH_BYTES,
      });
      const reader = stream.getReader();
      let bytes: Uint8Array | null = null;
      try {
        const chunk = await reader.read();
        if (!chunk.done && chunk.value) bytes = chunk.value;
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (!bytes) {
        addLog("warn", `Opened "${book.path}" but it is empty (0 bytes read).`);
        return;
      }

      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
      const magic =
        bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
          ? "ZIP/EPUB (PK\\x03\\x04)"
          : bytes[0] === 0x25 &&
              bytes[1] === 0x50 &&
              bytes[2] === 0x44 &&
              bytes[3] === 0x46
            ? "PDF (%PDF)"
            : "unrecognised magic";
      addLog(
        "ok",
        `Read ${bytes.byteLength} bytes from "${book.path}" via SAF fd in ${Math.round(performance.now() - started)} ms (file: ${formatBytes(book.byteLength)}). Parsed as a file handle.`,
      );
      addLog("info", `Magic: ${magic}`);
      addLog("info", `SHA-256 first ${bytes.byteLength} bytes: ${hex(new Uint8Array(digest))}`);
    });

  const writeTest = () =>
    run("Write test file", async () => {
      const uri = loadStoredUri();
      if (!uri) {
        addLog("warn", "No folder chosen. Pick a library folder first.");
        return;
      }
      const entries = await AndroidFs.readDir(uri);
      const existing = entries.find(
        (entry) => entry.type === "File" && entry.name === TEST_FILE,
      );
      const stamp = new Date().toISOString();
      let target: FsUri;
      if (existing && existing.type === "File") {
        target = existing.uri;
        addLog("info", `Overwriting existing ${TEST_FILE}.`);
      } else {
        target = await AndroidFs.createNewFile(uri, TEST_FILE, "text/plain");
        addLog("info", `Created ${TEST_FILE}.`);
      }
      await AndroidFs.writeTextFile(target, `PocketLibrary storage spike\n${stamp}\n`);
      const roundTrip = await AndroidFs.readTextFile(target);
      addLog("ok", `Wrote and read back "${TEST_FILE}".`);
      addLog("info", `Content: ${JSON.stringify(roundTrip)}`);
      addLog("info", `URI: ${target.uri}`);
    });

  const forgetGrant = () =>
    run("Clear/forget grant", async () => {
      const uri = loadStoredUri();
      if (!uri) {
        addLog("warn", "Nothing to forget: no folder chosen.");
        return;
      }
      const released = await AndroidFs.releasePersistedPickerUriPermission(uri);
      storeUri(null);
      setChosen(null);
      firstBooks.current = [];
      setGrant("not-chosen");
      addLog(
        released ? "ok" : "warn",
        released
          ? "Persisted grant released and local choice forgotten."
          : "No persisted grant existed; local choice forgotten.",
      );
      addLog(
        "info",
        "The folder itself is untouched. Use Android Settings to revoke access for the cross-launch test, then re-check.",
      );
    });

  const grantLabel: Record<GrantState, string> = {
    "not-chosen": "none",
    checking: "checking…",
    "read-write": "persisted read/write",
    "session-only": "session only (not persisted)",
    revoked: "revoked / unavailable",
    unavailable: "check failed",
  };

  return (
    <main className="spike">
      <h1>Storage Spike</h1>
      <p className="spike-note">
        Ticket 10 diagnostic build. SAF library-folder flow via
        tauri-plugin-android-fs 30.2.0.
      </p>

      <section className="spike-status">
        <div>
          <strong>Folder:</strong>{" "}
          <span className="mono">{chosen ? chosen.uri : "(none chosen)"}</span>
        </div>
        <div>
          <strong>Grant:</strong> {grantLabel[grant]}
        </div>
        <div>
          <strong>App version:</strong> {version}
        </div>
      </section>

      <section className="spike-buttons">
        <button onClick={pickFolder} disabled={!!busy}>
          Pick library folder
        </button>
        <button onClick={checkPersisted} disabled={!!busy}>
          Check persisted grant
        </button>
        <button onClick={listBooks} disabled={!!busy}>
          List books
        </button>
        <button onClick={readBook} disabled={!!busy}>
          Read a book
        </button>
        <button onClick={writeTest} disabled={!!busy}>
          Write a test file
        </button>
        <button onClick={forgetGrant} disabled={!!busy}>
          Clear/forget grant
        </button>
      </section>

      {busy && <p className="spike-busy">Working: {busy}…</p>}

      <section className="spike-log">
        <div className="spike-log-head">
          <strong>Log</strong>
          <button onClick={() => setLog([])} disabled={!!busy}>
            Clear log
          </button>
        </div>
        {log.length === 0 ? (
          <p className="spike-empty">No actions yet.</p>
        ) : (
          <ol>
            {log.map((line, index) => (
              <li key={`${line.at}-${index}`} className={`kind-${line.kind}`}>
                <span className="mono">{line.at}</span> {line.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
