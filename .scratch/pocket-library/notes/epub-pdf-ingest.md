# EPUB/PDF ingest research (ticket 04)

**Question:** what is the best Rust-side ingest design for PocketLibrary (Tauri v2 on Android, SAF library folder, ~2,000 files, Rust 1.99)?

**Status labels**

- **[V]** verified against a primary source on 2026-11-24 (crates.io API, crate source, spec, first-party docs).
- **[I]** inference or estimate from verified facts; not built/benchmarked on the target device.
- All crate versions below were read from the crates.io API on 2026-11-24.

**Environment assumption:** Tauri 2.12.7, `tauri-plugin-android-fs` 30.2.0, `aarch64-linux-android`, SQLite in the Rust backend (per ticket 09). Every crate recommended here compiles on Rust 1.99; the highest MSRV required is hayro's 1.92. **[V]**

---

## TL;DR

| Job | Decision | Why |
|---|---|---|
| EPUB parse | **`rbook` 0.7.13** (Apache-2.0) | EPUB 2 + 3, typed metadata, cover, TOC, spine, lazy resources, `Read + Seek`, no C deps. |
| EPUB fallback / repair | **`zip` 9.8.2** + **`quick-xml` 0.42.0** | Read `container.xml`/OPF directly when `rbook` refuses a malformed file. |
| PDF metadata + page count | **`lopdf` 0.47.0** | `Reader::load_metadata_*` returns title/author/subject/keywords/dates, `page_count`, `version`, `encrypted` **without loading the whole document**. |
| PDF cover render | **`hayro` 0.9.0** (Apache-2.0 OR MIT) | Pure Rust, `#![forbid(unsafe_code)]`, no NDK/native lib, best-documented pure-Rust rasterizer (1,500+ regression PDFs). |
| PDF alternative | `pdfium-render` 0.9.6 | Highest render quality, but requires shipping `libpdfium.so` per ABI and manual `dlopen` plumbing **on Android**. Keep as plan B. |
| Do **not** use | `mupdf` (AGPL-3.0), `epub` (GPL-3.0-or-later) | Copyleft is a distribution problem for a closed-source app. |
| SAF I/O | `tauri-plugin-android-fs` **30.2.0** | `open_file_readable()` returns a real `std::fs::File` built from the provider's fd (`Read + Seek`, no copy); `protocol_content` serves Range requests for the reader. |
| Book identity | **BLAKE3-256 of the full file**, plus a head/tail "quick key" for rescans | Hash survives rename/move/tree-URI re-grant; path and SAF document ID do not. |
| Enrichment | **Open Library only** (`search.json?isbn=`), background queue, 1 req/s | Free, keyless, documented rate limit; Google Books officially requires an API key. |
| Covers | Disk, content-addressed under `app_data_dir()/covers/`, JPEG q80 600×900 | Keeps SQLite small, serves straight to WebView, survives cache eviction. |

---

## 1. EPUB parsing

### 1.1 Crate comparison

| Crate | Version / date | License | EPUB 3 | Metadata API | Cover | TOC | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|---|
| **`rbook`** | **0.7.13**, 2026-11-13 | **Apache-2.0** | Yes | Typed (`title()`, `creators()`, `publishers()`, `languages()`, `description()`, `published()`, `identifiers()`) | `manifest().cover_image()` (EPUB 2 `<meta name="cover">` + EPUB 3 `cover-image`) | EPUB 3 nav **and** EPUB 2 NCX | 3 releases in the last 6 weeks | **Use** |
| `epub` (danigm) | 2.1.6, 2026-11-01 | **GPL-3.0-or-later** | Yes | `HashMap<String, Metadata>` | `get_cover()` | nav/NCX | Active | Reject on license |
| `epub-parser` | 0.3.4, 2026-02-07 | MIT | **No** (NCX only) | Plain struct, no series | "first image whose id contains `cover`" | NCX only | New, single maintainer, 0.3.x | Reject: fragile |

