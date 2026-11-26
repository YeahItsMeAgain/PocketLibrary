# Research — removing printed text from book covers, and finding the original art

**Date:** 2026-11-26  
**Scope:** the v3 spine prototype. The question is narrow: *can a spine use only the cover artwork, with the cover's printed typography gone?* That breaks into two separate problems:

1. **Removal** — if only a published, typeset cover exists, can the text be removed convincingly?
2. **Sourcing** — is the original textless artwork (or a flat, untypeset cover) available anywhere?

The short answer: **removal is practical for modest typography, but not for a cover like the US *Rock Paper Scissors*; original textless art is routinely available for public-domain classics and almost never for modern trade covers.** The prototype therefore uses original public-domain paintings for 15 of 18 classics, crops above the printed plate for the other 3, and inpaints the two modern covers — showing the pass and the failure honestly.

---

## 0. What was actually tested here

Environment: Linux, **CPU only** (no NVIDIA driver), Python 3.13, PyTorch 2.15 (CUDA wheel, forced to CPU), `rapidocr-onnxruntime`, `simple-lama-inpainting` 0.1.0 (big-lama TorchScript).

Pipeline per modern cover:

1. `RapidOCR` finds text boxes and confidence.
2. A small, explicit set of hand-drawn polygons adds what OCR misses: giant condensed display letters, marketing stickers, the red RPS band.
3. Mask is dilated 31 px and inpainted with **LaMa big-lama** on CPU.
4. OCR runs again on the result; residual text is recorded.
5. A 2:3 art crop is taken around a recorded focus point; the spine shows 33% of that crop.

| Cover | OCR boxes | Manual supplement | Mask fraction | CPU inpainting | Residual OCR | Verdict |
|---|---:|---:|---:|---:|---|---|
| *The Whisper Man* (Penguin UK, ISBN 9781405936019) | 13 | 1 title block + 5 marketing/sticker boxes | **38.8%** | **105.3 s** | none ≥0.30 | **Pass** — dark door/child art survives; stickers and top copy gone |
| *Rock Paper Scissors* (Flatiron US, ISBN 9781250266118) | 17 | 6 title boxes + 3 marketing/band boxes | **70.4%** | **104.7 s** | none ≥0.30 | **Review / fail** — LaMa turns the snow-forest photograph into grey mush; the church survives, the texture does not |

The mask previews are in `masks/*-mask-preview.jpg`; the raw results are in `removed/*-textless.jpg`; the audit is in `masks/*.json`. The page shows both.

**Important caveat:** “residual OCR = none” is **not** the same as “clean art”. LaMa removed the letters on *Rock Paper Scissors*, but it also removed the forest. A second OCR pass only proves that the text is no longer machine-readable; it says nothing about whether the background was reconstructed.

### Why the RPS mask is so large

OCR detected `ALI` / `ICE` / `FE` / `EENE` / `RO` / `PAPER` / `SCISSORS` but missed or split the giant red display type. The manual polygons had to cover:

- `ALICE` and `FEENEY`, which span nearly the full width;
- `ROCK`, `PAPER`, `SCISSORS`, each a large block;
- the New York Times line, the Real Simple quote, the right-hand red marketing band, and `A NOVEL`.

That is **70.4% of the cover**, including the title block that occupies the middle half. No inpainting model can recover a high-frequency aerial forest from that. The honest options are a different edition, a typographic spine, or accept the damage. v3 accepts it and labels it.

### Why the Whisper Man mask is 38.8% even though it “passed”

The mask includes the title, the two-line quote above the door, the top “Sunday Times bestseller” line, the Penguin colophon, the Netflix badge and the right-hand quote sticker. The badge/sticker boundaries are large rectangles, so 38.8% overstates the actual glyph area. The result is still good because the background is dark wood/door, a low-frequency surface LaMa can plausibly continue.

### Reproduce

```bash
# venv in this environment; install once
python3 -m venv /tmp/opencode/v3venv
/tmp/opencode/v3venv/bin/pip install numpy opencv-python-headless rapidocr-onnxruntime simple-lama-inpainting

# 1. removals (downloads big-lama on first run)
/tmp/opencode/v3venv/bin/python .scratch/spine-cover-art-prototype/v3/tools/remove-text.py

# 2. classic art crops + spine crops
/tmp/opencode/v3venv/bin/python .scratch/spine-cover-art-prototype/v3/tools/make-classic-art.py

# 3. embed the data
node .scratch/spine-cover-art-prototype/v3/tools/build-data.mjs
```

