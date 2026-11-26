/* ==========================================================================
   Popular Editions Pack loader
   WebView-safe: fetch -> SHA-256 -> IndexedDB -> match -> render.
   No third-party network, no native code, no on-device model.
   ========================================================================== */

export const PACK_ID = "popular-editions";
export const PACK_BASE = new URL("../pack/", import.meta.url);

const DB_NAME = "pocketlibrary-popular-editions";
const DB_VERSION = 1;
const MANIFEST_STORE = "manifests";
const FILE_STORE = "files";

const textEncoder = new TextEncoder();
let memory = { manifests: new Map(), files: new Map() };
let dbPromise = null;

/* ---------- hashing ---------------------------------------------------- */

export function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input) {
  const buffer = input instanceof ArrayBuffer
    ? input
    : ArrayBuffer.isView(input)
      ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
      : textEncoder.encode(String(input));
  if (globalThis.crypto && crypto.subtle) {
    return bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
  }
  // Tauri/WebView is a secure context, so subtle should be present. The
  // fallback keeps the prototype honest if it is opened from a plain file://.
  return sha256Fallback(new Uint8Array(buffer));
}

/* Small, dependency-free SHA-256 for non-secure file:// previews only. */
function sha256Fallback(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length;
  const withOne = new Uint8Array(((l + 8) >> 6) * 64 + 64);
  withOne.set(bytes);
  withOne[l] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 4, l * 8, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < withOne.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}
function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

