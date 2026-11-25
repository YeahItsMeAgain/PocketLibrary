# Contributing to PocketLibrary

Thanks for helping. This is a small, privacy-first Android reading app; keep
changes focused and keep the app working without an account, cloud service or
telemetry.

## Issues

- Search existing issues before opening a new one.
- Use the issue templates. For bugs, include the app version (Settings → About),
  Android version, device model, reproduction steps, expected/actual behaviour
  and, where possible, the diagnostics zip from **Settings → Help & diagnostics**
  (see [`docs/diagnostics.md`](docs/diagnostics.md)).
- Do not attach books, cover files or anything containing personal paths unless
  you are comfortable making it public. Diagnostics include paths and book
  titles by design.

## Build and test

Prerequisites are Node 24, Rust stable, and (for Android builds) JDK 21 plus the
Android SDK/NDK described in [`docs/build.md`](docs/build.md).

```bash
npm ci
npm run build
npx tsc --noEmit
npm run test:e2e                 # Playwright; installs its own browser if needed
cargo test --manifest-path core/Cargo.toml
```

Useful extra checks:

```bash
npx playwright install --with-deps chromium   # CI-equivalent browser setup
source scripts/android-env.sh
cargo clippy --manifest-path src-tauri/Cargo.toml \
  --target aarch64-linux-android --all-targets -- -D warnings
node perf/bench.mjs                            # 2,000-book proxy benchmark
```

The Android APK is **not** built in CI because it needs the SDK, NDK and a local
release keystore. Build it locally with the commands in [`docs/build.md`](docs/build.md)
or the README, and run the device checklist before calling a release done.

## Code style

- TypeScript is strict and `noUnusedLocals`/`noUnusedParameters` are on. Run
  `npx tsc --noEmit` before pushing.
- Follow the existing structure and naming. The UI talks to the native side only
  through the typed adapter in `src/platform.ts`; do not call Tauri commands
  directly from components.
- Keep the Rust core free of Tauri dependencies so it stays testable on a
  headless host. Run `cargo fmt` and keep `cargo clippy` clean.
- Prefer small, readable functions and explicit types at module boundaries.
  Avoid unrelated refactors in a bug-fix commit.
- Add or update tests for behaviour changes. Playwright specs live in
  `tests/e2e/`; core tests live beside the modules in `core/src/` and in
  `core/tests/`.
- Preserve the existing visual language; the design reference lives under
  `prototype/design/` and should not be edited as part of feature work.

## Commits and pull requests

- Use Conventional Commit-style subjects, matching the history:
  `feat(reader): ...`, `fix(ui): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Keep commits focused and the tree green (build, type check, Rust tests, e2e).
- In a pull request, describe the problem, the approach, and how you verified it.
  Note any device-only checks that still need a real phone.
- Do not bump the version or rewrite release notes unless the change is a release.

## Secrets

Never commit signing keys, `keystore.properties`, passwords, tokens or `.env`
files. Keystores belong outside the repo (the documented path is
`$HOME/.android-keys/`); `.gitignore` already excludes common key and secret
formats. If you suspect a secret was committed, say so in the issue rather than
rewriting history silently.

## Device testing

Emulator and Playwright coverage is not enough for storage, sharing and reader
gestures. Before a release, run the checklist in the README on a physical phone
against a signed release APK. In particular, verify install-over-upgrade, SAF
folder access, EPUB/PDF reading, backup import/export, the Android back stack,
and the diagnostics share sheet with its save-picker fallback.
