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
2. **Models are required runtime dependencies, not optional.** Bundle id `spine-v1`: det INT8
   792,710 B, rec FP32 10,690,752 B, keys 26,250 B, MI-GAN 28,079,181 B — total 39,588,893 B.
   The feature does not work without them.
3. **Production delivery is automatic download plus cache**, visible and cancellable. The test APK
   may bundle the same files as assets. Either way inference is fully on-device.
4. **MI-GAN is required** — it is the inpaint route. **LaMa is excluded entirely. rec INT8 is
   excluded** (it returned no text, which breaks the QA gate).
5. **Wrap is the default style.** Hybrid is the alternate. Cloth is the automatic fallback for
   review and fallback verdicts.
6. **Curated packs are bonus only.** Remote generative art is out of scope. `bookcover-js` is a
   design reference only.
7. **Quality gate:** `pass` → apply; `review` → show the spine plus **Use Cloth**; `fallback` →
   Cloth automatically.

## Solution

Add a `SpineEngine` to the Tauri app with four parts:

1. **Model delivery** — one required, versioned bundle of ~39.6 MB, downloaded automatically on
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

Bundle id `spine-v1`. Total **39,588,893 bytes (39.59 MB)**.

| File | Bytes | SHA-256 | Role |
|---|---:|---|---|
| `det.onnx` | 792,710 | `7c68d75a957a850fb0d0f6f3ccfb0d731de894ee5805883115ebe268edd247c7` | DBNet text detection, INT8 dynamic |
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
      run.json  qa.json  art.jpg  spine-2x.jpg  wrap.json  wrap.png
```

`cache-key = sha256(content hash | cover hash | page count | design version | bundle id)`.
A page-count edit only re-runs the cheap wrap composition; changing the cover, the book file, the
design version or the bundle id invalidates the whole entry. Deleting a book deletes its entry.
A version bump garbage-collects `models/spine-v0` at next launch.

## End-to-end flow on the phone

### First run

1. Shelf paints immediately from the existing database. Nothing waits on models.
2. A quiet row in Settings → Spine reads **"Spine engine — downloading 12% of 39.6 MB"**.
3. On completion the row becomes **"Spine engine ready"**. No modal, no blocking screen.
4. If the device is offline, the row says **"Spine engine needs a one-time download"** with a Retry
   action. Spines remain typographic until it succeeds.

### Adding a book

Entry points, all feeding the same job:

- **Import** an EPUB/PDF.
- **Scan** a barcode.
- **Manual** entry, then pick or photograph a cover.

Cover order stays keyless: embedded cover → Open Library / metadata enrichment → user picker →
camera photo of the physical book → typographic plate.

### Generating

1. The job is queued the moment the book has a cover and a page count.
2. A worker (one at a time, FIFO) runs:
   `cover → page/frame detection → DBNet → CIELAB mask → route (crop | inpaint | fallback) → 52 × 236 QA`.
3. Progress is coarse and honest: **Finding cover text · Removing text · Checking result**. No fake
   per-pixel percentage.
4. The shelf shows the plain cloth spine while the job runs, then swaps to the wrap spine when it
   lands. It never shows an empty slot or a spinner on the shelf.
5. Host reference: 2.6–13.8 s per book, 450–500 MB peak, MI-GAN 1.9–2.3 s. Phone numbers are
   unmeasured; the UI is designed for **5–20 s**, not 3 s.
6. Leaving the detail screen does not cancel the job; an explicit **Cancel** does. Cancel discards
   partial output and leaves the cloth spine.

### Presenting

- **Shelf:** the 33 px wrap spine. This is the default and the only style the shelf draws.
- **Detail:** a flat wrap preview by default, with a **Spine** section offering Wrap · Hybrid ·
  Full-bleed · Textless · Cloth · Editorial. Switching styles is a render from cached `art.jpg` and
  `run.json`, not a pipeline re-run, so it is instant.
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
| Models absent, offline | Shelf works; Spine section offers **Download engine**; no art spines |
| Download cancelled | `.part` retained; row offers **Resume** |
| Hash mismatch | Temp deleted, one automatic retry, then **"Download failed — Retry"** |
| Model fails to load | Bundle marked unverified, redownload once, then disable art spines with a clear message |
| Out of storage | Download refuses to start with a storage message; existing cache untouched |
| Pipeline panics/hangs | Job fails after timeout (60 s), cloth spine stays, **Retry** in detail |
| Cover missing | No spine job; typographic plate, as today |
| Page count unknown | Wrap uses a clamped estimate and labels the spine width as approximate |

## Privacy / offline contract

- Inference is 100% local. No image, title, author or ISBN is sent for spine generation.
- Network use is limited to the model download and the existing opt-in metadata/cover lookup.
- Once `verified.json` exists, the engine runs with the radio off. This is an acceptance test.

## Out of scope

- Remote/diffusion generative art. It stays an explicitly online, non-reproducible bonus and is not
  part of this flow.
- LaMa, rec INT8, 32-bit ABIs, x86 phones.
- Curated Textless/Popular packs (bonus content, not the mechanism).
- Interactive blurb editing and real barcode generation.

## Implementation slices

1. **Model delivery** — manifest, resumable download, hash verify, atomic install, status row,
   cancel/retry, storage guard.
2. **Engine service** — port `v8-app` into `core`; `spine_generate`, `spine_cancel`, `spine_status`;
   job queue; 60 s timeout; per-book cache keys.
3. **Wrap renderer** — port `v4-wrap` geometry + canvases into the app renderer; consume `run.json`
   and `art.jpg`; style switch.
4. **Shelf integration** — wrap spine at 33 px, cloth fallback, swap-on-completion without layout
   shift.
5. **Detail integration** — wrap preview, style switch, QA note, **Use Cloth**, export.
6. **Device pass** — random books, cold start, warm run, 20-book batch, low-RAM and 16 KB-page
   devices, airplane-mode run, corrupt-bundle recovery.

## Open decisions

- **Auto-generate on import versus on demand only.** The flow above assumes auto with a visible
  queue; on-demand is still on the table.
- **Export formats** for v1 — PNG only, or PNG + PDF.

Everything else is locked under "Chosen route (locked)".

## Acceptance criteria

1. Fresh install, online: the 39.6 MB bundle downloads, verifies and enables art spines without any
   user action beyond leaving the app open; progress is visible and cancellable.
2. Fresh install, offline: every book still gets a cloth spine; the Spine section explains the
   one-time download and offers Retry.
3. Kill the app mid-download, relaunch: the download resumes from the retained bytes.
4. Corrupt one model byte: the app detects it, retries once, and reports failure without crashing.
5. Import a random downloaded EPUB with a cover: a wrap spine appears on the shelf within the
   measured phone budget, with a `run.json` route and QA verdict recorded.
6. Run the same book in airplane mode after a warm cache: identical output, zero network requests.
7. A review-verdict book shows the note and **Use Cloth**, and Cloth renders correctly.
8. Editing page count re-composes the wrap without re-running detection.
9. Switching style in detail completes without a pipeline run.
10. Deleting a book removes its cache directory and frees its bytes.
