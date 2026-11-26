/**
 * IndexedDB cache. Android WebView supports IndexedDB; the app can swap this
 * adapter for a Tauri/Rust cache without changing the loader contract.
 */
const DB_NAME = "pocketlibrary-textless-art";
const DB_VERSION = 1;
const MANIFEST_STORE = "manifests";
const ASSET_STORE = "assets";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) db.createObjectStore(MANIFEST_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE, { keyPath: "sha256" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result;
        try {
          result = fn(objectStore);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
      }),
  );
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

export async function getManifest() {
  const db = await openDb();
  const store = db.transaction(MANIFEST_STORE, "readonly").objectStore(MANIFEST_STORE);
  return requestResult(store.get("current"));
}

export async function putManifest(record) {
  await tx(MANIFEST_STORE, "readwrite", (store) => store.put({ id: "current", ...record }));
}

export async function getAsset(sha256) {
  const db = await openDb();
  const store = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE);
  return requestResult(store.get(sha256));
}

export async function putAsset(record) {
  await tx(ASSET_STORE, "readwrite", (store) => store.put(record));
}

export async function deleteAsset(sha256) {
  await tx(ASSET_STORE, "readwrite", (store) => store.delete(sha256));
}

export async function clearAll() {
  await tx(MANIFEST_STORE, "readwrite", (store) => store.clear());
  await tx(ASSET_STORE, "readwrite", (store) => store.clear());
}

export async function stats() {
  const db = await openDb();
  const manifests = db.transaction(MANIFEST_STORE, "readonly").objectStore(MANIFEST_STORE);
  const assets = db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE);
  const [manifestCount, assetCount] = await Promise.all([
    requestResult(manifests.count()),
    requestResult(assets.count()),
  ]);
  return { manifestCount, assetCount };
}
