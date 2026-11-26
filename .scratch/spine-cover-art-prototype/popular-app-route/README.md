# Popular books × Generative art — the v8-app route

**Status:** throwaway design prototype. Everything lives under
`.scratch/spine-cover-art-prototype/popular-app-route/`. No `v8-app/`,
`v8-android/`, production app code, tests, manifests or specs were modified. The
shared dock now links this gallery; the v8 output and renderer source were not
changed. No commit or release.

**Open:** <http://127.0.0.1:4173/spine-cover-art-prototype/popular-app-route/>

**Finding in one line:** the v8-app Rust route turns real popular covers into
app-capable spine art on the device — **4 pass, 1 fallback across the five
popular books**, plus **1 review and 1 pass** on the generative-art cases — with
no hosted model, credentials, hand mask or desktop precompute. Both the
**Popular books** and **Generative art** studies now have a reproducibility
route that does not depend on a curated pack.

---

## The two statements this page is making

1. **The Popular Editions Pack is now a bonus, not the reproducibility
   mechanism.** Any popular cover goes through v8-app on-device. The pack stays
   optional: a rights-cleared fast path if it is already on the device, and a
   fallback when the app route cannot run. The gallery renders every book from
   v8-app output first; the pack strip is shown afterwards, labelled as an
   optional extra.
2. **Reference/bookcover-js is a design reference, not a reproducibility
   route.** It is a manual export tool with hand-entered width and type. It does
   not turn a random cover into a spine, and it is not counted here.

---

## Per-book app-route verdicts

| Book | Route | Verdict | Mask | Host run | Hybrid | Art-only | Curated pack |
|---|---|---|---:|---:|---|---|---|
| *Harry Potter and the Philosopher's Stone* | text-free crop | **pass** | 37.4 % | 3.90 s | pass | pass | bonus · pass 20/25 |
| *The Hunger Games* | text-free crop | **pass** | 27.5 % | 4.47 s | pass | pass | bonus · pass 21/25 |
| *The Lord of the Rings* | fallback | **fallback** | 77.5 % | 5.27 s | **fallback cloth** | rejected · not shipped | pack also **rejects** 17/25 |
| *The Hobbit* | inpaint | **pass** | 12.4 % | 2.86 s | pass | pass | bonus · pass 22/25 |
| *Dune* (unseen title) | text-free crop | **pass** | 6.9 % | 2.87 s | pass | pass | **no pack entry** |

### What each verdict means

- **Harry Potter — pass, crop.** DBNet finds 13 text boxes; the route finds a
  zero-text window on the Hogwarts Express. No residual OCR at 52 × 236. The
  image is in-copyright and used only as a local design reference.
- **The Hunger Games — pass, crop.** Six boxes, zero-coverage crop, residual OCR
  0. The gold pin and dark field survive. The crop window is the route's own
  choice, not a hand-picked region.
- **The Lord of the Rings — fallback.** 77.5 % of the cover is type or
  reconstruction; the QA correctly refuses the art (13.4 luma σ, 0.088 edge
  density). The app ships the typographic cloth spine. The curated pack also
  rejects this edition, so both routes agree. This is the honest answer for a
  cover whose identity *is* its typography.
- **The Hobbit — pass, inpaint.** Three boxes, 12.4 % mask, flat-ring fill (LaMa
  is not bundled). The red sun and mountain silhouette survive; residual OCR 0.
- **Dune — pass, crop, unseen.** The title is deliberately outside the curated
  pack (cover from Open Library, ISBN 9780441172719). Five boxes, 6.9 % mask,
  zero-coverage crop, residual OCR 0. This is the direct proof that the route
  does not need a pack entry.

### Generative-art cases (v4 route superseded)

| Case | Route | Verdict | Mask | Host run | Why |
|---|---|---|---:|---:|---|
| *Rock Paper Scissors* | inpaint | **review** | 45.3 % | 11.51 s | Large typography, 45 % reconstructed; without bundled LaMa the strip is plausible but not identifiable. Ship the fallback beside it. |
| *The Whisper Man* | text-free crop | **pass** | 16.4 % | 6.00 s | A zero-text crop passes; no hosted edit needed. |

The old **v4-generative** route used a hosted FLUX.1 Kontext Space or Pollinations,
hit anonymous GPU quota, was not mask-conditioned and needed human review. It is
**superseded by v8-app**, which runs automatically on-device. The hosted route
remains only as a design record.

---

## The route shown in the gallery

```
cover image / URL / bundled sample
        |
        v
v8-app Rust + ONNX Runtime        <- the same pipeline packaged in the APK
  DBNet -> Lab colour mask -> line completion -> dilation
  -> flat fill (optional LaMa) -> spine-aspect crop search
  -> residual OCR + 52x236 QA -> pass | review | fallback
        |
        v
v6/v7 renderer (WebView/Canvas)
  Hybrid   = art window + measured paper label
  Art-only = full-width text-free art, no type
  Fallback = measured type on cloth (always written)
```

**Runtime boundary:** everything above is WebView / Canvas / Rust. No hosted
model, no API key, no credential, no hand-drawn mask, no desktop Python, no
desktop LaMa pass. The optional LaMa download is not used in these runs; the
Hobbit inpaint is the built-in flat-ring fill.

The gallery images were produced by the Rust `v8-app` binary, which is the same
pipeline compiled into the `v8-android` arm64 APK. The host run is the app code
path used for capture, not a separate desktop precompute. The device proof is the
APK run reported by the user; the strict device gate is still cold start,
memory and latency on the target phone.

