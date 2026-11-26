import { getAsset, putAsset, deleteAsset, getManifest, putManifest } from "./idb.js";
import { normaliseIsbn, sha256Hex, titleAuthorKey } from "./hash.js";

export const SCHEMA = "pocketlibrary.textless-art-pack/1";

export class IntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrityError";
    this.code = "INTEGRITY";
  }
}

/**
 * Resolve a library book against the pack index. Order is intentional:
 *   1. content hash  (the same EPUB/cover bytes, regardless of metadata)
 *   2. ISBN          (a specific edition)
 *   3. title+author  (normalised; the reliable key for public-domain editions)
 *   4. id            (the app's own stable id, when the catalog came from the pack)
 */
export function resolveBook(manifest, book) {
  if (!manifest || !book) return null;
  const index = manifest.index || {};
  const byId = (id) => manifest.items.find((item) => item.id === id) || null;

  if (book.contentHash && index.byContentHash) {
    const id = index.byContentHash[String(book.contentHash).toLowerCase()];
    if (id) return byId(id);
  }
  const isbn = normaliseIsbn(book.isbn);
  if (isbn && index.byIsbn && index.byIsbn[isbn]) return byId(index.byIsbn[isbn]);

  const candidates = new Set();
  const titles = [book.title, String(book.title || "").replace(/\s*:.*$/, "")];
  for (const title of titles) {
    if (!title) continue;
    candidates.add(titleAuthorKey(title, book.author));
    candidates.add(titleAuthorKey(title, ""));
  }
  for (const key of candidates) {
    if (index.byTitleAuthor && index.byTitleAuthor[key]) return byId(index.byTitleAuthor[key]);
  }
  if (book.id) return byId(book.id);
  return null;
}

export function describeBook(book) {
  return [book.title, book.author].filter(Boolean).join(" · ") || "Untitled";
}

/**
 * Load and verify the manifest. The trust anchor is pack-lock.js, shipped with
 * the app shell, not with the pack. If the network is unavailable we fall back
 * to the last verified manifest in IndexedDB.
 */
export async function loadManifest({ packBase = "pack/", fixture = null, lock = window.TEXTLESS_PACK_LOCK } = {}) {
  if (!lock) throw new Error("Missing pack-lock.js trust anchor");
  const started = performance.now();

  // The fixture means "pretend the pack and its cache do not exist", so a
  // gallery visitor sees the fallback state even after a normal load.
  if (fixture === "missing") {
    return {
      manifest: null,
      source: "missing",
      manifestSha256: null,
      manifestBytes: 0,
      error: "Pack deliberately absent",
      loadMs: performance.now() - started,
    };
  }

  if (navigator.onLine !== false) {
    try {
      const url = new URL(`${packBase}manifest.json`, document.baseURI);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const hash = await sha256Hex(bytes);
      if (bytes.byteLength !== lock.manifestBytes || hash !== lock.manifestSha256) {
        throw new IntegrityError("Manifest does not match the app-side lock");
      }
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      if (manifest.schema !== SCHEMA) throw new Error(`Unsupported pack schema: ${manifest.schema}`);
      await putManifest({
        manifest,
        bytes,
        sha256: hash,
        packVersion: manifest.pack.version,
        verifiedAt: Date.now(),
        source: "network",
      });
      return {
        manifest,
        source: "network",
        manifestSha256: hash,
        manifestBytes: bytes.byteLength,
        error: null,
        loadMs: performance.now() - started,
      };
    } catch (error) {
      const cached = await readCachedManifest(lock);
      if (cached) {
        return {
          manifest: cached.manifest,
          source: "cache",
          manifestSha256: cached.sha256,
          manifestBytes: cached.bytes?.byteLength ?? lock.manifestBytes,
          error: error.message,
          loadMs: performance.now() - started,
        };
      }
      return {
        manifest: null,
        source: "missing",
        manifestSha256: null,
        manifestBytes: 0,
        error: error.message,
        loadMs: performance.now() - started,
      };
    }
  }

  const cached = await readCachedManifest(lock);
  if (cached) {
    return {
      manifest: cached.manifest,
      source: "cache",
      manifestSha256: cached.sha256,
      manifestBytes: cached.bytes?.byteLength ?? lock.manifestBytes,
      error: null,
      loadMs: performance.now() - started,
    };
  }
  return {
    manifest: null,
    source: "missing",
    manifestSha256: null,
    manifestBytes: 0,
    error: "Offline and no verified manifest is cached",
    loadMs: performance.now() - started,
  };
}

