# v8 models for an Android APK

Status: throwaway packaging study, 2026-11-26. Everything here is under
`.scratch/spine-cover-art-prototype/v8-models/`. It does **not** modify
`v8-app/`, `v8-android/`, shared prototype pages, production app code, tests,
manifests or specs. Nothing was committed or released.

**The short version**

| Need | Ship this | Size | Why |
|---|---|---:|---|
| Text-free crop avoidance, existing `v8-app` OCR contract | `dist/text-bundled/` — det INT8 + rec FP32 + keys | **11.51 MB** | same route/verdict as FP32 on 5/5 samples; rec stays reliable |
| Smallest text gate, if the app accepts detector-only QA | `dist/text-detect-only/` — det INT8 only | **0.79 MB** | detector finds text on all five 52×236 text spines; rec is not needed for a yes/no gate |
| Optional inpainting, download on demand | `dist/inpaint-migan/` — MI-GAN pipeline | **28.08 MB** | ~2 s and ~500 MB peak on host; no residual text on the five samples; no chroma scars |
| Fallback, no download | existing flat ring-median fill in `v8-app` | **0 MB** | already implemented; lower visual quality |
| Do **not** ship as the default | `dist/text-min/` (det+rec INT8) | 3.74 MB | rec INT8 returns **zero** text on every 52×236 text spine tested |
| Do **not** ship for quality | `dist/inpaint-lama-int8/` | 62.21 MB | faster than FP32 LaMa but visible chroma/scar artifacts at spine scale |

No Android device or emulator was available. All runtime and memory numbers
below are **host x86-64 measurements**; phone figures are estimates and are
labelled as such.

---

## 1. What was evaluated

Source models are the existing v8 models:

- PP-OCRv3 DBNet `det.onnx` — 2.43 MB
- PP-OCRv3 recogniser `rec.onnx` — 10.69 MB
- `keys.txt` — 26 KB
- LaMa `big-lama` ONNX port (Carve/LaMa-ONNX) — 208.04 MB

Test set: the five v8 covers already used by `v8-app` —
Hound, RPS, Harry Potter, Hunger Games, Whisper Man. Quality is judged at the
**52×236 spine**, not full-cover fidelity. Covers are in-copyright design
references only.

Methods tried:

| Method | det | rec | LaMa | Result |
|---|---|---|---|---|
| ONNX Runtime dynamic INT8 | yes | yes | yes | sizes ~3× smaller; det/rec text quality degrades; LaMa is slower and has artifacts |
| ONNX Runtime static INT8, QOperator | yes | yes | yes | det/rec static rec output is unusable; LaMa 63.5 MB, artifacts |
| Static INT8, Conv only | yes | yes | yes | det works but mask is under-covered; rec empty; LaMa 62.2 MB, fewer artifacts but still visible |
| FP16 conversion | attempted | attempted | no | det converted; rec failed to load (`Cast` output type mismatch) |
| Pruning | — | — | — | not pursued: no retraining data, and sparse ONNX does not reduce runtime on this CPU path |
| Smaller inpainting model | — | — | **MI-GAN** | 28.08 MB, ~2 s, good spine-scale match to LaMa |

A critical detail: the PP-OCRv3 det/rec files store every conv weight as a
`Constant` node, not as an initializer. ONNX Runtime quantisation silently
leaves them untouched unless the constants are hoisted first. `scripts/hoist_constants.py`
does that; without it the det/rec `INT8` files were **larger** than FP32.

---

## 2. Text models: det + rec

### 2.1 Files and sizes

| Variant | det | rec | keys | Total | SHA-256 (det / rec) |
|---|---:|---:|---:|---:|---|
| FP32 (current) | 2.43 MB | 10.69 MB | 26 KB | 13.15 MB | `3439588c…` / `897a3ede…` |
| **det INT8 + rec FP32** (`text-bundled`) | **0.79 MB** | 10.69 MB | 26 KB | **11.51 MB** | `7c68d75a…` / `897a3ede…` |
| det INT8 + rec INT8 (`text-min`) | 0.79 MB | 2.92 MB | 26 KB | 3.74 MB | `7c68d75a…` / `1b38cd64…` |
| Static det INT8 + rec FP32 | 0.84 MB | 10.69 MB | 26 KB | 11.53 MB | — |

