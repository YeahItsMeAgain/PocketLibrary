# Popular-book spine sources — edition, artwork and rights research

**Date:** 2026-11-26  
**Scope:** source artwork for a PocketLibrary spine prototype covering *Harry Potter and the Philosopher's Stone*, *The Lord of the Rings*, *The Hobbit* and (optionally) *The Hunger Games*.  
**Status:** research only. No production code, prototype, test, spec or manifest was changed. All downloads went to `/tmp/opencode`. No image was uploaded to a paid service.

---

## 0. TL;DR — best edition and best source per book

| Book | Edition to prototype | Best textless / least-typed source | Best ordinary cover | Verdict |
|---|---|---|---|---|
| **Harry Potter and the Philosopher's Stone** | **1997 Bloomsbury UK first edition**, cover by **Thomas Taylor**, ISBN **978-0-7475-3269-9** | **Christie's photo of Taylor's 2001 replica, 2337×3200** — the full watercolour with no title typography | Bloomsbury Cloudinary jacket for the same ISBN, **1628×2409** (later reissue with a 15-years badge) | **Best source of the four for genuine textless art.** No generative removal needed. |
| **The Lord of the Rings** | **HarperCollins one-volume, Tolkien's black/red Ring design**, print ISBN **978-0-261-10325-2** (ebook **978-0-00-732259-6**) | **Tolkien's original Ring/Eye motif, 970×1214**, titleless (Tolkien Gateway scan of the 1954 design) | HarperCollins NZ / Apple Books, **1500×2301** | **Best high-res cover + clean title-to-remove.** 970 px art is the limiting factor. |
| **The Hobbit** | **1937 George Allen & Unwin first edition jacket by Tolkien**, facsimile ISBN **978-0-00-744083-2** | **Original dust-jacket production scan, 2240×1200**, continuous art across both panels; a 100–150 px slice is spine-width (lettering is drawn into the art) | HarperCollins facsimile jacket, **1117×1551** | **Best continuous jacket-art evidence.** Typography is integral, so crop spine-width art rather than generate. |
| **The Hunger Games** | **2008 Scholastic Press first edition**, art **Tim O'Brien**, design **Elizabeth B. Parisi & Phil Falco**, ISBN **978-0-439-02348-1** | **O'Brien's own textless pin painting, 1064×1063** (EXIF says master is 4505×4500) | Apple Books UK, **1524×2339** | **Best overall candidate for a text-removal pipeline.** Pin is isolated on black; title sits on flat black; a real full wrap with spine exists. |

**Practical ranking for “generative text removal” ease**

1. **The Hunger Games** — pure black field, title and byline in a clean bottom band, textless pin already published.
2. **The Lord of the Rings** — title sits on a flat dark disc; the central One Ring/Eye motif is already available titleless at 970×1214.
3. **Harry Potter** — removal is unnecessary if the Christie's watercolour is used; if a cover must be used, the 25th-anniversary cover has the title in a solid magenta block.
4. **The Hobbit** — the iconic 1937 jacket has lettering drawn into the artwork; generative removal would damage the design. Use a spine-width crop of the continuous art, or a modern cover with flat title bands.

---

## 1. What was actually tested

All HTTP tests run from this machine on 2026-11-26. Dimensions were read from the downloaded files with `file`/EXIF.

