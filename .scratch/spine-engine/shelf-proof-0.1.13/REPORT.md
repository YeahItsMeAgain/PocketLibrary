# Spine shelf art — 0.1.13 reproduction and fix

Build under test: `0.1.12 / 1012` code, fixed in the working tree for `0.1.13`.

## 1. Real engine, real covers (host)

ONNX Runtime used (x86-64): `/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0`.
Models used: `src-tauri/gen/android/app/src/main/assets/spine/` (the APK assets;
their hashes match the extracted 0.1.12 APK).

```bash
export ORT_DYLIB_PATH=/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0
MODELS=src-tauri/gen/android/app/src/main/assets/spine
OUT=.scratch/spine-engine/repro-0.1.13/raw
./spine/target/release/spine-host run \
  --cover <cover> --title <t> --author <a> --pages <n> \
  --out "$OUT/<slug>" --models "$MODELS" --migan "$MODELS/migan_pipeline_v2.onnx"
```

| cover | route | verdict | mask | crop_box_work | spine-2x.jpg |
|---|---|---|---|---|---|
| `test-assets/cover.jpg` | `text-free crop` | `pass` | 6.68% | `[283,0,126,570]` | yes |
| `.scratch/.../v2/covers/source/dorian-gray.jpg` | `text-free crop` | `pass` | 8.52% | `[340,0,126,570]` | yes |
| `.scratch/.../v2/covers/source/alice.jpg` | `text-free crop` | `pass` | 6.31% | `[269,0,126,570]` | yes |

All three produced all seven files. **The real engine does not return
`fallback` for normal covers on this host.**

## 2. Real projection path (`core::spine_strip`)

`core/tests/spine_repro_013.rs` copies each `spine-host` output into the
production cache with `artifact_from_dir` + `install_artifact`, then calls
`cached_strips`, `artifact_book_ids`, `shelf_book_ids` and `apply_cached_strips`.

```bash
cd core
SPINE_REPRO_DIR=$PWD/../.scratch/spine-engine/repro-0.1.13/raw \
SPINE_REPRO_STRIPS=$PWD/../.scratch/spine-engine/shelf-proof-0.1.13/strips.json \
cargo test --test spine_repro_013 -- --nocapture
```

Output:

```text
projection: scanned=3 projected=3 skipped=0 strips=3
  book 1 verdict=pass bytes=12727
  book 2 verdict=pass bytes=10359
  book 3 verdict=pass bytes=12151
artifacts: {1, 2, 3} shelf: {1, 2, 3}
```

So the generation → cache → projection → `list_books` payload path is sound
when the artifact is usable.

## 3. Web UI proof

`proof.mjs` boots the real web UI (mock platform seeded with the three **real
projected data URLs**, not synthetic art) and screenshots the wall.

Artifacts:

- `shelf-390.png`, `shelf-320.png` — three painted spines.
- `settings-spine-panel.png` — new Artifact / Shelf strip / Verdict columns.
- `strips.json` — the projected data URLs fed to the mock.

DOM for all three spines:

```text
class="spine book has-generated"
data-spine-state="ready"
img.spine-generated naturalWidth=52, z-index=2, display=block,
visibility=visible, opacity=1, box ~27x233 .. 36x233
```

**The strip paints in the browser.** There is no z-index, `has-generated`,
`spineStyle`, or image-load bug on the rendering side. The previous failures
were upstream of the DOM.

Settings with one pass, one fallback and one missing artifact:

```text
1 of 3 books can paint spine art · 2 artifacts on disk
The Test Book              Artifact Present, Shelf strip Paints art, Verdict pass
The Picture of Dorian Gray Artifact Present, Shelf strip quality gate returned fallback, Verdict fallback
Alice's Adventures...      Artifact Missing, Shelf strip Missing, Verdict —
```

## 4. Root cause proven in the shipped code

Which device case is it? Without the device cache (`adb devices` finds no
device) a single letter cannot be proven. Two of the four are reachable and
both produce exactly "cloth shelf + empty Settings queue":

- **(b) artifact exists but projection skips.** Pre-fix `cached_book_ids()`
  only read `artifact.json` and checked `book_id > 0`; it never decoded
  `spine-2x.jpg` nor checked the artifact `spine_data_url`. Height/width 0 or a
  missing runtime file (or a corrupt stored URL) counted the book as done
  forever. The launch repair skipped it, the queue stayed empty, and
  `apply_cached_strips` had no strip to stamp.
- **(c) artifact projects with verdict `fallback` and is filtered.** Pre-fix
  the worker treated *any* `Ok(artifact)` as success, so a `fallback` verdict
  was logged as success, incremented `completed`, and produced no attention
  row. `cached_book_ids` also counted it as cached. Settings showed "artifact
  present / nothing failed"; `apply_cached_strips` correctly refused to paint
  it. This exactly matches the report, and is the more likely of the two
  because Settings also showed zero failures.

(a) no artifact: the old repair would enqueue, so it does not match "queue
empty". (d) payload strip not painted: disproved by the browser proof above.

