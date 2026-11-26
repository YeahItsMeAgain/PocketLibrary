# v8-android — build and verification report

**Date:** 2026-11-26
**Scope:** `.scratch/spine-cover-art-prototype/v8-android/` only.
**Not modified:** `../v8-app/` (read-only source/models), the production app, shared
dock/review/reproducibility pages. No commit or release.
**Hosted copy:** `../v8-test/v8-spine-test-arm64-v8a.apk` is byte-identical
(SHA-256 below); it was not changed.

---

## 1. Bottom line

A real debug-signed **arm64 Android APK** exists and packages the complete
v8-app Rust pipeline, PP-OCRv3 models, fonts and ONNX Runtime. The app accepts a
bundled cover, a device image, or a cover URL, runs the pipeline on-device, and
renders/export the 52 × 236 spine plus fallback and contact sheet.

- **APK:** `out/v8-spine-test-arm64-v8a.apk`
- **Size:** 19,698,712 bytes (18.8 MiB; `du` 19 MB)
- **SHA-256:** `24bb847deea6360a7965091d3802fa44a3f0a5c5f739f7d66e707f667c5d88d3`
- **Package:** `app.pocketlibrary.spinetest`, minSdk 26, targetSdk 36,
  arm64-v8a, APK Signature Scheme v2 + v3, zipalign OK.
- **Ran on-device:** **No.** No adb device, no emulator binary/AVD/system image,
  no `/dev/kvm`, no Waydroid/Anbox. `adb install` returns
  `adb: no devices/emulators found`. Details in §5.
- **Strict-reproducibility status:** still **pending device proof**. The host
  proof below is necessary but not sufficient for the strict claim.

Re-checked after the power interruption: the APK SHA-256 is unchanged, the
hosted `../v8-test/` copy is byte-identical, host result JSON/spines are intact,
and the build/package checks were re-run (`out/zipalign-check.txt`,
`out/native-check.txt`, `out/hosted-copy.txt`).

---

## 2. What was built

A minimal native Android shell rather than a Tauri copy:

| Part | File / source |
|---|---|
| Activity, inputs, rendering, export | `android/java/app/pocketlibrary/spinetest/MainActivity.java` |
| JNI bridge + guarded pipeline call | `rust/src/lib.rs` |
| Read-only pipeline | `../v8-app/src/**` (path dependency in `rust/Cargo.toml`) |
| Text detector | `../v8-app/models/det.onnx` (2,432,880 B) |
| Text recogniser / QA | `../v8-app/models/rec.onnx` (10,690,752 B) + `keys.txt` (26,250 B) |
| Fonts | embedded by `v8-app` (`assets/fonts/DejaVuSerif*.ttf`) |
| ONNX Runtime | official `onnxruntime-android` 1.20.0 AAR, `arm64-v8a` CPU EP (17,571,160 B) |
| Rust bridge | `libv8android.so` (2,463,784 B, NDK r28c, Android 26, stripped) |

Flow: Java copies the three model assets out of the APK on first run, sets
`ORT_DYLIB_PATH` to the extracted `libonnxruntime.so`, calls
`nativeRun(cover, modelsDir, outDir, dylib, title, author, pages)`, and renders
the files the pipeline writes. Every cover is processed from pixels; the bundled
samples are convenience inputs, not a per-book lookup.

The UI exposes: sample spinner, system file picker, cover-URL fetcher,
title/author/pages fields, Generate, progress, source/spine/2×/fallback/contact
sheet previews, route/verdict/timing/RSS text, and Export to
`Downloads/PocketLibrarySpines` via MediaStore.

LaMa is **not** packaged (208 MB checkpoint). Covers that cannot avoid text via
a text-free crop take the flat-fill route and can honestly return
`review`/`fallback`; the UI says so.

---

## 3. Build

```sh
cd .scratch/spine-cover-art-prototype/v8-android
JAVA_HOME=$HOME/tools/jdk-21 ./scripts/build-apk.sh
```

