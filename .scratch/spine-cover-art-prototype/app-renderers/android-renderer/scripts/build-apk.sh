#!/usr/bin/env bash
# Build the app-renderers test APK: the v8-android native shell plus a WebView
# renderer. The Rust cdylib and ONNX Runtime .so are reused from the read-only
# ../v8-android build; only Java, assets and packaging are rebuilt here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" # android-renderer
ROOT="$(cd "$HERE/.." && pwd)"                          # app-renderers
PROTO="$(cd "$ROOT/.." && pwd)"                         # spine-cover-art-prototype
V8ANDROID="${V8ANDROID:-$PROTO/v8-android}"
V8APP="${V8APP:-$PROTO/v8-app}"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
BT="$SDK/build-tools/36.0.0"
JDK="${JAVA_HOME:-$HOME/tools/jdk-21}"
JAVAC="$JDK/bin/javac"
KEYTOOL="$JDK/bin/keytool"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"

ABI="${ABI:-arm64-v8a}"
MIN_API=26
BUILD="$HERE/build"
ASSETS="$BUILD/assets"
LIBDIR="$BUILD/lib/$ABI"
DEX="$BUILD/dex"
APKROOT="$BUILD/apkroot"
DIST="$HERE/out"
APK="$DIST/v8-renderers-$ABI.apk"

PREBUILT_LIB="$V8ANDROID/build/lib/$ABI"

echo "== build env =="
echo "app-renderers=$ROOT"
echo "v8-android=$V8ANDROID"
echo "sdk=$SDK"
echo "abi=$ABI"

for p in "$JAVAC" "$ANDROID_JAR" "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$BT/zipalign"; do
  [ -e "$p" ] || { echo "missing: $p" >&2; exit 1; }
done
for f in libv8android.so libonnxruntime.so; do
  [ -f "$PREBUILT_LIB/$f" ] || { echo "missing prebuilt $PREBUILT_LIB/$f (build ../v8-android first)" >&2; exit 1; }
done

rm -rf "$BUILD"
mkdir -p "$ASSETS/models" "$ASSETS/covers" "$ASSETS/renderer" "$LIBDIR" "$DEX" "$APKROOT/lib/$ABI" "$DIST"

echo "== assets =="
cp "$V8APP/models/det.onnx" "$V8APP/models/rec.onnx" "$V8APP/models/keys.txt" "$ASSETS/models/"
cp "$HERE"/assets/covers/* "$ASSETS/covers/"
cp "$HERE"/assets/renderer/index.html "$ASSETS/renderer/"
cp "$ROOT"/renderer/renderer.js "$ROOT"/renderer/renderer.css "$ASSETS/renderer/"
cp -r "$ROOT"/renderer/fonts "$ASSETS/renderer/fonts"
du -sh "$ASSETS"

echo "== native libs (prebuilt, read-only) =="
cp "$PREBUILT_LIB/libv8android.so" "$PREBUILT_LIB/libonnxruntime.so" "$LIBDIR/"
ls -lh "$LIBDIR"

echo "== java =="
mkdir -p "$BUILD/classes"
find "$HERE/java" -name '*.java' > "$BUILD/sources.txt"
"$JAVAC" --release 17 -Xlint:-options -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt" 2>&1 | tee "$DIST/javac.log"
"$BT/d8" --min-api "$MIN_API" --lib "$ANDROID_JAR" --output "$DEX" $(find "$BUILD/classes" -name '*.class')
cp "$DEX/classes.dex" "$APKROOT/classes.dex"
cp "$LIBDIR"/*.so "$APKROOT/lib/$ABI/"

echo "== aapt2 link =="
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  --manifest "$HERE/AndroidManifest.xml" \
  -I "$ANDROID_JAR" \
  -A "$ASSETS" \
  --min-sdk-version "$MIN_API" \
  --target-sdk-version 36 \
  --version-code 1 \
  --version-name 0.1.0 2>&1 | tee "$DIST/aapt2-link.log"
[ -f "$BUILD/base.apk" ] || { echo "aapt2 link failed" >&2; exit 1; }

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
KS="$DIST/debug.keystore"
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
sha256sum "$APK" | tee "$DIST/sha256.txt"
"$BT/aapt2" dump badging "$APK" | tee "$DIST/badging.txt" | head -8
unzip -l "$APK" | grep -E "lib/|models/|renderer/|classes.dex" | tee "$DIST/apk-contents.txt"
echo "APK: $APK"
