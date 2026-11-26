# PocketLibrary — Filling missing covers and blurbs

Status: ready-for-agent
Tracker: local `.scratch/metadata-gaps/`
Blocked by: none

## Superseded (2026-11-27)

Online details are automatic always, per product decision. The Off / Ask / Automatic setting and its Settings section are removed, and every launch forces automatic mode, including existing installs that stored Off or Ask. The privacy consequence is accepted: title, author and ISBN may be sent on open or import without a per-book prompt. Automatic lookup keeps its conservative rules — only missing fields are filled, only high-confidence matches are applied, embedded metadata is never overwritten, and the source is attributed. The rest of this spec is retained as historical context.

## Problem Statement

Many of my books arrive with thin or missing embedded metadata. The shelf shows a generated
aubergine-and-brass plate instead of the real cover, and the Flip says “No blurb was printed with
this edition.” A wrong cover or a mismatched blurb is worse than an honest blank, so I do not want
the app quietly guessing, phoning home, or overwriting the details that came with the file.

I want PocketLibrary to fill only the gaps — a real cover and a readable blurb — when I ask it to,
using the book’s ISBN or, when there is none, its title and author. I want to know where the details
came from, be able to reject a bad match, and be able to put the file’s own metadata back. The app
must still work fully offline and must never send my library anywhere unless I have opted in.

## Solution

Add an opt-in online-details feature to the existing Flip. It stays off by default. When enabled,
PocketLibrary looks up missing covers and blurbs for a book I open, or for a small foreground batch I
explicitly start, and shows the result in the existing cover frame and blurb slot.

Matching is conservative: ISBN/edition first, then work/edition, then a title-plus-author search.
Only high-confidence matches are applied automatically, and only to fields that are genuinely
missing. Embedded metadata is protected by default; anything I edit is protected permanently. A
medium-confidence match is offered for review instead of being written. Covers are downloaded only
from the matched edition, validated for format, size and portrait aspect ratio, and cached locally.
A short attribution line names the source. If a result is wrong, I can choose another metadata
candidate, edit the blurb, open the cover picker, or revert the online details to what the file
contained. Choosing a replacement cover by hand is specified separately in `cover-picker.md`.

Open Library is the only general-purpose source. Internet Archive is a supplementary source only
when the matched Open Library edition points at a specific Internet Archive scan. There is **no
second general-purpose keyless fallback**: no user-supplied API keys, no paid sources and no
keyed services. Nothing is sent without an explicit choice.

The automatic path has a hard boundary: it may fill a missing blurb and may upgrade a generated or
missing cover on a high-confidence match, but it must never silently replace a real embedded or
PDF-rendered cover. A real cover is replaced only through the explicit manual cover chooser.

## User Stories

1. As the reader, I want online detail lookup to be off by default, so that opening my library never
   makes a network request I did not ask for.
2. As the reader, I want a plain-language privacy setting for online details, so that I can choose
   Off, Ask, or Automatic without reading a manual.
3. As the reader, I want the setting to explain which fields leave the device — title, author and
   ISBN only — so that I understand what is sent.
4. As the reader, I want to see the provider’s name before enabling it, so that I know who receives
   the lookup.
5. As the reader, I want a per-book “Look up details” action in the Flip, so that I can enrich one
   book without turning on automatic lookup for the whole library.
6. As the reader, I want automatic lookup to run only for the book I open, so that the app does not
   crawl my whole library in the background.
7. As the reader, I want a foreground “Fill missing details” action for a small selected set, so that
   I can fix several books at once without waiting on each Flip.
8. As the reader, I want any batch to be capped, ordered and cancellable, so that it never becomes an
   uncontrolled mass download.
9. As the reader, I want the app to use the ISBN when the file has one, so that the cover and blurb
   belong to the exact edition I own.
10. As the reader, I want the app to use the work/edition identifier when one is already known, so
    that a previous good match is reused instead of searched again.
11. As the reader, I want a title-and-author search when there is no ISBN, so that most ordinary
    EPUBs still have a chance of a real cover and blurb.
12. As the reader, I want title matching to ignore case, punctuation, leading articles and subtitle
    suffixes, so that “The Whisper Man” and “Whisper Man, The” find the same work.
13. As the reader, I want an author surname check before a match is accepted, so that a common title
    does not attach the wrong author’s book.
14. As the reader, I want a year check when the file or acquisition history has one, so that a remake,
    translation or unrelated edition is less likely to win.
15. As the reader, I want acquisition history to be used only as a hint when the file is thin, so that
    a download title never overrides the file’s own metadata.
16. As the reader, I want a high-confidence match to fill only missing fields, so that good embedded
    metadata is never replaced.
17. As the reader, I want embedded titles, authors, publishers, dates and descriptions to stay
    authoritative, so that the file remains the source of truth.
18. As the reader, I want an embedded cover to win by default, so that a publisher’s real cover is not
    replaced by a catalogue thumbnail.
19. As the reader, I want a generated plate to be upgradeable to a real cover, so that coverless books
    stop looking unfinished.
20. As the reader, I want a medium-confidence match offered for review rather than applied, so that I
    can decide whether it is my book.
21. As the reader, I want to see the candidate’s title, author, year, publisher and cover thumbnail
    before accepting, so that I can spot a wrong edition.
22. As the reader, I want ambiguous results to apply nothing, so that two plausible matches do not
    produce a random cover.
23. As the reader, I want to reject a candidate and keep the file’s details, so that the app learns
    not to apply that match.
