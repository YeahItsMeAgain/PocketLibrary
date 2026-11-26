#!/usr/bin/env python3
"""Quantise the v8 models with ONNX Runtime.

Usage:
  python scripts/quantize.py det  dynamic
  python scripts/quantize.py det  static
  python scripts/quantize.py rec  dynamic
  python scripts/quantize.py rec  static
  python scripts/quantize.py lama dynamic
  python scripts/quantize.py lama static
  python scripts/quantize.py lama fp16

Every run prints wall time and writes to models/<variant>/<name>.onnx.
The source fp32 models are copied to models/fp32/ once by prepare_models.sh.
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import onnx
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_dynamic,
    quantize_static,
)

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
CALIB = ROOT / "calib"
FP32 = MODELS / "fp32"

CONFIG = {
    "det": {"src": MODELS / "fp32-folded" / "det.onnx", "input": ["x"], "calib": "det", "key": "x"},
    "rec": {"src": MODELS / "fp32-folded" / "rec.onnx", "input": ["x"], "calib": "rec", "key": "x"},
    "lama": {
        "src": MODELS / "fp32" / "lama_fp32.onnx",
        "input": ["image", "mask"],
        "calib": "lama",
    },
}


class Reader(CalibrationDataReader):
    def __init__(self, folder: Path, names: list[str], key: str | None = None):
        self.files = sorted(folder.glob("*.npz"))
        if not self.files:
            raise SystemExit(f"no calibration files in {folder}")
        self.names = names
        self.key = key
        self.i = 0

    def get_next(self):
        if self.i >= len(self.files):
            return None
        d = np.load(self.files[self.i])
        self.i += 1
        if self.key:
            return {self.names[0]: d[self.key]}
        return {n: d[n] for n in self.names}


def static(model: str, cfg: dict, fmt: QuantFormat, tag: str, op_types: list[str] | None = None) -> Path:
    out = MODELS / f"{model}-int8-{tag}" / f"{model}.onnx"
    out.parent.mkdir(parents=True, exist_ok=True)
    reader = Reader(CALIB / cfg["calib"], cfg["input"], cfg.get("key"))
    t = time.time()
    quantize_static(
        str(cfg["src"]),
        str(out),
        reader,
        quant_format=fmt,
        per_channel=True,
        reduce_range=False,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        calibrate_method=CalibrationMethod.MinMax,
        op_types_to_quantize=op_types,
        extra_options={
            "ActivationSymmetric": False,
            "WeightSymmetric": True,
            "MinimumRealRange": 0.001,
        },
    )
    print(f"{out} {out.stat().st_size/1e6:.2f} MB in {time.time()-t:.1f}s")
    return out


def dynamic(model: str, cfg: dict, tag: str = "dynamic", reduce_range: bool = False, per_channel: bool = True) -> Path:
    out = MODELS / f"{model}-int8-{tag}" / f"{model}.onnx"
    out.parent.mkdir(parents=True, exist_ok=True)
    t = time.time()
    quantize_dynamic(
        str(cfg["src"]),
        str(out),
        weight_type=QuantType.QInt8,
        per_channel=per_channel,
        reduce_range=reduce_range,
        extra_options={"WeightSymmetric": True},
    )
    print(f"{out} {out.stat().st_size/1e6:.2f} MB in {time.time()-t:.1f}s")
    return out


def fp16(model: str, cfg: dict) -> Path:
    from onnxconverter_common import float16

    out = MODELS / f"{model}-fp16" / f"{model}.onnx"
    out.parent.mkdir(parents=True, exist_ok=True)
    t = time.time()
    m = onnx.load(str(cfg["src"]))
    m16 = float16.convert_float_to_float16(m, keep_io_types=True)
    onnx.save(m16, str(out))
    print(f"{out} {out.stat().st_size/1e6:.2f} MB in {time.time()-t:.1f}s")
    return out


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in CONFIG:
        raise SystemExit(__doc__)
    model, mode = sys.argv[1], sys.argv[2]
    cfg = CONFIG[model]
    if mode == "dynamic":
        dynamic(model, cfg)
    elif mode == "dynamic-range":
        dynamic(model, cfg, tag="dynamic-range", reduce_range=True)
    elif mode == "dynamic-channel":
        dynamic(model, cfg, tag="dynamic-channel", per_channel=False)
    elif mode == "static":
        static(model, cfg, QuantFormat.QOperator, "qoperator")
    elif mode == "static-qdq":
        static(model, cfg, QuantFormat.QDQ, "qdq")
    elif mode == "static-conv":
        static(model, cfg, QuantFormat.QOperator, "qoperator-conv", ["Conv"])
    elif mode == "fp16":
        fp16(model, cfg)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
