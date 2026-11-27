# Android storage spike (ticket 10)

> **Historical.** This describes the throwaway 0.1.0 diagnostic build, not the
> current app. Version, SDK and APK hashes below are from that build.

A throwaway diagnostic build that proves the SAF (Storage Access Framework)
library-folder flow on a real phone using `tauri-plugin-android-fs` **30.2.0**.

## What was added

- `src-tauri/Cargo.toml`: `tauri-plugin-android-fs = "=30.2.0"` (exact pin).
- `package.json`: `tauri-plugin-android-fs-api@30.2.0` (exact pin, same version).
- `src-tauri/src/lib.rs`: plugin registered on Android only
  (`#[cfg(target_os = "android")]`), so desktop builds stay clean.
- `src-tauri/capabilities/default.json`: `android-fs:default` plus
  `android-fs:allow-write-text-file`. The default set already covers the
  directory picker, persisted-grant checks/release, recursive `read_dir`,
  metadata, read streams and text reads. Writing needed the extra permission.
- `src/StorageSpike.tsx` + `src/StorageSpike.css`: the single diagnostic screen.
  `src/App.tsx` renders it. Nothing else in the UI is used.

The plugin's real 30.2.0 API differs from the older notes in one important way:
URIs are `FsUri` objects (`{ uri, documentTopTreeUri }`), not bare strings, and
the JS bindings are named `showOpenDirPicker`, `persistPickerUriPermission`,
`checkPersistedPickerUriPermission`, `releasePersistedPickerUriPermission`,
`readDir`, `openReadFileStream`, `createNewFile`, `writeTextFile`,
`readTextFile`.

### Screen behaviour

| Action | What it proves |
|---|---|
| Pick library folder | `ACTION_OPEN_DOCUMENT_TREE` opens, then the grant is persisted and the URI stored locally. |
| Check persisted grant | Read/write permission survives beyond a single process (`checkPersistedPickerUriPermission`). |
| List books | Recursive scan (depth 32, 50k entry cap) for `.epub`/`.pdf`, hidden directories skipped; reports counts, total bytes, elapsed ms, first 5 paths. |
| Read a book | Opens the first EPUB/PDF as a SAF file handle, reads at most 64 KiB via `openReadFileStream`, shows magic bytes and SHA-256 of that sample, then cancels the stream. Nothing is copied. |
| Write a test file | Creates or overwrites `pocketlibrary-spike.txt`, writes an ISO timestamp, reads it back through SAF. |
| Clear/forget grant | Releases the persisted URI permission and forgets the local choice, so revocation can be tested. |

Failure states are logged on screen (no folder, cancelled picker, revoked grant,
empty library, read failure, write failure) and never throw out of the UI.

## APK

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

- size: **293,959,088 bytes (280 MiB)** — debug build with Rust debug info and
  the plugin's Kotlin code
- `package: app.pocketlibrary`, `versionCode 1000`, `versionName 0.1.0`
- `minSdkVersion 24`, `targetSdkVersion 36`, `native-code: 'arm64-v8a'`
- SHA-256: `acbf8f36c47ea05b9970ba77f2fda68a40eec714f22bd36883dc55bf2375bacf`
- `apksigner verify --print-certs`: valid, signer `CN=Android Debug`,
  SHA-256 `c9612c660f5ea8abeb58d2e9b335edc7951e0513f79d4758c4a1171782d86691`

Build command:

```bash
source scripts/android-env.sh
npm run tauri android build -- --apk --target aarch64 --debug --ci
```

## Install

Manual: copy the APK to the phone (USB, cloud drive, Syncthing), tap it, and
allow "Install unknown apps" for the file manager.

Or over adb:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## Manual test script (phone)

Prepare before starting: put at least two `.epub` and/or `.pdf` files in
`Documents/PocketLibrary` (create the folder if needed). Put one in a nested
subfolder too, so recursion is exercised.

1. Install and launch **PocketLibrary**. Status should show folder `(none
   chosen)`, grant `none`, version `0.1.0`.
2. Tap **Pick library folder**, choose/create `Documents/PocketLibrary`, and
   grant access. Expect: `Selected "PocketLibrary" and persisted its read/write
   grant`, then grant `persisted read/write`.
3. Tap **List books**. Expect: EPUB/PDF counts matching the prepared files,
   total bytes, elapsed milliseconds, and the first few relative paths. A
   nested book must be included.
4. Tap **Read a book**. Expect: bytes read (≤ 64 KiB), `Parsed as a file
   handle`, magic `ZIP/EPUB (PK\x03\x04)` or `PDF (%PDF)`, and an SHA-256 line.
   This proves the fd is readable without copying the file.
5. Tap **Write a test file**. Expect `Wrote and read back
   "pocketlibrary-spike.txt"` and a JSON content line containing a timestamp.
   Verify the file exists in the folder with a file manager.
6. Kill the app (swipe away / Force stop), relaunch. Expect: folder URI still
   shown, grant `persisted read/write` (or tap **Check persisted grant**).
   Then **List books** must still work — this is the cross-launch proof.
7. Test revocation. Either:
   - in-app: tap **Clear/forget grant**, then **Check persisted grant**; expect
     `revoked`/`none` and no crash; or
   - outside the app: move/rename the folder in the Files app, or use Android
     **Settings → Apps → PocketLibrary → Storage & cache → Clear storage**
     (the exact "revoke" UI varies by OEM; SAF folder grants are not always
     listed under Permissions). Relaunch and tap **Check persisted grant** /
     **List books**; expect a visible revoked/no-access message, not a crash.
8. Re-pick the folder to recover, then confirm listing works again.

## Status

Everything that can be checked without a phone is green: the frontend builds,
the Android Rust target compiles, the APK is signed and `aapt2` reports the
expected package/SDK/native ABI. Only the phone run above can confirm the SAF
picker, persistence across relaunch, provider behaviour and real scan timing.

## Build notes / deviations

- `compileSdk`/`targetSdk` are 36 (pre-existing SDK 37 fallback; not changed by
  this spike).
- The plugin is registered under `cfg(target_os = "android")`; registering it
  unconditionally would be pointless on desktop and risks desktop build noise.
- The debug APK is large (~280 MiB) because it carries Rust debug info; a
  release build is much smaller.
- No device or emulator is attached to the build machine, so runtime behaviour
  is unverified here.
