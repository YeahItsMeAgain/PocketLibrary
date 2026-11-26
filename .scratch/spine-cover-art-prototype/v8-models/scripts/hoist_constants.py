#!/usr/bin/env python3
"""Hoist Constant-node weights into graph initializers.

The PP-OCRv3 det/rec files bundle every conv weight as a Constant node. ONNX
Runtime's quantizer only quantises initializers, so on the originals it reports
success while changing almost nothing. This rewrites the graph into the standard
initializer form without changing the maths, before quantisation.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import onnx
from onnx import numpy_helper


def hoist(src: Path, dst: Path) -> None:
    m = onnx.load(str(src))
    g = m.graph
    keep = []
    added = 0
    for n in g.node:
        if n.op_type == "Constant" and len(n.attribute) == 1 and n.attribute[0].name == "value":
            t = n.attribute[0].t
            t.name = n.output[0]
            g.initializer.append(t)
            added += 1
        else:
            keep.append(n)
    del g.node[:]
    g.node.extend(keep)
    onnx.checker.check_model(m)
    dst.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(dst))
    print(f"{src.name}: hoisted {added} constants -> {dst} ({dst.stat().st_size/1e6:.2f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args()
    hoist(Path(a.src), Path(a.dst))


if __name__ == "__main__":
    main()
