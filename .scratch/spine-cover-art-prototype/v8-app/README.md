# v8 app — automatic generative spine (Rust / ONNX Runtime)

**Status:** throwaway proof of concept. Everything lives under
`.scratch/spine-cover-art-prototype/v8-app/`. No production app code, tests,
manifests or specs were modified. Nothing was committed or released. The shared
`study-nav.js`, `review/index.html`, `reproducibility/index.html`,
`reproducibility/results.json` and the root README were **not** edited; a
wiring note for the audit agent is in `docs/INTEGRATION.md`.

**Gallery:** <http://127.0.0.1:4173/spine-cover-art-prototype/v8-app/>  
(or `/spine-cover-art-prototype/v8-app/` on whatever host serves `.scratch`)

**Finding in one line:** the whole v8 route now runs as a Rust binary with
PP-OCRv3 DBNet + recogniser through ONNX Runtime, automatic Lab/line masking,
flat fill, an optional LaMa ONNX pass, a spine-aspect crop scan and 52 × 236 QA.
On the five v8 covers the Rust route matches the Python verdicts exactly:
**4 pass, 1 review, 0 fallback, 0 hand masks, 0 API keys**. Four covers skip
LaMa entirely because a text-free crop passes; the phone path measured
**2.4–13.8 s per cover on this shared host (typically 3–6 s) at ~450–500 MB peak
RSS**. LaMa is optional, downloadable and memory-heavy (~1.0 GB peak on this
host).

---

## Results (app mode: det limit 960, work side 720)

| Book | Route | Verdict | Mask | Boxes | Runtime | Peak RSS* | Python v8 | Spine vs Python |
|---|---|---|---:|---:|---:|---:|---|---|
| *The Hound of the Baskervilles* | text-free crop | **pass** | 7.87 % | 3 | 4.5 s (4.5–11.7) | ~500 MB | pass / crop | MAE 41.1, corr 0.95 |
| *Rock Paper Scissors* | inpaint + LaMa | **review** | 44.1 % | 22 | 31.7 s (31.7–57.4; LaMa 26.6–44.2) | ~1.0 GB | review / inpaint | MAE 10.8, corr 1.00 |
| *Harry Potter and the Philosopher's Stone* | text-free crop | **pass** | 37.4 % | 13 | 3.7 s (3.7–7.2) | ~500 MB | pass / crop | MAE 45.8, corr 0.94 |
| *The Hunger Games* | text-free crop | **pass** | 27.5 % | 6 | 2.6 s (2.4–6.1) | ~500 MB | pass / crop | MAE 2.8, corr 1.00 |
| *The Whisper Man* | text-free crop | **pass** | 15.9 % | 17 | 5.6 s (4.5–13.8) | ~500 MB | pass / crop | MAE 28.4, corr 0.76 |

\* Peak child RSS measured with `getrusage(RUSAGE_CHILDREN)` on the x86-64 host,
after disabling the ONNX Runtime CPU arena. Runtimes are single runs on a shared
host and vary substantially with load; the parenthesised range is across repeated
runs. Without LaMa, RPS completes in **5.3 s at ~453 MB** using the local
inpainting substitute.

**Why the MAE varies on crop routes:** both implementations choose a *different
valid zero-text window* on the same cover (e.g. Hound: Python takes the left
snow slope, Rust takes the right tree). The content correlation is 0.76–1.00;
on the two routes where both pick the same window (Hunger Games and the RPS
inpaint) MAE is 2.8 / 10.8. This is a crop-selection difference, not a text
residue difference: spine OCR is 0 on all five in both implementations.

---

## The ten v8 options, as implemented in the app

