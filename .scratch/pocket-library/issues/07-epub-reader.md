# 07: EPUB reader

**What to build:** In-app EPUB reading behind a strict CSP: immersive chrome, tap zones, paginated or scrolled text, Contents with chapters and bookmarks, typography and themes, and remembered position.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] An EPUB opens in the reader with the strict CSP in place; a scripted EPUB cannot reach the app origin
- [ ] Centre tap toggles a slim top and bottom bar; left/right thirds page; first/last page does nothing
- [ ] Paginated mode and vertical scroll both work; the choice is global and remembered
- [ ] Contents sheet has Chapters and Bookmarks tabs; the bookmark button adds a ribbon and bookmarks survive relaunch
- [ ] Five sizes, three line spacings, two margins, Paper/Sepia/Night, and three bundled serifs all apply
- [ ] Position resumes on reopen, including after a re-render or a small text shift
- [ ] "Back to shelf" and "Open in another app" both work; back unwinds one layer at a time
