# 13 — Shelf performance at scale

Type: research
Mode: AFK
Status: open
Blocked by: 01, 06

## Question

How do we render a wall of up to 2,000 books smoothly in Android System WebView?

Evaluate DOM-per-spine with virtualisation versus canvas/WebGL2 instancing; texture atlases for spines and covers; lazy cover decode and caching; drag and flip performance; the memory ceiling of the WebView process; and the cost of CSS 3D chains. Recommend a rendering architecture with a measurable target (frame budget, cold-scroll time, memory), and note the fallback if the target is missed.

Prefer a prototype or benchmark over a paper answer where possible; blocked until the shelf interaction and design language exist.