| # | Option | App implementation | APK-capable? |
|---|---|---|---|
| 1 | PP-OCRv3 DBNet detection | `src/detect.rs`, `det.onnx` (2.4 MB) via ONNX Runtime; PaddleOCR resize/normalise, threshold 0.18, box 0.28, unclip 1.9, 2×2 dilation | **Yes** |
| 2 | per-box CIELAB colour segmentation | `mask::seg_box`; sRGB→Lab (OpenCV-compatible scaling), border background, 72nd-percentile text colour, ΔE < 58 | **Yes** |
| 3 | line colour completion | `mask::line_colour_mask`; groups horizontal boxes (gap ≤ 3× line height), circular hue histogram, hue ±30°, S > 50 | **Yes** (extended gap + circular hue makes missing DBNet glyphs recoverable) |
| 4 | proportional dilation | `mask::build_mask`; median line height × 0.22, odd kernel, close then dilate | **Yes** (rectangular-separable morphology; documented approximation) |
| 5 | flat-ring median fill | `fill::flat_fill`; 9×9 ring, L/chroma σ < 8, median Lab fill | **Yes** |
| 6 | LaMa big-lama inpainting | optional `lama_fp32.onnx` (208 MB) via ONNX Runtime, 512×512 letterboxed; `fill::Lama` | **Yes, optional download.** No model → deterministic ring-median + masked smoothing substitute (`fill::substitute_inpaint`). Phone memory ~1.0 GB with LaMa, ~450 MB without. |
| 7 | spine-aspect crop scan + residual OCR | `crop::find_crops` (14 heights × 26 × 26 integral-image scan) + `crop::pick_text_free_crop` (OCR up to 5 candidates) | **Yes** |
| 8 | QA at 52 × 236 | `qa::qa_report`; residual OCR on art/crop/4× spine, mask coverage, seam ratio, ring ΔE, luma σ, edge density, palette correlation | **Yes** |
| 9 | pass / review / fallback | `qa::decide`; same thresholds as Python (coverage 40/55 %, seam 3×, ΔE 55, luma σ 10/16, edge 0.006/0.012) | **Yes** |
| 10 | text-free crop avoidance | crop search runs **before** inpainting; if a zero-coverage crop passes QA, LaMa is skipped. 4/5 covers use this path. | **Yes** (this is the phone-friendly default) |

Automatic fallback output: `fallback::fallback_spine` renders a 52 × 236
type-on-cloth spine with embedded DejaVu Serif. Every run writes it, so a failed
reconstruction always has a defined result. The gallery shows it beside every
result.

---

## Inference stack evaluation (actually executed)

| Stack | Det | Rec | LaMa | Result | Decision |
|---|---|---|---|---|---|
| **`ort` + ONNX Runtime 1.32 CPU** | loads/runs | loads/runs | loads/runs | Host: det ~0.7–1.9 s, rec tens of ms per crop, LaMa 26.6 s / 512² | **Chosen.** Only stack that runs all three with acceptable speed. Android uses the same `libonnxruntime.so` (17.6 MB arm64) via `load-dynamic`. |
| **`tract-onnx` 0.23 (pure Rust)** | loads/runs 6.4 ms @ 64² | loads/runs 176 ms @ 48×320 | loads/runs **40.9 s** @ 512² | Probe crate `/tmp/opencode/tractprobe`; all three models load, including LaMa's FFC/Einsum ops. | **Viable alternative.** No `.so`, trivial Android cross-compile, but LaMa is 3.5× slower (and ~687 MB peak vs ~1.0 GB). Not the default; documented as a fallback if shipping ORT is unacceptable. |
| **TFLite / NNAPI** | not converted | not converted | n/a | No TFLite models exist for this pipeline; no Android device/emulator available to exercise NNAPI. | **Not tested.** `ort` can be built with its `nnapi` feature on Android; the CPU EP was used for all measurements here. |
| OpenCV DNN / EAST / CRAFT | — | — | — | EAST needs another 90 MB; CRAFT/Torch hit illegal-instruction on this CPU in the Python research. | Rejected (see `../v8-auto/RESEARCH.md`). |

