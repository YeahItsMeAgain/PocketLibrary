# On-device spine engine — required models, wrap default, shelf flow

**Status:** ready-for-agent
**Tracker:** local `.scratch/spine-engine/`
**Blocked by:** none (prototype evidence exists in `.scratch/spine-cover-art-prototype/`)

## Problem Statement

The prototype suite proves the route: a downloaded cover becomes a text-free spine on an
arm64 phone, and the renderer turns that art into Full-bleed, Textless, Wrap, Hybrid, Cloth and
Editorial spines. But all of it lives beside the app, not inside it. The app has no spine engine,
no model delivery, no per-book cache and no wrap renderer.

The earlier plan treated MI-GAN as an optional 28 MB download and flat fill as the safe default.
That is now a product decision the other way: **the models are required, fetched automatically,
cached, and every inference runs on the device.** No hosted inference, no API key, no per-book
upload. Wrap is the preferred presentation because it survives shelf scale and gives the spine and
back a place to live.

## Chosen route (locked)

These seven decisions are fixed. Treat them as constraints, not options.

1. **On-device Rust/ONNX pipeline plus wrap presentation.** Inference runs inside the app on the
   device. No hosted inference, no API key, no per-book upload.
2. **Models are required runtime dependencies, not optional.** Bundle id `spine-v1`: det FP32
   2,432,880 B, rec FP32 10,690,752 B, keys 26,250 B, MI-GAN 28,079,181 B — total 41,229,063 B.
   The detector stays FP32 because it is the version the validated pipeline used; INT8 detection was
   slower and weaker on display type.
   The feature does not work without them.
3. **Production delivery is automatic download plus cache**, visible and cancellable. The test APK
   may bundle the same files as assets. Either way inference is fully on-device. For the 0.1.8 build
   the models ship **bundled**; the first-run downloader is a separate release ticket (Settled §12).
4. **MI-GAN is required** — it is the inpaint route. **LaMa is excluded entirely. rec INT8 is
   excluded** (it returned no text, which breaks the QA gate).
5. **Wrap is the default style.** Full-bleed is the alternate. Cloth is the automatic fallback for
   review and fallback verdicts. Hybrid, Textless and Editorial are **deleted** (Settled §4).
6. **Curated packs are bonus only.** Remote generative art is out of scope. `bookcover-js` is a
   design reference only.
7. **Quality gate:** `pass` → apply; `review` → show the spine plus **Use Cloth**; `fallback` →
   Cloth automatically.

## Settled — automatic flow

The latest grilling round settled the automatic flow. This section is binding. Where it disagrees
with manual-only or six-style wording later in this file, **this section wins** and the older text is
marked superseded. [CONTRACT.md](CONTRACT.md) carries the same seam.

### 1. Every path generates

A spine job is queued for **every path that yields a cover and a page count**: downloads, imports,
scans, manual edits, metadata enrichment and a manual cover pick. The user never has to open a studio
to get a spine. The book appears immediately in Cloth and swaps to the generated spine when it is
ready. "On demand only" is no longer an option; **Generate** remains as a manual override, not the
entry path.

### 2. Progress is quiet and honest

- One global activity chip reads **"Preparing spines · n of m"**, backed by a per-book state.
- Stage labels are real work: **preparing art · removing text · checking**. No fake percentage.
- The chip is hidden while the reader is open.
- One **"Stop preparing"** control pauses the queue. It is a pause, not a per-book Cancel. A manual
  **Generate** jumps the queue.

### 3. Failure

One automatic retry, then the book settles on **Cloth** with a small persistent marker and a detail
note explaining what happened. A `review` verdict keeps the generated spine and offers **Cloth** as
the alternative.

### 4. Styles

Only **Wrap**, **Full-bleed** and **Cloth** remain. **Hybrid, Textless and Editorial are deleted, not
hidden** — code, copy and tests go with them. Wrap is the default. Per-book style persists in a new
`books.spine_style` column (**migration 6**), default `wrap`.

### 5. Full-bleed and contrast

Full-bleed places title and author centred on both axes as **one block** over a soft gradient scrim.
Two lines maximum, shrink to fit, **never truncate**. Wrap rail type uses the same contrast guard.

### 6. Cover changes

Changing the cover cancels and replaces that book's job; regeneration is automatic. No stale art
survives a cover edit.

### 7. Queue

One FIFO worker. Automatic jobs run one at a time. **Generate** jumps the queue. The queue survives
process death: unfinished book ids are persisted and re-queued on next launch. When models are
missing the queue **waits** for them instead of dropping jobs.

### 8. Cache

