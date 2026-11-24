# Libgen + Anna's Archive programmatic access (2026-11-24)

**Question:** how do we search and download EPUB/PDF from Libgen, with Anna's Archive as fallback, from a Rust/Tauri backend on Android, as of today?

**Status labels**

- **[verified]** — observed directly on 2026-11-24 between 11:30 and 12:00 UTC from this Linux box with `curl`, or read in the owning project's source/docs.
- **[inferred]** — reasoning from verified facts; not directly tested on a phone or from another network.

**Probe environment:** Debian 13, `curl 8.x`, no browser, no VPN. All live requests used a desktop Chrome User-Agent. Every raw request/response below was actually executed unless explicitly marked otherwise.

---

## TL;DR (decision-ready)

1. **There is no structured (JSON/XML) *search* API on Libgen.** The working Libgen family is the `libgen.li` / `.bz` / `.vg` / `.la` / `.gl` "LG+" codebase, and its search is an HTML table at `GET /index.php?req=...`. **[verified]** The official `/json.php` is a *metadata dump API*, not a search API; `/rss.php` is a new-arrivals feed; `/batchsearchindex.php` is a POST form that did not return machine-readable data in our test. The map's "structured search endpoints" assumption needs to change: no such endpoint exists on today's mirrors. **[verified for the endpoints; inferred for the plan change]**
2. **Search HTML is stable enough to parse**, and all five LG+ mirrors serve the *identical* result set for the same query (same 25 md5s, byte-for-byte same set). One parser plus host-swapping failover covers all of them. **[verified]**
3. **Download chain is simple and headless-friendly:** `ads.php?md5=<32 hex>` → parse one `get.php?md5=…&key=…` link → 307 to `https://cdn3.booksdl.lc/get.php?md5=…&key=…` → file bytes. No cookies, no JS, no Referer, no Cloudflare challenge on `.li`/`.bz`/`.vg` from this box. **[verified]**
4. **All five mirrors were usable for search + download today**; `.li`, `.bz`, `.vg` are the healthy unprotected tier, `.la`/`.gl` are Cloudflare-"protected" and flakier. Recommended failover order: **`.li` → `.bz` → `.vg` → `.la` → `.gl`**. **[verified]** (SLUM status + live probes)
5. **Anna's Archive is *not* easy to integrate.** Its search and detail pages are behind DDoS-Guard: every `/search` and `/md5/` request returned **403 with `<title>DDoS-Guard</title>`**. Its only stable API is `/dyn/api/fast_download.json`, which requires a **membership secret key** and is a *download-URL* API, not search. **[verified]** Recommendation: **do not put Anna's in v1**. Offer a "Search on Anna's" external-browser action/link instead. **[inferred]**
6. **Build Libgen first**, as an HTML-search + JSON-metadata adapter behind a trait, with a resumable downloader that sniffs magic bytes. That is the whole v1 acquisition path. **[inferred]**
7. **Do not use the `libgen-rs` crate (0.1.0) as a base or as a parser reference.** It targets the dead classic Libgen (`search.php` on `libgen.is/.rs/.st`, plus `library.lol`/ipfs), regex-scrapes hashes instead of parsing results, panics on an unreachable mirror, has no LG+ support, and returns **0 results** against today's live `libgen.li`. It has exactly one release (0.1.0, 2022); the 2024 refactor was never published. Build the ~400-line reqwest client ourselves. **[verified]** (§5b)
8. **SLUM is a useful but coarse health hint, not an oracle.** It covers all five live LG+ mirrors and exposes a real machine-readable snapshot at `https://open-slum.org/status.json` (~25 KB; 60 s checks, 5-min buckets, `generated_at` ~3.5 min stale) plus per-domain CSV logs. But it checks only homepages, from one US-East vantage, treats `PROTECTED` as green, and cannot see search/download/CDN failures. Use it to order and skip candidates with a 10-min cache; hardcode the five hosts and probe the real endpoint on every attempt. **[verified]** (§5c)
9. **The four surveyed GitHub clients are references, not replacements.** `obsfx/libgen-downloader` is the best resilience reference (health/cooldown, transient-vs-not-available taxonomy, recovery wait, live E2E), `Houdiee/Libgen-TUI` the closest Rust LG+ client (mirror race/discovery, `.part` rename, rustls), `waltz/libgenie` contributes generic header mapping + anchor scoring, and `mattrighetti/libgen-bot-rs` is dead/unlicensed with no download. **Keep the hand-rolled client** and port those specific pieces. **[verified]** (§5d)

---

## 1. Mirrors and health

### 1.1 What SLUM currently tracks