| Endpoint | Test | Result |
|---|---|---|
| Apple iTunes Search | `itunes.apple.com/search?term={isbn}&entity=ebook&country=gb` | **200**, but **0 results for every ISBN tested**. Title search works; ISBN search does not. |
| Apple artwork resize | `.../book.jpg/3000x3000bb.jpg` | Capped at the native asset: **1536×2008**, **1500×2312**, **1524×2339** etc. |
| Apple artwork huge | `.../100000x100000bb.jpg` | **JSON error**, no image. Native size is the ceiling. |
| Open Library edition | `openlibrary.org/isbn/{isbn}.json` | **200 after following 302**; gives edition metadata and page counts. |
| Open Library covers | `covers.openlibrary.org/b/isbn/{isbn}-L.jpg` | **200**, only **300–500 px**. `-XL` returns empty/1×1. |
| Google Books API | `googleapis.com/books/v1/volumes?q=isbn:...` | **429**, daily quota 0 (same as prior research). |
| Amazon image CDN | `images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg` | **200**, **275–621 px**; 1×1 GIF for e-book-only ISBNs. |
| **Bloomsbury Cloudinary** | `res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/{isbn}.jpg` | **200** and large: HP first-edition ISBN **1628×2409**, Jim Kay **4195×5000**, MinaLima **1486×2209**, 25th anniv. **1601×2480**. Best publisher source found. |
| **HarperCollins NZ CDN** | `i.harperapps.com/hcanz/covers/{isbn}/x1500.jpg` | **200**; `x1500` is the real ceiling (larger names return the same 1500 px). LOTR **1500×2301**, Hobbit **1117×1551**, Alan Lee Hobbit **1500×2436**. |
| AbeBooks search | `abebooks.com/servlet/SearchResults?isbn=...&pics=on` with a normal UA | **200**, server-rendered enough to extract `pictures.abebooks.com/inventory/...` IDs. Seller photos up to **1500 px** long edge. |
| AbeBooks seller images | `pictures.abebooks.com/inventory/{id}._SL1500_.jpg` | **200**, **1133×1500** for the HP first edition — and they show the **actual spine**. |
| Christie's lot page | `onlineonly.christies.com/.../239974` | **200**; `og:image` exposes a **2337×3200** JPEG of Taylor's replica. |
| Sotheby's lot page | `sothebys.com/.../thomas-taylor-artist-the-original-cover-art-for` | **200**; Brightspot CDN derivatives up to 4096×5411 were observed on this page, though the exact HP asset was not needed (Christie's replica is larger than the useful crop). |
| **Tolkien Gateway** direct files | `/w/images/...` with browser UA + referer | **200**; e.g. Hobbit dustcover **2240×1200 PNG**, FOTR jacket **1280×1600**, ROTK **1388×2000**, titleless Ring detail **970×1214**. Cloudflare blocks plain `curl` without headers. |
| Tim O'Brien portfolio | `obrienillustration.com/hunger-games/` | **200**; hero image `HungerGames.jpg` is the **textless mockingjay painting**, 1064×1063, EXIF master 4505×4500. |
| Phil Falco portfolio | `philfalco.com/hunger-games` | **200**; Squarespace CDN serves a **2500×1049 full jacket wrap** and a 661×999 front cover. |
| TinEye (keyless) | URL search, plain `curl` | **200 but only a JS shell** (4.4 KB, “enable JavaScript”). |
| TinEye (headless Chromium) | Playwright, URL search | **403 Cloudflare** — “automated high-volume searching” block. Interactive browser only. |
| Google Lens | `lens.google.com/uploadbyurl?url=...` | **302 → google.com/search** with a `vsrid`; result page is JS-only, 127 chars of text. CAPTCHA risk remains. |
| Yandex Images | `yandex.com/images/search?rpt=imageview&url=...` | **200**, 639 KB, real results — but for the Hunger Games pin it matched the *Mockingjay* film poster, i.e. noisy. |

---

## 2. Harry Potter and the Philosopher's Stone

### 2.1 Edition identity

| Field | Value |
|---|---|
| First publication | **26 June 1997**, Bloomsbury, London |
| First edition | hardback, **223 pp**, initial print run **500** (300 to libraries) |
| ISBN | **0-7475-3269-9 / 978-0-7475-3269-9** |
| Cover illustration | **Thomas Taylor** (aged 23; watercolour and pencil) |
| Cover design / publisher | Bloomsbury Children's Books |
| First paperback | ISBN **0-7475-3274-5 / 978-0-7475-3274-3**, same Taylor art |
| US first edition | Scholastic, 1998, *Sorcerer's Stone*, jacket art **Mary GrandPré**, ISBN **0-590-35340-3 / 978-0-590-35340-3** |
| Other iconic editions | Jonny Duddle children's covers (2014, e.g. **978-1-4088-5565-2**); MinaLima illustrated (2020, **978-1-5266-2658-5**); Jim Kay illustrated (2015, **978-1-4088-4564-6**); 25th anniversary (2022, **978-1-5266-4665-1**) |

