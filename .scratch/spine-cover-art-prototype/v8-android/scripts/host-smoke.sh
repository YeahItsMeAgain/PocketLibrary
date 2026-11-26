#!/usr/bin/env bash
# Host smoke test for the same Rust pipeline path used by the APK.
# Uses the host onnxruntime build (1.32.0) discovered under /tmp/opencode/ortlib,
# or ORT_DYLIB_PATH if already set.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
V8APP="$ROOT/../v8-app"
export ORT_DYLIB_PATH="${ORT_DYLIB_PATH:-/tmp/opencode/ortlib/libonnxruntime.so}"
COVER="${1:-$ROOT/assets/covers/gatsby.jpg}"
COVER="$(cd "$(dirname "$COVER")" && pwd)/$(basename "$COVER")"
TITLE="${2:-The Great Gatsby}"
AUTHOR="${3:-F. Scott Fitzgerald}"
PAGES="${4:-180}"
OUT="${OUT:-$ROOT/out/host-smoke}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$ROOT/rust"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-host}"
cargo build --release --bin hostrun
python3 - "$OUT" ./target-host/release/hostrun \
  --cover "$COVER" --models "$V8APP/models" --out "$OUT" \
  --title "$TITLE" --author "$AUTHOR" --pages "$PAGES" <<'PY'
import resource, subprocess, sys, time
out, *cmd = sys.argv[1:]
t0 = time.time()
with open(out + "/result.json", "w") as f, open(out + "/time.txt", "w") as e:
    p = subprocess.run(cmd, stdout=f, stderr=e)
elapsed = time.time() - t0
ru = resource.getrusage(resource.RUSAGE_CHILDREN)
with open(out + "/time.txt", "a") as f:
    f.write(f"\nElapsed: {elapsed:.2f} s\nMaximum resident set size (kbytes): {ru.ru_maxrss}\n")
sys.exit(p.returncode)
PY
echo "--- time/memory ---"
grep -E "Elapsed|Maximum resident" "$OUT/time.txt"
