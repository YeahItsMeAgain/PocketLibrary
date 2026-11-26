# v8 — Automatic generative

**Status:** throwaway design prototype, not production code. Everything is in
`.scratch/spine-cover-art-prototype/v8-auto/`. No production app code, tests,
manifests or specs were modified. Nothing was committed or released.

**View:** <http://127.0.0.1:4173/spine-cover-art-prototype/v8-auto/>  
(served by the existing static host on `0.0.0.0:4173`)

**Finding in one line:** the manual mask is gone. PP-OCRv3 DBNet finds the type,
automatic colour/line analysis builds the mask, flat fill + LaMa remove it, and
a spine-scale QA pass prefers a **text-free crop of real pixels** over
inpainting whenever one exists. On the five test covers: **4 pass, 1 review,
0 fallback, 0 manual mask points, 0 API keys**.

| Book | Role | Route | Verdict | Mask | Spine OCR | Runtime |
|---|---|---|---|---:|---:|---:|
| *The Hound of the Baskervilles* | random reproducibility book | text-free crop | **pass** | 7.7% | 0 | 10.3 s |
| *Rock Paper Scissors* | hard integrated display type | inpaint | **review** | 40.1% | 0 | 29.4 s |
| *Harry Potter and the Philosopher's Stone* | popular cover | text-free crop | **pass** | 37.4% | 0 | 28.4 s |
| *The Hunger Games* | popular cover | text-free crop | **pass** | 26.0% | 0 | 23.9 s |
| *The Whisper Man* | unseen holdout, no tuning | text-free crop | **pass** | 14.1% | 0 | 31.9 s |

The review is honest: *Rock Paper Scissors* has type across its full width, so
there is no zero-text strip. Its reconstruction is clean and OCR-free, but the
resulting snow strip is generic at 52 × 236. The manual v6 LaMa baseline has the
same problem. That is a review, not a pass.

---

## What is automatic

1. **Text detection** — PP-OCRv3 DBNet via `rapidocr_onnxruntime`, ONNX, CPU.
   No polygons are authored by hand. `det_limit_side_len=1600`,
   `unclip_ratio=1.9`, `box_thresh=0.28`, `thresh=0.18`.
2. **Mask** — for each box, estimate the dominant type colour inside the
   detected polygon, grow colour-similar components in a small ROI, then fill
   under-covered glyphs using the line's own hue/value model. Dilation is
   proportional to the detected line height.
3. **Removal** — flat mask components are filled from their surrounding ring's
   median Lab colour. Textured components go through LaMa `big-lama` at a
   720 px working side. The whole thing runs on CPU.
4. **Spine decision** — a spine-aspect (52:236) integral-image scan scores
   every crop window by mask coverage, luma σ, edge density, saliency, size and
   non-dark fraction. The top zero-coverage candidates are checked with OCR.
   If one is clean, the **real pixels** are used and inpainting is skipped.
   Otherwise the reconstructed art is cropped. QA then returns
   **pass / review / fallback**.
5. **Fallback output** — every run writes a 52 × 236 type-on-cloth spine so a
   failed reconstruction has a defined result.

Manual intervention is **0**. The only inputs are a cover image and optional
title, author and page count. There is no per-book prompt, no clicked point and
no external service.

---

## Outputs per book

```
assets/<slug>/
  source.jpg            original cover
  mask.png              full-resolution automatic mask
  mask-preview.jpg      mask over the original
  art.jpg               inpainted textless cover (720 px working side)
  crop-native.jpg       chosen crop before the 52 x 236 resize
  spine.jpg             52 x 236 recommended spine
  spine-2x.jpg          104 x 472
  fallback-spine.jpg    type-on-cloth fallback
  compare.jpg           original -> mask -> art -> spine -> fallback
  run.json              full record: route, verdict, model, runtime, boxes
  qa.json               QA metrics and the decision reasons
```

`data.js` / `audit.json` are generated summaries for the gallery and capture.

---

## Exact commands

Use the CPU environment used for this run (Python 3.13, torch 2.15 CPU,
onnxruntime 1.32, OpenCV 5.1, rapidocr-onnxruntime 1.2.3,
simple-lama-inpainting 0.1.0):

