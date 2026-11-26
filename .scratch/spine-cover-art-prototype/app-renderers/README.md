# app-renderers — v8 art into four spine studies

**Status:** throwaway design/technical prototype. Everything lives under
`.scratch/spine-cover-art-prototype/app-renderers/`. No production app code,
tests, manifests or specs were changed. `v8-app/` and `v8-android/` were read
only; the Android shell here is a copy. The shared dock now links this gallery;
the renderer and APK source were not changed. Nothing was committed or released.

**Gallery:** <http://127.0.0.1:4173/spine-cover-art-prototype/app-renderers/>  
(or `/spine-cover-art-prototype/app-renderers/` on whatever host serves
`.scratch`)

**APK:** [`android-renderer/out/v8-renderers-arm64-v8a.apk`](android-renderer/out/v8-renderers-arm64-v8a.apk)
· 21 MB · arm64-v8a · Android 8.0+ · package `app.pocketlibrary.spinetest`  
**SHA-256:** `e0efbef0b3d382834954a8abd0e1739fb2ac2a765980a99667520a9bdc238f58`

---

## What this proves

The v8 Android pipeline already turns a downloaded cover into text-free art, a
52 × 236 spine crop and a QA verdict **on the phone**. This study adds the
missing renderer layer and proves the chain:

```
downloaded / picked cover
        │
        ▼
v8-app Rust/ONNX  (same library and models in the APK)
  DBNet → mask → text-free crop / fill → QA
        │
        ├── art.jpg
        ├── spine-2x.jpg (52 × 236)
        ├── run.json / qa.json
        ▼
app-renderer layer  (this folder)
  crop box from run.json + art.jpg
        │
        ├── Full-bleed spine
        ├── Textless art-only spine
        ├── Wrap engine (back / spine / front)
        └── Design system: Hybrid / Cloth / Editorial
```

No new art, mask, crop or pack lookup is introduced by the renderer. It reads
the pipeline's own `final.crop_box_work` and applies it to `art.jpg`.

## Per-style verdicts for the random books

The four named inputs are *The Great Gatsby*, *Dune*, *Pride and Prejudice* and
*Rock Paper Scissors*. The unseen holdout is *The War of the Worlds*, downloaded
from Standard Ebooks after the v8 tuning set. Every row was run through the real
host `v8-app` binary; renderer fit/contrast is measured from the actual canvases.

| Book | v8 route / verdict | Full-bleed | Art-only | Wrap | Hybrid | Cloth | Editorial |
|---|---|---|---|---|---|---|---|
| **The Great Gatsby** | text-free crop · pass | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** |
| **Dune** | text-free crop · pass | **review** | **review** | **pass** | **pass** | **pass** | **review** |
| **Pride and Prejudice** | text-free crop · pass | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** |
| **Rock Paper Scissors** | inpaint · **review** | **review** | **review** | **review** | **review** | **pass** | **review** |
| **The War of the Worlds** (holdout) | inpaint · pass | **pass** | **pass** | **pass** | **pass** | **pass** | **pass** |

Two honest review cases, for two different reasons:

- **Dune** is a v8 **pass** (zero mask coverage, zero residual OCR), but the crop
  retains parts of the giant decorative `DUNE` letterforms. DBNet does not box
  display type that large, so OCR cannot see it. At 52 px the letterforms are
  obvious in the *art-only* and *editorial* spines, and still visible beside the
  full-bleed rail; they read as texture in the 33 px wrap spine and the 22 px
  Hybrid art window. The renderer does not re-crop v8 output, so it reports the
  review instead of hiding it. A forced left-edge crop (or an inpaint route)
  would fix it.
- **Rock Paper Scissors** is a v8 **review**: 44.1 % mask, flat-fill substitute,
  no LaMa. Every art-bearing style inherits the review. **Cloth** has no art
  window and passes on type/contrast alone.

