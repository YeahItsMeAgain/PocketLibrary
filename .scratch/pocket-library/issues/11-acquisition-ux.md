# 11 — Acquisition experience

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 03

## Question

Design the user's path from wanting a book to having it on a shelf.

Cover: the advanced-search form and its fields; results presentation (title, author, year, format, size, source); the detail sheet (cover, description, mirrors); download progress and background behaviour; mirror failover and Anna's Archive fallback; duplicate detection before download; file naming in the library folder; error and offline states; and what happens on the shelf when the download completes (lowest shelf with room, then flip available).

State how much of this is M2 and how much is later, and identify the acceptance test: find and download "Rock Paper Scissors" by Alice Feeney.

## Answer

Resolved 2026-11-24.

- **Search form:** title/author, plus advanced year-from/to, language, format, publisher, ISBN, MD5. Results show title, author, year, format, size, source; 25 per page with explicit paging; sort by relevance/year/size. Extension, language and year filters are applied client-side to the fetched page because Libgen ignores them server-side, with a note when a page has few matches. No infinite scroll.
- **Result detail:** Libgen row supplies title, author, year, publisher, language, pages, format, size, md5. Optional Open Library cover/blurb enrichment runs without blocking the sheet; generated cover fallback.
- **Queue:** two concurrent downloads, persisted across restarts, Range resume. M2 downloads run while the app is open; a foreground service/notification is a later milestone.
- **Duplicates:** check the result md5 against download history before fetching; after download hash with BLAKE3 against the library. On a match, discard the new file, show "Already in your library", and jump to the existing book.
- **File name and location:** `Author - Title (Year).epub`/`.pdf` in the library folder root, sanitised, ` (2)` on collision. After landing, re-read embedded metadata and use it on the shelf instead of the search metadata.
- **Failures:** automatic mirror failover with "Trying another mirror…", then a clear failure with Retry and the last error. Offline shows an explicit "No connection" state.
- **No Anna's Archive in v1.** No external-browser hand-off and no source that cannot download in-app: acquisition is fully built in with Libgen or not offered. This supersedes the external-link note in 03.
