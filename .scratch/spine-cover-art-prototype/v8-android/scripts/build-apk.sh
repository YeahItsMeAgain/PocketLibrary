#!/usr/bin/env bash
# Reproducible APK build for the v8-android harness.
#
# Requires: Rust aarch64-linux-android target, Android SDK (build-tools,
# platform android-36), Android NDK 28.2, JDK 17+.
#
# The checked-in ../../v8-app directory is read-only; this script only reads
# models and Cargo sources from it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                 # v8-android
REPO="$(cd "$ROOT/../../.." && pwd)"            # repo root
V8APP="${V8APP:-$ROOT/../v8-app}"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
BT="$SDK/build-tools/36.0.0"
NDK="${ANDROID_NDK_HOME:-$SDK/ndk/28.2.13676358}"
JDK="${JAVA_HOME:-$HOME/tools/jdk-21}"
JAVAC="$JDK/bin/javac"
KEYTOOL="$JDK/bin/keytool"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
MIN_API=26
ABI="${ABI:-arm64-v8a}"
RUST_TARGET="${RUST_TARGET:-aarch64-linux-android}"
CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/${RUST_TARGET}${MIN_API}-clang"
[ "$ABI" = "x86_64" ] && CLANG="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android${MIN_API}-clang"

ORT_VERSION="${ORT_VERSION:-1.20.0}"
ORT_AAR="${ORT_AAR:-$ROOT/artifacts/onnxruntime-android-$ORT_VERSION.aar}"
ORT_URL="https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/$ORT_VERSION/onnxruntime-android-$ORT_VERSION.aar"

BUILD="$ROOT/build"
ASSETS="$BUILD/assets"
LIBDIR="$BUILD/lib/$ABI"
DEX="$BUILD/dex"
APKROOT="$BUILD/apkroot"
DIST="$ROOT/out"
APK="$DIST/v8-spine-test-$ABI.apk"

echo "== build env =="
echo "repo=$REPO"
echo "v8-app=$V8APP"
echo "sdk=$SDK"
echo "ndk=$NDK"
echo "abi=$ABI target=$RUST_TARGET"

for p in "$JAVAC" "$ANDROID_JAR" "$CLANG" "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$BT/zipalign"; do
  [ -e "$p" ] || { echo "missing: $p" >&2; exit 1; }
done

rm -rf "$BUILD"
mkdir -p "$ASSETS/models" "$ASSETS/covers" "$LIBDIR" "$DEX" "$APKROOT/lib/$ABI" "$DIST"

echo "== assets =="
cp "$V8APP/models/det.onnx" "$V8APP/models/rec.onnx" "$V8APP/models/keys.txt" "$ASSETS/models/"
cp "$ROOT"/assets/covers/* "$ASSETS/covers/"
du -sh "$ASSETS/models"

echo "== onnxruntime =="
if [ ! -f "$ORT_AAR" ]; then
  echo "downloading $ORT_URL"
  curl -fL --retry 3 -o "$ORT_AAR" "$ORT_URL"
fi
unzip -o -q "$ORT_AAR" "jni/$ABI/libonnxruntime.so" -d "$BUILD/ort"
cp "$BUILD/ort/jni/$ABI/libonnxruntime.so" "$LIBDIR/"
ls -lh "$LIBDIR/libonnxruntime.so"

echo "== rust cdylib ($RUST_TARGET) =="
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CLANG"
export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android${MIN_API}-clang"
export CC_aarch64_linux_android="$CLANG"
export AR_aarch64_linux_android="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"
( cd "$ROOT/rust" && cargo build --release --target "$RUST_TARGET" )
cp "$ROOT/rust/target/$RUST_TARGET/release/libv8android.so" "$LIBDIR/"
ls -lh "$LIBDIR/libv8android.so"

echo "== java =="
mkdir -p "$BUILD/classes"
find "$ROOT/android/java" -name '*.java' > "$BUILD/sources.txt"
"$JAVAC" --release 17 -Xlint:-options -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt" 2>&1 | tee "$DIST/javac.log"
"$BT/d8" --min-api "$MIN_API" --lib "$ANDROID_JAR" --output "$DEX" $(find "$BUILD/classes" -name '*.class')
cp "$DEX/classes.dex" "$APKROOT/classes.dex"
cp "$LIBDIR"/*.so "$APKROOT/lib/$ABI/"

echo "== aapt2 link =="
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  -A "$ASSETS" \
  --min-sdk-version "$MIN_API" \
  --target-sdk-version 36 \
  --version-code 1 \
  --version-name 0.1.0 2>&1 | tee "$DIST/aapt2-link.log"

if [ ! -f "$BUILD/base.apk" ]; then
  echo "aapt2 link failed" >&2
  exit 1
fi

echo "== assemble =="
cp "$BUILD/base.apk" "$BUILD/unaligned.apk"
( cd "$APKROOT" && python3 - "$BUILD/unaligned.apk" "$APKROOT" <<'PY'
import os, sys, zipfile
apk, root = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            path = os.path.join(dirpath, name)
            z.write(path, os.path.relpath(path, root))
PY
)
"$BT/zipalign" -p -f 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk"

echo "== sign =="
KS="$ROOT/artifacts/debug.keystore"
if [ ! -f "$KS" ]; then
  "$KEYTOOL" -genkeypair -keystore "$KS" -storepass android -alias androiddebugkey \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify --verbose "$APK" | tee "$DIST/apksigner-verify.txt"

echo "== summary =="
ls -lh "$APK"
"$BT/aapt2" dump badging "$APK" | tee "$DIST/badging.txt" | head -8
unzip -l "$APK" | grep -E "lib/|models/|classes.dex" | tee "$DIST/apk-contents.txt"
echo "APK: $APK"