```bash
cd /mnt/ssd2/Projects/PocketLibrary/.scratch/spine-cover-art-prototype/v8-auto

/tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
  --cover ../reproducibility/book/cover.jpg \
  --slug hound \
  --title "The Hound of the Baskervilles" \
  --author "Arthur Conan Doyle" \
  --pages 170 \
  --out assets

/tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
  --cover ../v6/assets/modern/rps-cover.jpg \
  --slug rps --title "Rock Paper Scissors" \
  --author "Alice Feeney" --pages 320 --out assets

/tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
  --cover ../v7/assets/source/harry-potter.jpg \
  --slug harry-potter \
  --title "Harry Potter and the Philosopher's Stone" \
  --author "J.K. Rowling" --pages 223 --out assets

/tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
  --cover ../v7/assets/source/the-hunger-games.jpg \
  --slug hunger-games --title "The Hunger Games" \
  --author "Suzanne Collins" --pages 374 --out assets

/tmp/opencode/v3venv/bin/python tools/auto_pipeline.py \
  --cover ../v4-generative/assets/whisper-man-cover.jpg \
  --slug whisper-man --title "The Whisper Man" \
  --author "Alex North" --pages 368 --out assets

# Rebuild the gallery, data.js and audit.json
/tmp/opencode/v3venv/bin/python tools/build_report.py

# Measure the old manual/LaMa baselines with the same QA functions
/tmp/opencode/v3venv/bin/python tools/baseline_metrics.py
```

Serve (if the host is not already up):

```bash
cd /mnt/ssd2/Projects/PocketLibrary
python3 -m http.server 4173 --bind 0.0.0.0 --directory .scratch
```

Then open <http://127.0.0.1:4173/spine-cover-art-prototype/v8-auto/>.

### Recreate the Python environment

```bash
python3 -m venv /tmp/opencode/v3venv
/tmp/opencode/v3venv/bin/pip install --upgrade pip
/tmp/opencode/v3venv/bin/pip install \
  torch torchvision --index-url https://download.pytorch.org/whl/cpu
/tmp/opencode/v3venv/bin/pip install \
  rapidocr-onnxruntime==1.2.3 \
  simple-lama-inpainting==0.1.0 \
  onnxruntime==1.32.0 \
  opencv-python==5.1.0.95 \
  numpy pillow
```

The pipeline needs no GPU, no API key and no network access after the weights
are cached. EasyOCR/CRAFT was installed during research but is not used by the
pipeline: its Torch path hit an illegal-instruction failure on this CPU. That is
recorded in `RESEARCH.md`.

---

## Model weights

| Weight | Where | Size | Licence |
|---|---|---:|---|
| PP-OCRv3 det (`ch_PP-OCRv3_det_infer.onnx`) | bundled with `rapidocr-onnxruntime` | 2.4 MB | Apache-2.0 (PaddleOCR / Baidu; RapidOCR packaging) · sha256 `3439588c…0de526` |
| PP-OCRv3 rec (`ch_PP-OCRv3_rec_infer.onnx`) | bundled with `rapidocr-onnxruntime` | 11 MB | Apache-2.0 · sha256 `897a3ede…5ee615` |
| LaMa `big-lama.pt` | `~/.cache/torch/hub/checkpoints/big-lama.pt`, downloaded by `simple-lama-inpainting` | 197 MB | Apache-2.0 (SAIC-MDAL LaMa) · sha256 `7ba7aa7a…9e6b4c` |

No FLUX, Qwen, Kontext, Pollinations or hosted Space is used. No credential is
read. The earlier v4-generative/v7 attempts hit 401/403 and anonymous ZeroGPU
quota; this route avoids that class of failure entirely.

---

## QA contract

The product is the 52 × 236 px spine, not full-cover fidelity.

| Signal | What it is | Decision |
|---|---|---|
| Residual OCR | PP-OCRv3 on the art, native crop and 4× spine upscale; confidence ≥ 0.5 | Any readable hit in the spine → **fallback** |
| Mask coverage | Fraction of the cover reconstructed | >40% → **review**; >55% → **fallback** |
| Seam ratio | Mean boundary gradient ÷ local ring gradient | >3× → **review** |
| Ring ΔE | Mean Lab distance between filled pixels and the surrounding ring | >55 → **review** |
| Spine structure | Luma σ, edge density, non-dark %, palette correlation | Too flat/empty → **review/fallback** |
| Crop route | Zero mask coverage + residual OCR check | Pass if structure is adequate |

These are guardrails, not a substitute for looking. The gallery exposes every
number so a reviewer can disagree with the verdict.

---

## Comparison with the manual/LaMa baseline

The old studies used hand-drawn regions (v3/v6/v7). `baseline_metrics.py` runs
the same OCR and spine statistics over those existing assets:

| Book | Baseline method | Baseline residual OCR | Baseline spine luma σ | Auto route | Auto residual OCR | Auto spine luma σ |
|---|---|---:|---:|---|---:|---:|
| *Hound* | manual plate exclusion | 0 | 66.3 | text-free crop | 0 | 56.3 |
| *RPS* | hand polygons + LaMa | 0 | 25.1 | inpaint | 0 | 45.4 |
| *Harry Potter* | hand regions + LaMa/TELEA | 2 (in-art signs) | 37.7 | text-free crop | 0 | 45.0 |
| *Hunger Games* | hand regions + LaMa/TELEA | 0 | 39.5 | text-free crop | 0 | 54.4 |