Sources: [`rbook` crate](https://crates.io/crates/rbook), [`rbook` README](https://github.com/DevinSterling/rbook/blob/main/README.md), [`rbook` Cargo.toml](https://github.com/DevinSterling/rbook/blob/main/Cargo.toml), [`epub` Cargo.toml](https://github.com/danigm/epub-rs/blob/master/Cargo.toml), [`epub-parser` source](https://github.com/zhangwfjh/epub-parser/blob/main/src/epub.rs). **[V]**

Why `rbook` wins beyond licensing:

- It parses from **any `Read + Seek`**, not just a path: `Epub::read(reader)` — decisive for SAF fds. **[V]** ([`src/epub.rs`](https://github.com/DevinSterling/rbook/blob/main/src/epub.rs))
- `Epub::options()` exposes `strict(bool)`, `skip_toc(bool)`, `skip_manifest(bool)`, `skip_spine(bool)`, `preferred_toc(...)`. **`strict` defaults to `false`**, which is the right posture for a real-world library. **[V]** (same file)
- Resources are **lazy**: `read_bytes()`/`copy_bytes()` pull one ZIP entry at a time; opening the book does not decompress the whole archive. **[V]** ([manifest trait](https://github.com/DevinSterling/rbook/blob/main/src/ebook/manifest.rs))
- EPUB 2 `<meta name="calibre:series">` is normalized into the metadata entry's `property`, so `metadata().by_property("calibre:series")` works alongside EPUB 3's `belongs-to-collection`. **[V]** ([`parse_meta2`](https://github.com/DevinSterling/rbook/blob/main/src/epub/parser/package/metadata.rs))
- `Epub` is `Send + Sync` by default (`threadsafe` feature), so it can be moved into a worker thread. **[V]** (README)

### 1.2 Metadata extraction matrix

| Field | EPUB 3 source | EPUB 2 source | `rbook` access |
|---|---|---|---|
| Title | `dc:title` (with `title-type=main`) | `dc:title` | `metadata().title()` / `titles()` |
| Authors | `dc:creator` (+ `refines` role) | `dc:creator` | `metadata().creators()` (role via `main_role()`) |
| Series | `belongs-to-collection` + `collection-type=series` + `group-position` | `calibre:series`, `calibre:series_index` | `by_property(...)` + entry refinements |
| Language | `dc:language` (BCP 47) | same | `metadata().languages()` |
| Description | `dc:description` (may be HTML) | same | `metadata().description()` |
| Publisher | `dc:publisher` | same | `metadata().publishers()` |
| Date | `dc:date` | same | `metadata().published()` |
| Identifier | `dc:identifier` (+ `identifier-type`) | `dc:identifier` (+ `opf:scheme`) | `metadata().identifiers()` |
| Cover | manifest item with `properties="cover-image"` | `<meta name="cover" content="id">` | `manifest().cover_image()` |
| TOC | nav document (`properties="nav"`) | NCX (`spine@toc`) | `epub.toc()` |
| Spine / resources | `<spine>` itemrefs / `<manifest>` items | same | `epub.spine().len()`, `epub.manifest().len()` |

EPUB 3.3 definitions: [`belongs-to-collection`](https://www.w3.org/TR/epub-33/#sec-belongs-to-collection), [`cover-image`](https://www.w3.org/TR/epub-33/#sec-cover-image). **[V]**

`belongs-to-collection` may appear multiple times and is refined with `collection-type` and `group-position`; that is the correct place to read series name and series index. **[V]** (spec)

### 1.3 EPUB 2 vs EPUB 3

Detect from the OPF `package@version`, then apply these differences:

1. **Cover.** EPUB 3: manifest `properties` token `cover-image` (zero or one, per spec). EPUB 2: `meta name="cover"` points at a manifest item id (a convention, not spec). `rbook` implements both and its own tests assert the EPUB 2 and EPUB 3 behaviour. **[V]**
2. **TOC.** EPUB 3 nav document is XHTML; EPUB 2 is NCX XML. Ask `rbook` for both with `preferred_toc(EpubVersion::EPUB3)`, and keep NCX as fallback. **[V]**
3. **Series.** EPUB 3 uses collection metadata; EPUB 2 (and most Calibre-produced files) use `calibre:series` / `calibre:series_index`. Read both; prefer EPUB 3. **[V]**
4. **Modified date.** EPUB 3 requires `dcterms:modified`; do not confuse it with `dc:date` (publication). Store both if available; display `dc:date`. **[V]** (spec)
5. **Page count.** EPUB has **no fixed pages**; fixed layout is a rendition property, and reflowable books paginate at render time. Store `spine_items` (chapters) and `resource_count`; let epub.js generate locations when the book is first opened. Do **not** try to store a page count. **[V]** (EPUB is a reflowable package format) / **[I]** (implementation choice)

### 1.4 Malformed EPUBs and missing metadata

`rbook` with `strict(false)` covers most real-world damage, but plan an explicit ladder:

1. **Try `rbook` with `skip_toc(true)`** first (fast path; TOC is not needed at ingest). If it succeeds, take metadata + manifest + spine.
2. **Missing/invalid `META-INF/container.xml`** → open with `zip`, scan entries for `*.opf`, pick the shortest match (or the one under `OEBPS/`), parse it with `quick-xml`. This is also the escape hatch for OPF files with unescaped `&` or stray control characters.
3. **Multiple `rootfile` renditions** → take the first `media-type="application/oebps-package+xml"`; if titles differ, keep them as alternate titles rather than failing.
4. **Missing title** → filename fallback; **missing author** → `NULL` (UI shows "Unknown"), never the literal string "Unknown" in the DB.
5. **Encrypted/DRM** → inspect `META-INF/encryption.xml`: font obfuscation is normal and harmless; if XHTML/content entries are encrypted, or `META-INF/rights.xml` exists, mark the book `locked` and do not hand it to the reader.
6. **ZIP safety** → never extract to disk. Resolve cover/nav hrefs inside the archive only, reject absolute paths and `..`, and cap decompressed entry size (e.g. 64 MB for the cover, 512 MB total) to defuse zip bombs.
7. **Scripted content** → EPUBs may carry JavaScript; epub.js must run with scripted content disabled/sandboxed. Treat all XHTML as untrusted. **[I]**

`sanitize` any `dc:description` HTML before it reaches the WebView (e.g. `ammonia` 4.2.5), or store it as plain text. **[I]**

---

## 2. PDF parsing

### 2.1 Crate comparison

| Crate | Version | License | Metadata | Page count | Rasterize | Android cost | Verdict |
|---|---|---|---|---|---|---|---|
| **`lopdf`** | **0.47.0** | MIT | Info dict only (no XMP) | **Yes** (`PdfMetadata.page_count`) | No | Pure Rust | **Use for metadata** |
| **`hayro`** | **0.9.0** | Apache-2.0 OR MIT | Info dict only | Yes (`pdf.pages().len()`) | **Yes**, pure Rust | Pure Rust, no NDK lib | **Use for covers** |
| `pdfium-render` | 0.9.6 | MIT/Apache-2.0 wrapper; PDFium is BSD-3 | Info dict | Yes | Yes (reference quality) | Ship `libpdfium.so` (~4 MB compressed / ~11 MB per ABI) + runtime `dlopen` | Plan B |
| `mupdf` | 0.8.0 | **AGPL-3.0** | Yes | Yes | Yes | Builds C/C++ with NDK | Reject (license + build) |
| `pdf-extract` | 0.12.1 | MIT | No | No | No | Pure Rust | Not needed |
| `oxidize-pdf` / `pdfrs` | 5.6.1 / 0.2.1 | MIT-ish | Yes | Yes | Claimed | Pure Rust | Too young/unproven |

Sources: [`lopdf` 0.47.0](https://crates.io/crates/lopdf), [`hayro` 0.9.0](https://crates.io/crates/hayro), [`pdfium-render` README](https://github.com/ajrcarey/pdfium-render/blob/master/README.md), [`mupdf` README](https://github.com/messense/mupdf-rs/blob/main/README.md). **[V]**

### 2.2 Recommended split: `lopdf` for facts, `hayro` for pixels

`lopdf` 0.47 added a metadata-only loader specifically for this use case. `PdfMetadata` contains `title`, `author`, `subject`, `keywords`, `creator`, `producer`, `creation_date`, `modification_date`, `page_count`, `version`, an `encrypted` flag, and raw custom Info entries. The docs describe it as "extracted without loading the entire document", and `load_metadata_from<R: Read>` needs only `Read` (not `Seek`). **[V]** ([`src/reader.rs`](https://github.com/J-F-Liu/lopdf/blob/master/src/reader.rs))

```rust
let meta = lopdf::Reader::load_metadata_mem(&bytes)?; // or load_metadata_from(file)
let pages = meta.page_count;
```

`hayro` renders a page from a `Pdf` built over any `Arc<T: AsRef<[u8]>>`:

```rust
let pdf = hayro::hayro_syntax::Pdf::new(Arc::clone(&mmap))?;
let page = &pdf.pages()[0];                 // Pages derefs to [Page]
let (w, h) = page.render_dimensions();      // points
let scale = 600.0 / w;                      // target cover width
let pixmap = hayro::render(
    page, &cache, &InterpreterSettings::default(),
    &RenderSettings::default(),
    &PixmapSettings { x_scale: scale, y_scale: scale, bg_color: WHITE },
);
let png = pixmap.into_png()?;               // then decode/resize/encode
```

**[V]** for the APIs ([`hayro/src/lib.rs`](https://github.com/LaurenzV/hayro/blob/main/hayro/src/lib.rs), [`hayro-syntax/src/page.rs`](https://github.com/LaurenzV/hayro/blob/main/hayro-syntax/src/page.rs), [`PdfData`](https://github.com/LaurenzV/hayro/blob/main/hayro-syntax/src/data.rs)).

Notes:

- `PdfData` accepts `Arc<T>` where `T: AsRef<[u8]>`, so an `Arc<memmap2::Mmap>` is passed **without copying**. **[V]**
- hayro is `#![forbid(unsafe_code)]`, has no C dependencies, and documents its known gaps: knockout/isolated transparency groups, CMYK blending, 3D content. For a cover thumbnail these do not matter. **[V]** (README)
- hayro's MSRV is **1.92**; fine on Rust 1.99. **[V]**
- `pdfium-render` on Android is possible but moves the hard part into Gradle/NDK packaging: Android's system `libpdfium.so` is no longer accessible to apps, so you must ship one (`bblanchon/pdfium-binaries` publishes Android arm64 builds; the latest asset is ~4 MB compressed). **[V]** (README + release assets) **[I]** for the ~11 MB installed estimate.
- MuPDF would give the best robustness, but AGPL-3.0 is incompatible with shipping a closed-source APK. **[V]**

### 2.3 PDF metadata caveat: XMP

Neither `lopdf` 0.47 nor `hayro` 0.9 parses XMP (the repo has no XMP module; `Metadata` is the Info dictionary). Many modern PDFs (LaTeX, Word, InDesign) put the real title/author only in XMP. **[V]** for the absence; **[I]** for prevalence.

Consequence: PDF title/author will frequently be empty or be junk like `Microsoft Word - draft3.doc`. Mitigations:

1. Reject Info titles that are empty, equal to the filename stem, or match `/^(untitled|microsoft word|document\d*)/i`. **[I]**
2. Fall back to the filename parser (§5).
3. Optional later: extract the XMP packet (`<x:xmpmeta …>`) from the raw bytes with `quick-xml` and read `dc:title` / `dc:creator`. Cheap to add, but not required for v1. **[I]**

---

## 3. SAF access from Rust

### 3.1 What the plugin gives you

`tauri-plugin-android-fs` 30.2.0 (MIT/Apache-2.0, requires `tauri ^2.12.0`) exposes:

- `AndroidFs::open_file_readable(&FsUri) -> Result<std::fs::File>` — the Rust side receives a **raw fd** from Kotlin and wraps it with `File::from_raw_fd`. Therefore the returned `File` supports `Read + Seek` via normal `pread`/`lseek`. **[V]** ([`cmds.rs`](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/src/api/impls/cmds.rs))
- The fd comes from `ContentResolver.openAssetFileDescriptor(uri, mode)`, i.e. a `ParcelFileDescriptor` from the document provider. **[V]** ([`AFFileDescriptor.kt`](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/android/src/main/java/AFFileDescriptor.kt))
- `AndroidFs::read_dir(&FsUri) -> Vec<Entry>`; a file `Entry` carries `uri`, `name`, `last_modified`, `len`, `mime_type` — exactly the rescan diff inputs. **[V]** ([`entry.rs`](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/src/api/models/entry.rs))
- `picker().persist_uri_permission(&dir_uri)` takes the persistable tree grant so it survives app/device restarts. **[V]** ([`picker.rs`](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/src/api/picker.rs))
- Feature `protocol_content` registers the `android-fs-content://` custom protocol and implements **single-range and multipart Range** responses (`Accept-Ranges: bytes`, `206`, `Content-Range`) backed by the same fd. **[V]** ([`protocol_content.rs`](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/src/protocols/protocol_content.rs))

### 3.2 Can we avoid copying the whole file?

**Yes, for ZIP/EPUB by construction:** pass the fd-backed `std::fs::File` straight into `rbook::Epub::read(file)` / `zip::ZipArchive::new(file)`. ZIP's central directory lives at the end of the file, so the reader seeks to it and then reads only the OPF/nav/cover entries. A 2 MB EPUB costs a few tens of KB of I/O. **[V]** (`rbook` requires `Read + Seek`; `zip` also needs `Seek`)

**For PDFs, mmap instead of `read_to_end`:**

```rust
let file = api.open_file_readable(&uri).await?;       // SAF fd
let mmap = unsafe { memmap2::Mmap::map(&file)? };     // zero-copy
let bytes: &[u8] = &mmap;
// hash, lopdf metadata, hayro render all read from the same mapping
```

`memmap2` 0.9.12 works on Android (plain `mmap`). **[V]** (crate) / **[I]** (works on the provider fd for local files)

**The real caveat:** providers are not obliged to return a seekable fd. The plugin's own docs warn that cloud-backed files "might be a pair of pipe or socket for streaming data", and may even be fully downloaded before the fd is returned. **[V]** ([`android_fs.rs` docs](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/src/api/android_fs.rs))

So implement a probe:

```rust
fn is_seekable(f: &mut File) -> bool {
    f.seek(SeekFrom::End(0)).is_ok() && f.seek(SeekFrom::Start(0)).is_ok()
}
```

If not seekable: copy once into `cache_dir()/ingest/<blake3>.tmp` with a hard size cap, then treat it as a normal local file. On Android's `ExternalStorageProvider` (the usual case for a user-picked book folder) the fd is a real file and mmap/seek work; Google Drive and some network providers are the slow path. **[I]**

### 3.3 Practical pattern for 100 MB+ PDFs

1. **Ingest:** open fd → mmap → BLAKE3 → `lopdf::Reader::load_metadata_mem(&mmap)` for metadata/page count. Memory is bounded by page-cache pressure, not by a 100 MB heap allocation. **[I]**
2. **Cover:** render only page 1 with hayro at ~600 px wide. Peak extra memory is the RGBA pixmap (~2–4 MB), not the file. **[I]**
3. **Reading:** do **not** hand pdf.js a 100 MB `Vec<u8>`. Give it the `android-fs-content://` URL via `convertFileSrc`; pdf.js issues Range requests, the Rust protocol does `pread` on the same SAF fd and returns `206`. No copy, no app-storage duplicate. **[V]** for the protocol; **[I]** for WebView actually forwarding `Range` (see §10).
4. **Hard caps:** skip cover rendering above e.g. 250 MB (still index metadata); enforce a 30 s per-file budget at the job level. **[I]**

### 3.4 Permissions and moves

- The tree grant persists across restarts after `persist_uri_permission`, but Android explicitly does **not** retain access to a URI if the document is moved or deleted — you must re-grant. **[V]** ([Android SAF docs](https://developer.android.com/training/data-storage/shared/documents-files#persist-permissions))
- Therefore never use the URI as identity. Treat the tree URI as a *location*, and re-walk the tree on every foreground/refresh; hash matching reattaches books after moves (§4). **[I]**
- SAF has no reliable file-watcher. Rescan on app foreground, after downloads, and on demand; the incremental stat-only scan is cheap (§8). **[I]**

---

## 4. Identity and dedupe

### 4.1 Recommendation

**Canonical identity = BLAKE3-256 of the complete file bytes** (`content_key`, stored as 64-char hex, `UNIQUE`).

Use a separate opaque `book_id` (UUIDv7/ULID) as the FK target so the content key can be recomputed/refreshed without cascading updates. **ISBN is an edition attribute, never the primary key**: many files lack one, the same ISBN maps to different scans/formats, and PDFs rarely carry one. **[I]**

### 4.2 Hashing strategy and cost

| Pass | What is hashed | Purpose | Cost at 2,000 files |
|---|---|---|---|
| `quick_key` | `len` + `mtime_ns` + BLAKE3(first 64 KiB ‖ last 64 KiB) | Rescan change detection, rename/move match | ~256 MB read → **1–3 s** **[I]** |
| `content_key` | whole file, BLAKE3, `rayon` feature | true identity, duplicate detection | see below |

BLAKE3 is a Merkle-tree hash with SIMD (NEON on arm64) and optional multithreading; the crate exposes `update_rayon(&[u8])` and `update_mmap_rayon(path)` with the `rayon`/`mmap` features. Because we already have an mmap, use `hasher.update_rayon(&mmap)`. **[V]** ([BLAKE3 README](https://github.com/BLAKE3-team/BLAKE3), crate features)

Full-hash cost estimate: a 20 GB library (2,000 × 10 MB average) at 300–800 MB/s effective SAF read + hash on a mid-range phone is **25–70 s**; at a pessimistic 100 MB/s it is ~3.5 min. **[I]** Hashing is not the bottleneck — opening/parsing 2,000 files is.

Why not sampled-only identity? A 128 KiB head/tail sample can collide for two files of the same size with identical front/back matter (common with publisher boilerplate), and it cannot prove equality. Use it only as a pre-filter; the import writes the full hash. **[I]**

### 4.3 When to hash

- **New file:** full hash before parse (we are reading it anyway for parsing; hash while mmap'd). **[I]**
- **Known URI, same `len` + `mtime`:** no read, no hash. **[I]**
- **Known URI, changed stat:** quick key; if it matches an existing `quick_key`, update the URI; else full hash. **[I]**
- **Unknown URI:** quick key against the `quick_key` index; on miss, full hash. **[I]**

### 4.4 Surviving rename / move / re-grant

The algorithm that handles all three:

1. Walk the tree; build `(uri, name, len, mtime)`.
2. For every entry with a known URI and unchanged `(len, mtime)`: touch `last_seen`.
3. For an unknown/changed URI: compute `quick_key` and look it up. Renames and moves preserve contents and mtime, so this is a hit → **update the URI, keep the book**. **[I]**
4. On a quick-key miss: full hash. A hit means the same book at a new location (e.g. copied to another subfolder); update the primary location and record the second location in `book_file`. A miss creates a new book.
5. Entries in the DB that were not seen: set `missing_at = now`, do **not** delete (matches the glossary: a vanished book is marked Finished/known, never dropped). **[I]**
6. If the user re-grants a **new tree URI** for the same folder, every URI changes; step 3/4 reattaches the whole library with no data loss. **[I]**

Data shape: `book(id, content_key UNIQUE, …)` plus `book_file(book_id, uri, name, len, mtime_ns, quick_key, last_seen, missing_at)`, unique on `uri`. Duplicate bytes anywhere in the tree become two `book_file` rows on one `book` — show a "duplicate copy" badge and let the user delete one. **[I]**

---

## 5. Metadata fallback order and enrichment

### 5.1 Order (never overwrite a higher tier with a lower one)

1. **Embedded** OPF / PDF Info dict (plus `calibre:series`).
2. **Filename parse** for fields still empty (`source = "filename"`, low confidence).
3. **Sidecar** `.opf` next to the book (Calibre export) — optional, cheap to add later. **[I]**
4. **Online enrichment** only for remaining gaps, and only when an ISBN is present (or the user explicitly taps "Look up").
5. **Manual edit** always available; user edits are `source = "manual"` and are never auto-overwritten by a later enrichment pass. **[I]**

Filename patterns worth supporting:

```
Author - Title (Series #2) (2019) [ISBN].epub
Title - Author.pdf
Title (Series, Book 2).epub
```

Strip junk (`(z-lib.org)`, `[libgen]`, `_annas_archive`), normalize whitespace and Unicode NFC. **[I]**

### 5.2 Enrichment APIs

| API | Key | Rate limit | Coverage | Cover | Verdict |
|---|---|---|---|---|---|
| **Open Library** `search.json?isbn=…&fields=title,author_name,publisher,first_publish_year,series,language,cover_i` | none | **1 req/s** default; **3 req/s** with `User-Agent: App (email)` | Good for ISBN-bearing trade books | `covers.openlibrary.org/b/isbn/…-{S,M,L}.jpg?default=false` | **Use** |
| Google Books `volumes?q=isbn:…` | **API key required** per docs | project quota | Very good | `imageLinks.thumbnail` | Optional, BYO key |
| Crossref `works?query.bibliographic=…` | none (`mailto` polite pool) | generous | Academic/DOI PDFs | none | Optional later |

Sources: [Open Library API guidelines](https://openlibrary.org/developers/api) (explicit "1 request per second" default, 3× with identifying User-Agent; "cache responses", "don't make hundreds of single-book requests"), [Search API fields](https://openlibrary.org/dev/docs/api/search), [Covers API](https://openlibrary.org/dev/docs/api/covers), [Google Books auth](https://developers.google.com/books/docs/v1/using#auth) ("Requests to the Books API for public data must be accompanied by … an API key"). **[V]**

Design consequences:

- One request per book, not one per field. `search.json?isbn=` returns `title`, `author_name`, `publisher`, `first_publish_year`, `series`, `language`, `cover_i` in one shot — avoid the `/isbn/{isbn}.json` + N × `/authors/…json` fan-out. **[V]** (fields list) / **[I]** (choice)
- Queue enrichment: 1 req/s + 100–300 ms jitter, single worker, exponential backoff on 429/5xx, `User-Agent: PocketLibrary/0.1 (you@example.com)`. **[I]**
- Cache in SQLite: `enrich_cache(key, source, fetched_at, payload_json, status)`; positive TTL 90 days, negative 30 days. Never block the shelf on the network. **[I]**
- Normalize ISBNs with `isbn` 0.8.x (ISBN-10 ↔ 13, checksum) before querying. **[V]** (crate exists) / **[I]** (use)

### 5.3 Cover licensing

- **Embedded cover** belongs to the user's file; decoding and caching it locally is fine. **[I]**
- **Open Library covers:** "The Internet Archive does not assert any new copyright or other proprietary rights over any of the material in the Open Library database. There may be existing rights issues on some contributions." Treat covers as display-only, cache locally, attribute Open Library, and never include them in an export. **[V]** ([licensing](https://openlibrary.org/developers/licensing))
- **Open Library covers API** says "do not crawl our cover API" — fetch lazily per book, not in bulk. **[V]** ([Covers API](https://openlibrary.org/dev/docs/api/covers))
- **Google Books thumbnails** are copyrighted; the Books API ToS obliges you to remove infringing content on request. Do not ship them as stored assets. **[V]** ([Google Books ToS](https://developers.google.com/books/terms))

---

## 6. Cover storage

### 6.1 Disk, not SQLite BLOBs

Store covers on disk under the app's **data** directory (not cache — the OS may evict cache):

```
app_data_dir()/covers/<hash[0..2]>/<cover_key>.jpg
```

where `cover_key = blake3(encoded cover bytes)` — content-addressed, so refreshing metadata does not orphan files and identical covers across editions dedupe. **[I]**

Why disk:

- 2,000 covers × 40–80 KB ≈ **80–160 MB**; keeping that out of SQLite keeps the DB small, fast to `VACUUM`, and cheap to back up. **[I]**
- WebView can fetch a file directly through Tauri's asset protocol (`convertFileSrc` + `assetProtocol.scope = ["$APPDATA/covers/**"]`), avoiding a base64/IPC copy per shelf render. **[I]**
- SQLite BLOBs are viable at this size and are atomic/transactional, but every list query must avoid selecting the blob column and backups balloon. Disk wins for a UI asset. **[I]**

DB row: `cover_key`, `cover_source` (`embedded|openlibrary|generated`), `cover_w`, `cover_h`, `cover_attribution`, `cover_updated_at`, plus `dominant_color` for the pre-load spine colour. **[I]**

### 6.2 Format and sizes

| Use | Size | Format | Est. bytes |
|---|---|---|---|
| Shelf + detail | 600×900 max (preserve aspect, no crop) | JPEG q80 | 40–80 KB |
| Placeholder | 32×48 | JPEG or dominant-colour CSS | < 2 KB |

- Render PDF page 1 at `scale = 600 / page_width_pt`, flatten onto white, then resize to fit 600×900. **[I]**
- EPUB: decode with `image` (features `jpeg`, `png`, `webp`), auto-orient, resize, encode JPEG. SVG covers are legal EPUB 3 but rare; v1 falls back to a generated placeholder (add `resvg` later if needed). **[V]** (SVG allowed by the `cover-image` property) / **[I]** (fallback)
- Generated placeholder: deterministic two-colour gradient from `hash(title+author)` plus initials — no file needed, render in CSS. **[I]**

---

## 7. Recommended ingest pipeline

```
foreground / manual refresh
        │
        ▼
[1] SCAN      read_dir(tree) recursively → (uri, name, len, mtime, mime)
        │      diff against book_file
        ▼
[2] MATCH     known URI + same stat → touch
        │      else quick_key → update URI (rename/move)
        ▼
[3] HASH      full BLAKE3 (mmap + rayon) → dedupe / insert book
        │
        ▼
[4] PARSE     sniff magic: "PK\x03\x04" → EPUB, "%PDF-" → PDF
        │      EPUB: rbook (skip_toc) + cover bytes
        │      PDF : lopdf metadata/page_count, hayro page 1
        ▼
[5] NORMALIZE dates, languages, authors, ISBN, junk-title rejection
        │
        ▼
[6] ENRICH    queue only if ISBN && gap; 1 req/s; cache
        │
        ▼
[7] INDEX     upsert book + book_file + cover row in one txn (WAL)
```

Rust shape:

```rust
// worker thread, concurrency 2 on mobile (rayon global pool capped)
for entry in scan_batch {
    let mut file = android_fs.open_file_readable(&entry.uri).await?;
    // fallback: copy to cache if !is_seekable(&mut file)
    let mmap = unsafe { memmap2::Mmap::map(&file)? };

    let hash = blake3::Hasher::new().update_rayon(&mmap).finalize();
    let parsed = match sniff(&mmap) {
        Kind::Epub  => parse_epub(&mut file),          // seek-based, lazy
        Kind::Pdf   => parse_pdf(&mmap),               // lopdf + hayro
        Kind::Other => Err(Unsupported),
    };
    tx.upsert(Book { content_key: hash, ..parsed });
}
```

Operational rules:

- Run ingest in `tauri::async_runtime::spawn_blocking`, **not** on the async runtime threads. **[I]**
- Emit `ingest://progress { done, total, current_title }` at most ~10 Hz. **[I]**
- Commit in batches of 25–50 rows; one SQLite writer; WAL mode. **[I]**
- Never let one bad file abort the batch; see §9.

---

## 8. Performance estimates at 2,000 files

Assumptions: 1,500 EPUBs × 1.5 MB, 500 PDFs × 20 MB ≈ **12 GB**; mid-range arm64 phone; local SAF provider. **[I]**

| Stage | Per file | 2,000 files |
|---|---|---|
| Directory walk + stat | 1–3 ms | 2–6 s |
| Quick key (128 KiB) | 1–3 ms | 2–6 s |
| Full BLAKE3 (avg 6 MB) | 10–40 ms | 20–80 s |
| EPUB parse (OPF + cover entry) | 5–20 ms | 8–30 s |
| PDF metadata via `lopdf` | 10–60 ms | 5–30 s |
| PDF cover render (hayro, 600 px) | 80–400 ms | 40–200 s |
| Cover resize/encode | 5–15 ms | 5–15 s |
| **Cold import** | | **~2–6 min** |
| **Warm rescan (stat only)** | | **< 5 s** |

Incremental foreground scans should be stat-only and feel instant; hashing/parsing only runs for new or changed files. Enrichment for a 300-book gap at 1 req/s is ~5 min in the background. **[I]**

Storage budget: covers 80–160 MB; DB with full metadata ~5–15 MB; parsing scratch < 300 MB. **[I]**

---

## 9. Failure handling

| Failure | Detection | Behaviour |
|---|---|---|
| Provider returns unseekable fd | `seek(End(0))` fails | Copy to `cache_dir()/ingest/` with size cap, then parse |
| Permission revoked / tree moved | `SecurityException` surfaced as plugin error | Mark library disconnected, show "Re-grant folder" flow; keep DB |
| File disappeared | not in scan | `missing_at`, keep book (Finished) |
| Invalid ZIP / missing container | `rbook` error | Raw-ZIP OPF fallback; else `parse_error=invalid_epub`, book still appears with filename metadata |
| Missing OPF fields | `Option::None` | Filename fallback, then enrichment |
| DRM / encrypted content | `encryption.xml`, PDF `encrypted` | `locked=true`; no reader; "Open in another app" action |
| Encrypted PDF with empty user password | `load_metadata_*_with_password("")` succeeds | Parse normally |
| Broken PDF xref | lopdf rebuilds by scanning; hayro `fallback` xref | Parse with warning; slower |
| Parser panic | `catch_unwind` around per-file parse | Mark `parse_error`, continue batch |
| Parser hang / decompression bomb | per-file time budget + entry-size caps | Mark `timed_out`, skip cover |
| ZIP path traversal | `..`/absolute href rejection | Ignore resource, warn |
| Cover image bomb | `image::Limits` (max dimensions/alloc) | Use placeholder |
| Cloud file download on open | file open latency | Show spinner; don't block other files |

Two hardening notes:

- Rust cannot safely kill a hung parse thread. Isolate the *rare* pathological file by enforcing caps *before* parse (size, entry count, compressed/uncompressed ratio) and by keeping hayro on a worker whose job can be marked failed; the thread may linger until it returns. A process-isolated parser is possible on Android but not worth v1 complexity. **[I]**
- Wrap EPUB XHTML/JS and PDF JS as untrusted in the readers (epub.js scripting off; pdf.js `isEvalSupported=false`). **[I]**

---

## 10. Risks and spikes to run before committing

1. **hayro cross-compiles to `aarch64-linux-android`** with the Tauri NDK toolchain (pure Rust, but `fearless_simd`/`vello_cpu` may need target features). **Spike:** `cargo build --target aarch64-linux-android -p ingest`. **[I]**
2. **mmap on a SAF fd** works for the local `ExternalStorageProvider` and for SD-card providers; fails for pipes. **Spike:** open the real library tree, mmap one EPUB and one 100 MB PDF. **[I]**
3. **Range requests through the Android WebView** reach the `android-fs-content://` handler (pdf.js sends `Range`). If not, fall back to a tiny localhost HTTP server or pre-buffer the first N MB. **[I]**
4. **Tauri asset protocol scope** for `$APPDATA/covers/**` on Android; if awkward, add a `read_cover(key) -> Vec<u8>` command. **[I]**
5. **`rbook` on real damaged files**: collect 20 known-bad EPUBs and confirm the raw-ZIP fallback path.
6. **PDF XMP-only titles**: measure how often Info title is empty in the target library; if >30%, schedule the XMP extractor.

---

## 11. Dependency set (Cargo.toml)

```toml
[dependencies]
tauri = "2.12.7"
tauri-plugin-android-fs = { version = "30.2.0", features = ["protocol_content"] }

# EPUB
rbook = "0.7.13"                       # Apache-2.0, EPUB 2/3, Read+Seek
zip = "9.8.2"                          # malformed-EPUB fallback
quick-xml = "0.42.0"                   # OPF repair + optional XMP

# PDF
lopdf = "0.47.0"                       # metadata + page count, no full load
hayro = "0.9.0"                        # pure-Rust page rasterizer

# Media
image = { version = "0.25.10", default-features = false, features = ["jpeg", "png", "webp"] }

# Identity / IO
blake3 = { version = "1.8.7", features = ["rayon"] }
memmap2 = "0.9.12"
rayon = "1.12.0"

# Storage (ticket 09 owns the final choice)
rusqlite = "0.43.0"                    # bundled SQLite via NDK

# Misc
isbn = "0.8.20261124"                  # optional: ISBN-10/13 normalization
ammonia = "4.2.5"                      # sanitize dc:description HTML
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tracing = "0.1"
```

**Rejected:** `epub` (GPL-3.0-or-later), `mupdf` (AGPL-3.0), `poppler-rs` (GPL + system poppler), `epub-parser` (incomplete EPUB 3), `pdfium-render` (fine license, but native-lib packaging on Android is a self-inflicted wound; keep as fallback if hayro quality disappoints).

---

## 12. Resolution comment (≈10 lines)

> **Decision:** ingest with `rbook` 0.7.13 for EPUB and `lopdf` 0.47.0 + `hayro` 0.9.0 for PDF, over SAF fds from `tauri-plugin-android-fs` 30.2.0.
>
> EPUB 2/3 metadata (including Calibre series), cover, TOC and spine come from `rbook` over the provider's seekable `File`; no archive copy. Malformed files fall back to raw `zip` + `quick-xml` OPF parsing.
>
> PDF metadata and page count come from `lopdf`'s metadata-only loader; page 1 is rendered to a 600 px JPEG with pure-Rust `hayro`, avoiding PDFium/MuPDF native libs (and MuPDF's AGPL).
>
> Canonical identity is **BLAKE3-256 of the full file**, with a 128 KiB head/tail quick key for rescans; this survives rename, move and tree re-grant, where SAF URIs and document IDs do not. ISBN is an attribute, not a key.
>
> Metadata order: embedded → filename → (ISBN-gated) Open Library enrichment → manual edit. Open Library is keyless at 1 req/s (3 with an identifying User-Agent); Google Books needs a key per its docs.
>
> Covers live content-addressed on disk (JPEG q80, 600×900, ~80–160 MB total), served through the asset protocol; SQLite stores paths and attribution only.
>
> Cold import of ~2,000 files is ~2–6 min; warm rescan is stat-only and <5 s. Per-file failures are quarantined without aborting the batch; DRM is detected and marked locked.