[SLUM (`open-slum.org`)](https://open-slum.org/libgen.html) is the mirror monitor OpenlibExtended uses as its only source of mirror URLs ([`slum_catalogue.dart` L20–L31](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/slum_catalogue.dart#L20-L31)). Its Libgen page on 2026-11-24 11:56 UTC listed **five** domains. `libgen.is` and `libgen.rs` are **not** on it at all. **[verified]** ([`libgen.html`](https://open-slum.org/libgen.html))

| Mirror | SLUM status | SLUM latency | Protection SLUM reports | Our search probe | Our download probe |
|---|---|---|---|---|---|
| `https://libgen.li` | **UP** | ~611 ms | none | 200, 25 rows | 200 → 307 → CDN 206/200 |
| `https://libgen.bz` | **UP** | ~722 ms | none | 200, identical rows | 307 → same CDN |
| `https://libgen.vg` | **UP** (brief `DOWN` at 11:56:25) | ~1325 ms | none | 200, identical rows | 307 → same CDN |
| `https://libgen.la` | **PROTECTED** | ~870 ms | Cloudflare | 200, identical rows | 307 → CDN 206 |
| `https://libgen.gl` | **PROTECTED** | ~1304 ms | Cloudflare | 200, identical rows | 307 → CDN 503 once, 206 on retry |

Health evidence: SLUM per-minute logs for [`li`](https://open-slum.org/logs/libgen/li.log), [`bz`](https://open-slum.org/logs/libgen/bz.log), [`vg`](https://open-slum.org/logs/libgen/vg.log), [`la`](https://open-slum.org/logs/libgen/la.log), [`gl`](https://open-slum.org/logs/libgen/gl.log). A machine-readable snapshot of the same monitors is at <https://open-slum.org/status.json>; how to consume it is covered in §5c. Sample from `li.log` at 11:56 UTC:

```
2026-11-24T11:56:04.955721+00:00,libgen,libgen.li,UP,200,636,,
```

`vg.log` at 11:56:25:

```
2026-11-24T11:56:25.363057+00:00,libgen,libgen.vg,DOWN,,,connection_refused,
```

That `DOWN` was transient — `vg` answered a search again at 11:57. Treat SLUM status as a hint, not a hard gate; retry one tier down. **[inferred]**

### 1.2 `libgen.is` / `libgen.rs`

- DNS resolves: `libgen.is` and `libgen.rs` → `193.218.118.42` (`getent hosts`). **[verified]**
- TCP 80 and 443 to that IP **time out** from this box; `curl https://libgen.is/` returns `000` after 8 s. **[verified]**
- `libgen.li`'s own navigation still links to `http://libgen.rs/dbdumps/` as the "Libgen" database-dump location, so the domain is not gone from the project's worldview. **[verified]** ([libgen.li home markup](https://libgen.li/))
- It is not on SLUM and not in any current mirror list we can measure. **Do not build on it.** If it comes back, its classic search is `GET /search.php?req=…&open=0&res=25&view=simple&phrase=1&column=def` returning an HTML `table.c` — this is the *other* Libgen codebase, not LG+ (OpenlibExtended still carries a parser for `table.c` as a legacy path: [`search_manager.dart` L140–L151, L222–L258](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L140-L151)). That endpoint shape is **[inferred]** from the legacy parser, not re-verified because the host is unreachable here.
- Box-level caveat: a timeout from this network does not prove the host is globally dead; it may be IP-blocked at this network. We only claim **unreachable from this environment**. **[verified]**

### 1.3 Domains that look like Libgen but are not

`libgen.lc` redirects to a parking page (`ww38.libgen.lc`); `libgen.one` redirects to `libgen.im` (SEO mirror); `libgen.ee` is an ad-heavy SEO clone; `libgen.pw` is a 2.5 KB JS shell. None are on SLUM. **Never ship these as fallbacks.** **[verified]** (live probes 2026-11-24)

**`library.lol` is dead and seized.** The old Libgen direct-download domain resolves to `107.180.28.153` and serves a **"Domain Seizure Notice"** ("THIS WEBSITE HAS BEEN SHUT DOWN AND ITS DOMAIN NAME TURNED OVER TO EDUCATIONAL PUBLISHERS BY COURT ORDER"), with a self-signed certificate on HTTPS. Do not add it to any failover list. **[verified]** (live probe 2026-11-24)

---

## 2. Search endpoints

### 2.1 What does *not* exist

Every one of these was probed on `libgen.li` on 2026-11-24:

| Candidate | Result |
|---|---|
| `GET /search.php?req=…` | 404 |
| `GET /xml.php?req=…` | 404 |
| `GET /api/search?q=…`, `/search?q=…`, `/api.php?req=…` | 404 |
| `GET /index.php?…&json=1`, `&format=json`, `&output=json`, or `Accept: application/json` | 200 `text/html` (same HTML page) |
| `GET /json.php?object=f&…` | **200 JSON — metadata only, no query/filter** (see §2.5) |
| `GET /rss.php?req=<anything>` | 200 XML, but `req` is ignored; returns newest 100 files (see §2.6) |
| `POST /batchsearchindex.php` with `strings=…` | 200 HTML form page, no results in our attempt |

So the "structured search endpoint" the map assumed does not exist on the working mirrors. The only machine-readable search output is the HTML table. **[verified]**

### 2.2 The real search endpoint (LG+ family)

```
GET https://libgen.li/index.php?req=<query>&res=25&page=<n>
```

Same handler on `.bz`, `.vg`, `.la`, `.gl` (host-swap only; path and query identical). The form on the page is `GET` to `index.php` with `enctype=multipart/form-data`. **[verified]** ([search form markup](https://libgen.li/index.php?req=test&res=25))

#### Parameters that actually work

| Param | Value / meaning | Observed behaviour |
|---|---|---|
| `req` | free text, URL-encoded | Default: **all words must appear** in at least one selected field (AND across words, OR across fields). **[verified]** (page help text) |
| `columns[]` | `t` title, `a` author, `s` series, `y` year, `p` publisher, `i` ISBN | Restricts all `req` terms to those columns. `columns[]=t&columns[]=a` works; `columns[]=a` alone with title words returns 0. **[verified]** |
| `objects[]` | `f` files, `e` editions, `s` series, `a` authors, `p` publishers, `w` works | Default = all six. Leave default for file search. **[verified]** |
| `topics[]` | `l` Libgen, `c` comics, `f` fiction, `a` scientific articles (scimag), `m` magazines, `r` fiction RUS, `s` standards | Default = all seven. Restrict to `a` for scimag. **[verified]** |
| `page` | integer ≥ 1 | Works. Page 1 and 2 had **zero md5 overlap**; 25 + 18 = 43 results. **[verified]** |
| `res` | 10/25/50/100 in the UI | **Ignored** in every test: 10, 25, 50, 100 all returned 25 rows. Page size is effectively **25**. **[verified]** |
| `gmode` | `1` = "Google mode" | Enables quotes/wildcards/exclusion and `field:value` syntax. Only `md5:<hash>` was reliably useful for us. **[verified]** |
| `order` + `ordermode` | e.g. `order=year`, `order=filesize`; `asc`/`desc` | Works. `order=year&ordermode=desc` put 2021 first; `order=filesize&ordermode=desc` put 8 MB first. **[verified]** |
| `extension`, `language`, `year` (plain params) | e.g. `&extension=epub` | **Ignored** by this server. Same 25 results with/without. Do not rely on them. **[verified]** |
| `filesuns`, `covers`, `showch` | UI cosmetics | Not needed. **[verified]** |

#### Total count and pagination

The page contains the total for the current object as a badge:

```html
Files <span class="badge badge-primary">43
```

Use it to stop paging. There are no `<a href="…page=2">` links; pagination is a form/JS resubmit. **[verified]** ([result page](https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25))

#### Real request / real response

Request:

```http
GET /index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25 HTTP/1.1
Host: libgen.li
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36
```

Response: `200`, `text/html; charset=UTF-8`, ~80 KB. The results are in `<table id="tablelibgen">`, one `<tr>` per file, with **9 `<td>`s**:

| cell | content |
|---|---|
| 0 | title + links to `series.php`, `edition.php?id=<edition>` |
| 1 | author(s) |
| 2 | publisher / series |
| 3 | year |
| 4 | language |
| 5 | pages (`0` when unknown) |
| 6 | human size (`3 MB`) + `/file.php?id=<file_id>` |
| 7 | extension (`epub`, `pdf`, `mobi`, `azw3`, …) |
| 8 | mirror links; first is **`/ads.php?md5=<32 hex>`** |

First row for the acceptance query (whitespace collapsed):

```text
Alice Feeney - Rock Paper Scissors (UK) (epub)   | Alice Feeney | HarperCollins Publishers | 2021 | English | 0 | 4 MB (/file.php?id=96692128) | epub | /ads.php?md5=ac29ed3de1b1d2ae3bc931e71e1dd3d5 …
```

This 9-column layout is exactly what OpenlibExtended parses (`_liRowToBook`, [`search_manager.dart` L163–L220](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L163-L220)) and what we independently observed. **[verified]**

Caveat: `cell[2]` is often the *publisher*, but for some rows it is a series. `cell[3]` is frequently empty on bulk-uploaded records, so year is not a reliable filter client-side either. **[verified]**

### 2.3 Field-specific and special searches

**Title + author (recommended for book search):**

```http
GET /index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25&columns%5B%5D=t&columns%5B%5D=a
```

Returned the same 25 rows, target first. **[verified]**

**Title only** (`columns[]=t`) ranks worse for this query: the Alice Feeney book fell out of the visible top 15 because many other works share the title. Use title+author, or default (no `columns`) which also ranked the target first. **[verified]**

**ISBN** (ISBN-13 for *The Seven Husbands of Evelyn Hugo*):

```http
GET /index.php?req=9781501161933&res=25&columns%5B%5D=i
```

→ 4 rows, all that book, mixed `pdf`/`azw3`/`fb2`. **[verified]**

**MD5** (the only reliable `gmode` field):

```http
GET /index.php?req=md5%3Aa1423442916f2f3def9517a3bf4dee48&res=25&gmode=1
```

→ exactly 1 row for that file (title/author/year/epub/3 MB). **[verified]**

**Publisher** (`columns[]=p`, `req=Flatiron`) → 2,491 total, rows returned. **Series** (`columns[]=s`, `req=Rock+Paper`) → 11 total. **[verified]**

> **Do not copy OpenlibExtended's author-search logic.** It folds the title into `req` and then restricts to `columns[]=a` whenever an author is present ([`search_manager.dart` L262–L282](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L262-L282)). With `req=Rock Paper Scissors Alice Feeney&columns[]=a` the server requires *all* words in the author column and returns **0 rows** — we reproduced this. Search with `columns[]=t&columns[]=a` (title+author) or no `columns` at all. **[verified]**

**Year** is **not** usable as a server-side filter:
- `&year=2021` was ignored (same 25).
- `req=… year:2021&gmode=1` returned **0 results**, as did `year:2020` and `lang:eng`.
- `columns[]=y&req=2021` returned no table (query too broad).
Apply year/language/extension filtering **in Rust after parsing**. **[verified]**

**Scimag / scientific articles** (DOI example, `10.1038/nature12373`):

```http
GET /index.php?req=10.1038%2Fnature12373&topics%5B%5D=a&res=25
```

→ 200, one article row. Its cells are **not** the 9-column book layout: it links to `series.php?id=…` and `edition.php?id=28096530`, with `DOI: 10.1038/nature12373`, no md5. Following `edition.php?id=28096530` yields `file.php?id=28250404`; that page links to `/ads.php?md5=d89c394b00116f093b5d9d6a6611f975&downloadname=…`, then the normal get.php chain. So **scimag files resolve one hop later than books**. **[verified]**

That is the whole answer to "libgen.li scimag": it is the `topics[]=a` collection on the same host; there is no separate `scimag/` path (`/scimag/`, `/scimag/index.php`, `/scimag/get.php` all 404). **[verified]**

### 2.4 Collection / mirror matrix

| Collection | LG+ `topics[]` code | Served by | Notes |
|---|---|---|---|
| Books ("Libgen") | `l` | `.li .bz .vg .la .gl` | main ebook collection |
| Fiction | `f` | same | where *Rock Paper Scissors* lives (`libgen_topic:"f"`) |
| Comics | `c` | same | `.cbz`/`.cbr` appear in results |
| Scientific articles (scimag) | `a` | same | DOI search; file via `edition.php` → `file.php` |
| Magazines | `m` | same | — |
| Standards | `s` | same | — |
| Fiction RUS | `r` | same | — |

All five mirrors returned the **same 25 md5s** for the acceptance query (verified by hashing the sorted md5 list: identical digest). One parser, host-swapped, is enough. **[verified]**

### 2.5 `json.php` — the documented metadata API (not search)

`GET https://libgen.li/json.php` serves the official API documentation. It is a **record dump/query by id or time range**, not a text search. **[verified]** ([API docs](https://libgen.li/json.php))

Documented parameters (from the page): `object` (required: `a,s,p,e,f,w`), `limit1`, `limit2`, `ids`, `mode=last|modified`, `timefirst`, `timelast`, `id_start`, `id_end`, `fields`, `addkeys`, `topic` (`l,c,m,a,s,f,r`). Max 10,000 records per part. **[verified]**

Real request for our chosen file:

```http
GET /json.php?object=f&ids=98756682
```

Real response (trimmed; top-level key is the **file id**, not md5):

```json
{
  "98756682": {
    "md5": "a1423442916f2f3def9517a3bf4dee48",
    "pages": "0",
    "time_added": "2023-02-06 03:38:29",
    "time_last_modified": "2023-03-12 02:57:35",
    "cover_exists": "1",
    "filesize": "3630176",
    "extension": "epub",
    "locator": "Alice Feeney - Rock Paper Scissors (2021, Flatiron Books).epub",
    "broken": "",
    "libgen_topic": "f",
    "editions": { "96199863": { "e_id": "140679592", "...": "..." } }
  }
}
```

Use it to get exact `filesize`, `extension`, `locator`, `broken`, and `time_added` for files found in HTML. One request can batch up to 10,000 ids. **[verified]** Multiple ids work: `/json.php?object=f&ids=96692128,98756682,98756683` returned all three. **[verified]**

### 2.6 `rss.php` — new arrivals, not search

`GET /rss.php?page=1` returns RSS 2.0 with 100 `<item>`s. `req` is ignored. Each item has:

```xml
<item>
  <guid isPermaLink="false">58affbdb2092df1170e4c591cee21b5d</guid>
  <title>…</title>
  <link>file.php?id=116652153</link>
  <description>&lt;table … Title/Author/Publisher/Year/Size/ID/Date Added …</description>
</item>
```

`guid` is the md5; `<link>` is the file id. Useful for a "new arrivals" shelf later, not for search. **[verified]**

---

## 3. Result → downloadable file

### 3.1 The chain (verified end-to-end on the acceptance book)

```
1. HTML row                         → /ads.php?md5=a1423442916f2f3def9517a3bf4dee48
2. GET https://libgen.li/ads.php?md5=… 
   → 200 text/html, contains        get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3
3. GET https://libgen.li/get.php?md5=…&key=…
   → 307 Location: https://cdn3.booksdl.lc/get.php?md5=…&key=…
4. GET https://cdn3.booksdl.lc/get.php?md5=…&key=…
   → 200 application/octet-stream
     content-length: 3630176
     content-disposition: attachment; filename="Rock Paper Scissors{Alice Feeney}(2021, HarperCollins Publishers){98756682} libgen.li.epub"
```

**[verified]** (all four requests executed 2026-11-24 11:41–11:43 UTC)

`ads.php` is ~20 KB and needs **no** cookies, **no** Referer, and **no** special headers. It contains exactly one `get.php?md5=…&key=…` anchor inside `<table id=main>`. **[verified]** It also embeds ad iframes — ignore them.

The same `ads.php` page is reachable from `/file.php?id=<file_id>` (the human-facing page), which links to `/ads.php?md5=…`. `file.php` adds nothing for a client; go straight to `ads.php` when the md5 is known. **[verified]**

### 3.2 The key: what it is and is not

- Minted per `ads.php` load (different random 16-char alnum on each fetch). **[verified]**
- **Bound to the md5.** A key for md5 A used with md5 B redirects to `/ads.php?md5=B&key=…` (not the file). **[verified]**
- **Not bound to host**: a key minted on `libgen.li` worked on `libgen.bz`'s `get.php`. Still, mint per mirror to be safe. **[verified]**
- **Not needed by the CDN.** `https://cdn3.booksdl.lc/get.php?md5=<md5>` with **no key at all** returned `206`/`200` and the real bytes. The key is only validated by the mirror's `get.php`. **[verified]**
- **Still valid after ~16 minutes** in our test; exact TTL unknown. Treat as short-lived: on any failure re-fetch `ads.php`. **[verified/inferred]**
- Wrong/missing key → `307 Location: /ads.php?md5=…&key=…` (relative). A client that blindly follows redirects will download the **ads HTML page** and call it a book. Detect this and re-mint. **[verified]**
- Unknown md5 → `ads.php` returns `200` with "not found" and **no** get.php anchor; `get.php` with a bogus md5 returns **500**. **[verified]**

### 3.3 Redirects, Cloudflare, failover

- `get.php` → CDN is a **307**, one hop. The CDN is Cloudflare-fronted (`server: cloudflare`) and supports `Range` (`206`, `content-range`) and normal `200`. **[verified]**
- No Cloudflare interstitial was served by `.li`, `.bz`, or `.vg` in any request (search, ads, get, CDN). `.la`/`.gl` are Cloudflare-"protected" per SLUM; our IP passed, but one CDN fetch from `.gl` returned nginx **503** and succeeded on retry. **[verified]**
- If a mirror's `get.php` fails, **the md5 is portable**: re-fetch `ads.php` on the next mirror to mint a new key and retry the same md5. **[verified]** (same key worked cross-host, so the file is served from a shared backend)
- If the CDN fails, retrying the same CDN URL worked (503 → 206). If it keeps failing, re-resolve `get.php` on another mirror; a different mirror may return a different `cdnN.booksdl.lc` host. **[inferred]**
- **Do not construct `cdn3` yourself in production.** Follow the `Location` from `get.php`; the host is chosen by the mirror and can change. The keyless CDN URL is an emergency fallback only. **[inferred]**

### 3.4 HTTP/2 truncation (real, observed)

The first full download of the 3,630,176-byte EPUB stopped at **522,296 bytes** with `curl` exit **92** (`HTTP/2 stream … was not closed cleanly`). Re-running with `--http1.1` completed in **20.4 s** (~178 KB/s) with the exact expected byte count. **[verified]**

A resilient Rust client must treat a short body as a failure, never rename/ingest the partial file, and resume with `Range: bytes=<n>-` (CDN supports it). Using HTTP/1.1 for the download leg is the simplest mitigation. **[inferred]**

---

## 4. Rate limits, bot protection, headers, cookies

| Question | Finding |
|---|---|
| Required headers on `.li`/`.bz`/`.vg`? | **None.** No UA, empty UA, `pocketlibrary/0.1`, and Chrome UA all returned 200 on `index.php`, `ads.php`, `get.php`. No cookies needed. **[verified]** |
| Referer? | Not required for `ads.php` or `get.php`. **[verified]** |
| Cookies? | None set or required. **[verified]** |
| Rate limit? | No `429`/`Retry-After` seen. A 10-request burst at ~2.5 req/s all returned 200. No documented limit. Be polite anyway: cache searches, ≤1 req/s per host, one download at a time. **[verified observation + inferred policy]** |
| `robots.txt` | `User-agent: *` / `Disallow: /` on `libgen.li`. Automated use is explicitly disallowed by the site's own robots policy. This is an ethical/legal caveat, not a technical block. **[verified]** ([robots.txt](https://libgen.li/robots.txt)) |
| Cloudflare on `.la`/`.gl` | SLUM reports "PROTECTED / Cloudflare"; some requests get `connection-blocked` per SLUM logs. A plain reqwest client may be challenged from some IPs; treat as last resort. **[verified]** |
| Blocks against Rust/server-side clients specifically | **None observed on `.li`/`.bz`/`.vg`.** The only real server-side block we found is Anna's DDoS-Guard (see §5). **[verified]** |

**Resilient client minimum:**

1. Browser-like `User-Agent`, `Accept: text/html,application/xhtml+xml`, `Accept-Language: en-US,en;q=0.9`.
2. No cookie jar required for Libgen; do **not** replay Anna's DDoS-Guard cookies (they are TLS-fingerprint-bound — OpenlibExtended's own note: [`ddos_protection_handler.dart` L1–L11](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/ddos_protection_handler.dart#L1-L11)).
3. Detect challenge pages by `<title>` (`Just a moment`, `DDoS-Guard`, `Checking your browser`) and by `cf-mitigated: challenge`; fail over rather than parsing them. **[verified]** (the detection list in [`annas_archive.dart` L337–L383](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/core/annas_archive.dart#L337-L383) is a good starting set)
4. Re-mint keys; never persist them.
5. Treat `307 → /ads.php` as "bad key", not as success.

---

## 5. Anna's Archive

### 5.1 Is there a documented API?

Yes, but only one, and it is not search. From Anna's own FAQ: **[verified]** ([FAQ #api](https://annas-archive.gl/faq#api))

> "We have one stable JSON API for members, for getting a fast download URL: `/dyn/api/fast_download.json` (documentation within JSON itself). For other use cases, such as iterating through all our files, building custom search, and so on, we recommend generating or downloading our ElasticSearch and MariaDB databases."

The endpoint self-documents on any request: **[verified]** ([`fast_download.json`](https://annas-archive.gl/dyn/api/fast_download.json))

```json
{
  "///download_url": [
    "This API is intended as a stable JSON API for getting fast download files as a member.",
    "Accepted query parameters:",
    "- `md5` (required): the md5 string of the requested file.",
    "- `key` (required): the secret key for your account (which must have membership).",
    "- `path_index` (optional) …",
    "- `domain_index` (optional) …"
  ],
  "download_url": null,
  "error": "Invalid md5"
}
```

Observed status codes: no params → **400 Invalid md5**; valid md5 + fake key → **401**. A real `key` is an account/membership secret. There is **no** public search API, no ISBN/title endpoint, and no anonymous structured search. **[verified]**

### 5.2 Can a Rust backend scrape the HTML search?

Not realistically from a plain HTTP client. On 2026-11-24:

```
GET https://annas-archive.gl/search?q=Rock+Paper+Scissors+Alice+Feeney  → 403, 902 bytes, <title>DDoS-Guard</title>
GET https://annas-archive.gl/md5/a1423442916f2f3def9517a3bf4dee48       → 403, 902 bytes, <title>DDoS-Guard</title>
GET https://annas-archive.gl/slow_download/<md5>/0/0                   → 403, 902 bytes, <title>DDoS-Guard</title>
```

Same on `annas-archive.pk` and `annas-archive.gd` (same 403 body). The homepage and FAQ return 200, so the block is path/JS-challenge-specific, not a total host block. **[verified]**

OpenlibExtended does scrape `/search` and `/md5/` HTML, but it runs a **real webview** to clear the challenge; its own code says plain-Dio cookie replay loops on 403 because DDoS-Guard clearance is bound to the browser TLS fingerprint. **[verified]** ([`ddos_protection_handler.dart` L1–L11](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/ddos_protection_handler.dart#L1-L11), [`webview_challenge_solver.dart`](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/webview_challenge_solver.dart))

Its Anna's URL builder, for reference (untested here because of the 403) is `GET /search?index=&sort=&lang=&display=&q=&content=&ext=&year=&page=` with author/publisher folded into `q` as `author:"…"`/`publisher:"…"` — [`annas_archive.dart` L128–L196](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/core/annas_archive.dart#L128-L196). **Do not build this for a Rust backend.** **[inferred]**

### 5.3 Recommendation for v1

**Do not integrate Anna's Archive in v1.** Reasons: (a) no search API; (b) search/detail/slow-download all DDoS-Guard 403 from a plain client; (c) the one stable API needs a paid membership key and only returns a download URL for a known md5; (d) OpenlibExtended needs a webview challenge solver, which is a large Android-specific subsystem and still not reliable. **[verified for a–d; inferred for the recommendation]**

Zero-cost fallback that *is* easy and honest: because Anna's and Libgen share md5s, a result row can offer **"Open on Anna's Archive"** as an external browser link (`https://annas-archive.gl/md5/<md5>`), or a manual search link (`https://annas-archive.gl/search?q=<title+author>`). Let the user's real browser handle the challenge. This costs one URL builder and no backend code. **[inferred]**

If the user later insists on in-app Anna's, the only workable design is a Tauri webview-based challenge/ download flow, with the same UX as OpenlibExtended. Treat it as a separate ticket, not a v1 fallback. **[inferred]**

---

## 5b. Prior art: the `libgen-rs` crate (0.1.0)

**What was evaluated:** the published crate tarball (`libgen-rs 0.1.0`, crates.io checksum `e62b787a42f8bddd1bb5ca050f24afef66c2c882ec5bb0d92d1236a847ed7dfe`, 148,702 bytes) and the source repository at HEAD `192d9429903c7f2782a86dd2294e70a7cc1371fd` (2024-03-04). Both were downloaded and read in full; the published crate was compiled and exercised against live mirrors. **[verified]**

### 5b.1 Release and maintenance status

| Fact | Value | Source |
|---|---|---|
| Crates.io versions | **exactly one: 0.1.0** | [crates.io API](https://crates.io/api/v1/crates/libgen-rs) |
| Published | **2022-08-23T15:13:06Z** | [crates.io version](https://crates.io/api/v1/crates/libgen-rs/0.1.0) |
| Downloads | 1,716 all-time; **7 recent** | same |
| Reverse dependencies | **0** | [reverse deps API](https://crates.io/api/v1/crates/libgen-rs/reverse_dependencies) |
| Repo | 43 stars, 10 forks, **1 open PR** | [GitHub API](https://api.github.com/repos/karasikq/libgen-rs) |
| Last push | **2024-03-04** (README only; code refactor same day) | GitHub API |
| Tags / releases | **0 tags, 0 GitHub releases** | local `git tag -l`; [releases API](https://api.github.com/repos/karasikq/libgen-rs/releases) |
| Open PR | #6 "ran `cargo update`", opened **2025-09-09, unmerged** | [PR #6](https://github.com/karasikq/libgen-rs/pull/6) |
| Archived? | No, but effectively dormant | GitHub API |
| Size / docs | **584 Rust code lines, 0 comment lines** (crates.io line counts); no README usage example (issue #5 asked for one) | crates.io API; [issue #5](https://github.com/karasikq/libgen-rs/issues/5) |
| Licence | **MIT text** in `LICENSE`, GitHub detects MIT; crates.io reports **"non-standard"** because `Cargo.toml` uses `license-file` instead of an SPDX `license` key | [`Cargo.toml.orig`](https://docs.rs/crate/libgen-rs/0.1.0/source/Cargo.toml.orig), [LICENSE](https://docs.rs/crate/libgen-rs/0.1.0/source/LICENSE) |

The important maintenance fact: **the published 0.1.0 is the 2022 single-crate code; the 2023–24 refactor (workspace split into `libgen-api` + `libgen-bin`, typed errors, concurrent JSON fetch) was never published.** A `cargo add libgen-rs` user gets the 2022 code. **[verified]** (crates.io has one version; HEAD layout differs).

### 5b.2 What 0.1.0 actually supports

| Area | 0.1.0 implementation | Assessment |
|---|---|---|
| **Search endpoint** | Builds `GET <SearchUrl>?req=…&lg_topic=libgen&res=25|50|100&open=0&view=simple&phrase=1&column=…` — the **classic `libgen.is` `search.php`** protocol. **[verified]** ([`search.rs` L41–L84](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/search.rs)) | Dead codebase. `libgen.is/.rs/.st` are unreachable and not on SLUM (see §1). |
| **Search fields** | `SearchOption`: `Default`, `Title`, `Author`, `Series`, `Publisher`, `Year`, `ISBN` (`column=identifier`), `Language`, `MD5`, `Tags`, `Extension`. **[verified]** ([`search.rs` L19–L31, L64–L76](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/search.rs)) | Broad on paper, but only for the classic server. No year range, no pagination/offset, no page parameter. The HEAD TODO admits both: "add offset support", "add sorting support" ([HEAD `search.rs` L76–L77](https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/search.rs#L76-L77)). |
| **HTML parsing** | **None.** It fetches the search page as bytes and regex-scans for `[A-Z0-9]{32}` to collect hashes. **[verified]** ([`search.rs` L12–L17, L90–L100](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/search.rs)) | Strictly worse than parsing the table: it discards title/author/size/extension and only works if the server renders **uppercase** md5s. Today's LG+ renders **lowercase** md5s. |
| **Metadata** | For every hash, a separate `json.php?ids=<hash>&fields=…` call, deserialising a **JSON array** into `Book`. Sequential in 0.1.0; HEAD runs up to 5 concurrently. **[verified]** ([`search.rs` L102–L139](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/search.rs); [HEAD `search.rs` L152–L204](https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/search.rs#L152-L204)) | N+1 requests per search: 25 extra HTTP requests. The HEAD comment says it "gets rate limited pretty quickly with 10 concurrent requests" ([L186](https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/search.rs#L186)). Our LG+ path gets exact metadata in **one** batched `json.php?object=f&ids=…` call. |
| **Mirror selection** | A JSON mirror list with separate search/download mirrors; `get_working_mirror` iterates and pings each `Host` until one responds. **[verified]** ([`mirrors.rs` L39–L118](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/mirrors.rs)) | List is stale: `libgen.is`, `libgen.rs`, `libgen.st`, `library.lol`, `libgen.lc`, `libgen.rocks`, `libgen.me` ([`mirrors.json`](https://docs.rs/crate/libgen-rs/0.1.0/source/resources/mirrors.json)). `library.lol` and `libgen.rocks` now serve a **US domain-seizure notice**; `libgen.lc` is parked. No SLUM, no latency/protection ordering. |
| **Failover** | Only the "pick first reachable" helper. Search and download each use the one mirror the caller selected; its own CLI asks the user to pick both mirrors manually, and there is **no automatic failover during a request**, no retry, no re-mint. **[verified]** ([`libgen_cli.rs` L30–L38, L123–L131](https://docs.rs/crate/libgen-rs/0.1.0/source/src/bin/cli/libgen_cli.rs)) | Not the failover the app needs. Worse, the helper **panics** on a dead mirror (below). |
| **Download resolution** | `GET <download_pattern with {md5}>`, then regex for `get.php?md5=\w{32}&key=\w{16}`; for `library.lol`/`libgen.me` it regexes IPFS/`62.182.86.140` URLs. Branches on **hardcoded host strings**: `libgen.rocks`, `libgen.lc`, `libgen.lol`, `libgen.me`. **[verified]** ([`download.rs` L47–L65, L68–L122](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/download.rs)) | **No `libgen.li/.bz/.vg/.la/.gl` support at all.** Adding a mirror to JSON does not add download support; the match falls through to `Err("Couldn't find download url")`. |
| **File retrieval** | Returns a raw `reqwest::Response`; the CLI streams it to a file, using `content_length().unwrap()` and writing the title as filename. **[verified]** ([`libgen_cli.rs` L176–L203](https://docs.rs/crate/libgen-rs/0.1.0/source/src/bin/cli/libgen_cli.rs)) | No resume, no Range, no content-length verification, no magic-byte sniff, no temp file. Filename is title-only, truncated by **byte slice** `[0..249]` (panics on a multi-byte UTF-8 boundary; the repo later added a commit "Fix panic if book title is too long"). |
| **Rate limiting** | **None** in 0.1.0. No delay, no jitter, no 429 handling, no concurrency cap. HEAD caps the JSON enrichment at 5 in flight, but that is a hardcoded concurrency limit, not a rate limiter. **[verified]** | Would hammer a mirror with N+1 requests per search. |
| **Async runtime** | `tokio` (`full`) + `reqwest 0.11`; library is async, CLI uses `#[tokio::main]`. **[verified]** | Fine, but `tokio full` and CLI crates are unconditional dependencies of the library. |
| **Error handling** | 0.1.0 returns `&'static str`; uses `unwrap`/`expect` on mirror JSON, mirror index, URL parsing, `content_length` (CLI), and `e.status()`; on a JSON parse failure it prints "Couldn't parse json" and skips the book. HEAD adds an `Error` enum but keeps many panics and a wrong variant mapping (`Error::mirror` returns `Download`). **[verified]** ([`mirrors.rs` L23–L29](https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/mirrors.rs); [HEAD `error.rs` L19–L21](https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/error.rs#L19-L21)) | Not production-grade for a mobile app; panics on the exact conditions (dead mirror, malformed config, missing length) the app must survive. |
| **TLS / Android** | `reqwest 0.11` with default features → **native-tls/OpenSSL**; `cargo check` pulls `openssl 0.10.41`. **[verified]** (local build) | Cross-compiling OpenSSL for Android is extra pain; PocketLibrary's plan uses rustls. |
| **Dependency weight** | 0.1.0's manifest puts `dialoguer`, `indicatif`, `console`, `dirs` in the **library's** dependencies, not a separate bin crate. **[verified]** ([`Cargo.toml.orig`](https://docs.rs/crate/libgen-rs/0.1.0/source/Cargo.toml.orig)) | Unnecessary UI/CLI crates compiled into an Android dependency graph. HEAD fixes this split, but HEAD isn't published. |

### 5b.3 Empirical tests against today's mirrors

These are not code-reading claims; each was run on 2026-11-24.

1. **Builds, but with OpenSSL.** `cargo check --all-targets` on the 0.1.0 crate with Rust 1.99 succeeded in 13 s and compiled `openssl v0.10.41`. **[verified]**
2. **Search returns 0 against live LG+.** Pointing `SearchUrl` at `https://libgen.li/index.php`, `Search { request: "Rock Paper Scissors Alice Feeney", results: 25, SearchOption::Default }` returned **`Ok(0)`**. The live page at the same URL contains **25 lowercase md5s** (`md5=a142…`), which the crate's `[A-Z0-9]{32}` regex cannot match. **[verified]**
3. **The JSON enrichment call is also incompatible.** `GET https://libgen.li/json.php?ids=a1423442916f2f3def9517a3bf4dee48&fields=…` returns `{"error":"No Request keys"}` (HTTP 200), not a JSON array. LG+ requires `object=f` and treats `ids` as file ids, not md5s. The crate would deserialise this as an array, fail, print "Couldn't parse json", and skip the book. **[verified]**
4. **Download cannot work on LG+.** `DownloadRequest` with a `libgen.li` mirror and a real `Book` returned **`Err("Couldn't find download url")`**: the host-match branch only knows `libgen.rocks`, `libgen.lc`, `libgen.lol`, `libgen.me`. **[verified]**
5. **Dead-mirror panic.** `Mirror::check_connection` against `http://127.0.0.1:1/` panicked at `mirrors.rs:27` (`called Option::unwrap() on a None value`) instead of returning `Err`; against `https://libgen.li/this-path-does-not-exist` it returned **`Ok(())`** despite a 404. So `get_working_mirror` both crashes on the first dead host and accepts an error page as "working". **[verified]**
6. **Its own live test hangs.** Repo HEAD `cargo test -p libgen-api search::tests::it_searches` was still running after 60 s and was killed at 90 s; it uses `Client::new()` (no timeout) against `libgen.is`, the first mirror. The offline mirror-parsing tests pass. **[verified]**
7. **HEAD compiles but is still classic-only.** `cargo check --workspace` at `192d942` succeeded (native-tls again); its `mirrors.json` still lists `libgen.is/.rs/.st`, `library.lol`, `libgen.lc`, `libgen.rocks`, `libgen.me`, and its download regexes are still `get.php?md5=…&key=…`/IPFS. **[verified]**

### 5b.4 API stability at 0.1.0

0.1.0 is a pre-1.0, single-release API, and the unpublished HEAD is **not source-compatible** with it:

- `MirrorList::parse_mirrors(&str)` (map-shaped JSON) → `MirrorList::from_json_str/from_json_file` (array-shaped JSON).
- `Search { mirror, request, results, search_option }` → `Search { query, max_results, search_option, search_url, json_search_url, cover_url }` plus a `SearchBuilder`.
- `Book` gains `descr`, `timeadded`, `timelastmodified`; `DownloadRequest` disappears; `Book::download` takes a `DownloadMirror`.
- Errors change from `&'static str` to a custom `enum Error`.

That is a full API/config break in an unpublished refactor, with no migration path and no semver release. Treat 0.1.0 as an abandoned snapshot, not a library with a stability contract. **[verified]** (diff of published tarball vs HEAD)

### 5b.5 Verdict

**Do not depend on `libgen-rs`, and do not vendor it as the acquisition layer.** It is not a better base than the hand-rolled client:

- It speaks the **wrong protocol** (classic `search.php`/`json.php`) for the only mirrors that are alive (LG+ `index.php` + 9-column table + `/ads.php` → `/get.php` → CDN). Empirically: `Ok(0)` search and `Err("Couldn't find download url")` on `libgen.li`.
- Its mirror list is stale and partly dead: `libgen.is/.rs/.st` (unreachable or unverified), `library.lol` and `libgen.rocks` (US domain-seizure notices), `libgen.lc` (parked), `libgen.me` (unverified frontend) — with no SLUM health and a failover helper that **panics** on a dead host.
- It has no built-in rate limiting, retries, or timeouts, no resume, no content validation, no format sniffing, native-tls/OpenSSL, and CLI-only crates in the library graph.
- It is a single 2022 release with 0 reverse dependencies and a 2024 refactor that was never published.

**What, if anything, to borrow:** the two-phase shape (search → hash list → metadata enrichment) is sound, but our version is better: parse the table once, then **batch** `json.php?object=f&ids=…`. The `get.php?md5=…&key=…` regex is already documented in §3.2. There is no parser worth copying — it has no HTML parser at all. If a future need arises for the classic Libgen codebase, the MIT-licensed regex/URL helpers are ~100 lines; attribute them and move on. **[inferred]**

---

## 5c. SLUM (`open-slum.org`) as a health signal

**What it is:** a public FlatMonitor deployment — a Python HTTP monitor that checks each domain once a minute, stores append-only CSV logs, and renders static HTML plus a `status.json` snapshot. The software is MIT and its source is [`BrianZbr/flatmonitor`](https://github.com/BrianZbr/flatmonitor). The README labels it **beta** and warns that "behavior, configuration, and output formats may change without notice" ([README L3](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/README.md#L3)). **[verified]**

### 5c.1 What it monitors and how fresh it is

`status.json` on 2026-11-24 12:27 UTC contained **6 service groups / 32 domains**: Anna's Archive (6: `.gl`, `.pk`, `.gd`, `software.`, two download partners), Library Genesis (5), Z-Library (7), Sci-Hub (6), Randombook (4: `libgen.pw`, `libgen.me`, `libgen.xyz`, `Randombook.org`), and "Other" (4: WeLib, FMHY, Liber3, Memory of the World). **[verified]** ([`status.json`](https://open-slum.org/status.json))

The Libgen group is exactly the live LG+ family — **no `libgen.is`, `.rs`, `.st`, `library.lol`, `libgen.lc`, or `libgen.rocks`**: **[verified]**

| Domain | Role in SLUM | Status at 12:27 UTC | Actual check | Protection |
|---|---|---|---|---|
| `libgen.bz` | core | **UP** | 200, 835 ms, content verified | none |
| `libgen.li` | supplementary | **UP** | 200, 891 ms, content verified | none |
| `libgen.vg` | supplementary | **UP** | 200, 1400 ms, content verified | none |
| `libgen.la` | supplementary | **PROTECTED** | 200, 785 ms, content not verified | Cloudflare |
| `libgen.gl` | supplementary | **PROTECTED** | 200, 995 ms, content not verified | Cloudflare |

The three UP rows expect **HTTP 200 + body contains `"Library Genesis"`** on the homepage; the two PROTECTED rows expect a Cloudflare response (`Protection OK if: Status 200 / Indicator cloudflare`) and skip the content check. This is visible in each card on [`libgen.html`](https://open-slum.org/libgen.html). **[verified]**

**Freshness / cadence:**

| Layer | Cadence | Observed |
|---|---|---|
| Per-domain HTTP check | every **60 s** (`interval_seconds` fixed at 60) | log lines ~57–63 s apart; [architecture.md L59](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/architecture.md#L59) |
| `status.json` rebuild | only when new data **and** `build_interval_seconds` elapsed | **~205 s between `generated_at` values** (12:27:24 → 12:30:50 → 12:34:15 UTC) |
| Snapshot age when fetched | — | at 12:32:46, `generated_at` was 12:30:50 (**116 s old**); `last_check` was 12:30:03 (**163 s old**) |
| Per-domain CSV log | written per check, copied to `public/logs/` on each build | at 12:35:53, last line was 12:33:19 (**154 s old**), `last-modified 12:34:45` |
| CDN caching | `status.json` `max-age=10`; logs `max-age=60` | Cloudflare `REVALIDATED` / `EXPIRED` observed |
| HTML auto-refresh | `<meta http-equiv="refresh" content="600">` | 10 min — irrelevant if we use `status.json` |

**Effective freshness is ~1–4 minutes**, not real-time. The status *value* is additionally a **5-minute bucket**, not the last raw check: 0 failures → UP, 1 failure → DEGRADED, 2+ → DOWN, with the current bucket updated after each check ([`aggregator.py` L215–L288](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/aggregator.py#L215-L288); [architecture.md L146–L150](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/architecture.md#L146-L150)). **[verified]**

The `coverage` field is **lifetime checks for that domain**, not freshness: every Libgen domain reports ~1,329 h and ~77,554 checks because they were deployed together and polled once a minute. Use `last_check.timestamp`, not `coverage`, to judge staleness. **[verified]**

### 5c.2 Machine-readable endpoints

**Yes — a JSON snapshot exists and is documented by the monitor project.** FlatMonitor writes `status.json` next to `index.html` "on each build… intended for external alerting" ([`docs/configuration.md` L136](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/configuration.md#L136)); the route is written by [`renderer.py` L194–L226](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/renderer.py#L194-L226). **[verified]**

```
GET https://open-slum.org/status.json
200 application/json, ~25 KB
cache-control: max-age=10, public
etag: "…"          # conditional GET returns 304
last-modified: …
```

Real shape (trimmed):

```json
{
  "generated_at": "2026-11-24T12:37:40.897705+00:00",
  "instance_label": "US-East-Primary",
  "sites": [
    {
      "id": "libgen",
      "name": "Library Genesis",
      "description": "",
      "health": "UP",
      "domains": [
        {
          "id": "libgen.li",
          "url": "https://libgen.li",
          "name": null,
          "description": null,
          "section": null,
          "role": "supplementary",
          "status": "UP",
          "display_status": "UP",
          "collecting": false,
          "coverage": {
            "hours": 1329.58,
            "checks": 77563,
            "first_seen": "2026-09-30T03:02:42.593972+00:00"
          },
          "last_check": {
            "timestamp": "2026-11-24T12:36:49.536033+00:00",
            "http_status": 200,
            "latency_ms": 634,
            "cert_expiry": "2027-02-08T03:52:58+00:00",
            "body_contains_pass": true,
            "protection_type": null
          }
        }
      ]
    }
  ]
}
```

Field notes:
- `status`: `UP | DOWN | DEGRADED | PROTECTED | TIMEOUT | UNKNOWN`.
- `display_status`: same, or `COLLECTING` when the domain has fewer than 3 checks.
- `health` (group): `UP | DEGRADED | DOWN | UNKNOWN`.
- `role` is a display hint (`core`/`supplementary`), **not** a health rank.
- `body_contains_pass`: `true`/`false` only when a content check is configured; `null` for PROTECTED domains.
- No `schema_version` key, no history in this file — it is a whole-world snapshot. **[verified]**

**Historical CSV logs** are also public and machine-readable, one file per domain:

```
https://open-slum.org/logs/libgen/li.log
https://open-slum.org/logs/archive/2026-11/libgen/li.log
```

Live file begins with a versioned header:

```csv
# version: 2
# schema: timestamp,site_id,domain_id,domain_status,http_status,latency_ms,failure_type,protection_type
timestamp,site_id,domain_id,domain_status,http_status,latency_ms,failure_type,protection_type
2026-11-24T12:33:19.180853+00:00,libgen,libgen.li,UP,200,636,,
```

Archive files omit the `#` metadata lines and start with the column header. `failure_type` values come from the monitor's enum (`timeout`, `connection_refused`, `dns_failure`, `ssl_error`, `http_error`, `content_mismatch`, `unexpected_redirect`, `latency_high`, `unknown`); `protection_type` may be `Cloudflare`, `DDoS-Guard`, `rate-limit`, or `connection-blocked`. **[verified]** (live and archive files fetched 2026-11-24)

**No RSS, no documented public REST API, no JSON history endpoint.** `/api`, `/api/status`, `/health`, `/metrics` all return 404; `/status.json` and the CSV logs are the only machine-readable outputs. There is no CORS header, but PocketLibrary calls it from Rust, so that is irrelevant. **[verified]**

### 5c.3 How reliable is it as a health signal?

**Good coverage, coarse semantics.**

Strengths:
- It covers **all five live LG+ mirrors** and correctly **does not** list the dead classic domains. Coverage is exactly the set we need. **[verified]**
- It distinguishes connection refusal/timeout from HTTP errors and from bot protection, and it exposes `http_status`, `latency_ms`, and `protection_type`, which is more than the HTML dashboard shows. **[verified]**
- It has an explicit guard against a seized/blocked domain hiding as forever-green: if a protection-declared domain has **no** UP and no real challenge in the 4-hour window, persistent `connection-blocked` PROTECTED is downgraded to DEGRADED ([`aggregator.py` L290–L311](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/aggregator.py#L290-L311)). **[verified]**
- It has been running since 2026-09-30 with ~1,329 h of coverage per domain, so it is not a brand-new fly-by-night checker. **[verified]**

Limits that matter for PocketLibrary:

1. **Homepage-only.** The check for `.li/.bz/.vg` is `GET https://<host>/` expecting `"Library Genesis"`. It never calls `index.php?req=…`, `ads.php`, `get.php`, or the CDN. A mirror can be **UP** while search or downloads are broken. We saw exactly that class of failure ourselves: a transient CDN `503` that SLUM cannot see. **[verified]**
2. **`PROTECTED` is green, but not proof of usability.** Cloudflare/DDoS-Guard headers on any 200/403/429/503 response classify a domain as PROTECTED and **skip the content check** ([`runner.py` L136–L200](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/runner.py#L136-L200); [architecture.md L84](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/architecture.md#L84)). `.la` and `.gl` will therefore show PROTECTED even when the challenge is passable (our client did search and download through both) and also when it blocks users. It means "a bot-protection response came back", not "the site works".
3. **One vantage point.** `instance_label` was `US-East-Primary`; all checks originate there. A mirror blocked from that IP or slow on that route may be fine from the user's phone, and vice versa. Do not treat `DOWN` as globally down. **[verified]**
4. **One failed check makes it yellow for 5 minutes.** A single transient `connection_refused` yields DEGRADED; two yield DOWN. `libgen.vg` went `DOWN` at 11:56:25 and answered again at 11:57 — the dashboard would show DEGRADED for the rest of that bucket. This is useful noise-damping, but it is **not** a per-request verdict. **[verified]**
5. **Latency is informational.** With `body_contains` configured, a 3.7 s response is still UP; the 3 s latency-degradation rule applies only when no content check is configured ([`docs/configuration.md` L140–L145](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/configuration.md#L140-L145)). Do not use SLUM latency as a hard cutoff; it is a US-East measurement.
6. **Beta output format.** The project explicitly warns that output formats may change; `status.json` has no `schema_version`. Parse defensively: require `generated_at` and `sites`, tolerate unknown fields, and fall back to a compiled list on any parse error. **[verified]**

**Verdict:** SLUM is a **good discovery and coarse triage signal**, not an authoritative availability oracle. It is roughly 1–4 minutes stale, homepage-only, single-vantage, and deliberately conservative about protection. It should inform order and skip decisions, never gate them.

### 5c.4 How PocketLibrary should use it

**Use it, but as a hint — not as the sole mirror source and not as a gate.**

1. **Compile-time bootstrap list.** Ship `[libgen.li, libgen.bz, libgen.vg, libgen.la, libgen.gl]` in the binary. This is the one list that must work when SLUM is down, blocked, or changed. Do **not** copy OpenlibExtended's "SLUM is the only place mirror URLs come from" rule ([`slum_catalogue.dart` L20–L31](https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/slum_catalogue.dart#L20-L31)); it is tidy but leaves a cold start with no mirrors. **[inferred]**
2. **Startup refresh, non-blocking.** Load the last cached `status.json` from disk immediately; fire one async `GET https://open-slum.org/status.json` with 3 s connect / 8 s total timeout, browser-like UA, `If-None-Match` from the cached ETag. Search must not wait for it. **[inferred]**
3. **Refresh cadence: 10 minutes.** Upstream rebuilds every ~3.5 min and the file is ~25 KB; 10 min is plenty and stays well inside any polite-use expectation. Only refresh while the acquisition screen is active or immediately before a search session. Back off to 30 min on 429/5xx; keep the last good copy for at least 24 h offline. **[inferred]**
4. **Derive candidates from `sites[id=libgen].domains`:**
   - Ignore `collecting: true` and any `last_check.timestamp` older than 15 min (stale snapshot).
   - **Tier 0:** `status == "UP"` and `body_contains_pass == true` and `protection_type == null` → `.li`, `.bz`, `.vg`.
   - **Tier 1:** `status == "UP"` or `"PROTECTED"` with no content verification → `.la`, `.gl` (usable, but challenge risk).
   - **Tier 2:** `DEGRADED` → try after tier 1, not instead of it.
   - **Tier 3:** `DOWN`/`TIMEOUT` → normally skip; if every tier 0–2 has failed in this session, probe the least-recently-failed one once.
   - Within a tier, prefer **local success history on this device** (last success, success rate/EWMA) over SLUM latency, then SLUM `latency_ms`, then static order `.li → .bz → .vg → .la → .gl`. Do **not** put a PROTECTED `.la`/`.gl` ahead of an UP `.li`/`.bz`/`.vg`.
5. **Do not treat `PROTECTED` as down.** For `.la`/`.gl`, PROTECTED is the normal state; try them last, not never. The client's own search request is the real test. **[verified]**
6. **Per-request local truth.** After picking a mirror, run the real search/`ads.php` probe. On timeout, 5xx, challenge page, or parse failure, record a local failure, move to the next candidate, and re-rank for the session. Do not re-fetch SLUM on every failure; one refresh per 10 min is enough. This local signal is what catches a homepage-UP/download-broken mirror. **[inferred]**
7. **Cache shape.** Persist `{fetched_at, etag, generated_at, domains: {id, status, protection, latency, last_check}}` plus `{host: last_success_at, success_ewma}`. TTL 10 min for SLUM; local success history 7–30 days. Serve stale-while-revalidate: show results immediately from the old snapshot, update in the background.
8. **Diagnostics, not decoration.** In a "Sources" or "Downloads" settings pane, show per-mirror `display_status`, `last_check.timestamp`, `latency_ms`, `protection_type`, and the `generated_at` of the snapshot. A "refresh health" button can force `status.json`. Do not show `DEGRADED` as an error; it usually means one transient check failed.
9. **Do not parse the HTML pages** for runtime health. `status.json` is smaller, structured, versioned by ETag, and is the project's intended external-alerting output. The HTML is for humans and adds nothing. Use the CSV logs only for a support/diagnostics export, not for runtime decisions — the live file is ~67 KB/domain, the monthly archive ~2 MB/domain, and it lags ~2–3 min. **[verified/inferred]**
10. **If schedule is tight, SLUM can be deferred.** A v1 with the compiled five-host list and per-request failover already meets the map's "automatic mirror failover" requirement. Adding `status.json` is a ~100-line enhancement: fetch, cache, tier, blend with local history. Do it after the search/download path works, not before. **[inferred]**

**Concrete order today (12:27 UTC snapshot):** `.li` (UP, verified) → `.bz` (UP, verified) → `.vg` (UP, verified, slower/flakier) → `.la` (PROTECTED Cloudflare) → `.gl` (PROTECTED Cloudflare). If sorting purely by SLUM latency within the UP tier, `.bz` (835 ms) edges `.li` (891 ms); either is defensible, but keep all three unprotected hosts ahead of the two Cloudflare ones. **[verified]**

---

## 5d. GitHub client survey (source review, 2026-11-24)

Four clients were cloned and read in full. The short answer up front: **none is a better complete reference than the live-tested LG+ plan, and none should be added as a crate.** Two are useful to **port specific approaches from**: `obsfx/libgen-downloader` for failure classification, per-mirror health/cooldown, and recovery waits; `Houdiee/Libgen-TUI` for mirror racing/discovery, `.part` atomic writes, and a clean rustls client. `waltz/libgenie` contributes two small parser heuristics. `mattrighetti/libgen-bot-rs` is dead, unlicensed, and does not download files.

### 5d.1 Comparison

| Project | Lang / licence | Maintenance | Mirrors / endpoints | Search & filters | Download / failover | Worth copying |
|---|---|---|---|---|---|---|
| [`obsfx/libgen-downloader`](https://github.com/obsfx/libgen-downloader) | TypeScript / **WTFPL** | **Active**: v3.4.0 2026-10-07; 472★, 64 forks, 28 open issues; 7.6k LOC; live E2E tests | 5 LG+ (`li, vg, gl, bz, la`) from a remote config; 4 SPA download mirrors (`randombook.org`, `libgen.pw`, `libgen.me`, `libgen.xyz`) | `/index.php?req=&page=&res=25`; **advanced filters dropped in v3.0**; parses `#tablelibgen` with header map + self-healing selectors | `ads.php` → `get.php`; multi-source failover with retries; health registry/cooldown; content-disposition/HTML detection; **no Range/resume, no magic bytes** | **Yes — health/backoff/recovery and failure taxonomy** (port concepts) |
| [`Houdiee/Libgen-TUI`](https://github.com/Houdiee/Libgen-TUI) | Rust / **MIT** | Young: v0.1.0 2026-09-26; last commit 2026-10-17; 17★, 0 open issues; 1.6k LOC; live pipeline test | Built-ins `li, la, bz, gl, vg`; **discovers sibling `libgen.*` links** and races them; `/index.php?req=&res=`; `/ads.php?md5=` | No pagination, no advanced filters; parses `table#tablelibgen tbody tr` with header map | `ads.php` → `get.php`; failover only on link resolution, not on file failure; `.part` + rename; rejects `text/html`; no Range/retry | **Yes — mirror race/discovery, `.part`, rustls timeouts** |
| [`waltz/libgenie`](https://github.com/waltz/libgenie) | Rust / **MIT** | Unproven: single-day project 2026-08-09, 0★, no releases, no tests | Defaults mix live and dead: `li, vg, gs, is, st, rs, library.lol`; configurable templates; `index.php?req=&res=&curtab=f` + classic `search.php` | No pagination/filters; **generic biggest-table + header-keyword parser** | Per-result link failover; one HTML hop with **anchor scoring**; 300 s timeout; content-disposition filename; no retries/resume | **Yes — generic table/header mapping and link scoring** (small) |
| [`mattrighetti/libgen-bot-rs`](https://github.com/mattrighetti/libgen-bot-rs) | Rust / **no licence** | Stale: v0.3.3 2025-01-02; 27★; targets `libgen.is` only | `https://libgen.is/search.php` + `json.php`; `get.php?md5=` link only | Classic `column=def/title/author/identifier`; `res=25`; no pagination | **No file downloading**; sends a `get.php` URL to Telegram | Almost nothing; the batch `json.php?ids=` idea (we already do better) |

### 5d.2 `obsfx/libgen-downloader` — the best resilience reference

It is the only surveyed project with production-shaped failure handling. Its v3.4.0 release notes (and code) confirm the LG+ migration and multi-mirror downloads.

- **Mirrors / endpoints.** Remote config at `https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json` lists exactly our five LG+ mirrors plus four "libgen-spa" download mirrors. It fetches this at startup, filters unsupported types, and falls back to its bundled list ([`remote-config.ts` L25–L84](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/data/remote-config.ts#L25-L84); [config.v3.json](https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json)). **[verified]**
- **Search.** `GET /index.php?req=<query>&page=<n>&res=25` — only these three params. v3.0 **dropped the search-by filters** because LG+ did not support them ([README v3.0.0](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/README.md); [`libgen-plus-adapter.ts` L120–L131](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/adapters/libgen-plus-adapter.ts#L120-L131)). This matches our live test: the UI filters are gone, and `columns[]` is the only field-scoping that works.
- **Parsing.** `#tablelibgen`; 9-column default map; header-text mapping when headers exist; title excludes `<nobr>` noise; authors split on `;`; md5 from the same-host `md5=` link, falling back to the first href ([`libgen-plus-adapter.ts` L34–L113](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/adapters/libgen-plus-adapter.ts#L34-L113); [`parsing.ts` L3–L68](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/adapters/utils/parsing.ts#L3-L68)). If the table or link selector breaks, it can learn a new selector and uses an embedded cross-encoder as a last resort — impressive, but far too heavy for PocketLibrary.
- **Download.** For each source: GET `ads.php?md5=`, then resolve the `get.php` link; the shared `followToFile` treats a response with `content-disposition` as the file, a `text/*` 200 as an interstitial to resolve, and anything else by status ([`download-source.ts` L14–L36](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/download/download-source.ts#L14-L36)). This "content-disposition means file" heuristic is worth copying as a fast path. It does **not** resume, check content-length, or sniff magic bytes.
- **Failover / retries / health.** `DownloadService` iterates sources in health order, retries each source twice, records success/failure, and skips sources in cooldown ([`download-service.ts` L15–L53](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/download/download-service.ts#L15-L53)). `MirrorHealthRegistry` has `healthy | cooling-down | trial`, exponential backoff with jitter, and resets on success ([`mirror-health-registry.ts` L32–L66](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/availability/mirror-health-registry.ts#L32-L66)). Policy: **15 s initial, ×2, 300 s cap, 20% jitter**; 5 request attempts, 2 s apart, 10 s timeout; 2 download attempts per source, 30 s source timeout; **90 s max wait per book**, 30 min max recovery in CLI ([`settings.ts` L12–L34](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/settings.ts#L12-L34)).
- **Failure taxonomy.** It distinguishes `backend-overloaded` (page text "could not connect to the database", "max_user_connections", etc.), `rate-limited` (429), `server-error` (5xx), `unreachable` (network), and `not-available` (do not retry) ([`failures.ts` L23–L82](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/availability/utils/failures.ts#L23-L82)). This is directly applicable: LG+ does return DB-overload pages during outages, and treating them as "book missing" wastes failover slots.
- **Recovery.** A shared waiter probes actual search/download health checks on a backoff schedule and resumes all queued work when a mirror recovers ([`shared-recovery-wait.ts` L54–L123](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/src/api/availability/shared-recovery-wait.ts#L54-L123)). The UX idea (show "waiting for Libgen", auto-resume, allow "check now") is good; the 30-minute CLI wait is not appropriate for a mobile app without a visible cancel.
- **Tests.** Real E2E suite asserts ≥90% search success, ≥90% md5 coverage, ≥90% chain delivery, ≥80% download signature match across 12 queries and sampled books ([`search-download.live.ts` L8–L20, L80–L135](https://github.com/obsfx/libgen-downloader/blob/f5b05984003d7ec440ac40e5606d0b3184c5226f/test/e2e/search-download.live.ts#L8-L20)). This is a better test shape than "the page parsed once."
- **Licence.** WTFPL — permissive, no attribution required. **[verified]**

**Do not port:** the learned-selector/TinyBERT/ONNX machinery, the four SPA mirrors (different API, unneeded for v1), or the filename-from-content-disposition-last-128-chars trick (it can cut the title in half; we want our own naming).

### 5d.3 `Houdiee/Libgen-TUI` — closest Rust LG+ implementation

- **Mirrors.** Built-ins `libgen.li, .la, .bz, .gl, .vg` ([`config.rs` L7–L12](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/app/config.rs#L7-L12)). On startup it **races all mirrors in parallel**, accepts only a 2xx whose body contains `input[name="req"]` (so parked/placeholder pages are rejected), then scrapes sibling `https://libgen.*` anchors from that page and merges them into the session list ([`mirror.rs` L13–L118](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/libgen/mirror.rs#L13-L118)). This is a good **fallback discovery** mechanism if SLUM and the compiled list both fail; it is not a replacement for SLUM (it only sees siblings a mirror advertises, and it may pick up dead `libgen.rs`).
- **Search.** `GET /index.php?req=<encoded>&res=<25|50|100>` — **no page param**, no filters ([`search.rs` L198–L225](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/libgen/search.rs#L198-L225)). It requires `table#tablelibgen` or returns an error, which conflates "no results" with "mirror broken" (a flaw: a genuine zero-result query will cycle every mirror).
- **Parsing.** `table#tablelibgen tbody tr`; header keyword mapping with 9-column fallback; strips `<i>` noise; md5 from `a[href*=md5=]`; file id from `file.php?id=`; rows without md5 are dropped ([`search.rs` L70–L183](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/libgen/search.rs#L70-L183)). Good, essentially our parser.
- **Download.** Resolves `ads.php?md5=` → `a[href*=get.php]` → absolute URL; tries mirrors in preference order for link resolution; then streams to `.part` and renames on success; rejects `text/html` ([`download.rs` L35–L81, L133–L168](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/libgen/download.rs#L35-L81)). **No retry or failover after the file transfer starts**, no Range/resume, no magic-byte check. Its `Client` is a good Android template: reqwest 0.12, **rustls-tls**, 15 s connect, 30 s read, 30 s page timeout, no total download timeout ([`mod.rs` L11–L23](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/src/libgen/mod.rs#L11-L23); [`Cargo.toml` L18](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/Cargo.toml#L18)). This matches our recommendation almost exactly.
- **Tests.** One live pipeline test: mirror discovery, search, column-population checks, and an actual >25 MB download with partial-file cleanup assertions ([`pipeline.rs` L4–L120](https://github.com/Houdiee/Libgen-TUI/blob/e92cbd6187d84c1d52a1f9da9a26ca394e072076/tests/pipeline.rs#L4-L120)). It is useful as a test *shape*; it is network-flaky by nature.
- **Licence / status.** MIT; v0.1.0, young project, 17 stars, single maintainer. **[verified]**

### 5d.4 `waltz/libgenie` — good parser heuristics, unproven project

- **Mirrors.** Default list mixes live and dead/seized: `libgen.li, .vg, .gs, .is, .st, .rs, library.lol`; `libgen.gs` is NXDOMAIN here, `library.lol` is a seizure page ([`config.rs` L112–L159](https://github.com/waltz/libgenie/blob/d9e86a7b29e0f52e9bfeddafb4806117b11c1def/src/config.rs#L112-L159)). Its `search_path` for LG+ is `/index.php?req={query}&res={limit}&curtab=f`; `curtab=f` made no difference to the live result set in our test (same 25 md5s as without), so treat it as cosmetic. **[verified]**
- **Search.** `req` + `res` only; no pagination/filters ([`search.rs` L7–L44](https://github.com/waltz/libgenie/blob/d9e86a7b29e0f52e9bfeddafb4806117b11c1def/src/search.rs#L7-L44)). It treats empty results as mirror failure and tries the next, then reports "all mirrors failed" — wrong for a genuine no-result query.
- **Parsing.** The best generic parser of the four: `table#tablelibgen`, else the largest `<table>` with ≥2 `<td>` rows; headers mapped by keyword (`title/author/publisher/year/language/pages/size/ext/mirror`) with a 9-column fallback; prefers `<b>` text for title; collects all mirror links ([`scrape.rs` L27–L171](https://github.com/waltz/libgenie/blob/d9e86a7b29e0f52e9bfeddafb4806117b11c1def/src/scrape.rs#L27-L171)). This is a cheap robustness upgrade over a hardcoded column map.
- **Download.** Iterates every mirror link for a result; if the response is HTML, one hop to the highest-scoring anchor (`get.php` +4, "get"/"download" +3, extension match +5, etc.); rejects a second HTML page; 300 s total timeout; deletes partial output on error but does **not** use `.part`/rename ([`downloader.rs` L29–L163](https://github.com/waltz/libgenie/blob/d9e86a7b29e0f52e9bfeddafb4806117b11c1def/src/downloader.rs#L29-L163)). Anchor scoring is worth copying as a fallback if the known `get.php` selector breaks.
- **Filename.** Parses both `filename=` and RFC 5987 `filename*=` with percent-decoding, sanitizes illegal chars, caps at 150 chars, appends ` (n)` on collision ([`downloader.rs` L166–L242](https://github.com/waltz/libgenie/blob/d9e86a7b29e0f52e9bfeddafb4806117b11c1def/src/downloader.rs#L166-L242)). Better than most; close to our naming rule.
- **Licence / status.** MIT, but created and abandoned in one day (2026-08-09), 0 stars, no releases, **no automated tests** (README says so). It compiles with Rust 1.99; that is the extent of its validation. Not a reference for reliability.

### 5d.5 `mattrighetti/libgen-bot-rs` — no longer relevant

- Hardcodes `https://libgen.is/search.php` and `https://libgen.is/json.php` ([`libgen.rs` L13–L14](https://github.com/mattrighetti/libgen-bot-rs/blob/e794148e91862a5fbcc32d8817cf34d92e91346b/src/libgen.rs#L13-L14)). `libgen.is` is unreachable and not on SLUM; every request will fail or hang (5 s timeout).
- Search: classic `req` + `column=def|title|author|identifier`, `res=25`, `open=0`; no pagination/filters beyond column ([`search.rs` L10–L29](https://github.com/mattrighetti/libgen-bot-rs/blob/e794148e91862a5fbcc32d8817cf34d92e91346b/src/libgen/types/search.rs#L10-L29)). It parses `valign=top` cells for IDs, then batch-fetches `json.php?fields=…&ids=…` into `Vec<Book>` ([`libgen.rs` L31–L75](https://github.com/mattrighetti/libgen-bot-rs/blob/e794148e91862a5fbcc32d8817cf34d92e91346b/src/libgen.rs#L31-L75)). The batch enrichment idea is sound — and we already do it more safely with `object=f&ids=…` on LG+.
- **No download implementation.** It only builds `http://libgen.is/get.php?md5=<md5>` and sends that URL to the user ([`book.rs` L33–L35](https://github.com/mattrighetti/libgen-bot-rs/blob/e794148e91862a5fbcc32d8817cf34d92e91346b/src/libgen/types/book.rs#L33-L35); [`handler.rs` L69](https://github.com/mattrighetti/libgen-bot-rs/blob/e794148e91862a5fbcc32d8817cf34d92e91346b/src/handler.rs#L69)).
- **No licence file** and no `license` field; GitHub reports `null`. That means **all rights reserved** by default — do not copy code. Last release 2025-01-02; not maintained. **[verified]**

### 5d.6 Verdict and exact changes to our plan

**Keep the hand-rolled LG+ client. Reuse no crate.** `obsfx` is a TypeScript app, `Houdiee`/`waltz` are binaries (not published libraries), and `mattrighetti` is unlicensed and dead. None is a better complete reference than the live-tested plan: all four lack at least two of {pagination, working advanced filters, retry-on-file-failure, Range/resume, magic-byte validation}; two of the four include the dead classic `libgen.is`/`search.php` family in their defaults (one exclusively), and only `Houdiee` and `obsfx` are genuinely LG+-first.

**Port these specific ideas:**

1. **Health/backoff registry (from obsfx).** Per-host `healthy | cooling-down | trial`; 2 consecutive transient failures → cooldown `min(15 s × 2^(n-2), 300 s)` with 20% jitter; any success resets. Order `trial → healthy → cooling-down`; never let a cooling-down host block the queue. This is a small state machine (~100 lines) and is better than our "prefer local success history" sketch.
2. **Failure taxonomy (from obsfx).** Classify: `not-available` (404/“not found”, do not retry), `backend-overloaded` (DB text), `rate-limited` (429), `server-error` (5xx), `unreachable` (network/timeout). Retry only the last four; fail over immediately on `not-available`.
3. **Recovery wait (from obsfx).** When every candidate fails, stop hammering; show "waiting for a mirror", probe one health check on an exponential schedule (15 s → 5 min), auto-resume the queued search/download, and allow a visible cancel/"check now". Cap the mobile wait at ~2–3 min per user action, not 30 min.
4. **Per-source retry budget (from obsfx).** 2 attempts per source, 30 s per download open, ~90 s to obtain a stream before moving on. Once bytes are flowing, use a read-idle timeout (not a total cap) so a slow 100 MB file keeps streaming instead of being killed.
5. **Content-disposition fast path + HTML rejection (from obsfx/Houdiee/waltz).** After `get.php`, if the response has `content-disposition`, it is the file; if `text/html`, resolve the interstitial; otherwise treat as error. Keep our magic-byte + content-length checks as the final gate — none of the surveyed apps do that.
6. **`.part` + rename (from Houdiee).** Never write the final path until the transfer completes; delete the partial on error. We already planned a temp file; make it explicitly `.part` next to the destination and rename atomically.
7. **Generic header mapping (from Houdiee/waltz/obsfx).** Keep `#tablelibgen` + 9-column default, but map columns from `<thead>` keywords when present, and fall back to the largest data table + keyword map. This protects against column reordering and minor markup drift without the TinyBERT machinery.
8. **Anchor scoring fallback (from waltz).** If the known `#main > tr:first-child > td:nth-child(2) > a` / `a[href*=get.php]` selector finds nothing, score anchors by `get.php` (+4), "get"/"download" text (+3), "download" in href (+2), expected extension (+5) and follow the best. Fail loudly if nothing scores.
9. **Mirror race + sibling discovery as a fallback (from Houdiee).** Only when SLUM `status.json` is unavailable and the compiled five hosts all fail: probe the five in parallel with a 5 s deadline, accept only 2xx + `input[name="req"]`, then parse sibling `https://libgen.*` anchors and validate them the same way. Do not replace SLUM; use this as a last resort.
10. **Live smoke test shape (from obsfx).** Add a `#[ignore]` integration test that searches several queries, asserts ≥90% of entries have a 32-hex md5, downloads a sampled EPUB/PDF, and verifies the magic bytes; run it manually before releases. This catches parser drift better than a fixture-only test.

**Do not change:** the endpoint model (`/index.php`, `/ads.php`, `/get.php`, `json.php`), the use of `columns[]` for field-scoped search (none of the four implements it on LG+, but we live-tested it), Range-resume downloads, or `status.json` as a 10-minute hint.

**If one project deserves a second read:** `obsfx/libgen-downloader` for its health/recovery state machine and E2E test thresholds. It is the only one that treats "Libgen is down" as a first-class UX state rather than an error dialog. But it is not a code base to fork into Android, and its LG+ search is *less* capable than ours because it dropped field filtering.

---

## 6. File types, sizes, naming

### 6.1 Identifying format

Do **not** trust the extension alone; the CDN serves `application/octet-stream` for everything. Read the first bytes: **[verified]**

| Format | Check | Observed |
|---|---|---|
| PDF | first 5 bytes `%PDF-` | `%PDF-1.4`, 267 pages, 2,941,616 bytes |
| EPUB | ZIP local header `PK\x03\x04`, then ZIP entry `mimetype` = `application/epub+zip` | `mimetype` exactly `application/epub+zip`; OPF at `content.opf` |
| Anything else | reject/quarantine; do not ingest | — |

The search row's `cell[7]` extension and `json.php`'s `extension` are useful hints, but the final verdict must be magic bytes + EPUB mimetype. **[inferred from verified formats]**

Sizes: search row size is rounded (`3 MB`); `json.php`'s `filesize` is exact bytes as a string (`"3630176"`). `content-length` from the CDN is authoritative. **[verified]**

### 6.2 Filenames

The CDN's `content-disposition` gives a verbose, collision-resistant name:

```
Rock Paper Scissors{Alice Feeney}(2021, HarperCollins Publishers){98756682} libgen.li.epub
```

`json.php`'s `locator` gives the uploader's name:

```
Alice Feeney - Rock Paper Scissors (2021, Flatiron Books).epub
```

**[verified]**

Sensible local name (what the shelf/library should use):

```
Alice Feeney - Rock Paper Scissors (2021).epub
```

Rules: `[Author] - [Title] ([Year]).[ext]`, strip `/\:*?"<>|` and control chars, collapse whitespace, cap the base name at ~120 UTF-8 bytes preserving the extension, append ` (2)`, ` (3)` on collision. Prefer the sniffed format's extension over the server's. **[inferred]**

---

## 7. Failure modes to design for

| Failure | What actually happens | Client behaviour |
|---|---|---|
| Dead / refusing mirror | `vg` went `DOWN` for one minute; `.is`/`.rs` TCP timeout | Never hardcode one host; probe next mirror; 10 s connect timeout |
| Cloudflare / DDoS challenge | `.la`/`.gl` "PROTECTED"; Anna's 403 DDoS-Guard | Detect `<title>`/`cf-mitigated`, fail over to unprotected tier; do not parse challenge as results |
| Search returns 0 | Could be genuine no-match, or a broken mirror/index | Parse the total badge; if total > 0 but rows empty, retry another mirror. If total = 0 on two mirrors, return no results |
| Missing file | `ads.php` 200 with "not found", no get link; `get.php` **500** for bogus md5 | Treat as `NotFound`, not a network error; don't retry endlessly |
| Stale/invalid key | `get.php` 307 back to `/ads.php` | Re-fetch ads, mint new key, retry once; then fail over |
| CDN 503 / transient 500 | Seen once each on `.gl`/`.li`; retry succeeded | Retry same URL with jitter (2 attempts), then re-resolve via another mirror |
| Short/truncated body | HTTP/2 stream error at 522,296 of 3,630,176 bytes | Validate `content-length`; never ingest partial; resume with `Range` or restart with HTTP/1.1 |
| Wrong format | Server extension says `pdf`, file is something else (or vice versa) | Magic-byte sniff; reject and surface "wrong format" |
| Slow download | ~178 KB/s observed; 3.6 MB took 20 s | Stream to temp file, progress UI, idle-read timeout 30–60 s (not total timeout), cancel/retry |
| Duplicates | Same work appears as 7 EPUBs, multiple PDFs, multiple uploaders; same md5 across mirrors | Dedupe by md5 first; then by normalised `(title, author, format, size±5%)`; rank by format/year/seeders-like heuristics |
| Wrong edition | Empty years; "UK", "retail", "Flatiron", 5-page PDF excerpts | Show publisher/year/pages/size, let user pick; prefer full-length records (row pages > 20, or size > 200 KB when pages is 0) |
| Ads page markup change | Parser breaks silently | Fail loudly with a "mirror format changed" error; keep a fixture test with a captured page |

---

## 8. Acceptance test — "Rock Paper Scissors" by Alice Feeney

**Performed 2026-11-24 11:33–11:43 UTC against `libgen.li`.**

### Step 1 — search

```http
GET https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25
```

Response `200`, 80,261 bytes, `text/html`. Total badge: **Files 43**. 25 rows on page 1, 18 on page 2, no overlap. **[verified]**

Selected EPUB rows (out of 7 EPUBs):

| Title cell | Author | Publisher | Year | Lang | Pages | Size | Ext | md5 | file id |
|---|---|---|---|---|---|---|---|---|---|
| Alice Feeney - Rock Paper Scissors (UK) (epub) | Alice Feeney | HarperCollins | 2021 | English | 0 | 4 MB (4,162,450 B) | epub | `ac29ed3de1b1d2ae3bc931e71e1dd3d5` | 96692128 |
| **Alice Feeney - Rock Paper Scissors (2021, Flatiron Books)** | Alice Feeney | HarperCollins | 2021 | English | 106 | 3 MB (**3,630,176 B**) | epub | **`a1423442916f2f3def9517a3bf4dee48`** | **98756682** |
| Alice Feeney - Rock Paper Scissors (2021, HarperCollins) | Alice Feeney | HarperCollins | 2021 | English | 105 | 4 MB | epub | `8af476ee50480eaa5eb7db40f9edb742` | 98777542 |
| Feeney, Alice - Rock Paper Scissors (2021, HarperCollins) | Alice Feeney | HarperCollins | 2021 | English | 87 | 783 kB | epub | `b22d21ad5e55cbcb4619dcba2865bfeb` | 98946090 |

The Flatiron EPUB was chosen as the acceptance file (complete-length row: 106 pages in the search table, exact size from `json.php`). Note `json.php` reports `"pages":"0"` for this same file while the row says 106, so **pages is unreliable — use it only as a weak signal**. **[verified]**

Exact metadata from `json.php?object=f&ids=98756682`:

```json
{"md5":"a1423442916f2f3def9517a3bf4dee48","filesize":"3630176","extension":"epub",
 "locator":"Alice Feeney - Rock Paper Scissors (2021, Flatiron Books).epub",
 "broken":"","libgen_topic":"f"}
```

### Step 2 — ads page

```http
GET https://libgen.li/ads.php?md5=a1423442916f2f3def9517a3bf4dee48
```

`200`, 20,219 bytes. One download anchor:

```html
<a href="get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3"><h2>GET</h2></a>
```

### Step 3 — mirror get.php

```http
GET https://libgen.li/get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3
```

```http
HTTP/1.1 307 Temporary Redirect
Location: https://cdn3.booksdl.lc/get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3
```

### Step 4 — CDN

```http
GET https://cdn3.booksdl.lc/get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3
```

```http
HTTP/2 200
content-type: application/octet-stream
content-length: 3630176
content-disposition: attachment; filename="Rock Paper Scissors{Alice Feeney}(2021, HarperCollins Publishers){98756682} libgen.li.epub"
```

Downloaded bytes verified:

```
file: EPUB document
mimetype entry: application/epub+zip
content.opf: dc:title "Rock Paper Scissors"; dc:creator "Alice Feeney";
             dc:language "en"; dc:publisher "HarperCollins Publishers"; dc:date 2021-08-15
size: 3,630,176 bytes exactly (HTTP/1.1; 20.4 s)
```

**[verified]**

A PDF counterpart exists for the same work: md5 `0541b9335749ea12eca941ff535aff53`, 2,941,616 bytes, 267 pages, `%PDF-1.4`, filename `Rock Paper Scissors{Alice Feeney}(Flatiron Books){101939413} libgen.li.pdf`. **[verified]**

**If mirrors were unreachable:** they were not, from this box. If they are from the phone/network, the fallback evidence is (a) SLUM's status/logs, (b) the captured request/response above, (c) OpenlibExtended's parser and comments. Do not invent a JSON search endpoint.

---

## 9. Recommended Rust client strategy

### 9.1 Crate setup

```toml
reqwest = { version = "0.12", default-features = false,
            features = ["rustls-tls", "gzip", "brotli", "stream"] }
tokio = { version = "1", features = ["time", "fs", "io-util", "macros"] }
scraper = "0.20"      # or tl; CSS selectors for #tablelibgen
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- `rustls-tls` avoids an OpenSSL/cross-compile dependency on Android. Cloudflare accepted rustls-compatible TLS in our Curl tests; a TLS-fingerprint-sensitive host (Anna's) would still block, but Libgen does not. **[inferred]**
- Two clients:
  - **search client**: HTTP/2, connect timeout 10 s, total request timeout 20 s.
  - **download client**: **HTTP/1.1** (`.http1_only()`), connect 15 s, read/idle timeout 60 s, no total timeout (or 10 min cap), redirect policy manual for `get.php`.
- `.user_agent("Mozilla/5.0 … Chrome/125.0 Safari/537.36")`, `Accept` and `Accept-Language` as browsers send.
- No cookie store for Libgen. If a cookie store is shared with other features, keep it empty for these hosts.

### 9.2 Failover order

1. Load mirrors from **`https://open-slum.org/status.json`** at startup and at most every 10 min (ETag/304, 25 KB, ~3.5 min upstream staleness); bootstrap a hardcoded `[libgen.li, libgen.bz, libgen.vg, libgen.la, libgen.gl]` for cold start / SLUM outage. **[verified §5c; inferred for the 10-min TTL]**
2. Order: `UP` + content verified + no protection first (`.li`, `.bz`, `.vg`), then `UP`/`PROTECTED` without content verification (`.la`, `.gl`), then `DEGRADED`, then `DOWN`/`TIMEOUT` only as a last probe. Within a tier, prefer local per-device success history, then SLUM latency. Do **not** rank a PROTECTED `.la`/`.gl` above an UP `.li`/`.bz`/`.vg`. This yields **`.li` → `.bz` → `.vg` → `.la` → `.gl`** today. **[verified §5c; inferred for local history]**
3. Skip hosts the snapshot says `down` only when the snapshot is <15 min old and another tier-0 candidate exists; `protected` and `degraded` are still attemptable, just later. If every candidate fails, probe the least-recently-failed host once rather than refusing to search. **[inferred]**
4. Search: try mirror 1; on parse failure/timeout/challenge, mirror 2; if a mirror returns a valid table with total 0, accept "no results" (optionally verify on one more mirror).
5. Download: resolve on mirror 1; on failure re-mint on mirror 2 with the **same md5**; max 2 attempts per mirror, 30 s per open, ~90 s to obtain a stream before moving on (once bytes flow, an idle-read timeout governs, not a total cap).
6. Record every real attempt as local health. After **2 consecutive transient failures** a host enters `cooling-down` for `min(15 s × 2^(n−2), 300 s)` with 20% jitter; any success resets it to `healthy`, and a recovered host is tried as `trial` first. Prefer `trial → healthy → cooling-down` on the next session. SLUM is a hint; the probe is the truth. **[inferred, ported from obsfx §5d]**

### 9.3 Timeouts / retries

| Operation | Timeout | Retries |
|---|---|---|
| SLUM `status.json` | 3 s connect, 8 s total | 1; cache 10 min, ETag/304, stale-while-revalidate |
| Search | 10 s connect, 20 s total | 2 per mirror (second only on network/5xx) |
| `ads.php` | 10 s connect, 15 s total | 2 per mirror |
| `get.php` (307 only) | 10 s / 15 s | 2 per mirror (key can go stale) |
| CDN body | 30 s idle read, 10 min total | resume with `Range` up to 3 times; then other mirror |

Never retry a 404/410 or a valid "not found" ads page. Retry 5xx, 429, DB-overload pages ("could not connect to the database", "max_user_connections"), timeouts, short bodies, and `307 → /ads.php`. Treat "no download link" as `not-available` (next book), not as a mirror outage. **[inferred; taxonomy ported from obsfx §5d]**

### 9.4 Suggested module surface

```rust
// search
pub struct LibgenClient { mirrors: Vec<Mirror>, /* ... */ }
pub struct SearchQuery {
    pub title: String, pub author: Option<String>,
    pub isbn: Option<String>, pub md5: Option<String>,
    pub language: Option<String>, pub extension: Option<Ext>,
    pub year_from: Option<u16>, pub year_to: Option<u16>,
    pub page: u32,
}
pub struct BookFile {
    pub md5: String, pub title: String, pub author: String,
    pub publisher: String, pub year: Option<u16>, pub language: String,
    pub pages: Option<u32>, pub size_bytes: Option<u64>,
    pub extension: String, pub file_id: Option<u64>,
    pub mirror: Url, pub source: Source,
}

pub trait BookSource {
    async fn search(&self, q: &SearchQuery) -> Result<Vec<BookFile>>;
    async fn resolve(&self, file: &BookFile) -> Result<ResolvedDownload>;
}
```

`search()` does: build `index.php?req=…` (+ `columns[]` when author/isbn present, + `page`) → parse `#tablelibgen` → optional `json.php` batch by ids → dedupe/rank → return. `resolve()` does: `ads.php` → extract get.php → 307 Location → `ResolvedDownload { url, headers, suggested_name, expected_len }`.

Keep the `BookSource` trait so a future JSON source (or a different Libgen codebase) can replace the scraper without touching UI/download. **[inferred]**

### 9.5 Ranking / dedupe

1. Exact-normalised title and author match first.
2. Format preference: EPUB > PDF (per the app's stated preference for EPUB; PDF still allowed).
3. Language exact match.
4. Full-length record: page count from the search row when > 0, plus `size >= 200 KB` (JSON `pages` is often `0` even for complete files).
5. Newer `time_added`, then larger `size` (within reason).
6. Dedupe by md5, then `(norm_title, norm_author, format, size±5%)`.

Do not hide other editions; group them under one work in the UI. **[inferred]**

### 9.6 What to build first

1. **Mirror catalogue + health** (SLUM parse, cache, bootstrap). Small, testable, unblocks everything.
2. **Search parser** (`#tablelibgen`, 9 cells, total badge, pagination) with a captured HTML fixture test.
3. **Download resolver** (`ads.php` → get.php → Location) with key re-mint and redirect-bounce detection.
4. **Resumable downloader** (HTTP/1.1, Range, content-length check, magic-byte sniff, temp file, SAF write).
5. **UI result list + download action**; show format, size, year, publisher, pages.
6. **`json.php` enrichment** (exact size, locator, broken) behind a feature flag.
7. **Anna's external-browser link** (no backend).
8. Only then consider scimag/DOI search if the product needs papers.
9. **Live smoke test** (`#[ignore]`): several queries, ≥90% md5 coverage, one sampled EPUB/PDF download verified by magic bytes. Run manually before releases; keep the fixture tests for CI. **[inferred, ported from obsfx §5d]**

---

## 10. Open risks

- **Architecture mismatch:** the map says "structured search endpoints"; Libgen has none. Either accept an HTML-scraping adapter or pick a different source; do not spend a sprint looking for a JSON search API. **[verified/inferred]**
- **Selector fragility:** LG+ markup can change without notice. Mitigate with fixture tests and loud parse errors. **[inferred]**
- **Mirror churn / domain seizures:** `.is`/`.rs` are already gone from SLUM; the current five could change. SLUM itself is a single point of failure — cache last-known-good and ship a bootstrap list. **[verified/inferred]**
- **Cloudflare/ISP blocks on mobile networks:** `.la`/`.gl` and possibly the whole family from some carriers. Need graceful "all mirrors unreachable" UX and a manual retry. **[inferred]**
- **Speed:** 178 KB/s observed; a 20 MB PDF could take ~2 min. Background/download-manager work is unavoidable (map already defers persistent queue to after ticket 11). **[verified/inferred]**
- **Legal:** Libgen is a shadow library; its own `robots.txt` disallows all crawling and its About/DMCA text says it only links to third-party files. The old `library.lol` domain now serves a US court-ordered domain-seizure notice, which is a concrete reminder that domains and the project itself are legally contested. Copyright law varies by jurisdiction; keep this personal, no redistribution, no bundled content. Note it in the app's about/legal copy; don't design around it. **[verified]** ([robots.txt](https://libgen.li/robots.txt), About/DMCA on [libgen.li](https://libgen.li/), [library.lol](https://library.lol/))
- **Anna's membership API:** even if integrated, it needs a paid account and only resolves known md5s; it does not solve discovery. **[verified]**
- **Wrong editions / excerpts:** many 4–5 page PDFs in the result set. Ranking must prefer full-length records and the UI must expose page count. **[verified]**

---

## 11. Summary for the ticket resolution comment (~13 lines)

1. **Libgen has no structured search API.** The live family is LG+ (`libgen.li`, `.bz`, `.vg`, `.la`, `.gl`); search is `GET /index.php?req=…&page=N` returning a 9-column `#tablelibgen` HTML table, 25 rows/page, total in a `Files <span class="badge">N` badge. `libgen.is`/`.rs` are unreachable here and absent from SLUM.
2. Parameters that work: `req`, `columns[]` (`t,a,s,y,p,i`), `objects[]`, `topics[]` (`a` = scimag), `page`, `order`/`ordermode`, `gmode` (only `md5:` reliable). `extension=`, `language=`, `year=` are **ignored**; filter client-side.
3. Official `/json.php` is a metadata API by id/range (md5, exact `filesize`, `locator`, `broken`) — use it to enrich HTML results, not to search. `/rss.php` is new arrivals only.
4. Download chain: `/ads.php?md5=…` → `get.php?md5=…&key=…` → **307** → `https://cdn3.booksdl.lc/get.php?…` → bytes. No cookies/JS/Referer needed. Keys are md5-bound, short-lived, and the CDN itself does not validate them.
5. All five mirrors returned identical results today; recommend `.li → .bz → .vg → .la → .gl`, with a hardcoded 5-host bootstrap, a 10-min `status.json` hint for ordering/skipping, and re-mint-on-failure. Do not gate on SLUM: it checks homepages only and is ~3.5 min stale.
6. Hardening: HTTP/1.1 for downloads, Range resume, content-length + magic-byte validation, detect `307 → /ads.php` and truncation; we saw one 522 KB/3.63 MB HTTP/2 truncation and one transient CDN 503.
7. **Anna's Archive is not a v1 fallback.** No search API; `/search`, `/md5/`, `/slow_download/` all 403 DDoS-Guard from a plain client; the only API (`/dyn/api/fast_download.json`) needs a membership secret key and only returns a download URL.
8. Zero-cost fallback: an "Open on Anna's" external-browser link using the shared md5 (`/md5/<md5>`), or a manual search URL.
9. Acceptance passed: `Rock Paper Scissors` / Alice Feeney → 43 hits, 7 EPUBs; chose Flatiron 2021 EPUB **md5 `a1423442916f2f3def9517a3bf4dee48`**, 3,630,176 bytes, verified `application/epub+zip`, `dc:title`/`dc:creator` correct, downloaded via `ads.php` → `get.php` → `cdn3.booksdl.lc`.
10. Build order: mirror catalogue → HTML search parser + fixtures → ads/get resolver → HTTP/1.1 resumable downloader with sniffing → UI. Defer Anna's and scimag.
11. **Do not use `libgen-rs` 0.1.0 as a base.** It targets classic `search.php`/`json.php` and dead mirrors, regex-scrapes uppercase hashes instead of parsing HTML, panics on a dead mirror, cannot download from LG+, and returned `Ok(0)` against live `libgen.li`. One release (2022), 0 reverse deps, 2024 refactor never published. Hand-roll the client; at most borrow the two-phase idea.
12. **Use SLUM as a hint, not an oracle.** `GET https://open-slum.org/status.json` is a real 25 KB JSON snapshot covering all five LG+ mirrors (`generated_at`, per-domain `status`/`display_status`, `last_check`, `protection_type`, `body_contains_pass`); checks run every 60 s, status is a 5-min bucket, snapshot rebuilds ~205 s, so it is ~1–4 min stale. It is homepage-only, single US-East vantage, and counts `PROTECTED` as green. Cache 10 min, use it to order/skip, hardcode the five hosts, and always probe the real search/download endpoint.
13. **Keep the hand-rolled client; reuse no crate.** The four surveyed GitHub clients are references: port `obsfx`'s health/cooldown + failure taxonomy + recovery wait, `Houdiee`'s mirror race/discovery + `.part` rename + rustls timeouts, and `waltz`'s header mapping + anchor scoring. `mattrighetti` is dead and unlicensed. None implements our working `columns[]` search, Range resume, or magic-byte validation.

---

## Sources

**Live endpoints (primary, observed 2026-11-24 11:30–12:00 UTC)**

- Search: <https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25>
- Pagination: <https://libgen.li/index.php?req=Rock+Paper+Scissors+Alice+Feeney&res=25&page=2>
- Scimag: <https://libgen.li/index.php?req=10.1038%2Fnature12373&topics%5B%5D=a&res=25>
- Metadata API docs: <https://libgen.li/json.php>
- Metadata: <https://libgen.li/json.php?object=f&ids=98756682>
- New arrivals: <https://libgen.li/rss.php?page=1>
- Ads: <https://libgen.li/ads.php?md5=a1423442916f2f3def9517a3bf4dee48>
- Get: <https://libgen.li/get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3>
- CDN: <https://cdn3.booksdl.lc/get.php?md5=a1423442916f2f3def9517a3bf4dee48&key=WQ0MW1XE7225E9Y3>
- Robots: <https://libgen.li/robots.txt>
- Anna's FAQ API: <https://annas-archive.gl/faq#api>
- Anna's fast-download API self-doc: <https://annas-archive.gl/dyn/api/fast_download.json>
- Anna's search (403): <https://annas-archive.gl/search?q=Rock+Paper+Scissors+Alice+Feeney>

**Mirror health (primary)**

- SLUM Libgen: <https://open-slum.org/libgen.html>
- SLUM machine-readable snapshot: <https://open-slum.org/status.json>
- SLUM logs: <https://open-slum.org/logs/libgen/li.log>, <https://open-slum.org/logs/libgen/bz.log>, <https://open-slum.org/logs/libgen/vg.log>, <https://open-slum.org/logs/libgen/la.log>, <https://open-slum.org/logs/libgen/gl.log>
- SLUM monthly archive: <https://open-slum.org/logs/archive/2026-11/libgen/li.log>
- SLUM Anna's: <https://open-slum.org/annas.html>, <https://open-slum.org/logs/annas/gl.log>
- FlatMonitor source: <https://github.com/BrianZbr/flatmonitor>; beta warning at [`README.md` L3](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/README.md#L3)
- FlatMonitor `status.json` writer: [`app/renderer.py` L194–L226](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/renderer.py#L194-L226)
- FlatMonitor 60 s interval / 5-min bucket rules: [`docs/architecture.md` L59](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/architecture.md#L59), [L146–L150](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/architecture.md#L146-L150)
- FlatMonitor detection/classification: [`app/runner.py` L136–L200](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/runner.py#L136-L200)
- FlatMonitor bucket/refusal guard: [`app/aggregator.py` L215–L311](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/app/aggregator.py#L215-L311)
- FlatMonitor status.json docs: [`docs/configuration.md` L136](https://github.com/BrianZbr/flatmonitor/blob/862c15f8f9f512dfa6744c77b883d42996bf74da/docs/configuration.md#L136)

**Reference implementation (pinned to commit `89d7617aa7f12ba7e6c77d7b657282e6591fac1f`, 2026-11-24)**

- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/libgen_service.dart#L13-L19> — ads.php/get.php description, per-page key, 307 to CDN.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L114-L151> — Libgen provider, `#tablelibgen` vs legacy `table.c`.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L163-L220> — 9-column row layout.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/search_manager.dart#L262-L320> — `columns[]`, `extension`/`language`/`year` params (which the server ignores), `index.php?…&res=100`.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/core/slum.dart#L235-L248> — mirror ordering by protection/status/latency.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/slum_catalogue.dart#L20-L31> — SLUM is the only mirror source; 10-minute TTL at L69.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/core/annas_archive.dart#L128-L196> — Anna's search URL builder.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/core/annas_archive.dart#L337-L383> — challenge-page detection markers.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/ddos_protection_handler.dart#L1-L11> — DDoS-Guard clearance is browser-TLS-bound; cookie replay loops 403.
- <https://github.com/warreth/OpenlibExtended/blob/89d7617aa7f12ba7e6c77d7b657282e6591fac1f/lib/services/webview_challenge_solver.dart> — the webview solver Anna's requires.

**`libgen-rs` 0.1.0 and repository**

- <https://crates.io/crates/libgen-rs/0.1.0> — crate page; one version only.
- <https://crates.io/api/v1/crates/libgen-rs> — release metadata, downloads, `license: non-standard`.
- <https://crates.io/api/v1/crates/libgen-rs/reverse_dependencies> — 0 reverse dependencies.
- <https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/search.rs> — published search implementation (classic `search.php`, hash regex, N+1 JSON).
- <https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/mirrors.rs> — published mirror list, `check_connection`, `get_working_mirror`.
- <https://docs.rs/crate/libgen-rs/0.1.0/source/src/api/download.rs> — published hardcoded download-host branches.
- <https://docs.rs/crate/libgen-rs/0.1.0/source/resources/mirrors.json> — published mirror list (`libgen.is`, `.rs`, `.st`, `library.lol`, `.lc`, `.rocks`, `.me`).
- <https://docs.rs/crate/libgen-rs/0.1.0/source/Cargo.toml.orig> — `license-file`, `reqwest 0.11` default TLS, CLI crates as lib deps.
- <https://github.com/karasikq/libgen-rs> — repo HEAD; 43 stars, 10 forks, last push 2024-03-04.
- <https://github.com/karasikq/libgen-rs/pull/6> — unmerged `cargo update` PR, 2025-09-09.
- <https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/search.rs#L139-L204> — HEAD hash regex, concurrent N+1 enrichment, rate-limit comment.
- <https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/mirrors.rs#L44-L51> — HEAD `check_connection` still does not check status.
- <https://github.com/karasikq/libgen-rs/blob/192d9429903c7f2782a86dd2294e70a7cc1371fd/libgen-api/src/error.rs#L19-L21> — HEAD `Error::mirror` maps to `Download`.

**GitHub client survey (source reviewed at these commits)**

- `obsfx/libgen-downloader` @ `f5b05984003d7ec440ac40e5606d0b3184c5226f`: <https://github.com/obsfx/libgen-downloader>; remote config <https://raw.githubusercontent.com/obsfx/libgen-downloader/configuration/config.v3.json>; release v3.4.0 <https://github.com/obsfx/libgen-downloader/releases/tag/v3.4.0>
- `Houdiee/Libgen-TUI` @ `e92cbd6187d84c1d52a1f9da9a26ca394e072076`: <https://github.com/Houdiee/Libgen-TUI>
- `waltz/libgenie` @ `d9e86a7b29e0f52e9bfeddafb4806117b11c1def`: <https://github.com/waltz/libgenie>
- `mattrighetti/libgen-bot-rs` @ `e794148e91862a5fbcc32d8817cf34d92e91346b`: <https://github.com/mattrighetti/libgen-bot-rs>