`det INT8` is ONNX Runtime dynamic quantisation with QInt8 weights,
per-channel, `reduce_range=True`. `rec INT8` is the same. Full hashes are in
`MANIFEST.json`.

### 2.2 Accuracy on the five samples

Compared with the FP32 pipeline. “Lines” is detected text boxes after
recognition; “small-spine lines” is OCR on the 52×236 fallback spines upscaled
4× (a direct text-presence test).

| Variant | Route same | Verdict same | Mask IoU vs FP32 | OCR similarity | Lines (FP32 → variant) | Small-spine lines (FP32 → variant) |
|---|---:|---:|---|---|---|---|
| det INT8 + rec FP32 | **5/5** | **5/5** | 0.856–0.981 | 0.84–1.00 | 3→3, 11→11, 12→12, 7→5, 13→13 | 5→4, 4→3, 5→4, 3→3, 3→3 |
| det INT8 + rec INT8 | 5/5 | 5/5 | 0.856–0.981 | 0.59–0.96 | 3→3, 11→9, 12→4, 7→5, 13→11 | **5→0, 4→0, 5→0, 3→0, 3→0** |
| det INT8 dynamic (no reduce_range) | 5/5 | 4/5 | 0.796–1.000 | 0.56–0.99 | 12→4 on HP | — |
| det static INT8 + rec FP32 | 5/5 | 4/5 | **0.497 on RPS** | 0.84–1.00 | 11→14 on RPS | 5→3, 4→3, 5→4, 3→3, 3→3 |

Detector-only check: the INT8 detector finds **3–6 text boxes** on every
52×236 fallback spine (FP32 finds 3–5). That is why a detector-only text gate
is viable if the app can drop the recogniser from the crop-avoidance path.
Recognition INT8 is not viable for that gate: it returns no text at all on the
same spines.

The detector’s mask coverage is close to FP32 for the recommended variant
(RPS 44.1% → 45.9%; HP 37.4% → 37.3%; Hunger 27.5% → 25.5%). The static
detector under-covers RPS badly (44.1% → 22.7%) and is not recommended.

### 2.3 Runtime and memory (host)

3 batch runs; stage medians from `run.json`. Host: x86-64, 6 threads, ONNX
Runtime 1.32 CPU.

| Variant | Batch wall | Detection median | Pipeline peak RSS |
|---|---:|---:|---:|
| FP32 det + rec | 15.3–16.2 s | **1.20 s** | 509 MB |
| det INT8 + rec FP32 | 26.7–27.9 s | **2.96 s** | 573 MB |
| det INT8 + rec INT8 | 28.6–30.2 s | 2.81 s | 568 MB |
| det static INT8 + rec FP32 | 15.4–16.3 s | 1.32 s | 516 MB |

The INT8 detector is **~2.3× slower on this host** than FP32, not faster. The
size saving is real, but do not assume INT8 means speed on CPU. A mobile
delegate (XNNPACK/NNAPI) was not tested and may change this.

### 2.4 Recommendation

- **Default bundle: `text-bundled` (11.51 MB).** Saves 1.64 MB vs the current
  13.15 MB, keeps rec FP32 for reliable QA, and matches FP32 routes/verdicts
  on all five samples. This is the only text set that works with the current
  `v8-app` Ocr contract without logic changes.
- **Smallest bundle: `text-detect-only` (0.79 MB).** Use the detector only to
  answer “is there text in this candidate crop?”. Tested on five text spines.
  This needs an app change: do not require `rec.onnx`/`keys.txt` for the
  crop-avoidance path. It is the best size/quality trade if that change is
  acceptable.
- **Do not use `text-min` as the only residual-text gate.** It looks fine on
  aggregate route/verdict because the detector carries the pipeline, but rec
  INT8 false-negatives every small text spine. If size forces it, keep rec
  FP32 or add a detector-only gate.

---

## 3. Inpainting

### 3.1 LaMa variants