`ort` is used with `load-dynamic`, so the Rust binary contains **no** ONNX
Runtime link dependency. On Android, place the AAR's
`jni/arm64-v8a/libonnxruntime.so` in `jniLibs/arm64-v8a/` (or the Tauri
equivalent) and set `ORT_DYLIB_PATH` / the dynamic search path. The Android
binary was cross-compiled and `readelf` shows only `libdl`, `libm`, `libc` as
`NEEDED`.

### Android cross-compile (executed)

```bash
export NDK=$HOME/Android/Sdk/ndk/28.2.13676358
export TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$TC/aarch64-linux-android24-clang
export CC_aarch64_linux_android=$TC/aarch64-linux-android24-clang
export AR_aarch64_linux_android=$TC/llvm-ar
cargo build --release --target aarch64-linux-android --bin v8-app
```

Result: `target/aarch64-linux-android/release/v8-app`, ELF 64-bit aarch64 PIE,
interpreter `/system/bin/linker64`, **2.37 MB**, for Android 24 (8.0+).

### What was **not** executed

- **No Android emulator or device run.** The SDK has no `emulator` package, no
  system images, and `adb devices` is empty. The APK route is proven by
  cross-compilation and by the host binary, not by on-device inference.
- No NNAPI / GPU delegate run.
- No full Tauri APK build was produced. Sizes below are the delta a Tauri build
  would add, not a built APK measurement.

---

## Sizes, storage and memory

| Item | Size | Bundled? | Licence |
|---|---:|---|---|
| Rust Android binary (includes fonts) | **2.37 MB** | yes | Apache-2.0 (this prototype) |
| `models/det.onnx` (PP-OCRv3 DBNet) | **2.43 MB** | yes | Apache-2.0 |
| `models/rec.onnx` (PP-OCRv3 recogniser) | **10.69 MB** | yes | Apache-2.0 |
| `models/keys.txt` | 26 KB | yes | Apache-2.0 (model dictionary) |
| `libonnxruntime.so` arm64 (from ORT 1.20.0 AAR) | **17.57 MB** | yes | MIT |
| DejaVu Serif / Bold (embedded in binary) | ~0.74 MB | yes | Bitstream Vera |
| **Subtotal added to the APK** | **~33.1 MB** | | |
| `lama_fp32.onnx` (LaMa) | **208.0 MB** | **no — optional download** | Apache-2.0 |

Current APK is ~36 MB; this route would take it to roughly **~69 MB** with the
two OCR models and ORT, or **~277 MB** if LaMa were bundled (hence: do not
bundle LaMa).

**LaMa download flow (optional):**

```bash
cd .scratch/spine-cover-art-prototype/v8-app
./scripts/fetch_lama.sh models/lama_fp32.onnx
# then: v8-app run ... --lama models/lama_fp32.onnx
```

Expected SHA-256:
`1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`.
Store it in app-private storage. It stays on disk; it is loaded once per run.
Latency on this x86-64 CPU: **26.6 s** at 512², peak RSS ~1.0 GB. It does not
fit a low-memory phone profile; the app should treat it as an opt-in “high
quality inpaint” download for devices with headroom.

**Measured peak RSS (host, arena disabled):**

| Route | Peak RSS |
|---|---:|
| Crop pass, no LaMa (Hound, HP, Hunger, Whisper) | ~450–500 MB |
| RPS inpaint, local substitute | ~453 MB |
| RPS inpaint, LaMa downloaded | ~1.0 GB |

**Phone feasibility:** the **crop-first route is unattended and practical** on
a modern 4 GB+ Android phone: 2.4–13.8 s on this shared host (typically 3–6 s),
~0.5 GB peak, no network, no key.
The **LaMa route is optional** and should be gated on memory. If the phone is
tight, omit `--lama`; RPS still completes in ~5.3 s with the local substitute and
the same **review** verdict. For 2 GB devices, the detector is the peak; a
smaller detector or tiled detection is the next optimisation, not a re-design.

