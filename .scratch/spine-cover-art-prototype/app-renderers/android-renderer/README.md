# android-renderer — v8 native pipeline + WebView renderer APK

Throwaway test build. This is a **copy** of `../../v8-android` with one extra
Activity. The original `v8-android/` and `v8-app/` trees are read-only here.

## What is in the APK

- `MainActivity` — the v8-android shell, unchanged in behaviour, plus a
  **Render four spine styles on device** button.
- `RendererActivity` — a WebView that receives the run directory produced by
  the native pipeline and draws the app-renderer studies from it.
- `lib/arm64-v8a/libv8android.so` — prebuilt from `v8-android/build/`, same
  Rust/ONNX JNI pipeline.
- `lib/arm64-v8a/libonnxruntime.so` — ONNX Runtime 1.20.0 arm64.
- `assets/models/` — PP-OCRv3 det + rec + keys.
- `assets/covers/` — the five study covers as samples (the URL path is still
  the random-book route).
- `assets/renderer/` — the same renderer JS/CSS/fonts as the host gallery.

## Build

```bash
cd .scratch/spine-cover-art-prototype/app-renderers/android-renderer
JAVA_HOME=$HOME/tools/jdk-21 ./scripts/build-apk.sh
```

Output: `out/v8-renderers-arm64-v8a.apk` (about 21 MB), signed with a local
debug key, v2 + v3 schemes. `out/sha256.txt`, `out/badging.txt` and
`out/apk-contents.txt` are written next to it.

Requirements: Android SDK platform 36, build-tools 36.0.0, JDK 17+, and an
already-built `../../v8-android/build/lib/arm64-v8a/` containing
`libv8android.so` and `libonnxruntime.so`. No Rust rebuild is needed for the
renderer change; the native library is reused byte-for-byte.

## Install / run when a device exists

```bash
adb install -r out/v8-renderers-arm64-v8a.apk
adb logcat -c
adb shell am start -n app.pocketlibrary.spinetest/.MainActivity
adb logcat -s v8android v8renderers
```

1. Pick a sample, pick a device image, or paste a cover URL and fetch it.
2. Press **Generate spine on device**. Wait for route/verdict.
3. Press **Render four spine styles on device**.
4. The WebView shows: original → v8 art (with crop box) → v8 crop → full-bleed
   → art-only → wrap → Hybrid / Cloth / Editorial, plus the QA/provenance panel.
5. Screenshot the page (`adb exec-out screencap -p > renderers.png`).

A proof run must have fetched/selected the cover on the phone and must show a
`run.json` route/verdict produced by the native run.

## Host-side proof performed

There is no adb device, emulator image or `/dev/kvm` in this environment, so the
APK was **not installed**. What was verified:

- `javac` + `d8` compile `MainActivity` and `RendererActivity`;
- `aapt2` packages both Activities, the native libraries, models and renderer
  assets;
- `apksigner verify` passes v2 + v3;
- the exact bundled `assets/renderer/` page was loaded in Chromium with a mock
  `PocketBridge` payload (the same JSON shape `RendererActivity` builds) for
  Gatsby, RPS and the holdout at 390 / 320 px: six spines, zero overflow, zero
  console/page/request errors, 1.3–1.4 MB payloads;
- `tools/build-payloads.py` generates those payloads from the host v8 output.

The remaining blocker is the device tap of the new Java → WebView handoff.

## Payload size note

`RendererActivity` passes `art.jpg`, `spine-2x.jpg` and `fallback-spine.jpg` as
data URIs. `source.jpg` is downscaled to max 720 px / JPEG 82 first, because it
is only used for the chain thumbnail and the wrap's published front. That keeps
the JS bridge payload small (hundreds of KB, not multiple MB). If a future cover
makes the payload too large, write the JSON to app cache and load it from a
scoped `file://` URL instead.

## Not changed

No production app code, tests, manifests or specs. No edits to `v8-app/` or
`v8-android/`. No commits or releases.
