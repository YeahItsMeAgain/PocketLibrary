# 02: Onboarding, folder grant, and scan

**What to build:** First run explains Android folder access, opens the SAF picker, persists the grant, and scans recursively for EPUBs and PDFs. Books appear as spines on the wall. The grant survives relaunch; a revoked or moved folder shows a reconnect state, never a silent empty shelf.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] First run explains why a folder must be chosen and opens the picker; the user can create or choose a subfolder
- [ ] The read/write grant persists across force-stop and relaunch without re-picking
- [ ] Recursive scan finds `.epub` and `.pdf`, ignores hidden directories and other files
- [ ] Each found book produces a catalogue record and a spine on the wall
- [ ] An empty library shows empty shelves with "Add books" and "Find a book"
- [ ] A revoked or moved folder shows "Reconnect library folder" instead of an empty shelf
- [ ] Manual rescan adds new files and reflects removed ones without duplicating
