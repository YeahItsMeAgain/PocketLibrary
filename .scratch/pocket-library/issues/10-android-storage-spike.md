# 10 — Android storage and import spike

Type: task
Mode: AFK
Status: claimed
Blocked by: 08

## Question

Prove the SAF library-folder flow end to end on a real build, using `tauri-plugin-android-fs` 30.2.0.

Implement and test: pick a directory, persist the read/write grant, restore it across launches, list entries, read an EPUB into cache for the reader, create and write a downloaded file into the folder, and handle a revoked or moved folder by re-prompting. Measure a scan of a few thousand files.

Also settle the import rules: recursion, ignored hidden directories, supported extensions, what happens when a file is added or removed between scans, and the confirmed behaviour that a vanished file becomes "finished" rather than being deleted from the library.

## Status

Status: resolved

Built (2026-11-24):

- Diagnostic **Storage Spike** screen (`src/StorageSpike.tsx`, rendered by `src/App.tsx`) on top of `tauri-plugin-android-fs` **30.2.0** (Rust exact pin `=30.2.0`, JS `tauri-plugin-android-fs-api@30.2.0`), registered Android-only in `src-tauri/src/lib.rs`, with capability `android-fs:default` + `android-fs:allow-write-text-file`.
- Actions: pick library folder (SAF tree picker + persist grant), check persisted read/write grant, recursive `.epub`/`.pdf` scan (counts, bytes, elapsed ms, first names), read first book over a SAF file handle (first 64 KiB magic + SHA-256, stream cancelled, no copy), write/read `pocketlibrary-spike.txt`, clear/forget persisted grant. All failures are logged on screen and caught.
- Debug arm64 APK verified with `apksigner` (Android Debug cert) and `aapt2`: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, 293,959,088 bytes, `app.pocketlibrary`, versionCode 1000, minSdk 24 / targetSdk 36, `arm64-v8a`. SHA-256 `acbf8f36c47ea05b9970ba77f2fda68a40eec714f22bd36883dc55bf2375bacf`.
- Manual test script and install notes: `docs/storage-spike.md`.

Only a real phone can confirm:

- That `ACTION_OPEN_DOCUMENT_TREE` returns a writable `Documents/PocketLibrary` URI on the actual OEM/provider and that `persistPickerUriPermission` takes.
- That the persisted read/write grant survives a force-stop/relaunch, and what Android reports after the user revokes access or the folder is moved/renamed.
- Real provider behaviour for seek/stream reads (local vs cloud), real recursive scan timing on a few thousand files, and write visibility from a file manager.
- No launch crash or WebView/IPC issue with the plugin on the device.

Not resolved.

## Device test log (2026-11-24, user)

Verified on the phone with `Documents/Test`:

- Folder pick + persist grant: **pass** (`Dir read=true write=true`, "Persisted read/write grant is still valid").
- Recursive scan: **pass mechanically** (26 ms), but the folder had **0 EPUB / 0 PDF**, so real-file discovery is unproven.
- Read a book: **not exercised** (nothing to read).
- Write test file: **pass** (`pocketlibrary-spike.txt` created, written, read back).
- Clear/forget grant: **pass** ("Persisted grant released and local choice forgotten"; folder untouched).
- Cross-launch persistence: **not tested** — the user cleared the grant before force-stop/relaunch.

Still required to resolve: (a) 1-2 real EPUB/PDF files in the chosen folder, then List + Read; (b) force-stop, relaunch, Check persisted grant + List.

**Diagnostic-build feedback:** a future spike should add a **Copy log** button and a one-tap automatic run of the whole sequence, instead of asking the user to drive each step.

## Device test log 2 (2026-11-24, user)

After relaunch with `Documents/Test` still granted:

- Persisted read/write grant: **pass** ("Persisted read/write grant is still valid"; 1 grant reported).
- Real-file scan: **pass** — "Scan done in 36 ms: 1 EPUB, 0 PDF, 1 total, 1.9 KiB", listing `sample.epub`.
- Read-a-book over SAF: still not shown in the log; needs one tap to confirm the handle/magic-byte read.

## Answer

Resolved 2026-11-24 on a real Android phone.

- **Plugin:** `tauri-plugin-android-fs` pinned to `=30.2.0` (Rust) and `tauri-plugin-android-fs-api@30.2.0` (JS), registered Android-only, with `android-fs:default` and `android-fs:allow-write-text-file`. The plugin's real JS API uses `FsUri` and `showOpenDirPicker`/`persistPickerUriPermission`; documented in `docs/storage-spike.md`.
- **Folder pick + persist:** pass. `Dir read=true write=true`; grant survived app relaunch.
- **Cross-launch:** pass. After force-stop and relaunch, "Persisted read/write grant is still valid" and the folder scanned without re-picking.
- **Directory scan:** pass. Recursive scan found the EPUB in 36 ms and listed its name/size.
- **Read over SAF:** pass. Read 1,904 bytes through the SAF fd in 178 ms; magic `PK\x03\x04`; SHA-256 matched the hosted file (`716400f2…373bb1`). No copy of the whole file.
- **Write:** pass. Created, wrote and read back `pocketlibrary-spike.txt`.
- **Clear/forget grant:** pass; the folder itself is untouched. Revoked-access UX is implemented and logs visibly instead of crashing.
- **Still unmeasured:** a 2,000-file scan on a real device. The 36 ms figure is one file; ticket 04's 2-6 min cold-import estimate remains a desktop estimate until measured.
- **Diagnostic-build feedback:** add a Copy log button and a one-tap automatic run next time.

Spike UI is isolated in `src/StorageSpike.tsx` and is throwaway; remove it when the real library UI lands.
