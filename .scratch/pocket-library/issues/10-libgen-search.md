# 10: Libgen search

**What to build:** A front-desk search over Libgen's live LG+ mirrors: basic and advanced fields, client-side filtering where Libgen ignores filters, paged results, result detail with mirrors, automatic mirror failover, and a clear offline/error state. No Anna's Archive and no external-browser fallback.

**Blocked by:** 09

**Status:** awaiting-device-test

- [x] Search accepts title/author plus year range, language, format, publisher, ISBN, and MD5
- [x] Results parse the LG+ result table, show title, author, year, format, size, and source, and page 25 at a time
- [x] Format/language/year filters are applied client-side with an honest count
- [x] A result opens a detail sheet with metadata, mirrors, and a Download action
- [x] Mirror failover is automatic and SLUM status is used only as a health hint
- [x] TLS impersonation is wired through the chosen HTTP client and covered by a fixture test
- [x] Offline and all-mirrors-failed states are explicit; no Anna's Archive path exists
- [x] Searching "Rock Paper Scissors" by Alice Feeney returns the expected EPUB result

## Notes

- **HTTP client: `wreq` 0.16.5, pinned.** The ticket's candidate integrated cleanly, including a `aarch64-linux-android` clippy run, so no reqwest/rustls fallback was needed. The provider builds one client with `Emulation::Chrome136` (browser TLS fingerprint + headers), 10 s connect / 20 s total timeouts, and follows redirects. Android builds need `ANDROID_NDK_HOME`; `scripts/android-env.sh` now exports it. A fixture test asserts the request carries a Chrome UA and browser headers.
- **Parser.** `core/src/acquisition/parse.rs` parses `#tablelibgen`'s nine columns, the `Files <span class="badge">N` total, `columns[]`-scoped URLs, md5/file id/size, and all mirror links except Anna's Archive. Title is the anchor text (the verbose author/publisher title stays in the row tooltip); authors split on `;`. Size is the printed text plus a rounded byte estimate until ticket 11's exact `content-length`.
- **Query mapping.** Title/author/publisher use `columns[]=t/a/p`; ISBN uses `columns[]=i`; MD5 uses `gmode=1&req=md5:<hash>`. `extension`, `language` and `year` are never trusted server-side; they are applied after parsing, and rows with an unknown year are dropped when a year range is set. Pages are 25 rows; the result count reports the mirror's unfiltered total and what the filters hid on this page.
- **Mirrors and health.** Compiled `.li → .bz → .vg → .la → .gl`. A per-device registry records real attempts, puts a host into exponential cooldown after two consecutive transient failures (15 s × 2ⁿ, 300 s cap), and lets a recovered host trial first. `status.json` is fetched at most every 10 minutes, honours ETag/304, only reorders/skips (never gates), and is refreshed in the background so a cold start searches immediately on the compiled list.
- **States and No Anna's.** Offline (every attempt failed at the network layer), all-mirrors-failed, mirror-format-changed, genuine no-results and client-filtered-to-zero are distinct typed states (`offline`, `all_mirrors_failed`, `mirror_format_changed`, `empty_search`). Result links containing Anna's Archive are filtered in the parser and there is no external-browser path.
- **Fixture.** Captured live `2026-11-25` from `libgen.li` with a desktop Chrome UA: page 1 (`Files 43`, 25 rows) and page 2 (18 rows, no overlap) for Rock Paper Scissors / Alice Feeney, plus a full `open-slum.org/status.json`. URLs, date and the acceptance md5 are recorded in `core/tests/fixtures/README.md`. A manual live test (`live_search_returns_the_acceptance_epub`, `#[ignore]`) returned 25 rows / total 43 from `libgen.li` and the expected Flatiron EPUB `a1423442916f2f3def9517a3bf4dee48`. It is not part of the offline suite.
- **UI.** `SearchView` in `src/App.tsx` replaces the placeholder: query + collapsible advanced fields, Search, result ledger with title/author/year/format/size/source, page controls, and a bottom detail sheet with metadata, mirror rows and a disabled Download labelled ticket 11. The Victorian palette, typography, rules and motion are reused; Back returns to the wall.

## Verification

- `cargo test --manifest-path core/Cargo.toml` — 17 lib + 10 acquisition (1 ignored live) + 49 other integration tests pass.
- `npm run test:e2e` — 56 pass, including six new front-desk tests (results/detail, advanced filters, paging, no results, offline/all-mirrors, back).
- `npm run build`, `npx tsc --noEmit` — pass.
- Android clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` — pass, including `wreq`/BoringSSL.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 34,401,750 bytes, SHA-256 `b71f1d5c5bb9e3ab83ce35705777645d257c997413a778b907bd856bf4733ec0`, signer DN `CN=PocketLibrary, O=Personal, C=US`. The published `tunnel.invalid` path returns HTTP 200 and the same byte size.

## Device-only checks

- Search from a phone network/carrier (not the build box): confirm `.li`/`.bz`/`.vg` answer under the WebView, and that a carrier that blocks Libgen lands on the offline/all-mirrors state rather than hanging.
- Let `.la`/`.gl` prove the Cloudflare path: force the unprotected tier to fail and check the browser-impersonated client clears the challenge or fails over cleanly.
- Watch a real 10-minute cycle: confirm SLUM reorders after the first background refresh and that two failures visibly cool a mirror without blocking the next search.
- Detail sheet scrolling, long md5 wrapping, disabled Download affordance and the 48 px paging controls at 390×844 with safe areas.
- Android back closes the detail sheet first, then returns to the wall.