---

## Exact commands

### Host (x86-64) with the Python environment's ONNX Runtime

```bash
cd .scratch/spine-cover-art-prototype/v8-app

# Point load-dynamic ort at any libonnxruntime.so (the Python venv one works)
export ORT_DYLIB_PATH=/tmp/opencode/ortlib/libonnxruntime.so

cargo build --release

# One cover
./target/release/v8-app run \
  --cover ../reproducibility/book/cover.jpg \
  --slug hound \
  --title "The Hound of the Baskervilles" \
  --author "Arthur Conan Doyle" --pages 170 \
  --out out --models models \
  --python-assets ../v8-auto/assets

# All five v8 covers (LaMa optional; crop routes skip it automatically)
./target/release/v8-app batch \
  --root .. --out out --models models \
  --lama /tmp/opencode/lama_fp32.onnx \
  --python-assets ../v8-auto/assets

# Rebuild the gallery
./target/release/v8-app report --out out --python-assets ../v8-auto/assets
```

Both `run` and `batch` default to `--det-limit 960 --max-side 720` (app mode).
Use `--det-limit 1600` for the exact Python-fidelity detector scale; the final
gallery uses 960.

Serve the gallery from the existing static host:

```bash
cd /mnt/ssd2/Projects/PocketLibrary
python3 -m http.server 4173 --bind 0.0.0.0 --directory .scratch
# open http://127.0.0.1:4173/spine-cover-art-prototype/v8-app/
```

### Tests

```bash
cargo test --release
# 6 unit tests pass (Lab, angle, components, integral, fallback size, crop scan)

ORT_DYLIB_PATH=/tmp/opencode/ortlib/libonnxruntime.so \
  cargo test --release -- --ignored pipeline_end_to_end
# end-to-end Hound: route text-free crop, verdict pass, 1 test passes
```

### Android

See the cross-compile block above. Copy
`/tmp/opencode/ortaar/jni/arm64-v8a/libonnxruntime.so` into the Tauri
`src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/` directory of a real app
build. Do not copy it into this scratch tree.

---

## Module map

```
v8-app/
  Cargo.toml
  src/
    lib.rs
    main.rs            CLI: run / batch / report
    detect.rs          PP-OCRv3 DBNet: resize, normalise, threshold, unclip
    mask.rs            per-box Lab segmentation + line hue completion + dilation
    fill.rs            flat-ring median fill, optional LaMa, local substitute
    crop.rs            spine-aspect integral-image scan + text-free picker
    qa.rs              residual OCR, seam/ΔE/structure, pass|review|fallback
    fallback.rs        type-on-cloth spine + contact sheet
    pipeline.rs        orchestration, JSON records, gallery builder
    ops.rs             Lab/HSV, resize, morphology, components, integral, edges
    ort_env.rs         one process-global ONNX Runtime environment
  models/              det.onnx, rec.onnx, keys.txt (+ llama download target)
  assets/fonts/        DejaVu Serif + licence
  tests/pipeline.rs    host tests
  out/<slug>/          source, mask, art, crop, spine, fallback, compare, QA
  screenshots/         Chromium captures (1200 / 390 / 320)
  index.html           self-contained gallery
  scripts/fetch_lama.sh
  docs/INTEGRATION.md  shared-page wiring note for the audit agent
  results.json         machine-readable summary
```

Per-book outputs: `source.jpg`, `mask.png`, `mask-work.png`, `mask-preview.jpg`,
`mask-work-preview.jpg`, `flat-mask.png` (when a fill ran), `art.jpg`,
`crop-native.jpg`, `spine.jpg` (52 × 236), `spine-2x.jpg`, `fallback-spine.jpg`,
`text-free-crop.jpg` (when a crop was found), `compare.jpg`, `run.json`,
`qa.json`.

---

## Comparison with the Python v8 run

