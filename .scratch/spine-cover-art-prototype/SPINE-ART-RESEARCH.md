# Spine artwork without printed typography — technical research

**Date:** 2026-11-26  
**Scope:** What a per-ISBN pipeline could actually retrieve for a PocketLibrary spine prototype: real spine photos, high-resolution front covers, textless original art, and reconstruction fallbacks.  
**Status:** Research only. Nothing here changes production code, the existing prototype, manifests, tests or specs. Test scripts and downloaded samples live in `/tmp/opencode`, not in the repo.  
**Licensing:** Ignored as a blocker for this investigation, but sources and licences are recorded. Cover images are copyrighted; marketplace photos belong to sellers; Apple/Amazon terms restrict reuse. Everything below is for internal prototyping.

---

## TL;DR — ranked recommendation

| Need | Best route | Why | Automation |
|---|---|---|---|
| **Real spine photo** | Used-book marketplace seller photos (AbeBooks first, eBay second) | The only source that sometimes contains an actual photographed spine, at up to ~1500 px on the long edge. Availability per ISBN is low and unpredictable. | Partial: search + image download can be automated; “does this photo show the spine?” needs vision/human review. |
| **High-res front cover** | Apple Books/iTunes artwork URL, rewritten to native size | Largest consistently available front covers: **1613×2475** for *Rock Paper Scissors*, **1524×2339** for *The Whisper Man*. No key, JSON API. | Fully automatable per ISBN/region. |
| **Textless original art** | Trace the cover’s source: publisher design credit → designer/artist portfolio → stock agency (Arcangel/Plain Picture/Alamy) → press kit | Only route that yields true, high-quality art without type. For the two sample titles the credits exist, but the exact untyped file was not publicly retrievable in this test. | Human/visual research. Reverse image search can assist but does not finish the job. |
| **Fallback if no original** | Art-aware crop of a text-free vertical strip from the front cover; only inpaint small text | At a 27–30 px spine, a text-free strip is enough. Avoid inpainting display type: LaMa at 512 px destroyed the artwork in our test. | Fully automatable crop; inpaint needs review. |
| **Full textless flat** | Modern generative fill (Flux Fill / Qwen Image Edit / SD inpainting) or a commercial book-cover text remover | LaMa/MAT-class models are not strong enough for 100–300 px display lettering over detailed art. | Human-reviewed generation. |

**Bottom line:** there is **no public, per-ISBN source of real spine images and no public source of textless flats**. The reliable per-ISBN asset is a high-resolution front cover. Real spines exist only as marketplace seller photos or inside shelf-photo datasets that have no ISBN mapping. Textless art is a research task, not a lookup.

---

## 1. What was actually tested

All HTTP tests were run on 2026-11-26 from this machine. Image dimensions were read with `file`/`ffprobe`; a few were visually inspected.

| Source | Request | Result |
|---|---|---|
| Apple iTunes Search | `itunes.apple.com/search?term={isbn}&entity=ebook&country=gb` | **200**, JSON, 1 result for each title in at least one region |
| Open Library edition | `openlibrary.org/isbn/{isbn}.json` | **200**, JSON |
| Open Library covers | `covers.openlibrary.org/b/isbn/{isbn}-L.jpg` | 200; `-XL` returns a 43-byte 1×1 GIF |
| Google Books API (keyless) | `googleapis.com/books/v1/volumes?q=isbn:...` | **429**, daily quota 0 |
| Google Books web | `books.google.com/books?vid=ISBN...` | **200**, page scrape works; content images max 800 px |
| Amazon image CDN by ISBN | `images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg` | 200 for print ISBNs; 1×1 GIF for the two e-book ISBNs |
| Amazon image CDN by image id | `m.media-amazon.com/images/I/{id}.jpg` | 200, master 1613×2475 |
| Penguin UK product page/CDN | `penguin.co.uk/books/...` + `cdn.penguin.co.uk/...jacket-large.jpg` | 200, but only 326×500 |
| Penguin Random House image CDN | `images.penguinrandomhouse.com/cover/{isbn}` | 200, only 297×449 |
| AbeBooks search | `abebooks.com/servlet/SearchResults?isbn={print isbn}` | 200; results are client-rendered; print ISBN works, e-book ISBN says “no exact matches” |
| AbeBooks images | `pictures.abebooks.com/isbn/...` and `/inventory/...` | 200; stock images ~329×500, seller photos up to 987×1500 |
| eBay search | `ebay.co.uk/sch/i.html?_nkw={isbn}` | **403** |
| ThriftBooks | `thriftbooks.com/isbn/{isbn}/` | **406** |
| Alibris / Biblio / Kobo / Waterstones / Bookshop.org / HathiTrust | product/search URLs | **403** (Cloudflare “Just a moment…” for most) |
| Internet Archive search | `archive.org/advancedsearch.php?q=isbn:...` | 200; **0 results** for both ISBNs |
| Internet Archive title search | `q=title:(whisper man) AND mediatype:texts` | 2 results, both junk/spam uploads |
| Internet Archive page image | `archive.org/download/{id}/page/n0_w800.jpg` | 200, 1220×1579 (spam poster); PD scan n0 = front board, not spine |
| Zenodo ShelfAura | `zenodo.org/api/records/19135523` | 200; 166 MB ZIP, CC BY 4.0 |
| Hugging Face book-spine OCR | `datasets-server` metadata | 200; 8,190 rows, 1.41 GB, 512 px spine crops |
| TinEye | URL search + file upload via headless browser | 200; works without an API key from this IP |
| Google Lens | `lens.google.com/uploadbyurl?...` | redirect to Google “unusual traffic” CAPTCHA |
| Yandex Images | `yandex.com/images/search?rpt=imageview&url=...` | 200, works but noisy results |
| LaMa ONNX | `huggingface.co/Carve/LaMa-ONNX` | 208 MB model, fixed 512×512 input/output; ran on CPU |

