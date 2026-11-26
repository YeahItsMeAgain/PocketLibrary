/* App-shell cache only. Pack assets are never cached here: the loader owns
   verification and IndexedDB, and pack requests must reach the network so a
   corrupt/missing pack can be exercised. */
const CACHE = "textless-app-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./pack-lock.js",
  "./catalog.js",
  "./src/app.js",
  "./src/pack.js",
  "./src/idb.js",
  "./src/hash.js",
  "./src/spine.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/pack/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then(
        (cached) =>
          cached ||
          fetch(request).catch(() =>
            new Response("Offline and the app shell was not cached.", {
              status: 503,
              headers: { "content-type": "text/plain" },
            }),
          ),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
