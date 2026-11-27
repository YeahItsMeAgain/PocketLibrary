# Spine engine

On-device spine generation for PocketLibrary: a Rust/ONNX pipeline turns a downloaded cover into a
text-free spine, and the app presents it as a wrap by default.

**Status:** ready-for-agent

## Read in this order

1. [spec.md](spec.md) — problem, locked route, model bundle, delivery, flow, acceptance criteria.
2. [CONTRACT.md](CONTRACT.md) — the binding seam: crate API, artifacts, Tauri commands, wire shapes.

## Tickets

Numbered in dependency order. Work the frontier: a ticket is ready when every blocker is done.

| # | Ticket | Blocked by |
|---|---|---|
| 01 | [Model bundle and on-device loader](issues/01-model-bundle-and-loader.md) | — |
| 02 | [Engine crop route end to end](issues/02-engine-crop-route.md) | 01 |
| 03 | [MI-GAN inpaint route and honest QA](issues/03-migan-inpaint-route.md) | 02 |
| 04 | [App commands](issues/04-tauri-spine-commands.md) | 02, 03 |
| 05 | [Spine Studio in book detail](issues/05-spine-studio-ui.md) | 04 |
| 06 | [Wrap composition and 33 px shelf spine](issues/06-wrap-composition-and-shelf.md) | 05 |
| 07 | [Automatic generation, queue and cache](issues/07-auto-generate-queue.md) | 06 |
| 08 | [Android device pass](issues/08-android-device-pass.md) | 07 |
| 09 | [Release with the model downloader](issues/09-release-0-1-8.md) — deferred | 08 |
| 10 | [Automatic queue, progress and failure](issues/10-automatic-spine-queue.md) | 07 |
| 11 | [Wrap, Full-bleed, Cloth, contrast and RTL](issues/11-reduced-styles-full-bleed-rtl.md) | 06 |
| 12 | [Per-book style, 200 MB cache and backfill](issues/12-per-book-style-cache-backfill.md) | 10, 11 |
| 13 | [Release 0.1.8 with the automatic queue](issues/13-release-0-1-8-automatic-queue.md) | 08, 12 |

## Decision record

- [ADR 0005 — on-device spine engine](../../docs/adr/0005-on-device-spine-engine.md)

## Prototype evidence

The route is proven in `.scratch/spine-cover-art-prototype/`, which is throwaway design work and not
production code:

- `v8-app/` — the Rust/ONNX pipeline (detection, mask, crop/inpaint, QA) the engine crate ports.
- `v8-android/` — asset extraction and on-device runtime bring-up.
- `v8-models/` — the model files and their measured hashes/sizes.
- `v4-wrap/` and `app-renderers/` — wrap geometry and the six renderers, user-verified on a device.
- `APP-REPRODUCIBILITY.md` — which studies actually meet the end-to-end bar.

## Open decisions

- Export formats for v1: PNG only, or PNG + PDF.

Settled in the latest grilling round (see “Settled — automatic flow” in [spec.md](spec.md)):
automatic generation on every cover-producing path, three styles, the progress chip and pause,
one-shot retry, per-book `spine_style`, a 200 MB runtime-only cache, the backfill, RTL, and 0.1.8
shipping bundled models.