---

## 2. Real spine images

### 2.1 Used-book marketplaces

**AbeBooks is the most usable.** It renders results client-side, so plain `curl` returns a shell page, but a headless browser gets real listings. Print ISBN search works; **e-book ISBN search does not**:

```text
https://www.abebooks.com/servlet/SearchResults?isbn=9781250266101   # Rock Paper Scissors hardcover — works
https://www.abebooks.com/servlet/SearchResults?isbn=9781250266118   # e-book ISBN — "unable to find exact matches"
https://www.abebooks.co.uk/servlet/SearchResults?isbn=9781405935999 # The Whisper Man paperback — works
https://www.abebooks.co.uk/servlet/SearchResults?isbn=9781405936019 # e-book ISBN — "unable to find exact matches"
```

Image URL patterns (both HTTP 200):

```text
https://pictures.abebooks.com/isbn/9781250266101-us.jpg                  # 329×500 stock cover
https://pictures.abebooks.com/isbn/9781250266101-us._SL1500_.jpg         # still 329×500; stock art has no larger master
https://pictures.abebooks.com/inventory/32329193375._SL1500_.jpg         # 987×1500 seller photo
https://pictures.abebooks.com/inventory/32329193375._SL300_FMavif_.jpg   # 195×300 listing thumbnail
```

The 987×1500 seller photo for *Rock Paper Scissors* was a straight-on **front cover**, not a spine. AbeBooks listings can include multiple seller photos, but in this sample the gallery was a single image. Sellers of collectible/older books sometimes photograph spines, but there is no structured “spine available” flag; you have to inspect the photos.

**eBay** has an official Browse API (`getItem` returns `image.imageUrl` and `additionalImages`) but requires OAuth application credentials. Public search pages returned **403** from this IP. Even via the API, seller photos are predominantly front covers.

**ThriftBooks / Biblio / Alibris / Bookshop.org / Waterstones / Kobo** all blocked automated access (**406** or Cloudflare **403**). None exposed a public per-ISBN image API in this test.

**Verdict:** marketplaces are the best source of an actual photographed spine, but coverage per ISBN is poor and you cannot rely on it. For the two sample titles, no spine photo was found.

### 2.2 Library and archive scans

**Internet Archive**

- `advancedsearch.php?q=isbn:9781405936019` → `numFound: 0`; same for `9781250266118`.
- Title search for “whisper man” returned two user uploads. The first page image was a movie-spam poster, not a book:

```text
https://archive.org/download/the-whisper-man_202610/page/n0_w800.jpg  → 1220×1579 spam poster
https://archive.org/download/the-whisper-man_202610/page/n0.jpg       → 4879×6314 spam poster
```

- A genuine public-domain scan (`aliceinwonderlan00gersrich`) returned n0 = **1433×2037 front board**, not a spine. IA’s BookReader page stream begins with the front cover/board and runs through the text; it does not add a spine view.
- IA metadata for the spam item had a PDF, JP2 ZIP and OCR but no ISBN. IA is not an ISBN-addressable cover service for modern books.

**HathiTrust** catalog and page-image endpoints returned Cloudflare **403** from this IP. I could not verify page-image access. Structurally, HathiTrust page streams also represent the book block, not a spine.

**Google Books** has preview page images but the public API is unusable without a key right now:

```json
{"error":{"code":429,"message":"Quota exceeded ... limit 'Queries per day' ... quota_limit_value: \"0\""}}
```

The web page works. For *The Whisper Man*, `vid=ISBN9781405936019` resolves to volume `Ch5iDwAAQBAJ`; for *Rock Paper Scissors*, `VpsOEAAAQBAJ`. Front-cover image request:

```text
https://books.google.com/books/content?id=Ch5iDwAAQBAJ&printsec=frontcover&img=1&zoom=4
→ 800×1230 JPEG
```

`zoom=5` returns the 128×196 placeholder; `printsec=backcover` returns a grey placeholder PNG (575×750), not a real back cover.

**Verdict:** archives are excellent for public-domain book blocks, useless for spine art, and not ISBN-queryable for modern titles.

### 2.3 Computer-vision / shelf datasets

**“BookSpineNet”**: no public dataset, paper or code by that name surfaced in searches. Treat it as a name that does not currently correspond to a usable resource. The real named projects are:

