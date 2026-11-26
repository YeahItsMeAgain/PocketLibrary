# 03: Wire the MI-GAN inpaint route and keep the QA gate honest

**What to build:** Text-heavy covers that defeat the plain crop are routed to MI-GAN inpainting and
come back with usable text-free art. The QA gate looks at the actual output — residual text on the
inpainted result — so a bad inpaint is not reported as a pass. Covers that inpaint cleanly pass;
covers that still carry text fall back. Books that already pass on the crop route are unaffected and
never pay the inpaint cost.

**Blocked by:** 02 (engine crop pipeline)

**Status:** ready-for-agent

- [ ] A text-heavy reference cover the crop route cannot clean is routed to inpaint and returns a `pass` artifact.
- [ ] The QA check runs against the inpainted art, and an input that still shows text after inpainting gets `review` or `fallback` rather than `pass`.
- [ ] A clean crop-route book still takes the crop route and does not load or run MI-GAN.
- [ ] An inpaint failure degrades to the fallback verdict and cloth output instead of failing the whole job.
- [ ] The report states which route ran for every book, so a route change is visible in the artifact.

