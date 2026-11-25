# PocketLibrary

A personal, offline-first Android library that looks and behaves like a Victorian reading room.

## Language

**Library**:
The user's whole collection: every known book plus the shelves those books sit on.
_Avoid_: catalog, database

**Book**:
One EPUB or PDF file in the library folder, with its metadata, cover, reading status, labels, and a position on a shelf.
_Avoid_: item, document, title

**Library folder**:
The single folder the user grants the app read/write access to. The only place books are read from and written to.
_Avoid_: storage, root, downloads

**Shelf**:
A physical board holding a fixed number of books in an order the user chose. It is furniture, not a query, and it is never reordered automatically.
_Avoid_: collection, category, list

**Placement**:
Putting a book on a shelf. New books go to the lowest shelf that still has room; after that, only the user moves them.
_Avoid_: sorting, filing

**Label**:
A reusable, named, coloured tag attached to any number of books. It is rendered as a sticker on the spine and acts as a filter.
_Avoid_: tag, category, folder

**Reading status**:
Whether a book is unread, being read, or finished. Set by the user or derived from reading progress, and shown as a sticker or ribbon on the spine.
_Avoid_: progress, state

**Finished**:
A reading status meaning the user has finished the book. It is also applied when a book's file disappears from the library folder, because the user chose never to drop a known book from the library.
_Avoid_: read, complete

**Delete**:
Remove a book from the library and delete its file from the library folder, after explicit confirmation. Different from a file disappearing on its own, which keeps the book as finished.
_Avoid_: remove, forget

**Flip**:
The book-detail interaction: a book comes off the shelf, opens, and turns to reveal its blurb, metadata, labels, status, and actions.
_Avoid_: detail view, modal

**Acquisition**:
Finding a book through Libgen or Anna's Archive and downloading it into the library folder, after which it is placed like any other import.
_Avoid_: download, purchase

**Reader**:
The in-app view that renders an EPUB or PDF and tracks reading position.
_Avoid_: viewer, renderer
