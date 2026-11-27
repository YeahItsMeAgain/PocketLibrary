# Size and cleanup survey — files, cohesion, dead code

**Date:** 2026-11-27
**Scope:** `core/src`, `src-tauri/src`, `spine/src`, `src`. Excludes
`node_modules`, `dist`, `target`, `perf/.build`, `src-tauri/gen`, test fixtures.
**Status:** advisory only. No code, test or config changed; this is the only
file added.
**Companion:** `.scratch/codebase-health/2026-11-27-spine-era-survey.md`
(architecture/release findings). This pass does **not** repeat its findings.

## Caveat: the tree was moving

`core/src/spine_cache.rs`, `core/src/spine_queue.rs`,
`src-tauri/src/spine_service.rs`, `core/src/api.rs`, `core/src/service.rs` and
`docs/build.md` were being edited while this was measured (the spine-cache
consolidation from the first survey is landing). Line numbers below are
approximate for those files. Anything marked **in flux** should be re-checked
after that work lands.

Measurements: `wc -l`, frontend `npx tsc --noEmit` (clean),
`cargo check` for `core` and `spine` (no warnings). TypeScript `noUnusedLocals`
does not flag unused **exports**, so the dead exports below were found by
cross-referencing every symbol against every file.

## 1. Largest files

| # | Lines | Bytes | File | One-line purpose | Verdict |
|---:|---:|---:|---|---|---|
| 1 | 5,377 | 104 KB | `src/App.css` | Every wall, detail, reader, settings and studio style in one sheet | **leave alone** (sectioned) |
| 2 | 3,236 | 104 KB | `src/platform.ts` | Wire types, Tauri adapter, and a full 71-command mock adapter | **split** |
| 3 | 2,630 | 94 KB | `core/src/enrichment.rs` | Open Library/IA provider, matching, TTL cache, cover choice store | **split** |
| 4 | 2,202 | 79 KB | `core/src/service.rs` | SQLite catalog: books, shelves, labels, reading, downloads, settings | **split** (one domain) |
| 5 | 1,933 | 54 KB | `src/library/SpineStudio.tsx` | Canvas spine renderer (3 styles) + the interactive Studio UI | **split** |
| 6 | 1,746 | 52 KB | `src-tauri/src/lib.rs` | 71 Tauri commands + Android/desktop shell I/O for backup & diagnostics | **split** |
| 7 | 1,427 | 47 KB | `src/reader/EpubReader.tsx` | EPUB lifecycle, locator, selection, annotation UI | **watch** |
| 8 | 1,369 | 44 KB | `core/src/backup.rs` | Backup manifest, archive I/O, merge/replace, placement restore | **watch** |
| 9 | 1,069 | 38 KB | `src/library/DetailPanel.tsx` | Book-detail sheet: metadata, labels, status, enrichment, cover, delete | **split** |
| 10 | 939 | 32 KB | `core/src/download.rs` | Download state machine, mirrors, resume, filename policy | fine |
| 11 | 835 | 26 KB | `src/reader/PdfReader.tsx` | PDF.js lifecycle, page/zoom chrome, annotations | **watch** |
| 12 | 787 | 25 KB | `src/App.tsx` | App shell: nav, drawer, update banner, enrichment backfill | fine |
| 13 | 747 | 23 KB | `core/src/models.rs` | The single Rust wire-model source | fine |
| 14 | 727 | 23 KB | `core/src/acquisition/parse.rs` | Libgen HTML parsing and search-URL construction | fine |
| 15 | 715 | 25 KB | `src-tauri/src/spine_assets.rs` | Model extraction, hashes, ORT loading/JNI | **watch** |
| 16 | 698 | 25 KB | `src-tauri/src/spine_service.rs` | Engine invocation, per-book guard, wire artifact | **watch** (in flux) |
| 17 | 660 | 19 KB | `src/library/LibraryWall.tsx` | Wall data loading, windowing, filtering, drag glue, overlays | **split** |
| 18 | 639 | 19 KB | `src-tauri/src/updates/mod.rs` | Updater settings, check/download/install plugin | fine |
| 19 | 639 | 21 KB | `core/src/metadata.rs` | EPUB/PDF metadata extraction | fine |
| 20 | 639 | 22 KB | `core/src/diagnostics.rs` | Session log, diagnostics summary and zip export | fine |
| 21 | 615 | 18 KB | `spine/src/ops.rs` | Image primitives: colour, stats, morphology, geometry | **leave alone** |

