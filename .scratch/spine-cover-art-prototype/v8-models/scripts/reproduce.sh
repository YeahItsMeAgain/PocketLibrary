#!/usr/bin/env bash
# Full reproduction of the v8-models study. Long: LaMa static quantisation is
# the slow step (~7 min on the study host). Assumes the v8-app release binary
# already exists at ../v8-app/target/release/v8-app.
set -euo pipefail
cd "$(dirname "$0")/.."

VENV="${VENV:-/tmp/opencode/venv}"
ORTPY="${ORTPY:-$VENV/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0}"
export ORT_DYLIB_PATH="$ORTPY"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -U pip
  "$VENV/bin/pip" install numpy pillow onnx onnxruntime onnxconverter-common
fi
PY="$VENV/bin/python"

# Optional downloads (needed before prepare_models.sh).
mkdir -p work/models models/migan
[[ -f work/models/lama_fp32.onnx ]] || curl -L --fail \
  -o work/models/lama_fp32.onnx \
  https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx
[[ -f work/models/migan_pipeline_v2.onnx ]] || curl -L --fail \
  -o work/models/migan_pipeline_v2.onnx \
  https://huggingface.co/CardAnvilModels/MI-GAN-ONNX/resolve/main/migan_pipeline_v2.onnx
cp -n work/models/migan_pipeline_v2.onnx models/migan/migan_pipeline_v2.onnx

# Stage read-only source models + calibration tensors.
./scripts/prepare_models.sh

# PP-OCR constants -> initializers, then quantise.
for m in det rec; do
  "$PY" scripts/hoist_constants.py "models/fp32/$m.onnx" "models/fp32-folded/$m.onnx"
done
"$PY" scripts/quantize.py det dynamic-range
"$PY" scripts/quantize.py rec dynamic-range
"$PY" scripts/quantize.py lama dynamic
"$PY" scripts/quantize.py lama static
"$PY" scripts/quantize.py lama static-conv

# Staging directories used by v8-app's --models flag.
for d in text-fp32 text-int8-range; do
  mkdir -p "models/$d"
  cp -f models/fp32/keys.txt "models/$d/keys.txt"
done
cp -f models/fp32/det.onnx models/fp32/rec.onnx models/text-fp32/
cp -f models/det-int8-dynamic-range/det.onnx models/rec-int8-dynamic-range/rec.onnx models/text-int8-range/

# Text pipeline runs.
for v in text-fp32 text-int8-range; do
  ../v8-app/target/release/v8-app batch --root .. \
    --out "eval/out-$v" --models "models/$v"
done
../v8-app/target/release/v8-app batch --root .. \
  --out eval/verify-text-bundled --models dist/text-bundled

# Inpainting evaluations.
"$PY" scripts/run_lama_eval.py
for s in hound rps harry-potter hunger-games whisper-man; do
  box=$("$PY" -c "import json;print(','.join(map(str,json.load(open('eval/lama-fp32-fixed/$s/run.json'))['crop_box'])))")
  mkdir -p "eval/migan/$s"
  "$PY" scripts/migan_eval.py --source "../v8-app/out/$s/source.jpg" \
    --mask "../v8-app/out/$s/mask.png" --out "eval/migan/$s" --crop-box "$box"
done

# Scores, sheets, manifest.
"$PY" scripts/analyze_text_quality.py
"$PY" scripts/score_images.py
"$PY" scripts/make_compare_sheet.py
"$PY" scripts/make_migan_sheet.py
"$PY" scripts/build_manifest.py
"$PY" scripts/verify_manifest.py
