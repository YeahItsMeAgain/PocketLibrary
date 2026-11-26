# Popular books — app reproducibility

**Date:** 2026-11-26  
**Scope:** `.scratch/spine-cover-art-prototype/popular-app/` only.  
**Not changed:** `v7/`, the shared dock, `review/`, `reproducibility/`, `v8-app/`,
production app code, tests, manifests or specs. No commit or release.

---

## 1. Verdict

**Popular books is pack-reproducible for the six editions in the pack, but it is
not strict-reproducible for a random book.** Under the suite rule, the APK must
take an unseen downloadable book and create its spine end-to-end. A pack lookup
is a useful feature, not that claim.

| Question | Answer |
|---|---|
| Can the exact runtime step run with app-available primitives? | **Yes.** Fetch, Web Crypto, IndexedDB, Canvas text metrics and DOM/CSS. No Python, LaMa, OCR, hand masks or model at runtime. |
| Does the prototype prove it in a WebView-like environment? | **Yes, browser-level.** Chromium at 390/320 px, 8 render combinations, 7 scenarios, 0 console errors, 0 overflow. |
| Is it in the shipped APK now? | **No.** Nothing is wired into `Shelf.tsx` or a Tauri command. No Android device pass yet. |
| Can the pack ship as-is? | **No.** 4 of 6 editions are reference-only and in copyright. 2 are public domain/cleared. |
| Is “not generated on-device” a reproducibility failure? | **No.** The app reproduces a verified, deterministic data set. It does not reproduce the desktop authoring pipeline, and it does not need to. |

The old v7 row said “Not app-reproducible” because it depended on curated
in-copyright covers, hand-defined masks and desktop LaMa. That is still true of
the **authoring** step. It is no longer true of the **app** step: the pack is the
boundary between them.

---

## 2. What changed relative to v7

| v7 | popular-app |
|---|---|
| Four in-copyright covers, hand masks and a desktop LaMa/TELEA pipeline. | Six editions shipped as data: textless art, 52 x 236 crop, 104 x 472 crop. |
| The study page reads local files; no cache or match path. | Manifest + assets fetched or bundled, SHA-256 verified, cached in IndexedDB. |
| A book is selected in the study. | A library book is matched by ISBN, content hash or title+author. |
| A rejection is a visual verdict on the page. | `quality.status = reject` is an app policy; the renderer refuses the art. |
| No rights model beyond a footer. | Per-edition rights, credit, source, note and takedown text; release policy gate. |
| No missing/corrupt handling. | Fail-closed to a typographic cloth spine, never a broken image. |

The v6/v7 type engine and the Hybrid spine are reused, not reimplemented:
`js/spine-renderer.js` keeps the measured title/author rail, palette mixing,
contrast measurement, ornaments and the 52 x 236 geometry. Art-only is the same
spine with the label removed and the full-width crop; fallback is the cloth
direction.

---

## 3. Why a curated pack is pack-reproducible, but not strict

### 3.1 The definition used here

A pack step is pack-reproducible when the **exact runtime step** can run in the
Android Tauri app, not merely on the desktop checkout. That is a property of the
runtime dependencies, not of where the pixels were authored. It is **not** strict
reproducibility: strict requires a random book, not a book already in the pack.

For this route, the runtime step is:

```
latest.json -> manifest -> per-file SHA-256 -> IndexedDB -> match -> render
```

Every dependency is already app-available:

| Runtime need | Source in this prototype | App availability |
|---|---|---|
| Network or bundled file read | `fetch()` of `pack/` | Bundle in APK assets, or Rust `wreq` for remote; CSP-safe |
| Hashing | `crypto.subtle.digest("SHA-256")` | Web Crypto in the Tauri WebView (secure context) |
| Offline cache | IndexedDB object stores | WebView storage (with quota handling) |
| Text measurement | `canvas.measureText`, `document.fonts` | WebView Canvas + bundled OFL fonts |
| Render | DOM + CSS (`color-mix`, gradients) | WebView; app already uses `color-mix` |
| Image display | `blob:` object URLs | CSP already allows `img-src blob:` |

There is no `python`, `torch`, `onnxruntime`, `rapidocr`, `simple-lama`,
`big-lama.pt`, `ffmpeg`, credential, hosted Space or hand-drawn polygon at
runtime. The desktop authoring tools stop at the pack boundary.

### 3.2 Determinism

The pack is byte-defined:

- `latest.json` names the manifest and its SHA-256.
- The manifest names every asset and its SHA-256.
- The renderer is a pure function of the catalogue record, the manifest entry and
  the verified spine crop.

