#!/usr/bin/env bash
# Stage the on-device spine models and ONNX Runtime into the generated Tauri
# Android project.
#
# Output (all consumed by src-tauri/src/spine_assets.rs):
#   src-tauri/gen/android/app/src/main/assets/spine/det.onnx
#   src-tauri/gen/android/app/src/main/assets/spine/rec.onnx
#   src-tauri/gen/android/app/src/main/assets/spine/keys.txt
#   src-tauri/gen/android/app/src/main/assets/spine/migan_pipeline_v2.onnx
#   src-tauri/gen/android/app/src/main/assets/spine/libonnxruntime.so   (fallback)
#   src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libonnxruntime.so
#
# ONNX Runtime is loaded from the APK's native library directory (jniLibs).
# Android 10+ W^X rules make app-private storage an unsupported place to
# dlopen a shared library, so jniLibs is the real load path; the assets copy is
# kept only for spine_assets.rs's legacy fallback.
#
# No Java or Android SDK is required: the ONNX Runtime shared object is taken
# from the local AAR with `unzip`. Run `npm run tauri android init` first if the
# generated project is missing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

ANDROID_PROJECT="$REPO_ROOT/src-tauri/gen/android"
ANDROID_APP="$ANDROID_PROJECT/app"
ASSETS_ROOT="$ANDROID_APP/src/main/assets"
ASSETS_DIR="$ASSETS_ROOT/spine"
STAGING_DIR="$ASSETS_ROOT/.spine-staging.$$"
JNI_LIBS_DIR="$ANDROID_APP/src/main/jniLibs/arm64-v8a"
ORT_STAGING="$JNI_LIBS_DIR/.libonnxruntime.so.staging.$$"

V8_PROTOTYPE="$REPO_ROOT/.scratch/spine-cover-art-prototype"
MODELS_DIR="${SPINE_MODELS_DIR:-$V8_PROTOTYPE/v8-app/models}"
MIGAN_SRC="${SPINE_MIGAN:-$V8_PROTOTYPE/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx}"
ORT_AAR="${ORT_AAR:-$V8_PROTOTYPE/v8-android/artifacts/onnxruntime-android-1.20.0.aar}"
ORT_MEMBER="jni/arm64-v8a/libonnxruntime.so"

# These are the manifest values for the exact files the app ships. det.onnx is
# the v8-app FP32 detector (results.json); rec/keys/migan values come from
# v8-models/MANIFEST.json; the runtime hash is the arm64-v8a member of
# onnxruntime-android 1.20.0.
MANIFEST_NAMES=(det.onnx rec.onnx keys.txt migan_pipeline_v2.onnx libonnxruntime.so)
MANIFEST_BYTES=(2432880 10690752 26250 28079181 17571160)
MANIFEST_SHA256=(
  3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526
  897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615
  a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492
  6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b
  52329b7c8e5fcd5c1aa88b01093215faaef362e3f3d0e374cb8b10d1e4704677
)
MODEL_COUNT=4

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no sha256sum or shasum found; install coreutils or perl-Digest-SHA"
  fi
}

size_of() {
  wc -c < "$1" | tr -d '[:space:]'
}

require_file() {
  [ -f "$1" ] || die "missing source file: $1"
}

[ -d "$ANDROID_APP/src/main" ] || die "generated Android project not found at $ANDROID_PROJECT
run \`npm run tauri android init\` first, then re-run this script"

command -v unzip >/dev/null 2>&1 || die "unzip is required to extract $ORT_MEMBER from the ONNX Runtime AAR"

require_file "$MODELS_DIR/det.onnx"
require_file "$MODELS_DIR/rec.onnx"
require_file "$MODELS_DIR/keys.txt"
require_file "$MIGAN_SRC"
require_file "$ORT_AAR"

cleanup() {
  rm -rf "$STAGING_DIR" "$ORT_STAGING"
}
trap cleanup EXIT

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$JNI_LIBS_DIR"

verify_file() {
  local name="$1" file="$2" src="$3"
  local expected_bytes="$4" expected_sha="$5"

  [ -f "$file" ] || die "staging failed for $name"
  local got_bytes got_sha
  got_bytes="$(size_of "$file")"
  got_sha="$(sha256_of "$file")"

  [ "$got_bytes" = "$expected_bytes" ] || die "$name size mismatch: expected $expected_bytes, got $got_bytes (source $src)"
  [ "$got_sha" = "$expected_sha" ] || die "$name sha256 mismatch: expected $expected_sha, got $got_sha (source $src)"
}

copy_verified() {
  local name="$1" src="$2"
  local expected_bytes="$3" expected_sha="$4"

  cp "$src" "$STAGING_DIR/$name"
  verify_file "$name" "$STAGING_DIR/$name" "$src" "$expected_bytes" "$expected_sha"
}

copy_verified "det.onnx" "$MODELS_DIR/det.onnx" \
  "${MANIFEST_BYTES[0]}" "${MANIFEST_SHA256[0]}"
copy_verified "rec.onnx" "$MODELS_DIR/rec.onnx" \
  "${MANIFEST_BYTES[1]}" "${MANIFEST_SHA256[1]}"
copy_verified "keys.txt" "$MODELS_DIR/keys.txt" \
  "${MANIFEST_BYTES[2]}" "${MANIFEST_SHA256[2]}"
copy_verified "migan_pipeline_v2.onnx" "$MIGAN_SRC" \
  "${MANIFEST_BYTES[3]}" "${MANIFEST_SHA256[3]}"

# Extract once into a temp file, verify, then use the same verified bytes for
# both the jniLibs load path and the assets fallback.
unzip -p "$ORT_AAR" "$ORT_MEMBER" > "$ORT_STAGING" \
  || die "could not extract $ORT_MEMBER from $ORT_AAR"
verify_file "libonnxruntime.so" "$ORT_STAGING" "$ORT_AAR:$ORT_MEMBER" \
  "${MANIFEST_BYTES[4]}" "${MANIFEST_SHA256[4]}"
cp "$ORT_STAGING" "$STAGING_DIR/libonnxruntime.so"
mv -f "$ORT_STAGING" "$JNI_LIBS_DIR/libonnxruntime.so"

# Swap the verified staging directory into place only after every hash passed.
rm -rf "$ASSETS_DIR"
mv "$STAGING_DIR" "$ASSETS_DIR"
trap - EXIT

echo "Staged spine assets for the Tauri Android build:"
echo "  project:   $ANDROID_PROJECT"
echo "  models:    ${ASSETS_DIR#"$REPO_ROOT"/} (APK assets/spine/)"
echo "  ORT lib:   ${JNI_LIBS_DIR#"$REPO_ROOT"/} (loaded from nativeLibraryDir)"
echo "  fallback:  ${ASSETS_DIR#"$REPO_ROOT"/}/libonnxruntime.so"
echo
printf '  %-26s %12s  %s\n' "file" "bytes" "sha256"
for i in "${!MANIFEST_NAMES[@]}"; do
  name="${MANIFEST_NAMES[$i]}"
  if [ "$i" -lt "$MODEL_COUNT" ]; then
    file="$ASSETS_DIR/$name"
  else
    file="$JNI_LIBS_DIR/$name"
  fi
  [ -f "$file" ] || die "staged file disappeared: $file"
  printf '  %-26s %12s  %s\n' "$name" "$(size_of "$file")" "$(sha256_of "$file")"
done
echo
echo "OK: $MODEL_COUNT/$MODEL_COUNT models + ONNX Runtime match the manifest."
