# 04: Placement and shelves

**What to build:** Books live on shelves with a fixed capacity, placed by the user. A new book lands on the lowest shelf with room; if every shelf is full the app appends one and places the book there. Placement survives relaunch. There are no shelf management controls.

**Blocked by:** 02

**Status:** awaiting-device-test

- [x] A new book goes to the lowest shelf with room
- [x] When no shelf has room, a new shelf is appended and the book is placed there
- [x] Shelf capacity comes from settings (default 12) and is enforced
- [x] Shelf and slot persist across relaunch
- [x] No rename/reorder/add/delete shelf controls exist anywhere
- [x] Returning from a book restores the same shelf and scroll position

## Notes

**Audit (2026-11-24).** Ticket 02 already placed new books on the lowest shelf with room and appended a shelf when every shelf was full. It did not expose capacity as a setting and had no tests for spillover, persistence, or the absence of shelf controls. The scan path was kept; capacity was added around it.

**Deferred.** Undo was deferred by the user on 2026-11-24.

**Changed.** Core: `Placement` entries in `ScanReport`, `shelf_capacity`/`set_shelf_capacity` (persisted in `settings`, applied to every shelf), capacity enforcement on allocation. UI: a Settings shelf-capacity control. No shelf management affordance was added.

**Tests.** `core/tests/placement.rs` covers spillover to the next shelf, choose-lowest-with-room (not the last), append when every shelf is full, capacity persistence and enforcement across reopen, and invalid capacity. Playwright covers no shelf-management controls and the same shelf/scroll position after detail.

**Verification.** `cargo test --manifest-path core/Cargo.toml` (48 passed), `npm run test:e2e` (13 passed), `npm run build`, `npx tsc --noEmit`, Android `cargo clippy --target aarch64-linux-android --all-targets -- -D warnings` all green.

**Release APK.** `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`, 15,785,158 bytes, SHA-256 `fcc3ceb6f595d62d0c70086c361a61d9d1d6ec075635ff90e86393bb2951eee2`, signer `CN=PocketLibrary`.
