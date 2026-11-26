# Strict reproducibility audit — spine-cover-art-prototype

**Date:** 2026-11-26
**Scope:** `.scratch/spine-cover-art-prototype/` only. No production app code, tests, manifests or specs changed. No commit.
**Strict rule:** the APK itself must create the spine for a **random downloadable book**, end-to-end.

A pack is a bonus, not strict reproducibility. A renderer that needs a supplied asset is not end-to-end. A hosted service or desktop build is not the APK.

---

## 1. Current state

| | Count | Detail |
|---|---:|---|
| **Yes — user-verified on device** | **6** | `v8-app`, `App renderers`, and Full-bleed, Textless art, Wrap engine and Design system via App renderers. |
| **App-compatible — pending integration** | **2** | `Popular books` via `Popular app route`, and `Popular app route` itself. |
| **Bonus — not strict** | **2** | Textless Art Pack and Popular Editions Pack. |
| **Superseded** | **2** | v8 desktop CLI and the hosted Generative art route. |
| **Not a route** | **1** | Reference / bookcover-js. |

**Total: 13 audited rows. 6 yes, 2 pending integration, 5 not strict. 0 pending device proof.**

---

## 2. What changed

### v8-app — user-verified
The user tested the v8 Android APK on a real device and says it works. This is the strict pipeline proof: a random book’s cover goes through the on-device v8 pipeline and comes out as a spine.

### App renderers — user-verified
The user tested the renderer APK and says it works. It packages the v8 pipeline plus four renderer routes:

- Full-bleed
- Textless art-only
- Wrap engine
- Hybrid / Cloth / Editorial

APK facts, re-checked against the file:

| Field | Value |
|---|---|
| File | `v8-renderers-arm64-v8a.apk` |
| Size | **21,182,173 bytes** |
| SHA-256 | `e0efbef0b3d382834954a8abd0e1739fb2ac2a765980a99667520a9bdc238f58` |
| ABI | arm64-v8a |
| Package | `app.pocketlibrary.spinetest` |
| Device tested | **yes — user report** |

Because the four renderer routes are inside the verified App renderers APK, **Full-bleed, Textless art, Wrap engine and Design system are also strict yes** — via App renderers.

### Popular app route — app-compatible, pending integration
`popular-app-route/` reruns the popular and generative cases through v8-app:

- **Dune** (unseen) — pass
- **LOTR** — fallback
- **RPS** — review
- Popular and generative cases render through the v6/v7 Hybrid / Art-only engines.

It is a WebView gallery using v8-app outputs. There is no separate APK for this renderer. It uses the verified pipeline, but it is not integrated into Tauri and not separately device-verified. **This is the next gap.**

### Curated packs — bonus
Textless Art Pack and Popular Editions Pack remain useful fast paths. They cover only pack books. They are not strict reproducibility for a random book.

### Reference — design only
bookcover-js is a manual export tool with hand-entered width and type. It is a design reference, not a route.

### Old routes — superseded
- **v8 desktop** (`v8-auto`) — the Python/torch/RapidOCR/LaMa CLI is superseded by `v8-app`.
- **Generative art** (`v4-generative`) — hosted FLUX/Pollinations is a design record; `v8-app` is the automatic route.

---

## 3. Matrix

| Study | Current run | Random-book spine in APK? | Evidence / what next |
|---|---|---|---|
| **Full-bleed** (`v2/`) | Automatic | **Yes — via App renderers, user-verified on device** | Part of the verified App renderers APK. |
| **Textless art** (`v3/`) | Automatic for this book | **Yes — via App renderers, user-verified on device** | Art-only route in the verified App renderers APK. |
| **Textless Art Pack** (`textless-app/`) | Pack (WebView) | **Bonus — not strict** | 18 curated public-domain books. Useful fast path, not random-book. |
| **Wrap engine** (`v4-wrap/`) | Automatic | **Yes — via App renderers, user-verified on device** | Wrap route in the verified App renderers APK. |
| **Generative art** (`v4-generative/`) | Manual only | **Superseded by v8-app** | Hosted FLUX is a design record. v8-app is user-verified. |
| **Design system** (`v6/`) | Automatic | **Yes — via App renderers, user-verified on device** | Hybrid/Cloth/Editorial in the verified App renderers APK. |
| **Popular books** (`v7/`) | N/A | **Via Popular app route — pending integration** | v8-app outputs exist; renderer not integrated into Tauri. |
| **Popular app route** (`popular-app-route/`) | WebView gallery | **App-compatible — pending integration** | Dune pass, LOTR fallback, RPS review. No separate APK. |
| **Popular Editions Pack** (`popular-app/`) | Pack (WebView) | **Bonus — not strict** | Six curated editions; four reference-only. Optional fast path. |
| **Automatic generative** (`v8-auto/`, desktop) | Automatic (desktop) | **Superseded by v8-app** | The desktop CLI is no longer the route. |
| **App renderers** (`app-renderers/`) | User-verified | **Yes — user-verified on device** | 21,182,173 bytes; SHA-256 `e0ef…8f58`; user tested the APK. |
| **Reference** (`bookcover-js-deep/harness/`) | Manual export | **Not a route** | Manual design reference. Not counted. |
| **v8-app** (`v8-app/`) | User-verified | **Yes — user-verified on device** | User tested the Android APK on a real device. |

---

## 4. What to test next

**The renderer APK is no longer the gap.** Both v8-app and App renderers are user-verified on device. The next gap is **Popular app route / Tauri integration**:

1. Wire the v8-app + renderer path into the Tauri app rather than a standalone APK shell.
2. Add the production shelf mode; `Shelf.tsx` still draws a hashed colour spine.
3. Ship the v8 models and ORT library, or download them through Rust.
4. Verify the popular and generative cases on-device after integration.
5. Capture 390/320 screenshots and the v8 route/verdict.

Packs remain bonus only. No new renderer APK build is needed for the strict claim.

---

## 5. What the shipped app still needs

The renderer APK is a test harness, not Tauri integration. Production still needs:

1. **A Tauri command** around the v8 pipeline, with cover path/bytes, metadata and output directory.
2. **Model and ORT shipping** — det/rec/keys + arm64 `libonnxruntime.so` (~33 MB); LaMa as an optional download, not a bundle.
3. **Artifact handoff** — persist `spine.jpg`, `spine-2x.jpg`, `fallback-spine.jpg`, `crop-native.jpg` and feed the text-free crop to the existing renderer.
4. **Shelf mode** — `Shelf.tsx` still draws a hashed colour spine; it needs an art-spine mode and an offscreen cache.
5. **Device budgets** — cold start, memory, payload size and 390/320 layout on a mid-range phone.

---

## 6. Verification

The suite was checked at **390 and 320 px** across the review page, the reproducibility page, all ten docked study pages, and the two pack pages (28 checks). Result: **0 page overflow, 0 callout overflow, 0 console errors, 0 page errors, 0 failed requests**.

The shared dock still has ten studies and one arrow-pair.

**Files changed for this audit:**
- `study-nav.js` — six strict yes callouts; next gap is popular-app/Tauri integration.
- `reproducibility/index.html` — 6-yes rubric, updated 13-row matrix, updated result cards and next-step note.
- `reproducibility/results.json` — six strict-yes entries, App renderers device-tested, updated summary and rubric.
- `reproducibility/capture.cjs` — regenerates the same state.
- `review/index.html` — six-yes summary and updated matrix.
- `README.md` — current counts and v8/App renderers status.
- `APP-REPRODUCIBILITY.md` — this evidence file.

**Not changed:** `app-renderers/` source, `v8-app/`, `v8-android/`, production code, tests, manifests or specs.
