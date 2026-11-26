# PocketLibrary spine studies

Throwaway design prototypes, not production code.

**Open:** `http://<host>:4173/spine-cover-art-prototype/review/` for the external
overview, or use the arrow dock on any study page to move through the suite.

**Reproducibility:** every study is tested against one randomly chosen downloadable
book. See `http://<host>:4173/spine-cover-art-prototype/reproducibility/`.

## Studies

1. **Full-bleed** — `v2/`  
   Real covers, a wider spine crop, a top cap and a measured title rail.

2. **Textless art** — `v3/`  
   Genuine public-domain paintings plus OCR/LaMa reconstructions for covers that
   have no text-free source.

3. **Wrap engine** — `v4-wrap/`  
   Page-count spine width, continuous back/spine/front wrap, measured type fitting.

4. **Generative art** — `v4-generative/`  
   Instruction-driven reconstruction of large typography, with honest failure cases.

5. **Design system** — `v6/`  
   Editorial, Clothbound and Hybrid; the current recommendation is Hybrid.

6. **Popular books** — `v7/`  
   A curated popular-books shelf study; not a per-cover pipeline.

7. **Automatic generative** — `v8-auto/`

   DBNet text detection, automatic colour masks, LaMa/flat-fill removal, a
   text-free crop route and spine-scale QA. No hand-drawn polygons, no API key.

8. **Reference** — `bookcover-js-deep/harness/`

   Deep source audit and hands-on spine-only SVG/PNG test.

Directory names are internal and deliberately unchanged; the names above are the
only user-facing labels.

## Research

- `SPINE-ART-RESEARCH.md` — real spine sources, cover APIs, datasets, reverse search.
- `STACKS-ISSUE-51-RESEARCH.md` — what Stacks found and shipped.
- `BEAUTIFUL-SPINE-PLAN.md` — the design system and recommendation.

## Licence / scope

Covers and artworks are used only as design references in throwaway prototypes.
Modern edition covers are not public domain. Nothing here is production code, and
no app tests or specs depend on it.
