# Spine engine integration contract

Binding seam for the implementation tickets. Change this file before changing the
seam; the backend and frontend are built against it in parallel.

## Crate

New workspace crate `spine/` at the repo root, library name `pocketlibrary_spine`.

```rust
pub struct Models {
    pub det: PathBuf,
    pub rec: PathBuf,
    pub keys: PathBuf,
    pub migan: Option<PathBuf>,
}

pub struct BookInput {
    pub cover: PathBuf,
    pub title: String,
    pub author: String,
    pub pages: u32,
}

pub struct SpineReport { /* serde Serialize; route, verdict, mask_pct, timings, qa */ }

impl Engine {
    pub fn new(models: Models) -> Result<Self>;
    pub fn generate(&self, input: &BookInput, out_dir: &Path) -> Result<SpineReport>;
}
```

`generate` writes, into `out_dir`:

| File | Contract |
|---|---|
| `source.jpg` | working copy of the cover |
| `art.jpg` | text-free art, crop or MI-GAN-filled |
| `spine-2x.jpg` | 104 × 472 spine; the service downsamples it to 52 × 236 for the wire |
| `fallback-spine.jpg` | typographic fallback |
| `mask.png` | text mask preview |
| `run.json` | existing v8-app schema, including `final.crop_box_work` |
| `qa.json` | existing v8-app schema |

`source.jpg` and `mask.png` are pipeline scratch. The app passes a scratch `out_dir` and promotes
only the six runtime files into the book cache; see “Automatic queue” below.

## Tauri commands

camelCase on the wire, like the rest of the app.

```ts
spine_generate(bookId: number): Promise<SpineArtifact>
spine_artifact(bookId: number): Promise<SpineArtifact | null>
spine_status(): Promise<SpineStatus>
```

```ts
interface SpineArtifact {
  bookId: number;
  route: "crop" | "inpaint" | "fallback";
  verdict: "pass" | "review" | "fallback";
  maskPercent: number;
  cropBox: { x: number; y: number; width: number; height: number } | null;
  artDataUrl: string;      // data:image/jpeg;base64,...
  spineDataUrl: string;    // 52 x 236
  fallbackDataUrl: string;
  pagesApproximate: boolean;  // page count used for geometry was an estimate
  runJson: unknown;
  qaJson: unknown;
}

interface SpineStatus {
  models: "ready" | "bundled" | "missing" | "error";
  bundleId: string;        // "spine-v1"
  bytes: number;
  error: string | null;
}
```

`spine_generate` is synchronous from the caller's view (the Tauri command is
async and runs on a blocking thread). A per-book in-flight guard prevents two
generations of the same book. Results are cached on disk by
`content hash | cover hash | page count | bundle id`.

## Android assets

The test APK bundles, under APK assets `spine/`:

```
assets/spine/det.onnx
assets/spine/rec.onnx
assets/spine/keys.txt
assets/spine/migan_pipeline_v2.onnx
jniLibs/arm64-v8a/libonnxruntime.so   (from the onnxruntime-android AAR)
```

Models are extracted to the app data dir on first use. ONNX Runtime is loaded
from `ApplicationInfo.nativeLibraryDir` (the proven `v8-android` path); Android
10+ W^X forbids loading it from writable app storage. `ORT_DYLIB_PATH` is set
to the native path before the first session. Production replaces the bundled
copy with the auto-downloader; the extractor and cache layout stay.

## Automatic queue

```ts
spineEnqueue(bookIds: number[]): Promise<void>   // idempotent; dedupes and skips cached
spineQueue(): Promise<SpineQueueState>
spinePause(paused: boolean): Promise<void>       // reader-open pause; manual generate still runs
spineSetStyle(bookId: number, style: SpineStyle): Promise<void>
```

```ts
type SpineStyle = "wrap" | "full-bleed" | "cloth";

interface SpineQueueState {
  running: boolean;
  paused: boolean;
  pending: number;
  completed: number;
  failed: number;
  currentBookId: number | null;
  stage: "art" | "text" | "check" | null;
  /** True only while the library has never been queued for this bundle. */
  backfillPending: boolean;
}
```

- The backend owns a single FIFO worker. Automatic jobs run one at a time;
  `spine_generate` jumps the queue. Completed caches are skipped.
- The full-library backfill runs once per model bundle id. The shell records
  that in `<app data>/spine/backfill.json` and queues the library itself at
  startup; `backfillPending` tells the frontend whether that is still due.
  New downloads, scans and cover changes enqueue their book immediately.
- Events: `spine://queue` with `SpineQueueState` on every transition, and
  `spine://progress` with `{ bookId, stage, index, total }` per stage.
- Jobs survive process death: unfinished book ids are persisted and re-queued
  on next launch. The engine-ready state queues jobs as "waiting" rather than
  dropping them.
- Per-book style persists in `books.spine_style` (migration 6), default
  `wrap`. Deleting a book deletes the row and its cache.
- Cache keeps only runtime files: `art.jpg`, `spine-2x.jpg`,
  `fallback-spine.jpg`, `run.json`, `qa.json`, `artifact.json`. Do not store
  `source.jpg` or `mask.png` in the app cache. Trim to **200 MB** by LRU
  mtime after each completed job.
- Pause while the reader is open. Resume on close.

## Frontend

- Renderer styles: **Wrap, Full-bleed, Cloth** only. Delete the Hybrid,
  Textless and Editorial implementations.
- Wrap and Full-bleed draw from `artDataUrl` + `cropBox`; Cloth is
  typographic. Default style: **Wrap**.
- Full-bleed: title and author centred on both axes as one block, with a soft
  gradient scrim. Two lines max, shrink to fit, never truncate mid-word.
- RTL: detect the first strong character, set canvas `direction`, mirror
  alignment, and cover it with a Hebrew fixture.
- Activity chip: global "Preparing spines · n of m", plus a per-book state.
  Hidden while the reader is open.
- Automatic enqueue: after a download completes, after a scan adds books, on
  first library-ready (backfill, low priority), and after any cover change
  (cancel/replace the book's job).
- The shelf stays on CSS spines until the generated spine is ready, then swaps.
  A small marker shows a failed job until a later success.