| Dataset | Size / content | ISBN mapping? | Notes |
|---|---|---|---|
| **ShelfAura** (Zenodo 19135523, CC BY 4.0) | 111 shelf photos (1024×1536), 1,754 cropped spines | **No** | Downloaded and inspected: CSV columns are `crop_filename, shelf_no, arrangement_type, stack_no, row_no_inside_stack, book_no, title, author, series_or_chapter_number, series_or_chapter_title, publication` — no ISBN. Crop example `BookShelf_111_book_0017.png` is **321×38 px**. |
| **4TU book-spine segmentation** (Zhong/Yang) | 661 shelf images, ~15,454 labelled spines, 766 MB | **No** | Polygon/COCO annotations; shelf scenes, not isolated per-title art. |
| **IEEE DataPort on-shelf spine dataset** | 1,849 images, ~3000×4000, 4.31 GB | **No** | Login required; instance segmentation annotations. |
| **HF `quist99/book-spine-ocr`** | 8,190 rows, 1.41 GB, 512 px spine crops | **No** | OCR instruction/answer pairs (`title`, `author`, `call_no`). |
| **Stanford Mobile Visual Search spine set** | ~2,300 spine images, 2011 | **No** | Old phone-camera research set. |
| **Roboflow / Ultralytics book-spine sets** | Thousands of shelf images | **No** | Detection/segmentation only. |

Every cropped spine in these datasets **contains printed spine typography by design** — OCR of the spine is the task. They are useful for training a “find and straighten the spine” model, not for supplying clean art, and none maps an ISBN to a spine image.

**Verdict:** no per-ISBN spine dataset exists in public. The datasets are shelf-scene corpora for detection/OCR.

---

## 3. High-resolution front covers

### 3.1 Apple Books / iTunes Search API

This is the best per-ISBN cover endpoint tested. No key, JSON, and artwork URLs can be rewritten to the native master.

```text
https://itunes.apple.com/search?term=9781250266118&entity=ebook&country=us&limit=5
```

Response shape (trimmed):

```json
{
  "resultCount": 1,
  "results": [{
    "trackName": "Rock Paper Scissors",
    "artistName": "Alice Feeney",
    "releaseDate": "2021-09-07T07:00:00Z",
    "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/b7/dd/3c/.../9781250266118.jpg/100x100bb.jpg",
    "trackViewUrl": "https://books.apple.com/us/book/rock-paper-scissors/id..."
  }]
}
```

Rewrite the trailing size segment:

```text
.../9781250266118.jpg/100x100bb.jpg      → 100 px
.../9781250266118.jpg/2000x2000bb.jpg    → 1303×2000
.../9781250266118.jpg/5000x5000bb.jpg    → 1613×2475 (native; same bytes for 3000/4000/5000)
```

Native maxima measured:

| Title | Region | Native artwork | Notes |
|---|---|---|---|
| *The Whisper Man* 9781405936019 | GB, AU | **1524×2339** | Current image is the **2026 Netflix film tie-in** (boy at door, Netflix badge), not the original 2019 gold-butterfly cover. |
| *Rock Paper Scissors* 9781250266118 | US, CA | **1613×2475** | Includes the red “MILLION-COPY BESTSELLING AUTHOR” band on the right. |

Exact native-size URLs for the two samples:

```text
https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/dd/15/e4/dd15e43d-c935-de16-65f7-9b20558774bf/9781405936019.jpg/5000x5000bb.jpg
→ 1524×2339, 692,175 bytes (The Whisper Man, film tie-in)

https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/b7/dd/3c/b7dd3ca0-ca75-afd1-66a4-1da048aa42ff/9781250266118.jpg/5000x5000bb.jpg
→ 1613×2475, 1,204,611 bytes (Rock Paper Scissors)
```

Region behaviour is real: *Rock Paper Scissors* returned **0 results** in GB and AU; *The Whisper Man* returned **0** in US and CA but 1 in GB and AU. Always specify `country`.

Requesting a size larger than native returns the native bytes (not an error), so a pipeline can ask for 3000×3000 and then record the actual dimensions. Requesting `100000x100000bb` returns **HTTP 400**.

**Caveat:** Apple’s image for an ISBN can change when the publisher updates the edition. The e-book ISBN 9781405936019 now serves a tie-in cover while Open Library still serves the original. Cache provenance and timestamp.

### 3.2 Open Library

```text
https://openlibrary.org/isbn/9781405936019.json
→ { "title": "Whisper Man", "covers": [14769008], "isbn_13": ["9781405936019"], ... }
```

Cover sizes:

```text
https://covers.openlibrary.org/b/isbn/9781405936019-L.jpg   → 260×400, 51,702 bytes (original gold butterfly)
https://covers.openlibrary.org/b/id/14769008-L.jpg           → same 260×400
https://covers.openlibrary.org/b/isbn/9781250266118-L.jpg   → 43-byte 1×1 GIF (missing)
https://covers.openlibrary.org/b/id/10826952-L.jpg           → 329×500 (Rock Paper Scissors)
https://covers.openlibrary.org/b/id/10826952-XL.jpg         → 43-byte 1×1 GIF
```

