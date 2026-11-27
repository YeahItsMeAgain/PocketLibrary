# Spine-era codebase health survey

**Date:** 2026-11-27
**Scope:** `core/`, `spine/`, `src/`, `src-tauri/`, `tests/`, plus the docs and
scratch contract that describe them.
**Status:** advisory only. No code, test, config or in-progress spine work was
modified. This is the only file added.

## Context

The repo just landed the on-device spine engine (`spine/`), the automatic queue
(`core/src/spine_queue.rs` + `src-tauri/src/spine_queue.rs`), per-book
`spine_style`, and the 200 MB cache. Release 0.1.8 is the release where spine
art is supposed to be automatic, so the highest-value work is anything that
makes that release ship the feature *and* makes the next engineering pass
cheaper.

Several frontend files are being edited right now (`git status`: `App.tsx`,
`App.css`, `CoverChooser.tsx`, `DetailPanel.tsx`, `LibraryWall.tsx`, `Shelf.tsx`,
`SpineStudio.tsx`, `platform.ts`, plus new `spineActivity.tsx`,
`SpineActivityChip.tsx`, and two new e2e specs). Findings that touch those files
are marked **in flux**; treat them as contract gaps to settle, not as
regressions to revert.

The vocabulary below follows `.agents/skills/codebase-design`: module, interface,
implementation, seam, adapter, depth, leverage, locality. A **deep module** is a
lot of behaviour behind a small interface; a shallow one leaks its implementation
to callers.

What I actually ran:

- `cargo test --manifest-path spine/Cargo.toml --test pipeline` → **11 passed**
  (the route tests found the local `.scratch` models; a clean checkout skips
  them by design).
- `cargo test --manifest-path spine/Cargo.toml --lib` → 0 tests.
- CI currently runs **only** the core tests (see finding 4).

## Top findings

### 1. The Android build can silently ship without the required model bundle