24. As the reader, I want the matched cover to be portrait and reasonably large, so that it does not
    look stretched, cropped or blurry in the Flip.
25. As the reader, I want the cover fitted inside the existing frame without cropping the artwork, so
    that titles and author names at the edges remain visible.
26. As the reader, I want a tiny, landscape or broken cover rejected, so that the generated plate is
    preferable to a bad image.
27. As the reader, I want the blurb cleaned of HTML and excess whitespace, so that it reads like the
    rest of the room rather than a web page.
28. As the reader, I want a real blurb in the existing Flip, so that I can decide whether to read the
    book without leaving PocketLibrary.
29. As the reader, I want “No blurb was printed with this edition” to remain when nothing was found,
    so that the app does not invent a description.
30. As the reader, I want a short source line under the blurb and cover, so that I know whether I am
    reading the file’s details or a catalogue’s.
31. As the reader, I want to open the source record, so that I can check the edition or report a
    mistake.
32. As the reader, I want to edit a blurb or choose another cover myself, so that I can correct a
    catalogue error.
33. As the reader, I want my edits marked as mine, so that no later refresh, rescan or batch replaces
    them.
34. As the reader, I want a clear “Revert to file details” action, so that I can undo an enrichment I
    no longer want.
35. As the reader, I want a refresh action that bypasses the cache, so that I can ask for newer data
    when a catalogue has improved.
36. As the reader, I want cached details reused for a sensible period, so that opening the same book
    repeatedly does not hammer a volunteer service.
37. As the reader, I want a no-match result remembered for a short while, so that I am not re-asking
    the same question every time I open the book.
38. As the reader, I want lookup to stop when I leave the book or cancel a batch, so that stale results
    never appear on a different book.
39. As the reader, I want a failed lookup to leave the shelf and Flip fully usable, so that a network
    problem never blocks reading.
40. As the reader, I want a clear offline message, so that I know the book itself is fine and only the
    lookup failed.
41. As the reader, I want rate-limit failures explained in plain language, so that I know whether to
    wait or retry.
42. As the reader, I want automatic retries only for temporary faults, so that the app does not spin
    forever or retry a permanent failure.
43. As the reader, I want a clear no-match or source-outage state instead of a second keyed provider,
    so that the app stays free and automatic without pretending it has another catalogue.
44. As the reader, I want Open Library and the supplementary Internet Archive lookup to be
    rate-limited independently, so that neither receives more traffic than intended.
45. As the reader, I want the app to identify itself honestly to Open Library, so that its requests
    are not treated as anonymous scraping.
46. As the reader, I want online details to work without any API key or subscription, so that setting
    it up is free and automatic.
47. As the reader, I want source attribution and licence notices in the app, so that using catalogue
    data respects the provider’s terms.
48. As the reader, I want the Victorian look preserved, so that the new controls feel like part of the
    reading room rather than a web form.
49. As the reader, I want large touch targets and screen-reader labels for the new actions, so that the
    feature is usable with the rest of the app’s accessibility.
50. As the reader, I want my manual corrections backed up, so that restoring my library does not lose
    the details I fixed by hand.
51. As the reader, I want the manual cover chooser to be the safety valve when a match is ambiguous or
    belongs to the wrong edition, so that automatic lookup never turns into a blind cover carousel.
52. As the reader, I want automatic lookup to leave a real embedded or rendered cover alone, so that
    only the manual chooser can replace a cover the file already has.

## Research Findings

Checked on 26 November 2026. Facts below come from the providers’ own documentation or live requests,
except where marked as reported rather than documented. This revision applies a firm product
constraint: **no user-supplied API keys, no paid sources, and no keyed services**. It re-checks the
remaining free/keyless set and removes the previous Google Books fallback.

### Recommendation at a glance

- **Primary: Open Library.** No account or key, a documented ISBN/edition/work model, cover URLs by
  ISBN and identifier, a large catalogue, and a data-licensing statement compatible with a personal,
  non-commercial library app. Its weaknesses are inconsistent descriptions and volunteer-run capacity,
  so requests must be cached, identified and slow.
- **Supplementary: Internet Archive.** Free and keyless. It is consulted only when the matched Open
  Library edition carries an `ocaid` (an Internet Archive identifier), so the supplemental record is
  tied to the same edition rather than found by a second general search. Its metadata is item-level,
  access restrictions vary, and it is not a general fallback.
- **No second general-purpose keyless fallback.** Google Books is rejected: keyless access is
  unreliable (live checks returned HTTP 429 with a zero quota), and requiring a user-supplied API key
  is out of scope. Hardcover requires a personal token or OAuth, BookBrainz is alpha and sparse with
  no cover field, Wikidata has no general blurb/cover service, and ISBNdb is paid. The feature ships
  with Open Library as the sole general source plus the linked Internet Archive supplement.
- **Not chosen as defaults:** Hardcover (beta, user token, image-rights warning), BookBrainz (alpha
  API, sparse records, no cover field in search results), Wikidata (excellent identifiers and CC0
  licensing, but no reliable blurbs or cover service), ISBNdb (paid subscription and key), Calibre
  (prior art, not an API), Google Books (keyless unreliable; user key out of scope).

### Source comparison