The big-lama checkpoint is serialised on CUDA; on a GPU-less machine it must be loaded with `map_location="cpu"`. `simple-lama-inpainting` does not expose that, so `remove-text.py` patches `torch.jit.load` before importing it.

---

## 1. Text removal: what already exists

### The practical CPU stack

| Project | What it is | Licence / status | CPU? | Notes |
|---|---|---|---|---|
| [IOPaint](https://github.com/Sanster/IOPaint) | Self-hosted inpainting UI/CLI; LaMa, MAT, SD, PowerPaint, etc. | **Apache-2.0; archived upstream (last push 2025-04-29)** | Yes (`--device=cpu`) | The most practical wrapper. Archived upstream, but the CLI still works; a modernised fork (`daraskme/IOpaint`) exists. |
| [LaMa](https://github.com/advimman/lama) | Resolution-robust large-mask inpainting, WACV 2022 | **Apache-2.0** | Yes | Works to ~2k; good at textures/periodic structures, weak at reconstructing unique high-frequency detail. This is what v3 uses. |
| [simple-lama-inpainting](https://github.com/enesmsahin/simple-lama-inpainting) | Minimal Python wrapper + big-lama TorchScript | **Apache-2.0** | Yes | Easiest batch path; ~105 s per 1303 × 2000 cover here. |
| [MAT](https://github.com/fenglinglwb/MAT) | Mask-Aware Transformer, CVPR 2022 | **CC BY-NC 4.0** (code/weights) | Possible, heavy | Better large-hole structure than LaMa in some cases, but **non-commercial** and slower. Not suitable for a shipping app without licensing. |
| [CTRNet](https://github.com/lcy0604/CTRNet) | Scene-text removal with local-global context | **MIT code**; weights on Google Drive; trained on SCUT-EnsText | Possible | Research code, Python 3.6/PyTorch 1.3 era. The dataset is non-commercial; check the weight/data terms before use. |
| [EraseNet](https://github.com/lcy0604/EraseNet) | End-to-end scene text removal | **MIT code**; weights on Google Drive; SCUT-EnsText | Possible | Same dataset caveat. Built for scene text at 512 × 512, not cover display type. |
| [GaRNet](https://github.com/naver/garnet) | Gated-attention scene text removal, ECCV 2022 | **Apache-2.0 code**; SCUT-EnsText training data | Possible | Strong research baseline; non-commercial data caveat; not a drop-in book-cover tool. |
| [SCUT-EnsText](https://github.com/HCIILAB/SCUT-EnsText) | Scene-text-removal benchmark | **Non-commercial research only**, application required | — | The common training set behind CTRNet/EraseNet/GaRNet. This is the main licensing trap. |
| [Stable Diffusion inpainting](https://huggingface.co/runwayml/stable-diffusion-inpainting) | Diffusion inpainting | **CreativeML Open RAIL-M** (not OSI; use restrictions) | Theoretically, very slow | Can hallucinate plausible texture, but on CPU it is minutes per image and may invent content; not a deterministic removal tool. |
| [SDXL inpainting](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) | Larger diffusion inpainting | Open RAIL++-M | Theoretically, slower | Same caveat; heavier. |

**No maintained, book-cover-specific text-removal project was found.** The closest work is scene-text removal (CTRNet/EraseNet/GaRNet) and general inpainting (LaMa/MAT/IOPaint). Scene-text models are trained on natural scenes and small text; they are not tuned for a 300 px display face over a photograph, and their best data is non-commercial.

### OCR / text detection

| Project | Licence | CPU | Notes |
|---|---|---|---|
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | Apache-2.0 | Yes (ONNX) | Used here. ~5 s per 1303 × 2000 cover; found 13/17 boxes. Misses giant condensed display letters. |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Apache-2.0 | Yes | Stronger/more complete, heavier dependency; a good production candidate if the extra install size is acceptable. |
| [EasyOCR](https://github.com/JaidedAI/EasyOCR) | Apache-2.0 | Yes | PyTorch; easy, but heavier than RapidOCR. |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) | Apache-2.0 | Yes | Fast, but weak on stylised/condensed cover type; not sufficient alone. |
| [MMOCR](https://github.com/open-mmlab/mmocr) | Apache-2.0 | Yes | Full detection/recognition toolbox; heavier. |

### What the removal results mean

- **Text detection is not the hard part; text reconstruction is.** OCR finds most of the words, but the mask still needs a human for display type, stickers, bands and logos.
- **Mask size is the predictor of failure.** At 38.8% over dark wood, LaMa passes. At 70.4% over aerial forest, it fails. A simple production gate could be “mask > ~35% of art → do not claim clean art”.
- **Residual OCR is a weak test.** It catches leftover glyphs, not destroyed background. A perceptual/structural check (or human review) is still needed.
- **CPU is feasible but not free.** ~105 s per cover here; a shelf ingest of 20 modern covers would be ~35 minutes single-threaded, plus model load. Batch/async, not interactive.
- **The model is not deterministic in the artistic sense.** It fills from context; for a unique photograph, “plausible” is not “the original”.

---

## 2. Sources and projects for finding original / textless / spine artwork

This is the part that decides whether removal is even necessary. The honest taxonomy:

### A. Publisher, designer and artist sources

| Source | What it exposes | Licence / access | Modern coverage | Automation |
|---|---|---|---|---|
| [Lisa Amoroso — covers](https://lisaamorosodesign.com/) | The US *Rock Paper Scissors* cover, credited to Amoroso; **published cover only** | © designer/publisher; contact for use | Selected modern trade covers | Manual; no API; scrape only with permission |
| [Will Staehle / UNUSUAL CO.](https://unusualco.work/) | The US *Whisper Man* cover (Celadon, 2019); published cover/portfolio | © artist/publisher | Selected modern trade covers | Manual |
| [Celadon — “Behind the Design of The Whisper Man”](https://celadonbooks.com/interviews/uncovered-go-behind-the-design-for-the-whisper-mans-striking-cover/) | Process, art direction, the butterfly/hand illustration; final cover | Editorial; images © publisher | One title, US edition | Manual |
| [Hanka Steidle / Arcangel Images](https://arcangel.com/) | The door/child photograph associated with the UK *Whisper Man*; a German edition credits Hanka Steidle/Arcangel Images | **Licensed stock**; previews watermarked | Selected modern covers | Licensed search; **not** a free textless source |
| [Crime by the Book — RPS cover reveal](http://crimebythebook.com/blog/2021/1/25/cover-reveal-qa-rock-paper-scissors-alice-feeney) | The RPS cover reveal + designer Q&A; final cover | Editorial; image © publisher | One title | Manual |
| [AIGA 50 Books \| 50 Covers](https://designarchives.aiga.org/) | Award archive, credited designers/art directors | Final covers; © respective owners | Strong for US trade/art books | Manual; no bulk API |
| [The Book Cover Archive](https://bookcoverarchive.com/) | 1,300+ curated covers with designer/art director/photographer/illustrator credits | Final covers; © owners; site is a reference | Strong for modern trade | Manual/HTML; no open API; respect terms |
| [I Need a Book Cover](https://ineedabookcover.com/) | Cover directory + designer profiles | Final covers; © owners | Modern trade | Manual |
| [SPINE magazine](https://spinemagazine.co/) | Designer interviews and process | Editorial | Selected | Manual |

**Reality check:** these sources are excellent for *finding the designer* and for *credits*, but they publish the **typeset cover**, not a flat/textless file. A designer portfolio occasionally shows a textless comp; we found none for these two titles. The RPS portfolio image is the final cover. The UK *Whisper Man* image is a licensed stock photograph; the free preview is watermarked and not usable art.

### B. Book-cover archives and communities

| Source | What it exposes | Licence / access | Modern coverage | Automation |
|---|---|---|---|---|
| [Book Cover Archive](https://bookcoverarchive.com/) | Curated, credited final covers | © owners; reference site | Good | Manual; no API |
| [BookScans](https://www.bookscans.com/) | Front and back cover scans; “what the book looks like” | © owners; reference | Older/used books | Manual |
| [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers) | Covers by ISBN/OLID/OCLC/LCCN; S/M/L sizes | © owners; API | Broad, but often low-res | **Automated** |
| [Apple Books / iTunes Search API](https://performance-partners.apple.com/search-api) | 2000 px artwork for many editions | © publishers; API terms | Good for in-print trade | **Automated** (v2 used it) |
| [Google Books API](https://developers.google.com/books/) | Covers + metadata; sizes vary | © owners; API | Broad | **Automated** |
| [ISBNdb](https://isbndb.com/) | Covers/metadata | Paid | Good | **Automated**, paid |
| Goodreads / LibraryThing | Covers, some designer metadata | © owners; ToS restrictions | Broad | Scrape/ToS risk; use APIs where possible |
| [Textless Covers](https://textlesscovers.wordpress.com/about) | Weekly textless **comic** covers | © publishers; fan archive | Comics only | Manual; not prose books |
| Reddit “book spine database” / [open-shelves](https://github.com/capjamesg/open-shelves) / [library-dataset](https://github.com/llabres/library-dataset) | Photographed **spines**, CV detection datasets | open-shelves archived/no licence; library-dataset MIT | Library/used-book spines | Research; not textless cover art |
| [ShelvesAI](https://shelvesai.com/) | Commercial spine reading/tracking | Proprietary | Physical shelves | Commercial; not an art source |

**Reality check:** no public prose-book archive we found exposes flat/textless cover art as a searchable collection. Textless-cover communities are overwhelmingly comics-focused and do not generalise to prose jackets. Spine CV datasets give you *photographs of spines*, not the front-cover artwork.

### C. Library / edition / credit databases

| Source | What it exposes | Licence / access | Modern coverage | Automation |
|---|---|---|---|---|
| [Open Library](https://openlibrary.org/developers/api) | Editions, ISBNs, covers, some contributor roles | Open data; covers © owners | Broad | **API** |
| [Wikidata](https://www.wikidata.org/) | Edition/cover-artist/illustrator statements, links | CC0 data | Patchy for cover artists | SPARQL/manual |
| [LibraryThing](https://www.librarything.com/) | Editions; sometimes cover designer credits | © / community | Good for older trade | Manual |
| [Library of Congress](https://www.loc.gov/) | Catalog records; some cover scans | Public records; images vary | Broad | API/manual |
| Publisher pages ([Penguin](https://www.penguin.co.uk/), [Macmillan/Flatiron](https://us.macmillan.com/)) | High-res final covers, edition metadata, sometimes credits | © publishers | Strong for in-print | Manual/HTML |
| [Standard Ebooks](https://standardebooks.org/) | PD ebooks + 1400 × 2100 typographic covers; artwork credits | PD dedication | Classics only | **Automated downloads** |

**Reality check:** these are for *edition identification and credits*, not for textless art. Wikidata’s “cover art by”/illustrator statements are sparse and inconsistent.

### D. Public-domain art / illustration archives (the reliable route for classics)

| Source | What it exposes | Licence | Modern coverage | Automation |
|---|---|---|---|---|
| [Wikimedia Commons](https://commons.wikimedia.org/) | Original paintings, illustrations, high-res scans | PD/CC; **verify per file** | None (PD only) | **API**, manual search per title |
| [The Met Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access) | 400k+ images, CC0 where marked | CC0 | None | **API** |
| [Art Institute of Chicago](https://www.artic.edu/open-access) | Open-access images | CC0 where marked | None | **API** |
| [Rijksmuseum](https://www.rijksmuseum.nl/en/research/conduct-research/data) | High-res PD art | PD | None | **API** |
| [Smithsonian Open Access](https://www.si.edu/openaccess) | CC0 images/metadata | CC0 | None | **API** |
| [Europeana](https://www.europeana.eu/en/rights) | Aggregated cultural heritage | **Rights vary** | None | API; filter by rights |
| [NYPL Digital Collections](https://digitalcollections.nypl.org/) | PD prints/photographs | PD where marked | None | API |
| [Project Gutenberg](https://www.gutenberg.org/) / [Internet Archive](https://archive.org/) | Scanned books, some original illustrations | PD/varied | None | Scans; need cropping |
| [WikiArt](https://www.wikiart.org/) | Aggregated paintings | **Reproduction rights unclear** | None | Not recommended for automated reuse |

**Reality check:** this is the only source class that routinely works at scale, and it is why v3 can use genuine text-free art for 15 classics. Coverage stops at the public domain; it cannot help with a 2021 trade cover.

### E. Projects specifically indexing spines or cover variants

- [open-shelves](https://github.com/capjamesg/open-shelves) — computer vision for book-spine detection; **archived, no licence**; dataset on Roboflow. Useful for shelf detection, not art.
- [library-dataset](https://github.com/llabres/library-dataset) — MIT; library inventory/spine matching; photographs, not cover art.
- Community “book spine database” projects (Reddit/Flickr) — photographed spines, no public API, no textless art.
- Comic “textless covers” communities — textless art for comics, not prose books.
- **No project found that indexes textless prose-book cover art or flat cover variants.**

One important distinction: this prototype puts the **front-cover artwork** on the spine. The printed spine of a real book is usually a separate layout, often with its own type and colour, and it is not the front cover art. Photographed-spine datasets (open-shelves, library-dataset) are for *identifying* books, not for sourcing clean spine art. If the goal is to reproduce the printed spine, you need a physical scan/photograph or the publisher's spine file; there is no open spine-art archive.

---

## 3. Recommendation

### When to search for genuine original art

1. **Public-domain classics.** Always start at Wikimedia Commons / Met / AIC / Rijksmuseum / Smithsonian. Look up the painting named in the edition's credit, verify the file's PD status, and use the original. This is faster and better than inpainting a Standard Ebooks plate. v3 does this for 15/18.
2. **Modern covers with a known illustrator/photographer.** Check the designer/artist portfolio and the publisher's cover-reveal/design interview. If a textless comp exists, ask for permission or license it. Do not scrape watermarked stock previews.
3. **Licensed stock libraries** (Arcangel, Trevillion, etc.). Searchable and licensable, but the preview is watermarked and the licence is per-use. This is the legitimate route for the UK *Whisper Man* photograph if the exact image is needed.
4. **Award/annual archives** (AIGA, D&AD, TDC). Good for discovering the designer and a higher-quality final cover; still not textless.

### When to inpaint

- The text mask is **modest** (rule of thumb: under ~35% of the art), and the background is **low-frequency or repetitive** (dark wood, sky, snow, fabric, gradients).
- You can keep the spine crop **out of the damaged area**.
- You have a **human review** step and a **residual-text check**.
- You are honest that the result is a reconstruction, not the original.

LaMa on CPU is the right first tool: Apache-2.0, simple, deterministic, good at large smooth regions. RapidOCR is the right first detector: Apache-2.0, ONNX, CPU, fast. Add manual mask polygons for display type and stickers.

### When to accept a typographic cover (or a different edition)

- The mask is **large** (> ~50%) or the background is **unique high-frequency photography** — *Rock Paper Scissors* is the canonical failure.
- The title is **integrated** with the artwork (cut-out letters, art inside glyphs, foil/embossing).
- Legal/licensing clarity matters more than the visual effect.
- A different edition has a cleaner cover or a genuine textless asset.

Do **not** ship an “art only” spine that still contains printed cover text. If the printed title is kept, design for it (v2's band/rail approach) and label it. If removal fails, fall back to a typographic spine or a different edition; do not present a 70%-masked cover as clean art.

### Suggested production gate

```
if PD/classic:
    use source artwork (verify PD)
elif licensable textless asset:
    use it (record licence + credit)
elif text_mask_fraction <= 0.35 and background is low-frequency:
    OCR + LaMa + human review + residual check
else:
    typographic spine or different edition
```

Record, per title: source URL, licence, edition ISBN, mask file, model version, mask fraction, review status. That is what makes the difference between a design study and a pipeline you can trust.

---

## 4. What v3 actually did, book by book

| Group | Books | Method | Result |
|---|---|---|---|
| Classics, original painting | 15: *Moby-Dick*, *Jane Eyre*, *Pride and Prejudice*, *Dracula*, *Great Expectations*, *Bleak House*, *Middlemarch*, *The Moonstone*, *The Time Machine*, *Treasure Island*, *Dr Jekyll and Mr Hyde*, *The Hound of the Baskervilles*, *The Picture of Dorian Gray*, *The Scarlet Letter*, *Wuthering Heights* | Original PD painting from Wikimedia Commons; 2:3 crop; no inpainting | Genuine textless art. Source file and credit in `sources.json`. |
| Classics, cover crop | 3: *Frankenstein* (Arcimboldo, *Portrait of Adam*, private collection), *The Turn of the Screw* (Grimshaw, *A Wintry Moon*, private collection), *Alice* (Shishkin, *Amanita*, exact high-res source not found) | Use the art above the Standard Ebooks title plate; no inpainting | Textless, but a crop of the cover rather than a museum file. Labelled as such. |
| Modern, pass | *The Whisper Man* (Penguin UK, 9781405936019) | RapidOCR + manual polygons + LaMa; 38.8% mask | Plausible dark door/child art; no residual OCR. |
| Modern, fail | *Rock Paper Scissors* (Flatiron US, 9781250266118) | RapidOCR + manual polygons + LaMa; 70.4% mask | Grey, textureless snow; church survives; honest **REVIEW**. |

### Genuine textless vs inpainted

- **Genuine textless:** 15 classics (original paintings) + 3 classics (untypeset crop above the plate) = **18/20**.
- **Inpainted:** **2/20** — *The Whisper Man* and *Rock Paper Scissors*.
- **Genuine textless for the two modern covers:** **none found.** The RPS designer portfolio shows the published cover; the UK *Whisper Man* image is a licensed stock photograph; the US *Whisper Man* is a different cover (butterfly/hand) and also not a free textless asset.

---

## 5. Main quality failures (honest list)

1. **RPS background is destroyed.** 70.4% mask; LaMa cannot rebuild the aerial forest. The church and some tree clusters survive; the rest is a grey gradient. At spine scale it reads as a pale snow strip, not the cover's art.
2. **RPS red band.** Removing the right-hand marketing band also removes a strong graphic element. The remaining art is much weaker than the cover.
3. **OCR misses display type.** RapidOCR read `ALI` / `ICE`, `FE` / `EENE`, `RO`, not the full words. A human had to draw six large polygons. Without that, the result would still show red letter fragments.
4. **Mask previews are coarse.** The magenta rectangles are mask *supplements*, not glyph-tight outlines. They are honest about the area removed but make the mask look blockier than the actual text.
5. **Whisper Man stickers leave large reconstructed patches.** The Netflix badge and quote sticker are big rectangles; LaMa fills them with door/wood, which is plausible but not the original photograph. At full size, the patches are soft.
6. **Classic crops change the composition.** Using the full painting instead of the Standard Ebooks crop can shift the subject. v3 records a focus point, but a 33% spine slice is still an interpretation. The three cover-crop fallbacks use the SE art area, so they lose the bottom quarter of the painting.
7. **Classic source resolution varies.** Some Wikimedia files are 900–1,600 px on the short edge after the 1,800 px request; all are adequate for a 56 px spine, but not for a large hero at 2× on a tablet.
8. **Title rail is a compromise.** It is legible and toggleable, but on a 56 px spine it covers 40–42% of the art. Art-only is the honest default; with-rail is the usable default.
9. **No semantic check.** The pipeline cannot tell a face from a door. The rail side is chosen by edge busyness, not by “don't cover the child”.
10. **CPU cost.** ~105 s per modern cover; fine for a prototype, not for interactive ingest without a queue.

---

## 6. Link list

**Removal / inpainting**
- https://github.com/Sanster/IOPaint
- https://github.com/advimman/lama
- https://github.com/enesmsahin/simple-lama-inpainting
- https://github.com/fenglinglwb/MAT
- https://github.com/lcy0604/CTRNet
- https://github.com/lcy0604/EraseNet
- https://github.com/naver/garnet
- https://github.com/HCIILAB/SCUT-EnsText
- https://huggingface.co/runwayml/stable-diffusion-inpainting
- https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1

**OCR**
- https://github.com/RapidAI/RapidOCR
- https://github.com/PaddlePaddle/PaddleOCR
- https://github.com/JaidedAI/EasyOCR
- https://github.com/tesseract-ocr/tesseract
- https://github.com/open-mmlab/mmocr

**Design / cover / credit sources**
- https://bookcoverarchive.com/
- https://ineedabookcover.com/
- https://designarchives.aiga.org/
- https://spinemagazine.co/
- https://lisaamorosodesign.com/
- https://unusualco.work/
- https://celadonbooks.com/interviews/uncovered-go-behind-the-design-for-the-whisper-mans-striking-cover/
- http://crimebythebook.com/blog/2021/1/25/cover-reveal-qa-rock-paper-scissors-alice-feeney
- https://arcangel.com/
- https://www.bookscans.com/
- https://textlesscovers.wordpress.com/about

**Edition / cover APIs**
- https://openlibrary.org/dev/docs/api/covers
- https://openlibrary.org/developers/api
- https://performance-partners.apple.com/search-api
- https://developers.google.com/books/
- https://isbndb.com/
- https://www.wikidata.org/
- https://www.librarything.com/

**Public-domain art**
- https://commons.wikimedia.org/
- https://www.metmuseum.org/about-the-met/policies-and-documents/open-access
- https://www.artic.edu/open-access
- https://www.rijksmuseum.nl/en/research/conduct-research/data
- https://www.si.edu/openaccess
- https://www.europeana.eu/en/rights
- https://digitalcollections.nypl.org/
- https://standardebooks.org/
- https://www.gutenberg.org/
- https://archive.org/

**Spine CV / communities**
- https://github.com/capjamesg/open-shelves
- https://github.com/llabres/library-dataset
- https://shelvesai.com/

---

*This is a design-study memo, not legal advice. Licences were checked at the repository/page level on 2026-11-26; model weights and training data can carry stricter terms than the code licence, especially the SCUT-EnsText-based scene-text models.*
