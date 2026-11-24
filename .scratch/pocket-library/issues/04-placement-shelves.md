# 04: Placement and shelves

**What to build:** Books live on shelves with a fixed capacity, placed by the user. A new book lands on the lowest shelf with room; if every shelf is full the app appends one, places the book there, and offers undo. Placement survives relaunch. There are no shelf management controls.

**Blocked by:** 02

**Status:** awaiting-decision

- [x] A new book goes to the lowest shelf with room
- [x] When no shelf has room, a new shelf is appended, the book is placed there, and an undo notice appears
- [x] Shelf capacity comes from settings (default 12) and is enforced
- [x] Shelf and slot persist across relaunch
- [x] No rename/reorder/add/delete shelf controls exist anywhere
- [x] Returning from a book restores the same shelf and scroll position

## Notes

**Audit (2026-11-24).** Ticket 02 already placed new books on the lowest shelf with room and appended a shelf when every shelf was full. It did not expose capacity as a setting, had no undo, and had no tests for spillover, persistence, or the absence of shelf controls. The scan path was kept; capacity and undo were added around it.

**Undo interpretation (needs the user).** Undo removes the just-imported book record and the trailing shelf the scan appended for it. It never touches the book file; the notice after undo reads exactly `Removed from the library — the file stays in your folder`, and a rescan re-adds the book. Undo is a no-op when the book has moved to another shelf, is gone, or the appended shelf now holds another book. Only a non-seed trailing shelf can be removed.

**Scope conflict.** Commit `592efc6` ("docs(scope): defer auto-append undo") says undo was deferred at the user's request. This implementation includes undo because the delegated brief explicitly asked for the default semantics above. If the deferral is final, the undo call, notice, and tests can be removed without affecting placement or capacity. Hence `awaiting-decision`, not `awaiting-device-test`.

**Changed.** Core: `Placement` entries in `ScanReport`, `undo_placement`, `shelf_capacity`/`set_shelf_capacity` (persisted in `settings`, applied to every shelf), capacity enforcement on allocation. UI: undo notice on the wall, exact post-undo message, and a Settings shelf-capacity control. No shelf management affordance was added.

**Tests.** `core/tests/placement.rs` covers spillover to the next shelf, choose-lowest-with-room (not the last), append when every shelf is full, undo (record and shelf removed, file still in the fake folder, rescan re-adds), undo no-op when the shelf gained a book, capacity persistence and enforcement across reopen, and invalid capacity. Playwright covers the undo notice, no shelf-management controls, and the same shelf/scroll position after detail.

**Verification.** `cargo test --manifest-path core/Cargo.toml` (49 passed), `npm run test:e2e` (14 passed), `npm run build`, `npx tsc --noEmit`, Android `cargo clippy --target aarch64-linux-android --all-targets -- -D warnings` all green.

**Release APK.** `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 15,790,150 bytes, SHA-256 `65cc7ed266bbe49be137d866108769de9330a8cdeb38196eda86df83694532e6`, signer `CN=PocketLibrary`.