## 5. Fix

One definition: **done = a shelf-eligible projected strip**
(`core::spine_strip::shelf_book_ids`, `SpineService::shelf_book_ids`,
`SpineCachedStrip::is_shelf_eligible`). `pass` and `review` paint; `fallback`
never does. `artifact_book_ids` remains a separate "file exists" fact for
Settings.

- `core/src/spine_strip.rs`
  - `artifact_book_ids` (file exists) vs `shelf_book_ids` (projects and not
    fallback).
  - `shelf_strip(dir)` used by the worker before inference.
  - projection now falls back `spine-2x.jpg` → artifact `spine_data_url` →
    artifact `art_data_url`, so a lost runtime file still paints.
  - `CachedStrips::shelf_strips/fallback_count`; the log line reports
    `scanned/projected/skipped/shelf/fallback`.
- `core/src/spine_queue.rs`
  - `MAX_AUTOMATIC_ATTEMPTS = 3`, `attempts()` and
    `automatic_attempt_due()`. After the cap the row stays in `attention`
    until an explicit Retry.
- `src-tauri/src/spine_service.rs`
  - cache reuse (`generate`) and `is_cached` require `shelf_strip`, not a raw
    artifact. Explicit Generate on a fallback artifact now regenerates.
- `src-tauri/src/lib.rs`
  - `spine_cached_strips` sends only shelf-eligible strips to the wall, so a
    fallback artifact is not hydrated as ready art and the launch repair sees
    it as missing. `shelf_books` logs `scanned/projected/skipped/shelf/fallback`.
- `src-tauri/src/spine_queue.rs`
  - launch repair uses `shelf_book_ids`; a present-but-unusable artifact is
    enqueued. Books that already spent their automatic attempts are not
    re-enqueued.
  - worker skips only shelf-eligible entries, stops auto-retrying at the cap,
    and turns `verdict == fallback` into a `spine_fallback` attention row.
- `src-tauri/src/spine_diagnostics.rs`
  - reports `artifactPresent`, `shelfStripPresent`, `verdict`, `shelfReason`,
    plus `shelfReady` / `artifactsPresent`.
- `src/library/spineActivity.tsx`
  - fallback hydrate marks the job `needs-attention`; real strips clear a
    stale marker. (The shell no longer sends fallback through the shelf
    hydration command; this remains the defensive path for live artifacts.)
- `src/settings/SpineStatusPanel.tsx`
  - separate Artifact / Shelf strip / Verdict columns, summary of books that
    can actually paint, Retry all targets books without a shelf strip.
- `src/platform/mock.ts` (spine only)
  - fallback artifacts are not treated as cached; generation returning
    fallback becomes `spine_fallback`; diagnostics expose the new fields.
- `src/library/Shelf.tsx` unchanged: it already suppresses art only for an
  explicit `"cloth"`; NULL/unknown both paint. Locked with a new e2e test.

User-visible rule: **`review` paints and counts as done** (QA warns but the art
is real). **`fallback` never paints**; it is retried automatically up to 3
times, then the shelf marker, activity chip and Settings row stay until the
user taps Retry. Settings always distinguishes "artifact on disk" from "shelf
strip can paint".

## Known interaction (outside this change's files)

In 0.1.12, a manual Generate in Edit that returns `fallback` calls
`applyAutomaticCloth`, which persists `spine_style = 'cloth'` for that book.
A later successful automatic regeneration then has usable art but the stored
Cloth style still suppresses it on the shelf. `src/library/SpineStudio.tsx`
was outside this task's ownership and is being edited concurrently, so it was
not changed here. Settings now flags that case as "Suppressed by Cloth style"
so it is never silent. If that auto-applied style should not outlive a
fallback, that file should apply Cloth only to the preview, not persist it;
otherwise an explicit Cloth must remain respected. This does not affect the
automatic-queue path (the default Wrap style) that produced the reported empty
queue.

## 7. Tests that fail without the fix

- `core/src/spine_strip.rs`:
  `a_fallback_artifact_is_present_but_not_a_shelf_strip`,
  `an_unprojectable_artifact_is_not_a_shelf_strip`.
- `core/src/spine_queue.rs`: `automatic_retries_stop_at_the_attempt_cap`.
- `src-tauri/src/spine_service.rs`:
  `fallback_and_unprojectable_artifacts_are_not_shelf_ready`.
- `tests/e2e/spine-queue.spec.ts`:
  `a fallback verdict stays on the cloth spine and asks for attention`,
  `a cached fallback artifact is regenerated and paints when QA passes`,
  `Settings separates artifact presence from a paint-capable shelf strip`,
  `Settings reports a Cloth-style book as suppressed even with usable art`,
  `a NULL or unknown style never suppresses generated art`.

Run: `npx playwright test tests/e2e/spine-queue.spec.ts --workers=1` → 25 passed;
`cargo test --manifest-path core/Cargo.toml` → all passed;
`cargo clippy ... core` → clean; Android `cargo check --tests` → clean.
