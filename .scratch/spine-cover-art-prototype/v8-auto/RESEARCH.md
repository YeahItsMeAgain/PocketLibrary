# v8 research — automatic text detection, removal and spine-scale QA

This is the research trail behind `auto_lib.py`. The target is not a perfect
full-cover edit; it is a clean **52 × 236 px** spine with no hand-drawn mask and
no API key.

The route that survived is deliberately unglamorous:

> **DBNet proposals → automatic colour/line mask → flat fill + LaMa → text-free
> crop search → spine-scale QA → pass / review / fallback.**

A diffusion editor could make a prettier full cover. It would not remove the
mask problem, and it could not be run unattended in this environment (v4/v7
recorded the 401/403/ZeroGPU-quota failures). The local route can.

---

## 1. Text detection / segmentation

### Tested

| Route | Result | Decision |
|---|---|---|
| **PP-OCRv3 DBNet** via `rapidocr_onnxruntime` (ONNX, CPU) | Found 3 boxes on the Hound, 30 on RPS, 14 on Harry Potter, 15 on Hunger Games. Large display type, small marketing text and rotated side bands all detected. | **Chosen.** Fast (~3 s/cover), keyless, Apache-2.0 models. |
| **EasyOCR / CRAFT** (`easyocr.Reader(['en'], gpu=False)`) | Package installed, model loaded, then `readtext` aborted with `Illegal instruction` (exit 132) after an NNPACK initialization warning. Retried with NNPACK disabled; same failure. | **Not used.** CRAFT is a reasonable detector, but this Torch build is not stable on this CPU. |
| **EAST** (OpenCV `frozen_east_text_detection.pb`) | Not run. EAST needs an extra 90 MB download and its rotated/curved-text handling is weaker than DBNet; DBNet already covered every test line. | Rejected on cost/benefit. |
| **GroundingDINO / SAM-style text prompting** | Not run. The weights are hundreds of MB and the prompt is another manual choice. DBNet is text-specific and already returns boxes. | Rejected for this pipeline; worth revisiting only if detection recall fails. |
| **PaddleOCR package** | Not installed. `rapidocr_onnxruntime` gives the same PP-OCRv3 DBNet/recognition models in ONNX without the Paddle runtime. | Avoided a heavy dependency. |

### What DBNet misses, and the automatic fix

DBNet boxes are not glyph masks. On RPS it misses the `C` in `ROCK`; on other
covers it can leave the edge of a wide letter uncovered. Three automatic
recoveries are layered:

1. **Per-box colour segmentation.** Estimate the dominant text colour inside the
   detected polygon in CIELAB, then grow colour-similar components in a small
   ROI. This recovers glyphs just outside a box.
2. **Line colour completion.** Group horizontal boxes into lines (strict y
   overlap, gap < 1.5× line height), then select pixels whose hue/value matches
   the line's own typography. This recovers a missing glyph between detected
   words without a hand polygon.
3. **Proportional dilation.** Dilate by 0.22× the median line height and close
   the same amount to cover anti-aliasing and interior texture.

The prototypes in `tools/proto_mask*.py` document the failures:

- Plain DBNet boxes + small dilation: clean on the Hound, under-covered on RPS.
- Whole-line rectangles: covered everything, including most of the snow
  background; mask coverage ballooned to 55–80%.
- Single global text colour: missed dark-red/gradient glyph interiors.
- Per-box colour + line colour + proportional dilation: RPS mask 40% (the title
  really is that large), no residual OCR, controlled seam.

### Detection references

- DBNet: Liao et al., *Real-time Scene Text Detection with Differentiable
  Binarization*, AAAI 2020, <https://arxiv.org/abs/1911.08947>.
- PaddleOCR: <https://github.com/PaddlePaddle/PaddleOCR> (Apache-2.0).
- RapidOCR model-licence statement:
  <https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/> (all
  registered models Apache-2.0).
- CRAFT: Baek et al., *Character Region Awareness for Text Detection*, CVPR
  2019, <https://arxiv.org/abs/1904.01941>; code MIT,
  <https://github.com/clovaai/CRAFT-pytorch>.
