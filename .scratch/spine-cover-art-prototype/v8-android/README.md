# v8-android — on-device spine harness

Minimal **native Android** test app (Java Activity + Rust JNI `cdylib`) that runs
the read-only [`../v8-app`](../v8-app) Rust pipeline on a cover image entirely
on the device and renders the resulting spine.

It is deliberately **not** a Tauri copy: the checked-in production app was not
touched, and a standalone native shell removes the WebView/Tauri build surface
from the proof. The Rust pipeline, PP-OCRv3 ONNX models, embedded fonts and
route logic are exactly the ones in `../v8-app`.

## Status

- **APK:** `out/v8-spine-test-arm64-v8a.apk` · 19,698,712 bytes (18.8 MiB)
- **SHA-256:** `24bb847deea6360a7965091d3802fa44a3f0a5c5f739f7d66e707f667c5d88d3`
- **Built / signed / packaged:** yes (arm64-v8a, minSdk 26, v2+v3 signature)
- **Host pipeline proof:** yes — three covers `pass`, one text-heavy cover `review`
- **Ran on a phone/emulator:** **no** — this environment has no adb device, no
  emulator/AVD/system image and no `/dev/kvm`. Strict reproducibility therefore
  remains **pending device proof**, not claimed. See [REPORT.md](REPORT.md) §5
  and [TESTING.md](TESTING.md) for the human run.
- The hosted copy under `../v8-test/` is byte-identical to the APK above.

```
cover image / URL / bundled sample
        |
        v
MainActivity (Java)  ──copy models out of APK──>  filesDir/models
        |  JNI
        v
libv8android.so (Rust cdylib bridge)
        |
        v
v8_app::pipeline  (DBNet → mask → flat fill → crop search → QA → fallback)
        |
        +--> spine.jpg (52×236), spine-2x.jpg, fallback-spine.jpg,
             compare.jpg, run.json, qa.json  in filesDir/runs/<slug>/
        |
        v
Java renders source/spine/fallback/contact sheet; Export writes to
Downloads/PocketLibrarySpines (MediaStore)
```

## Build

Requirements used here: Android SDK platform 36, build-tools 36.0.0, NDK
28.2.13676358, JDK 21, Rust `aarch64-linux-android` target.

```sh
cd .scratch/spine-cover-art-prototype/v8-android
JAVA_HOME=$HOME/tools/jdk-21 ./scripts/build-apk.sh
```

The script:

1. copies `det.onnx` (2.4 MB), `rec.onnx` (10.7 MB) and `keys.txt` from
   `../v8-app/models/` into APK assets (read-only use of `v8-app`),
2. extracts `libonnxruntime.so` (ONNX Runtime 1.20.0, arm64-v8a) from the
   official `onnxruntime-android` AAR into `jniLibs` (AAR cached under
   `artifacts/`),
3. cross-compiles `rust/` for `aarch64-linux-android` with NDK 28.2 clang,
4. compiles the Java Activity with `javac` + `d8`, links resources/assets with
   `aapt2`, signs with a local debug key,
5. runs `apksigner verify` and prints `aapt2 dump badging`.

`ABI=x86_64` builds an emulator variant (the script and Rust target config
support it); the delivered APK is `arm64-v8a`, matching the real release target.

## Host smoke test

The same Rust code path (without JNI) can be run on the host:

```sh
cd .scratch/spine-cover-art-prototype/v8-android
ORT_DYLIB_PATH=/path/to/libonnxruntime.so ./scripts/host-smoke.sh \
  assets/covers/gatsby.jpg "The Great Gatsby" "F. Scott Fitzgerald" 180
```

## Install / run (when a device exists)

```sh
adb install -r out/v8-spine-test-arm64-v8a.apk
adb shell am start -n app.pocketlibrary.spinetest/.MainActivity
adb logcat -s v8android
```

In the app: choose a bundled sample, **Pick image from device**, or paste a
cover URL and **Fetch cover URL**; edit title/author/pages; press
**Generate spine on device**. The route, verdict, model-load time, pipeline
time, peak RSS and first-run model-unpack time are displayed, along with the
52×236 spine, the 2× preview, the typographic fallback and the contact sheet.
**Export** copies `spine-2x.jpg` and `run.json` to
`Downloads/PocketLibrarySpines`.

See [REPORT.md](REPORT.md) for measured results, blockers and the exact
on-device gap, and [TESTING.md](TESTING.md) for the step-by-step device test,
capture commands and acceptance checklist.
