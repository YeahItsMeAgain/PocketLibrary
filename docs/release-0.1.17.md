# PocketLibrary 0.1.17 release notes

Android-only, arm64-v8a, package `app.pocketlibrary`, version `0.1.17`
(versionCode `1017`), Android 8.0+ (API 24, targets API 36).

0.1.17 is a maintenance release from the CI-green source after 0.1.16. The
shelf presentation is unchanged: Art still runs to the top edge with the full
author over two lines in a 27% foot band, Cloth keeps its woven board and
Typography keeps the flat two-tone board. Signing is unchanged, so this
installs over 0.1.x.

## What changed

- The real-generation Rust tests now skip when ONNX Runtime is absent, instead
  of aborting while loading `libonnxruntime.so`. A clean CI checkout has the
  checked-in model files but not the host runtime, which made the 0.1.16
  commit fail CI in the core test stage.
- The skip is explicit and only covers the real-engine route. When
  `ORT_DYLIB_PATH` or a known host library is present, the full generation →
  cache → shelf projection path still runs.
- No app behaviour, database schema, spine rendering or APK contents changed
  from 0.1.16. This build exists to publish a release from a commit whose CI
  is green.

## Verification

| Check | Result |
|---|---|
| Fast gate (`./scripts/check.sh`) | 93 passed |
| `npx tsc --noEmit`, `npm run build` | pass |
| Contract check | pass |
| `aapt2 dump badging` | 0.1.17, code 1017 |

APK: `PocketLibrary-0.1.17.apk` · 68,122,525 bytes · SHA-256
`5b39307d6ceb56f9c47e7999beef516c35240af73538b9b40faaf7b9e4e977cd`.