`tauri.conf.json:9` runs only `npm run build` before the APK build.
`scripts/stage-spine-android-assets.sh` is the only thing that copies the four
models and `libonnxruntime.so` into `gen/android/.../assets/spine/` and
`jniLibs/`. That output is gitignored (`.gitignore`, "Staged Android model
assets"), and `docs/build.md:95-101` walks through `init` → `build` without
calling the script. `docs/build.md:247-251` also omits it from per-merge checks.

Consequence: on a clean checkout, `npm run tauri android build` produces an APK
with no ONNX models and no runtime. The app still installs and paints Cloth
spines; `spine_assets::ensure_models` reports missing, and the queue parks jobs
as "waiting" forever. That is a silent failure of the entire 0.1.8 feature, and
it fails *after* a 10–20 minute Gradle build.

This is the classic shallow-seam problem: the build interface (`tauri android
build`) does not include a fact the caller must know (models must be staged
first). Make the seam honest instead of documenting the trap.

**Fix:** one `scripts/android-build.sh` that runs `init` (only if missing),
re-applies the generated-tree patches, runs the staging script, then builds.
Point `docs/build.md` and AGENTS at it. Add a cheap guard in the staging step
that fails if `assets/spine/det.onnx` is absent after the build config resolves.

### 2. Every launch re-hashes the whole library to discover there is nothing to do

`App.tsx:319-339` queues every book once per app run ("backfill"). The worker
then calls `SpineService::is_cached` for each book (`src-tauri/src/spine_queue.rs:234-241`),
which calls `find_book` → `api.list_books()` (`src-tauri/src/spine_service.rs:422-427`),
then `prepare` → reads the cover and SHA-256s it (`spine_service.rs:286-302`).
`list_books` also joins every label for every book (`core/src/service.rs:210-226`,
`1843-1858`).

So for a 500-book library, every cold start performs 500 full-catalogue loads
(including label joins) and 500 cover reads/hashes before the queue settles.
ADR-0005 says the library is "backfilled once"; the implementation backfills
every launch and relies on the cache check to make it a no-op. The check itself
is the cost.

**Fix:** persist a `spine_backfill_done` setting keyed by bundle id (the cache
key already changes with `BUNDLE_ID`), and only enqueue the full library when
that flag is absent. New books/covers already enqueue explicitly. Independently,
add `Api::book(id)` so per-book paths stop loading and labelling the whole
catalogue; `find_book` is used twice per job.

### 3. The spine cache has two owners and its tests never run in CI

`core/src/spine_cache.rs` owns only the 200 MB LRU (`trim_cache`). The Tauri
crate owns the path layout (`spine_service.rs:103-105`), the key
(`cache_key`, `398-400`), artifact read/write (`455-481`), scratch cleanup
(`170-172`), and `remove_cache` (`191-211`). `core` has no idea a book cache
exists beyond trimming a directory.

That split costs twice:

- The cache contract (key stability, last-writer-wins install, artifact
  round-trip) is tested only in `src-tauri/src/spine_service.rs:611-755`. CI
  runs `cargo test --manifest-path core/Cargo.toml` only (`.github/workflows/ci.yml:38-39`),
  and `docs/build.md:254-260` states host `cargo test` for `src-tauri` needs
  GTK/WebKit, which this box and CI do not have. Those tests are effectively
  dead in automation.
- Eviction and layout can drift: `trim_cache` assumes flat directories and
  file mtimes; the writer decides the names. One module would make the
  invariant local.

**Fix:** move a `SpineCache` module into `core` (root path, `cache_key`,
`read`/`write_artifact`, `install`, `remove`, `trim`), leaving Tauri with only
engine invocation and base64 wire conversion. Add `cargo test --manifest-path
spine/Cargo.toml` and the core cache tests to CI. This is the deepest single
improvement available: it turns a split, host-untestable implementation into a
small interface (`for_book`, `get`, `put`, `remove`) with all the filesystem
behaviour behind it.

### 4. The automatic queue does not yet meet its own failure contract

ADR-0005 line 9 and `.scratch/spine-engine/spec.md:67,293,349` require: one
automatic retry, then Cloth with a persistent marker and a detail note. The
committed worker does neither (`src-tauri/src/spine_queue.rs:248-257`): on
`Err` it logs to stderr and calls `finish_job(false)`. `QueueCore` stores only
counters (`core/src/spine_queue.rs:36-45`), and the persisted payload stores only
pending ids (`57-63`), so a failure leaves no per-book reason and the marker
disappears after restart. `progress.index/total` (`179-188`) is derived from
session counters, so "n of m" shrinks as cached books are skipped and resets to
1 after a restart.

The failure is also invisible in the export: spine errors use `eprintln!`
(`spine_queue.rs:251`, `spine_service.rs:160-166`), while the diagnostics zip
only includes `diagnostics.log` and the model-resolution `spine.log`
(`core/src/diagnostics.rs:243-271`). The queue's most useful error detail never
reaches the file a user can share.

**Fix:** make failure a first-class per-book field (id, code, message, attempt)
in the persisted queue or a small `spine_jobs` table; retry once; emit a stable
cohort total (or persist completed/failed); route queue failures through
`diagnostics::log_event`.

### 5. The hand-mirrored wire contract has already drifted

There are three copies of the same interface: Rust structs, `platform.ts`
interfaces, and the mock. No generation or contract test ties them.

- `SpineArtifact.pages_approximate` is serialized (`src-tauri/src/spine_service.rs:57-58`)
  and set (`174-176`), but absent from `platform.ts:138-151` and from the mock.
  ADR-0005 line 11 requires an `approximate` label; the UI cannot render it.
- `MOCK_APP_INFO` still reports schema 5 (`platform.ts:944-948`) while
  `SCHEMA_VERSION` is 6 (`core/src/lib.rs:52`).
- `.scratch/spine-engine/CONTRACT.md:39` says `spine-2x.jpg` is "52 × 236"; the
  engine actually writes 104 × 472 and `spine_service.rs:559-570` downsamples it
  (correctly documented in `spine/README.md:40`). CONTRACT.md also omits
  `pagesApproximate`, despite its own "change this file before changing the
  seam" rule.

The cost is not just a missing label: a future agent reading CONTRACT.md will
build a 52 × 236 writer, and a future field addition will repeat this drift.

**Fix now (cheap):** add `pagesApproximate` to `platform.ts` and the mock; derive
or correct `MOCK_APP_INFO`; fix CONTRACT.md. **Fix next:** generate the TS types
from Rust (ts-rs/specta) or add a CI check that compares the `generate_handler!`
list, the `platform.ts` adapter, and the mock method names.

### 6. The shelf ignores the fallback verdict

`spineActivity.tsx:91-103` stores `artifact.spineDataUrl` unconditionally. That
is the generated art, even when `verdict === "fallback"`. The Studio correctly
switches to Cloth on a fallback (`SpineStudio.tsx:1583`, `1680-1683`), and ADR-0005
line 7 says Cloth is the automatic fallback. The shelf therefore shows exactly
the spine the quality gate rejected. **In flux**, but the provider seam is the
right place to fix it: one branch choosing `fallbackDataUrl` (or clearing the
image) for `fallback`, independent of Studio state.

### 7. Renderer math is split between TS and Rust

`SpineStudio.tsx` contains roughly 1,300 lines of palette sampling, contrast
guards, vertical/horizontal fitting, wrap geometry, cloth and full-bleed
composition. Rust has its own type-on-cloth renderer (`spine/src/fallback.rs`)
and the engine writes the shelf `spine-2x.jpg`. The 52 × 236 constants are
repeated in `spine/src/crop.rs:10`, `spine_service.rs:28`, `SpineStudio.tsx:46-47`,
and the mock (`platform.ts:971-972`). A fix to Cloth contrast in one renderer
does not reach the other, and the Studio preview can differ from the cached
fallback the shelf shows.

Do not rush this: the Studio needs interactive re-render from cached art without
re-running inference, which is a legitimate reason to keep a browser renderer.
The later move is to make one renderer authoritative (probably Rust for the
shelf/fallback, TS for the live studio) and share a style/spec artifact rather
than copy constants.

### 8. Generated Android sources are load-bearing

`src-tauri/gen/android` is tracked, and `tauri android init` is documented to
regenerate "the whole `gen/android` tree" (`docs/build.md:212-214`). It contains
the hand-written `UpdatesPlugin.kt`, `MainActivity.kt`, the manifest
`REQUEST_INSTALL_PACKAGES`/FileProvider block, and `res/xml/file_paths.xml` —
not just the Gradle edits the docs list. A future agent following the build
guide will re-init and lose the in-app updater, with only a compile error much
later.

**Fix:** either move the Kotlin bridge to a stable (non-generated) source set
and wire it in, or replace the prose with a patch script that re-applies every
tracked file after init (and stages models). This pairs naturally with finding 1.

## Ranked table

| # | Finding | Impact if left | Effort | When |
|---|---|---|---|---|
| 1 | Build does not stage models (`tauri.conf.json:9`, `.gitignore`, `docs/build.md:95-101`) | 0.1.8 ships without the spine engine, silently | S | **do now** |
| 2 | Every launch re-hashes every cover (`App.tsx:319-339`, `spine_queue.rs:238`, `spine_service.rs:214-222,422-427`) | Hundreds of MB of I/O per cold start; backfill is never "once" | S/M | **do now** |
| 3 | Cache split across `core/spine_cache.rs` and `src-tauri/spine_service.rs`; Tauri tests not in CI | Cache key/layout/eviction unverified; two owners | M | **next** |
| 4 | No retry, no persisted failure, no detail note; failures only on stderr (`spine_queue.rs:248-257`, `core/spine_queue.rs:57-63`) | Violates ADR/spec; marker vanishes on restart; exports can't explain it | M | **do now / next** |
| 5 | Wire contract drift: `pagesApproximate`, mock schema, CONTRACT 52×236 (`platform.ts:138-151,944-948`, `CONTRACT.md:39`) | "approximate" label impossible; agents build the wrong seam | S | **do now** |
| 6 | Shelf paints generated spine on `fallback` (`spineActivity.tsx:91-103`) | Shows the rejected spine; contradicts ADR fallback rule | S | **do now** (verify in flux) |
| 7 | CI runs core only; spine crate has 11 host tests (`.github/workflows/ci.yml:38-39`) | Crop/QA/fallback regressions invisible | S | **do now** |
| 8 | Spine failures don't reach `diagnostics.log` (`spine_queue.rs:251`, `core/src/diagnostics.rs:243-271`) | Support/export can't diagnose queue failures | S | **do now** |
| 9 | Android generated tree owns updater Kotlin + manifest (`docs/build.md:212-221`) | `init` silently wipes the updater | M | **next** |
| 10 | Model hashes duplicated in Rust and shell (`spine_assets.rs:48-79`, `stage-spine-android-assets.sh:41-56`) | Bundle bump needs two edits; mismatch = runtime model failure | S | **next** |
| 11 | Queue progress denominator is session-derived (`core/src/spine_queue.rs:179-188`) | "n of m" jumps backwards after restart | S/M | **next** |
| 12 | Renderer math duplicated TS/Rust; constants in 4 places | Style fixes land twice; preview ≠ shelf | L | **later** |
| 13 | `.scratch` has 456 MB tracked, 1,171 binaries (models, APKs, covers) | Clone/search cost for agents; slow navigation | M | **later** |
| 14 | Three Cargo manifests/lockfiles, no workspace; AGENTS has no build/test map | Agents re-discover commands; dependency versions drift | M | **later** |

## Top 3

1. **Make the Android build stage the models** (finding 1). Create one
   `scripts/android-build.sh` that owns init + generated-tree patches + model
   staging + build, make the docs point at it, and fail loudly if
   `assets/spine/det.onnx` is missing. Small effort, prevents a model-less
   0.1.8.

2. **Make the spine cache a single core module and put it in CI** (finding 3).
   Move path/key/artifact/eviction into `core`, leave Tauri with inference and
   wire encoding, and add `spine` + the moved cache tests to CI. This is the
   highest-leverage structural change: one owner, host-testable, and it stops
   the cache contract from drifting while the queue is still being shaped.

3. **Stop the every-launch library hash** (finding 2). Persist a
   backfill-complete flag keyed by `BUNDLE_ID`, and add `Api::book(id)` so a
   queue job does not load and label the whole catalogue twice. Cheap, and it
   removes a cost that grows with the user's library.

If the release is already frozen when this is read, do #1 and #6 (fallback
verdict); they are the two with direct user-visible failure modes.

