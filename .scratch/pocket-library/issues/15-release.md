# 15: Release

**What to build:** A signed, versioned, recognisable release build that can be installed over the previous one, with a repeatable build and a final device smoke test.

**Blocked by:** 08, 11, 12, 13, 14

**Status:** awaiting-device-test

- [x] App name, icon, splash, and version are settled and applied
- [x] A release APK is signed with the generated keystore without secrets entering the repo
- [ ] The release APK installs over the previous build and preserves library data
- [ ] Device smoke passes: launch, scan a real folder, read an EPUB and a PDF, acquire a book, export and import a backup
- [x] `apksigner verify` passes and the APK size is recorded
- [ ] The build is reproducible from the committed docs on a fresh machine

Note: branding assets committed under `assets/branding/` and generated into `src-tauri/icons` + Android mipmaps.

## v0.1.0 verification (2026-11-25)

- **Identity.** Name `PocketLibrary`, package `app.pocketlibrary`, version `0.1.0`, versionCode `1000` (Tauri derives `minor*1000 + patch`), minSdk 24, targetSdk 36, arm64-v8a. Dark-purple launcher PNGs and the adaptive background `#150E16` are committed; the unused default green/robot drawables were removed. The window background and the Android 12+ splash use the aubergine colour with the logo foreground.
- **Signing.** `source scripts/android-env.sh` found `$HOME/.android-keys/pocketlibrary-release.jks`; the build produced a release APK signed `CN=PocketLibrary, O=Personal, C=US`. No secret entered the repo.
- **APK.** `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, **35,122,454 bytes**, SHA-256 `bea72ea0d874f0766e0bb22757e1a322282db6c2a3d1caf3aa215a641c60ea9a`, cert SHA-256 `f2167c3918933cd2fe247fb5748e7b699f925d8f6f716eec04da9f862d1dcbdb`. `aapt2` reports package `app.pocketlibrary`, versionCode `1000`, versionName `0.1.0`, SDK 24/36. The published path returned HTTP 200.
- **Checks.** `cargo test --manifest-path core/Cargo.toml` pass; `npm run test:e2e` 73 pass; `npm run build` pass; `npx tsc --noEmit` pass; Android clippy `--all-targets -- -D warnings` pass.
- **Benchmark.** `PERF_LABEL=release-0.1.0 node perf/bench.mjs`: first shelf 481.3 ms (miss), scroll warm p95/p99 18.3/22.1 ms (pass), 2 load-only long tasks (miss), DOM 11.3 MB/1,807 nodes (pass), filter 36 ms sync (pass), lift 0/6.5 ms (pass). Raw in `perf/results/release-0.1.0.json`; report in `docs/perf-shelf-benchmark.md`.
- **Docs.** `README.md` and `docs/release-0.1.0.md` added. Local annotated tag `v0.1.0`; nothing pushed.

## Remaining before done

- Install the signed APK over the previous build without uninstalling; confirm the folder grant, shelves, labels, reading positions and annotations survive.
- Device smoke: launch, scan a real folder, read a real SAF-backed EPUB and PDF, run a search/download, export and import a backup, and check Android back through sheets and the reader.
- Re-run the 2,000-book device performance checks (`dumpsys meminfo`, real WebView first paint, fling and touch drag/filter).

## Known gaps carried into 0.1.0

- First paint misses the 400 ms proxy budget (481.3 ms); load-only long tasks remain. Scroll/filter/drag budgets pass.
- External-reader cancel can mark a book reading on resume because Android does not expose the chosen app.
- PDFs are transported whole and capped at 100 MB; a 90 MB file can still spike memory.
- Annotations are EPUB-only; PDF has no highlight/note UI.