async function readCachedManifest(lock) {
  try {
    const record = await getManifest();
    if (!record || !record.bytes) return null;
    const hash = await sha256Hex(record.bytes);
    if (hash !== lock.manifestSha256) return null;
    return record;
  } catch {
    return null;
  }
}

function tamper(bytes) {
  const copy = new Uint8Array(bytes.slice(0));
  if (copy.length > 32) copy[Math.floor(copy.length / 2)] ^= 0xff;
  return copy.buffer;
}

async function readVerifiedAsset(asset, counters) {
  const record = await getAsset(asset.sha256);
  if (!record || !record.blob) return null;
  const hash = await sha256Hex(record.blob);
  if (hash !== asset.sha256) {
    await deleteAsset(asset.sha256);
    counters.rejectedCacheReads += 1;
    return null;
  }
  counters.cacheHits += 1;
  counters.verified += 1;
  return record.blob;
}

async function ensureAsset(asset, item, kind, options, counters) {
  const { packBase, corruptSlug } = options;
  const forceCorrupt = corruptSlug === item.id && kind === "spine";
  if (!forceCorrupt) {
    const cached = await readVerifiedAsset(asset, counters);
    if (cached) return cached;
  }

  const url = new URL(asset.path, new URL(packBase, document.baseURI));
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${kind} HTTP ${response.status}`);
  let bytes = await response.arrayBuffer();
  counters.bytesFetched += bytes.byteLength;
  counters.downloads += 1;
  if (forceCorrupt) bytes = tamper(bytes);

  const hash = await sha256Hex(bytes);
  if (hash !== asset.sha256) {
    throw new IntegrityError(`${kind} hash mismatch for ${item.id}`);
  }
  const blob = new Blob([bytes], { type: asset.mime });
  await putAsset({
    sha256: asset.sha256,
    blob,
    mime: asset.mime,
    bytes: bytes.byteLength,
    itemId: item.id,
    kind,
    verifiedAt: Date.now(),
  });
  counters.verified += 1;
  return blob;
}

/**
 * Fetch/verify/cache every asset needed by the shelf. Per-item failures are
 * contained: one corrupt or missing item falls back without breaking the shelf.
 */
export async function hydratePack(manifest, { packBase = "pack/", fixture = null, onProgress = () => {} } = {}) {
  const started = performance.now();
  const counters = {
    total: 0,
    done: 0,
    verified: 0,
    downloads: 0,
    cacheHits: 0,
    bytesFetched: 0,
    rejectedCacheReads: 0,
  };
  const results = new Map();
  if (!manifest) {
    return { results, counters, hydrateMs: performance.now() - started };
  }

  const available = manifest.items.filter((item) => item.status === "available");
  counters.total = available.length * 2;
  const corruptSlug = fixture === "corrupt" ? available[0]?.id ?? null : null;

  for (const item of manifest.items) {
    if (item.status !== "available") {
      results.set(item.id, { status: "unavailable", reason: item.unavailableReason || "not-in-pack" });
    }
  }

  async function hydrateItem(item) {
    try {
      const spineBlob = await ensureAsset(item.assets.spine, item, "spine", { packBase, corruptSlug }, counters);
      counters.done += 1;
      onProgress({ ...counters, item: item.id });
      const artBlob = await ensureAsset(item.assets.art, item, "art", { packBase, corruptSlug }, counters);
      counters.done += 1;
      onProgress({ ...counters, item: item.id });
      results.set(item.id, { status: "ready", spineBlob, artBlob });
    } catch (error) {
      results.set(item.id, {
        status: error.code === "INTEGRITY" ? "corrupt" : "missing",
        reason: error.message,
        error,
      });
    }
  }

  // A small pool keeps first load fast without opening 36 requests at once on
  // a phone WebView. Six is conservative for Tauri Android.
  const queue = available.slice();
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await hydrateItem(item);
    }
  });
  await Promise.all(workers);

  return { results, counters, hydrateMs: performance.now() - started };
}