Open Library’s `-L` is the largest useful size and is typically only 400 px tall. There is no `-XL` master in practice. It is a good fallback and a good source for the **original** edition when Apple has moved to a tie-in, but it is not high-resolution.

### 3.3 Google Books

Keyless API is blocked by quota (`429`, quota limit 0). Page scraping works but content images cap at **800 px** on the long edge:

| Title | Volume id | `zoom=4` result |
|---|---|---|
| *The Whisper Man* | `Ch5iDwAAQBAJ` | 800×1230 |
| *Rock Paper Scissors* | `VpsOEAAAQBAJ` | 800×1215 |

`printsec=backcover` is a placeholder. Google Books is a metadata/volume-id source, not a high-res art source.

### 3.4 Amazon image CDN

Two different behaviours:

```text
https://images-na.ssl-images-amazon.com/images/P/1405936010.01.LZZZZZZZ.jpg  → 325×500 (Whisper print ISBN-10)
https://images-na.ssl-images-amazon.com/images/P/1250266106.01.LZZZZZZZ.jpg  → 329×500 (RPS print ISBN-10)
https://images-na.ssl-images-amazon.com/images/P/1250266118.01.LZZZZZZZ.jpg  → 1×1 GIF (RPS e-book ISBN)
```

The `P/{ISBN10}` endpoint only works for print ISBNs and only at ~325×500. The master image is reachable if you know the image id:

```text
https://m.media-amazon.com/images/I/91DBQWyg7FL.jpg              → 1613×2475, 549.7 kB
https://m.media-amazon.com/images/I/91DBQWyg7FL._SL1500_.jpg     → 978×1500
https://m.media-amazon.com/images/I/91DBQWyg7FL._SL2000_.jpg     → 1303×2000
```

Finding the image id normally means scraping an Amazon product page (blocked here: Amazon UK returned a 3.8 kB shell, Amazon US a 404) or using a dataset/search result. Once known, the CDN is reliable.

### 3.5 Publisher sites and CDNs

Penguin UK product page returned 200 and exposed an `og:image`:

```text
https://cdn.penguin.co.uk/dam-assets/books/9781405936019/9781405936019-jacket-large.jpg  → 326×500
https://cdn.penguin.co.uk/dam-assets/books/9781405936019/9781405936019-jacket-hsize.jpg  → 260×400
```

Penguin Random House image CDN:

```text
https://images.penguinrandomhouse.com/cover/9781405936019             → 297×449
https://images.penguinrandomhouse.com/cover/9781405936019?width=1200  → 111×168 (query made it smaller)
```

Macmillan’s `images.macmillan.com/folio-assets/...` returned **403** for every pattern tried. Publisher CDNs are low-resolution marketing copies; they are useful for confirming the current jacket, not for art extraction.

### 3.6 Other retailers

- Barnes & Noble product pages returned 200 (1.5 MB HTML), but the cover is `9781250266118_p0.jpg` at roughly **410×630**.
- Kobo, Waterstones, Bookshop.org, Alibris, Biblio: blocked (403).
- Bookshop.org has no public per-ISBN image API; it is Cloudflare-protected.
- Publisher ONIX feeds (not tested; requires an account) normally carry a cover URL in the 300–1000 px range, almost always a typeset front cover, not a textless flat. Treat ONIX as metadata plumbing, not an art source.

### 3.7 Cover source summary for the two titles

| Source | *The Whisper Man* 9781405936019 | *Rock Paper Scissors* 9781250266118 |
|---|---|---|
| Apple | **1524×2339**, current film tie-in | **1613×2475**, with red promo band |
| Open Library | 260×400, original gold butterfly | 329×500 (by cover id), ISBN lookup missing |
| Google Books | 800×1230 | 800×1215 |
| Amazon | 325×500 | master 1613×2475 by image id; 329×500 by print ISBN |
| Publisher | 326×500 (Penguin) | Macmillan CDN 403 |
| B&N | not tested | ~410×630 |
| AbeBooks | e-book ISBN fails; print ISBN works, stock 326×500 | print ISBN works; seller photo 987×1500, clean front |
| Internet Archive | no ISBN, junk uploads | no results |
| Real spine | none found | none found |
| Textless original | not publicly found | not publicly found |

**Edition gotcha:** both supplied ISBNs are **e-book ISBNs**. The print editions are different objects with different covers and different marketplace availability:

- *The Whisper Man*: e-book 9781405936019; paperback 9781405935999.
- *Rock Paper Scissors*: e-book 9781250266118; hardcover 9781250266101.

An ISBN-driven pipeline must resolve e-book vs print first. Amazon’s `P/` endpoint and AbeBooks exact-ISBN search both fail on the e-book ISBNs and work on the print ISBNs.

---

## 4. Finding the original / textless artwork

### 4.1 Reverse image search — what works and what does not

**TinEye works from a headless browser without an API key** (it has a public upload form and search-result page). Results include dimensions, source page, and sometimes a “STOCK” filter. This is the most automatable reverse-search route tested.

