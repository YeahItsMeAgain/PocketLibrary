# foliate-js (vendored)

- Upstream: https://github.com/johnfactotum/foliate-js
- Pinned commit: `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01)
- Licence: MIT (see `LICENSE`).
- Vendored files: `view.js`, `paginator.js`, `epub.js`, `epubcfi.js`,
  `progress.js`, `overlayer.js`, `text-walker.js`, `search.js`, `tts.js`,
  `fixed-layout.js`, and `vendor/zip.js`.
- Local patch: `makeBook` in `view.js` only accepts EPUB/ZIP files, so the
  unvendored comic/FB2/MOBI/PDF branches and their dynamic imports are removed.
  This keeps the bundle free of an unused pdf.js copy. No other changes.
