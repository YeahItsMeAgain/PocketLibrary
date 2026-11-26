# Textless art, in the app

**Status:** throwaway, app-capable prototype. Not production code, not in the shared
dock or review page, nothing committed or released. Everything lives under
`.scratch/spine-cover-art-prototype/textless-app/`.

**Open:** <http://127.0.0.1:4173/spine-cover-art-prototype/textless-app/>

This is the route the v3 textless study was missing. It turns the curated
paintings into a **Textless Art Pack** — a manifest plus 2× spine crops and art
files — then loads, verifies, caches and renders that pack entirely in a
WebView-like browser environment. No desktop Python, no OCR, no hand masks and
no LaMa at runtime.

The verdict up front: this is **pack-reproducible** for the books in the pack.
It is **not strict-reproducible** under the suite rule: a random downloadable
book outside the pack falls back to a generated plate. Arbitrary books still
need the `v8-app` on-device route.

---

## Exact commands

From the repo root:

```bash
# 1. Serve the existing prototype tree (already the host on 0.0.0.0:4173).
python3 -m http.server 4173 --bind 0.0.0.0 --directory .scratch

# 2. Rebuild the pack from the v3 art (read-only) and regenerate the lock.
node .scratch/spine-cover-art-prototype/textless-app/tools/build-pack.mjs

# 3. Run the browser suite (73 checks, screenshots, timings).
node .scratch/spine-cover-art-prototype/textless-app/tests/run.cjs

# Optional: point the suite at another host.
BASE_URL=http://127.0.0.1:4173/spine-cover-art-prototype/textless-app/ \
  node .scratch/spine-cover-art-prototype/textless-app/tests/run.cjs
```

The suite writes:

- `tests/results.json` — every check, timing sample and pack measurement
- `screenshots/01-first-load-390.png`
- `screenshots/02-first-load-320.png`
- `screenshots/03-offline-reload-390.png`
- `screenshots/04-missing-pack-390.png`
- `screenshots/05-corrupt-hash-390.png`
- `screenshots/06-unknown-book-390.png`

The builder depends on `ffmpeg`/`ffprobe` and the existing v3 files. It never
writes to `v3/`; it only reads `sources.json`, `art/` and the classic cover
images used as content-hash keys.

---

## The pack

```text
textless-app/
├── index.html            gallery + shelf
├── styles.css
├── src/
│   ├── app.js            boot, shelf, detail, integrity UI
│   ├── pack.js           manifest load, lookup, verify, hydrate
│   ├── idb.js            IndexedDB cache
│   ├── hash.js           SHA-256 + key normalisation
│   └── spine.js          canvas spine + generated plate
├── pack/
│   ├── manifest.json     20 records, 18 with pixels
│   └── items/            18 × spine (104×472) + 18 × art (≤480×720)
├── pack-lock.js          app-side trust anchor (manifest SHA-256 + bytes)
├── catalog.js            bundled library records (survive a missing pack)
├── pack-summary.json     measured build output
├── tools/build-pack.mjs
├── tests/run.cjs
├── tests/results.json
├── screenshots/
├── PACK.md               schema + integrity model
└── README.md
```

### Manifest keys

The pack index supports three independent lookup keys, in this order:

1. **content hash** — SHA-256 of the source cover bytes. It resolves the same
   book regardless of title/author metadata drift, but only if the app has the
   identical cover file.
2. **ISBN** — normalised digits/X. The pack uses this for the two modern
   editions; those records carry **metadata and ISBN only**, no cover pixels,
   because the editions are in copyright.
3. **title + author** — NFKD-normalised, punctuation-stripped, lower-case. This
   is the reliable key for public-domain editions with no ISBN.

The loader also accepts the app's own stable `id` as a last resort. Unknown books
return `null` and render the generated plate.

### Every asset is verified

- `pack-lock.js` is **shipped with the app shell**, not with the pack. It pins
  the manifest byte length and SHA-256.
- The manifest is fetched, hashed and compared with the lock before parsing.
- Each spine and art file is hashed before it is written to IndexedDB.
- A cached asset is hashed again when read. A mismatch deletes it and falls
  back instead of drawing it.
- A flipped byte in a downloaded spine drops **that book only** to the generated
  plate; the other 17 art spines remain.

For a real downloaded pack, the lock must be supplied by a signed update feed or
pinned in the APK. A lock downloaded next to the pack proves nothing.

### Rendering

