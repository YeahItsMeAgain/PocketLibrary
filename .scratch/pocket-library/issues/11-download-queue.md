# 11: Download queue

**What to build:** A book found in search can be downloaded inside the app: resolved through the mirror chain, resumed if interrupted, validated, deduplicated, saved with a sensible name, and placed on the lowest shelf with room. The queue survives restart.

**Blocked by:** 03, 04, 10

**Status:** ready-for-agent

- [ ] A result downloads through the resolver and lands in the library folder
- [ ] Downloads use HTTP/1.1, Range resume, content-length checks, and magic-byte validation; truncated files are rejected
- [ ] Two downloads run concurrently; the queue persists and resumes after relaunch
- [ ] Progress and cancel work; the search surface shows a download badge and a queue view
- [ ] The result md5 is checked before download and the file's BLAKE3 after; duplicates are discarded and linked to the existing book
- [ ] The file is named `Author - Title (Year).epub|pdf`, sanitised, with a numeric suffix on collision
- [ ] On completion the book appears on the lowest shelf with room and the wall scrolls to it
- [ ] Failures show "Trying another mirror…" and then a retryable reason; offline is explicit
