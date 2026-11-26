# The shared reproducibility book

**The Hound of the Baskervilles** by Arthur Conan Doyle (1902).

This is the one randomly chosen downloadable book used by every study in the
suite. It was chosen once, before any study was run against it.

## How it was chosen

The pool was the eighteen public-domain Standard Ebooks titles already used by
the suite. Every title has a real downloadable cover, so the draw needs no new
source and can be repeated exactly.

Seed: `pocketlibrary-spine-repro-2026-11-26`

```sh
openssl enc -aes-256-ctr \
  -pass pass:pocketlibrary-spine-repro-2026-11-26 \
  -nosalt -pbkdf2 < /dev/zero | head -c 1048576 > /tmp/spine-seed-stream.bin

shuf --random-source=/tmp/spine-seed-stream.bin -n 1 /tmp/spine-book-list.txt
# -> hound-of-the-baskervilles|The Hound of the Baskervilles|arthur-conan-doyle/the-hound-of-the-baskervilles
```

The list itself is recorded in `metadata.json`.

## Metadata

| Field | Value |
| --- | --- |
| Source | Standard Ebooks |
| Cover | 1400 x 2100 JPEG, 267 KB |
| Cover SHA-256 | `ee131704a727d89a7988ddc65e7bc35760786cd0164e055989126dd3e12ae0e1` |
| Painting | Caspar David Friedrich, *Riesengebirgslandschaft mit aufsteigendem Nebel* (1820) |
| Words | 59,285 (`schema:wordCount`) |
| Reference extent | 170 pages at 350 words/page |
| Licence | Public domain |

The page count is a documented estimate, not a claim about a particular print
edition. The Design system study keeps its own 336 pp shelf record for this
title; that is noted separately on the reproducibility page.
