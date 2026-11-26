#!/usr/bin/env python3
"""Run a command, poll /proc for peak RSS, and print machine-readable timing.

Usage: run_measure.py --out logs/x.json -- cmd arg...
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    t0 = time.perf_counter()
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    peak_kb = 0
    while p.poll() is None:
        try:
            for line in Path(f"/proc/{p.pid}/status").read_text().splitlines():
                if line.startswith("VmHWM:"):
                    peak_kb = max(peak_kb, int(line.split()[1]))
        except FileNotFoundError:
            pass
        time.sleep(0.01)
    out = p.stdout.read() if p.stdout else ""
    wall = time.perf_counter() - t0
    rec = {
        "cmd": cmd,
        "returncode": p.returncode,
        "wall_s": round(wall, 3),
        "peak_rss_mb": round(peak_kb / 1024.0, 1),
        "output": out,
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(rec, indent=2))
    print(out, end="")


if __name__ == "__main__":
    main()