Given the same pack bytes and the same fonts, the same spines are produced. There
is no sampling, no model seed, no OCR confidence threshold and no network state
inside the render. That is stronger determinism than the v7 authoring pipeline
had.

### 3.3 The honest boundary

The pack does **not** reproduce:

- how the textless art was made (LaMa, TELEA, sampled fill, a public-domain
  painting, or a human choosing a crop);
- whether the rights are cleared;
- whether the editor accepted the spine at 52 px.

Those are content-side decisions. The app reproduces their **result**, after a
human or a build pipeline has signed it into a manifest. A curated pack is
therefore **pack-reproducible** in the same sense a map tile pack or a font pack
is: the app is a deterministic consumer of versioned, verified data. It is not
strict-reproducible for a random book.

---

## 4. Runtime contract

### 4.1 Load and verification

`js/pack-loader.js`:

1. Read `pack/latest.json` and `pack/manifest.json` (network or bundled).
2. Verify `SHA-256(manifest bytes) === latest.manifestSha256`.
3. Validate the manifest schema: spine geometry, entry ids, rights block, quality
   status, design colours, safe `files/` paths, file hashes and dimensions.
4. For each of `art`, `spine`, `spine2x`:
   - read a cached blob from IndexedDB and re-hash it, or
   - fetch the file, check byte length, hash it, and reject on mismatch.
5. Cache only verified blobs. A corrupt fetch is never written.
6. Return entries with `status` (`verified` / `corrupt-or-missing`),
   `accepted` and a fallback `reason`.

`mode` values:

| Mode | Behaviour |
|---|---|
| `bundled` | Fetch the local pack directory, no artificial latency. |
| `download` | Same fetch with simulated per-file latency and progress. |
| `offline` | IndexedDB only; never calls `fetch`. Fails if the cache is absent. |
| `auto` | Cache first, network only if the cache is absent or invalid. |
| `refresh` | Network, replace the cache. |

In the APK the shell is bundled, so only the pack needs a cache. The gallery also
tests a literal offline **page** reload: `sw.js` caches the gallery shell, fonts
and catalogue, while the pack is deliberately excluded from that cache and comes
from IndexedDB. The loader then re-hashes every cached blob with no network. That
is stricter than the app needs and keeps the gallery test honest.

### 4.2 Matching

`matchEdition(book, manifest)` is conservative:

1. **ISBN** exact after normalisation (digits + `X`), confidence 1.00.
2. **Content hash** of the source cover, confidence 0.98. This survives a
   re-import where the ISBN is missing or the file was re-encoded identically.
3. **Title + author** normalised (diacritics, punctuation, `&`/`and`), confidence
   0.82. This route is blocked when both sides have a present-but-different ISBN,
   so a wrong edition cannot silently claim the art.

The catalogue snapshot (`library.json`) carries the content hash but not the
source cover bytes; the app already has those bytes from its own ingest. The pack
never needs to ship the original in-copyright cover just to match it.

### 4.3 Fallback matrix

| Condition | `reason` | Render |
|---|---|---|
| No pack loaded | `pack-unavailable` | Typographic cloth |
| No ISBN/hash/title match | `no-edition-match` | Typographic cloth |
| Asset hash/byte check failed | `asset-integrity` | Typographic cloth |
| `quality.status = reject` | `quality-reject` | Typographic cloth |
| Release policy, restricted rights | `rights-restricted` | Typographic cloth |
| Missing/unverified spine file | `asset-missing` | Typographic cloth |
| Healthy entry | — | Hybrid or Art-only |

The fallback is the same measured v6/v7 type engine in the cloth direction. It is
not an empty box or a broken image.

---

## 5. Integrity and update model

### 5.1 What SHA-256 protects

SHA-256 detects corruption and partial writes: a truncated download, a flipped
byte, a bad flash page or an incomplete cache. The loader fails closed and the
spine falls back.

It does **not** authenticate a malicious mirror, because an attacker who controls
`latest.json` can change both the manifest hash and the manifest. Production must
add a detached signature over `latest.json` using the update key the app already
trusts (the APK uses minisign today). The prototype leaves that as an integration
step and says so in the UI footer.

### 5.2 Update flow

1. Content-side build: select/licence the edition, produce the textless art and
   the 52/104 px crops, run the spine-scale acceptance check.
2. `tools/build-pack.mjs` copies the assets, computes every SHA-256 and writes
   `manifest.json`, `latest.json`, `library.json`, `size.json` and the zip.