Toolchain: Android SDK platform 36, build-tools 36.0.0, NDK 28.2.13676358,
JDK 21, Rust `aarch64-linux-android`, ORT AAR 1.20.0.

Steps: copy models/covers into assets → extract ORT `.so` from the AAR →
`cargo build --release --target aarch64-linux-android` → `javac --release 17` →
`d8 --min-api 26` → `aapt2 link` (assets incl. 13.1 MB models) → add
`classes.dex` + `lib/arm64-v8a/*.so` → `zipalign -p 4` → `apksigner` with a
local debug key. `ABI=x86_64` is supported by the script for a future emulator
run; the delivered APK is arm64 to match the real release target.

`javac.log` and `aapt2-link.log` are empty: the build emitted no Java or aapt2
diagnostics. No compile warnings remain in the Rust bridge.

---

## 4. Verification performed (host)

These checks establish packaging/signature/ABI correctness and that the same
Rust pipeline works end-to-end. They do **not** execute the APK.

| Check | Result | Artifact |
|---|---|---|
| apksigner | v2 `true`, v3 `true`, 1 signer | `out/apksigner-verify.txt` |
| aapt2 badging | launcher `MainActivity`, minSdk 26, target 36, `native-code: arm64-v8a` | `out/badging.txt` |
| zipalign | `-c -p 4` OK | `out/zipalign-check.txt` |
| APK contents | dex, 2 native libs, 3 model assets, covers | `out/apk-contents.txt` |
| JNI symbols | `Java_..._nativeRun`, `Java_..._nativeVersion` exported | `out/native-check.txt` |
| DEX calls | `loadLibrary("v8android")`, native method descriptors present | `out/native-check.txt` + dexdump |
| ELF | arm64, Android 26, NEEDED only `libdl/libm/libc` (ORT adds `liblog`) | `out/native-check.txt` |
| 16 KB pages | both `.so` LOAD segments aligned `0x4000` | `out/native-check.txt` |
| Hosted copy | byte-identical to `../v8-test/` APK | `out/hosted-copy.txt` |

### Host end-to-end smoke

Same pipeline code via `rust/src/bin/hostrun.rs`; host `libonnxruntime.so`
1.32.0, x86_64. Timings are host, not phone, and must not be presented as
device latency.

| Cover | Source | Route | Verdict | Load | Pipeline | Peak RSS |
|---|---|---|---|---|---|---|
| The Great Gatsby | Open Library 9780743273565 | text-free crop | **pass** | 0.24 s | 2.77 s | 270 MiB |
| Pride and Prejudice | Open Library 9780141439518 | text-free crop | **pass** | 0.27 s | 2.44 s | 272 MiB |
| Dune | Open Library 9780441172719 | text-free crop | **pass** | 0.34 s | 2.68 s | 306 MiB |
| Rock Paper Scissors | v8-app RPS cover | inpaint (flat) | **review** | 0.25 s | 5.75 s | 457 MiB |

RPS review reason: `40-55% of the cover was reconstructed`; LaMa absent, so this
is expected. No sample produced `fallback`; that route remains available in the
pipeline and is rendered by the UI, but was not observed in this proof set.

Every run wrote `spine.jpg` (52×236), `spine-2x.jpg`, `fallback-spine.jpg`,
`compare.jpg`, `run.json` and `qa.json`; see `out/host-*/`.

---

## 5. On-device execution: blocker

Checked 2026-11-26 (`out/device-check.txt`):

```
$ adb devices -l
List of devices attached            # empty

$ adb install -r out/v8-spine-test-arm64-v8a.apk
adb: no devices/emulators found

$ ls ~/Android/Sdk/emulator
No such file or directory
$ ls ~/.android/avd
No such file or directory
$ ls ~/Android/Sdk/system-images
No such file or directory
$ ls -l /dev/kvm
No such file or directory
$ which waydroid anbox
# nothing
```