200 MB LRU budget. Only runtime files are app cache: `art.jpg`, `spine-2x.jpg`,
`fallback-spine.jpg`, `run.json`, `qa.json`, `artifact.json`. `source.jpg` and `mask.png` are pipeline
scratch, not app cache. Trim by LRU mtime after each completed job.

### 9. Backfill

The existing library is backfilled **once**, at low priority behind new jobs.

### 10. Reader pause

Automatic jobs pause while the reader is open and resume on close. Manual **Generate** still runs.

### 11. RTL

Hebrew and other RTL titles are handled now: first-strong-character direction detection, mirrored
alignment, and a Hebrew fixture in the renderer tests.

### 12. Build 0.1.8

Version **0.1.8** / versionCode **1008**. Models stay **bundled** for this build; the first-run
downloader moves to a separate release ticket. The engine, queue, progress and reduced styles ship on
the bundled path.

### 13. Unknown page count

A book with no page count still generates, using a clamped **~320-page estimate** and an
`approximate` label on the spine.

## Solution

Add a `SpineEngine` to the Tauri app with four parts:

1. **Model delivery** — one required, versioned bundle of ~41.2 MB, downloaded automatically on
   first run, resumed if interrupted, SHA-256 verified, installed atomically and cached.
2. **Per-book pipeline** — the v8 Rust/ONNX chain (DBNet → mask → text-free crop / MI-GAN inpaint
   → QA) run in a background worker with progress and cancel.
3. **Wrap renderer** — the prototype wrap compositor ported into the app, fed by the pipeline's
   own `run.json` crop box and `art.jpg`.
4. **Shelf and detail presentation** — Wrap by default at 33 px, style switch in detail, Cloth as
   the automatic fallback when QA says review or fallback.

Model delivery is blocking for the feature but **not for the app**. Without models, the shelf still
paints typographic cloth spines from title, author and page count; it simply does not offer art
spines until the bundle is installed.

## Model bundle

Bundle id `spine-v1`. Total **41,229,063 bytes (41.23 MB)**.

| File | Bytes | SHA-256 | Role |
|---|---:|---|---|
| `det.onnx` | 2,432,880 | `3439588c030faea393a54515f51e983d8e155b19a2e8aba7891934c1cf0de526` | DBNet text detection, FP32 (validated pipeline) |
| `rec.onnx` | 10,690,752 | `897a3ededb38fee0dae2c1ccee38241f37df202c9509e3abca02e9217c5ee615` | OCR recognition, FP32 — residual-text QA |
| `keys.txt` | 26,250 | `a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492` | Recognition dictionary |
| `migan_pipeline_v2.onnx` | 28,079,181 | `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b` | MI-GAN inpainting for text-heavy covers |

Rules:

- **Expected hashes are compiled into the app**, not trusted from the download manifest. The remote
  manifest supplies URLs, sizes and progress labels only. A compromised host cannot swap weights.
- **MI-GAN is required.** It is no longer an optional enhancement. The inpaint route is what keeps
  covers like *The Whisper Man* and *The War of the Worlds* passing after download.
- **LaMa is not shipped** in any form: FP32 is 208 MB and ~1 GB peak; INT8 Conv-only was rejected for
  visible chroma scars and 18–20 s runtime.
- **rec FP32 is not replaced by rec INT8.** INT8 recognition returned zero text on every 52 × 236
  text spine tested, so the residual-text gate would silently stop working.
- The bundle is **atomic**: one version directory, one verification marker. No partial bundle is
  ever loaded.

## Delivery and cache

### Download

- Trigger: app start, after the first shelf paint, when `spine-v1` is absent or unverified.
- Source: immutable HTTPS URLs from the GitHub release assets already used by the updater, with a
  small JSON manifest at a stable path.
- Resume: HTTP `Range` from the existing `.part` length. Interrupted downloads keep their bytes.
- Retry: exponential backoff (1 s, 4 s, 15 s, 60 s), then a quiet "Retry" row. No infinite loop.
- Single flight: one download at a time, guarded by a lock file, so two screens cannot race.
- Verification: per-file SHA-256, then a written `verified.json` inside the version directory.
- Atomic install: download into `models/spine-v1.tmp/`, verify, rename to `models/spine-v1/`. A
  failed verify deletes the temp directory and retries once before surfacing an error.
- Storage guard: require free space ≥ bundle size × 2 before starting; otherwise show a storage
  message and leave the shelf untouched.
- Network: automatic on both unmetered and metered connections, because the decision is that models
  are required. The download is always **visible** with bytes and a cancel control; it is never a
  silent background transfer the user cannot stop.
- Cancel keeps the `.part` file and can be resumed later or on next launch.

### Cache layout