3. Publish the new pack under a new `version`. `latest.json` points at the new
   manifest hash.
4. App fetches `latest.json` (through Rust if remote), verifies the signature,
   compares versions.
5. App downloads changed files, verifies each hash, writes them to IndexedDB, then
   atomically swaps the manifest/version record. The previous version is kept for
   one rollback.
6. A failed download or verification leaves the old pack in place. A failed entry
   falls back, not the whole shelf.

### 5.3 Takedown

Removing an edition is a content operation:

1. Remove the entry from the manifest and delete its three files.
2. Bump the pack version and publish.
3. Clients on the next refresh no longer match the edition; they draw the
   typographic fallback from the catalogue record.
4. Cached clients keep the old bytes until that refresh. For an urgent takedown,
   add a short `revoked` list to `latest.json` or a TTL/forced-refresh flag; the
   app should reject a revoked id even when it is still in the local pack.

The manifest already carries a per-entry `takedown` instruction and the UI shows
it next to the rights note, so the content owner’s removal path is explicit.

---

## 6. Rights and provenance

Each entry displays/records:

- rights `status` (`public-domain`, `restricted-reference`, …);
- `distribution` (`cleared` / `restricted`);
- holder, credit line, licence note;
- source name, URL and retrieval date;
- cover artist and edition note;
- quality status/score/caveat;
- manifest SHA-256, per-asset SHA-256, sizes and byte lengths;
- takedown instruction.

The UI shows a rights badge and a release-policy switch. In `study` mode the four
reference entries render; in `release` mode only the 2 cleared entries are
accepted and the rest fall back. That is the app-side expression of
`policy.releaseRequiresClearedRights`.

**This pack is not distributable as-is.** The modern covers belong to their
publishers/estates. A production Popular Editions Pack needs a licence for those
images or a switch to licensed/commissioned art. The two public-domain entries
(Moby-Dick and The Hound of the Baskervilles) show that the route can ship today
with cleared content.

---

## 7. Evidence

`node popular-app/tests/audit.cjs` — all checks passed.

| Metric | Result |
|---|---|
| Pack size | **1,916.1 KiB** (1.87 MiB); zip **1,895.3 KiB** |
| Manifest | 19,749 bytes; 6 entries; 18 assets |
| First load | 18/18 verified, 6 entries, **197–405 ms** across runs |
| Verify time | **~192–330 ms** |
| Offline page reload | shell from the gallery service worker, pack from IndexedDB; 18/18 verified, **82–209 ms**, 0 network files |
| Simulated download | 18/18 verified, **3.6–3.8 s** with 180 ms/file artificial latency |
| Scenarios | **7/7**: first load, download, offline, missing, corrupt, rejected, rights |
| Widths | 390 px and 320 px |
| Render matrix | Hybrid × 1x/2x and Art-only × 1x/2x at both widths |
| Overflow | **0** |
| Console/page errors | **0** |
| Type fit | every spine `data-fit <= 1.001` |
| Fallbacks | 2 expected: LOTR (quality reject), Project Hail Mary (no edition) |

Full output: `tests/results.json`. Screenshots: `screenshots/audit-*.png`.
Timings are desktop Chromium against a local static server, not a phone
benchmark. They prove the path and the size; they do not claim device latency.

---

## 8. What still needs doing

1. **Integration:** wire `js/pack-loader.js` / `js/spine-renderer.js` into
   `Shelf.tsx` or a Tauri command; add the gallery to the shared dock/review in
   the integration pass (deliberately not done here).
2. **Device pass:** run the same checks in the Android WebView at 320/360/390 px,
   with a real IndexedDB quota and the bundled fonts. Measure first-load and
   memory on a mid-range phone.
3. **Remote transport:** fetch `latest.json`/manifest/assets through Rust because
   the WebView CSP is `connect-src 'self' ipc:`. A bundled pack needs no change.
4. **Signature:** sign `latest.json` with the update key and pin it. SHA-256 alone
   is corruption detection, not publisher authentication.
5. **Rights:** licence the modern covers or remove them from the release pack.
   Keep `releaseRequiresClearedRights` on.
6. **Quota/eviction:** request persistent storage and handle quota failures; the
   loader already falls back to memory if IndexedDB is unavailable, but a
   production app should surface a “pack unavailable, using type” state.

Under the strict suite rule, the audit status is **not strict-reproducible**: the
pack route is a feature, not a random-book pipeline. Even after integration, it
would remain pack-only. v8-app is the pending route for arbitrary books.
