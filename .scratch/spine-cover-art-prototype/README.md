# PocketLibrary spine studies

Throwaway design prototypes, not production code.

**Open:** `http://<host>:4173/spine-cover-art-prototype/review/` for the external
overview, or use the arrow dock on any study page to move through the suite.

**Reproducibility:** the strict rule is that the **APK itself must create the
spine for a random downloadable book, end-to-end**. A pack, curated asset,
renderer-only route, desktop build, hosted service or manual mask does not count.
Today: **6 yes (v8-app and App renderers, both user-verified on real devices;
Full-bleed, Textless, Wrap and Design system verified through App renderers),
2 pending integration (Popular books and Popular app route), 5 not strict
(packs, superseded, reference)**. See
`http://<host>:4173/spine-cover-art-prototype/reproducibility/` for the matrix
and [`APP-REPRODUCIBILITY.md`](APP-REPRODUCIBILITY.md) for the file-level audit.

## Studies

1. **Full-bleed** — `v2/`  
   Real covers, a wider spine crop, a top cap and a measured title rail.

2. **Textless art** — `v3/`  
   Genuine public-domain paintings plus OCR/LaMa reconstructions for covers that
   have no text-free source.

3. **Wrap engine** — `v4-wrap/`  
   Page-count spine width, continuous back/spine/front wrap, measured type fitting.

4. **Generative art** — `v4-generative/`  
   Hosted FLUX experiment, kept as a design record. Superseded by v8-app.

5. **Design system** — `v6/`  
   Editorial, Clothbound and Hybrid; the current recommendation is Hybrid.

6. **Popular books** — `v7/`  
   A curated popular-books shelf study; the per-cover route is Popular app route.

7. **Popular app route** — `popular-app-route/`  
   v8-app outputs for popular and generative cases. Dune unseen passes, LOTR
   falls back, RPS reviews. Pack is a bonus.

8. **Automatic generative** — `v8-auto/`  
   The desktop v8 CLI. Superseded by v8-app.

9. **App renderers** — `app-renderers/`  
   The v8 pipeline plus Full-bleed, art-only, Wrap and Hybrid/Cloth/Editorial.
   User-verified on a real device.

10. **Reference** — `bookcover-js-deep/harness/`  
    Deep source audit and hands-on spine-only SVG/PNG test. Design-only.

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
