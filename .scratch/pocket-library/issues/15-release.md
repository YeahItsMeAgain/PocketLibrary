# 15: Release

**What to build:** A signed, versioned, recognisable release build that can be installed over the previous one, with a repeatable build and a final device smoke test.

**Blocked by:** 08, 11, 12, 13, 14

**Status:** ready-for-agent

- [ ] App name, icon, splash, and version are settled and applied
- [ ] A release APK is signed with the generated keystore without secrets entering the repo
- [ ] The release APK installs over the previous build and preserves library data
- [ ] Device smoke passes: launch, scan a real folder, read an EPUB and a PDF, acquire a book, export and import a backup
- [ ] `apksigner verify` passes and the APK size is recorded
- [ ] The build is reproducible from the committed docs on a fresh machine

Note: branding assets committed under `assets/branding/` and generated into `src-tauri/icons` + Android mipmaps.
