# 08 — Build toolchain, signing, and verification

Type: task
Mode: AFK
Status: resolved
Blocked by:

## Question

Stand up the headless build and verification pipeline, and prove it.

Install JDK 21, Android cmdline-tools, SDK platform 37 (or 36 with an override), build-tools 36.0.0, NDK 28.2.13676358, and the aarch64 Rust target. Scaffold the Tauri v2 app with the verified version set (Tauri 2.12.7 / CLI 2.12.6, AGP 9.5.2, Gradle 9.9.2), and produce a debug APK via `tauri android build --apk --target aarch64 --ci`. Generate a release keystore and document signing. Set up the Playwright harness at a phone viewport and the per-merge checks (web tests, `cargo test`, `cargo clippy`, `tsc --noEmit`, APK build). Document the exact commands in the repo.

Resolved when an installable APK exists at a known path, `apksigner verify` passes, and a fresh session can reproduce the build from the docs.

## Answer

Resolved 2026-11-24. Full instructions: `docs/build.md`; env exports:
`scripts/android-env.sh`.

**Toolchain (verified)**

- JDK: Temurin 21.0.9+10 (`$HOME/tools/jdk-21`).
- Android SDK (`$HOME/Android/Sdk`): `platforms;android-36`, `build-tools;36.0.0`,
  `platform-tools` 37.0.3, `ndk;28.2.13676358`. `platforms;android-37` is not
  offered by this sdkmanager (install fails), so 36 was installed and the
  generated `src-tauri/gen/android/app/build.gradle.kts` was edited from
  `compileSdk/targetSdk = 37` to `36`; `minSdk` stayed 24.
- Rust 1.99.0; `aarch64-linux-android` added (init also added armv7/i686/x86_64).
- Tauri CLI 2.12.6, Tauri crate 2.12.7, tauri-plugin-opener 2.7.3.
- Generated Gradle wrapper 9.6.1, AGP 9.3.1, Kotlin 2.2.10 — newer than the
  research note's 9.9.2/9.5.2 because `tauri init` emits the current template.

**APK (green)**

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

- 135,251,177 bytes (129 MiB; debug keeps Rust symbols).
- SHA-256 `730fbed116cafd5c636ebcf9054a057fd5d2850efcbd42816c0c1840ec07692e`.
- `aapt2 dump badging`: `app.pocketlibrary`, versionCode 1000/versionName 0.1.0,
  minSdk 24, targetSdk 36, `native-code: arm64-v8a`.
- `apksigner verify --print-certs`: PASS. `CN=Android Debug`, SHA-256
  `c9612c660f5ea8abeb58d2e9b335edc7951e0513f79d4758c4a1171782d86691`.

**Signing**

- Keystore: `$HOME/.android-keys/pocketlibrary-release.jks` (PKCS12, RSA 4096,
  alias `pocketlibrary`, 10,000 days, mode 600).
- Random password: `$HOME/.android-keys/pocketlibrary.pass` (mode 600). Neither
  file is in the repo. Gradle-wiring and manual `zipalign`/`apksigner` paths are
  documented in `docs/build.md`. No release APK was built yet.

**Playwright**

- `@playwright/test` 1.65.1, Chromium 159.0.8154.6 installed.
- `npm run test:e2e`: 1 passed (390x844, DPR 3, touch; Vite dev server on 1420).
  Reports/screenshots are gitignored.

**Verification commands**

```bash
source scripts/android-env.sh
APK=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$APK"
"$ANDROID_HOME/build-tools/36.0.0/aapt2" dump badging "$APK"
sha256sum "$APK"
```

**Deviations / risks**

- SDK 36 override lives in the generated `gen/android` tree; re-apply it after
  any `tauri android init` regeneration.
- Fixed a pre-existing scaffold rename mismatch: `src-tauri/src/main.rs` called
  `pocketlibrary_lib` while `Cargo.toml` names the lib
  `pocketlibrary_scaffold_lib`; the bin now calls the real lib name. The Android
  lib/artifact name is unchanged.
- Host `cargo test`/`cargo clippy` cannot build here: desktop Tauri's
  `glib-2.0`/WebKit dev libraries are absent and there is no sudo. Android-target
  clippy passes: `cargo clippy --target aarch64-linux-android --all-targets -- -D warnings`.
  Host tests remain a gap for a workstation with Tauri desktop prerequisites.
- No emulator/device (`/dev/kvm` absent), so runtime launch/UX is unverified;
  Playwright covers the web layer and the APK is verified structurally.