The automatic route matches the baseline on text removal and usually preserves
more structure, because it uses real cover pixels instead of inpainting the
whole title field. Its weakness is the same as the baseline's: a clean strip is
not a guarantee of recognisability (*RPS*).

---

## Failure modes, honestly

1. **DBNet can miss low-contrast or very small type.** The line colour model
   recovers most missing glyphs, but it can under-mask a glyph or over-mask a
   textured background. Residual OCR is the backstop; if it fails, the spine
   can still be marked pass when the missed text is outside the crop.
2. **Automatic masks cannot tell cover type from in-art lettering.** The
   Hogwarts Express sign and the 9¾ platform sign are removed along with the
   title. v7 deliberately kept them; v8 does not have a semantic classifier.
3. **Large integrated title fields are reconstructed, not recovered.** *RPS*
   is 40% mask; LaMa invents plausible snow. At 52 px it reads as a snowy
   strip, not as *Rock Paper Scissors*. The verdict is **review** for that
   reason.
4. **Full-cover art can carry obvious LaMa inventions.** *Harry Potter* gets a
   flat magenta/pink title field and a soft badge ghost; *The Whisper Man* gets
   black circles where the badges were. The text-free crop hides these at spine
   scale, but the full-cover file should not be presented as a clean cover.
5. **A zero-text crop can be real and still bland.** The QA measures structure,
   not recognition. *RPS* has no zero-text crop and reviews; a different cover
   could find a clean but empty strip and pass on structure alone. A stress run
   on *The Lord of the Rings* (kept in `assets/lord-of-the-rings/`, not in the
   main table) exposes this: the automatic pass is structurally valid, but the
   surviving ring inscription is too fine to identify the book at 52 px. v7
   rejected that cover as a design matter; v8's QA cannot measure
   recognisability. Treat the verdict as a floor, not a design sign-off.
6. **CPU runtime is 10–32 s per cover** at a 720 px working side, dominated by
   LaMa when it runs. A 1400 × 2100 full-resolution LaMa pass was ~92 s in this
   environment, so the pipeline deliberately works at spine-appropriate
   resolution.
7. **OCR QA is not perfect.** Small type below the recogniser's resolution can
   survive without being reported. The 4× spine upscale helps, but it is not a
   guarantee.
8. **No diffusion editor was tested.** FLUX Kontext / Qwen-Image-Edit could
   plausibly improve the *RPS* full-cover texture, but they require credentials
   or quota that this environment does not have. The automatic route is built to
   work without them.
9. **Covers are in copyright** except the Standard Ebooks *Hound* cover. They
   are used only as throwaway design references. Nothing here implies production
   use.
10. **Fallback type uses DejaVu Serif** (Bitstream Vera licence) because it is a
    system font; the production design system should use its own licensed face.

---

## Files

```
.scratch/spine-cover-art-prototype/v8-auto/
  index.html                 gallery / report
  styles.css                 report styling
  data.js                    generated run data (window.PocketV8)
  audit.json                 generated summary
  baseline.json              manual/LaMa baseline measurements
  README.md                  this file
  RESEARCH.md                detection / removal / QA research trail
  tools/
    auto_lib.py              detection, mask, inpaint, crop, QA, fallback
    auto_pipeline.py         one-cover CLI
    build_report.py          gallery + data.js + audit.json
    baseline_metrics.py      old manual/LaMa measurements
    explore_*.py, proto_*.py research iterations (kept for provenance)
  assets/<slug>/             per-book outputs
  assets/baseline/           copied baseline art/spines for comparison
  screenshots/               fresh Chromium captures (390 / 360 / 320)
  audit-screens.json          widths, overflow, image load, fonts, dock, errors
  explore/                   intermediate mask experiments (not used by report)
```

The `proto_*.py` files are deliberately kept: they show why the mask moved from
plain DBNet boxes (missed glyphs) to per-box colour segmentation + line colour
completion. The final code is `auto_lib.py`, not the prototypes.

---

## Licences

**Prototype:** throwaway design reference, not production code.

**Code:** this prototype is part of the throwaway `.scratch` suite; it carries no
separate licence. Its dependencies are used under their own licences:
RapidOCR and PaddleOCR models Apache-2.0, LaMa Apache-2.0, OpenCV Apache-2.0,
ONNX Runtime MIT, PyTorch BSD-style, `simple-lama-inpainting` Apache-2.0, Pillow
HPND, DejaVu fonts Bitstream Vera.

**Covers:** *The Hound of the Baskervilles* cover is public domain (Standard
Ebooks). *Rock Paper Scissors*, *Harry Potter*, *The Hunger Games* and *The
Whisper Man* are in-copyright edition scans used only as throwaway design
references. No production use is implied.

---

## Study navigation

The page includes the shared `/spine-cover-art-prototype/study-nav.js` dock and
appears as **Automatic generative** after **Popular books**. The shared review
and reproducibility pages also link to it; existing study names are unchanged.
