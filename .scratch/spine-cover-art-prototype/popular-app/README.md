# Popular Editions Pack — pack-reproducible spines

**Status:** working app-capable prototype. Throwaway study code; no production app,
tests, manifests or specs were changed. Not linked from the shared dock, the review
page or the reproducibility page — the integration pass should wire it.

**Open:** `http://127.0.0.1:4173/spine-cover-art-prototype/popular-app/`

This supplies the app route that v7 lacked for **Popular books** — one the Tauri
Android WebView can actually run:

```
download or bundle the pack
  -> verify manifest SHA-256
  -> verify every asset SHA-256
  -> cache manifest + blobs in IndexedDB
  -> match a book by ISBN / content hash / title+author
  -> render v6/v7 Hybrid or Art-only at 52 x 236 and 2x
  -> fall back to a typographic cloth spine if missing, corrupt, rejected or rights-blocked
```

No Python, RapidOCR, LaMa, hand-drawn masks or on-device model at runtime.

## Verdict

**Popular books is pack-reproducible for the six editions in the pack, but it is
not strict-reproducible.** The exact runtime step is data + WebView APIs, and the
audit passes at 390 and 320 px with zero console errors and zero overflow, but a
random book outside the pack falls back to a cloth spine. It is **not in the
shipped APK yet**, and four of the six editions are **reference-only, not
rights-cleared for distribution**. See
[`APP-REPRODUCIBILITY.md`](APP-REPRODUCIBILITY.md).

## What is in the pack

`pack/` is the bundle. `pack/popular-editions-pack.zip` is the single-file
distribution of the same bytes.

| Item | Value |
|---|---|
| Pack id | `popular-editions` |
| Version | `2026.11.26.1` |
| Editions | 6 (4 in-copyright reference, 2 public domain) |
| Assets | 18: textless art + 52 x 236 spine + 104 x 472 spine per edition |
| Manifest | `pack/manifest.json` (19,749 bytes) |
| Bundle size | **1,916.1 KiB (1.87 MiB)** |
| Zip size | **1,895.3 KiB (1.85 MiB)** |
| Manifest SHA-256 | in `pack/latest.json` |

Each manifest entry carries:

- `match` — ISBN, title, author, and a content hash of the source cover
- `edition` — title, author, year, publisher, ISBN, pages, spine mm, edition note,
  cover artist, source name/URL/retrieved date
- `edition.rights` — status, distribution (`cleared` / `restricted`), holder,
  licence note, credit line, takedown instruction
- `quality` — `pass` / `reject`, score, reason, caveat, preferred direction
- `design` — cloth, accent, tone, focus, measured colours
- `files` — path, SHA-256, byte length, width, height, MIME for art/spine/spine-2x

The pack is built by `tools/build-pack.mjs` from the existing v3/v7 study assets.
The four modern covers are copied from v7; the two public-domain entries are
Moby-Dick and The Hound of the Baskervilles from v3.

## Exact commands

Serve the prototype root (already running on 4173 in this workspace):

```sh
cd .scratch/spine-cover-art-prototype
python3 -m http.server 4173 --bind 0.0.0.0
# open http://127.0.0.1:4173/spine-cover-art-prototype/popular-app/
```

Rebuild the pack and recompute every hash (requires `ffmpeg`, `ffprobe`,
`python3`):

```sh
cd .scratch/spine-cover-art-prototype
node popular-app/tools/build-pack.mjs
```

Run the full audit (starts its own static server on port 4189, writes
`tests/results.json` and screenshots):

```sh
cd .scratch/spine-cover-art-prototype
node popular-app/tests/audit.cjs
```

Expected tail:

```text
ALL CHECKS PASSED
```

## Audit results

From `tests/results.json` (desktop Chromium, local static server):

