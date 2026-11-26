# 01: Ship the spine model bundle and load it on device

**What to build:** The app can report whether the spine engine's models are present, and it can get
them onto the device. In the test APK the `spine-v1` files ship as bundled assets and are extracted
into the app data directory on first use; in production the same code path is fed by an automatic,
resumable, hash-verified downloader. The Settings → Spine row tells the truth: ready, bundled,
missing, or error, with the bundle id and byte size. Without models the rest of the app still works.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A clean test-APK install reports the bundle as ready after first launch, with no network access, and a second launch does not re-extract.
- [ ] The status surface distinguishes ready, bundled, missing and error, and shows `spine-v1` plus the total byte size; expected hashes come from the app, never from the download manifest.
- [ ] A download can be cancelled, keeps its partial bytes, and resumes from them on the next attempt rather than starting over.
- [ ] A corrupted or wrong-sized file fails verification, is deleted, is retried once, and then surfaces a retryable error instead of loading.
- [ ] Starting a download refuses with a storage message when free space is less than twice the bundle size, and leaves any existing install untouched.
- [ ] Only one download runs at a time; completing it installs the version directory atomically, so no partial bundle is ever loadable.

