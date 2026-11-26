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
| `spine-2x.jpg` | 52 × 236 spine |
| `fallback-spine.jpg` | typographic fallback |
| `mask.png` | text mask preview |
| `run.json` | existing v8-app schema, including `final.crop_box_work` |
| `qa.json` | existing v8-app schema |

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

## Frontend

- Renderer styles (Wrap, Hybrid, Full-bleed, Textless, Cloth, Editorial) are
  drawn in the WebView from `artDataUrl` + `cropBox`, ported from
  `.scratch/spine-cover-art-prototype/app-renderers/`.
- The shelf stays on the existing CSS spines for the test build. The Spine
  Studio shows the wrap at large size and a 33 px spine strip.
- Default style: **Wrap**.
