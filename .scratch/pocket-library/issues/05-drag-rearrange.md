# 05: Drag and rearrange

**What to build:** Long-press lifts a book into the hand; drag reorders it on its shelf or moves it to another shelf, with the wall auto-scrolling at the edges. Other books slide aside to show the drop gap. A short tap still opens the book.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Long-press (~380 ms) lifts a book; a short tap opens the detail
- [ ] Dragging within a shelf reorders it and persists
- [ ] Dragging onto another shelf moves it there; holding at the top/bottom edge scrolls the wall and makes the next shelf a valid target
- [ ] A visible gap shows the drop position and other books slide aside
- [ ] Dropping outside a valid shelf returns the book to its original slot
- [ ] Drag updates are arithmetic on the model, not whole-library DOM measurement
- [ ] Filters can be active; they still only dim and never move books