## Leave alone

- **`platform.ts`'s mock adapter.** It duplicates the Tauri adapter and some
  engine-ish behaviour (crop fit, synthetic spines). That is a *second adapter*
  at a real seam, not accidental duplication: it is what makes Playwright able
  to exercise the UI without a device. Keep it; only the *types* should be
  generated/shared.
- **Thin Tauri command wrappers.** `src-tauri/src/lib.rs` is repetitive by
  design; Tauri's `generate_handler!` needs concrete functions. Do not build a
  macro layer for its own sake. The drift risk belongs in a contract test, not
  in a framework.
- **`Error`/`ApiError` split.** Stable codes plus safe user messages, with
  details kept in logs, is the right shape. Adding spine-specific codes should
  extend this taxonomy rather than invent a parallel one; the existing split is
  not the problem.
- **`BOOK_COLUMNS`.** The single book projection is already the right locality
  move; do not replace it with an ORM.
- **Per-book style in SQLite, rendering in TS.** ADR-0005's "re-render from
  cached art without re-running the pipeline" genuinely needs a client-side
  renderer. The issue is duplication, not the decision.
- **Tracked `.scratch` evidence.** The spine host tests read models from
  `.scratch/.../v8-app/models`; deleting the whole tree would silently turn
  route tests into skips. Prune APKs/AARs/covers later, keep the model manifest
  and weights the tests need.
- **No root Cargo workspace.** The three manifests exist because `src-tauri`
  carries Android/GTK constraints and `spine` has its own ORT/profile. A
  workspace might help, but it is not worth destabilising the Android build
  during 0.1.8.

## If you only do one thing

Make `scripts/android-build.sh` the only supported APK path: init if needed,
re-apply the tracked `gen/android` patches, **stage the models**, then build.
Everything else in this report is an improvement; without this, 0.1.8 can ship
an APK where the headline feature is silently absent.
