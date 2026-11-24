# 03 — Libgen and Anna's Archive programmatic access

Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

How do we search and download books from Libgen, with Anna's Archive as a fallback, as of now?

Establish from primary sources and reference implementations (OpenlibExtended is the named reference): available mirrors and their health; the structured search endpoints and their parameters (title, author, year, language, extension, publisher, ISBN, MD5); response formats and how to parse them; how a download URL is resolved, including mirror failover and rate limits; file types and naming; and the failure modes worth designing for.

Acceptance check: locate an EPUB for "Rock Paper Scissors" by Alice Feeney through the documented flow. Record exact endpoints, request shapes, and a recommended Rust HTTP strategy. Note legal caveats for personal use, without designing around them.

## Constraints (user)

- The acquisition HTTP client must support **TLS/browser impersonation** (JA3/JA4 fingerprinting) so Cloudflare/DDoS-Guard protected mirrors are usable. Candidate: `wreq` (https://github.com/0x676e67/wreq). Evaluate it against `reqwest` when closing this ticket; record the choice and the fallback.

## Answer

Resolved 2026-11-24. Full report, live tests, endpoint shapes and project survey: `notes/libgen-annas-api.md`.

**Decision:** hand-rolled `reqwest`-style client against the LG+ family. Reuse no crate: `libgen-rs` targets the dead classic API (returned 0 live results, panics on dead mirrors); none of the surveyed projects is a published library worth depending on.

- **Search:** `GET https://<mirror>/index.php?req=…&page=N` returning the 9-column `#tablelibgen` HTML table, 25/page. `columns[]` (t,a,s,y,p,i) works; plain extension/language/year filters are silently ignored and must be applied client-side. `/json.php` is metadata-by-id only. No structured search API exists.
- **Download:** `ads.php?md5=` → `get.php?md5=&key=` → 307 → `cdn3.booksdl.lc`. No cookies/JS/Referer. Use HTTP/1.1, Range resume, content-length and magic-byte validation; re-mint keys on failure.
- **Mirrors:** hardcode `.li → .bz → .vg → .la → .gl`; SLUM `https://open-slum.org/status.json` (ETag, ~1-4 min stale) as a 10-minute health hint only. `.la/.gl` are Cloudflare-protected.
- **HTTP fingerprinting:** acquisition client must support TLS/browser impersonation (JA3/JA4); `wreq` is the chosen candidate, with `reqwest` + rustls as fallback. Spike before committing the dependency.
- **Anna's Archive:** not a v1 fallback — DDoS-Guard 403 on search/detail/slow-download, membership key required for its API. Offer an external-browser link only.
- **Resilience to port** (from libgen-downloader / Libgen-TUI): mirror health registry with cooldown and exponential backoff, failure taxonomy (not-available vs rate-limited vs server-error vs unreachable), per-source budgets, `.part` + atomic rename, generic column mapping with the 9-column fallback, and an ignored live smoke test.
- **Acceptance passed:** *Rock Paper Scissors* / Alice Feeney → 43 hits, 7 EPUBs; md5 `a1423442916f2f3def9517a3bf4dee48`, 3,630,176 bytes, verified EPUB and metadata, full download chain exercised.

Build order: mirror catalogue + bootstrap → HTML search parser with fixtures → ads/get resolver → resumable downloader with sniffing → UI → SLUM hint.
