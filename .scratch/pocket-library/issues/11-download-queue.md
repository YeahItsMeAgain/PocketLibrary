# 11: Download queue

**What to build:** A book found in search can be downloaded inside the app: resolved through the mirror chain, resumed if interrupted, validated, deduplicated, saved with a sensible name, and placed on the lowest shelf with room. The queue survives restart.

**Blocked by:** 03, 04, 10

**Status:** awaiting-device-test

- [x] A result downloads through the resolver and lands in the library folder
- [x] Downloads use HTTP/1.1, Range resume, content-length checks, and magic-byte validation; truncated files are rejected
- [x] Two downloads run concurrently; the queue persists and resumes after relaunch
- [x] Progress and cancel work; the search surface shows a download badge and a queue view
- [x] The result md5 is checked before download and the file's BLAKE3 after; duplicates are discarded and linked to the existing book
- [x] The file is named `Author - Title (Year).epub|pdf`, sanitised, with a numeric suffix on collision
- [x] On completion the book appears on the lowest shelf with room and the wall scrolls to it
- [x] Failures show "Trying another mirror…" and then a retryable reason; offline is explicit

## Notes

- **Resolver.** `ads.php?md5=` is fetched with the Chrome-impersonating `wreq` client, the `get.php?md5=&key=` link is parsed, and its 307 is captured without downloading the payload. Each mirror gets one key re-mint before failover; the request carries every `ads.php` mirror from the result, persisted as JSON so a retry uses the same list. A broken mirror moves to the next before the row fails.
- **Transfer.** A separate HTTP/1.1 `wreq` client sends `Range` from the persisted `.part` length, requires an exact `Content-Length`/`Content-Range`, streams to app-private `<id>.part`, checks EPUB `PK\x03\x04` / PDF `%PDF-`, and rejects truncation. Progress is written to SQLite per chunk for polling. `.part` lives across relaunch, so Range resume works after a restart.
- **Queue.** Schema v3 rebuilds `downloads` with queue fields. Rows run two at a time; `running` rows are returned to `queued` on startup and resumed. Cancel uses an in-memory flag plus a DB state; retry requeues a failed/cancelled row and keeps its part. A single worker loop is guarded by an atomic; an enqueue in the closing gap starts another pass.
- **Duplicates and landing.** Completed md5 is answered from history before any network. After the transfer, BLAKE3 is compared with the catalogue; a match discards the bytes and links `book_id`. New bytes are written under `Author - Title (Year).ext`, sanitised and numbered before the extension, then parsed through the existing metadata/cover path, placed on the lowest shelf with room (appending when full), and returned to the UI.
- **SAF.** `SafDownloadSink` writes a hidden `.part` document in the granted root and renames it to the final name, so no partial book is exposed. The UI polls the queue, shows a brass active badge, percentage progress, cancel and retry, and the app-level poll refreshes the wall and scrolls to the new spine even if the user has left Search.
- **Tests.** Fake HTTP server + fake sink cover the full 307 chain, HTTP/1.1, Range resume, truncation, wrong magic, key re-mint, mirror failover, md5 pre-check, BLAKE3 post-check, restart persistence, two-concurrency, naming/collision and lowest-shelf landing. Playwright covers queued/running progress, cancel, failure/retry, completion, wall refresh and background completion.

## Verification

- `cargo test --manifest-path core/Cargo.toml` — 20 lib + 10 acquisition (1 ignored live) + 12 downloads + 48 other integration tests pass.
- `cargo clippy --manifest-path core/Cargo.toml --all-targets -- -D warnings` — pass.
- `npm run test:e2e` — 60 pass, including the download queue and background wall refresh.
- `npm run build`, `npx tsc --noEmit` — pass.
- Android clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` — pass.
- Release APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 34,514,902 bytes, SHA-256 `825ad479e4fdde36d22aca4652264c9d9cd57fce5fa481d1f81c095da8ef9c1d`. Signer DN `CN=PocketLibrary, O=Personal, C=US`.

## Device-only checks

- A real Libgen download end to end from a phone network (search → ads → get → CDN → shelf).
- A large file (100 MB+) to watch progress, memory and the app staying responsive.
- SAF write/rename into `Documents/PocketLibrary` on a real provider, including a collision suffix.
- Background/relaunch resume: kill the app mid-download, reopen and confirm the row resumes with Range.
- Cancel during a slow real transfer and retry a mirror failure.
