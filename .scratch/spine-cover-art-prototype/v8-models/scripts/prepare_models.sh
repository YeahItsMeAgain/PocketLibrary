#!/usr/bin/env bash
# Stage the read-only v8-app models into this study, then build calibration data.
# Does not modify v8-app/ or v8-auto/.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p models/fp32 work/models
cp -n ../v8-app/models/det.onnx models/fp32/det.onnx
cp -n ../v8-app/models/rec.onnx models/fp32/rec.onnx
cp -n ../v8-app/models/keys.txt models/fp32/keys.txt
if [[ ! -f models/fp32/lama_fp32.onnx ]]; then
  if [[ -f work/models/lama_fp32.onnx ]]; then
    cp work/models/lama_fp32.onnx models/fp32/lama_fp32.onnx
  else
    echo "Download LaMa first (see README): work/models/lama_fp32.onnx" >&2
    exit 1
  fi
fi

PYTHON="${PYTHON:-/tmp/opencode/venv/bin/python}"
"$PYTHON" scripts/make_calibration.py
ls -lh models/fp32 calib/det calib/rec calib/lama