```
<app data>/spine/
  models/
    spine-v1/            det.onnx rec.onnx keys.txt migan_pipeline_v2.onnx verified.json
    spine-v1.tmp/        partial install, deleted on failure
  books/
    <cache-key>/
      art.jpg  spine-2x.jpg  fallback-spine.jpg  run.json  qa.json  artifact.json
```

> **Superseded by Settled §8.** The cache holds only runtime files and is trimmed to 200 MB by LRU.
> `source.jpg` and `mask.png` are pipeline scratch and must not be written into the app cache;
> `wrap.json`/`wrap.png` are renderer output, not cache.

`cache-key = sha256(content hash | cover hash | page count | design version | bundle id)`.
A page-count edit only re-runs the cheap wrap composition; changing the cover, the book file, the
design version or the bundle id invalidates the whole entry. A style switch never invalidates the
entry (style is per-book state, not part of the key). Deleting a book deletes its entry.
A version bump garbage-collects `models/spine-v0` at next launch.

## End-to-end flow on the phone

### First run

For 0.1.8 the models are bundled, so there is no first-run download. The downloader flow below is
retained for the separate release ticket that replaces the bundled assets (Settled §12).

1. Shelf paints immediately from the existing database. Nothing waits on models.
2. A quiet row in Settings → Spine reads **"Spine engine — downloading 12% of 41.2 MB"**.
3. On completion the row becomes **"Spine engine ready"**. No modal, no blocking screen.
4. If the device is offline, the row says **"Spine engine needs a one-time download"** with a Retry
   action. Spines remain typographic until it succeeds.

### Adding a book

Entry points, all feeding the same job:

- **Download** from the metadata/cover flow.
- **Import** an EPUB/PDF.
- **Scan** a barcode.
- **Manual** entry, then pick or photograph a cover.
- **Metadata enrichment** that later fills in a cover, and a **manual cover pick**, both queue a job.

Cover order stays keyless: embedded cover → Open Library / metadata enrichment → user picker →
camera photo of the physical book → typographic plate. Every path that ends with a cover and a page
count queues automatically (Settled §1).

### Generating

1. The job is queued the moment the book has a cover and a page count.
2. A worker (one at a time, FIFO) runs:
   `cover → page/frame detection → DBNet → CIELAB mask → route (crop | inpaint | fallback) → 52 × 236 QA`.
3. Progress is coarse and honest: **preparing art · removing text · checking**. No fake per-pixel
   percentage. A single global chip reads **"Preparing spines · n of m"**, with per-book state; the
   chip is hidden in the reader.
4. The shelf shows the plain cloth spine while the job runs, then swaps to the generated spine when
   it lands. It never shows an empty slot or a spinner on the shelf.
5. Host reference: 2.6–13.8 s per book, 450–500 MB peak, MI-GAN 1.9–2.3 s. Phone numbers are
   unmeasured; the UI is designed for **5–20 s**, not 3 s.
6. Leaving the detail screen does not cancel the job. The only queue control is **Stop preparing**,
   which pauses automatic work; manual **Generate** jumps the queue (Settled §2, §7).

### Presenting

- **Shelf:** the 33 px wrap spine. This is the default and the only style the shelf draws.
- **Detail:** a flat wrap preview by default, with a **Spine** section offering **Wrap · Full-bleed ·
  Cloth** only. Hybrid, Textless and Editorial are deleted (Settled §4). Switching styles is a render
  from cached `art.jpg` and `run.json`, not a pipeline re-run, so it is instant.
- **Full-bleed:** title and author centred on both axes as one block over a soft gradient scrim; two
  lines max, shrink to fit, never truncate. Wrap rail type uses the same contrast guard.
- **RTL:** Hebrew and other RTL titles use detected direction, mirrored alignment, and a Hebrew
  fixture (Settled §11).
- **Export:** 300 dpi wrap PNG (and PDF if cheap). The print geometry needs the real caliper; the
  app uses the same representative paper values as the prototype and labels the export as an
  approximation until the printer's figures are entered.

### QA gate

| Pipeline verdict | What the app does |
|---|---|
| `pass` | Wrap applied automatically, no prompt |
| `review` | Wrap applied, with a small **"Check this spine"** note and a one-tap **Use Cloth** |
| `fallback` | Cloth applied automatically; the wrap stays available as a preview |

The gate is never silent. *Dune* (decorative letterforms the detector cannot box) and *Rock Paper
Scissors* (44% mask) are the reference review cases.

### Wrap composition

- `spine_mm = (pages / 2) × caliper_mm + 1.2 mm`.
- `wrap_width = 2 × trim_width + spine + 2 × bleed`; `wrap_height = trim_height + 2 × bleed`.
- Front = the published cover, unchanged.
- Spine = the text-free crop, art running continuously into the front edge.
- Back = composed from the same art: extended/mirrored crop, or the MI-GAN text-free panel. Blurb is
  optional original text; the barcode is explicitly a placeholder, not a retail barcode.
