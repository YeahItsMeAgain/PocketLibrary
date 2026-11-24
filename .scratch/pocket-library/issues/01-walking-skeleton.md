# 01: Walking skeleton

**What to build:** An installable APK that proves the whole shell: Rust core, SQLite with migrations, a typed command API, and a web UI that talks to it only through the platform adapter. It launches to an empty library wall. The temporary storage-spike screen is removed.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Fresh install launches to an empty library wall with the drawer available
- [x] The UI calls a real Rust command through the platform adapter and renders the result (for example, app version)
- [x] SQLite is created with a schema version and survives relaunch
- [x] No storage-spike screen or SPIKE-only commands remain
- [ ] A debug APK builds with the documented command and installs on a phone

## Verification

- `cargo test --manifest-path core/Cargo.toml`: 4 passed (fresh migration,
  idempotent reopen, empty catalogue, app info version/schema).
- `npm run test:e2e`: 3 passed (empty wall, drawer navigation, Escape/focus).
- `npm run build` and `npx tsc --noEmit`: pass.
- Android clippy (`aarch64-linux-android`, `-D warnings`): pass; the NDK C
  compiler is now exported by `scripts/android-env.sh` for bundled SQLite.
- Debug APK built and `apksigner verify` passed:
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`,
  300,409,112 bytes, signed with the Android debug key.

The two unticked boxes need a physical phone and are unverified here: no
emulator/device is attached, so the APK was built and signature-checked but not
sideloaded. The empty wall and drawer behaviour are covered at the phone
viewport by Playwright, not by an installed launch.