- EasyOCR: <https://github.com/JaidedAI/EasyOCR> (Apache-2.0).
- EAST: Zhou et al., *EAST: An Efficient and Accurate Scene Text Detector*,
  CVPR 2017.

---

## 2. Text removal / inpainting

### Tested

| Route | Result | Decision |
|---|---|---|
| **LaMa `big-lama`** via `simple-lama-inpainting` (TorchScript, CPU) | 720 px side: 15–21 s per cover when the mask is textured. Full 1303 × 2000: ~92 s. Plausible snow, wood and illustration texture. | **Chosen** for textured masks. |
| **Sampled flat fill** (median Lab of the surrounding ring) | Instant. Perfect on the Hound's black title band and Hunger Games' near-black field. | **Chosen** for flat components, before LaMa. |
| **OpenCV TELEA / NS** | 0.15 s on RPS at 720 px. No residual OCR, but the output shows ghostly letter-shaped smears across the snow. | Rejected for large glyphs; useful only for tiny defects. |
| **Diffusion inpainting** (SD/SDXL) | Not run. CPU inference would be minutes per image; the model downloads are multi-GB; the built-in image tool and hosted Spaces failed in v4/v7 on credentials/quota. | Not practical for an unattended keyless run. |
| **Scene-text-removal networks** (CTRNet, EraseNet, FETNet, GaRNet, MTRNet++) | Not run. These are stronger on full scene-text removal benchmarks, but the public weights are research releases tied to datasets such as SCUT-EnsText (non-commercial research terms), with no turnkey ONNX/CPU path in this environment. | Documented as the next quality step, not the baseline. |

### Why LaMa + flat fill, not one model

The failure mode of LaMa is not text residue; it is **invention** under a large
mask. The pipeline reduces that risk two ways:

- If the ring is flat (std < 8 in L, < 8 in chroma), use the ring's median
  colour. This is why the Hound's title band is clean and fast.
- If the mask is large and textured, prefer a **text-free crop of real pixels**
  before using the reconstruction at all.

### Removal references

- LaMa: Suvorov et al., *Resolution-robust Large Mask Inpainting with Fourier
  Convolutions*, WACV 2022, <https://arxiv.org/abs/2109.07161>;
  <https://github.com/saic-mdal/lama> (Apache-2.0).
- `simple-lama-inpainting`:
  <https://github.com/enesmsahin/simple-lama-inpainting> (Apache-2.0).
- IOPaint (LaMa/MAT/MIGAN, CPU support):
  <https://github.com/Sanster/IOPaint> (Apache-2.0; archived) and
  <https://www.iopaint.com/models/erase/lama>.
- CTRNet: Liu et al., ECCV 2022,
  <https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136880406.pdf>.
- EraseNet: Liu et al., *EraseNet: End-to-End Text Removal in the Wild*, IEEE
  TIP 2020.
- FETNet: Lyu et al., *FETNet: Feature Erasing and Transferring Network for
  Scene Text Removal*, <https://arxiv.org/abs/2306.09593>.
- GaRNet: Lee & Choi, ECCV 2022,
  <https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136760436.pdf>;
  weights <https://github.com/naver/garnet>.
- MTRNet++: Tursun et al., *MTRNet++: One-stage Mask-based Scene Text Eraser*,
  CVIU 2020.
- ViTEraser: Peng et al., AAAI 2024,
  <https://ojs.aaai.org/index.php/AAAI/article/download/28245/28485>.

The scene-text-removal literature is useful context but not a drop-in answer:
the models are trained on 512 px scene-text benchmarks, their masks are often
box-level, and their weights/licences are not packaged for a keyless CPU
pipeline. DBNet + LaMa was the best available automatic stack here.

---

## 3. Automatic QA at spine size

Full-cover fidelity is the wrong target. Every decision is computed on the
52 × 236 crop (or a 4× upscale for OCR).