/* ---------- IndexedDB -------------------------------------------------- */

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) db.createObjectStore(MANIFEST_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function idbGet(store, key) {
  const db = await openDB();
  if (!db) return memory[store === MANIFEST_STORE ? "manifests" : "files"].get(key) || null;
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(store, value) {
  const db = await openDB();
  if (!db) {
    memory[store === MANIFEST_STORE ? "manifests" : "files"].set(value.id || value.key, value);
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function idbGetAll(store) {
  const db = await openDB();
  if (!db) return Array.from(memory[store === MANIFEST_STORE ? "manifests" : "files"].values());
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function clearPackCache() {
  const db = await openDB();
  memory = { manifests: new Map(), files: new Map() };
  if (!db) return true;
  return new Promise((resolve) => {
    const tx = db.transaction([MANIFEST_STORE, FILE_STORE], "readwrite");
    tx.objectStore(MANIFEST_STORE).clear();
    tx.objectStore(FILE_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function getCacheInfo() {
  const manifests = await idbGetAll(MANIFEST_STORE);
  const files = await idbGetAll(FILE_STORE);
  return {
    db: Boolean(await openDB()),
    version: manifests[0] ? manifests[0].version : null,
    manifests: manifests.length,
    files: files.length,
    bytes: files.reduce((sum, f) => sum + (f.bytes || 0), 0),
    entries: manifests[0] ? manifests[0].manifest.entryCount : 0,
    cachedAt: manifests[0] ? manifests[0].cachedAt : null,
  };
}

/* ---------- fetch helpers --------------------------------------------- */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

async function fetchBytes(url, { fetchImpl, signal, latency, expectBytes }) {
  if (latency) await wait(latency);
  const res = await fetchImpl(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = await res.arrayBuffer();
  if (expectBytes != null && buffer.byteLength !== expectBytes) {
    throw new Error(`size mismatch for ${url}: ${buffer.byteLength} != ${expectBytes}`);
  }
  return buffer;
}

function corruptBuffer(buffer, salt) {
  const copy = buffer.slice(0);
  if (!copy.byteLength) return copy;
  const bytes = new Uint8Array(copy);
  const at = Math.max(1, Math.floor(bytes.length * 0.37));
  bytes[at] = (bytes[at] ^ (0x5a + (salt % 17))) & 0xff;
  // Guarantee a different digest even if the flip produced the same byte.
  if (bytes[at] === new Uint8Array(buffer)[at]) bytes[at] = (bytes[at] + 1) & 0xff;
  return copy;
}

/* ---------- manifest validation --------------------------------------- */

const SHA_RE = /^[a-f0-9]{64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safePath(value) {
  return typeof value === "string"
    && !value.startsWith("/")
    && !value.includes("..")
    && !value.includes("\\")
    && value.startsWith("files/");
}

export function validateManifest(manifest) {
  if (!manifest || manifest.schema !== "pocketlibrary.popular-editions-pack/1") {
    throw new Error("Unsupported or missing pack schema");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("Pack has no entries");
  }
  if (manifest.spine.widthPx !== 52 || manifest.spine.heightPx !== 236) {
    throw new Error("Pack spine geometry must be 52x236");
  }
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!entry.id || ids.has(entry.id)) throw new Error(`Duplicate or missing entry id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.edition || !entry.edition.rights || typeof entry.edition.rights.distribution !== "string") {
      throw new Error(`Entry ${entry.id} has no rights block`);
    }
    if (!entry.quality || !["pass", "reject"].includes(entry.quality.status)) {
      throw new Error(`Entry ${entry.id} has an invalid quality status`);
    }
    if (!entry.design || !COLOR_RE.test(entry.design.cloth) || !COLOR_RE.test(entry.design.accent)) {
      throw new Error(`Entry ${entry.id} has invalid design colours`);
    }
    for (const kind of ["art", "spine", "spine2x"]) {
      const file = entry.files && entry.files[kind];
      if (!file || !safePath(file.path) || !SHA_RE.test(file.sha256) || !Number.isFinite(file.bytes) || file.bytes <= 0) {
        throw new Error(`Entry ${entry.id} has an invalid ${kind} file record`);
      }
      const expected = kind === "spine2x" ? [104, 472] : kind === "spine" ? [52, 236] : null;
      if (expected && (file.width !== expected[0] || file.height !== expected[1])) {
        throw new Error(`Entry ${entry.id} ${kind} must be ${expected[0]}x${expected[1]}`);
      }
    }
  }
  return true;
}

/* ---------- matching --------------------------------------------------- */

export function normalizeIsbn(value) {
  return String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Conservative edition match.
 *   1. ISBN exact (1.00)
 *   2. content hash exact (0.98) - survives a re-import without an ISBN
 *   3. title + author (0.82) - only when the ISBNs do not conflict
 * A present-but-different ISBN is a hard stop for the title+author route.
 */
export function matchEdition(book, manifest) {
  if (!book || !manifest) return null;
  const isbn = normalizeIsbn(book.isbn);
  const hash = book.contentHash || null;
  const title = normalizeName(book.title);
  const author = normalizeName(book.author);
  const candidates = [];
  for (const entry of manifest.entries) {
    const m = entry.match || {};
    const entryIsbn = normalizeIsbn(m.isbn);
    const entryHash = m.contentHash || null;
    if (isbn && entryIsbn && isbn === entryIsbn) {
      candidates.push({ entry, reason: "isbn", confidence: 1 });
      continue;
    }
    if (hash && entryHash && hash === entryHash) {
      candidates.push({ entry, reason: "content-hash", confidence: 0.98 });
      continue;
    }
    if (isbn && entryIsbn && isbn !== entryIsbn) continue;
    if (title && author && title === normalizeName(m.title) && author === normalizeName(m.author)) {
      candidates.push({ entry, reason: "title+author", confidence: 0.82 });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0] || null;
}

/* ---------- load ------------------------------------------------------- */

/**
 * Load, verify and cache the pack.
 *
 * mode:
 *   bundled     - fetch the local pack (no artificial latency)
 *   download    - fetch the local pack with simulated network latency
 *   offline     - IndexedDB only; never touch the network
 *   auto        - cache first, network if the cache is absent/invalid
 *   refresh     - network, replace the cache
 *
 * corrupt: entry id, file path, or "entry:kind" to flip one byte after fetch.
 * policy:  "study" (default) or "release" (restricted rights fall back).
 */
export async function loadPack(options = {}) {
  const {
    mode = "auto",
    baseUrl = PACK_BASE.href,
    fetchImpl = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null,
    corrupt = null,
    latency = 0,
    policy = "study",
    ignoreCache = false,
    signal,
    onProgress = () => {},
  } = options;

  const started = performance.now();
  const errors = [];
  const networkAllowed = mode !== "offline";
  const cacheFirst = mode === "auto" || mode === "offline" || mode === "cache-first";
  const forceNetwork = !cacheFirst || ignoreCache;
  const base = new URL(baseUrl, PACK_BASE.href).href;
  const normalizedBase = base.endsWith("/") ? base : base + "/";

  if (!fetchImpl && networkAllowed) throw new Error("fetch is unavailable");

  let manifestRecord = null;
  let source = "cache";

  if (!forceNetwork) {
    const cached = await idbGet(MANIFEST_STORE, PACK_ID);
    if (cached) {
      const manifestHash = await sha256Hex(cached.manifestText);
      if (manifestHash === cached.latest.manifestSha256) {
        try {
          validateManifest(cached.manifest);
          manifestRecord = cached;
          source = "cache";
        } catch (err) {
          errors.push({ scope: "cache", code: "manifest-schema", message: String(err.message || err) });
        }
      } else {
        errors.push({ scope: "cache", code: "manifest-hash", message: "Cached manifest failed SHA-256; trying network." });
      }
    }
  }

  if (!manifestRecord && networkAllowed) {
    const manifestLatency = latency ? Math.round(latency * 0.35) : 0;
    try {
      const latestBuffer = await fetchBytes(new URL("latest.json", normalizedBase).href, {
        fetchImpl, signal, latency: manifestLatency,
      });
      const latestText = new TextDecoder().decode(latestBuffer);
      const latest = JSON.parse(latestText);
      if (latest.id !== PACK_ID) throw new Error(`Unexpected pack id ${latest.id}`);
      const manifestBuffer = await fetchBytes(new URL(latest.manifest || "manifest.json", normalizedBase).href, {
        fetchImpl, signal, latency: manifestLatency,
      });
      const manifestText = new TextDecoder().decode(manifestBuffer);
      const manifestHash = await sha256Hex(manifestBuffer);
      if (latest.manifestSha256 && manifestHash !== latest.manifestSha256) {
        throw new Error("Manifest SHA-256 mismatch");
      }
      const manifest = JSON.parse(manifestText);
      validateManifest(manifest);
      manifestRecord = {
        id: PACK_ID,
        version: latest.version,
        latest,
        manifest,
        manifestText,
        cachedAt: new Date().toISOString(),
      };
      await idbPut(MANIFEST_STORE, manifestRecord);
      source = mode === "download" ? "download" : "network";
    } catch (err) {
      errors.push({ scope: "network", code: "manifest", message: String(err.message || err) });
      if (manifestRecord) {
        source = "cache-fallback";
      } else {
        throw new Error(`Pack could not be loaded: ${err.message || err}`);
      }
    }
  }

  if (!manifestRecord) {
    throw new Error("No cached pack and network is disabled (offline first load).");
  }

  const manifest = manifestRecord.manifest;
  const verifyStarted = performance.now();
  let cachedFiles = 0;
  let networkFiles = 0;
  let verifiedFiles = 0;
  let corruptFiles = 0;
  let missingFiles = 0;
  let totalFileBytes = 0;
  let done = 0;

  const entries = [];
  for (const entry of manifest.entries) {
    const files = {};
    for (const kind of ["art", "spine", "spine2x"]) {
      const meta = entry.files[kind];
      const key = `${PACK_ID}:${entry.id}:${kind}`;
      let buffer = null;
      let verified = false;
      let fileSource = "missing";
      let failure = null;

      const cached = await idbGet(FILE_STORE, key);
      if (!ignoreCache && cached && cached.version === manifestRecord.version) {
        const storedHash = await sha256Hex(cached.buffer);
        if (storedHash === meta.sha256 && cached.buffer.byteLength === meta.bytes) {
          buffer = cached.buffer;
          verified = true;
          fileSource = "cache";
          cachedFiles++;
        } else {
          errors.push({ scope: "cache", code: "file-hash", entry: entry.id, kind, message: "Cached file failed verification; refetching." });
        }
      }

      if (!verified && networkAllowed) {
        try {
          const url = new URL(meta.path, normalizedBase).href;
          let fetched = await fetchBytes(url, { fetchImpl, signal, latency, expectBytes: meta.bytes });
          const isCorrupt = corrupt === entry.id || corrupt === meta.path || corrupt === `${entry.id}:${kind}`;
          if (isCorrupt) fetched = corruptBuffer(fetched, entry.id.length + kind.length);
          const digest = await sha256Hex(fetched);
          if (digest !== meta.sha256) {
            failure = "sha256-mismatch";
            corruptFiles++;
            errors.push({ scope: "asset", code: "sha256-mismatch", entry: entry.id, kind, expected: meta.sha256, actual: digest });
          } else {
            buffer = fetched;
            verified = true;
            fileSource = mode === "download" ? "download" : mode === "bundled" ? "bundled" : "network";
            networkFiles++;
            await idbPut(FILE_STORE, {
              key,
              packId: PACK_ID,
              version: manifestRecord.version,
              entryId: entry.id,
              kind,
              path: meta.path,
              sha256: meta.sha256,
              bytes: meta.bytes,
              mime: meta.mime,
              buffer: fetched,
              cachedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          failure = "fetch-failed";
          missingFiles++;
          errors.push({ scope: "asset", code: "fetch-failed", entry: entry.id, kind, message: String(err.message || err) });
        }
      } else if (!verified) {
        failure = "not-cached";
        missingFiles++;
        errors.push({ scope: "asset", code: "not-cached", entry: entry.id, kind });
      }

      if (verified) {
        verifiedFiles++;
        totalFileBytes += buffer.byteLength;
      }
      files[kind] = {
        ...meta,
        verified,
        source: fileSource,
        failure,
        buffer: verified ? buffer : null,
        blob: verified ? new Blob([buffer], { type: meta.mime || "image/jpeg" }) : null,
        objectUrl: null,
      };
      done++;
      onProgress({ phase: "files", done, total: manifest.entries.length * 3, entry: entry.id, kind });
    }

    const hasFileFailure = ["art", "spine", "spine2x"].some((kind) => !files[kind].verified);
    let accepted = true;
    let reason = null;
    if (hasFileFailure) {
      accepted = false;
      reason = "asset-integrity";
    } else if ((manifest.policy.rejectQualityStatus || ["reject"]).includes(entry.quality.status)) {
      accepted = false;
      reason = "quality-reject";
    } else if (policy === "release" && entry.edition.rights.distribution !== "cleared") {
      accepted = false;
      reason = "rights-restricted";
    }

    entries.push({
      ...entry,
      files,
      status: hasFileFailure ? "corrupt-or-missing" : "verified",
      accepted,
      reason,
      selectedFile: files.spine.verified ? files.spine : null,
      selectedFile2x: files.spine2x.verified ? files.spine2x : null,
    });
  }

  const verifyMs = performance.now() - verifyStarted;
  const stats = {
    entries: entries.length,
    verifiedEntries: entries.filter((e) => e.status === "verified").length,
    acceptedEntries: entries.filter((e) => e.accepted).length,
    rejectedQuality: entries.filter((e) => e.reason === "quality-reject").length,
    restrictedRights: entries.filter((e) => e.edition.rights.distribution !== "cleared").length,
    corruptEntries: entries.filter((e) => e.status !== "verified").length,
    files: entries.length * 3,
    verifiedFiles,
    corruptFiles,
    missingFiles,
    cachedFiles,
    networkFiles,
    fileBytes: totalFileBytes,
    manifestBytes: new TextEncoder().encode(manifestRecord.manifestText).byteLength,
    loadMs: performance.now() - started,
    verifyMs,
    policy,
  };

  return {
    ok: true,
    source,
    packId: PACK_ID,
    version: manifestRecord.version,
    latest: manifestRecord.latest,
    manifest,
    manifestText: manifestRecord.manifestText,
    entries,
    stats,
    errors,
    cachedAt: manifestRecord.cachedAt,
  };
}

/* ---------- asset URL helpers ----------------------------------------- */

export function makeAssetUrls(pack) {
  const urls = [];
  for (const entry of pack.entries) {
    for (const kind of ["art", "spine", "spine2x"]) {
      const f = entry.files[kind];
      if (f && f.blob && !f.objectUrl) f.objectUrl = URL.createObjectURL(f.blob);
      if (f && f.objectUrl) urls.push(f.objectUrl);
    }
  }
  return () => urls.forEach((url) => URL.revokeObjectURL(url));
}
