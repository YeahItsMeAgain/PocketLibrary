#!/usr/bin/env bash
# Download the optional LaMa big-lama ONNX model (208 MB).
# LaMa is NOT bundled: it is an opt-in print-quality inpaint path.
set -euo pipefail
DEST="${1:-models/lama_fp32.onnx}"
URL="https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
EXPECTED="1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"

mkdir -p "$(dirname "$DEST")"
if [[ -f "$DEST" ]]; then
  echo "already exists: $DEST"
else
  echo "downloading LaMa ONNX (~208 MB) -> $DEST"
  curl -L --fail --progress-bar -o "$DEST.part" "$URL"
  mv "$DEST.part" "$DEST"
fi

got="$(sha256sum "$DEST" | cut -d' ' -f1)"
if [[ "$got" != "$EXPECTED" ]]; then
  echo "WARNING: sha256 mismatch" >&2
  echo "  expected $EXPECTED" >&2
  echo "  got      $got" >&2
  exit 1
fi
echo "ok: $DEST ($got)"
echo "use: v8-app run ... --lama $DEST"
