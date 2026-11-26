# 09: Release 0.1.8 with the model-delivery rollout

**What to build:** A shipped 0.1.8 where fresh installs get the spine engine through the production
downloader rather than bundled assets, with a staged rollout and a way to back out. Release notes are
honest about the one-time size and the offline behaviour, and the build stops shipping the test-APK
asset bundle.

**Blocked by:** 08 (Android device pass)

**Status:** ready-for-agent

- [ ] The release build resolves models through the production downloader, and the test-only bundled asset path is disabled.
- [ ] A fresh install downloads, verifies and enables art spines, with visible cancellable progress in Settings → Spine.
- [ ] The rollout is staged with a documented rollback that leaves existing users' cached models and cloth spines intact.
- [ ] Release notes state the download size, that inference is local, and that the app works offline once cached.
- [ ] Store listing size disclosures and the storage requirement reflect the ~41.2 MB model bundle.