| Check | Result |
|---|---|
| First load | 18/18 files verified, 6 entries, **197–405 ms** across runs |
| Manifest + file verification | **~192–330 ms** |
| Offline page reload | shell from the gallery service worker, pack from IndexedDB; 18/18 verified, **82–209 ms**, 0 network files |
| Simulated download (180 ms/file) | 18/18 verified, **3.6–3.8 s** (artificial latency, not a network benchmark) |
| Scenarios | **7/7 pass**: first load, download, offline, missing, corrupt, rejected, rights |
| Widths | 390 px and 320 px |
| Render matrix | Hybrid and Art-only × 1x and 2x at both widths (8 combinations) |
| Overflow | **0** page overflow at every combination |
| Console / page errors | **0** |
| Type fit | every spine `data-fit <= 1.001` |
| Fallbacks | 2 expected: Lord of the Rings (quality reject) and Project Hail Mary (no edition) |

Screenshots: `screenshots/audit-390-*.png`, `screenshots/audit-320-*.png`.

## Tested failure modes

| Mode | What happens |
|---|---|
| Missing edition | Project Hail Mary is deliberately absent. `matchEdition` returns null; the shelf draws a cloth spine from the catalogue record. |
| Corrupt asset | One byte of The Hobbit is flipped after fetch. SHA-256 rejects it; the entry is `corrupt-or-missing` and the spine falls back. |
| Rejected art | The Lord of the Rings files verify, but `quality.status = reject`; the renderer refuses the art and uses type on cloth. |
| Rights gate | Release policy accepts only the 2 `cleared` entries. Harry Potter, LOTR, The Hobbit and The Hunger Games fall back. |
| Offline | A real page reload with the browser offline: the gallery shell is served by `sw.js`, the pack by IndexedDB. `mode: "offline"` never touches `fetch`; it re-hashes every cached blob and fails closed if one is missing. In the APK the shell is already bundled, so the service worker is gallery-only. |
| Wrong ISBN | A present-but-different ISBN blocks the weaker title+author match, so the wrong edition cannot claim the art. |

## Integration notes

- Open `popular-app/` from the app bundle (or serve it) and wire its
  load/match/render calls into the shelf. The renderer is in
  `js/spine-renderer.js`; the loader is in `js/pack-loader.js`.
- For a remote pack in Tauri, fetch `latest.json`, the manifest and assets through
  Rust (`wreq`) because `tauri.conf.json` restricts the WebView to
  `connect-src 'self' ipc:`. A bundled pack needs no CSP change.
- Production should verify a detached signature over `latest.json` with the
  existing update key in addition to SHA-256. SHA-256 detects corruption; a
  signature authenticates the publisher.
- Do not ship the four reference-only entries. Replace them with licensed art or
  keep them out of the release pack; `policy.releaseRequiresClearedRights` is
  already enforced by the prototype.
- The prototype is intentionally **not** in the shared dock/review. Leave that to
  the integration pass.

## Files

```text
popular-app/
  index.html                 gallery + controls + scenarios
  app.css                    app shell and mode styles
  sw.js                      gallery-only shell cache (offline page reload)
  spine.css                  copied v6/v7 spine stylesheet (throwaway reuse)
  fonts/                     copied OFL fonts
  js/pack-loader.js          fetch, SHA-256, IndexedDB, matching, validation
  js/spine-renderer.js       measured v6/v7 type + Hybrid/Art-only/fallback markup
  js/app.js                  UI, scenarios, harness API
  library.json               app catalogue snapshot, incl. one deliberate miss
  pack/                      manifest, latest, size, 18 assets, zip
  tools/build-pack.mjs       reproducible pack builder + hashing
  tests/audit.cjs            Playwright audit, writes tests/results.json
  tests/results.json         latest audit output
  screenshots/               audit captures at 390/320, 1x/2x
  APP-REPRODUCIBILITY.md     argument, manual work, updates, rights
```

## Licence / scope

The four modern covers are in copyright and are used only as reference in this
throwaway prototype. They are marked `restricted-reference` in the manifest and
must not be redistributed. The two public-domain entries are cleared. Fonts are
OFL; see `fonts/OFL-*.txt`. Nothing here is production code.
