# Stacks issue #51 — research report

**Date:** 2026-11-26
**Repo:** <https://github.com/mephistopheles4/stacks>
**Issue:** <https://github.com/mephistopheles4/stacks/issues/51> — *"Is there real spine art anywhere, and on what terms?"*
**Inspected at:** `main` @ `e996fb1710b2ebcb22bce9a4276efa127460b4be` (2026-11-22), plus `origin/research/spine-art`
**Method:** shallow full clone to `/tmp/stacks`, GitHub REST API for issues/PRs, and live spot-checks of the provider endpoints the report cites. No production or prototype files were modified.

---

## Key takeaway

Issue #51 answers **no**: no reachable provider serves real book-spine or full-wrap jacket art, for any of the 33 books in the author's library, on terms that allow re-hosting. The trade's metadata standard has a slot for it (ONIX List 158 codes 29 and 56), but the publisher ingest pipe only asks for a 2:3 front cover, so every aggregator inherits front-only artwork.

The issue's own fallback — owner photographs — was **overturned two issues later**: the owner holds **0–2 of 33 books in print**, and declined the photography work (#59). Stacks therefore ships **generated spines for every book**, built from an averaged cover-edge colour plus title-derived typography. It deliberately does **not** paint cover pixels onto the spine.

For PocketLibrary, the transferable conclusion is: **stop looking for spine art; treat the generated spine as the primary design, not a fallback.** Stacks' evidence is strongest as a negative result and a source-evaluation template. Its code is web/Three.js and does not port to the Android/React/Rust app; the design reasoning and the edge-strip measurements do.

---

## 1. What issue #51 actually proposed

Opened 2026-08-06 by the repo owner (`mephistopheles4`), labelled `wayfinder:research`, and closed the same day as completed. It was a **research ticket, not an implementation ticket**. It asked, for each candidate source:

- does it serve **spine or full-wrap imagery**, at what resolution;
- **coverage** against recent business/AI/engineering trade non-fiction, self-published books and audiobooks;
- **lookup key** (ISBN or something the vault may not have);
- **terms** on downloading, caching and re-hosting on a public static site;
- **rate limits / API key**;
- whether any source exposes a back cover or full jacket at all.

It also asked whether a **non-provider route** — the owner photographing physical copies — was viable.

The requested output was a per-source verdict plus one overall recommendation, stored as Markdown on a `research/` branch and linked from the issue.

**Deliverable:** `docs/research/spine-art-sources.md`, 537 lines, on branch `research/spine-art`.
**Merged to main?** **No.** The branch differs from main by exactly that one file; it was never merged (checked with `git merge-base --is-ancestor`, exit 1). The research lives on the branch and in the issue comments, not in the main tree.

- Branch: <https://github.com/mephistopheles4/stacks/tree/research/spine-art>
- Doc: <https://github.com/mephistopheles4/stacks/blob/research/spine-art/docs/research/spine-art-sources.md>
- Branch commits: `b2305d1` (initial findings), `7dacf24` (cover-flat and audiobook corrections)

---

## 2. What issue #51 found

The headline result: **0 of 33 books, across 14 sources**, could get real spine pixels.

| Source | Spine / wrap? | Re-hosting terms | Verdict |
|---|---|---|---|
| Open Library | No — front only; 0 of 20 editions carried a second cover ID | Public display contemplated; courtesy link; 100 req/IP per 5 min | No new art |
| Google Books | No — `imageLinks` are front thumbnails | Google APIs ToS §5(e) bars permanent copies | No new art |
| Apple Books | No — front print + square audiobook art | Terms do not enumerate book covers at all | Already in use; ambiguous |
| Penguin Random House API | No — measured 298×450 front | Registration; asset terms not published | No |
| LibraryThing | No — member-uploaded fronts | Non-commercial; 1 req/s, ~1,000/day | No |
| Goodreads | — | No new developer keys issued | Dead |
| WorldCat / OCLC | No cover art at all | "OCLC does not provide cover art via its API interfaces" | Dead |
| Amazon PA-API / Creators API | Irrelevant | "You will not store or cache Product Advertising Content consisting of an image" | Prohibited |
| Bookshop.org | No developer API found | Affiliate material may not be edited or altered | No |
| ISBNdb | No — one front "cover image" field | Paid, $14.99–$299.99/month | Pays for the same front |
| Edelweiss (trade) | No — ingest spec is 2:3 front, `[ISBN].jpg` | Trade account; B2B | No |
| Publisher press kits / cover flats | Digital assets are front-only; the flat is a physical sales piece | Press use, not re-hosting | No |
| Internet Archive scans | Front/back leaves, no spine file | In-copyright, lending only | No |
| Second-hand listings | Sometimes seller photos | Seller-owned; licence runs to the marketplace | No |
| **Owner photographs** | **Yes — the only yes** | Owner's own bytes; no re-hosting question | Later killed by #59 |