This is the difference between a QA verdict and a human one: v8 measures
residual OCR and structure, not whether a decorative letterform is still
recognisable. The gallery shows the v8 verdict pill; the per-style verdicts live
here.

Measured renderer checks (all books, all styles): title fit **≤ 0.97** of its
box, no clipping, contrast **5.3–15.5 : 1**. The tightest case is the holdout
full-bleed title at 96.6 % of its length box. The Dune and RPS reviews are
**content** verdicts, not type failures: every style still fits and contrasts.
Details are in [`metrics.json`](metrics.json); layout/console results are in
[`audit.json`](audit.json).

## Exact execution split

### Host gallery (what the screenshots show)

- v8-app ran on this x86-64 host, ONNX Runtime 1.32 CPU, no LaMa.
- Its `out/<slug>/` directories are checked in under `v8-output/`.
- Chromium renders the gallery from `art.jpg`, `spine-2x.jpg`, `run.json` and
  `qa.json` through `renderer/renderer.js`.
- This is a **host renderer proof**, not the device proof.

### On-device APK

`android-renderer/` is a copy of the v8-android Java shell with one new
Activity. The APK contains:

- `lib/arm64-v8a/libv8android.so` — copied prebuilt from the read-only
  `../v8-android/build/`, same Rust JNI pipeline;
- `lib/arm64-v8a/libonnxruntime.so` — ONNX Runtime 1.20.0 arm64;
- `assets/models/{det.onnx,rec.onnx,keys.txt}` — the v8 PP-OCRv3 models;
- `assets/covers/*` — the five study covers, as samples;
- `assets/renderer/*` — the exact renderer JS/CSS/fonts used by the gallery.

Flow on the phone:

1. `MainActivity` fetches a cover URL, picks a device image, or uses a bundled
   sample.
2. It calls `nativeRun(...)`; the Rust/ONNX pipeline writes
   `filesDir/runs/<slug>/` (`art.jpg`, `spine-2x.jpg`, `run.json`, `qa.json`).
3. **Render four spine styles on device** opens `RendererActivity`.
4. `RendererActivity` reads that run directory, passes the images as data URIs
   to a bundled WebView, and the renderer draws all six spines + QA/provenance.
   No network, no second inference, no upload.

### What was actually executed here

| Step | Host | This environment |
|---|---|---|
| v8 Rust/ONNX pipeline on the five covers | yes | **yes** (host binary) |
| Renderer at 390 / 320 px | yes | **yes** (Chromium) |
| APK compile, sign, package verify | n/a | **yes** |
| APK WebView asset path with the real payload shape | n/a | **yes** (Chromium + mock `PocketBridge`, exact bundled files) |
| Install / run APK on a phone or emulator | n/a | **no** — no adb device, emulator, image or `/dev/kvm` |

The user separately device-tested the v8 Android pipeline. This APK reuses that
pipeline's native library and models, but the **new Java Activity → WebView
handoff has not been tapped on a device in this environment**. That is the one
remaining proof step.

## What is now app-reproducible

- **The renderer layer is app-capable.** It consumes only the run directory the
  native pipeline writes; it is not a desktop build, hosted service or pack
  lookup. The APK bundles it and the native pipeline together.
- **A random book path exists end-to-end in one APK:** URL/pick → on-device
  DBNet/mask/crop/QA → renderer → six spines. No per-book asset is bundled for
  the random URL path.
- **The four studies are no longer renderer-only.** Full-bleed, art-only, wrap
  and the design system all have a concrete consumer for v8 output, with the
  crop box and QA carried through to the gallery.

What this does **not** yet claim: strict on-device reproducibility for this new
APK. The missing evidence is a phone run of *this* APK, not a renderer gap. Until
then the honest status is **app-capable, device-run pending**.

## What still needs Tauri integration

1. **No production pipeline.** The shipped Tauri app has no OCR, segmentation,
   inpainting or ONNX runtime in `core/` or `src-tauri/`. v8-app / v8-android
   are standalone harnesses. Moving the Rust pipeline into the Tauri crate (or
   shipping it as a JNI library) is the real integration.
