# 18: App architecture and performance refactor

**What to build:** Break the 4,865-line `App.tsx` into feature modules and fix the costs that actually hurt — full-wall memory, first paint, and filtering — without changing the design, behaviour, or framework.

**Blocked by:** 17 (diagnostics) — start after the v0.1.1 release cut.

**Status:** ready-for-agent

## Problem

- `App.tsx` holds ~4,865 lines, 68 `useState`, 23 `useEffect`, and 161 hook calls. Navigation, library, labels, search, downloads, settings, backup and reader routing all live in one component.
- The wall mounts every shelf it has ever shown and never unmounts, so memory grows as the user traverses a 2,000-book library.
- Filtering writes classes/attributes across up to 2,000 spines through React; ~35 ms today, and it will grow with the catalogue.
- First shelf is consistently 475–600 ms against a 400 ms budget; the initial payload includes readers/acquisition, an 82 kB noise asset and full font files.
- Prop drilling and mixed concerns make each new feature touch the same file, which is why every ticket has been a merge risk.
- A SolidJS migration is **not** the fix (ADR 0004): it changes syntax, not architecture; 25–40 days, nine-day-old major, same DOM and first-paint work.

## Design

### 1. Feature modules, not a god component

Split by capability, keeping the existing platform adapter as the only Tauri boundary:

- **App shell** — providers, layer/back-stack orchestration, error boundary, diagnostics hook.
- **Library** — wall, shelf, spine, book detail, placement/drag.
- **Labels** — label manager, chips, filters.
- **Search/acquisition** — front desk, results, result detail.
- **Downloads** — queue state and progress presentation.
- **Settings** — folder, reader defaults, naming, backup, about, diagnostics.
- **Backup** — export/import flow.
- **Reader** — existing EPUB/PDF modules, untouched except integration.

Each module exposes a small interface to the shell (view + actions); no module imports the shell's internals.

### 2. State by capability

- Extract `useLibrary`, `useLabels`, `useDownloads`, `useSearch`, `useSettings`, `useNavigation`.
- Use a reducer for wall/layers where transitions are complex; context only for platform and settings. No single global store.
- Separate command/server state from UI state; typed loading/error per feature.
- Keep the existing `useLayerExit`/history guard as the only back-stack implementation.

### 3. Shelf lifecycle

- Windowed mounting: mount the visible shelves plus one on each side, replace the rest with exact-height placeholders; recycle nodes as the window moves.
- Preserve scroll position and avoid animation jumps; drag and edge auto-scroll must work across a recycled boundary.
- Keep `content-visibility`; benchmark before/after.
- Target: full-wall traversal memory stays flat; scroll p95 ≤20 ms, p99 ≤33 ms.

### 4. Filtering

- Keep the imperative/data-attribute pass outside React, memoize spines, and wrap filter input in `useDeferredValue`.
- Filtering must not re-render the wall or move books.
- Target <20 ms for 2,000 books.

### 5. First paint

- Replace/compress the noise asset (target <10 kB).
- Subset the three serifs to the glyphs used; preload them.
- Code-split readers, search and settings out of the initial bundle.
- Trim initial IPC: first shelves and counts only; book detail loaded on open.
- Add a shelf skeleton so content appears immediately.
- Target: first shelf ≤400 ms at 4x throttle; no long task >50 ms during load after the bundle evaluates.

### 6. Regression gates

- Make `perf/bench.mjs` a threshold check in the release checklist: fail on >10% regression in first shelf, scroll p95/p99, filter, lift sweep, or DOM.
- E2E stays green after every extraction commit.

## Acceptance criteria

- [ ] `App.tsx` is shell-only (roughly <800 lines); each feature module is independently readable and under ~600 lines.
- [ ] No visual or behavioural regressions: 74+ e2e pass, reader/drag/filters/back stack/import-export still work.
- [ ] Full-wall traversal memory stays flat with windowed shelves; no scroll jumps at recycle boundaries.
- [ ] Filtering 2,000 books under 20 ms, no wall re-render.
- [ ] First shelf ≤400 ms at 4x throttle, or the residual is documented with a measured floor.
- [ ] Benchmark and screenshots recorded before/after.
- [ ] No framework migration.

## Sequencing (each its own commit, e2e green)

1. Extract the shell, navigation and platform wiring.
2. Extract library/wall/shelf/spine/detail.
3. Extract labels, search, downloads, settings, backup.
4. Windowed shelf lifecycle + memoised filter + first-paint assets.
5. CI/checklist performance gates.

## Out of scope

- SolidJS or any framework migration.
- Visual redesign.
- New features.
- Reader engine changes.

## Risks

- Mechanical moves can hide behaviour changes; keep commits pure moves first, then optimize.
- Shelf recycling can break drag/auto-scroll; test boundary drags explicitly.
- First paint may hit a platform floor; record the number instead of gutting the design.