File count: `src` 52, `core/src` 20, `spine/src` 13, `src-tauri/src` 7.
Nothing else exceeds 600 lines.

## 2. Split proposals

Each proposal names **one** seam, the modules, and what physically moves.
"Pure move" means no behaviour or interface change; "seam" means a small new
interface has to be agreed first.

### A. `src/platform.ts` → `src/platform/` (highest value, pure move)

- `src/platform/types.ts`: lines 12–691 (wire interfaces, `Platform`,
  `isApiError`/`isLibraryUnavailable`, `LABEL_PALETTE`).
- `src/platform/mock.ts`: lines 944–3226 (the mock adapter, mock configs and
  stored state). Keep its mock-only interfaces with it.
- `src/platform/tauri.ts`: lines 785–943 (`createTauriPlatform`).
- `src/platform/index.ts`: `createPlatform`, `platform`, re-export the public
  types so the 40+ existing `from "../platform"` imports keep working.
- **Risk:** low. Pure move plus a barrel; the only care is avoiding a cycle
  (types must not import the mock). The 2,300-line mock is the single biggest
  reason an agent grepping for a wire type has to read a file of fake data.

### B. `src/library/SpineStudio.tsx` → `spineRenderer.ts` (pure move)

- `src/library/spineRenderer.ts`: lines 42–1407 — palette/contrast helpers,
  geometry, vertical/horizontal fitting, cloth/full-bleed/wrap renderers,
  dispatchers, shelf-strip crop. Export `RenderBook`, `RenderMeta`,
  `drawStyle`, `drawStrip`, `styleSize`.
- Left in `SpineStudio.tsx`: `SPINE_STYLES`, `SpineCanvas`, `SpineStudio` and
  the status/error UI (~520 lines).
- **Risk:** low. Pure move. This is **not** the first survey's TS-vs-Rust
  renderer dedup; it only stops the renderer and the UI from sharing a file.
  It also makes the remaining TS/Rust duplication visible in one place.

### C. `src-tauri/src/lib.rs` → backup/diagnostics shell I/O

- `src-tauri/src/backup_io.rs`: `BackupExport`, `BackupSelection`,
  `PendingBackup`, `BackupExchange`, `export/preview/import_backup_response`
  and their Android/desktop pairs (roughly lines 61–820).
- `src-tauri/src/diagnostics_io.rs`: `SavedDiagnostics`, `SharedDiagnostics`,
  `save/share_diagnostics_response`, picker/zip plumbing (roughly 83–940).
- Left: catalog commands, spine commands, `run()`, `generate_handler!` (which
  can list `backup_io::export_backup`, etc.).
- **Risk:** medium. Mostly a move, but the `#[cfg(target_os = "android")]`
  pairs and the `app.manage(...)` registrations must travel with it. Do it
  after 0.1.8; a missed registration fails at runtime, not compile time.

### D. `core/src/enrichment.rs` → provider module

- `core/src/enrichment/openlibrary.rs`: `OpenLibraryProvider`,
  `description_value`/`edition_*` JSON helpers, retry parsing (lines 199–674).
- `core/src/enrichment/mod.rs` keeps the types, `MetadataProvider` trait,
  matching/ISBN normalisation and `EnrichmentService`; optionally a later
  `store.rs` for the SQLite helpers at lines 2071–2490.
- **Risk:** low/medium. Pure move, but several provider helpers are private;
  the module boundary has to make exactly those `pub(super)`. ~475 lines leave
  the file that currently owns four unrelated jobs.

### E. `core/src/service.rs` → `service/labels.rs`

- Convert `service.rs` to `service/mod.rs` (`git mv`, no content change) and
  move the label domain: `LABEL_PALETTE`, `ensure_label`, `valid_label_name`,
  `validate_label_colour`, `label_name_taken`, `label_from_row*`,
  `labels_for_book_conn`, `all_book_labels`, and `impl Service` label methods
  (lines ~394–450) into `service/labels.rs`.
- Rust child modules may access the parent's private fields, so this is a move,
  not a seam. Label validation and its SQL then live in one file (~280 lines).
- **Risk:** medium. Mechanical but touches the hottest file; do it only after
  0.1.8 and with the existing tests green. Do **not** split into five domains
  at once.

### F. `src/library/DetailPanel.tsx` → `useEnrichmentActions.ts` (seam)

- Extract the enrichment/cover action cluster: `mode`, notices, busy flags,
  `review`, `runLookup`, `acceptCandidate`, `saveBlurb`, `revertDetails`,
  `handleCoverChanged` (state at 72–86, effects at 317–430, callbacks around
  200–430). Return `{ detail, setDetail, mode, busy, notice, review, actions }`.