2. **No production renderer hook.** `src/library/Shelf.tsx` still draws the
   hashed-colour typographic spine. The renderer needs a new spine mode, an
   offscreen cache, and a decision about when to prefer art over colour.
3. **File handoff.** The APK reads `filesDir/runs/...` directly. Tauri should
   expose the same artifacts through scoped commands (or a cache directory
   URL) rather than a broad file bridge. The APK's bridge is acceptable for a
   throwaway test because both sides are local.
4. **CSP.** The production WebView allows `self`, `ipc:`, `data:` and `blob:`
   images only. The renderer needs no remote calls, but bundled fonts/assets
   must be served from the app origin and the model download (if LaMa is
   offered) must go through Rust.
5. **Model weight.** det + rec + ORT add ~33 MB; LaMa is an optional 208 MB
   download. arm64-only. Decide whether the feature is installed by default or
   downloaded on first use.
6. **Fonts.** The study bundles EB Garamond and Literata. Production should use
   its own font set or the renderer's serif/sans fallbacks.
7. **Shelf-scale performance.** The gallery draws six styles for five books in
   Chromium. A shelf needs one cached bitmap per book, not six live canvases,
   plus a decode/memory budget on mid-range phones.
8. **Export/share.** The gallery has no export. The APK has the v8 export path
   for the 52 × 236 spine only; rendered styles are not yet written to
   Downloads/MediaStore.

## Exact APK / device blockers

1. **No device in this environment.** `adb devices` is empty; there is no
   emulator package, system image or `/dev/kvm`. The APK is built, signed and
   `apksigner`-verified, but not installed or launched.
2. **arm64-v8a only.** `INSTALL_FAILED_NO_MATCHING_ABIS` on 32-bit or x86
   phones. minSdk 26.
3. **The new WebView handoff is unproven on-device.** The assets and payload
   shape were exercised in Chromium (1.3 MB RPS payload, 1.4 MB holdout payload,
   no console errors, no overflow). Android WebView's JS bridge has its own
   memory/pipe limits; the Java side now downscales `source.jpg` before sending
   it to keep the payload small, but a real phone run is required.
4. **v8 crop-route `art.jpg` is not globally textless.** On a passing text-free
   crop, the pipeline does not inpaint the whole cover: `art.jpg` still carries
   the printed cover text outside the chosen crop. Every art-bearing style uses
   the chosen crop, so the spines are text-free, and the gallery labels the art
   output honestly. A genuinely textless full front would need an inpaint route
   or a licensed textless asset.
5. **RPS remains review.** 44.1 % mask, flat-fill substitute, no LaMa. Cloth is
   the only RPS style that does not inherit the review.
6. **Wrap front is published art.** The wrap uses the published front cover
   unchanged (v4 behaviour); only the spine and back are composed. The back is
   generated, its blurb is original prototype copy, and the barcode is not a
   real retail barcode.
7. **Covers are not cleared.** Gatsby, Dune, Pride and RPS are modern edition
   covers used as design references only. The holdout is a Standard Ebooks
   public-domain cover.

## Reproduce

### 1. Host v8 runs

```bash
cd .scratch/spine-cover-art-prototype
export ORT_DYLIB_PATH=/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0

./v8-app/target/release/v8-app run \
  --cover app-renderers/covers/gatsby.jpg --slug gatsby \
  --title "The Great Gatsby" --author "F. Scott Fitzgerald" --pages 180 \
  --out app-renderers/v8-output --models v8-app/models

# repeat for dune (617 pp), pride (432 pp), rps (320 pp),
# and the holdout war-of-the-worlds (192 pp)
```

The holdout cover was downloaded from
`https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/cover.jpg`.

### 2. Build data and view

