#!/usr/bin/env bash
# Regenerate popular-app-route/v8/ with the v8-app Rust pipeline.
# Read-only use of ../v8-app, ../v8-android and ../v7; writes only into this
# directory's v8/ folder.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$APP/.." && pwd)"
V8APP="$ROOT/v8-app"

: "${ORT_DYLIB_PATH:?Set ORT_DYLIB_PATH to a host libonnxruntime.so}"
BIN="$V8APP/target/release/v8-app"
MODELS="$V8APP/models"
OUT="$APP/v8"

if [[ ! -x "$BIN" ]]; then
  echo "Missing $BIN — build v8-app first with: cd $V8APP && cargo build --release" >&2
  exit 1
fi

mkdir -p "$OUT"

run() {
  "$BIN" run "$@" --out "$OUT" --models "$MODELS"
}

# Popular books: four v7 catalogue covers, plus Dune as the unseen title.
run --cover "$ROOT/v7/assets/source/harry-potter.jpg" \
  --slug harry-potter --title "Harry Potter and the Philosopher's Stone" \
  --author "J.K. Rowling" --pages 223

run --cover "$ROOT/v7/assets/source/the-hunger-games.jpg" \
  --slug hunger-games --title "The Hunger Games" \
  --author "Suzanne Collins" --pages 384

run --cover "$ROOT/v7/assets/source/lord-of-the-rings.jpg" \
  --slug lord-of-the-rings --title "The Lord of the Rings" \
  --author "J.R.R. Tolkien" --pages 1031

run --cover "$ROOT/v7/assets/source/the-hobbit.jpg" \
  --slug the-hobbit --title "The Hobbit" \
  --author "J.R.R. Tolkien" --pages 310

run --cover "$ROOT/v8-android/assets/covers/dune.jpg" \
  --slug dune --title "Dune" \
  --author "Frank Herbert" --pages 617

# Generative-art cases: the two v4 covers, re-run through the app route.
run --cover "$V8APP/out/rps/source.jpg" \
  --slug rock-paper-scissors --title "Rock Paper Scissors" \
  --author "Alice Feeney" --pages 320

run --cover "$V8APP/out/whisper-man/source.jpg" \
  --slug the-whisper-man --title "The Whisper Man" \
  --author "Alex North" --pages 368

echo "Wrote $OUT"