| Signal | Implementation | Why |
|---|---|---|
| **Residual OCR** | PP-OCRv3 on art, native crop and 4× spine; conf ≥ 0.5 | Catches text the mask missed, including text that only becomes legible at spine size. |
| **Mask coverage** | Full-cover mask area / cover area; crop mask area / crop area | Large masks correlate with invention. RPS is 40% and reviews; Hound is 7.7% and passes. |
| **Seam ratio** | Boundary gradient ÷ local ring gradient | Detects a visible fill edge. |
| **Ring ΔE** | Mean CIELAB distance between filled pixels and the ring median | Detects colour drift / wrong fill. |
| **Inside/ring σ ratio** | Luma std inside mask ÷ ring std | Flags over-smoothed fills. |
| **Spine structure** | Luma σ, p5/p95, non-dark %, Canny edge density, Laplacian variance | "Clean but empty" is a fallback, not a pass. |
| **Palette correlation** | HSV histogram correlation between crop and source | Advisory; a detail crop can legitimately differ (HP train crop corr 0.06). |
| **Crop route** | Zero mask coverage + residual OCR check | Prefers real pixels over any reconstruction. |

### Text-free crop search

A spine is an extreme crop: aspect 0.220. The search scans 14 heights × 26 × 26
positions with integral images (mask, luma, luma², Canny, saliency, non-dark),
then OCR-checks the top zero-coverage candidates. This is what lets Harry
Potter, Hunger Games, the Hound and The Whisper Man avoid inpainting entirely.

The search is intentionally allowed to crop **shorter than full height**. On the
Hound, a full-height strip includes the title band; the winning window starts
below the sky and stops above the band. On Harry Potter, the winning strip is
the train and the boy's face, below the title. This is the "crop avoidance"
route the brief asked for.

### QA references

- PaddleOCR PP-OCRv3 recognition, same model family as detection (Apache-2.0).
- Canny / Laplacian / HSV histogram: OpenCV, Apache-2.0.
- For the design rationale behind judging at shelf size, see the suite's
  `BEAUTIFUL-SPINE-PLAN.md` and v7's spine-scale acceptance test.

---

## 4. Measured experiments in this folder

| Experiment | Result | Artifact |
|---|---|---|
| DBNet detection-only on 4 covers | 3 / 30 / 14 / 15 boxes; ~2.5–3.5 s each | `explore/*-dbnet.jpg` |
| Prototype masks 2–11 | Box-only mask missed glyphs; whole-line rectangles over-masked; per-box colour + line colour settled at 7.7–40% | `explore/*-automask*.jpg`, `explore/*-mask*.png` |
| EasyOCR/CRAFT | Illegal instruction on this CPU | not used |
| LaMa 720 px | 15–21 s on RPS/HP; clean texture | `explore/rps-art11.jpg` etc. |
| LaMa full 1303 × 2000 | ~92 s | benchmark only |
| TELEA / NS on RPS | 0.15 s, no OCR, visible letter-shaped smears | `explore/rps-telea.jpg`, `explore/rps-ns.jpg` |
| Flat fill on Hound | Instant, clean black band | `assets/hound/art.jpg` |
| Text-free crop on 4/5 covers | Zero mask coverage + zero OCR; no inpainting needed at spine | `assets/*/run.json` |
| QA thresholds | 4 pass, 1 review, 0 fallback; 0 manual steps | `audit.json`, `index.html` |
| *Lord of the Rings* stress run | Structural pass (ring script survives), but a design reject: no object carries identity at 52 px. Kept out of the main five, documented in the README. | `assets/lord-of-the-rings/` |

---

## 5. Recommended automatic stack

```
PP-OCRv3 DBNet (ONNX, CPU)
  → per-box Lab colour segmentation
  → line colour completion
  → proportional dilation
  → flat-ring median fill
  → LaMa big-lama (CPU) for the rest
  → spine-aspect crop scan + residual OCR
  → 52 x 236 QA: OCR / coverage / seam / palette / structure
  → pass | review | fallback(type-on-cloth)
```

**Why this one:** it is keyless, local, CPU-only, fast enough to run per book
(10–32 s), and it degrades honestly. It does not depend on a hosted model, an
API key, a per-book prompt, or a hand mask. Its weakness — large integrated type
on a textured field — is exactly where the scene-text-removal literature would
be the next upgrade, and the crop route already avoids the problem on four of
five covers.

**What would change the recommendation:** a working, licensed, CPU-feasible
scene-text-removal ONNX model (CTRNet/FETNet-class) or a local diffusion
inpainting path with a small model and a strict runtime budget. Neither exists
in this environment today.
