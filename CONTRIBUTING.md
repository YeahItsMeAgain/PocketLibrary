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

The single verification gate is `./scripts/check.sh` (also `npm run check`). It
names any failed stage and prints that stage's log tail. It checks formatting
first, then runs the remaining stages (independent web, core and spine groups
in parallel): `npx tsc --noEmit`, `npm run build`, `cargo fmt --check` for
`core`, `spine` and `src-tauri`, `cargo clippy -- -D warnings` and `cargo test`
for `core` and `spine`, the smoke/spine/reader Playwright specs serially, and
`./scripts/android-patch.sh check`.

```bash
npm ci
npx playwright install chromium   # once, if the browser is missing
./scripts/check.sh                # fast gate; what CI runs on every push/PR
./scripts/check.sh full           # adds the full Playwright suite + Android cross-check
./scripts/check.sh android        # builds the arm64 APK (slow; needs SDK/NDK)
```

`full` adds the complete Playwright suite and
`source scripts/android-env.sh && (cd src-tauri && cargo check --target aarch64-linux-android -p pocketlibrary)`.
`android` is the same as `./scripts/android-build.sh`; it needs the SDK, NDK and
(unless `POCKETLIBRARY_ANDROID_UNSIGNED=1`) a local release keystore.

The fast gate is the only job that runs on every push and pull request. The
Android APK job is manual (`workflow_dispatch`); in CI it builds a debug APK
when no release keystore is present, and asserts the APK contains the spine
assets and native libraries. Release signing stays local because its keystore
is a secret.

Useful extra checks:

```bash
node perf/bench.mjs                            # 2,000-book proxy benchmark
```

Build and sign a release APK locally with the commands in
[`docs/build.md`](docs/build.md), and run the device checklist before calling a
release done.

## Code style

- TypeScript is strict and `noUnusedLocals`/`noUnusedParameters` are on. Run
  `npx tsc --noEmit` before pushing.
- Follow the existing structure and naming. The UI talks to the native side only
  through the typed adapter in `src/platform.ts`; do not call Tauri commands
  directly from components.
- Keep the Rust core free of Tauri dependencies so it stays testable on a
  headless host. Run `cargo fmt` and keep `cargo clippy` clean.
- Keep modules within the size budgets checked by
  `npm run check:structure` (`scripts/check-structure.mjs`). TypeScript under
  `src/` warns at 600 lines; Rust under `core/src`, `spine/src` and
  `src-tauri/src` warns at 800; either fails at 1,000 lines unless the file is
  allowlisted in the script with a reason and a follow-up. Allowlisted files
  are pinned to their current size, so split them instead of growing the
  baseline.
- Keep the crate dependency arrows one-way: `core` must not depend on Tauri or
  `pocketlibrary-spine` in its shipped graph (a dev-dependency on the engine is
  allowed for host integration tests), `spine` must not depend on `core` or
  `src-tauri`, and only `src-tauri` may depend on both. In the web seam,
  `src/platform/index.ts` and `src/platform/types.ts` must not import React,
  and `src/spineSpec.ts` stays dependency-free. The structure check enforces
  all of this.
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
