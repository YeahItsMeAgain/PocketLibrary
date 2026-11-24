# 01 — Shelf interaction and spatial model

Type: prototype
Mode: HITL
Status: resolved
Blocked by:

## Question

What does the shelf wall actually look and feel like, and how does the user manipulate it?

Decide, with a throwaway UI prototype the user can drive: shelf geometry and capacity; how the wall scrolls (one bookcase, many bookcases, vertical or horizontal); whether books face spine-out, cover-out, or a mix; the pull-out and flip animation; drag-to-place and drag-between-shelves; where labels, reading-status stickers, and ribbons sit on a spine; the filtered view (labels, status); and the empty/full shelf states.

New books land on the lowest shelf with free space, and nothing reorders automatically. The prototype must make that behaviour obvious, including what a full library looks like when a new book arrives.

## Answer

Resolved 2026-11-24.

- **Movement:** one vertical wall of bookcases, continuous scroll from bottom to top. Shelf numerals are automatic and purely orientational.
- **Moving books:** tap opens the detail; **long-press lifts** a book into the hand; drag it along the shelf or onto another shelf; other books slide aside to expose the drop gap. Release drops it.
- **Full library:** if no shelf has room, the app appends a new shelf at the bottom, places the book there, and shows an undo notice. Importing is never blocked.
- **No shelf management.** Shelves are furniture, not collections: no names, no rename, no reorder, no add/remove controls, no management plaque. They exist only as space for books the user placed. The only meaningful object is the book and where the user put it.
- **Filters:** dim non-matching books, never move them. Clearing restores everything.
- **Return:** opening and closing a book returns to the same shelf and scroll position.


## Note (2026-11-24)

Undo for an auto-appended shelf is deferred; the user does not want it now.
