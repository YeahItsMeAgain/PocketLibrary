# 01: Walking skeleton

**What to build:** An installable APK that proves the whole shell: Rust core, SQLite with migrations, a typed command API, and a web UI that talks to it only through the platform adapter. It launches to an empty library wall. The temporary storage-spike screen is removed.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Fresh install launches to an empty library wall with the drawer available
- [ ] The UI calls a real Rust command through the platform adapter and renders the result (for example, app version)
- [ ] SQLite is created with a schema version and survives relaunch
- [ ] No storage-spike screen or SPIKE-only commands remain
- [ ] A debug APK builds with the documented command and installs on a phone
