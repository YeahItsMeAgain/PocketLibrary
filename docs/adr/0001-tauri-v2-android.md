# Ship as a Tauri v2 Android app with a web UI

We need a polished, animation-heavy Android APK, built entirely on a headless Linux server with no emulator. We chose Tauri v2: a Rust backend for files, EPUB/PDF parsing, SQLite, and Libgen HTTP, and a web UI for the CSS-3D shelf and page interactions. The build path (`tauri android init --ci`, `tauri android build --apk`) is verified to produce an APK without Studio, a display, or a device, and the web layer lets us validate the UI in headless Chromium before every APK build.

Considered: Flutter and Jetpack Compose (both build headlessly but require re-implementing 3D transforms and page-flip primitives), React Native/Expo (heavier build, weaker fit for custom rendering). Capacitor remains the fallback shell if Tauri's Android storage seam fails; all platform access sits behind a thin adapter to keep that swap cheap.

Consequences: the system WebView is the rendering target, so we gate on WebView capability and pin/vendor `epub.js`; one community SAF plugin becomes a load-bearing dependency.
