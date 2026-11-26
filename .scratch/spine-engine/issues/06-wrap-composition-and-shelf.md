# 06: Compose wrap and present it on the shelf at 33 px

**What to build:** The production wrap renderer. Spine width follows page count and the paper
caliper, the front stays the published cover, the spine is the text-free art running continuously into
the front edge, and the back is composed from the same art. The shelf draws this wrap spine at 33 px
as its default, with Cloth for review and fallback verdicts, and swaps from cloth to wrap when a
result lands without shifting layout.

**Blocked by:** 05 (Spine Studio)

**Status:** ready-for-agent

- [ ] Wrap geometry follows page count via the spine-width formula, and the front cover is rendered unchanged with the art continuing across the spine edge.
- [ ] The shelf renders the 33 px wrap spine by default and remains legible at that size.
- [ ] A review verdict keeps the wrap with its note, and a fallback verdict shows Cloth on the shelf while the wrap stays previewable in detail.
- [ ] A completed generation swaps the shelf from cloth to wrap in place, with no reflow of neighbouring books.
- [ ] Editing page count re-composes the wrap at the new width without re-running detection, and labels the width approximate when page count is unknown.

