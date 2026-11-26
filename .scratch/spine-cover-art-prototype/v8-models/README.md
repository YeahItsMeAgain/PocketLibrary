# v8-models — practical model packaging for the Android APK

This is the model-packaging study for the v8 automatic spine pipeline. It lives
entirely under `.scratch/spine-cover-art-prototype/v8-models/` and does not
modify `v8-app/`, `v8-android/`, shared pages, production code, tests,
manifests or specs. Nothing is committed or released.

**Full report:** [`REPORT.md`](REPORT.md)  
**Manifest:** [`MANIFEST.json`](MANIFEST.json)  
**Final models:** [`dist/`](dist/)

## Verdict

| Package | Contents | Size | Use |
|---|---|---:|---|
| `dist/text-bundled/` | det INT8 + rec FP32 + keys | **11.51 MB** | recommended APK bundle; same route/verdict as FP32 on 5/5 samples |
| `dist/text-detect-only/` | det INT8 only | **0.79 MB** | smallest text gate; requires detector-only QA in the app |
| `dist/text-min/` | det INT8 + rec INT8 + keys | 3.74 MB | evaluated, **not recommended**: rec returns zero text on 52×236 text spines |
| `dist/inpaint-migan/` | MI-GAN pipeline | **28.08 MB** | recommended optional download; ~2 s host inference, no residual text |
| `dist/inpaint-lama-fp32/` | LaMa big-lama FP32 | 208.04 MB | quality reference only; too big/memory-heavy for default |
| `dist/inpaint-lama-int8/` | LaMa Conv-only INT8 | 62.21 MB | evaluated, **not recommended**: visible chroma scars at spine size |

Fallback: the existing flat ring-median fill in `v8-app`, **0 MB**.

Current text models total 13.15 MB. `text-bundled` saves 1.64 MB;
`text-detect-only` saves 12.36 MB if the app can drop the recogniser from the
crop-avoidance path. APK estimates are file-size deltas only — no APK was built.

**No Android device test.** All runtime/memory numbers are host x86-64.

## Key results

Text quality vs FP32 on Hound, RPS, Harry Potter, Hunger Games, Whisper Man:

- det INT8 + rec FP32: routes 5/5, verdicts 5/5, mask IoU 0.856–0.981,
  OCR text similarity 0.84–1.00.
- det INT8 + rec INT8: routes/verdicts still 5/5, but OCR similarity drops to
  0.59–0.96 and **every 52×236 text spine returns zero recognised text**.
- det INT8 is ~2.3× slower than FP32 on this host (detection 2.96 s vs 1.20 s),
  so smaller does not mean faster on CPU.

Inpainting vs LaMa FP32 at the same 52×236 crop:

- MI-GAN: 28.08 MB, 1.9–2.3 s, ~500 MB peak, spine PSNR 20.4–35.9 dB,
  SSIM 0.72–0.96, zero residual OCR on all five art images. Recommended.
- LaMa INT8 Conv-only: 62.21 MB, 18–20 s, 1.38 GB peak, spine PSNR 18.0–19.9 dB,
  SSIM 0.72–0.91, visible chroma scars. Rejected for quality.
- LaMa FP32: 208.04 MB, ~24 s, ~1.1 GB peak. Reference only.

Visual comparisons: `eval/spine-compare.png` and
`eval/spine-compare-migan.png`.

## Layout

```text
v8-models/
├── README.md                 this file
├── REPORT.md                 full method, results, commands, Android estimates
├── MANIFEST.json             sizes, SHA-256, licences, I/O contracts, measurements
├── dist/                     final staged models + LICENSES/
├── models/                   working fp32 / quantised variants
├── calib/                    calibration tensors (det, rec, LaMa)
├── scripts/                  calibration, hoisting, quantisation, eval, manifest
├── eval/                     pipeline runs, 52×236 spines, comparison sheets
├── out/                      quality JSON summaries
└── logs/                     quantisation, timing and peak-RSS logs
```

## Quick start

From the repo root:

```bash
cd .scratch/spine-cover-art-prototype/v8-models

# 1. Python tooling (host)
python3 -m venv /tmp/opencode/venv
/tmp/opencode/venv/bin/pip install -U pip
/tmp/opencode/venv/bin/pip install numpy pillow onnx onnxruntime onnxconverter-common
export ORT_DYLIB_PATH=/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0

# 2. Download the optional models (already staged in dist/ here)
mkdir -p work/models
curl -L --fail -o work/models/lama_fp32.onnx \
  https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
curl -L --fail -o work/models/migan_pipeline_v2.onnx \
  https://huggingface.co/CardAnvilModels/MI-GAN-ONNX/resolve/main/migan_pipeline_v2.onnx
mkdir -p models/migan
cp -n work/models/migan_pipeline_v2.onnx models/migan/migan_pipeline_v2.onnx

# 3. Stage the read-only v8 models and build calibration data
./scripts/prepare_models.sh

# 4. Verify the staged package
/tmp/opencode/venv/bin/python scripts/verify_manifest.py

# 5. Run the bundled text model through the real v8-app pipeline
../v8-app/target/release/v8-app batch --root .. \
  --out eval/verify-text-bundled --models dist/text-bundled
```

All exact reproduction commands, quantisation steps and scoring commands are in
[`REPORT.md` §7](REPORT.md#7-exact-commands).

## App integration in one paragraph

Bundle `dist/text-bundled/` (or `dist/text-detect-only/` if you can use a
detector-only text gate). Offer MI-GAN as an on-demand download: invert the v8
mask (`255 - mask`), letterbox image and mask to 512×512, run the uint8 model,
crop back, verify SHA-256 before loading. Keep flat-fill as the zero-download
fallback. Do not bundle LaMa and do not use LaMa INT8 or rec INT8 on
quality-critical paths. Phone performance is unmeasured; test MI-GAN on a
mid-range device before shipping.
