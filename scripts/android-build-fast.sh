#!/usr/bin/env bash
# Fast, release-signed Android APK for iteration.
#
# The production build uses thin LTO and one codegen unit, which costs minutes
# on every Rust change. This path keeps the same release signing and package id
# (so it installs over a production build) but trades a little runtime
# optimisation for a much faster compile:
#
#   LTO off, 16 codegen units, opt-level 2, incremental release.
#
# Use scripts/android-build.sh for a release you intend to ship.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cargo reads these as profile overrides, so the manifest stays production-tuned.
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
export CARGO_PROFILE_RELEASE_OPT_LEVEL=2
export CARGO_PROFILE_RELEASE_INCREMENTAL=true
export CARGO_INCREMENTAL=1

# Gradle: parallel task graph + build cache for the unchanged modules.
GRADLE_PROPS="$HERE/../src-tauri/gen/android/gradle.properties"
if [ -f "$GRADLE_PROPS" ]; then
  grep -q '^org.gradle.parallel=' "$GRADLE_PROPS" || printf '\norg.gradle.parallel=true\n' >> "$GRADLE_PROPS"
  grep -q '^org.gradle.caching=' "$GRADLE_PROPS" || printf 'org.gradle.caching=true\n' >> "$GRADLE_PROPS"
fi

exec "$HERE/android-build.sh" "$@"
