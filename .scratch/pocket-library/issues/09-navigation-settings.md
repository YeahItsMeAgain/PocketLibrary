# 09: Navigation and settings shell

**What to build:** The hidden brass drawer opens Library, Search, and Settings by pull or gesture and closes by drag, scrim, Escape, or Android back. Settings holds folder, rescan, reader defaults, download naming, and About. Empty and permission-recovery states are reachable from here.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A brass pull at the bottom edge opens the drawer by tap, upward swipe, or drag
- [ ] Library, Search, and Settings each open their surface; Library returns to the wall
- [ ] Dragging the drawer down past the threshold closes it; otherwise it snaps back
- [ ] Escape and Android back close one layer at a time and never leave the app while a layer is open
- [ ] Settings shows library folder + rescan, reader defaults, download naming, and About
- [ ] The drawer hint appears once and does not return after dismissal
