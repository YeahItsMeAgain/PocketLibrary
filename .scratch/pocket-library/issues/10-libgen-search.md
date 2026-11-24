# 10: Libgen search

**What to build:** A front-desk search over Libgen's live LG+ mirrors: basic and advanced fields, client-side filtering where Libgen ignores filters, paged results, result detail with mirrors, automatic mirror failover, and a clear offline/error state. No Anna's Archive and no external-browser fallback.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Search accepts title/author plus year range, language, format, publisher, ISBN, and MD5
- [ ] Results parse the LG+ result table, show title, author, year, format, size, and source, and page 25 at a time
- [ ] Format/language/year filters are applied client-side with an honest count
- [ ] A result opens a detail sheet with metadata, mirrors, and a Download action
- [ ] Mirror failover is automatic and SLUM status is used only as a health hint
- [ ] TLS impersonation is wired through the chosen HTTP client and covered by a fixture test
- [ ] Offline and all-mirrors-failed states are explicit; no Anna's Archive path exists
- [ ] Searching "Rock Paper Scissors" by Alice Feeney returns the expected EPUB result