| Source | Authentication / cost | Published limits | Covers | Blurbs / descriptions | Licence / terms | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| Open Library | None; app registration and identifying User-Agent recommended | 1 req/s anonymous; 3 req/s with User-Agent + email; covers by ISBN/OCLC/LCCN 100 req/IP/5 min | Yes, by ISBN, OLID or cover ID, S/M/L | Sometimes, at edition or work level; not guaranteed | IA states it asserts no new copyright; individual contributions may still carry rights; courtesy link requested | **Primary** |
| Google Books | API key or OAuth required for public data; keyless requests fail | Default quota not published; commonly reported as 1,000/day per project | Yes, thumbnail through extraLarge | Yes, `volumeInfo.description` | No user fee without permission; content removal; Google branding and prominent links required | **Rejected: keyless unreliable; user key out of scope** |
| Hardcover | Personal access token or OAuth; free and supporter tiers | Free 5,000/day, 60/min, burst 10; Supporter 50,000/day | User-uploaded images | Yes, but API is beta and data is user-contributed | Beta, may change or reset tokens; must keep tokens server-side; public images need a DMCA takedown policy; no commercial use of user data | Rejected: requires a token (keyed) |
| BookBrainz | None for read API | Alpha API; a simple rate limiter exists but exact published limits were not found | No cover field in live search response | Sparse; edition/work records but little blurb data | Core data CC0; other public data CC BY-SA | Not suitable |
| Wikidata | None; identifying User-Agent required | 10 req/min unidentified; 200 req/min with compliant User-Agent; max 3 concurrent; honour 429/Retry-After | Not a cover service; occasional image statements | Not a blurb service | CC0; attribution appreciated, not required | Identifiers/links only |
| Internet Archive | None for metadata reads | No per-request key documented; normal robot etiquette applies | Item thumbnail/scan images | Item-level description/creator/date | Per-item rights and `licenseurl`; access restrictions vary | Public-domain supplement |
| ISBNdb | Paid subscription; key in `Authorization` header | Basic $14.99/mo, 5,000 searches/day, 1 call/s; Premium/Pro higher; each ISBN in a bulk call counts as a search | Cover thumbnail | Synopsis, subject and other fields | Subscription terms; not open data | Rejected for a free personal app |
| Calibre | Desktop app; no API | Not applicable | Uses ISBN-based download | Uses Google Books and Amazon metadata download | GPL-3 application; not a hosted source | Prior art only |

### Re-check for a second free, keyless source

After removing keyed sources, the viable set is small:

- **Open Library** is the only free, keyless, general-purpose source with both cover URLs and a
  work/edition model. It remains primary.
- **Internet Archive** is free and keyless, but it is an item/scan catalogue. It is useful only when
  the Open Library edition points at a specific `ocaid`; it is not a title+author fallback.
- **BookBrainz** is keyless but alpha, sparse, and its live search response had no cover field.
- **Wikidata** is keyless and CC0 but is an identifier/link graph, not a blurb or cover service.
- **Google Books** is keyless-unreliable and keyed in practice; **Hardcover** requires a token or
  OAuth; **ISBNdb** is paid. All three are out under the product constraint.
- **Calibre** is a desktop application, not a service.

**Conclusion:** there is no second general-purpose free/keyless fallback to recommend. Do not add a
hidden keyed provider, a build-time shared key, or a "bring your own key" setting. A source outage
must degrade to the file's own details and a clear message.

### Verified provider details and links

**Open Library**

- API overview and rate limits: <https://openlibrary.org/developers/api>. The page says default
  unidentified traffic is 1 request/second; requests with a `User-Agent` naming the app and a contact
  email get 3 requests/second. It asks clients to cache, avoid hundreds of single-book requests, use
  `search.json` for batches, and not treat the API as a bulk backend.
- Search API: <https://openlibrary.org/dev/docs/api/search>. `search.json` returns work-level results
  and can include an `editions` sub-object. Work-level data includes title, author, first publish year,
  `cover_i`, and work key. Edition selection is relevance-based and can be steered with edition fields.
- Works, editions and ISBN APIs: <https://openlibrary.org/dev/docs/api/books>. `/isbn/{isbn}.json`
  resolves to an edition; `/books/{OLID}.json` is an edition; `/works/{OLID}.json` is a work; a work’s
  editions are at `/works/{OLID}/editions.json`. The legacy Books API’s `jscmd=details` response
  documents a `description` field when the edition has one.
- Covers API: <https://openlibrary.org/dev/docs/api/covers>. URL shape is
  `https://covers.openlibrary.org/b/{isbn|oclc|lccn|olid|id}/{value}-{S|M|L}.jpg`; append
  `?default=false` to get a 404 instead of a blank image. The page says ISBN/OCLC/LCCN lookups are
  limited to 100 requests/IP per 5 minutes; CoverID and OLID access are not listed as rate-limited. It
  explicitly asks clients not to crawl and to link back to Open Library.
- Licensing: <https://openlibrary.org/developers/licensing>. The Internet Archive “does not assert any
  new copyright or other proprietary rights” over the Open Library database, while noting that
  existing rights issues may exist. Individual cover images are not guaranteed to be freely licensed.
- Live checks:
  - `https://openlibrary.org/isbn/9780385472579.json` returned edition `/books/OL1397864M`, title
    “Zen speaks”, `covers: [240726]`, and no `description` key.
  - `https://openlibrary.org/works/OL1866073W.json` also had no `description` key.
  - `https://openlibrary.org/search.json?q=isbn:9780385472579&fields=...` returned the work
    `/works/OL8052318W` with `cover_i: 240727` and an edition `/books/OL7440033M`.
  - This confirms ISBN and cover matching are practical, and that descriptions are inconsistent and
    often absent. Work and edition cover IDs can also differ, so the edition’s cover should be
    preferred after an ISBN match.

**Google Books — rejected under the no-key constraint**