All LaMa runs used the real `v8-app` fill path (`flat-ring fill` then LaMa) on
the same source, mask and 720 px working image. Quality was scored at the same
52×236 crop box chosen from the FP32 result, so the comparison is like-for-like.

| Model | Size | LaMa time (changed books) | Peak RSS | Spine PSNR vs FP32 | Spine SSIM vs FP32 | Verdict |
|---|---:|---:|---:|---|---|---|
| LaMa FP32 | 208.04 MB | 24.0–24.5 s | 1.1 GB | reference | reference | quality reference only |
| LaMa INT8 dynamic | 61.95 MB | 30.5–32.7 s | 1.2 GB | 9.4 / 14.3 / 9.9 dB | 0.46 / 0.83 / 0.83 | reject: slower and strong seam/color error |
| LaMa INT8 static, all ops | 63.50 MB | 17.0–17.9 s | 1.0 GB | 15.7 / 18.1 / 17.1 dB | 0.63 / 0.82 / 0.82 | reject: visible artifacts |
| **LaMa INT8 static, Conv only** | **62.21 MB** | **18.0–20.1 s** | 1.38 GB | 18.0 / 19.9 / 19.7 dB | 0.72 / 0.91 / 0.90 | reject: best INT8, still visible chroma scars |
| MI-GAN pipeline | **28.08 MB** | **1.9–2.3 s** | **~500 MB** | 20.4 / 22.8 / 32.4 dB | 0.72 / 0.87 / 0.96 | **recommended optional** |
| Flat-fill fallback | 0 MB | ~0.1 s | baseline | 13.2 / 9.6 / 11.2 dB | 0.27 / 0.08 / 0.23 | fallback only |

Values “9.4 / 14.3 / 9.9” are RPS / Harry Potter / Hunger Games; Hound and
Whisper Man were unchanged by LaMa (their crop landed outside the filled
region or flat-fill already covered it), so they are excluded from the range.

Visual evidence:

- `eval/spine-compare.png` — FP32 | dynamic INT8 | static INT8 | Conv-only INT8
- `eval/spine-compare-migan.png` — LaMa FP32 | MI-GAN | LaMa INT8 Conv-only
- `eval/spine-compare-<book>.png` — per-book 4× spines

The INT8 LaMa columns show green/orange chroma patches in large masked areas
(RPS, Harry Potter, Hunger Games). They would read as damage on a book spine.
Dynamic INT8 also has a much worse seam delta-E in the pipeline QA (94.2 vs
34.8 for FP32; Conv-only static is 39.9). Recognition and QA do not fix this:
the artifact is visual, not text.

### 3.2 MI-GAN: the practical optional model

Model: `migan_pipeline_v2.onnx`, 28.08 MB, MIT, from
<https://huggingface.co/CardAnvilModels/MI-GAN-ONNX> (mirror of
`andraniksargsyan/migan`). It is the MI-GAN mobile inpainting model
(Picsart AI Research, ICCV 2023).

Contract:

- Inputs are **uint8 NCHW**: `image` `[N,3,H,W]`, `mask` `[N,1,H,W]`.
- Mask convention in this pipeline is **255 = keep/known, 0 = hole**. The
  `v8-app` mask is the opposite (255 = text), so invert it before use.
- Output `result` is uint8 `[N,3,H,W]`, 0..255.
- Tested with both image and inverted mask letterboxed into 512×512, then
  cropped back. Dimensions are dynamic in the graph, but pin 512×512 for the
  app.
- No residual OCR on any of the five inpainted `art.jpg` images or 52×236
  spines when checked with FP32 det+rec.

Host cost: inference 1.86–2.33 s, wall 2.4 s, peak RSS ~500 MB for the Python
process including ONNX Runtime. On the same samples, LaMa FP32 took ~24 s and
~1.1 GB.

Quality against LaMa FP32 at the same 52×236 crop: PSNR 20.4–35.9 dB, SSIM
0.72–0.96. It is noticeably softer/different in hair and face detail on Harry
Potter, but it has no colored scars and is dramatically cheaper. At spine size
it reads as a plausible continuation; see the comparison sheet.

### 3.3 Recommendation

