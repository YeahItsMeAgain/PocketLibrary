# 05: Drag and rearrange

**What to build:** Long-press lifts a book into the hand; drag reorders it on its shelf or moves it to another shelf, with the wall auto-scrolling at the edges. Other books slide aside to show the drop gap. A short tap still opens the book.

**Blocked by:** 04

**Status:** awaiting-device-test

- [x] Long-press (~380 ms) lifts a book; a short tap opens the detail
- [x] Dragging within a shelf reorders it and persists
- [x] Dragging onto another shelf moves it there; holding at the top/bottom edge scrolls the wall and makes the next shelf a valid target
- [x] A visible gap shows the drop position and other books slide aside
- [x] Dropping outside a valid shelf returns the book to its original slot
- [x] Drag updates are arithmetic on the model, not whole-library DOM measurement
- [ ] Filters can be active; they still only dim and never move books

## Notes

**Core.** `Api::move_book(book_id, shelf_id, slot_index)` and the `move_book` Tauri command place a book at its final slot. Within a shelf it compacts the remaining books and inserts at the requested index; across shelves it closes the source gap and shifts the target, rejecting a full target with `shelf_full`. Negative or out-of-range slots and missing shelves return `invalid_target`, a same-slot move is a no-op, and a missing book returns `book_not_found`. Placement is the only field changed, so status, labels, progress and locator survive; all mutations run in one transaction and a rejected move rolls back.

**UI.** A 380 ms long-press lifts the spine into a fixed ghost that follows the pointer with `transform`/`opacity` only; a short tap still opens the detail. Shelf geometry and spine centres are cached at lift/scroll/resize time, and pointer moves do arithmetic against that cache to choose the target shelf and index. The preview reorders the model list, FLIPs only the affected shelves, and leaves the lifted book's slot as the visible source/drop gap. Holding within 88 px of the top or bottom edge auto-scrolls the wall; dropping outside a shelf or on a full shelf returns the ghost and leaves the order unchanged. The commit goes through `platform.moveBook` and preserves scroll. The one-time hint is positioned above the drawer pull and stored in `localStorage`; reduced motion skips the return animation.

**Tests.** `core/tests/rearrange.rs` covers forward/back same-shelf reorder, a cross-shelf move into the middle, source compaction and contiguous target slots, full-target rejection, invalid targets/no-op, preserving status/labels/progress/locator, and persistence across reopen. `tests/e2e/rearrange.spec.ts` covers long-press reorder, cross-shelf edge auto-scroll, short-tap detail, invalid drop return, the one-time hint, and no horizontal overflow at 390x844.

**Deferred to 06.** Filters do not exist yet, so the filter/dim box stays unticked; the drag preview operates on the whole model and introduces no filter-dependent movement.

**Device-only checks.** Real Android long-press feel and vibration, edge auto-scroll against WebView momentum, reduced-motion behaviour, and drag performance at 4x CPU throttle (target ~0.4 ms per pointer update) still need a phone pass.

## Verification

- `cargo test --manifest-path core/Cargo.toml`: 7 rearrange tests pass (full suite green).
- `npm run test:e2e`: 18 passed.
- `npm run build` and `npx tsc --noEmit`: pass.
- Android `cargo clippy --target aarch64-linux-android --all-targets -- -D warnings`: pass.
- `cargo fmt --check` for core and Tauri: pass.

**Release APK.** `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 15,795,654 bytes, SHA-256 `80469da796138abe69b770b6f9c41d196fe2e1b5a7d7ae9fcc9c41d57ff94147`, signer `CN=PocketLibrary`.

**Public URL.** Served over a temporary tunnel for the device test (URL not retained); it returned HTTP 200 with the same 15,795,654-byte file.
