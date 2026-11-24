# 03: Identity, metadata, covers, and duplicates

**What to build:** Every book gets a content identity and real metadata. Rename or move the file and it stays the same book. Identical bytes are not imported twice. The detail view shows the actual cover, blurb, metadata, and the Read and Back controls.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Title, author(s), series, language, description, publisher, date, and identifier are read from EPUB/PDF metadata, with filename fallback
- [ ] A cover is extracted or rendered and cached; a generated cover is the fallback
- [ ] Duplicate detection uses content, not filename; re-importing identical bytes is rejected
- [ ] Renaming or moving a file preserves its identity, labels, status, and position
- [ ] The detail view shows the real cover large, blurb, metadata, Read/Continue, and Back to shelf
- [ ] A malformed book is skipped with a visible reason and does not crash the scan