- Keep labels, status menu, delete confirmation and the flip markup in the
  component. Delete/close stay where they are because they own navigation.
- **Risk:** medium. A real seam: the component currently interleaves network
  actions with presentation; the hook contract is easy to get wrong. ~230 lines
  move out, and the JSX drops the bookkeeping.

### G. `src/library/LibraryWall.tsx` → `useShelfWindow.ts` (seam)

- Move the shelf-window cluster: `range` state, `measureWindowTop`,
  `updateWindow`, scroll/resize listeners, reveal-on-focus, and the refs they
  own (`shelfWindowRef`, `windowTopRef`, `scrollFrameRef`, lines ~100–340).
- Return `{ range, wallRef, shelfWindowRef }` plus the measurement callback.
  Drag hooks already have their own module (`useShelfDrag.ts`), so this is the
  remaining non-render concern.
- **Risk:** medium. The refs are shared with drag; define the return shape
  before moving. Afterwards the component is mostly JSX plus overlays.

### H. `src-tauri/src/spine_service.rs` → `spine_artifact.rs` (later)

- Move `artifact_from_dir`, `read_json`, `route_wire`, `verdict_wire`,
  `jpeg_data_url`, `spine_data_url`, `bundle_bytes` into
  `src-tauri/src/spine_artifact.rs`, leaving `SpineService` (engine, guard,
  status) behind.
- **Risk:** low, but **wait**: this file is mid-refactor. Finish the cache move
  first; then the artifact codec is the only thing left that is not service
  policy.

### Candidates explicitly **not** split

- **`src/App.css`** — see "leave alone".
- **`core/src/api.rs`** (560) — it is a pure delegation facade over five
  services. Splitting it adds modules without hiding anything.
- **`spine/src/ops.rs`** (615) — stateless, section-labelled, trivially
  greppable; four files would add imports for no locality gain.
- **`core/src/backup.rs`** — one format, one archive reader, one merge policy;
  the pressure is testability, not cohesion. Revisit only if a second archive
  format appears.
- **`src/reader/EpubReader.tsx`** / **`PdfReader.tsx`** — reader lifecycle is
  genuinely one unit; if either grows, extract the annotation panel, not the
  loading logic.

## 3. Dead code and duplicated logic

### Dead code (safe to remove)

| Location | What | Why it is dead |
|---|---|---|
| `core/src/enrichment.rs:2496-2502` | `#[allow(dead_code)] struct Unused` | Nothing constructs it; the comment "Keep serde available for future cache rows" is false — serde is already used throughout the module. |
| `src/library/filter.ts:29-42` | `matchesBook` | No import; it is a line-for-line duplicate of the predicate inside `matchingBookIds`. Two implementations of the same rule invite drift. |
| `src/reader/annotations.ts:23` | `HIGHLIGHT_OPACITY` | No reader/CSS reference; the exported constant is unused. |
| `core/src/api.rs:220-224` | `Api::enrichment_state` | No caller in `src-tauri` or tests; `BookDetail` already embeds `enrichment`. |
| `core/src/enrichment.rs:1099-1103` | `EnrichmentService::state_for_book` | Only caller was `Api::enrichment_state`; `state_for` (line 2336) is the one the service uses. |
| `core/src/api.rs:57-64` | `open_with_search_and_enrichment` | No caller anywhere (the other injected constructors *are* used by `core/tests`). |
| `src/App.css:369-381` | `.v4-shelf-sentinel`, `.v4-shelf-spacer` + comment | Replaced by `.shelf-window` / `.shelf-slot` / `.v4-shelf-placeholder`; no TSX reference. |
| `src/App.css:913-923` | `.spine .goldcap` | Only the old prototypes use the class. |
| `src/App.css:2232-2236` | `.about-block` | No TSX or test reference. |
| `src/App.css:5199-5238` | `.settings-mode`, `.mode-choices` | Replaced by `.settings-choice`/`.size-choices`; no reference outside CSS. |
| `src/App.css:2813`, `3445` | `.filter-dot`, `.filter-chip` | Old filter-strip classes; live markup uses `.chip`, `.dot`, `.filter-label-chip`. (Remove only those selectors from the grouped lists.) |
| `spine/src/ops.rs:399`, `spine/src/mask.rs:365`, `spine/src/fallback.rs:162` | `min_area_rect`, `mask_overlay`, `contact_sheet` | Public but unused by the app; only `.scratch/spine-cover-art-prototype/v8-app` calls copies. Harmless today; mark `#[doc(hidden)]` or drop if the reference prototype is retired. |

