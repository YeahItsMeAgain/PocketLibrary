# 04: Placement and shelves

**What to build:** Books live on shelves with a fixed capacity, placed by the user. A new book lands on the lowest shelf with room; if every shelf is full the app appends one and places the book there. Placement survives relaunch. There are no shelf management controls.

**Blocked by:** 02

**Status:** claimed

- [ ] A new book goes to the lowest shelf with room
- [ ] When no shelf has room, a new shelf is appended and the book is placed there (no undo)
- [ ] Shelf capacity comes from settings (default 12) and is enforced
- [ ] Shelf and slot persist across relaunch
- [ ] No rename/reorder/add/delete shelf controls exist anywhere
- [ ] Returning from a book restores the same shelf and scroll position
