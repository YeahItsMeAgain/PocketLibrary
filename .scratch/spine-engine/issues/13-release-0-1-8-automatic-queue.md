# 13: Release 0.1.8 with the automatic queue

**What to build:** A shipped 0.1.8 (versionCode 1008) where the automatic queue, three styles,
per-book style persistence and the 200 MB cache are live on real devices. Models remain bundled for
this build; the first-run downloader is deferred to a separate release ticket so 0.1.8 does not
depend on it. Upgrade from the current build applies migration 6 and backfills the library once
without blocking the shelf. Release notes describe automatic preparation, the pause control and what
a failed job looks like.

**Blocked by:** 08 (Android device pass), 12 (per-book style, cache, backfill)

**Status:** ready-for-agent

- [ ] Version is 0.1.8 / versionCode 1008; the build ships the bundled models and does not include the first-run downloader.
- [ ] On a real device, a fresh library and a 20-book backfill both prepare spines automatically with the global chip and stage labels, and the reader pause works.
- [ ] The device pass covers the automatic queue: cold start, process death mid-queue, cover change mid-job, failure retry, and low-RAM/16 KB-page devices.
- [ ] Upgrade from the previous build applies migration 6, preserves the existing shelf, and backfills at low priority.
- [ ] Only Wrap, Full-bleed and Cloth appear anywhere in the shipped UI, including a Hebrew title fixture.
- [ ] Release notes state that spine generation is on-device, that it runs automatically, that it can be paused, and that failures fall back to Cloth.
- [ ] The downloader work is filed as a separate ticket and is not a release blocker for 0.1.8.
