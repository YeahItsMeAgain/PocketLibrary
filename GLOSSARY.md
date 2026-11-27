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

**Spine**:
The narrow strip a book shows when it sits on a shelf: either the generated spine or the typographic fallback.
_Avoid_: side, edge

**Spine engine**:
The on-device pipeline that generates a spine from a book's cover and text, producing either cover art or a typographic fallback. It runs locally and never touches the network.
_Avoid_: model, generator, spine service

**Spine artifact**:
The cached result for one book: the art, spine and fallback images plus route, verdict, mask coverage and run/QA data. It is complete only when its `artifact.json` has been written.
_Avoid_: output, image, cache file

**Spine style**:
How a generated spine is presented: `art`, `cloth` or `typography`. This is the per-book `Book.spineStyle` value (optional on the wire; absent means `art`, shown in the UI as **Art**). Art is the generated art spine that runs to the top edge with a foot band holding the full author over two lines and the label chips; `cloth` is a textured woven board; `typography` is the original flat, untextured two-tone board. Only `art` paints generated art. It is not the generation route or the QA verdict.
_Avoid_: route, verdict, layout, theme

**Backfill**:
The one-time job that queues the existing library for spine generation when it has not been processed for the active model bundle.
_Avoid_: sync, import

**Bundle id**:
The version identifier of the spine model set (currently `spine-v1`). It is part of a spine cache key, so a new bundle id invalidates earlier artifacts.
_Avoid_: version, model name

**Stage**:
One coarse step of spine generation for a single book: `art` (cover art), `text` (typographic spine) or `check` (QA verdict).
_Avoid_: step, phase, status