The original 1997 painting was sold at Sotheby's New York on **26 June 2024 for $1.92 m**. Christie's later offered Taylor's authorised **2001 replica** (47.8 × 34.2 cm), which is the image used below.

### 2.2 Highest-resolution images found

| Asset | Dimensions | URL | Notes |
|---|---|---|---|
| **Taylor replica, textless** | **2337×3200** (300 dpi) | `https://www.christies.com/img/LotImages/2024/CKS/2024_CKS_23204_0027_000(harry_potter_and_the_philosophers_stone_original_artwork_thomas_taylor073923).jpg?mode=max` | Full watercolour; no title type. Contains diegetic “HOGWARTS EXPRESS” and “9¾” lettering as painted. |
| Sotheby's original lot page | page **200**; CDN derivatives up to ~2048 px per asset | `https://www.sothebys.com/en/buy/auction/2024/the-library-of-dr-rodney-p-swantko/thomas-taylor-artist-the-original-cover-art-for` | Lot page is authoritative for provenance; the exact HP asset was not enumerated here because the Christie's replica already exceeds it. |
| Bloomsbury jacket, first-edition ISBN | **1628×2409** | `https://res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/9780747532699.jpg` | Same Taylor art, but a later reissue state with a **“15 years” badge** and bottom award band. |
| 25th-anniversary jacket | **1601×2480** | `https://res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/9781526646651.jpg` | Clean Taylor art with a silver 25th badge bottom-left; title in a solid magenta block. |
| Jim Kay illustrated | **4195×5000** (600 dpi) | `https://res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/9781408845646.jpg` | Highest-resolution HP cover found, but a completely different interpretation. |
| MinaLima edition | **1486×2209** | `https://res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/9781526626585.jpg` | Decorative, different art. |
| Amazon first-edition still | 420×621 | `https://images-na.ssl-images-amazon.com/images/P/0747532699.01.LZZZZZZZ.jpg` | Small, but a clean first-state image. |
| AbeBooks seller photo with spine | **1133×1500** | `https://pictures.abebooks.com/inventory/31484502458._SL1500_.jpg` | Shows the real 1997 spine: maroon top (“HARRY POTTER”), blue lower panel (“and the Philosopher's Stone / J.K. ROWLING”), cream foot (“BLOOMSBURY”). |
| AbeBooks, second spine photo | **1124×1500** | `https://pictures.abebooks.com/inventory/31896271985._SL1500_.jpg` | Same binding, cleaner light. |

### 2.3 Does genuine textless art exist?

**Yes — uniquely well for this set.** Thomas Taylor's original is a painting with no title lettering; Bloomsbury added the type separately. The Christie's replica is a faithful, high-resolution, publicly photographed copy of that painting. The only lettering in the image is painted into the scene (the train’s “HOGWARTS EXPRESS” plate and the “9¾” sign), so it reads as illustration rather than cover typography.

### 2.4 Spine / full wrap

There is **no public full-wrap mechanical**. The original art is a front-cover painting only. The real 1997 spine is known from seller photographs (above), and is a three-band design: maroon / blue / cream with vertical type. That is enough to reconstruct a spine without generating anything.

### 2.5 Recommendation

- **Use the Christie's 2337×3200 watercolour as the spine art source.** It is the highest-quality genuine untyped asset in this entire study.
- **Do not run generative text removal on it.**
- If a typed cover is required for comparison, use the 25th-anniversary 1601×2480 jacket (title in a flat magenta field, easy mask) or the 1628×2409 reissue.
- For the spine itself, the AbeBooks 1500 px photos are the best evidence of the real 1997 spine palette and type placement.

---

## 3. The Lord of the Rings

### 3.1 Edition identity

| Field | Value |
|---|---|
| First publication | **29 July 1954** (*Fellowship*), **11 November 1954** (*Two Towers*), **20 October 1955** (*Return of the King*), George Allen & Unwin |
| First-edition jackets | designed and drawn by **J.R.R. Tolkien** himself |
| One-volume edition | first one-volume edition **1968**; the familiar black/red one-volume is the HarperCollins reset |
| Print ISBN used here | **0-261-10325-3 / 978-0-261-10325-2** (HarperCollins one-volume paperback, 2004 printing, **1031 pp**) |
| E-book ISBN | **978-0-00-732259-6** |
| Cover art | Tolkien's **One Ring + Eye of Sauron + Tengwar ring inscription** motif, from his 1954 dust-jacket design |
| Other editions | 50th-anniversary hardback **978-0-00-718236-7**; 2021 “illustrated by the author” **978-0-00-850131-0**; Alan Lee illustrated 3-volume boxed set **978-0-261-10238-5** |

### 3.2 Highest-resolution images found

| Asset | Dimensions | URL | Notes |
|---|---|---|---|
| One-volume black cover (ebook) | **1500×2301** | `https://i.harperapps.com/hcanz/covers/9780007322596/x1500.jpg` | Same master as Apple Books; HarperCollins CDN. |
| Same via Apple Books | **1500×2301** | `https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/61/6e/db/616edbef-4a2f-60d0-76f5-1e61363aa536/9780007322596.jpg/1500x2301bb.jpg` | Native cap confirmed. |
| **Titleless Ring/Eye motif** | **970×1214** | `https://tolkiengateway.net/w/images/a/a9/J.R.R._Tolkien_-_The_Lord_of_the_Rings_cover_(detail).jpg` | Genuine Tolkien design, **no title type**, only Tengwar. Best textless LOTR asset. |
| Tolkien's FOTR jacket design | **1280×1600** | `https://tolkiengateway.net/w/images/f/fe/J.R.R._Tolkien_-_The_Fellowship_of_the_Ring_2.jpg` | Hand-lettered title is part of the art. |
| Tolkien's ROTK jacket design | **1388×2000** | `https://tolkiengateway.net/w/images/0/04/J.R.R._Tolkien_-_The_Return_of_the_King.jpg` | Black paper, silver/gold; lettering integrated. |
| Two Towers jacket sketch | 1280×920 | `https://tolkiengateway.net/w/images/8/85/J.R.R._Tolkien_-_Dust-jacket_design_for_The_Two_Towers.jpg` | Pencil sketch, not final colour. |
| 2021 author-illustrated cover | **1500×2312** | `https://i.harperapps.com/hcanz/covers/9780008501310/x1500.jpg` | Clean grey field; title at top is trivial to mask. |
| 50th-anniversary product shot | 1500×1913 | `https://i.harperapps.com/hcanz/covers/9780007182367/x1500.jpg` | Red slipcase photograph, not a flat cover. |

### 3.3 Does genuine textless art exist?

**Yes, but at modest resolution.** The 1954 design detail (970×1214) is the One Ring with the Eye and the red Tengwar inscription on a cream ground — no title, no publisher marks. It is a faithful scan of Tolkien's own motif and matches the central device of the black one-volume cover.

The full 1954 jacket designs exist as high-resolution scans (1280×1600 etc.), but the title lettering is **drawn by Tolkien into the artwork**, so they cannot be “text-removed” without destroying the design.

### 3.4 Spine / full wrap

No publisher full-wrap mechanical surfaced. Tolkien's original jacket designs are effectively front-cover artworks with hand-lettered titles; the printed spines were separate type. For a prototype, either:

- crop the 970×1214 motif and set the title yourself, or
- use the 1500×2301 black cover and mask the white title on the flat dark disc (very low-risk inpaint).

### 3.5 Recommendation

- **Primary: HarperCollins one-volume black cover (978-0-261-10325-2 / e-book 978-0-00-732259-6), 1500×2301.** This is the most recognisable modern LOTR object and has a near-ideal flat title field.
- **Textless: 970×1214 Tolkien Ring/Eye detail.** Good enough for a 40–55 px spine at 2×; not enough for a full-bleed cover.
- Alternative if resolution matters more than iconography: 2021 author-illustrated cover, **1500×2312**, with the title removed from the grey sky.

---

## 4. The Hobbit

### 4.1 Edition identity

| Field | Value |
|---|---|
| First publication | **21 September 1937**, George Allen & Unwin |
| First edition | **310 pp**, print run **1,500**; 10 black-and-white illustrations, maps, binding and dust jacket by **J.R.R. Tolkien** |
| Facsimile edition | HarperCollins, **2016**, **312 pp**, ISBN **978-0-00-744083-2 / 0-00-744083-9** |
| Jacket | Tolkien's original 1937 design: green runic border, blue/green mountains, dragon, moon, eagles, “THE HOBBIT” hand-lettered |
| Other editions | Alan Lee illustrated **978-0-261-10221-7**; 2012 e-book **978-0-00-732260-2**; 2021/2012 black “Tolkien” branded cover |

### 4.2 Highest-resolution images found

| Asset | Dimensions | URL | Notes |
|---|---|---|---|
| **Original dust-jacket production scan** | **2240×1200 PNG (5.47 MB)** | `https://tolkiengateway.net/w/images/c/c2/J.R.R._Tolkien_-_The_Hobbit_Dustcover.png` | Annotated production artwork with two cover panels and fold marks, plus Tolkien's pencil notes and colour instructions. The mountain/forest scene is continuous, so a 100–150 px vertical slice gives spine-width art. It is not a clean typeset spine. |
| Facsimile jacket | **1117×1551** | `https://i.harperapps.com/hcanz/covers/9780007440832/x1500.jpg` | Clean printed 1937 jacket, HarperCollins asset. |
| Alan Lee edition cover | **1500×2436** | `https://i.harperapps.com/hcanz/covers/9780261102217/x1500.jpg` | Modern black mountain/red-sun cover, not Lee's painting. |
| 2012 e-book cover | **1500×2308** | `https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/dc/b9/16/dcb91663-fb27-71ce-e49e-c842e10406ad/9780007322602.jpg/1500x2308bb.jpg` | Grey variant; title over flat dark bands. |
| Amazon facsimile still | 360×500 | `https://images-na.ssl-images-amazon.com/images/P/0007440839.01.LZZZZZZZ.jpg` | Small. |

### 4.3 Does genuine textless art exist?

**Not as a clean flat.** Tolkien's 1937 jacket is a single integrated design: the title, author, publisher and runic border are all part of the artwork. The 2240×1200 production scan is the closest thing to an original mechanical, but it is an annotated drawing, not a textless painting.

Tolkien's interior paintings (Smaug, Lake Town, Rivendell, etc.) are genuinely textless and available at 1,000–2,400 px, but they are **not the cover** and would change the book's identity.

### 4.4 Spine / full wrap

**Yes, as continuous jacket art — not as a ready typeset spine.** The 2240×1200 scan is an annotated production artwork with fold marks and two cover panels. Because the mountain/forest scene runs continuously across the jacket, a 100–150 px vertical slice gives legitimate spine-width art at 1200 px tall — enough for a 40–55 px spine at 2×, not for print. It does not expose a pre-typeset spine panel.

### 4.5 Recommendation

- **For fidelity: use the 2240×1200 dust-jacket scan and crop a spine-width vertical slice of the continuous mountain/forest art. Do not regenerate.** The printed spine also carried vertical title type, which the scan does not isolate.
- **For a clean flat: use the modern HarperCollins cover at 1500×2308**, where the title sits over flat dark bands and is easy to mask. Accept that this is a different, less iconic edition.
- Avoid generative removal on the 1937 jacket: the lettering is hand-drawn and interlocked with the mountain silhouette.

---

## 5. The Hunger Games

### 5.1 Edition identity

| Field | Value |
|---|---|
| First publication | **14 September 2008**, Scholastic Press, New York |
| First edition | hardback, **374 pp**, ISBN **978-0-439-02348-1 / 0-439-02348-3** |
| Paperback | ISBN **978-0-439-02352-8** |
| UK edition | Scholastic UK, ISBN **978-1-4071-3317-1** |
| Jacket illustration | **Tim O'Brien** — the gold mockingjay pin |
| Jacket design | **Elizabeth B. Parisi** and **Phil Falco** |
| Type | white title and gold author name on black; red tagline on the back |

### 5.2 Highest-resolution images found

| Asset | Dimensions | URL | Notes |
|---|---|---|---|
| **Textless pin painting** | **1064×1063** | `https://obrienillustration.com/wp-content/uploads/HungerGames.jpg` | Genuine artist asset, no type. EXIF records a **4505×4500** master. |
| **Full jacket wrap (with spine)** | **2500×1049** | `https://images.squarespace-cdn.com/content/v1/57070eabcf80a142cf5c36a5/1461115814384-9Z97JA0WBEULG0H843I1/image-asset.jpeg?format=2500w` | Back, spine, front and flaps. Spine at roughly **46.4–52.0%** of the width (`x ≈ 1160–1300`). Shows the real spine: black field, red “COLLINS”, gold arrow, white vertical title, red “SCHOLASTIC PRESS”. |
| Front cover from designer | 661×999 | `https://images.squarespace-cdn.com/content/v1/57070eabcf80a142cf5c36a5/1461115841976-9ANOOO3E5472BHURRHWV/image-asset.jpeg?format=2500w` | Designer's front-only export. |
| Apple Books UK cover | **1524×2339** | `https://is1-ssl.mzstatic.com/image/thumb/Publication4/v4/f3/ae/c5/f3aec527-c91c-db2e-7758-9cdda262f661/9781407133171.jpg/1524x2339bb.jpg` | Clean official flat, title bottom. |
| Amazon first-edition still | 330×500 | `https://images-na.ssl-images-amazon.com/images/P/0439023483.01.LZZZZZZZ.jpg` | Small. |

### 5.3 Does genuine textless art exist?

**Yes — the best case in the set.** Tim O'Brien publishes the isolated mockingjay pin on his own portfolio, at 1064×1063. The image is pure black around the pin, so it composites directly onto any black spine. The artist's EXIF shows the original is 4505×4500, so a higher-resolution copy is likely obtainable by asking him (or Scholastic) rather than upscaling.

### 5.4 Spine / full wrap

**Yes — a genuine full jacket wrap exists on the designer's portfolio.** The 2500×1049 wrap includes the spine, and the spine is a real designed object, not a guess: black, with a gold arrow running vertically, white stacked title, red publisher marks. This is the only book in the set with a public, high-quality, designer-sourced spine.

### 5.5 Recommendation

- **Primary: 2008 Scholastic edition, textless pin 1064×1063 + real spine crop from the 2500×1049 wrap.**
- No generative removal needed. If the title must be removed from the flat cover, it sits on pure black at the bottom and masks cleanly.
- The 1524×2339 Apple cover is the best official flat for comparison.

---

## 6. Cross-book comparison

| Criterion | HP | LOTR | Hobbit | Hunger Games |
|---|---|---|---|---|
| Genuine textless art publicly available | **Yes, 2337×3200** | Yes, 970×1214 | No clean flat (integrated design) | **Yes, 1064×1063** (master 4505×4500) |
| Highest-res official cover | 4195×5000 (Jim Kay) / 1628×2409 (Taylor reissue) | 1500×2301 | 1117×1551 (facsimile) / 2240×1200 (jacket art) | 1524×2339 |
| Real spine photo / artwork | Seller photo 1133×1500 | No public photo found; type-only spine | Continuous jacket art 2240×1200 | **Full wrap 2500×1049 (real spine)** |
| Title overlap on art | None (untyped original) | Low (flat dark disc) | **High** (hand-lettered into art) | None (textless pin) |
| Best generative-removal candidate | Not needed | Good | Poor | **Best** |
| Main risk | Auction photo rights; replica not the 1997 original | 970 px textless art is small | Destroying the 1937 lettering | Only 1064 px served publicly |

---

## 7. Reverse image search — what works in 2026

| Service | Keyless? | Test result | Useful for |
|---|---|---|---|
| **TinEye** | Yes | Plain URL request returns a **JS-only shell**; headless Chromium gets **403 Cloudflare** (“automated high-volume searching”). Must be used interactively in a real browser. | Finding higher-resolution copies of auction/portfolio images, and tracking an untyped painting back to the artist. |
| **Google Lens** | Yes | `uploadbyurl` **302s** to a `google.com/search?vsrid=...` page that is JS-only; frequent CAPTCHA. | Best general “where else does this image appear” results when it does load. |
| **Yandex Images** | Yes | **200**, full results page; matched the Hunger Games pin to a *Mockingjay* film poster. | Noise-tolerant matching for objects/logos; good for finding Russian/European reposts. |
| Bing Visual Search | Needs API key for `searchbyimage`; public upload endpoint returned **404** | Not usable keyless. | — |
| SauceNAO | Yes | Indexed to anime/art, not book covers | Not applicable. |

**Practical workflow:** reverse-search the **untyped art**, not the finished cover. For HP, search the Christie's painting; for HG, search `HungerGames.jpg`; for Tolkien, search the 970×1214 detail. Finished covers return thousands of retailer thumbnails and bury the original.

---

## 8. Legal / rights note

- **All four are in copyright.** Cover art is owned by the publisher/artist, not by the ISBN record.
  - HP: art © **Thomas Taylor**; cover design © **Bloomsbury**. Auction photographs © Christie's/Sotheby's. The 2001 replica is a unique work; the photo is not a licence to reproduce the painting.
  - LOTR / Hobbit: Tolkien's artwork © **The Tolkien Estate**; editions © **HarperCollins**. Tolkien Gateway files are hosted under **fair use** and are not publisher assets.
  - Hunger Games: illustration © **Tim O'Brien**; jacket design © **Scholastic** / the designers. The portfolio image is published for portfolio viewing, not redistribution.
- **For this prototype:** use the assets locally as design references only; do not ship them in the app, bundle them in `public/`, or commit them. The existing scratch README already states this; keep it that way.
- **Do not** upload these images to paid generative services. If a removal experiment is needed, use a local model on a cropped, low-resolution derivative and keep the output in `/tmp`.
- Any future production feature should either (a) render from the user's own EPUB cover, or (b) use a licensed/CC0 art source, not scraped publisher jackets.

---

## 9. Reusable URL patterns

```text
# Bloomsbury (Harry Potter) — largest single source found
https://res.cloudinary.com/bloomsbury-atlas/image/upload/jackets/{ISBN}.jpg
# optional transforms: /w_1200,c_scale/ before jackets/

# HarperCollins NZ / Apple-adjacent (LOTR, Hobbit)
https://i.harperapps.com/hcanz/covers/{ISBN}/x1500.jpg

# Apple Books artwork — replace 100x100bb with the native size
https://is1-ssl.mzstatic.com/image/thumb/{PATH}/{FILENAME}.jpg/{W}x{H}bb.jpg

# Amazon print cover
https://images-na.ssl-images-amazon.com/images/P/{ISBN10}.01.LZZZZZZZ.jpg

# AbeBooks seller photos (may show the spine)
https://pictures.abebooks.com/inventory/{INVENTORY_ID}._SL1500_.jpg

# Open Library (small only)
https://covers.openlibrary.org/b/isbn/{ISBN}-L.jpg
```

---

## 10. Bottom line

- **There is no single public “textless cover” API.** The best results come from three specific places: an auction-house photograph (HP), an artist's own portfolio (Hunger Games), and a fan-maintained Tolkien archive (LOTR/Hobbit).
- **Hunger Games is the ideal prototype book**: genuine textless art, a real designer wrap with spine, and a title that sits on pure black.
- **Harry Potter is the best “genuine original art” story**: the 2337×3200 Christie's watercolour is the highest-quality untyped asset found, and it needs no generation at all.
- **LOTR is the best compromise** between iconic cover, high resolution and easy title removal.
- **The Hobbit is the hard case**: its most iconic jacket is a single integrated design, so the honest approach is to use a spine-width slice of the continuous art from the 2240×1200 scan rather than invent one.