- Shelf canvas: **52 × 236 CSS px**, backing store exactly **104 × 472** (2×).
- Detail preview: 208 × 944 (4×) of the same object.
- PNG export buttons produce 52 × 236 and 104 × 472.
- The spine is art only. Captions are app UI, not printed cover type.
- Missing/corrupt/unknown books use a deterministic generated plate seeded from
  `title|author`; it is stable across reloads and needs no network.

---

## Measured pack size

From `pack-summary.json` and the last suite run:

| Part | Bytes | Notes |
|---|---:|---|
| Manifest | 42,238 | 20 records + three indexes |
| Spine crops | 176,599 | 18 × 104 × 472 JPEG |
| Art files | 876,667 | 18 × ≤480 × 720 JPEG |
| **Total on disk** | **1,095,504** | **1.045 MiB** |
| Available art books | 18 | public domain |
| Metadata-only records | 2 | modern editions, ISBN only |

The shelf alone needs only the spine crops: **176.6 KB** for 18 books. The art
files are 80% of the pack and are only needed in a detail view.

---

## Test results

`node tests/run.cjs` → **73/73 passed**. Run at 390 and 320 CSS px in headless
Chromium (Playwright), with a fresh browser context per state.

| State | 390 px | 320 px | Result |
|---|---|---|---|
| First load | 18 art + 2 licence fallbacks | same | pass, no overflow, no console/page errors |
| Offline reload | 18 art from IndexedDB | — | pass, 36/36 verified from cache, 0 downloads |
| Missing pack (`?fixture=missing`) | 20 generated plates | 20 plates | pass, no throw, no console errors |
| Corrupt hash (`?fixture=corrupt`) | 17 art + 1 corrupt + 2 licence | same | pass, only the bit-flipped book falls back |
| Unknown book (`?fixture=unknown`) | 18 art + 1 unknown + 2 licence | same | pass, 21 cards, unknown status shown |

Also checked:

- every shelf canvas is `52px × 236px` CSS with a `104 × 472` backing store;
- `documentElement.scrollWidth` equals the viewport at 390 and 320 in every state;
- all SPAs stay within the 320 px stage (the only horizontal scroller is the
  integrity table, contained inside `.table-wrap`);
- zero console errors, zero `pageerror`s and zero failed requests in every state;
- content-hash, ISBN, title+author and unknown lookups all return the expected
  record;
- manifest hash equals `pack-lock.js`;
- pack on disk equals `pack-summary.json`.

### Load time

Fresh context, local static host, headless Chromium, 18 books / 36 assets, six
normal-load samples in the last run:

| Measure | Value |
|---|---:|
| In-page ready, normal loads | **354–1140 ms** across runs (latest median **614 ms**, best **354 ms**) |
| Wall clock (`goto` → rendered) | **450–1412 ms** |
| Offline reload (service-worker shell + IndexedDB) | **323–748 ms** |
| Manifest fetch | 0–231 ms (0 when the fixture skips the fetch) |
| Verify + IndexedDB cache | 60–413 ms |

Timings move with machine load; three runs of the same build produced different medians, so the range is more honest than one number. The
local host is also not a phone benchmark. The pack is 1 MiB, hashed twice on
first load and once per cache read; expect a mid-range Android WebView to be
slower. The loader uses a 6-request pool so it does not open 36 requests at once.

> The service worker exists only so this web demo can prove an offline reload.
> A Tauri APK already has its app shell on disk; there is nothing to cache for
> the shell. IndexedDB is still useful for a downloaded pack, and Android WebView
> supports it.

---

## The split

### What is pack-reproducible from the pack

- Textless spines for the **18 public-domain classics in the pack**.
- Pack discovery by content hash, ISBN or title+author.
- SHA-256 integrity at download and at cache read.
- Offline shelf from IndexedDB; no network after a successful first load.
- 2× spine crops generated at **build** time, not on device.
- Deterministic fallback plate for missing, corrupt and unknown books.
- The loader/renderer are plain ES modules, Canvas and Web APIs. No native
  Python, no model runtime, no third-party network, no hosted credentials.

### What still needs the automatic on-device route (`v8-app`)

- **Any book the user adds that is not in the pack.** The pack is a finite,
  curated set. The loader cannot invent art for it; it falls back.
- **Modern in-copyright covers.** The two modern records deliberately ship ISBN
  and metadata only. A textless spine for them needs text detection, masking and
  inpainting.
- **Automatic text removal** from an arbitrary cover. `v8-app` is the Rust/ORT
  route for that; it is not ported into this loader.
- **On-device model download and execution.** No ONNX/TFLite runtime, no LaMa
  weights, no phone benchmark here.