- **Optional download: MI-GAN 28.08 MB.** This is the model to offer for
  “remove text properly”. It is small enough for an on-demand download, fast
  enough that the user does not wait half a minute, and does not show the INT8
  LaMa artifacts.
- **Do not download LaMa INT8 (62.2 MB).** It is only 1.3× faster than FP32
  LaMa and visibly worse; the size saving is not worth it.
- **Keep LaMa FP32 as a reference / power-user option only.** 208 MB is too
  large for a default download and ~1.1 GB host peak is a memory risk on
  mid-range phones.
- **Always keep the flat-fill fallback.** It needs no model, completes in
  ~0.1 s, and is what the app should use if the user declines the download or
  storage is low.

---

## 4. Packaging strategy

### 4.1 APK contents

```text
APK bundled (recommended)
  dist/text-bundled/det.onnx      0.79 MB   det INT8 dynamic reduce_range
  dist/text-bundled/rec.onnx     10.69 MB   rec FP32 (unchanged)
  dist/text-bundled/keys.txt      0.026 MB
  ------------------------------------------------
  total                          11.51 MB   (was 13.15 MB; -1.64 MB)

APK bundled (smallest, needs detector-only QA)
  dist/text-detect-only/det.onnx  0.79 MB   (was 13.15 MB; -12.36 MB)
```

On-demand, outside the APK:

```text
dist/inpaint-migan/migan_pipeline_v2.onnx   28.08 MB   recommended
dist/inpaint-lama-fp32/lama_fp32.onnx      208.04 MB   reference only
dist/inpaint-lama-int8/lama.onnx            62.21 MB   evaluated, not recommended
```

Estimated APK size change (file-size delta only; ONNX files compress poorly
and the ORT `.so` is unchanged): current ~36 MB → ~34.4 MB with
`text-bundled`, or ~23.6 MB with `text-detect-only`. Do not treat these as
measured APK sizes.

### 4.2 App decision flow

1. On first cover: run det (+ rec if bundled) and the crop scan.
2. If a zero-text crop passes QA, use it. No inpainting model needed.
3. Otherwise:
   - If MI-GAN is downloaded and verified, run MI-GAN on the text mask.
   - If not downloaded, use flat-fill and mark the result `review`/`fallback`
     exactly as today.
4. Offer MI-GAN as an explicit “download better text removal (28 MB)” action.
   Gate on Wi-Fi and free space; it is not required for the app to work.
5. Never bundle LaMa. If a user already has it, treat it as an advanced option.

### 4.3 MI-GAN integration notes

- Invert the v8 mask: `migan_mask = 255 - text_mask`.
- Letterbox to 512×512 with black padding, as `fill.rs` does for LaMa; run;
  crop back; resize to the working image.
- Apply MI-GAN only to the remaining mask after flat-fill, if you want to
  preserve the existing flat-fill behavior and reduce work.
- The model takes uint8, so no float normalisation is needed at the session
  boundary. This also avoids Android float16 support questions.
- Pin the SHA-256 and reject a partial/corrupt download before loading.

---

## 5. Manifest and download verification

`MANIFEST.json` lists every model with bytes, SHA-256, licence, source,
quantisation method, input/output contract and measured results. Licences are
also in `dist/LICENSES/` (Apache-2.0, MIT-MI-GAN).

Pinned hashes (full values in the manifest):

| File | Bytes | SHA-256 prefix |
|---|---:|---|
| det INT8 dynamic-range | 792,710 | `7c68d75a…` |
| rec FP32 | 10,690,752 | `897a3ede…` |
| rec INT8 dynamic-range | 2,918,270 | `1b38cd64…` |
| MI-GAN pipeline | 28,079,181 | `6f1f3530…` |
| LaMa INT8 Conv-only | 62,206,161 | `5d81c5c9…` |
| LaMa FP32 | 208,044,816 | `1faef530…` |

Verification strategy for the app:

1. Bundle det/rec/keys in the APK; the APK signature is the trust anchor. The
   hashes are still useful for an integrity self-check and for CI.