Checked and **not** dead (dynamic class construction): `sticker-${kind}`,
`spine-pill--${verdict}`, `is-${download.state}`, `is-${job.state}`. Do not
delete their CSS by grepping the literal class names alone.

### Duplicated logic

1. **Cover fetch/enumeration loops — the worst logic duplication.**
   `first_usable_cover` (`core/src/enrichment.rs:1282-1318`) and
   `lookup_cover_candidates` (`1702-1775`) independently build the same
   `(key, from_supplement)` list, walk it, check cancellation, fetch, and run
   the same `cover::prepare_manual`/`validate_online` filter. The validation is
   correctly centralised in `cover.rs`; the *orchestration* is not. Extract one
   `cover_keys(candidate)` + `fetch_first_usable(...)` helper. This is a real
   behaviour drift risk (one path accepts `strict`, the other silently skips
   duplicates differently).

2. **Cross-language constants with no shared owner.**
   - 52 × 236: `spine/src/crop.rs:9-10`, `src/library/SpineStudio.tsx:46-47`,
     `src/platform.ts:971-972`, plus the mock crop `:973-978`.
   - 320-page estimate: `src-tauri/src/spine_service.rs:37` and three separate
     `|| 320` sites in `SpineStudio.tsx:1054,1320,1650`.
   - `spine-v1`: `src-tauri/src/spine_assets.rs:31` (`MODEL_DIR_NAME`) and
     `spine_service.rs:33` (`BUNDLE_ID`) are the same value in two modules; the
     cache key and model directory can drift apart.
   - Event names: `spine_queue.rs:20-21` and the literals `"spine://queue"` /
     `"spine://progress"` in `platform.ts:929,933`.
   Cheap fix on the TS side: one `src/library/spineSpec.ts` exporting
   `SPINE_W`, `SPINE_H`, `ESTIMATED_PAGES`, imported by Studio and the mock.
   Cheap fix on the Rust side: re-export `MODEL_DIR_NAME` as `BUNDLE_ID` (one
   const), not two literals.

3. **Label palette in two languages.**
   `core/src/service.rs:51-60` (colour list, validation) and
   `src/platform.ts:360-369` (colour + display names). A palette change is a
   silent mismatch: the UI offers a colour the core rejects. Put the palette in
   one wire-visible constant (`AppInfo`/a command) or generate it; do not leave
   two hand-edited arrays.

4. **`DEFAULT_SHELF_CAPACITY = 12` in three places:**
   `core/src/service.rs:40`, `core/src/backup.rs:35`, and the SQL seed at
   `core/src/migrations.rs:121`. `backup.rs` already reads the setting; its
   local constant is only a fallback. Share one public constant.

5. **Small utility copies** (low impact, easy to forget):
   `sha256_hex` at `core/src/updates.rs:165`, `core/src/spine_cache.rs:34`,
   `src-tauri/src/spine_service.rs:415`; `unix_timestamp` at
   `core/src/service.rs:2105` and `core/src/backup.rs:1364` (and `unix_now`
   at `enrichment.rs:2489`); the `data:image/jpeg;base64,` formatter in
   `enrichment.rs:2482`, `service.rs:283`, and two functions in
   `spine_service.rs`. Consolidate only if you are already in those files.

6. **Cover source labels duplicated with different copy:**
   `DetailPanel.tsx:43-50` (`"a linked Internet Archive scan"`) vs
   `CoverChooser.tsx:29-35` (`"Internet Archive"`). Same keys, two tones, two
   capitalisation rules. One `coverSources.ts` map with a documented fallback.

### Duplicate definitions (wire/commands/types)

- `SpineArtifact` is defined in Rust (`spine_service.rs:42-62`) and TS
  (`platform.ts:138-151`); `SpineStatus` and `CropBox` likewise. `Book` is
  defined in `models.rs` and `platform.ts`. That mirroring is deliberate (no
  codegen yet), so the actionable part is **not** to delete the TS types but to
  make the duplicate files obvious — see split A — and to add the contract
  check the first survey proposed. The same applies to the 71-command
  `generate_handler!` list and `platform.ts`'s `Platform` interface.
- `MOCK_APP_INFO` (`platform.ts:944-948`) still says `appVersion: "0.1.7"` and
  `schemaVersion: 5`, while `package.json`/`tauri.conf.json` are 0.1.8 and
  `SCHEMA_VERSION` is 6. Update it or derive the version from `package.json`
  (`resolveJsonModule` is on). This is the mock lying to tests about the app it
  models.
