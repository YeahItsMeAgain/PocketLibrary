#!/usr/bin/env python3
"""Verify a downloaded/staged model manifest before the app loads anything.

Usage: verify_manifest.py [MANIFEST.json] [--root DIR]
Exit code 0 only when every listed file exists with the pinned size and SHA-256.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", nargs="?", default="MANIFEST.json")
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    m = json.loads(Path(a.manifest).read_text())
    bad = 0
    seen: set[str] = set()
    for x in m["models"]:
        p = root / x["path"]
        if x["path"] in seen:
            continue
        seen.add(x["path"])
        if not p.exists():
            print(f"MISSING {x['path']}")
            bad += 1
            continue
        size = p.stat().st_size
        digest = sha(p)
        ok = size == x["bytes"] and digest == x["sha256"]
        print(f"{'OK  ' if ok else 'FAIL'} {x['id']:42} {size:>10} B {digest[:16]}")
        bad += 0 if ok else 1
    for name, b in m.get("bundles", {}).items():
        for x in b.get("files", []):
            if x["path"] in seen:
                continue
            seen.add(x["path"])
            p = root / x["path"]
            if not p.exists():
                print(f"MISSING {x['path']}")
                bad += 1
                continue
            ok = p.stat().st_size == x["bytes"] and sha(p) == x["sha256"]
            print(f"{'OK  ' if ok else 'FAIL'} {name + ': ' + x['path']:42} {p.stat().st_size:>10} B")
            bad += 0 if ok else 1
    if bad:
        print(f"\n{bad} model file(s) failed verification", file=sys.stderr)
        raise SystemExit(1)
    print(f"\nall {len(m['models'])} model files verified")


if __name__ == "__main__":
    main()