2. For MI-GAN, download over HTTPS to
   `<filesDir>/models/download/migan.part`. Stream SHA-256 while writing; stop
   and delete on mismatch. `fsync`, then atomically rename to
   `<filesDir>/models/inpaint-migan/migan_pipeline_v2.onnx`.
3. Verify size and SHA-256 again on first load. Keep the previous known-good
   file until the new one verifies. Store a model version in the DB.
4. If the download is absent, corrupt or below the free-space threshold, fall
   back to flat-fill. Never block the spine on a model download.
5. `scripts/verify_manifest.py` is a reference implementation of the check.

---

## 6. Host vs Android

Host measurements are real; phone measurements are not. No emulator, system
image, `adb` device or APK build was available. The `v8-android/` tree was not
modified.

| Item | Host measurement | Android estimate / caution |
|---|---|---|
| Text pipeline peak RSS (FP32) | ~509 MB | native ORT + app may be in the same order; not measured |
| Text pipeline peak RSS (det INT8) | ~573 MB | INT8 is not automatically lighter at runtime |
| MI-GAN peak RSS | ~500 MB (Python + ORT) | native should be lower, but budget ≥512 MB and test on a 4 GB device |
| LaMa FP32 peak RSS | ~1.1 GB | likely too high for low-RAM phones; existing v8-app README already flags ~1.0 GB |
| MI-GAN inference | 1.9–2.3 s | mid-range phone may be several× slower; MI-GAN is designed for mobile but this study did not test it |
| LaMa FP32 inference | ~24 s | not phone-friendly |
| APK delta | file sizes only | ONNX does not compress much; measure the real APK before release |

**No phone performance is claimed.** The only safe statement is: MI-GAN is the
only inpainting option with a plausible mobile size/time budget; it must be
device-tested before shipping.

---

## 7. Exact commands

All commands from the repo root.

### 7.1 Environment

```bash
python3 -m venv /tmp/opencode/venv
/tmp/opencode/venv/bin/pip install -U pip
/tmp/opencode/venv/bin/pip install numpy pillow onnx onnxruntime onnxconverter-common
export ORT_DYLIB_PATH=/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0
```

### 7.2 Download optional models, then stage source models and calibration data

Download the optional models first (they are staged in `dist/` in this study):

```bash
mkdir -p work/models
curl -L --fail -o work/models/lama_fp32.onnx \
  https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
curl -L --fail -o work/models/migan_pipeline_v2.onnx \
  https://huggingface.co/CardAnvilModels/MI-GAN-ONNX/resolve/main/migan_pipeline_v2.onnx
sha256sum work/models/lama_fp32.onnx work/models/migan_pipeline_v2.onnx
```

Then stage the read-only v8 models and calibration data:

```bash
cd .scratch/spine-cover-art-prototype/v8-models
./scripts/prepare_models.sh
mkdir -p models/migan
cp -n work/models/migan_pipeline_v2.onnx models/migan/migan_pipeline_v2.onnx
```

`prepare_models.sh` copies `work/models/lama_fp32.onnx` into `models/fp32/`
when needed, and copies det/rec/keys from `v8-app/models/`.

### 7.3 Quantise

```bash
# det/rec constants must be hoisted before quantisation
/tmp/opencode/venv/bin/python scripts/hoist_constants.py \
  models/fp32/det.onnx models/fp32-folded/det.onnx
/tmp/opencode/venv/bin/python scripts/hoist_constants.py \
  models/fp32/rec.onnx models/fp32-folded/rec.onnx

/tmp/opencode/venv/bin/python scripts/quantize.py det dynamic-range
/tmp/opencode/venv/bin/python scripts/quantize.py rec dynamic-range
/tmp/opencode/venv/bin/python scripts/quantize.py lama dynamic
/tmp/opencode/venv/bin/python scripts/quantize.py lama static-conv
```

`static` and `static-qdq` modes are also available for the full-static
variants used in the rejection table.

### 7.4 Run the text models on the five samples

```bash
../v8-app/target/release/v8-app batch --root .. \
  --out eval/out-fp32 --models models/text-fp32
../v8-app/target/release/v8-app batch --root .. \
  --out eval/out-int8-range --models models/text-int8-range
../v8-app/target/release/v8-app batch --root .. \
  --out eval/verify-text-bundled --models dist/text-bundled
```

