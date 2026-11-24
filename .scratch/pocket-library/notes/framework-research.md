# Framework research: building a polished Android APK headlessly (2026-11-24)

**Question:** best way to build and ship a polished, animation-heavy Android APK entirely from this headless Linux box, developed mostly by an AI coding agent.

**Status labels used below**

- **[V]** verified against a primary source (official docs, source code, release metadata) on 2026-11-24.
- **[I]** inference or estimate from the verified facts; not directly tested on this machine.
- **Box state** was probed directly: Debian 13, kernel 6.12, 6 cores, 24 GB RAM, 111 GB free, rustc/cargo 1.99.0, node 24.21.0, npm 11.19.0. No `java`, `gradle`, `adb`, `sdkmanager`, `flutter`, `dart`. No `/dev/kvm` per the brief.

---

## TL;DR

**Recommendation: Tauri v2 for Android, with the UI as a plain web app (Vite + React/Svelte), `epub.js` for EPUB, `pdf.js` for PDF, and `tauri-plugin-android-fs` for Android Storage Access Framework (SAF).**

Why:

1. The visual centre of this app is a CSS-3D/WebGL bookshelf and a page-flip. The web platform is the strongest and fastest-moving tool for exactly that, and the same UI can be iterated in headless Chromium on the server with screenshots before ever building an APK. [I]
2. Tauri's Android build is a real CLI build: `tauri android init` generates a Gradle project, `tauri android build` produces an APK/AAB with no Android Studio, no emulator, no display, and no device. The CLI's own build code never touches `adb`; only `android dev`/`run` need a device. **[V]** ([Tauri CLI](https://v2.tauri.app/reference/cli/#android-build), [build.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/android/build.rs))
3. Rust gives a clean backend for EPUB/PDF parsing, Libgen HTTP, metadata, and SQLite, while the UI stays in the web layer. **[I]**
4. This box is comfortably above Tauri's requirements (6 cores / 24 GB / 111 GB). The blocker is *runtime verification*, not building. **[I]**

**Do not** choose Flutter or Compose if the bookshelf is genuinely a 3D/animated showcase: they can do it, but you will spend the animation budget re-implementing 3D transforms, text layout, and page-flip physics that CSS/WebGL already gives you. **[I]**

**De-risking move:** keep all product logic and UI in the web layer behind a thin `Platform` adapter (`pickLibraryFolder`, `readFile`, `http`, `secureStore`). Then Tauri and Capacitor are interchangeable shells: if the Tauri Android storage/build story fights you, porting the shell to Capacitor is days, not weeks. **[I]**

---

## 1. Environment reality check and disk budget

### 1.1 What has to be installed (Tauri path)

| Component | Exact package / version | Download | On disk (est.) | Source |
|---|---|---|---|---|
| JDK | Debian `openjdk-21-jdk-headless`, or Temurin `21.0.9+10` | 207 MB (Temurin tgz) | 300–350 MB | [Temurin asset, HEAD](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10/OpenJDK21U-jdk_x64_linux_hotspot_21.0.9_10.tar.gz) **[V]** |
| Android cmdline-tools | `commandlinetools-linux-15859902_latest.zip` | 181.8 MB | ~400 MB | [Android Studio download page](https://developer.android.com/studio#command-line-tools-only) **[V]** |
| SDK platform | `platforms;android-37` (Tauri 2.12 template compile/target SDK) | ~60 MB | ~120 MB | [Tauri template](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/app/build.gradle.kts) **[V]** |
| Build tools | `build-tools;36.0.0` (AGP 9.5 default/minimum) | ~60 MB | ~120 MB | [AGP 9.5 compatibility](https://developer.android.com/build/releases/gradle-plugin) **[V]** |
| Platform tools | `platform-tools` (adb 37.0.0) | 9.6 MB | ~25 MB | [SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) / HEAD **[V]** |
| NDK | `ndk;28.2.13676358` (AGP 9.5 default) — or `ndk;30.0.16248370` LTS | 739 MB (r30 zip) | 2.5–3.0 GB | [NDK downloads](https://developer.android.com/ndk/downloads), [AGP 9.5](https://developer.android.com/build/releases/gradle-plugin) **[V]** |
| Gradle | generated wrapper `gradle-9.9.2-bin.zip` (do not install globally) | 135 MB | ~250 MB dist + 0.5–1 GB cache | [Tauri wrapper](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/gradle/wrapper/gradle-wrapper.properties) **[V]** |
| Rust Android target | `aarch64-linux-android` std | ~30 MB | ~100 MB | [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) **[V]** |
| Cargo build output | `src-tauri/target` for aarch64 release | — | 2–4 GB | **[I]** |

**Total, one ABI (arm64 phone): roughly 7–10 GB. All four ABIs: roughly 13–18 GB.** 111 GB free is ample. **[I]**

Versions that are known-current and mutually compatible as of this date:

- Tauri crate **2.12.7**, npm CLI **2.12.6** (npm/crate patch numbers need not match; the CLI warns on incompatible mismatches). **[V]** ([crates.io](https://crates.io/crates/tauri), [npm](https://registry.npmjs.org/@tauri-apps/cli/latest))
- Tauri's generated Android project pins **AGP 9.5.2**, **Kotlin 2.2.10**, **Gradle 9.9.2**, `compileSdk/targetSdk 37`, `minSdk 24`. **[V]** ([template build.gradle.kts](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/build.gradle.kts), [app build.gradle.kts](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/app/build.gradle.kts))
- AGP 9.5 requires **JDK 17+**, supports up to API 37, defaults to build-tools 36.0.0 and NDK 28.2.13676358. **[V]** ([AGP 9.5](https://developer.android.com/build/releases/gradle-plugin))
- Gradle 9.9.2 runs on **JDK 17–27**, so JDK 21 is a safe choice. **[V]** ([Gradle compatibility](https://docs.gradle.org/current/userguide/compatibility.html))
- Tauri mobile template adds `androidx.webkit:webkit:1.14.0`, `androidx.appcompat:1.7.1`, `androidx.activity:activity-ktx:1.10.1`, `material:1.12.0`, `lifecycle-process:2.10.0`. **[V]** (same template)

> **Budget the first build.** A cold `tauri android build` compiles Rust for the target, downloads Gradle + AGP + Kotlin artifacts, and runs AAPT2/D8. Expect **10–20 min for the first arm64 debug build** and **20–40 min for a four-ABI release** on 6 cores. Warm incremental release builds are much faster. **[I]**

### 1.2 Install commands (headless Debian, no Android Studio)

```bash
# 1. JDK (provides java, javac, keytool)
sudo apt-get update
sudo apt-get install -y openjdk-21-jdk-headless unzip curl
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

# 2. Android command-line tools
export ANDROID_HOME="$HOME/Android/Sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"
cd /tmp
curl -O https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
unzip -q commandlinetools-linux-15859902_latest.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

# 3. Licenses + packages (licenses must be accepted non-interactively)
yes | sdkmanager --licenses
sdkmanager --install \
  "platform-tools" \
  "platforms;android-37" \
  "build-tools;36.0.0" \
  "ndk;28.2.13676358"

# 4. Rust target (only the phone ABI; add x86_64 only if you ever get an emulator)
rustup target add aarch64-linux-android

# 5. NDK_HOME must point at the exact NDK directory
export NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
```

All commands are standard SDK-manager usage **[V]** ([sdkmanager](https://developer.android.com/tools/sdkmanager), [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)). If `platforms;android-37` is not yet offered by your `sdkmanager`, install `platforms;android-36` and override `compileSdk`/`targetSdk` to 36 in `src-tauri/gen/android/app/build.gradle.kts`; AGP 9.5 still supports API 36. **[I]**

### 1.3 Project bootstrap and Android build

```bash
npm create tauri-app@latest pocket-library   # choose TypeScript + your web framework
cd pocket-library
npm install
npm run tauri android init -- --ci            # generates src-tauri/gen/android, --ci = no prompts
npm run tauri android build -- --apk --target aarch64 --ci
# output: src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

- `--ci` exists on both `android init` and `android build` and suppresses prompts. **[V]** ([CLI reference](https://v2.tauri.app/reference/cli/#android-init))
- `--apk` avoids also producing an AAB; `--target aarch64` keeps the build to the phone ABI and cuts build time and APK size. **[V]** (same reference)
- Default output is under `src-tauri/gen/android/app/build/outputs/apk/...`; Tauri prints the exact path on success. **[V]** ([Tauri Android signing / CLI flow](https://v2.tauri.app/distribute/sign/android))
- A **debug** build (`--debug`) is signed with the SDK debug key and installs without any keystore setup. Use it for smoke tests; it is larger and slower. **[V]** ([Android command-line build docs](https://developer.android.com/build/building-cmdline))
- No display, X server, emulator, or device is required for `init`/`build`. `tauri android dev` and `android run` *do* require a device or emulator. **[V]** ([build.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/android/build.rs), [dev docs](https://v2.tauri.app/develop/))
- Independent confirmation that this works on a headless VM: a public agent build log using `npx tauri android init --ci` and `npx tauri android build --debug --target aarch64-linux-android` produced a valid APK. **[V, secondary]** ([TimeToBuildBob, 2026-04-28](https://timetobuildbob.com/blog/the-robot-that-compiled-the-android-apk/)); a headless Debian 13 Tauri setup is also documented with NDK 28.2. **[V, secondary]** ([Fran Gonzalez, 2026-09-30](https://frangonf.com/blog/managing-the-android-sdk-as-a-mise-dependency))

### 1.4 Tauri Android gotchas observed in the wild

- **Version lockstep.** `tauri-plugin-android-fs` 30.2.0 depends on `tauri ^2.12.0`; pin plugin + API package to the same minor (e.g. `=30.2.0`) and keep the Tauri crate/CLI current. A mismatch fails at build or runtime. **[V]** ([android-fs crate](https://crates.io/crates/tauri-plugin-android-fs), [JS API package](https://registry.npmjs.org/tauri-plugin-android-fs-api/latest), [plugin author's note on version pinning](https://zenn.dev/oka_yu/articles/d4517e0b6e159e))
- **NDK mismatch** produces cryptic `clang`/linker errors. Keep `NDK_HOME` exact and let AGP's default NDK (28.2.13676358) match. **[I]**
- **`keytool` missing**: Tauri docs tell you to use Android Studio's JBR; on a headless box install a JDK and point `JAVA_HOME` at it. Gradle needs a **JDK**, not a JRE (`JAVA_COMPILER` toolchain errors otherwise). **[V]** ([arkstage build doc](https://github.com/djkcyl/arkstage/blob/master/docs/android-build.md)) **[I]**
- **Build path with spaces/non-ASCII** and **stale `gen/android`** are common breakages; keep the repo at a plain path and regenerate `gen/android` after upgrading Tauri. **[I]**
- **Rust 1.99 is newer than Tauri's MSRV** (Tauri needs a recent stable; plugins state 1.77–1.90 minimums). Newer stable is normally fine; if a transitive crate breaks, pin a slightly older toolchain rather than fighting it. **[I]**

---

## 2. Android storage from Tauri (the real integration work)

### 2.1 What the official plugins do

**Dialog plugin** (`@tauri-apps/plugin-dialog`, Rust `tauri-plugin-dialog`): on Android it returns `content://` URIs and **does not support a folder picker** ("Does not support folder picker"). File picking works, but folder-tree access is unavailable. **[V]** ([Dialog plugin docs](https://v2.tauri.app/plugin/dialog/))

**FS plugin** (`@tauri-apps/plugin-fs`, Rust `tauri-plugin-fs`): on Android access is restricted to the app's own directory by default, and the docs say it works with `content://` URIs. However, writing to a `content://` URI obtained from `dialog.save()` is a **known open bug**: the Kotlin side calls `ParcelFileDescriptor.detachFd()`, the provider sees the close before bytes are written, and the document is recorded as 0 bytes (or is truly empty on Google Drive). The issue was still open on 2026-10-14 with plugin-fs 2.5.1, so do not assume the latest 2.7.1 fixed it. **[V]** ([plugin-fs docs](https://v2.tauri.app/plugin/file-system/), [issue #3356](https://github.com/tauri-apps/plugins-workspace/issues/3356))

**Implication:** for a library folder the user picks once and reuses, the official plugins are not enough. **[V]/[I]**

### 2.2 The mature community answer: `tauri-plugin-android-fs`

- Crate: **`tauri-plugin-android-fs = "=30.2.0"`** (2026-10-11), author aiueo13, MIT/Apache-2.0. **[V]** ([crates.io](https://crates.io/crates/tauri-plugin-android-fs))
- JS bindings: **`tauri-plugin-android-fs-api@30.2.0`**, must match the Rust crate exactly. **[V]** ([npm](https://registry.npmjs.org/tauri-plugin-android-fs-api/latest))
- APIs cover everything this app needs:
  - `Picker::pick_dir` → opens `ACTION_OPEN_DOCUMENT_TREE`, returns a **read-write directory URI**; app can fully manage entries below it. **[V]** ([Picker docs](https://docs.rs/tauri-plugin-android-fs/latest/tauri_plugin_android_fs/api/api_async/struct.Picker.html))
  - `Picker::persist_uri_permission(&uri)` → calls `takePersistableUriPermission`, survives app/device restarts. **[V]** (same docs)
  - `check_persisted_uri_permission`, `get_all_persisted_uri_permissions`, `release_persisted_uri_permission` for lifecycle management. **[V]** (same docs)
  - `read_dir`, `create_new_file`, `open_file_readable`, `open_file_writable`, metadata, MIME type, thumbnails. **[V]** (crate README, Picker/AndroidFs docs)
  - `PublicStorage` / `PrivateStorage` / `AppStorage` helpers, plus a `CustomFileProvider` for non-filesystem sources. **[V]** ([crate README](https://docs.rs/crate/tauri-plugin-android-fs/latest/source/README.md))
- The plugin is pure SAF by default and **does not add broad storage permissions**, which matters if you ever ship beyond personal sideloading. **[V]** (crate README)
- It still needs Kotlin **only inside the plugin**; you write Rust/TypeScript, not Kotlin. If you need a custom provider or a bespoke share/open intent, that is where Kotlin enters. **[V]/[I]**

Minimal Rust wiring:

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_android_fs::builder().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Directory flow (Rust or TS):

1. `pick_dir(None, false)` → user chooses `Books/` (or creates one).
2. `persist_uri_permission(&dir)` → store the URI string in your settings/SQLite.
3. On every launch: `check_persisted_uri_permission(&dir, Read/Write)`; if false, re-prompt (the folder may have been moved/deleted — Android does not keep the grant in that case). **[V]** ([SAF docs](https://developer.android.com/training/data-storage/shared/documents-files), [Picker docs](https://docs.rs/tauri-plugin-android-fs/latest/tauri_plugin_android_fs/api/api_async/struct.Picker.html))
4. `read_dir(&dir)` → list `.epub`/`.pdf`; `open_file_readable` or copy into app cache for `epub.js`/`pdf.js`.
5. For imports/downloads: `create_new_file(&dir, "PocketLibrary/book.epub", Some("application/epub+zip"))`, then write via `open_file_writable` (this keeps the Android `OutputStream` alive and avoids the official plugin's `detachFd` bug). **[V]/[I]**

### 2.3 SAF constraints that shape the UX

- `ACTION_OPEN_DOCUMENT_TREE` is available since Android 5.0 (API 21) but on Android 11+ the user **cannot** grant the root of internal storage, the root of a reliable SD card, or the `Download` directory. The user must pick a subfolder (e.g. `Documents/PocketLibrary`). Design onboarding around "Create/choose a library folder", not "pick your Downloads". **[V]** ([SAF docs](https://developer.android.com/training/data-storage/shared/documents-files))
- Persisted grants can be revoked by the user, by moving/deleting the folder, or by the provider. Always re-check on launch. **[V]** (same docs)
- `ACTION_OPEN_DOCUMENT_TREE` over a huge tree is slow; keep the library flat or index incrementally. **[V]** (same docs)
- `tauri-plugin-saf` is **not** a real, maintained Tauri package as of this date (no crates.io/npm result; GitHub search returns unrelated "safe-area" plugins). Do not plan around it. **[V]** (search results) 
- `sudosylabs/plugin-fs` / `@vnidrop/tauri-plugin-fs` exists and advertises Android SAF + persisted URI permissions, but has ~0 stars and is a one-person project; treat it as a fallback, not the default. **[V, weak]** ([repo](https://github.com/sudosylabs/plugin-fs))

---

## 3. Android WebView for this app

### 3.1 The engine

- Tauri uses the **system Android WebView**, which on virtually all production devices is Chromium-based and updatable through the Play Store. Tauri does **not** bundle a WebView; the rendered version depends on the device's selected provider. Some OEM images allow switching providers or ship an old one, so feature support is tied to that Chromium version. **[V]** ([Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/))
- Tauri's `minSdk` is **24 (Android 7.0)**. **[V]** ([Tauri config: `bundle.android.minSdkVersion` default 24](https://v2.tauri.app/reference/config/#androidconfig))
- Consequence: a *never-updated* Android 7 device can have a WebView from the Chrome 51–55 era, which predates WebGL2 (Chrome 56). Realistically the user's own phone is modern and WebView auto-updates, but ship a capability gate and a CSS-only fallback. **[I]**
- Minimum practical target: **WebView 100+ (Chromium 100+, 2022)** for comfortable `backdrop-filter`, `aspect-ratio`, container queries, and reliable `preserve-3d`. Detect with `navigator.userAgent` / feature tests rather than an OS-version check. **[I]**

### 3.2 CSS 3D and WebGL2

- `transform-style: preserve-3d` is Baseline "widely available". Critical gotcha for a bookshelf: **`overflow` other than `visible`/`clip`, `opacity < 1`, `filter`, `clip-path`, `mask`, `mix-blend-mode`, `isolation: isolate`, and paint containment all force the used value back to `flat`**, collapsing your 3D children into the parent plane. Do not put `overflow: hidden` or a fade `opacity` on the 3D stage; clip on an outer wrapper instead. **[V]** ([MDN transform-style](https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style))
- `WebGL2RenderingContext` is Baseline "widely available" and is the right baseline for three.js (modern three.js requires WebGL2). It gives you instanced draws (many book spines in one call), 3D textures, VAOs, and transform feedback. **[V]** ([MDN WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext))
- For this app: prefer **CSS 3D for the shelf and the cover-open/flip** (crisp text, easy styling, cheap to iterate), and **WebGL2 only for ambient effects** (dust motes, wood grain, lighting) or if you need true page curvature. Mixing both is normal.
- Performance caveat: System WebView runs in a separate Chromium process with higher baseline memory than native views; destroy/reuse WebViews carefully. A single full-screen WebView is exactly the intended use. **[V]** ([Android WebView docs](https://developer.android.com/guide/webapps/webview))
- Offscreen work (EPUB unzip, text layout, PDF page render) belongs in Web Workers; the page-flip must stay on the compositor (transform/opacity only). **[I]**

### 3.3 EPUB and PDF engines

- **`epub.js`**: latest release **v0.3.88, published 2020-07-01**. It still works and is the de-facto browser EPUB renderer, but it is effectively unmaintained. Plan to vendor it, pin it, and patch it yourself; budget a fallback (parse the EPUB container yourself with `fflate`/`JSZip` + render XHTML in an iframe, or evaluate an actively maintained reader such as Foliate's JS engine). **[V]** ([epub.js releases](https://github.com/futurepress/epub.js/releases))
- **`pdf.js`**: **v6.5.438, published 2026-11-01**, actively maintained, with a separate `legacy` build for older browsers. Use the legacy dist if you want the widest WebView range. This is the safest large dependency in the stack. **[V]** ([pdf.js releases](https://github.com/mozilla/pdf.js/releases))
- Both work in Android WebView because they are pure JS/WASM/canvas. `pdf.js` uses a worker + canvas; keep the worker file same-origin and bundled locally. **[I]**

---

## 4. Alternatives compared on "builds fully headless here" + animation + agent-friendliness

All setup-cost and disk numbers below are **estimates [I]**; the SDK/JDK requirements are verified.

| Framework | Headless APK build without Studio/device? | Exact requirements | Approx. setup | Disk | APK size (arm64) | Animation ceiling for a 3D bookshelf | Agent-friendliness |
|---|---|---|---|---|---|---|---|
| **Tauri v2** (recommended) | **Yes.** `tauri android init --ci` + `tauri android build --apk --target aarch64`; no adb/display/device. **[V]** | JDK 17+ (21 ok), cmdline-tools, platform 37 (or 36), build-tools 36.0.0, NDK 28.2, Rust target, Node. **[V]** | 45–90 min first time | 7–10 GB one ABI | ~8–15 MB | **5/5** — CSS 3D + WebGL2 + WAAPI, same as desktop browser | **4/5** — iterate UI in headless Chromium; Rust backend; one Kotlin/SAF plugin |
| **Capacitor 8** | **Yes, with caveats.** Docs say Android Studio is required, but `npx cap add android` + `./gradlew assembleRelease` works with cmdline SDK. **[V]/[I]** | Node 22+, JDK 17+, Android SDK API 24+; Android Studio 2025.2.1 is the documented requirement. **[V]** ([Capacitor env setup](https://capacitorjs.com/docs/getting-started/environment-setup)) | 30–45 min | 4–6 GB | ~5–10 MB | **5/5** — system WebView, identical CSS/WebGL | **4/5** — same web loop; weaker SAF plugin ecosystem |
| **Flutter 3.50.1** | **Yes.** `flutter build apk --release --target-platform android-arm64`; no device needed. **[V]** ([Flutter deploy](https://docs.flutter.dev/deployment/android)) | Flutter SDK (1.52 GB xz), JDK 17+, Android SDK API 36, build-tools, NDK. Android Studio is documented but only for the GUI flow. **[V]** ([Flutter Android setup](https://docs.flutter.dev/platform-integration/android/setup)) | 30–60 min | 7–10 GB | ~15–25 MB | **4/5** — Impeller is fast; 3D needs `Transform`/`Matrix4`, custom shaders, or a 3D engine | **2.5/5** — no DOM/CSS; widget/golden tests, but visual iteration needs a device or integration test |
| **Kotlin + Jetpack Compose** | **Yes.** `./gradlew assembleRelease`; no device needed. **[V]** ([Android CLI build](https://developer.android.com/build/building-cmdline)) | JDK 17+, AGP 9.5, Gradle 9.9, SDK 36/37, Kotlin 2.2/2.3. **[V]** | 30–60 min | 5–8 GB | ~10–20 MB | **3.5/5** — Compose animation is excellent, but a physical book-flip is custom Canvas work | **3/5** — new [Android CLI](https://developer.android.com/tools/agents/android-cli) can render Compose previews headlessly; Kotlin compile cycles are slower |
| **React Native 0.88 / Expo** | **Yes locally via Gradle**, or **cloud via EAS** with no local SDK. `eas build --local` itself still needs SDK+NDK. **[V]** ([Expo local builds](https://docs.expo.dev/build-reference/local-builds/), [RN setup](https://reactnative.dev/docs/set-up-your-environment)) | JDK 17, Android SDK, NDK; RN docs assume Android Studio. Expo cloud needs an account and uploads code. **[V]** | 45–120 min (local) | 6–10 GB | ~25–60 MB | **4/5** — Reanimated 4 + Skia; 3D shelf is custom Skia/GL | **2.5/5** — heavy native build, JS bundling, more moving parts |

**Verdict:** Tauri and Capacitor are the only two where the animation-heavy UI is *already solved by the platform*. Tauri wins on backend capability and the user's stated preference; Capacitor is the lower-ceremony fallback. Flutter/Compose/RN are all technically capable of shipping headlessly but spend the scarce "polish" budget on re-implementing web-platform primitives. **[I]**

---

## 5. Testing without a device or KVM

### 5.1 The local emulator is effectively out

- The Android Emulator requires a hypervisor. On Linux that is KVM; the official docs say VM acceleration cannot run inside another VM and requires `/dev/kvm`. **[V]** ([Emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration))
- Software emulation exists: `-accel off` "disables acceleration and uses software emulation. This mode is **not supported and is very slow**. To use it, set `ANDROID_I_WANT_MY_TCG=yes`." **[V]** ([Emulator command-line options](https://developer.android.com/studio/run/emulator-commandline))
- ARM images on an x86 host cannot use VM acceleration at all. **[V]** (same acceleration page)
- **Verdict:** a TCG emulator can boot and install an APK, but it is not a usable animation/perf test bed; even a simple app can take minutes to become interactive. Use it only as a last-resort "does it crash at launch" check, not for polish. **[I]**

### 5.2 What actually works, in order of value

1. **Headless Chromium (Playwright) for the web layer.** Run the exact UI at a phone viewport (`390×844`, DPR 3, touch), with mocked `invoke` calls, and capture screenshots/video. This is where 90% of the animation and layout work should be validated. It is fast, deterministic, and CI-friendly. **[I]** (standard practice; Playwright device emulation docs: <https://playwright.dev/docs/emulation>)
2. **The user's phone over `adb` wireless debugging.** Android 11+ supports pairing without USB: enable Wireless debugging, "Pair using pairing code", then on the server `adb pair <ip>:<port>` and `adb connect <ip>:<port>`. This gives `adb install -r`, `adb logcat`, `adb shell screencap`, `adb exec-out screenrecord`, and Chrome `chrome://inspect` for the WebView. Requires the server and phone on the same network (a Tailscale/WireGuard subnet works if routing allows; mDNS auto-discovery may not). **[V]** ([adb wireless debugging](https://developer.android.com/tools/adb#wireless-android11-command-line)); Tailscale nuance **[I]**
3. **Firebase Test Lab Robo test.** Upload the APK and let Robo crawl the UI on real devices; you get screenshots, video, crash/ANR logs, and a test matrix. No test code required. Spark (free) quota: **10 virtual + 5 physical test runs per day**, with a 45-minute limit per physical run and 60 minutes per virtual run. Drive it headlessly with `gcloud firebase test android run`. **[V]** ([Test Lab get started](https://firebase.google.com/docs/test-lab/android/get-started), [quotas/pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing))
4. **Android CLI (new, 2026).** Google now ships an agent-first CLI that can create/build/install/run, capture and interact with device screens, render Compose previews headlessly, and analyze APKs: `android run`, `android screen capture`, `android preview`, `android analyze`. It still needs a connected device/emulator for run/screen, but it is a strong companion for an agent-driven workflow. **[V]** ([Android CLI](https://developer.android.com/tools/agents/android-cli))
5. **Android Device Streaming** (cloud real devices): 30 free minutes per project per month on Spark, then $0.15/min. Mostly Android Studio-oriented; useful only if you need a specific OEM device. **[V]** ([Test Lab quotas](https://firebase.google.com/docs/test-lab/usage-quotas-pricing))
6. **Static/unit checks that need no device:** `cargo test`, `cargo clippy`, Vitest/Playwright, `aapt2 dump badging app.apk`, `apkanalyzer manifest print`, `apksigner verify`, and a launch smoke test in the TCG emulator if desperate. **[I]**

### 5.3 Suggested verification ladder

- Every commit: web unit tests + Playwright screenshots at phone viewport; `cargo test`; `tsc --noEmit`.
- Every merge: `tauri android build --debug --target aarch64` (proves the Android shell still compiles).
- Every release: signed arm64 APK → `apksigner verify` → user's phone via `adb install -r` and a 2-minute manual pass → optional Firebase Robo run for crash/ANR coverage. **[I]**

---

## 6. Signing and sideloading

### 6.1 Generate the keystore headlessly

`keytool` ships with the JDK:

```bash
mkdir -p ~/.android-keys
keytool -genkeypair -v \
  -keystore ~/.android-keys/pocketlibrary-release.jks \
  -storetype PKCS12 \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -alias pocketlibrary \
  -dname "CN=PocketLibrary, O=Personal, C=US" \
  -storepass "$KEYSTORE_PASS" -keypass "$KEYSTORE_PASS"
```

This is the official mechanism; `-storetype PKCS12` is the JDK 9+ default and avoids legacy JKS quirks. **[V]** ([Android signing from CLI](https://developer.android.com/build/building-cmdline#sign_cmdline), [Tauri Android signing](https://v2.tauri.app/distribute/sign/android))

### 6.2 Wire it into Tauri's Gradle project

Create `src-tauri/gen/android/keystore.properties` (never commit it):

```properties
storeFile=$HOME/.android-keys/pocketlibrary-release.jks
storePassword=...
keyAlias=pocketlibrary
keyPassword=...
```

Then add a `signingConfigs { create("release") { ... } }` block and point the `release` build type at it in `src-tauri/gen/android/app/build.gradle.kts`. Tauri documents the exact Kotlin DSL snippet. **[V]** ([Tauri Android signing](https://v2.tauri.app/distribute/sign/android))

Rebuild:

```bash
npm run tauri android build -- --apk --target aarch64 --ci
# signed APK: src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Alternative if you prefer not to edit Gradle: build unsigned and sign manually with the SDK tools:

```bash
$ANDROID_HOME/build-tools/36.0.0/zipalign -v -p 4 app-universal-release-unsigned.apk aligned.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner sign \
  --ks ~/.android-keys/pocketlibrary-release.jks \
  --ks-key-alias pocketlibrary --out app-release-signed.apk aligned.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs app-release-signed.apk
```

This is the documented manual path. **[V]** ([Android CLI signing](https://developer.android.com/build/building-cmdline#sign_cmdline))

### 6.3 Install on the phone

- **ADB:** `adb install -r app-universal-release.apk` (over USB or wireless debugging). If the signing key changed, uninstall first: `adb uninstall com.example.pocketlibrary`. **[V/I]**
- **Manual:** copy the APK (scp, Syncthing, email, cloud), tap it, and allow "Install unknown apps" for the file manager/browser. Personal sideloading needs no Play Store account. **[I]**
- **Version codes:** Android refuses to install an APK with a `versionCode` ≤ the installed one. Tauri derives it from semver (`major*1_000_000 + minor*1_000 + patch`), so bump the app version for every build you install, or set `bundle.android.versionCode` explicitly. **[V]** ([Tauri config](https://v2.tauri.app/reference/config/#androidconfig))
- Android 17 adds optional post-quantum v3.2 APK signing; irrelevant for personal sideloading today, but keep `build-tools` current if you ever rotate keys. **[V]** ([Flutter deploy notes](https://docs.flutter.dev/deployment/android))

---

## 7. Recommendation table

| Rank | Stack | Why it fits this project | Main cost |
|---|---|---|---|
| **1** | **Tauri v2 + web UI + `tauri-plugin-android-fs`** | Best animation ceiling (CSS 3D/WebGL2), Rust backend for EPUB/PDF/Libgen, fully headless CLI build, aligns with user preference, tiny APK, one codebase also gives a desktop build for fast iteration | ~1.5 h toolchain setup, 7–10 GB disk, 10–20 min cold builds, one community plugin for SAF |
| **2** | **Capacitor 8 + same web UI** | Same UI/animation benefits with a much smaller toolchain; easiest fallback if Tauri's Rust/NDK build becomes a time sink | Weaker SAF/plugin ecosystem; no Rust backend; docs still say Android Studio |
| **3** | **Flutter 3.50** | Excellent animation runtime and a true native app; headless `flutter build apk` works | 3D bookshelf/page-flip must be built by hand; harder for an agent to iterate visually |
| **4** | **Kotlin + Compose** | Best native feel and Android integration; new Android CLI helps agents | Most custom 3D work; Kotlin compile/test loop slower; no cross-platform reuse |
| **5** | **React Native / Expo** | Good animation libraries, EAS cloud build can bypass local SDK | Heaviest setup and APK; 3D still custom; toolchain churn |

---

## 8. Top 3 risks

1. **You cannot see the real runtime on this box.** No KVM, and software emulation is explicitly unsupported and "very slow", so animation smoothness, WebView quirks, SAF picker UX, and touch feel are unverifiable locally. Mitigation: headless-Chromium screenshots for layout, the user's phone over `adb` wireless from day one, and Firebase Test Lab Robo for crash/ANR coverage. Budget for a few "works in browser, broken in WebView" cycles. **[V]/[I]**
2. **Tauri's Android storage layer is the weak seam.** The official dialog has no folder picker, the official fs plugin has an open `content://` 0-byte write bug, and the working solution (`tauri-plugin-android-fs`) is a single-maintainer community plugin that must be version-locked to Tauri. Mitigation: adopt it early, pin `=30.2.0` + matching JS API, write the library-folder flow first, and keep the `Platform` adapter thin so a Capacitor port is cheap. **[V]**
3. **Toolchain version drift and unverifiable releases.** Tauri 2.12 generates AGP 9.5.2 / Gradle 9.9.2 / SDK 37 / NDK 28.2; a mismatch anywhere yields cryptic Gradle/clang errors, and a signed APK that builds is not proof it launches. Mitigation: pin every version in one bootstrap script, build only `aarch64` for releases, run `apksigner verify` + an install/launch smoke test, and bump `versionCode` every time. **[V]/[I]**

**Bonus non-framework risks**

- **`epub.js` is effectively unmaintained** (last release 2020) and will need vendoring/patching; validate it against the user's actual EPUB collection early. **[V]**
- **Libgen integration** is copyright-infringing in most jurisdictions and the mirrors are legally/technically unstable. Keep it a user-configured, opt-in source rather than a hard dependency, and expect domains to rotate. **[I]**
- **WebView fragmentation** on old/odd devices: gate WebGL2/`preserve-3d` and provide a flat fallback shelf. **[V]/[I]**

---

## Sources (all accessed 2026-11-24 unless dated)

**Tauri**

- Prerequisites: <https://v2.tauri.app/start/prerequisites/>
- CLI reference (`android init/build`, `--ci`, `--apk`, `--target`): <https://v2.tauri.app/reference/cli/#android-build>
- Config reference (`minSdkVersion` 24, `versionCode`): <https://v2.tauri.app/reference/config/#androidconfig>
- Android signing: <https://v2.tauri.app/distribute/sign/android>
- WebView versions: <https://v2.tauri.app/reference/webview-versions/>
- Android build source (no adb): <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/android/build.rs>
- Generated Gradle versions: <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/build.gradle.kts>, `.../app/build.gradle.kts`, `.../gradle/wrapper/gradle-wrapper.properties`
- Java/Gradle compatibility check source: <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/mobile/android/check_java_gradle_versions.rs>
- Dialog plugin (no Android folder picker): <https://v2.tauri.app/plugin/dialog/>
- FS plugin (Android restrictions): <https://v2.tauri.app/plugin/file-system/>
- FS `content://` 0-byte bug (open): <https://github.com/tauri-apps/plugins-workspace/issues/3356>
- `tauri-plugin-android-fs` 30.2.0: <https://crates.io/crates/tauri-plugin-android-fs>, <https://docs.rs/tauri-plugin-android-fs/latest/tauri_plugin_android_fs/api/api_async/struct.Picker.html>
- `tauri-plugin-android-fs-api` 30.2.0: <https://registry.npmjs.org/tauri-plugin-android-fs-api/latest>
- Author's version-lockstep note (secondary): <https://zenn.dev/oka_yu/articles/d4517e0b6e159e>

**Android platform**

- Command-line tools download (build 15859902): <https://developer.android.com/studio#command-line-tools-only>
- AGP 9.5 compatibility (JDK 17, build-tools 36.0.0, NDK 28.2, API 37): <https://developer.android.com/build/releases/gradle-plugin>
- Gradle 9.9 compatibility (JDK 17–27): <https://docs.gradle.org/current/userguide/compatibility.html>
- NDK LTS r30 (30.0.16248370): <https://developer.android.com/ndk/downloads>
- Build-tools 36.0.0: <https://developer.android.com/tools/releases/build-tools>
- SDK platforms (API 36 stable; API 37 used by Tauri): <https://developer.android.com/tools/releases/platforms>
- SAF / document tree / persisted permissions: <https://developer.android.com/training/data-storage/shared/documents-files>
- WebView overview: <https://developer.android.com/guide/webapps/webview>
- Emulator acceleration (KVM, no nested VMs): <https://developer.android.com/studio/run/emulator-acceleration>
- Emulator CLI (`-accel off` unsupported/very slow, `ANDROID_I_WANT_MY_TCG`): <https://developer.android.com/studio/run/emulator-commandline>
- CLI builds and manual signing (`zipalign`, `apksigner`, `keytool`): <https://developer.android.com/build/building-cmdline>
- Wireless ADB (`adb pair` / `adb connect`): <https://developer.android.com/tools/adb#wireless-android11-command-line>
- Android CLI for agents: <https://developer.android.com/tools/agents/android-cli>
- Firebase Test Lab getting started: <https://firebase.google.com/docs/test-lab/android/get-started>
- Firebase Test Lab quotas/pricing (Spark: 10 virtual + 5 physical/day): <https://firebase.google.com/docs/test-lab/usage-quotas-pricing>

**Web/engine**

- MDN `transform-style` (flattening rules): <https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style>
- MDN `WebGL2RenderingContext`: <https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext>
- epub.js releases (v0.3.88, 2020): <https://github.com/futurepress/epub.js/releases>
- pdf.js releases (v6.5.438, 2026-11-01): <https://github.com/mozilla/pdf.js/releases>

**Alternatives**

- Flutter install (3.50.1): <https://docs.flutter.dev/install>
- Flutter Android setup (API 36, SDK/JDK): <https://docs.flutter.dev/platform-integration/android/setup>
- Flutter release/APK build: <https://docs.flutter.dev/deployment/android>
- Capacitor 8 environment setup (Node 22, Android Studio 2025.2.1, API 24+): <https://capacitorjs.com/docs/getting-started/environment-setup>
- Expo local builds (`eas build --local`, needs Android SDK/NDK): <https://docs.expo.dev/build-reference/local-builds/>
- Expo local production build + signing: <https://docs.expo.dev/guides/local-app-production/>
- Expo APK profiles/EAS cloud: <https://docs.expo.dev/build-reference/apk/>
- React Native 0.88 environment setup (JDK 17, Android Studio): <https://reactnative.dev/docs/set-up-your-environment>
- Android command-line Gradle builds: <https://developer.android.com/build/building-cmdline>

**Secondary field reports**

- Headless Tauri Android APK build by an agent: <https://timetobuildbob.com/blog/the-robot-that-compiled-the-android-apk/> (2026-04-28)
- Tauri Android on headless Debian 13 with NDK 28.2: <https://frangonf.com/blog/managing-the-android-sdk-as-a-mise-dependency> (2026-09-30)
- Tauri Android build doc with JDK 21 / NDK 27.2 / signing env vars: <https://github.com/djkcyl/arkstage/blob/master/docs/android-build.md>
