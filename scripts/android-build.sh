#!/usr/bin/env bash
# Build a signed, arm64 release APK from a clean checkout.
#
# Usage:
#   ./scripts/android-build.sh
#
# This is the one-command Android path. It:
#   1. sources scripts/android-env.sh (JDK, SDK, NDK, signing env);
#   2. checks that src-tauri/gen/android exists (run
#      `npm run tauri android init -- --ci` once if it does not);
#   3. re-applies our Android patches idempotently (scripts/android-patch.sh);
#   4. stages the spine models and ONNX Runtime (stage-spine-android-assets.sh);
#   5. runs `npm run tauri android build -- --apk --target aarch64 --ci`;
#   6. prints the APK path and sanity-checks version, assets, native libs and
#      extractNativeLibs.
#
# No secret is stored here: release signing comes from scripts/android-env.sh
# and the environment (POCKETLIBRARY_KEYSTORE*).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
ANDROID_PROJECT="$REPO_ROOT/src-tauri/gen/android"
APK="$ANDROID_PROJECT/app/build/outputs/apk/universal/release/app-universal-release.apk"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*"
}

# shellcheck source=android-env.sh
source "$HERE/android-env.sh"

[ -f "$ANDROID_PROJECT/app/build.gradle.kts" ] || die "Android project not found at $ANDROID_PROJECT
run \`npm run tauri android init -- --ci\` once, then re-run ./scripts/android-build.sh"

info "Re-applying Android patches (idempotent)"
"$HERE/android-patch.sh" apply

info "Staging spine models and ONNX Runtime"
"$HERE/stage-spine-android-assets.sh"

info "Building the release APK (arm64)"
cd "$REPO_ROOT"
npm run tauri android build -- --apk --target aarch64 --ci

[ -f "$APK" ] || die "build finished but no APK at $APK"

# Pick the newest installed build-tools; fall back to 36.0.0.
AAPT2="${AAPT2:-$(ls -1 "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)}"
[ -n "${AAPT2:-}" ] && [ -x "$AAPT2" ] || die "aapt2 not found under $ANDROID_HOME/build-tools"

EXPECTED_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
EXPECTED_CODE="$(
  node -e 'const [maj,min,pat]=require(process.argv[1]).version.split(".").map(Number); console.log(maj*1000000+min*1000+pat)' \
    "$REPO_ROOT/package.json"
)"

BADGING="$("$AAPT2" dump badging "$APK" | sed -n '1p')"
grep -q "versionName='$EXPECTED_VERSION'" <<<"$BADGING" \
  || die "APK versionName does not match package.json ($EXPECTED_VERSION): $BADGING"
grep -q "versionCode='$EXPECTED_CODE'" <<<"$BADGING" \
  || die "APK versionCode does not match $EXPECTED_CODE: $BADGING"

CONTENTS="$(unzip -l "$APK")"
for asset in det.onnx rec.onnx keys.txt migan_pipeline_v2.onnx libonnxruntime.so; do
  grep -q "assets/spine/$asset" <<<"$CONTENTS" \
    || die "APK is missing assets/spine/$asset"
done
grep -q "lib/arm64-v8a/libonnxruntime.so" <<<"$CONTENTS" \
  || die "APK is missing lib/arm64-v8a/libonnxruntime.so"

[ -f "$ANDROID_PROJECT/app/src/main/jniLibs/arm64-v8a/libonnxruntime.so" ] \
  || die "staged jniLibs/libonnxruntime.so is missing"

MANIFEST_XML="$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")"
grep -q 'extractNativeLibs(0x010104ea)=true' <<<"$MANIFEST_XML" \
  || die "APK manifest does not set android:extractNativeLibs=true"

info "APK: $APK"
info "Version: $EXPECTED_VERSION ($EXPECTED_CODE); assets/spine/*, lib/arm64-v8a/libonnxruntime.so, extractNativeLibs=true OK"