- `READY_STATE` is defined twice behind `cfg` (`spine_service.rs:522-525`):
  correct, but the type union `"ready" | "bundled"` should stay documented
  beside it.

## 4. Cleanup that reduces agent confusion

| Location | Problem | Fix |
|---|---|---|
| `docs/perf-shelf-benchmark.md:89-99` | Still describes the phase-1 design: "zero-height sentinel plus a single spacer", `IntersectionObserver`, changes in `src/App.tsx`. The code no longer has a sentinel, observer, or wall mounting in `App.tsx`; the file's own phase-2 section describes the window/slot design. An agent will implement the paragraph, not the code. | Mark that paragraph "Phase 1 (superseded by phase 2 below)" or move it under a history heading. |
| `src/App.css:369-372` | Comment explains the dead sentinel/spacer as if they were live. | Delete with the rules. |
| `GLOSSARY.md` | Ends at **Reader**. No entries for **Spine**, **Spine style** (Wrap/Full-bleed/Cloth), **Fallback**, **Artifact**, **Automatic queue**, or **Verdict**, even though they are the 0.1.8 vocabulary and ADR-0005 leans on them. It also lists "renderer" under Reader's *avoid*, while the code and UI say "renderer". | Add the spine terms and a **Spine renderer** entry; state that Cloth is the automatic fallback. |
| `core/src/enrichment.rs:2497` | Comment claims a dead struct keeps serde "available for future cache rows"; serde is in active use. | Delete the struct and comment. |
| `src/library/SpineStudio.tsx:42` | "renderer (ported)" — ported from where? A new agent cannot tell whether it mirrors Rust, the v8 prototype, or both. | "Ported from the v8 reference pipeline; keep in step with `spine/src/fallback.rs` and the Rust constants." |
| `src/library/spine.ts:79` vs `Book.spineStyle` | `spineStyle(book)` returns shelf geometry/palette (width, lean, c1/c2), while `book.spineStyle` is the wire enum `wrap`/`full-bleed`/`cloth`. Same name, unrelated concepts. | Rename the function to `shelfSpineLook` (and its local `SpineStyle` interface to `SpineLook`). This is a 4-import mechanical rename. |
| `src/App.tsx:49` + `useShelfDrag.ts:26` + `diagnostics.ts:16` | Three different `HINT_KEY` constants in three modules (`drawerHintSeen`, `dragHintSeen`, `diagnosticsHintShown`). Grep finds the wrong one. | Prefix names by purpose (`DRAWER_HINT_KEY`, `DRAG_HINT_KEY`, `DIAGNOSTICS_HINT_KEY`) or centralise storage keys. |
| `src/library/SpineStudio.tsx:1500` | Hardcodes "The 41.2 MB model bundle" in a user-facing error. The bundle is 41,229,063 B; any model change makes the copy wrong. | Humanise `spineStatus().bytes` or say "model bundle" without a size. |
| `SpineStatus.error` (`spine_service.rs:79`, rendered at `SpineStudio.tsx:1707`) | The raw `ensure_models` error string (filesystem paths, hash mismatch detail, JNI text) is serialized to the WebView and shown as the studio's engine-problem text. It does not reach the diagnostics zip. | Map error kinds to safe copy in Rust, log the detail via `diagnostics::log_event`, and keep `error` out of the wire (or make it a code). |
| `README.md:9,57,101` | Still announces 0.1.7 and links `release-0.1.7.md` while `package.json`/`tauri.conf.json` are 0.1.8. Expected before release, but agents copy the version. | Update with the 0.1.8 release notes at cut time; not before. |

Checked and fine: `CONTRACT.md:39` now correctly says 104 × 472 with the 52 ×
236 downsample; `docs/build.md` now documents the one-shot Android build.
Do not "fix" those again.

## 5. Ranked by impact / effort

### Safe now (small, no release risk)

1. **Delete the dead blocks/symbols** listed above: `.v4-shelf-sentinel`/
   `.v4-shelf-spacer` + comment, `.goldcap`, `.about-block`,
   `.settings-mode`/`.mode-choices`, `.filter-dot`/`.filter-chip`; Rust
   `struct Unused`, `Api::enrichment_state`, `state_for_book`,
   `open_with_search_and_enrichment`; TS `matchesBook`, `HIGHLIGHT_OPACITY`.
   ~60 CSS lines and ~50 Rust/TS lines, zero behaviour change.
