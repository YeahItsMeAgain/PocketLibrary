# Third-party notices

PocketLibrary is MIT-licensed. It also includes or references the following
third-party work.

## Agent skills

The files under `.agents/skills/` are copied from
[mattpocock/skills](https://github.com/mattpocock/skills) at commit
`abeeaf95660ba9e8b7c753eb38f441ca707a8823` and are MIT-licensed.

## Reader engines

- **foliate-js** — MIT. Vendored under `src/vendor/foliate/`; the upstream
  licence and `UPSTREAM.md` are included there.
- **pdf.js (pdfjs-dist)** — Apache-2.0. Licence files are bundled with the
  dependency; `LICENSE`, `LICENSE_FOXIT` and `LICENSE_LIBERATION` are retained
  alongside the distributed assets.

## Fonts

The bundled reader fonts — EB Garamond, Literata and Source Serif — are
licensed under the SIL Open Font License. Their OFL texts are included under
`src/assets/fonts/`.

## Prototype cover artwork

`prototype/design/covers/` contains cover artwork for public-domain classic
novels, used only as design-prototype references. The images are not shipped
inside the Android app. Provenance is recorded here for transparency; if you
reuse them elsewhere, verify the rights for your jurisdiction.

## Application dependencies

React, Vite, Tauri, rusqlite, rbook, lopdf, hayro, wreq and the other crates and
npm packages are used under their respective licences. Their licence texts are
available in the package registries and are not vendored into this repository
except where noted above.
