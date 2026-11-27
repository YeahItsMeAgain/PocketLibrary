# Prototype-restored spine type — screenshots and measurements

Generated from the production renderer (`src/library/spine/*`) with the real
per-book art and crop boxes under `.scratch/spine-engine/evidence/`, compared
against the original app-renderer prototype (`app-renderers/renderer/renderer.js`).

## Restored geometry

| | Wrap | Full-bleed |
| --- | --- | --- |
| Head / tail margin | 25 / 25 px | 27 / 27 px (rail inset) |
| Title run | H - 50 - authorLen - 14 | H - 54 - authorLen - 8 |
| Title max size | 7.8 px | 9.4 px |
| Title voice | SANS 600, 0.05 track | SANS 600, 0.06 track |
| Author | 48 px fit, max 3.6 px | 48 px fit, max 4.2 px |
| Author position | H - 25 - authorLen / 2 | H - 27 - authorLen / 2 |
| Base mark | colophon rule + PL at 217 / 227 | provenance diamond at H - 16 |
| Rail | none | 20 px, x = 30, inset 2 px, smoked + thin cream border |

## Measured title runs (52 × 236 logical px)

| Book | Style | Title px | Title height | % of spine | % of available run | Author px | Contrast | Scrim |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| The War of the Worlds | full-bleed | 8.80 | 141.7 | 60.0% | 96.6% | 4.20 | 10.49:1 | no |
| The War of the Worlds | wrap | 7.80 | 124.0 | 52.5% | 83.9% | 3.60 | 16.32:1 | yes |
| Dune | full-bleed | 9.40 | 32.0 | 13.6% | 22.9% | 4.20 | 10.11:1 | no |
| Dune | wrap | 7.80 | 26.2 | 11.1% | 18.5% | 3.60 | 16.32:1 | yes |
| The Great Gatsby | full-bleed | 9.40 | 111.5 | 47.2% | 86.5% | 4.20 | 9.13:1 | no |
| The Great Gatsby | wrap | 7.80 | 91.3 | 38.7% | 69.1% | 3.60 | 16.32:1 | yes |
| המלחמה של העולמות (RTL) | full-bleed | 9.40 | 105.7 | 44.8% | 68.6% | 4.20 | 10.49:1 | no |
| המלחמה של העולמות (RTL) | wrap | 7.80 | 86.4 | 36.6% | 56.0% | 3.60 | 16.32:1 | yes |

The War of the Worlds is the long-run case: 60.0% of the spine and
96.6% of the available run in Full-bleed; 52.5% of the spine and 83.9% of
the run in Wrap. Dune and Gatsby are short titles, so their runs are shorter
by content, not by a band restriction; they still use the prototype maxima
(9.4 px / 7.8 px) and their available-run percentages are the headline.
Gatsby is 86.5% of its run in Full-bleed; Dune is a four-letter title, so
its 9.4 px run is deliberately short and centred in the long span.

## Files

- `52-<book>-<style>.png` — the renderer at 52 × 236 (3× backing store).
- `shelf-33-<book>-<style>.png` and `shelf-33px-strips.png` — the 33 px shelf strip.
- `case-<book>-wrap.png` — the full Wrap case.
- `compare-<book>-full-bleed.png` — ours vs the original prototype Full-bleed.
- `compare-<book>-wrap.png` — ours vs the prototype Wrap spine (18 px, scaled to 52).
- `app-390-*` / `app-320-*` — the studio preview at phone widths, LTR and RTL.
- `prototype-*.png` — the original renderer output used for comparison.

## Contrast guard

The prototype used a fixed smoked rail and fixed cream ink. Here the rail is
still drawn at 88% over `mix("#0c0d10", palette.avg, 0.10)`, but the guard
samples the rail composite and lays a local scrim inside the 20 px rail if the
border or a bright palette would drop cream below 4.5:1. Wrap keeps the art-
sampling guard and scrims only when no single ink clears 4.5:1. The War of the
Worlds 52 px wrap strip samples the bright sky and uses a scrim (16.3:1); its
18 px case, where the same title sits on the darker crop, needs none.