2. **Centralise TS spine geometry**: add `src/library/spineSpec.ts`
   (`SPINE_W = 52`, `SPINE_H = 236`, `ESTIMATED_PAGES = 320`) and use it in
   `SpineStudio.tsx` and the mock. Kills the most-copied magic numbers in the
   frontend.
3. **Fix `MOCK_APP_INFO`** (version 0.1.8, schema 6) or derive the version from
   `package.json`. One-line test-integrity fix.
4. **Docs truth pass**: mark the phase-1 perf paragraph superseded, add spine
   terms to `GLOSSARY.md`, correct the two misleading comments. Cheap and
   prevents the next agent from rebuilding removed machinery.

### After 0.1.8 ships

5. **Split `src/platform.ts`** (A). Biggest navigation win; pure move.
6. **Extract `spineRenderer.ts`** (B). 1,365 lines of canvas code stop hiding
   the Studio.
7. **Extract the enrichment provider** (D) and **the label domain** (E) from
   `core`, in that order — provider is lower risk.
8. **Split `lib.rs` backup/diagnostics I/O** (C).
9. **Extract `useEnrichmentActions`** (F) and **`useShelfWindow`** (G).
10. **Consolidate the palette / defaults / event names** with a real owner
    (wire constant or generated module), not another hand-edited copy.

### Bigger refactor (do not bundle with 0.1.8)

11. One authoritative spine renderer or a shared style/spec artifact (already
    the first survey's finding; this report only adds that the TS renderer
    should be one module first, so the boundary is visible).
12. Codegen or a contract test for the Rust↔TS wire types, commands and events
    (also first-survey; the duplicate lists here are the input to it).
13. `core/src/service.rs` further domain split (shelves, reading, downloads)
    **only if** labels proves the pattern is cheap.

## 6. Leave alone (justified size)

- **`src/App.css` (5,377).** It is already divided into 16 labelled sections
  (room, masthead, filter, wall, spines, detail, sticker, drag, drawer, misc,
  studio, placeholders, app info, front desk, downloads, diagnostics,
  enrichment, queue). The v4 room uses shared custom properties and
  order-sensitive overrides; moving sections into per-component sheets would
  make cascade order an import-order accident and duplicate palette variables.
  Its problem is ~55 lines of dead rules, not its size. Clean those, keep the
  single sheet.
- **`src-tauri/src/lib.rs`'s thin command wrappers.** Tauri's
  `generate_handler!` requires concrete functions; a macro layer would hide
  more than it saves. Split only the shell *I/O* (proposal C), leave the
  one-line delegations.
- **`src/platform.ts`'s mock adapter.** It mirrors 71 commands, but it is the
  second adapter at a real seam and what lets Playwright run without a device.
  Split the file; do not delete or "simplify" the mock.
- **`core/src/api.rs` (560).** Facade only; every method delegates. Splitting
  it would add files with no behaviour.
- **`spine/src/ops.rs` (615).** Pure stateless image math, already grouped by
  colour/statistics/morphology/components/geometry/integral/histogram. Four
  modules would add import noise.
- **`core/src/backup.rs` (1,369).** Manifest types, archive reader and
  merge/replace policy belong together; the file is long because backup has
  many columns, not because it has several jobs.
- **`.scratch/spine-cover-art-prototype` and `prototype/design`.** Historical
  design sources. The dead `pub` helpers in `spine/src` exist because the v8
  reference copy calls them; do not delete the prototype to make a grep clean.
  Retire both together, deliberately.

## 7. Top 3

1. **Split `src/platform.ts` into `types` / `tauri` / `mock` / `index`**
   (proposal A). It is a pure move, and it removes the 2,300-line mock from the
   path of every wire-type search. Highest agent-context return per hour.
2. **Extract `src/library/spineRenderer.ts` from `SpineStudio.tsx`**
   (proposal B). ~1,365 lines of canvas code move behind one module, leaving a
   ~520-line Studio. Also makes the remaining TS↔Rust renderer duplication
   reviewable in one place.
3. **Do the dead-code and truth sweep** (safe-now items 1–4): delete the dead
   CSS/Rust/TS symbols, add `spineSpec.ts`, fix `MOCK_APP_INFO`, and correct
   the stale perf paragraph, spine comment and glossary. It is a few hours,
   touches no behaviour, and removes the specific traps — a sentinel that no
   longer exists, a struct that exists only for a false comment, and a mock that
   claims the wrong version — that send the next agent down the wrong path.
