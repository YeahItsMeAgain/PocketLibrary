# 12: Backup and restore

**What to build:** Export the irreplaceable part of the library — shelves, labels, reading state and positions, annotations, settings, download history — to one versioned file, and restore it later by merging or replacing.

**Blocked by:** 06, 07, 09

**Status:** ready-for-agent

- [ ] Export writes one versioned archive containing the metadata and optional covers, not the books, via the system file picker
- [ ] Import inspects the archive and reports matched and new entries before applying
- [ ] Merge matches by content hash, adds missing entries, never deletes, and never overwrites a newer reading position
- [ ] "Replace current library data" is available behind an explicit confirmation
- [ ] A corrupt, older, or wrong-schema archive is rejected with a clear reason
- [ ] No book files are copied or moved by export or import
