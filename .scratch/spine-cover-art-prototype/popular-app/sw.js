/* Gallery-only service worker.
 *
 * The real Tauri app already bundles its shell in the APK, so this exists only
 * to make the browser gallery survive a real offline page reload. It caches the
 * shell, fonts and catalogue, but deliberately never caches pack/ requests:
 * the pack's offline path is IndexedDB + SHA-256, which is what we want to test.
 */

const CACHE = "popular-app-shell-2026-11-26";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./spine.css",
  "./library.json",
  "./pack/size.json",
  "./js/app.js",
  "./js/pack-loader.js",
  "./js/spine-renderer.js",
  "./fonts/Inter-Variable.woff2",
  "./fonts/CormorantGaramond-Variable.woff2",
  "./fonts/CormorantGaramond-Italic-Variable.woff2",
  "./fonts/EBGaramond-Regular.woff2",
  "./fonts/Literata-Regular.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // IndexedDB owns the pack. size.json is display metadata, not pack data, so
  // cache it with the shell to keep an offline reload console-clean.
  if (url.pathname.includes("/pack/") && !url.pathname.endsWith("/pack/size.json")) return;

  event.respondWith(
    // Network-first so edits are never served stale; the cache is the offline
    // fallback and is refreshed on every successful same-origin response.
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
  );
});