- *The Whisper Man* (current Penguin jacket): **11 results**. The only stock result was an **Alamy** page for a 2026 Netflix film poster/still; the rest were foreign editions and the film poster. No textless art.
- *Rock Paper Scissors* (Apple 2000 px): **42 results**. Best match was `amazon.com` `91DBQWyg7FL.jpg` at **1613×2475**; also B&N **410×630**, Google Play, Chapters Indigo. No stock/textless result.
- A text-free crop of the *Rock Paper Scissors* chapel art (500×500) returned **9 results**, including 2013 news photos of a snow-covered church. That is the right *kind* of source, but not an exact match to the cover’s stock photo.
- A text-free crop of the *Whisper Man* boy/door art returned **1 result**, an unrelated film still.

**Google Lens** is the best visual matcher but returned a Google “unusual traffic” CAPTCHA from this IP. It is not reliably scriptable without a proxy/API.

**Yandex Images** returned 200 and did find “the whisper man” as a text description, but the visual matches were unrelated posters and stock photos. Usable interactively, noisy programmatically.

**Bing Visual Search** has an official API but requires a key; the public web endpoint I tried fell back to the Bing Images homepage. Not usable without credentials.

**Practical conclusion:** reverse image search finds **other copies of the same typeset cover**, not the underlying textless art. To have any chance of finding the source photo/illustration, you must crop or mask out the typography first, then search the remaining art. Even then, matching is probabilistic and needs a human to confirm the stock/artist page.

### 4.2 Designer and stock credits — the strongest lead

The cover’s credits are often the shortest path to the untyped artwork.

**The Whisper Man**

- UK 2019 cover: photography credited to **Hanka Steidle / Arcangel Images** (and Plain Picture in some editions). The original is a gold butterfly whose wing pattern is made of skulls/bones. The designer/stock agency, not the publisher, holds the clean image.
- US Celadon cover: designed/illustrated by **Will Staehle** (Unusual Co.). Celadon published a design interview with process detail:
  - `https://celadonbooks.com/whisper-man-cover-design-interview/`
  - It describes ~15 designs and the chosen butterfly/hand concept. The article’s hero image is a 1024×768 process/mockup image, not a textless master.
- Will Staehle’s portfolio has a presentation image at **1499×999**:
  - `https://images.squarespace-cdn.com/content/v1/5f8e614ab5b491727430ceb7/1617098057103-CAGBX4MASBPENX9C0KJP/whisperman.jpg`
  - It shows the typeset cover on a photographic background; no textless flat.
- The current film tie-in art looks like Netflix film key art (boy at door, blue glove through letterbox). That is likely a separate asset held by the film’s marketing chain rather than the book publisher. A textless still may exist in a press kit, but I did not find a public one.

**Rock Paper Scissors**

- Designer/art director: **Lisa Amoroso** (credited by I Need a Book Cover).
  - `https://ineedabookcover.com/book-covers/rock-paper-scissors/`
  - `https://www.lisaamorosodesign.com/`
- Her portfolio contains a **2499×2205** presentation JPEG:
  - `https://images.squarespace-cdn.com/content/v1/55f0f0c5e4b029d118c2af6d/1622986072100-ERKPRSGD73SRSC9A9NX8/RockPaperScissors_website_2500px.jpg`
  - The actual cover is ~1460 px tall inside that canvas, and it is still typeset. It is a cleaner, badge-free front than Apple’s red-band version.
- The background is a stock-style aerial photo of a snowy forest with a small chapel. The exact stock image was not identified. A reverse search on the art-only crop found similar 2013 news photos of a snow-covered church, not the exact frame.

### 4.3 Publisher press kits and “wrap no text” assets

Some publishers do distribute textless wraps. Example: Robert Beatty’s media kit lists “Book Cover (wrap no text)” alongside “jacket” and “wrap” downloads:

```text
https://robertbeattybooks.com/media-kit/
```

Downloads there are `.heic`; the ones tested came back **512×512**, and one was a textless texture panel. This proves the asset type exists, but it is title-specific, buried in press pages, and not indexed by ISBN. There is no public “textless cover” database or API.

### 4.4 Cover archives and datasets

- **Book Cover Archive / I Need a Book Cover / cover-design blogs**: searchable by title/designer, but they display the published typeset cover. Useful for finding the designer, not the flat.
- **BookCover30 / Book32 / ISCC book covers / Kaggle book covers**: hundreds of thousands to millions of **typeset front covers**, often with ISBN. They are useful for training cover recognition/embeddings, but they contain no textless art.
  - `iscc/iscc-book-covers` on Hugging Face has 3.08M rows with `isbn`, `title`, `image_url` (Amazon `_SL800_` URLs) and ISCC content IDs. I downloaded shard 0 (769,930 rows) and searched it: neither target ISBN (nor their print ISBNs) was in that shard, so the dataset is not a complete per-ISBN index. The dataset-viewer search endpoint was still loading its index.
  - The BookCover30/Book32 images are 224×224 or Amazon thumbnails — far too small for spine art.
