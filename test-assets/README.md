# Test fixtures

- `sample.epub`, `scripted.epub` — small self-authored EPUB fixtures (see the
  reader tests). `scripted.epub` deliberately contains an inline script and an
  `onerror` handler so the CSP regression test can prove they are blocked.
- `sample.pdf` — a self-authored, three-page PDF with a two-entry outline
  (Chapter One, Chapter Two). Text is public-domain filler and the file is
  dedicated to the public domain under CC0 1.0. Generated from a small script;
  no third-party content or fonts are embedded.

`public/test-assets/` mirrors these files so the Vite dev server and Playwright
can fetch them at `/test-assets/...`.