---

## What is in this directory

```
popular-app-route/
  index.html              gallery
  app.css, spine.css      page shell + unchanged v6/v7 spine component
  js/app.js               reads v8/<slug>/run.json, renders cards
  js/data.js              five popular books + two generative cases
  js/spine-renderer.js    v6/v7 measured renderer (copied, unmodified)
  fonts/                  the four OFL fonts used by the renderer
  v8/<slug>/              v8-app output: source, mask, crop, spine, fallback, QA
  pack/                   four curated 2× spine thumbs, shown only as an optional bonus
  tests/audit.cjs         390/320 overflow, images, fit, console audit
  tests/results.json      audit output
  screenshots/            390/320 captures
  tools/run-v8.sh         regenerates v8/<slug>/ from the cover sources
  README.md               this file
```

`v8/<slug>/` contains the honest intermediates, not just finished spines:
`source.jpg`, `mask-preview.jpg`, `crop-native.jpg`, `art.jpg`, `spine.jpg`,
`spine-2x.jpg`, `fallback-spine.jpg`, `run.json`, `qa.json`. The gallery renders
the **crop-native** file (the actual text-free result) rather than `art.jpg`,
because on crop routes `art.jpg` is the full reconstruction and still carries
type.

---

## Reproduce

Serve the prototype root:

```sh
cd .scratch/spine-cover-art-prototype
python3 -m http.server 4173 --bind 0.0.0.0
# open http://127.0.0.1:4173/spine-cover-art-prototype/popular-app-route/
```

Regenerate the v8 outputs (the same command path used for this gallery):

```sh
cd .scratch/spine-cover-art-prototype
export ORT_DYLIB_PATH=/path/to/libonnxruntime.so
./popular-app-route/tools/run-v8.sh
```

Run the audit:

```sh
cd .scratch/spine-cover-art-prototype
node popular-app-route/tests/audit.cjs
```

Expected tail:

```text
ALL CHECKS PASSED
390: 7 cards, 14 spines, 0 overflow, 0 console errors
320: 7 cards, 14 spines, 0 overflow, 0 console errors
```

### Audit results

| Check | 390 px | 320 px |
|---|---|---|
| Cards | 7 | 7 |
| v6/v7 spines rendered | 14 | 14 |
| Page overflow | 0 | 0 |
| Card overflow | 0 | 0 |
| Broken images | 0 | 0 |
| External requests | 0 | 0 |
| Console / page / request errors | 0 | 0 |
| `data-fit` over budget | 0 | 0 |

Screenshots: `screenshots/route-390-*.png`, `screenshots/route-320-*.png`.

---

## Honest failure modes

1. **A pass is a structural floor, not recognisability.** QA measures residual
   OCR, seam, luma and edges. A clean but bland strip can pass.
2. **Crop choice is valid, not canonical.** The Rust scan can pick a different
   zero-text window than the Python reference; both may pass.
3. **Large integrated type is reconstructed, not recovered.** RPS is the clear
   case: 45 % masked, review verdict, fallback shipped alongside.
4. **Automatic masks cannot tell cover type from in-art lettering.** Signs and
   badges are removed with the title.
5. **LaMa is optional and memory-heavy.** Not bundled; not used here. The flat
   fill is the phone-friendly default.
6. **The pack is still rights-limited.** Four of its six editions are reference
   only; that is one reason it is a bonus, not the route.
7. **Covers remain in copyright** except where noted. They are throwaway design
   references only.

---

## What remains for Tauri integration

1. **Command boundary.** Wrap the existing `v8_app::pipeline` call in a Tauri
   command, with the cover path/bytes, metadata and output directory. Keep the
   current pass/review/fallback record so the UI can show the route.
2. **Models and ORT.** Ship `det.onnx` (2.43 MB), `rec.onnx` (10.69 MB),
   `keys.txt` and the arm64 `libonnxruntime.so` (17.57 MB): about **33 MB** added
   to the APK. Extract once to app-private storage and set `ORT_DYLIB_PATH`.
   Keep LaMa (208 MB) as an opt-in download, not a bundle.
3. **Art handoff.** Persist `spine.jpg`, `spine-2x.jpg`, `fallback-spine.jpg` and
   `crop-native.jpg`, then feed the text-free crop to the existing v6/v7
   renderer. The renderer is already DOM + Canvas only.
4. **Pack as enhancement.** Keep the verified pack loader as an optional fast
   path. The shelf and detail views must render v8-app output when no pack entry
   matches; never make the pack the only path.
5. **Device gate.** Re-test cold start, first-run model extraction, arm64
   latency, peak RSS and media export on the target phone. The APK route is
   device-tested by the user; the remaining work is integration and a repeatable
   device measurement, not a new pipeline.
6. **UI copy.** Surface `pass | review | fallback` and the reason string. A
   fallback must be visible, not hidden behind art that failed QA.

---

## Licence / scope

Prototype code is a throwaway design reference. Covers are in copyright and used
only as local design references; *The Hound of the Baskervilles* is public domain
but is not part of this gallery. PP-OCRv3 models and the dictionary are
Apache-2.0; ONNX Runtime is MIT; the fonts are OFL (see `fonts/`); DejaVu in the
v8 fallback is under the Bitstream Vera licence. No credentials or hosted
services are used.