- **No dataset of textless flats** surfaced in any search. The academic literature explicitly notes that text is almost always present and that a text-free cover corpus would be needed to learn art-only generation.

---

## 5. Reconstruction when no original exists

### 5.1 What the model landscape looks like

| Approach | Tools | Strength | Weakness |
|---|---|---|---|
| Classical inpainting | OpenCV Telea/Navier-Stokes | Fast, CPU, no model | Blurs texture; obvious on photos |
| LaMa / IOPaint / MAT | `simple-lama-inpainting`, IOPaint, MAT | Good at small text, flat backgrounds, repeating texture | 512 px-ish receptive field; large display type over detailed art gets wiped |
| Scene-text removal | CTRNet, EraseNet, MTRNet++ | Designed for sign/text removal | Trained on scene text, not 200 px book typography; often low-res |
| Diffusion fill / outpainting | Stable Diffusion inpainting, Flux Fill, Qwen Image Edit, ControlNet | Can plausibly rebuild forest/wood/illustration under big type | GPU, slow, hallucination; needs prompt + review |
| Seam carving / art-aware crop | OpenCV/seam carving, saliency, manual crop | No hallucination; preserves real pixels | Only works if a text-free region exists; may lose the subject |
| Mirror/extend | Reflect the art horizontally/vertically | Cheap way to make a spine panel from a front cover | Can look obviously mirrored; repeated features |

### 5.2 LaMa test on the actual covers (CPU)

I downloaded `Carve/LaMa-ONNX` (`lama_fp32.onnx`, 208 MB), which has a **fixed 512×512** input and output, and ran it with `onnxruntime` on CPU. Masks came from RapidOCR text boxes plus a red-pixel threshold for the red typography.

**Full *Rock Paper Scissors* cover, tiled at 512 px**

- Text mask coverage after OCR + dilation: **51%** of the cover.
- Result: the art was effectively erased. The right-hand output was a pale, blurred snow field; the forest, chapel and contrast were gone. Not usable as a full cover.
- Reason: the title/author blocks cover a huge fraction of the image, and LaMa at 512 px cannot invent that much detailed forest. It fills with low-frequency snow.

**Small review quote on *Rock Paper Scissors* (512×512 crop)**

- Mask coverage: **24%**.
- Result: the quote was removed, snow/trees were blurred but plausible. At a 30 px spine width this would be invisible; at full size it would not pass as the original art.

**Bottom title on *The Whisper Man* (512×512 crop)**

- Mask coverage: **29.6%**.
- Result: most of the title was removed against the dark wood, but a white residue remained on the right because OCR missed part of the lettering. A manual mask or a second pass would fix it. The flat, dark background is the easy case.

**What this means**

- **Do not inpaint the whole cover** to get a textless flat with LaMa. It destroys the art.
- **Do inpaint small text** (quotes, badges, “A NOVEL”) or text on flat backgrounds; it is good enough, especially after downscaling to a 30 px spine.
- **For display type**, either crop around it, find the source art, or use a modern generative fill with a prompt and human review.
- The prototype’s 30 px spine changes the quality bar dramatically. A blurred 512 px inpaint that looks bad at 1600 px is often invisible at 30 px.

### 5.3 Commercial book-cover text removers

Several services specifically advertise book-cover text removal with diffusion inpainting:

- **RemoveTexts** — `https://removetexts.com/remove-text-from-book-cover` claims automatic detection of title, author, blurbs, publisher logo and spine text, with diffusion reconstruction. No public API documented; browser upload.
- **BeYourCover** — `https://beyourcover.com/` offers a “Text-free cover” action and an API from $49/mo. Its docs say the API creates new covers and can import your own cover for text removal. It explicitly says the API does **not** look up published covers.
- **BookCoverAI** — `https://bookcoverai.net/` advertises “remove baked-in lettering”.

I did not upload the copyrighted covers to these services, so their quality claims are **unverified**. They are a plausible paid fallback if a textless flat is needed at full resolution, but they are not a per-ISBN lookup and they may reject copyrighted covers.

### 5.4 A cheaper fallback that works at spine size

Because the target is a 27–30 px spine, the best reconstruction is often **not inpainting at all**:

1. Detect text boxes on the front cover (OCR or a text detector).
2. Build a column-wise “text coverage” score.
3. Choose the widest vertical strip (typically 15–30% of cover width) with little or no text.
4. Crop that strip, resize to the spine panel, and optionally mirror/extend it to fill the height.
5. Sample the cover’s dominant colour for the cloth/label band.

For *Rock Paper Scissors*, a left-edge strip avoids most of the title and keeps the snowy forest; the chapel sits low-left and may be partially retained. For *The Whisper Man*, a strip through the door/wood avoids the bottom title and keeps the warm dark palette. This preserves real pixels and has no hallucination risk. It is also fully automatable.

At full-cover resolution, the same crop is not a “textless cover”; it is a spine texture. That is exactly what the prototype needs.

---

## 6. Per-ISBN pipeline trace

### 6.1 *The Whisper Man* — Penguin UK, ISBN 9781405936019

