# pocketlibrary-spine

On-device cover-to-spine engine for PocketLibrary. Rust + ONNX Runtime, no
network, no API key.

This crate is the production port of the proven
`.scratch/spine-cover-art-prototype/v8-app` pipeline. The crop route is
behaviourally identical; the inpaint route replaces LaMa with the 28 MB MI-GAN
model. LaMa and rec INT8 are deliberately not shipped.

## Public API

```rust
use pocketlibrary_spine::{BookInput, Engine, Models, Route, SpineReport, Verdict};

let engine = Engine::new(Models {
    det: "det.onnx".into(),
    rec: "rec.onnx".into(),
    keys: "keys.txt".into(),
    migan: Some("migan_pipeline_v2.onnx".into()), // None = flat-fill fallback
})?;

let report: SpineReport = engine.generate(
    &BookInput {
        cover: "cover.jpg".into(),
        title: "The Great Gatsby".into(),
        author: "F. Scott Fitzgerald".into(),
        pages: 180,
    },
    std::path::Path::new("out/the-great-gatsby"),
)?;
```

`generate` writes exactly seven files into `out_dir`:

| File | Content |
|---|---|
| `source.jpg` | working copy of the cover |
| `art.jpg` | text-free art (crop route: the working cover; inpaint: flat-fill + MI-GAN) |
| `spine-2x.jpg` | 104 × 472 (the 52 × 236 spine at 2×) |
| `fallback-spine.jpg` | 52 × 236 type-on-cloth fallback |
| `mask.png` | full-resolution text mask |
| `run.json` | v8-app schema, including `final.crop_box_work` and `runtime_s` |
| `qa.json` | v8-app QA + decision payload |

`SpineReport` is `serde`-serializable and carries:

- `route`: `crop | inpaint | fallback`
- `verdict`: `pass | review | fallback`
- `mask_pct`: full-cover mask coverage
- `timings`: detection, mask, flat fill, MI-GAN, crop search, QA, total
- `run` / `qa`: the exact JSON payloads written to disk

`run.json` keeps the prototype's long route spelling (`text-free crop`,
`inpaint`, `fallback`); the public enum uses the contract spelling.

## MI-GAN

`migan_pipeline_v2.onnx` (28,079,181 B) is SHA-256 verified before the session
is built. The graph takes uint8 NCHW `image[N,3,H,W]` and `mask[N,1,H,W]` with
**255 = keep, 0 = hole**. The pipeline's mask is inverted, both tensors are
letterboxed to 512 × 512 with black padding, the result is cropped back, and
only the remaining hole pixels are replaced. Flat-ring fill runs first exactly
as in v8. With `Models::migan == None`, the deterministic ring-median +
masked-smoothing substitute is used and the verdict is unchanged.

## Build and test

```bash
cd spine
cargo build --release
ORT_DYLIB_PATH=/path/to/libonnxruntime.so cargo test
```

The pure tests always run. The crop and inpaint route tests load the real
models when the repo's `.scratch` evidence tree is present, and skip cleanly
otherwise. They assert the seven-file contract, `final.crop_box_work`, the
spine/fallback dimensions, `crop` + `pass` for the Hound cover, and
`inpaint` + `review` with a non-zero MI-GAN timing for Rock Paper Scissors.

Host harness:

```bash
./target/release/spine-host batch \
  --manifest ../.scratch/spine-engine/evidence/manifest.json \
  --out ../.scratch/spine-engine/evidence \
  --models ../.scratch/spine-cover-art-prototype/v8-app/models \
  --migan ../.scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx
./target/release/spine-host sheet --dir ../.scratch/spine-engine/evidence \
  --out ../.scratch/spine-engine/evidence/contact-sheet.png
```

## Module map

```
src/
  lib.rs        public re-exports
  engine.rs     Engine, Models, BookInput, SpineReport, seven-file writer
  detect.rs     PP-OCRv3 DBNet (det.onnx)
  ocr.rs        PP-OCRv3 recogniser (rec.onnx) for residual-text QA
  mask.rs       per-box CIELAB segmentation + line colour + dilation
  fill.rs       flat-ring median + MI-GAN / substitute
  migan.rs      MI-GAN session, hash check, 512 × 512 letterbox
  crop.rs       spine-aspect integral-image scan + text-free picker
  qa.rs         residual OCR, seam/ΔE/structure, pass|review|fallback
  fallback.rs   type-on-cloth spine (embedded DejaVu Serif)
  ops.rs        Lab/HSV, morphology, components, integral, edges
  ort_env.rs    one process-global ONNX Runtime environment
  bin/spine_host.rs  run / batch / contact-sheet harness
```

Model files are not bundled in this crate; the app's model delivery owns them.
DejaVu fonts are embedded under the Bitstream Vera licence
(`assets/fonts/DejaVu-LICENSE.txt`).