```bash
cd .scratch/spine-cover-art-prototype/app-renderers
python3 tools/build-data.py

cd /mnt/ssd2/Projects/PocketLibrary
python3 -m http.server 4173 --bind 0.0.0.0 --directory .scratch
# open http://127.0.0.1:4173/spine-cover-art-prototype/app-renderers/
```

### 3. Re-run the 390 / 320 audit and metrics

```bash
cd /mnt/ssd2/Projects/PocketLibrary
NODE_PATH=$PWD/node_modules node .scratch/spine-cover-art-prototype/app-renderers/tools/capture.cjs
NODE_PATH=$PWD/node_modules node .scratch/spine-cover-art-prototype/app-renderers/tools/metrics.cjs
```

`capture.cjs` also loads the bundled APK renderer page with a mock
`PocketBridge` payload and checks it at both widths.

### 4. Build the APK

```bash
cd .scratch/spine-cover-art-prototype/app-renderers/android-renderer
JAVA_HOME=$HOME/tools/jdk-21 ./scripts/build-apk.sh
```

The script reads the prebuilt `libv8android.so` / `libonnxruntime.so` from
`../../v8-android/build/lib/arm64-v8a/` and the models from `../../v8-app/models/`.
It does not modify either directory.

### 5. Device test (when an adb device exists)

```bash
adb install -r out/v8-renderers-arm64-v8a.apk
adb logcat -c
adb shell am start -n app.pocketlibrary.spinetest/.MainActivity
adb logcat -s v8android v8renderers
```

Then: pick a sample or paste a cover URL → **Generate spine on device** →
**Render four spine styles on device** → screenshot the six spines and the QA
panel. A run counts only if the cover was fetched/selected on the phone and
`run.json` was written by the on-device pipeline.

## Audit results

| Check | 390 px | 320 px |
|---|---:|---:|
| Gallery books / styles | 5 / 30 | 5 / 30 |
| Gallery overflow (doc / body) | 0 / 0 | 0 / 0 |
| Gallery overflowed elements | 0 | 0 |
| Gallery images loaded | 15 / 15 | 15 / 15 |
| Gallery console / page / request errors | 0 | 0 |
| Fonts loaded (Garamond, Literata) | yes | yes |
| APK WebView page styles | 6 | 6 |
| APK WebView overflow | 0 | 0 |
| APK WebView errors | 0 | 0 |

## Files

```
app-renderers/
  index.html                 gallery
  gallery.css
  renderer/
    renderer.js              the renderer layer (Canvas, measured type)
    renderer.css
    fonts/                   EB Garamond + Literata (SIL OFL)
  data/
    books.json, books.js     generated manifest
  covers/                    five input covers
  v8-output/<slug>/          real v8-app output (art, crop, QA, run.json)
  android-renderer/
    AndroidManifest.xml
    java/.../MainActivity.java      copied v8 shell + render button
    java/.../RendererActivity.java  WebView + run-dir → data-URI bridge
    assets/renderer/                bundled renderer (same files)
    assets/covers/                  five samples
    scripts/build-apk.sh
    out/v8-renderers-arm64-v8a.apk
  tools/
    build-data.py            manifest from run.json/qa.json
    build-payloads.py        WebView payload for host proof
    capture.cjs              390/320 audit + screenshots
    metrics.cjs              per-style fit/contrast metrics
  screenshots/               gallery and APK-WebView captures
  audit.json
  metrics.json
  README.md
```

## Licence and provenance

- Renderer code and study text: throwaway design reference, no separate licence.
- v8 pipeline, PP-OCRv3 models and ONNX Runtime: see `../v8-app/README.md` and
  `../v8-android/README.md` (Apache-2.0 / MIT).
- EB Garamond and Literata: SIL Open Font License; OFL texts are in
  `renderer/fonts/`.
- *The Great Gatsby*, *Dune*, *Pride and Prejudice* and *Rock Paper Scissors*
  covers: modern edition art, used only as throwaway design references, not
  public domain and not rights-cleared for production.
- *The War of the Worlds*: Standard Ebooks cover, public domain.