| Asset | What a pipeline gets | How |
|---|---|---|
| Front cover | **1524×2339** current film tie-in | iTunes `term=9781405936019&country=gb` → rewrite `artworkUrl100` to `5000x5000bb` |
| Original front cover | **260×400** gold butterfly | Open Library `covers/.../b/id/14769008-L.jpg` |
| Current publisher jacket | 326×500 | `cdn.penguin.co.uk/.../9781405936019-jacket-large.jpg` |
| Google Books front | 800×1230 | volume `Ch5iDwAAQBAJ`, `zoom=4` |
| Amazon print cover | 325×500 | `P/1405936010.01.LZZZZZZZ.jpg` |
| AbeBooks | e-book ISBN → no exact match; print ISBN 9781405935999 → stock 326×500 | `SearchResults?isbn=9781405935999` |
| Back cover | none found | Google back cover is a placeholder |
| Spine photo | none found | — |
| High-res textless art | not publicly found | source credit: Hanka Steidle / Arcangel (UK); Will Staehle (US); film still for tie-in |
| Reverse search | 11 TinEye results, only an Alamy film poster | no textless match |

**Pipeline outcome:** front cover yes, at good resolution; original edition only at thumbnail size; textless art requires human source-tracing. The ISBN’s cover has changed over time, so record which edition the art represents.

### 6.2 *Rock Paper Scissors* — Flatiron US, ISBN 9781250266118

| Asset | What a pipeline gets | How |
|---|---|---|
| Front cover | **1613×2475** with red promo band | iTunes `term=9781250266118&country=us` → native size |
| Clean front | **987×1500** seller photo, no red band | AbeBooks inventory image `32329193375._SL1500_.jpg` |
| Designer mockup | 2499×2205 (cover ~1460 px tall) | Lisa Amoroso portfolio Squarespace URL |
| Open Library | 329×500 | cover id `10826952-L.jpg`; ISBN lookup missing |
| Google Books | 800×1215 | volume `VpsOEAAAQBAJ`, `zoom=4` |
| Amazon | master 1613×2475 by image id `91DBQWyg7FL`; 329×500 by print ISBN | `m.media-amazon.com/images/I/91DBQWyg7FL.jpg` |
| B&N | ~410×630 | product page |
| AbeBooks | print ISBN 9781250266101 works; stock 329×500; seller 987×1500 | `SearchResults?isbn=9781250266101` |
| Back cover | none found | — |
| Spine photo | none found (seller photo is front only) | — |
| High-res textless art | not publicly found | designer credit Lisa Amoroso; background is a stock-style snowy forest/chapel |
| Reverse search | 42 TinEye results, Amazon master, B&N, no stock/textless | art-only crop found similar 2013 snow-church news photos |

**Pipeline outcome:** front cover yes, but the highest-resolution file has a marketing band; the cleanest file is a marketplace seller photo. Textless art requires tracing the stock photo or generative removal.

---

## 7. What is automatable vs what needs a human

### Automatable per ISBN

1. Normalize/resolve the ISBN; determine e-book vs print and the print counterpart.
2. Query Apple Books by ISBN + region; rewrite artwork URL to native size; record actual dimensions.
3. Query Open Library for edition metadata and a fallback cover.
4. Query Google Books page for volume id and an 800 px fallback.
5. Try Amazon `P/{print ISBN10}` and, if an image id is known, the master CDN.
6. Fetch the publisher product page and its `og:image` / jacket CDN.
7. Download candidates, verify JPEG/PNG, dimensions, aspect ratio, and perceptual hash to detect duplicates.
8. Crop a text-free vertical strip for the spine; sample dominant colour; cache the result.
9. Record provenance: source URL, fetch time, ISBN, edition, licence note.

### Needs human/visual review

1. **Edition choice:** which cover is “the” cover for this book? E-book vs print vs tie-in vs export edition. The two sample ISBNs alone produce at least three *Whisper Man* covers and two *Rock Paper Scissors* fronts.
2. **Marketing overlays:** Netflix badges, “Sunday Times bestseller” strips, red promo bands. Decide whether to crop them, remove them, or accept them.
3. **Textless source hunting:** identify the designer/photographer/illustrator, find the stock or portfolio image, confirm it is the same art (not a lookalike), and clear rights.
4. **Reverse-search confirmation:** TinEye/Yandex results are candidates, not answers. Someone must open the stock page and compare.
5. **Inpaint approval:** check for ghost letters, melted texture, invented objects, and colour shifts, especially at full cover size.
6. **Spine-photo validation:** confirm a marketplace photo actually shows the spine, is the right edition, and is not a stock mockup.

### Suggested production policy for the prototype

- Default to **crop + dominant colour**, not inpainting.
- Only attempt text removal for small text or flat backgrounds; cap it at the spine resolution.
- Keep the front cover as the detail-view asset; the spine is a derived texture.
- Store a `cover_source` and `cover_edition` field so a later re-fetch does not silently swap a tie-in cover for the original.
- Fall back to the typographic spine (treatment A) when no cover or no usable strip exists.

---