The host is x86_64 with no KVM. Installing the emulator would require a system
image download and, without `/dev/kvm`, would not provide a practical or
representative arm64 run. No device was attached over USB/TCP.

**Consequently these are not measured:** Android startup, first-run model
extraction, JNI/ORT `.so` loading on device, arm64 inference latency, Android
peak RSS/OOM behaviour, UI rendering/screenshots, MediaStore export, and a
proof that a random *downloaded* cover completes on the phone. The strict rubric
therefore remains **pending**, not satisfied.

### Suggested arm64 latency expectation (not a measurement)

Host pipeline is 2.4–5.8 s. A mid-range arm64 phone with four big cores is
plausibly ~2–5× slower for ONNX inference, i.e. roughly 5–30 s per cover, with
the 457 MiB inpaint peak potentially tighter on 3 GB devices. This is an
estimate only; the device run must replace it with measured values.

---

## 6. Remaining before shippable

1. **One real device run** (arm64, Android 8+): install, fetch a random cover URL,
   generate, export, capture screenshot + `adb logcat -s v8android` + exported
   `run.json`. This is the blocker for the strict claim. Checklist in
   [TESTING.md](TESTING.md).
2. **Measure and bound latency/memory on arm64**, especially the inpaint/review
   path. Test a 3 GB device; current harness uses `largeHeap=true`.
3. **Decide on LaMa**: without it, text-heavy covers return `review`/`fallback`
   by design. Packaging it adds ~208 MB and significant latency; a quantized or
   smaller inpainting model is the realistic path.
4. **APK size**: 18.8 MiB is dominated by ORT (17.6 MB uncompressed) and models
   (13.1 MB). Options: download models on first run, quantize `rec.onnx`, ship an
   ABI/feature-reduced ORT, or use an App Bundle/ABI splits.
5. **Production integration**: this is a standalone debug harness. A shipping
   app needs a Tauri mobile plugin/command, cache/lifecycle handling, progress
   cancellation, error surfaces, and release signing. The Activity currently
   keeps run state in memory.
6. **Device coverage**: verify Android 15/16 16 KB-page devices (ELF alignment is
   already 16 KB) and low-RAM behaviour. Only arm64-v8a is packaged.
7. **Licensing/model provenance**: confirm redistribution terms for PP-OCRv3
   weights and DejaVu fonts in the app distribution (the desktop prototype does
   not settle this).

---

## 7. Human tester quick start

```sh
# verify what you downloaded
sha256sum v8-spine-test-arm64-v8a.apk
# 24bb847deea6360a7965091d3802fa44a3f0a5c5f739f7d66e707f667c5d88d3

adb install -r v8-spine-test-arm64-v8a.apk
adb logcat -c
adb shell am start -n app.pocketlibrary.spinetest/.MainActivity
# in app: paste a cover URL, Fetch, Generate; then Export
adb logcat -d -s v8android > logcat.txt
adb shell ls /sdcard/Download/PocketLibrarySpines
adb pull /sdcard/Download/PocketLibrarySpines ./exported
```

Full checklist: [TESTING.md](TESTING.md).

---

## 8. Proof artifacts

See `out/proof-index.txt` for the annotated list. Highlights:

- `out/v8-spine-test-arm64-v8a.apk` — signed APK
- `out/verification.json` — machine-readable APK/host/device summary
- `out/apksigner-verify.txt`, `out/badging.txt`, `out/zipalign-check.txt`,
  `out/native-check.txt`, `out/apk-contents.txt`
- `out/device-check.txt` — exact adb/emulator/KVM output
- `out/host-*/result.json`, `out/host-*/time.txt`,
  `out/host-*/<slug>/spine.jpg`, `spine-2x.jpg`, `fallback-spine.jpg`,
  `compare.jpg`, `run.json`

Boundaries: no shared dock/review/reproducibility page was touched, no
production code changed, `../v8-app/` was only read, and nothing was committed
or released.
