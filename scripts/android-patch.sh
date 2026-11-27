#!/usr/bin/env bash
# Re-apply PocketLibrary's Android customisations to src-tauri/gen/android.
#
# Usage:
#   ./scripts/android-patch.sh          # apply (idempotent)
#   ./scripts/android-patch.sh check    # exit 1 if anything is missing
#
# See scripts/android-patches/apply.py for the patch list.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$HERE/android-patches/apply.py" "${1:-apply}"