Three supporting findings matter more than the table:

1. **The standard has the slot; the pipe does not.** ONIX for Books List 158 defines code 29 "Full cover — includes cover, back cover, spine and – where appropriate – any flaps" and code 56 "Spine image — 2D, portrait orientation". Edelweiss, where publishers deposit trade assets, asks for one 2:3 front image per ISBN. Aggregators resell what that spec collects, so they are front-only by construction.
2. **The binding limit is the vault, not the licence.** Six of 33 books had no ISBN; seven of the 27 ISBNs had no Open Library record; only ten had any cover ID; and **no edition carried more than one cover ID**. A lookup that succeeds is not necessarily correct: `Staff Engineer's Path` (ISBN `9788441548206`) resolves to the Spanish translation, *El ingeniero de staff…*.
3. **A photograph is cheap to draw.** `spine-texture.ts` already generated a canvas per book, so a photographed spine substitutes into the same texture slot: 0 new draw calls, unchanged decoded bytes per book, ~20 KB on the wire. This was the strongest technical case for photography — and #59 killed it on **availability**, not cost or licensing.

The report's final recommendation was the photograph prototype, with generated typography as the primary deliverable for books with no print copy. That recommendation is now superseded by #59.

---

## 3. What happened after #51 — and what was actually implemented

Issue #51 produced no product code. The generated-spine implementation came through the parent map **#50** ("Books that read as books") and its sub-issues.

| Issue | Decision | Implemented on main? |
|---|---|---|
| **#59** *Does a photographed spine sit beside a generated one?* | **No photography.** Owner holds 0–2 of 33 in print; the rest are Audible/O'Reilly/digital. Owner declined the work. No `spine:` frontmatter key or asset class. | No code needed |
| **#60** *Should a generated spine lift the cover's own type?* | No cover-derived type or palette. Uniform Georgia was a bug; variety comes from the **title string** — three length bands (≤12 caps/heavy, 13–28 medium, ≥29 smaller and wrapped), subtitle selects author/rule layout. | **Yes** — `e5e97c7` |
| **#58** *Where do a spine's pixels come from?* | Colour from the averaged edge strip; surface from binding; type from #60; **cover-derived imagery: never**. Aspect-correct canvas; retire `MIN_LEGIBLE_THICKNESS`. | **Partly** — `64f4d6c` |
| **#68** *Does one shared grain read as cloth?* | The `roughnessMap` grain was measured at **0 pixels above JND** at `minDistance`; replaced with two roughness constants (hardback 0.67, paperback 0.43). Canvas fix confirmed and shipped. | **Yes** — `64f4d6c` |
| **#50** parent map | Closed 2026-08-08. PR **#72** merged 20 commits, 34 files, +3,442/−109; 482 tests, all gates green. | **Yes** |

PR #72: <https://github.com/mephistopheles4/stacks/pull/72>

### What the current main branch actually does

`packages/site/src/shelf/spine-texture.ts` (362 lines) draws a canvas per book:

- canvas height 1024; width = `clamp(round(1024 * thickness / height), 32, 128)` (`spine-texture.ts:60–67`);
- background = the book's `spine_color`, which is the **average** of the cover's left 12% (`dominant-colour.ts:37`, `spineColour()` at `:54`);
- vertical title, author surname, hairline rules, contrast-aware ink;
- title bands from the title string (#60), two-line wrapping for long titles;
- no cover image is sampled into the spine.

The material uses `map: spineTexture` plus a shared binding-keyed `normalMap` for the spine's cross-section (`spine-profile.ts`) and a constant `roughness` (`shelf-settings.ts:616`). There is **no grain map** — #68 removed it.

Separately, page edges use one shared 1D striation normal map; boards, head caps and binding geometry are generated. This is 3D-specific and not relevant to PocketLibrary's DOM spines.

**There is no textless-cover, inpainting, OCR or spine-art pipeline anywhere on main.** `grep -ri 'textless|inpaint|ONIX'` over the tracked tree finds only a glossary note in `CONTEXT.md`. The sophisticated inpainting work in PocketLibrary's own `v3/RESEARCH.md` goes further than anything in Stacks.

---

## 4. Independent spot-checks

I did not take the issue's counts on trust where a live endpoint could be checked. All checks were made on 2026-11-26.

| Claim | Check | Result |
|---|---|---|
| ONIX codes 29, 56, 57 exist with the quoted labels | `https://ns.editeur.org/onix/en/158` | **Confirmed verbatim** |
| Open Library covers come in S/M/L; public display is contemplated; 100 req/IP per 5 min | `https://openlibrary.org/dev/docs/api/covers` | **Confirmed verbatim** |
| An Open Library edition's `covers` is an array that can hold more than one | Four ISBNs via `/isbn/{isbn}.json` | Arrays held **exactly one** ID (`Get Together` `[10190538]`, `The Singularity is Nearer` `[14861631]`); `Co-Intelligence` and `Staff Engineer's Path` had no `covers` key |
| `Staff Engineer's Path` ISBN resolves to the Spanish edition | `/isbn/9788441548206.json` | **Confirmed**: *El ingeniero de staff…* |
| PRH image endpoint serves 298×450 | `https://images.randomhouse.com/cover/9780593716724` | **Confirmed** 298×450 |
| Open Library `-L` cover is ~0.656 aspect | `covers.openlibrary.org/b/id/15223486-L.jpg` | **Confirmed** 328×500 |
| Aspect distribution 0.63–0.68 / 0.762 / 1.000 and 25 Apple / 8 Open Library | Needs the owner's generated `library.json`, not committed | **Not independently reproduced**; reported by the author |

The unverified numbers are plausible and internally consistent, but they describe a private 33-book vault that is not in the repo. Treat them as **reported**, not reproduced. The provider terms and the structural claim — no public spine asset — held up on every endpoint I could test.

---

## 5. Current repo state and maintenance

| | |
|---|---|
| Description | Local-first reading tracker that turns an Obsidian vault into a 3D bookshelf |
| Licence | **MIT** (code only; cover images belong to publishers) |
| Created | 2026-07-31 |
| Last main commit | **2026-11-22** (`e996fb1`, Dependabot) |
| Last push to any branch | **2026-11-25** |
| Stars / forks | **0 / 0** |
| Releases / tags | **None** (no GitHub releases, no tags) |
| Open issues | **0** — the API's `open_issues_count: 1` is one open Dependabot PR (#589) |
| Open PRs | 1 (`astro 7.4.4 → 7.4.7`) |
| Bus factor | **1** — every commit is by Ayman Diab; heavy Claude/agent-generated commit bodies |
| Platform | Web / static site (Astro 7, Three.js 0.185, TypeScript 6, Node 24+, pnpm 11.18) |
| Server-side deps | `sharp`, `yaml`, `micromark` in core; Cloudflare Pages/Workers for the live site and optional Ask feature |
| Test/process weight | ~72 numbered gates, ADRs, Stryker mutation testing, BrowserStack device checks |

**Is it maintained?** Yes — actively, through November 2026 — but **not on spines**. The last spine change was `e5e97c7` on 2026-08-06, apart from a repo-wide Prettier commit on 2026-08-25. Recent work is the 3D room, camera, KTX2 textures, themes and deployment. Spine art is a finished, frozen feature.

**Maturity:** a personal, single-maintainer project with no packaged release. It is a good reference, not a dependency. Its public site is <https://stacks.aymandiab.com>.

---

## 6. What is reusable for PocketLibrary

### Directly reusable

- **The research document itself** (branch link above): a per-source evaluation template with quoted terms, coverage and key. PocketLibrary's own v3 research already covers textless-art sources and inpainting; this adds the provider/terms half that v3 does not cover.
- **The negative result**: front-only is not a provider quirk, it is the corpus. This is platform-independent, so it applies to EPUB/PDF cover sourcing too.
- **The edge-strip measurement**: `spineColour()` samples the left 12% *because it is a good colour heuristic*, but the pixels are not a spine. In #58 the strip was measured across 33 covers: median vertical SD **28.9**, only **3 of 33** flat enough to paint safely (SD < 8), and **26 of 33** with >20% of rows >24 RGB from the strip mean. On a front-only cover that strip is the left margin of front artwork — often a band, rule or title block. Blurring it hard enough to stop reading as a photograph converges on the average already in use. PocketLibrary's full-bleed/slice treatments see the same problem in a different renderer.
- **The title-derived typography rule**: length bands, subtitle-driven author placement, two-line wrapping instead of ellipsis, no OCR or cover-type classification. This is cheap, deterministic and portable to CSS.
- **The aspect-correct sizing idea**: Stacks found that a fixed 128×1024 canvas stretched onto each book distorted letterforms **0.87×–1.97×**; the fix is to size the canvas from the book's own thickness/height. PocketLibrary currently fixes spine width (27–34 px) and font size (9.6–10.8 px) from a hash (`src/library/spine.ts:76–96`). The formula `width = round(1024 * thickness / height)` is a three-line port, and the underlying lesson — size type from the book's own proportions, not one constant — applies directly.

### Reusable as precedent, not as code

- **`cover-source.ts` provenance model**: record where bytes came from because providers permit different things; an index for precise takedown is not a licence. PocketLibrary has `CoverSource` in its Rust core; the reasoning is the same, and Stacks' explicit "absent vs `unknown`" distinction is worth keeping.
- **Editorial/decision discipline**: the map separates "what the standard permits", "what the pipe carries", "what the licence allows" and "what the vault can key". That four-way separation is a useful checklist for any future cover/spine source proposal.

### Not reusable

- **Three.js geometry/material code** — spine profile normal maps, head caps, page-block striation, KTX2 texture pipeline. PocketLibrary is React + CSS spines and a Tauri/Rust backend.
- **No datasets, APIs, prompts or image pipeline exist in Stacks to take.** It is a consumer of Open Library/Google Books/Apple, not a source. Its "spine image" is a browser canvas.
- **The photography route** — dead even in Stacks, and PocketLibrary's library is EPUB/PDF by definition, so its users are even less likely to have physical copies to photograph.

---

## 7. Relevance to PocketLibrary's spine-cover-art prototype

The prototype asks whether cover art should appear on a spine, and v3 asks whether the cover can be used **without printed text**. Stacks touches both, from the opposite direction:

| PocketLibrary question | What Stacks establishes | Consequence |
|---|---|---|
| Can we source real spines or full jackets? | No — not from providers, for any book in a 33-book recent-trade library. ONIX has the slot; the pipe does not carry it. | Do not spend more time on a provider hunt. |
| Can we use the front cover as the spine? | A front cover's left edge is not a spine. On 30 of 33 covers the strip is too structured to paint; the safe subset is 3 of 33. The current averaged colour already captures the useful signal. | Full-bleed/slice is a deliberate abstraction, not a reconstruction. Judge it as art, not fidelity — which is what v1/v2 already concluded. |
| What about textless original art? | Stacks did not pursue it. PocketLibrary's v3 is ahead here: 18/20 classics have genuine text-free art; modern covers fail (RPS 70.4% mask destroys the forest). | Keep the PD-classics-only route. Do not generalise inpainting to a modern library. |
| Should the spine be uniform? | Uniform Georgia was judged a bug, but hashed/arbitrary variety was explicitly rejected as "a bad pastiche of variety". Variety should track something real about the book — the title. | PocketLibrary's hash-chosen palette and ornament (`SPINE_PALETTES`, `SPINE_ORNAMENTS`) are the exact "definitionally arbitrary" pattern Stacks rejected. Consider keeping the curated palette but deriving typography/layout from the title. |
| Is a mixed shelf a problem? | Never tested; the photograph route died before the test. With one source, the question is moot. | Not a live concern unless PocketLibrary later adds user spine photos. |
| Does any of this settle licensing? | For Stacks' public static site, yes: Google bars permanent copies, Amazon bars cached images, Apple's terms do not enumerate covers. | Weaker for PocketLibrary because it renders locally and does not re-host. But provider terms still attach to downloaded covers, and any bundled screenshots/releases are a publication. Keep provenance and avoid shipping provider cover pixels as app art. |

**Important nuance:** Stacks publishes a **public static site**; PocketLibrary is a **local-only Android app**. Stacks' strongest licensing warnings (Google permanent copies, Amazon cache prohibition) do not automatically forbid local rendering for personal use. The **information-content** finding does transfer: the cover's left edge is usually busy front artwork, and painting it on a spine produces a smeared sliver, not a binding. That is a design fact independent of licensing.

A second nuance: Stacks' owner has almost no print books, so its "no physical spines" conclusion is about **that** library. PocketLibrary users may own print copies of the EPUBs they read. But the app cannot know that, and there is no `binding`/ownership field — the same data gap Stacks documented. Do not build a feature that assumes physical availability.

---

## 8. Recommendation

1. **Close the provider question in PocketLibrary.** Reuse issue #51's table as the negative-evidence appendix; do not commission another provider hunt. If a future contributor proposes WorldCat, Amazon, Goodreads, ISBNdb or a publisher press kit, the answer and the quoted terms are already written down.

2. **Make the generated/typographic spine the primary mode, not the fallback.** Stacks reached this the hard way: after #51 and #59, every spine is generated. PocketLibrary's A (typographic) treatment is already the safe, legible, cheap option; the prototype's own working recommendation says keep A as the fallback for coverless books. Stacks argues it should be the default, with art modes as opt-in.

3. **Borrow the title-derived variation, not the hash.** Keep PocketLibrary's curated Victorian palettes if they are the house style, but derive weight/case/layout from the title as #60 did: short titles get caps and tracking; long titles wrap to two lines; subtitle presence moves the author/rule. This gives real variety without OCR, new dependencies or cover pixels.

4. **If cover art on the spine ships, gate it honestly.** Use it only where a genuine textless source exists (PD classics, or a user-supplied/licensed asset), and label it as an interpretation. Keep a typographic fallback for every modern cover. Do not claim a cropped/inpainted front cover is the book's real spine. v3's failure case is the evidence.

5. **Do not pursue photography.** Stacks' owner held 0–2 print copies; PocketLibrary's library is digital by construction. If a user-photographed spine feature ever appears, make it an optional per-book asset with explicit provenance — not a coverage strategy.

6. **Do not port the 3D work.** The spine profile, page edges and room are impressive but platform-specific. The portable pieces are the canvas-aspect formula, the title bands, the averaged-edge colour and the provenance vocabulary.

---

## 9. Caveats

- Issue #51 closes on prose and a branch document, not on merged code. If the branch is deleted, the only durable copies are the issue comments and this report.
- The issue's final recommendation (photograph three spines) is **obsolete**. Reading #51 alone gives a different answer from reading #51 + #59. Always cite #59 when saying "no real spine pixels".
- Coverage counts (0/33, 10/33, 25 Apple, etc.) come from a private generated `library.json`; I could not reproduce them. The provider terms and ONIX facts were independently confirmed.
- Terms were checked in August 2026 and spot-checked again on 2026-11-26. Provider terms can change; re-read before relying on a specific clause.
- I did not run the Stacks test suite: the environment has Node 24 but no `pnpm` and the clone had no `node_modules`. The code assessment is static plus the live endpoint checks above.

---

## 10. Links

- Issue #51 — <https://github.com/mephistopheles4/stacks/issues/51>
- Research document (branch) — <https://github.com/mephistopheles4/stacks/blob/research/spine-art/docs/research/spine-art-sources.md>
- Parent map #50 — <https://github.com/mephistopheles4/stacks/issues/50>
- Photograph route killed #59 — <https://github.com/mephistopheles4/stacks/issues/59>
- Spine pixels #58 — <https://github.com/mephistopheles4/stacks/issues/58>
- Title typography #60 — <https://github.com/mephistopheles4/stacks/issues/60>
- Grain render #68 — <https://github.com/mephistopheles4/stacks/issues/68>
- Implementation PR #72 — <https://github.com/mephistopheles4/stacks/pull/72>
- `spine-texture.ts` — <https://github.com/mephistopheles4/stacks/blob/e996fb1710b2ebcb22bce9a4276efa127460b4be/packages/site/src/shelf/spine-texture.ts>
- `dominant-colour.ts` — <https://github.com/mephistopheles4/stacks/blob/e996fb1710b2ebcb22bce9a4276efa127460b4be/packages/core/src/covers/dominant-colour.ts>
- `cover-source.ts` — <https://github.com/mephistopheles4/stacks/blob/e996fb1710b2ebcb22bce9a4276efa127460b4be/packages/core/src/covers/cover-source.ts>
- ONIX List 158 — <https://ns.editeur.org/onix/en/158>
- Open Library Covers API — <https://openlibrary.org/dev/docs/api/covers>