- **New public-domain titles at scale.** They need a pack build (desktop,
  `ffmpeg`, human licence check), not a device run.
- **A signed hosted feed.** The demo's lock is built locally. Production needs a
  signed manifest or an APK-pinned hash.

So the honest product shape is **two routes**:

```text
book in pack ──► Textless Art Pack ──► instant art-only spine (this prototype)
book not in pack ──► v8-app on-device route ──► text-free crop or fallback
```

### Bundling vs downloading

**Recommendation for this study: bundle the spine crops, download the art files
later if the library grows.**

| Option | Cost | Trade-off |
|---|---:|---|
| Bundle the whole pack | +1.045 MiB APK | Simplest; works offline forever; no host, no signing, no update path. |
| Bundle spine-only seed | +176.6 KB APK | Fast first shelf; detail art needs a download. |
| Download whole pack | 0 APK bytes | Needs host, signed manifest, Rust download path (WebView CSP allows only self/IPC), update UI and failure states. |
| Bundled classics + optional packs | +~0.2–1 MiB | Best long-term: ship a seed, let users add packs. |

For 18 classics, **bundling the whole 1.045 MiB pack is the pragmatic choice**:
it is small in APK terms, works offline forever, and removes the entire
download/trust/update surface. The app already ships a cover cache; 1 MiB is not
a meaningful APK cost.

Use download when the pack exceeds roughly 5 MiB, when new packs ship monthly, or
when the library must include hundreds of titles. At that point the manifest hash
must come from a signed feed or be pinned per app release. The 2× spine crops are
the part worth bundling even then: they are 176.6 KB for 18 books.

---

## Tauri Android integration notes

The runtime dependencies are all WebView-native: `fetch`, WebCrypto, IndexedDB,
`createImageBitmap`, Canvas 2D and blob URLs. Four things still need an
integration decision:

1. **Hashing.** Verify `crypto.subtle` is available on the Tauri origin. If it is
   not, hash in Rust with `sha2` before handing bytes to the WebView, or expose a
   `sha256` command over IPC. The loader only needs a hex digest; the algorithm
   does not have to live in JavaScript.
2. **Bundled pack path.** A bundled pack can be fetched relative to the app URL,
   or exposed as a Tauri resource. A downloaded pack should be written to app
   data and served through the Tauri asset protocol or `convertFileSrc`; the
   production CSP allows `self`, `data:` and `blob:` for images, not arbitrary
   origins.
3. **Trust anchor.** Keep `pack-lock.js` (or its hash) in the binary, not in the
   downloaded pack directory. A downloaded lock is not a trust boundary.
4. **Service worker.** Drop it in the APK. The app shell is already on disk. Keep
   IndexedDB for downloaded packs, or replace it with a Rust cache.
5. **Device test.** These numbers are desktop Chromium. Run the same suite logic
   on a mid-range Android device at 320/360/390 px and measure the 1 MiB
   verify/cache path. Even then it would remain pack-reproducible, not
   strict-reproducible for a random book.

---

## What is simulated, and what is real

| Piece | Real in this prototype | Would change in the APK |
|---|---|---|
| Manifest + assets | Real files fetched over HTTP | Tauri asset protocol / app data directory |
| Download | Local HTTP with network cache disabled | Rust `wreq` download, progress, retry |
| Integrity | Real SHA-256 via WebCrypto | Same, or Rust `sha2` before handing bytes to the WebView |
| Offline cache | Real IndexedDB | Same for downloaded packs; bundled packs need no cache |
| Offline app shell | Service worker | Bundled with the APK; service worker unnecessary |
| Pack trust | `pack-lock.js` built beside the pack | Pin the hash in the APK or verify a signature |
| Corrupt test | One byte flipped after fetch, before hashing | Same failure path; no test hook needed |
| Art itself | Public-domain paintings and Standard Ebooks covers | Same, with per-item licence review |

The `?fixture=` query parameters are demo/test hooks. They change only the
loader input; the verification, cache and fallback code is the same code used on
a normal first load.

---

## Scope / licence

- Public-domain paintings and Standard Ebooks covers; per-title credit, licence,
  source URL and provenance are in `pack/manifest.json` and shown in the detail
  panel.
- The two modern edition records (`whisper-man`, `rock-paper-scissors`) ship
  **no pixels**. Their ISBNs exist to demonstrate ISBN lookup and licence-aware
  fallback.
- Nothing here is wired into the shared dock, the review page, the
  reproducibility page, `v8-app/`, production app code, tests, manifests or
  specs. The integration pass can link `/spine-cover-art-prototype/textless-app/`
  when it is ready.