Same verdicts and routes on all five covers. Mask coverage is within ~0–4
points (RPS 44.1 vs 40.1, HP 37.4 vs 37.4, Hound 7.9 vs 7.7). Spine OCR is 0 in
both. The Rust crop search can pick a different valid zero-text window, which
is why MAE is high on some crop routes even though the correlation is high.
The Rust implementation deliberately differs in three documented places:

1. **Axis-aligned detection boxes** instead of OpenCV's `minAreaRect` output.
   OpenCV usually returns near-axis-aligned glyph boxes anyway; forcing it keeps
   line grouping stable when DBNet misses letters. Rotated side-band text is
   still covered because the mask is colour-based.
2. **Gap-tolerant line completion** (3× line height, circular hue peak) so a
   missed glyph *between* detected words is recovered. This is what removed the
   leftover “IC” on RPS in an earlier run.
3. **Crop-before-inpaint**. Python computes art first and then chooses a crop;
   the app route checks the crop first and skips LaMa when it passes. Same
   decision, much lower phone cost.

---

## Failure modes / blockers (honest)

1. **No on-device run.** Cross-compilation proves the code paths compile for
   `aarch64-linux-android`; it does not prove NNAPI kernels, thermal behaviour
   or real Android memory accounting. Add a device run before shipping.
2. **LaMa memory.** 208 MB weights + FFC activations push peak RSS to ~1.0 GB
   on this host. It is optional for a reason. A 256 px export, int8
   quantisation, or a smaller inpainting model is the next step if RPS must be
   reconstructed on a low-memory phone.
3. **Detector recall.** DBNet still misses low-contrast or very small type;
   line colour completion is the backstop. On RPS it needed the extended gap and
   circular hue peak. Residual OCR remains the QA backstop.
4. **Automatic masks cannot tell cover type from in-art lettering.** The
   Hogwarts Express sign and 9¾ platform sign are removed along with the title.
5. **Large integrated type is reconstructed, not recovered.** RPS is 44 % mask;
   LaMa invents plausible snow. At 52 px it reads as a snowy strip with a red
   side band, not as *Rock Paper Scissors*. That is why the verdict is **review**,
   not pass, and why the fallback spine is shipped alongside it.
6. **Crop choice is not recognisability.** QA measures structure, not whether a
   reader can identify the book from the strip. Hound/Harry/Whisper pass on
   structure; a clean but bland strip can still pass. Treat pass as a floor.
7. **No diffusion editor.** FLUX/Qwen-style editing is out of scope and still
   needs credentials/quota; this route is keyless by design.
8. **Morphology and edges are approximations.** Rectangular-separable dilation
   instead of an elliptical kernel, Sobel instead of Canny. The measured QA
   numbers are therefore not bit-identical to Python; verdicts are.
9. **Covers are in copyright** except the Standard Ebooks *Hound* cover. They
   are throwaway design references only.

---

## Licences

- **This prototype:** throwaway design reference, no separate licence.
- **PP-OCRv3 det/rec models and dictionary:** Apache-2.0 (PaddleOCR / Baidu;
  RapidOCR packaging).
- **ONNX Runtime:** MIT.
- **LaMa `big-lama`:** Apache-2.0 (SAIC-MDAL); the ONNX port is from
  `Carve/LaMa-ONNX` (Apache-2.0).
- **DejaVu fonts:** Bitstream Vera licence (see
  `assets/fonts/DejaVu-LICENSE.txt`).
- **Rust crates:** `image`, `ort`, `fontdue`, `serde`, etc. under their own
  licences; `cargo deny`/`cargo about` was not run in this prototype.
- **Covers:** Hound is public domain (Standard Ebooks). RPS, Harry Potter,
  Hunger Games and The Whisper Man are in-copyright edition scans used only as
  throwaway design references.

No credentials, API keys, hosted Spaces or hand-drawn masks are used.