## 8. Failure modes and things I could not verify

**Confirmed failure modes**

- **E-book ISBNs break print-oriented endpoints.** Amazon `P/` returns a 1×1 GIF; AbeBooks exact-ISBN search says “no exact matches”. Use the print ISBN for marketplace/CDN lookups.
- **Apple artwork changes with editions.** The current 9781405936019 image is a film tie-in; Open Library still has the original. Never assume the ISBN maps to a stable image.
- **Apple region locks results.** RPS is US/CA only; Whisper is GB/AU only in this test. A missing result may be a region issue, not a missing cover.
- **Open Library “XL” is a lie.** `-XL` returns a 43-byte 1×1 GIF when no master exists.
- **Google Books keyless API is effectively dead** (`429`, quota 0). Scraping works but is fragile and caps at 800 px.
- **Marketplace scraping is hostile.** eBay/ThriftBooks/Alibris/Biblio/Kobo/Waterstones/Bookshop/HathiTrust returned 403/406 to plain HTTP. AbeBooks only worked with a real browser.
- **Internet Archive is not ISBN-addressable for modern books.** ISBN queries returned 0; title queries returned spam. Page streams have no spine.
- **No public spine dataset has ISBNs.** ShelfAura’s own CSV has title/author only; crops are 321×38 px.
- **LaMa at 512 px is not a textless-cover tool.** It erased a 51%-masked cover; it handled a 24% small-text crop acceptably.
- **Google Lens is CAPTCHA-gated from this IP.** TinEye works headless; Yandex is noisy.
- **No textless-cover index exists.** Designer portfolios and press kits are title-by-title.

**Not verified**

- HathiTrust page-image access (Cloudflare 403).
- eBay Browse API image behaviour (no OAuth credentials).
- ThriftBooks/Biblio/Alibris/Kobo/Bookshop.org image APIs (blocked or undocumented).
- Macmillan’s cover CDN (403 for every pattern tried).
- Commercial text-removal quality (RemoveTexts, BeYourCover, BookCoverAI) — not uploaded due to copyright/ToS.
- Flux Fill / Qwen Image Edit quality on these covers — not run (no GPU; would need model downloads and human review).
- Whether the exact Arcangel/Plain Picture stock image for the UK *Whisper Man* or the snowy-chapel photo for *Rock Paper Scissors* is publicly purchasable at high resolution. The credits strongly suggest it, but the agency search was login/JS-gated.
- Full 3.08M-row ISCC dataset scan (only one 770k-row shard checked; targets absent from that shard).

---

## 9. Licensing / source notes

- **Apple Books / iTunes**: artwork is publisher-supplied, copyrighted. The Search API is public, but the artwork is not licensed for redistribution. Fine for local display/caching in a personal library; not for shipping a public art pack.
- **Open Library covers**: cover images are uploaded by users; Open Library does not grant rights to the cover art. Metadata is CC0-ish, images are not.
- **Amazon / B&N / publisher CDNs**: copyrighted; terms restrict scraping and reuse.
- **AbeBooks / eBay seller photos**: seller-owned; using them beyond personal reference is questionable.
- **Internet Archive**: item licences vary; modern in-copyright scans are lending-only. Public-domain scans are usable, but they do not give spine art.
- **ShelfAura**: CC BY 4.0 (Zenodo record). 4TU/IEEE/HF datasets have their own terms; check each. None grants rights to the underlying book cover art.
- **Designer portfolios / press kits**: copyrighted; “no text” does not mean “no rights”. A textless wrap is still the publisher’s/artist’s asset.
- **LaMa / IOPaint / Flux / Qwen**: model licences vary (Apache-2.0, GPL, non-commercial). Check before shipping a pipeline.

For PocketLibrary, the safe practical line is: fetch and cache covers for **local personal display**, derive spine textures locally, and do not redistribute the art.

---

## 10. Concrete recommendation for the spine prototype

1. **Do not chase real spine photos per ISBN.** The coverage is too low and the images are usually front covers. Use real spines only as an optional “collectible” enhancement when a marketplace listing happens to include one.
2. **Use Apple Books as the primary front-cover source**, with Open Library as the edition fallback and Google Books/Amazon/publisher as secondary. Resolve print vs e-book first.
3. **For the spine panel, crop a text-free vertical strip.** This is the highest-quality, zero-hallucination route and is fully automatable. Mirror/extend only if the strip is too narrow.
4. **Use LaMa-style inpainting only for small text** (quotes, badges) and only at spine resolution; do not use it to produce a full textless cover from display typography.
5. **Treat textless original art as a human research task.** Start from the designer/stock credit, use TinEye on an art-only crop, and confirm the source. Do not build a per-ISBN promise around it.
6. **Keep the typographic spine (treatment A) as the fallback** for coverless books, blocked sources, and editions where the art cannot be separated from the type.

If the product needs a true high-resolution textless flat for a detail view, the realistic options are: (a) license the stock/artist image, (b) commission/obtain a publisher wrap, or (c) pay for a diffusion-based text-removal service and review the result. There is no free, automatic, per-ISBN path today.
