#!/usr/bin/env bash
# The single verification gate for PocketLibrary.
#
# Usage:
#   ./scripts/check.sh            # fast gate (what CI runs on every push/PR)
#   ./scripts/check.sh full       # fast + full Playwright suite + Android cross-check
#   ./scripts/check.sh android    # build the arm64 APK via scripts/android-build.sh
#
# Formatting is checked first, then the independent web, core and spine groups
# run in parallel. A failing stage prints its name and the tail of its log and
# fails its group; the gate exits non-zero when any group fails. Logs are kept
# in a temporary directory (or CHECK_LOG_DIR when set) for inspection.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-fast}"
case "$MODE" in
  fast | full | android) ;;
  -h | --help | help)
    sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    printf 'error: unknown mode %q (expected fast, full or android)\n' "$MODE" >&2
    exit 2
    ;;
esac

LOG_DIR="${CHECK_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/pocketlibrary-check.XXXXXX")}"
mkdir -p "$LOG_DIR"

cleanup() {
  local status=$?
  trap - EXIT
  if [[ $status -eq 0 ]]; then
    rm -rf "$LOG_DIR"
  else
    printf '\nLogs kept in %s\n' "$LOG_DIR" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

run_stage() {
  local name="$1"
  shift
  local slug
  slug="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr ' ()' '---' | tr -cd 'a-z0-9-')"
  local log="$LOG_DIR/$slug.log"
  local started=$SECONDS

  printf '\n==> %s\n' "$name"
  if "$@" >"$log" 2>&1; then
    printf '    ok (%ss) [%s]\n' "$((SECONDS - started))" "$name"
  else
    local status=$?
    printf '\nFAIL: %s (exit %d)\n' "$name" "$status" >&2
    printf 'log: %s\n' "$log" >&2
    printf -- '--- tail of %s ---\n' "$name" >&2
    tail -n 80 "$log" >&2
    printf -- '--- end %s ---\n' "$name" >&2
    exit "$status"
  fi
}

# Playwright's config starts both the dev server and the production-preview
# server. The subset runs in parallel; set PLAYWRIGHT_WORKERS to override.
PLAYWRIGHT_FAST_SPECS=(
  tests/e2e/smoke.spec.ts
  tests/e2e/spine-queue.spec.ts
  tests/e2e/spine-renderer.spec.ts
  tests/e2e/spine-presentation.spec.ts
  tests/e2e/spine-studio.spec.ts
  tests/e2e/pdf-reader.spec.ts
  tests/e2e/reader.spec.ts
  tests/e2e/reader-csp.spec.ts
  tests/e2e/reader-layout.spec.ts
)

playwright_fast() {
  npx playwright test --workers="${PLAYWRIGHT_WORKERS:-4}" "${PLAYWRIGHT_FAST_SPECS[@]}"
}

playwright_full() {
  npx playwright test
}

android_cross_check() {
  # shellcheck source=android-env.sh
  source "$ROOT/scripts/android-env.sh"
  (
    cd "$ROOT/src-tauri"
    cargo check --target aarch64-linux-android -p pocketlibrary
  )
}

web_group() {
  run_stage "TypeScript" npx tsc --noEmit
  run_stage "Web build" npm run build
  run_stage "Playwright (fast)" playwright_fast
  run_stage "Android patch check" "$ROOT/scripts/android-patch.sh" check
}

core_group() {
  run_stage "Rust clippy (core)" \
    cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings
  run_stage "Rust test (core)" cargo test --manifest-path core/Cargo.toml
}

spine_group() {
  run_stage "Rust clippy (spine)" \
    cargo clippy --manifest-path spine/Cargo.toml --all-targets -- -D warnings
  run_stage "Rust test (spine)" cargo test --manifest-path spine/Cargo.toml
}

if [[ "$MODE" == "android" ]]; then
  run_stage "android build" "$ROOT/scripts/android-build.sh"
  printf '\ncheck: android build passed\n'
  exit 0
fi

printf 'PocketLibrary check (%s)\n' "$MODE"

# Cheap, fast-failing checks first, before any compilation.
run_stage "Rust fmt (core)" cargo fmt --manifest-path core/Cargo.toml --check
run_stage "Rust fmt (spine)" cargo fmt --manifest-path spine/Cargo.toml --check
run_stage "Rust fmt (src-tauri)" cargo fmt --manifest-path src-tauri/Cargo.toml --check

web_group & WEB_PID=$!
core_group & CORE_PID=$!
spine_group & SPINE_PID=$!

failed=0
for pid in "$WEB_PID" "$CORE_PID" "$SPINE_PID"; do
  set +e
  wait "$pid"
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  printf '\ncheck: %s gate failed (see FAIL stages above)\n' "$MODE" >&2
  exit 1
fi

if [[ "$MODE" == "full" ]]; then
  run_stage "Playwright (full)" playwright_full
  run_stage "Android cross-check" android_cross_check
fi

printf '\ncheck: %s gate passed\n' "$MODE"