- Using the API: <https://developers.google.com/books/docs/v1/using>. Public-data requests must carry
  an API key or OAuth token. Search supports `isbn:`, `intitle:`, `inauthor:` and `maxResults` up to 40.
  A volume includes `volumeInfo.title`, `authors`, `description`, `industryIdentifiers`,
  `pageCount`, `imageLinks` (thumbnail through extraLarge) and `canonicalVolumeLink`.
- Live check: on 26 November 2026, a keyless
  `GET https://www.googleapis.com/books/v1/volumes?q=isbn:9780385472579&country=US` returned HTTP 429
  with `quota_limit_value: 0`. Keyless access is therefore unreliable and cannot be the automatic
  fallback.
- A user-supplied key is now explicitly out of scope. The product must not ask the reader to create a
  Google Cloud project, paste a secret, or manage a quota.
- Additional constraints if it were ever reconsidered: the terms
  (<https://developers.google.com/books/terms>) forbid charging users without permission and require
  content removal; the branding rules (<https://developers.google.com/books/branding>) require
  “powered by Google” and prominent links to Google Books, and forbid altering results. These are not
  reasons to add it now.
- Quota note: no official default is published on the API pages; the commonly reported 1,000/day per
  project is a report, not a guarantee. This is recorded only to explain why a keyed integration
  would also need quota management.

**Hardcover**

- Getting started: <https://docs.hardcover.app/api/getting-started/>. GraphQL endpoint; personal access
  token or OAuth; the API is in beta; queries must run where the token can be kept secure. Free plan
  is documented as 5,000 requests/day, 60/minute, burst 10; Supporter is 50,000/day. Rate-limit and
  `Retry-After` headers are documented.
- The same page warns that images are user-uploaded and that a public site using them should have a
  DMCA takedown policy. It also restricts use of user-owned data by commercial products.
- Reason not to default: per-user token, beta instability, and image-rights obligations.

**BookBrainz**

- Developer page: <https://bookbrainz.org/develop>. The web service is described as alpha; the linked
  live documentation address is a test-host URL, which was unreachable during this check.
- Licensing: <https://bookbrainz.org/licensing>. Core data is CC0; other public data is CC BY-SA.
- Live search: `https://api.bookbrainz.org/1/search?q=zen&type=edition` returned results with `bbid`,
  default alias and entity type, but empty `authors` and no cover field.
- Reason not to use: alpha API, sparse records, and no practical cover source for this feature.

**Wikidata**

- Data access: <https://www.wikidata.org/wiki/Wikidata:Data_access>. Data is CC0, no key is required,
  and clients should send a descriptive User-Agent, use gzip, limit concurrency and honour 429.
- Rate limits: <https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits>. As of the 2026 policy, an
  unidentified client is limited to 10 requests/minute; a compliant User-Agent allows 200/minute;
  clients should use at most 3 concurrent requests and respect `Retry-After`.
- Reason not to use as the metadata source: Wikidata models editions and identifiers well, but does not
  provide a general blurb or cover service comparable to Open Library.

**Internet Archive**

- Metadata Read API: <https://archive.org/developers/md-read.html>. `https://archive.org/metadata/{id}`
  returns an item record without a key; fields can be read individually.
- Advanced search: <https://archive.org/advancedsearch.php>. JSON output is available for item queries.
- Live check: `https://archive.org/metadata/zenspeaksshoutso0000caiz` returned item-level title,
  creator, date, ISBN, description lines, `openlibrary_edition`, `openlibrary_work`, and an
  `access-restricted-item` flag. `https://archive.org/services/img/{id}` served a JPEG thumbnail.
- Reason to treat it as a supplement only: records describe a scanned item, not necessarily the
  reader’s edition, and rights/access vary per item. PocketLibrary therefore consults it only when
  the matched Open Library edition contains an `ocaid`, and skips items marked access-restricted
  unless the item is clearly public domain or openly licensed. It is not a general search fallback.

**ISBNdb**

- Pricing and description: <https://isbndb.com/isbn-database>. Entry plan is $14.99/month; the database
  advertises roughly 123 million books, 19 data points including synopsis and cover thumbnail.
- FAQ: <https://isbndb.com/faq>. API base is `https://api2.isbndb.com`; key goes in the `Authorization`
  header; Basic has 5,000 daily searches and 1 call/second; Premium 3/s, Pro 5/s; daily quotas reset at
  00:00 UTC; each ISBN in a bulk request counts as one search; 429 means a limit was hit.
- API docs: <https://isbndb.com/isbndb-api-documentation-v2>. Bulk lookup supports up to 100 ISBNs on
  Basic and 1,000 on higher plans.
- Reason not to use: recurring cost and a secret key for a free, personal app.

**Calibre**

- Metadata download documentation: <https://manual.calibre-ebook.com/metadata.html>. Calibre’s built-in
  metadata download uses Google Books and Amazon, prefers ISBN over title/author, and can fetch covers
  when an ISBN is known. It is useful evidence that ISBN-first matching works, but it is not a hosted
  API and its Amazon path is scraping, not something PocketLibrary should copy.

## Implementation Decisions

### Scope and user control

- The feature is **off by default**. There is no network call during onboarding, scan, import, or a
  normal Flip until the reader enables online details or presses an explicit lookup action.
- Settings gains an **Online details** section with three modes: `Off`, `Ask`, and `Automatic`.
  `Ask` is the safe middle default after opt-in: the Flip shows a small “Look up details” action, and
  nothing happens until it is pressed. `Automatic` looks up a book when its Flip opens if it is still
  missing a cover or blurb and its cache is stale.
- A foreground **Fill missing details** action may be offered in Settings. It operates on a capped,
  visible queue (20 books per run), is cancellable, and applies only high-confidence results to missing
  fields. It never runs in the background and never silently replaces protected data.
- **Automatic lookup boundary.** Automatic lookup may fill a missing blurb and may upgrade a
  generated or missing cover on a high-confidence match. It must never silently replace a real
  embedded or PDF-rendered cover. A real cover is replaced only through the explicit manual cover
  chooser specified in `cover-picker.md`.
- The opt-in copy names the source and states exactly what leaves the device: title, author and ISBN
  (plus the matched Open Library identifier when already known). It states that no account, library
  list, reading progress, annotations or file contents are sent, and that there is no key or
  subscription.
- No analytics, telemetry, accounts, cloud sync or device identifier is introduced.

### Provider abstraction and command API

- A new core enrichment module owns lookup, matching, confidence, cover validation, caching, rate
  limiting and write policy. It sits beside acquisition, not inside the metadata parser; scanning
  remains offline and deterministic.
- Providers sit behind a `MetadataProvider` trait so tests can inject fixtures. The trait returns
  candidates for an ISBN, an edition/work key, or a title+author query, and can fetch a cover by a
  provider-relative key.
- Production has exactly one general provider, Open Library. A separate, narrow Internet Archive
  supplement is consulted only when an Open Library edition exposes an `ocaid`; it is not a general
  search provider and has no title+author path. There is no keyed provider and no provider-selection
  setting.
- `Api` accepts an enrichment service/provider set in the same way it already accepts a test search
  provider. The Tauri shell only forwards commands; it does not contain matching or HTTP policy.
- The command surface is deliberately small:
  - read and write the online-details settings (mode only; no keys);
  - look up one book (`bookId`, optional `force`) and return an outcome;
  - accept a reviewed candidate for missing fields;
  - edit or clear the blurb;
  - revert online-derived details to the file-derived values;
  - optionally start/cancel a capped foreground batch.
- Manual cover replacement is **not** part of this command surface; it belongs to the cover-picker
  spec so there is one explicit path for replacing a real cover.
- The lookup outcome crosses the wire in camelCase and distinguishes every state the UI must show:

  ```text
  EnrichmentOutcome =
    | { state: "applied"; source; fields; attribution }
    | { state: "needsReview"; candidates[]; attribution }
    | { state: "noMatch"; source; reason }
    | { state: "unavailable"; source; code; message; retryAfterSeconds? }
    | { state: "cancelled" }
  ```

  `fields` names only the fields actually written. `attribution` carries a source label, a public
  source URL, and which fields it covers. No filesystem path or secret crosses the wire.

### Matching and confidence

- **ISBN first.** Extract an ISBN-10 or ISBN-13 from the EPUB/PDF identifier fields and any ISBN-like
  string; strip separators, validate the check digit, and normalise ISBN-10 to ISBN-13. An exact valid
  ISBN is the strongest key. Record the matched edition key (for example an Open Library edition OLID)
  so later refreshes use `/books/{OLID}.json` and do not search again.
- **Edition, then work.** Use the edition’s title, authors, publisher, date, identifier, description
  and cover. If the edition has no description, read the work record for a work-level description.
  Do not take a work-level cover when an edition was ISBN-matched; prefer the edition’s cover list.
- **Internet Archive supplement.** If the matched Open Library edition exposes an `ocaid`, the IA
  item may supply a missing description or a better thumbnail. Only use items that are not
  access-restricted unless they are clearly public domain or openly licensed. Because the `ocaid`
  already ties the item to the edition, this is an edition-linked supplement, not a second general
  match; it never runs on its own title+author result.
- **Work/edition key cache.** If a previous match is already stored, use that key before searching.
- **Title + author fallback.** This is Open Library’s search only. Normalise both sides: case-fold,
  strip punctuation and diacritics for comparison, remove a leading article, drop a trailing subtitle
  after `:`/`—` when the main title is distinctive, and collapse whitespace. Require a strong title
  similarity and an author match on a surname (or a full-name alias). If a year is known from the
  file, acquisition history or filename, prefer candidates within ±1 year; a large disagreement
  downgrades confidence. There is no second provider to try when this search finds nothing.
- **Acquisition history is a hint only.** A linked download title/author/year may improve a query, but
  it never authorises an automatic write and never outranks file metadata.
- **Confidence levels:**
  - `high`: valid ISBN match with compatible title/author, or an exact normalised title plus a
    surname match plus a compatible year and a single clear edition candidate.
  - `medium`: fuzzy title match, title-only match, ISBN match with a conflicting title/author, or
    several plausible candidates.
  - `none`: no candidate, conflicting authors, or only a generic/common title.
- Only `high` may be applied automatically, and only to missing fields. `medium` is returned as a
  review list. `none` writes nothing.
- When two candidates are both `high` but disagree on cover or description, downgrade to `medium` and
  require a choice. Never pick the first search result for a cover.

### Provenance and write rules

- Existing embedded metadata is authoritative. A non-empty field from the file is **not** a gap and is
  not enriched automatically. This includes title, authors, series, language, description, publisher,
  published date, identifier and cover.
- **Cover boundary.** A generated cover plate, or the absence of any cover, is an explicit gap and
  may be replaced by a high-confidence online cover. An embedded or PDF-rendered cover is **never**
  replaced by the automatic path, even on a high-confidence metadata match. Replacing a real cover
  requires the explicit manual chooser in `cover-picker.md` and an explicit “Use this cover”.
- Record provenance only where it changes the write rule: `manual` for anything the reader edits, and
  the source name for fields written by enrichment. A field with no provenance row is file-derived
  (embedded or filename) and is protected. This keeps a compact schema while making the invariant
  obvious.
- A manual edit wins forever. A later refresh, batch, rescan or source change may not touch it.
  Clearing a manual edit returns the field to the enrichment/file policy rather than silently filling
  it in the same action.
- Online-derived fields may be refreshed by the same source on an explicit refresh. Accepting a
  different candidate is an explicit replacement; there is no automatic source switch.
- Reverting removes online-derived blurb/cover values, restores the file’s own values when available,
  and falls back to the generated plate when no file cover exists. Manual edits are not touched by
  revert unless the reader chooses to clear them.
- All writes happen in one transaction after the result is validated. A cancelled or superseded lookup
  performs no partial write.

### Cover pipeline

- Request the largest available cover for the matched edition: Open Library `L`, or the Internet
  Archive item thumbnail only when the `ocaid` is edition-linked and the item is usable. Do not fetch
  multiple sizes in production.
- Enforce a short timeout (10 s connect, 20 s total), a response-size ceiling (2 MiB), and an image
  content-type check. Reject HTML error pages, SVG, animated images and unknown formats.
- Decode the image and require a portrait aspect ratio in the range roughly 1.25–1.9 height/width and
  a minimum useful size (at least 300 px wide and 450 px tall). Reject landscape, square, extremely
  tall, corrupt, or upscaled-from-tiny images.
- Preserve the artwork: fit the source inside the existing 600×900 JPEG cache with a neutral plate
  rather than cropping. Encode at the existing quality (JPEG q80) and cache it content-addressed under
  app data, exactly like file covers. Never write a cover into the library folder or into the book
  file.
- The Flip uses the existing cover frame and `object-fit: contain`-style treatment. No new visual
  frame, barcode, rating badge or marketplace chrome.
- The automatic cover write is allowed only when the book currently has no cover or a generated plate.
  If the book has an embedded or PDF-rendered cover, this pipeline may validate and report a candidate
  but must leave the existing cover in place; replacement is the cover picker’s job.
- If the best candidate has no valid cover but has a good blurb, apply the blurb only. If the cover is
  rejected, keep the generated plate and record the rejection in diagnostics without a full URL.

### Blurb pipeline

- Prefer the edition description; fall back to the work description, then to the linked Internet
  Archive item description when the Open Library edition exposes an `ocaid` and the item is usable.
  Do not search Internet Archive independently for a blurb.
- Strip HTML tags, decode common entities, collapse whitespace and trim, using the same plain-text
  rules as the embedded-metadata path. Reject empty strings, bare URLs, tables of contents, and text
  that is obviously a retailer boilerplate (“About the author”, “Look inside”).
- Cap the stored blurb at a sensible length (for example 4,000 characters) and preserve paragraph
  breaks for readability. The existing `blurb` element renders it; no new panel is introduced.
- If no blurb exists, keep “No blurb was printed with this edition.” Do not generate, summarise or
  paraphrase a description.

### Network policy, queue, batching, cancellation and retry

- All enrichment traffic goes through one service-level queue. Only one request per source is in
  flight; the queue is fair and cancellable. There is no second general provider to fall through to.
- Open Library requests send a descriptive `User-Agent` containing the app name and project contact
  so the identified limit applies. Rate-limit to about 3 requests/second (minimum ~350 ms between
  requests) and do not exceed the anonymous 1/second fallback if the contact header is unavailable.
  Cover downloads are slower: at most one every ~3 seconds, respecting the 100-per-5-minutes guidance.
- Internet Archive metadata/thumbnail requests are slower still (one at a time, roughly one per
  second) and are only made after an Open Library edition yields an `ocaid`. Honour normal robot
  etiquette and stop the supplement for the run on `429`.
- Use `search.json` with a narrow `fields` list for the Open Library title+author search so one
  request returns the candidates needed; do not issue one request per field. ISBN lookups are one
  edition request, with at most one work request when the edition lacks a description.
- Retry only network errors, timeouts, `5xx` and `429`, with exponential backoff and jitter (roughly
  1 s, 4 s, 12 s), honouring `Retry-After` and a maximum of three attempts. Do not retry `400`, `401`,
  `403`, `404` or malformed responses.
- Cancellation uses a generation/request token. Leaving the Flip, closing the app, starting a new
  lookup for the same book, or cancelling a batch invalidates the token; the service discards any
  late result and writes nothing.
- A temporary Open Library failure is retried within the same lookup. If it still fails, the result is
  `unavailable`, the file’s own details remain, and the reader may retry later. Never invent a second
  source, silently switch providers, or retry a permanent failure.

### Caching, TTL and refresh

- Store successful enrichment per book and source with the matched source key, confidence,
  applied fields, attribution, cover cache reference and a fetched timestamp.
- Successful metadata and covers are fresh for 30 days. A no-match result is cached for 7 days. A
  temporary failure is not cached as a no-match; it may be retried after a short cooldown (about
  15 minutes).
- Opening the same book within the TTL makes no network request. “Refresh details” forces a bypass and
  may replace online-derived fields, but never manual or embedded data.
- Cache keys include the source and the matched identifier, so an Open Library record and an Internet
  Archive supplement never collide. Store ETag/Last-Modified when a source supplies them and
  revalidate on a forced refresh.
- Online cover files are content-addressed and reused across refreshes. Removing the cache or
  clearing app data leaves the catalogue intact; covers regenerate from the file or a later lookup.

### Failure states and attribution

- Failure copy is calm and specific, and never blocks reading:
  - offline: “You’re offline. The book is still here; details were not updated.”
  - no match: “No online match found for this edition.”
  - ambiguous: “More than one edition might match. Choose the right one.”
  - rate limited: “Open Library asked the app to slow down. Try again in a moment.”
  - no second source: “No other free online source is available. The file’s details are unchanged.”
  - supplement unavailable: “The linked Internet Archive scan could not add anything.”
  - bad cover: “The cover offered for this edition was not usable. The file’s cover is unchanged.”
- The Flip gains a quiet attribution line, for example “Cover and blurb from Open Library” with a
  link to the matched edition. Per-field wording is used when sources differ: “Cover from Open
  Library · Blurb from Internet Archive”.
- Open Library gets a courtesy link to its edition/work page. Internet Archive gets an item link.
  Source links open externally through the platform, not inside the reader.
- Attribution is also recorded in the About/credits area and `THIRD_PARTY_NOTICES.md`.
- Open Library data is treated as personal-use catalogue data; the app does not bulk-download or
  redistribute covers. Internet Archive material is used only for the linked item and respects the
  item’s access/licence. No keyed or paid source is integrated, so there is no Google/Hardcover
  branding or key handling.
- A “Wrong details?” action offers edit, choose another candidate for missing fields, revert, and
  open the cover picker for a real-cover replacement. Diagnostics record the source, outcome code and
  field names, but not the full query text or cover URL.

### Data model and backup

- A schema migration adds:
  - an enrichment cache table keyed by book and source, holding the matched key, confidence,
    applied/attribution metadata, fetched time and cache status;
  - a per-field provenance table recording only `manual` and online-source fields, so the write rule
    is data-driven rather than inferred from strings;
  - settings for the online-details mode only. There is no provider-selection setting and no key
    field.
- `cover_source` gains online values (`open_library`, `internet_archive`) in addition to `embedded`,
  `rendered` and `generated`. It remains internal and is not exposed as a filesystem detail.
- `BookDetail` gains safe enrichment state and attribution (source label, public URL, fields, whether
  a lookup or manual cover choice is available). It does not expose paths, secrets or candidate
  payloads beyond what the review UI needs.
- Manual edits and the resulting cover are part of the catalogue and belong in backup/restore. The
  enrichment cache itself is derived and may be excluded; after a restore, missing enrichment can be
  fetched again. There are no keys to back up or leak.
- Rescanning a book file does not change its provenance. If a file’s embedded metadata changes, the
  scan may update file-derived fields but must not overwrite manual fields or silently discard an
  online or manually chosen cover.

### UI details

- Settings: an “Online details” section with mode buttons, a short source explanation, and a
  foreground “Fill missing details…” action with a count and cancel button. It states that Open
  Library receives only title/author/ISBN, that the supplementary Internet Archive read is linked by
  the Open Library edition, that there is no key or subscription, and that the app never sends the
  library.
- Flip: keep the existing cover frame, blurb slot, meta strip and Read button. Add a small
  “Look up details”/“Refresh details” action in the existing overflow menu, an attribution line under
  the blurb, and a “Wrong details?” action. Opening the cover itself belongs to the manual cover
  picker (`cover-picker.md`), not this menu. A review sheet lists candidates with thumbnail, title,
  author, year and publisher; it is dismissible and never auto-selects.
- States are explicit: idle, looking up, applied, needs review, no match, offline, rate limited,
  source error, supplement unavailable. The cover frame and blurb remain stable while a lookup runs;
  a small progress indicator is enough. Reduced-motion and large touch-target rules apply.
- The visual language stays Victorian: brass text buttons, serif labels, muted rules. No new modal
  chrome, no marketplace badges, no rating stars.

## Testing Decisions

- **Good tests assert user-visible outcomes through a seam, not internals.** For this feature:
  “opening a book with no cover and an exact ISBN writes the matched cover and blurb”, “an embedded
  description survives a lookup”, “a manual edit survives a refresh”, “an ambiguous title applies
  nothing and returns candidates”, “cancelling writes nothing”.
- **Primary seam: the core command API.** Extend the existing command-API tests with a fake
  `MetadataProvider` that returns deterministic candidates, covers and failures. Prefer command-level
  tests over testing the matcher or HTTP client directly. Follow the `Api::open_with_search` pattern
  for injecting the provider; a new test constructor should let tests supply enrichment providers
  without touching the network.
- **Provider HTTP seam:** reuse the acquisition fake HTTP server pattern for Open Library and the
  linked Internet Archive supplement: search JSON, edition JSON, work JSON, IA metadata, cover
  bytes, 404, 429 with `Retry-After`, 500, timeout, malformed JSON, wrong content type, oversized
  image and landscape image. No test may touch the public internet.
- **Secondary seam: the web `Platform` mock.** Add mock enrichment methods and scenarios to the
  existing Playwright platform mock so the Flip and Settings can be tested without Rust. Cover:
  off-by-default copy, opt-in, per-book lookup, applied blurb/cover, review candidates, no match,
  offline/rate-limit copy, no-fallback copy, cancel, attribution line, revert and manual edit
  protection.
- **Command-API cases:**
  - default settings make zero provider calls;
  - ISBN-10 and ISBN-13 normalisation and invalid check digits;
  - exact ISBN edition match prefers the edition cover and work description fallback;
  - title+author match with punctuation/article/subtitle differences;
  - conflicting author or year downgrades to review;
  - two high candidates with different covers downgrade to review;
  - high-confidence result fills only empty fields;
  - embedded description/cover is untouched;
  - generated plate is upgraded; embedded/rendered cover is **never** replaced automatically;
  - a high-confidence metadata match against a book with a real cover updates only the missing blurb;
  - manual edit survives refresh, batch and rescan;
  - revert restores file values and generated plate;
  - no-match negative cache prevents a repeat request within TTL;
  - forced refresh bypasses the TTL;
  - 429 honours `Retry-After` and is not cached as no-match;
  - 401/403 stops the source and does not retry;
  - cancellation during lookup writes nothing;
  - a late response for a superseded generation is discarded;
  - HTML/markup and overlong blurbs are cleaned or bounded;
  - invalid, landscape, tiny and oversized covers are rejected with the old cover retained;
  - no API-key field exists and no keyed source is called;
  - an Open Library failure produces a clear no-fallback outcome, not a second source call;
  - Internet Archive is consulted only with an `ocaid`, not by title+author, and access-restricted
    items are skipped;
  - attribution and source URLs are present only when an online field was actually used.
- **Playwright cases:** enable online details from Settings; open a coverless book; see the lookup
  state and then the blurb/cover; see “No online match” and keep the generated plate; open the review
  sheet and choose a candidate; press “Wrong details?” and revert; edit a blurb and confirm a later
  refresh leaves it alone; start and cancel a batch; confirm the no-fallback message; confirm
  keyboard/screen-reader labels and reduced motion.
- **Prior art:** `core/tests/metadata.rs` for cover/metadata behavior, `core/tests/acquisition.rs` for
  the fake HTTP server, `core/tests/command_api.rs` for command-level assertions, and the Playwright
  platform mock for UI states. The existing tests already assert that covers are JPEG data URLs and
  that rescanning is idempotent; extend those patterns rather than adding component-level tests.

## Out of Scope

- A full manual metadata editor for title, authors, series, publisher, identifiers and every other
  field. This spec adds blurb enrichment and protection, not a general cataloguing form.
- Manual cover replacement; that is specified separately in `cover-picker.md`. This spec only defines
  automatic upgrade of a generated/missing cover and the rule that a real cover is never replaced
  automatically.
- Writing metadata or covers back into EPUB/PDF files, sidecar metadata files, or the library folder.
- Bulk automatic enrichment of the entire library, background crawling, scheduled sync, or scraping
  provider HTML.
- Amazon, Goodreads, LibraryThing or other scraping sources; DRM removal; audiobook metadata.
- Any user-supplied API key, OAuth account, paid plan, keyed source, or shared secret. This includes
  Google Books, Hardcover and ISBNdb, all rejected under the free/keyless constraint.
- Multi-provider merging of conflicting blurbs, AI summaries or generated descriptions, translation,
  ratings, reviews, prices, availability or marketplace links.
- Changing acquisition, reading, shelving, labels, status, annotations, backup format beyond the new
  manual-edit provenance, or the visual fidelity work.
- Offline lookup via bundled dumps. A curated local dump could be a later feature, but it is a
  different storage and update problem.
- iOS, desktop and web builds.

## Further Notes

- **Why Open Library only?** It is the only free, keyless, general-purpose source with both covers
  and a work/edition model. Google Books now fails keyless requests and needs a user key, which is out
  of scope. Hardcover needs a token, BookBrainz is alpha/sparse, Wikidata has no blurbs/covers, and
  ISBNdb is paid. Internet Archive is a keyless supplement tied to an Open Library `ocaid`, not a
  second general catalogue.
- **No second fallback is a deliberate product decision.** It is better to show “No online match” and
  keep the file’s details than to add a hidden keyed integration, a shared secret, or a confusing
  “bring your own key” setup.
- **Known risk: Open Library descriptions are patchy.** The live ISBN check found an edition and work
  with no description at all. The feature must treat “cover found, blurb absent” as a normal success,
  not a failure. The manual cover picker and blurb editing are the escape hatches; there is no keyed
  fallback.
- **Known risk: volunteer capacity.** Open Library explicitly asks clients not to behave like a bulk
  backend. The per-book, cached, one-request-per-open design is a requirement, not an optimisation.
  A rate-limit response must be visible and must not trigger a retry storm.
- **Known risk: cover rights.** Open Library asserts no new database copyright but does not guarantee
  every cover image is free of third-party rights. The app is personal and does not redistribute the
  cache; attribution and a source link are still shown. A future public build would need a takedown
  contact and a more formal review.
- **Known risk: title+author false positives.** Common titles and translations make automatic cover
  matching risky. The confidence rules deliberately prefer a blank cover over a plausible wrong one;
  the review sheet and manual cover picker are the release valves.
- **Privacy note:** the User-Agent identifies PocketLibrary and a project contact, not the reader. The
  app does not send a device id, account, library size, reading progress, annotations or file bytes.
  No API key exists to store, leak, back up or display.
- **Delivery suggestion:** ship Open Library plus the `ocaid`-linked Internet Archive supplement, the
  off/ask/automatic settings, review, revert and cache. Ship the manual cover picker alongside or
  immediately after it, because it is the safety valve for wrong-edition matches. Do not add a keyed
  provider later without a new product decision.
- **Research date:** 26 November 2026. Provider quotas, pricing and terms change; re-check the linked
  pages before a release.