### 7.5 Score text quality

```bash
/tmp/opencode/venv/bin/python scripts/analyze_text_quality.py
```

### 7.6 Evaluate LaMa / MI-GAN at 52×236

```bash
# real v8 fill path, FP32 vs INT8, same source/mask/crop
/tmp/opencode/venv/bin/python scripts/run_lama_eval.py

# MI-GAN on the same masks; invert 255=text to 255=keep internally
/tmp/opencode/venv/bin/python scripts/migan_eval.py \
  --source ../v8-app/out/rps/source.jpg \
  --mask ../v8-app/out/rps/mask.png \
  --out eval/migan/rps --crop-box 285,0,159,720

/tmp/opencode/venv/bin/python scripts/score_images.py
/tmp/opencode/venv/bin/python scripts/make_compare_sheet.py
/tmp/opencode/venv/bin/python scripts/make_migan_sheet.py
```

### 7.7 Verify the manifest / staged files

```bash
/tmp/opencode/venv/bin/python scripts/build_manifest.py
/tmp/opencode/venv/bin/python scripts/verify_manifest.py
```

### 7.8 Small-spine OCR/detector checks

```bash
# detector-only (0.79 MB gate)
./target/release/det_eval --det dist/text-detect-only/det.onnx \
  --image eval/out-fp32/rps/fallback-spine.jpg --scale 4

# rec INT8 false-negative demonstration
./target/release/ocr_eval --det models/det-int8-dynamic-range/det.onnx \
  --rec models/rec-int8-dynamic-range/rec.onnx --keys models/fp32/keys.txt \
  --image eval/out-fp32/rps/fallback-spine.jpg
```

---

## 8. Artifacts

- `dist/` — final staged models and licences.
- `MANIFEST.json` — sizes, SHA-256, licences, contracts, measured results.
- `eval/out-*` — v8 pipeline runs for FP32 / INT8 variants.
- `eval/lama-*` — inpainted art and 52×236 spines for LaMa variants.
- `eval/migan/` — MI-GAN art and spines.
- `eval/spine-compare*.png` — visual comparisons.
- `out/text-quality.json`, `out/lama-quality.json`, `out/migan-quality.json`.
- `logs/` — quantisation, batch, timing and peak-RSS logs.
- `calib/` — deterministic calibration tensors.
- `scripts/` — calibration, hoisting, quantisation, evaluation, manifest and
  verification scripts.

---

## 9. Limitations and rejected paths

- **Five samples only.** These are design references, not a coverage
  benchmark. A larger cover set could change the det/rec recall numbers.
- **No device test.** No Android emulator, system image or `adb` device was
  available. All phone statements are estimates.
- **Static rec INT8 is broken for this use.** It loads and runs, but returns
  empty/garbled text on the v8 spines. Do not ship it.
- **FP16 rec failed to load** in the current `v8-app` contract (`Cast` output
  type mismatch after conversion). FP16 det converted but was not pursued.
- **LaMa INT8 is not a free size win.** All variants show colored artifacts in
  large holes. Conv-only static is the best INT8 variant and is still visibly
  worse at 52×236.
- **Pruning was not attempted.** Without retraining, magnitude pruning is
  unlikely to preserve the FFC inpainting quality, and sparse ONNX does not
  accelerate the CPU path used here.
- **MI-GAN was evaluated as a model substitution, not wired into `v8-app`.**
  The app integration is documented above; the code was deliberately not
  changed.
- **Do not redistribute the sample covers.** They are in-copyright edition
  scans used only as throwaway design references.

---

## 10. Bottom line

Bundle **det INT8 + rec FP32 (11.51 MB)** for a drop-in replacement that keeps
the current QA honest. If the crop path can use a detector-only gate, bundle
**det INT8 (0.79 MB)** instead. Offer **MI-GAN (28.08 MB)** as the optional
inpainting download and keep **flat-fill** as the zero-download fallback. Do not
bundle LaMa, and do not use LaMa INT8 or rec INT8 for quality-critical paths.
