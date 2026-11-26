# Spine engine host evidence

Real runs of `spine/` (release, host x86-64, ONNX Runtime 1.32 CPU) on six
covers. Models are the read-only prototype copies:

- `v8-app/models/{det,rec}.onnx` + `keys.txt`
- `v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx` (SHA-256 verified)

Generated with:

```bash
cd spine && cargo build --release
export ORT_DYLIB_PATH=/tmp/opencode/venv/lib/python3.13/site-packages/onnxruntime/capi/libonnxruntime.so.1.32.0
./target/release/spine-host batch \
  --manifest ../.scratch/spine-engine/evidence/manifest.json \
  --out ../.scratch/spine-engine/evidence \
  --models ../.scratch/spine-cover-art-prototype/v8-app/models \
  --migan ../.scratch/spine-cover-art-prototype/v8-models/dist/inpaint-migan/migan_pipeline_v2.onnx
./target/release/spine-host sheet --dir ../.scratch/spine-engine/evidence \
  --out ../.scratch/spine-engine/evidence/contact-sheet.png
```

## Results

| Book | Route | Verdict | Mask | Det | Crop scan | MI-GAN | QA | Total |
|---|---|---|---:|---:|---:|---:|---:|---:|
| The Great Gatsby | crop | **pass** | 20.60 % | 1.79 s | 0.27 s | — | 0.46 s | 3.87 s |
| Dune | crop | **pass** | 6.93 % | 2.60 s | 0.25 s | — | 0.45 s | 4.48 s |
| Pride and Prejudice | crop | **pass** | 7.22 % | 2.13 s | 0.32 s | — | 0.52 s | 4.34 s |
| Rock Paper Scissors | inpaint | **review** | 44.10 % | 4.35 s | 0.06 s | 8.00 s | 10.27 s | 19.65 s |
| The War of the Worlds | inpaint | **pass** | 7.62 % | 3.67 s | 0.36 s | 4.33 s | 6.36 s | 12.45 s |
| The Hobbit | inpaint | **pass** | 12.44 % | 1.48 s | 0.01 s | 3.36 s | 4.82 s | 7.40 s |

Routes and verdicts match the v8 prototype's published host outputs for Gatsby,
Dune, Pride, RPS and the unseen War of the Worlds; mask percentages are
identical (20.60 / 6.93 / 7.22 / 44.10 / 7.62). The Hobbit (also unseen by the
v8 tuning set) lands on inpaint / pass / 12.44 %. Timings are single runs on a
shared host and move by 2–3× with load; MI-GAN alone measured 3.4–8.0 s here
versus 1.9–2.3 s in the Python study.

Files: `summary.json`, `contact-sheet.png`, and `/<slug>/` with the seven
contract outputs. On the contact sheet the third column is the full
`art.jpg`: for crop routes that is the original cover (the crop route removes
nothing from the whole image; it selects a text-free window), so cover
typography is still visible there. `flat-fill/` holds the same RPS and War of
the Worlds covers run with `migan: None`; `migan-vs-flat-rps.png` is, left to
right, flat-fill art, MI-GAN art, flat-fill spine 2×, MI-GAN spine 2×.

## What looks good

- **Pride and Prejudice** — a clean portrait strip; the crop finds a
  text-free column of the painting, and the 52 px spine keeps the faces,
  shawl and warm background. Best result in the set.
- **The Hobbit** — the inpaint route removes the title/author block and
  leaves the black sky, red sun and mountain silhouettes. Recognisable at
  shelf scale and free of seams.
- **The War of the Worlds** — the chosen right-hand crop keeps the burning
  city and the warm sky; no title text survives in the spine. Reads as
  intentional art at 52 px.
- **Dune** — a strong orange/blue strip. Note that this is the large
  decorative `DUNE` letterform surviving *inside* the crop; see below.
- **The Great Gatsby** — clean but bland: the left border of the jacket
  becomes a white strip with rules. It passes QA (structure, no text), but it
  does not identify the book.

## Review / honest issues

- **Rock Paper Scissors — review, correctly.** 44 % of the cover is masked.
  MI-GAN reconstructs plausible snow where the giant title was, but the
  52 px strip is mostly white snow with a red edge band; it reads as a
  textured strip, not as *Rock Paper Scissors*. The full art still shows a
  smeared red/white corner where the title met the spine edge. This is the
  reference review case and the fallback spine is shipped alongside it.
- **Dune passes but is not text-free.** The detector does not box the huge
  vertical/decorative `DUNE` letterforms, so the crop route keeps them. QA
  residual OCR is empty because the recogniser expects horizontal text, so
  the pipeline says pass. The spine is attractive and recognisable, but the
  spec calls Dune a reference *review* case; the verdict is left unchanged
  rather than tuning QA around one book.
- **The War of the Worlds full art has a visible dark rectangle** where
  MI-GAN filled the removed title band (bottom third). The chosen spine crop
  avoids it, so the spine is good; a wrap/back that uses the full `art.jpg`
  would show the patch. Flat fill leaves the same rectangle, slightly harder.
- **Gatsby is pass-by-structure, not recognisability.** Same failure mode the
  v8 prototype documented: QA measures structure, not whether a reader can
  identify the book from the strip.
- **MI-GAN is softer than LaMa** in textured regions (the 28 MB model at
  512²), and the flat-fill comparison for RPS is the useful sanity check:
  flat fill leaves opaque grey blocks spelling the title, MI-GAN produces
  snow. For RPS both are still review.

## Reproduce

`manifest.json` lists the six covers and page counts. Covers are the
prototype's local design references (public-domain Standard Ebooks art and
in-copyright edition scans used only as throwaway test inputs).