- Defaults: 6 × 9 in trim, 0.125 in bleed, cream 80 gsm at 0.100 mm per leaf, 1.2 mm cover
  allowance. Editable later; not part of v1.

## Failure states

| Situation | Behaviour |
|---|---|
| Models absent, offline | Shelf works in Cloth; jobs wait in the queue rather than dropping; no art spines |
| Download cancelled | `.part` retained; row offers **Resume** (downloader release ticket) |
| Hash mismatch | Temp deleted, one automatic retry, then **"Download failed — Retry"** (downloader release ticket) |
| Model fails to load | Bundle marked unverified, retried once, then art spines disabled with a clear message; Cloth stays |
| Out of storage | Download refuses to start with a storage message; existing cache untouched |
| Pipeline panics/hangs | One automatic retry, then Cloth stays with a small persistent marker and a detail note; no dead end |
| Cover changed mid-job | The book's job is cancelled and replaced; regeneration is automatic |
| Cover missing | No spine job; typographic plate, as today |
| Page count unknown | ~320-page clamped estimate, spine labelled `approximate` |
| Reader open | Automatic jobs pause; manual **Generate** still runs |

## Privacy / offline contract

- Inference is 100% local. No image, title, author or ISBN is sent for spine generation.
- Network use is limited to the model download and the existing opt-in metadata/cover lookup.
- Once `verified.json` exists (downloader builds) or the bundled models are extracted, the engine runs
  with the radio off. This is an acceptance test.

## Out of scope

- Remote/diffusion generative art. It stays an explicitly online, non-reproducible bonus and is not
  part of this flow.
- LaMa, rec INT8, 32-bit ABIs, x86 phones.
- Curated Textless/Popular packs (bonus content, not the mechanism).
- Interactive blurb editing and real barcode generation.

## Implementation slices

1. **Model delivery** — for 0.1.8, bundled assets + extraction; downloader deferred to a separate
   release ticket.
2. **Engine service** — port `v8-app` into `core`; `spine_generate`, `spine_cancel`, `spine_status`;
   queue; 60 s timeout; per-book cache keys.
3. **Renderers** — port `v4-wrap` geometry; **Wrap, Full-bleed, Cloth only**; delete the other three;
   full-bleed scrim, contrast guard, RTL.
4. **Shelf integration** — generated spine at 33 px, Cloth fallback, swap-on-completion without
   layout shift.
5. **Detail integration** — preview, three-style switch, QA note, **Use Cloth**, export.
6. **Automatic flow** — enqueue from every cover/page-count path; global chip; pause; retry; backfill;
   `books.spine_style` migration 6; 200 MB LRU.
7. **Device pass** — random books, cold start, warm run, 20-book batch, low-RAM and 16 KB-page
   devices, airplane-mode run, corrupt-bundle recovery.

## Open decisions

- **Export formats** for v1 — PNG only, or PNG + PDF.

Resolved by "Settled — automatic flow": auto-generate versus on-demand (automatic), styles (three),
failure behaviour, cache files/size, per-book style storage, and the 0.1.8 bundled-models scope.
Everything else is locked under "Chosen route (locked)".

## Acceptance criteria

1. Fresh install, bundled models: art spines work with the radio off and zero network requests.
2. A book added by any path — download, import, scan, manual edit, metadata enrichment, manual cover
   pick — queues a spine automatically and shows Cloth immediately.
3. Kill the app mid-queue, relaunch: unfinished jobs are re-queued and the queue resumes.
4. Import a random downloaded EPUB with a cover: a spine appears within the measured phone budget,
   with a `run.json` route and QA verdict recorded.
5. The global chip reads **"Preparing spines · n of m"** with real stage labels and no percentage;
   it is hidden while the reader is open.
6. **Stop preparing** pauses automatic jobs; manual **Generate** jumps the queue.
7. A failed job retries once, then leaves Cloth with a persistent marker and a detail note.
8. A review-verdict book keeps the generated spine and offers **Use Cloth**; Cloth renders correctly.
9. Only Wrap, Full-bleed and Cloth exist; Hybrid, Textless and Editorial are gone from code and UI.
10. Full-bleed centres title and author as one block, two lines max, shrink to fit, never truncate.
11. A Hebrew title renders right-to-left with mirrored alignment.
12. Changing the cover cancels and replaces the job without stale art.
13. Editing page count re-composes without re-running detection; a style switch never re-runs.
14. Unknown page count uses the ~320-page estimate and shows `approximate`.
15. Existing library backfills once at low priority; cache trims to 200 MB LRU and holds only the six
    runtime files.
16. Deleting a book removes its cache directory and its `spine_style` row.
