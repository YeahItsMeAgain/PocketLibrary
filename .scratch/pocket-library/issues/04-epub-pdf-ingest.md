# 04 — EPUB and PDF ingest

Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

What is the best Rust-side way to ingest an EPUB or PDF from the SAF library folder?

Cover: EPUB container/OPF parsing for title, author, series, language, description, publisher, date, identifier, cover, TOC, and spine; PDF metadata, page count, and cover rendering; which crates are maintained and suitable (compare at least two per job); content hashing for duplicate detection; extracting metadata without loading the whole file into memory; and reading from a SAF `content://` handle.

Also decide the canonical book identity and what happens when the same file is renamed or moved. Produce a recommendation with crate versions, risks, and the metadata fallback order (embedded first, enrichment only for gaps, manual edit always available).

## Answer

Resolved 2026-11-24. Full report: `notes/epub-pdf-ingest.md`.

- EPUB: `rbook` 0.7.13 (Apache-2.0) — EPUB 2/3, typed metadata including Calibre series, cover, TOC (nav + NCX), spine, lazy resources, and `Epub::read(Read + Seek)` so a SAF fd is parsed in place. Rejected `epub` 2.1.6 (GPL-3.0) and `epub-parser` 0.3.4 (incomplete/fragile).
- PDF: `lopdf` 0.47.0 for metadata + page count; `hayro` 0.9.0 (Apache/MIT, pure Rust) for page-1 covers. `pdfium-render` is the fallback; MuPDF rejected (AGPL).
- SAF: `tauri-plugin-android-fs` 30.2.0 yields a real `std::fs::File` from the provider fd; pass it to rbook/zip, mmap for PDFs. Unseekable cloud fds need a copy-to-cache fallback.
- Identity: full-file BLAKE3-256, plus a 128 KiB head/tail quick key for rescans; survives rename/move/re-grant. ISBN is an attribute only.
- Enrichment: Open Library only (keyless; 1 req/s, 3 with UA+email). Google Books needs a key.
- Covers: content-addressed JPEG q80 600x900 under `app_data_dir()/covers/`; paths in SQLite.
- Estimates: cold import 2-6 min for 2,000 files, warm rescan under 5 s.

Spikes before commit: hayro cross-compile to `aarch64-linux-android`, mmap on real SAF fds, and whether WebView Range requests reach the custom protocol. These fold into ticket 10.
