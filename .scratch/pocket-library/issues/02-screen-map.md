# 02 — Screen map and navigation

Type: grilling
Mode: HITL
Status: resolved
Blocked by:

## Question

What screens exist, and how does the user move between them?

Cover at least: first-run folder onboarding, the library wall, the book flip, the reader, acquisition search, download queue, label manager, reading-status controls, settings, and error/empty states. Decide the navigation model — back stack, bottom bar, or purely physical affordances — and where search, filters, and "add book" live.

The result should be a screen inventory with each screen's purpose, entry points, exits, and the states it must handle, explicit enough that the spec can assign routes and components.

## Partial answers (2026-11-24)

- **Navigation:** hidden by default, revealed by a gesture. No persistent tab bar. Gesture and drawer to be prototyped.
- **Acquisition:** the user does not want a verbal description; prototype the search → results → detail → download flow.
- **Labels:** managed from a "Manage labels" entry at the end of the shelf filter strip; labels also attachable from a book's detail. Status is not managed there.
- **Settings:** one screen: library folder + rescan, reader defaults, download naming, Export/Import library data, About.
- **First run:** one onboarding screen explaining Android folder access, then folder picker (`Documents/PocketLibrary`), scan, land on shelf. Empty library shows Add books / Find a book. Revoked permission or moved folder shows "Reconnect library folder" rather than an empty shelf.

## Answer

Resolved 2026-11-24. Prototype: `prototype/design/flows.html` (extends v4).

- **Navigation:** no persistent tab bar. A brass drawer pull at the bottom edge opens a drawer by tap, upward swipe, or edge drag; items are **Library**, **Search**, **Settings**. Swipe down, tap the scrim, Escape, or Android back closes it. Back unwinds one layer at a time (drawer → sheet → book detail) without leaving the app.
- **Library:** the vertical wall from ticket 01.
- **Book detail:** v4 framed panel with real cover, blurb, metadata, labels, progress, Read/Continue, and Back to shelf.
- **Reader:** in-app reader shell; see 14 for its final UX.
- **Acquisition:** "front desk" sheet over the wall. Query + collapsible advanced fields; results list (title, author, year, format, size, source); result sheet with cover, blurb, metadata, mirrors; Download with progress/cancel and background queue; completion adds the book to the lowest shelf with room and scrolls to it. Active downloads are a brass badge, not a tab.
- **Labels:** managed from "Manage labels" at the end of the shelf filter strip; also attachable from a book's detail. Reading status is not managed there.
- **Settings:** one screen — library folder + rescan, reader defaults, download naming, Export/Import library data, About.
- **First run:** one onboarding screen explaining Android folder access, then the folder picker (`Documents/PocketLibrary`), scan, shelf. Empty library shows Add books / Find a book. Revoked permission or moved folder shows "Reconnect library folder".
- **Failure states:** no silent empty shelves; download failures surface in the queue; offline acquisition explains itself.
