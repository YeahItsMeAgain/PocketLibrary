# 05: Add Spine Studio to book detail

**What to build:** A Spine section in book detail where the user can generate a spine and watch honest
progress — preparing art, removing text, checking — then see the verdict and preview the three styles
(Wrap, Full-bleed, Cloth). Switching style is instant because it redraws from cached art, never
re-runs the pipeline. A review book shows a small "Check this spine" note and a one-tap **Use Cloth**;
a missing bundle offers **Download engine** instead of a dead button.

**Blocked by:** 04 (app commands)

**Status:** ready-for-agent

- [ ] Generate runs from book detail, shows the three coarse stages while it works, and leaves the existing cloth presentation visible until the result lands.
- [ ] The verdict is shown plainly, and a review result offers **Use Cloth** which renders a correct cloth spine.
- [ ] Wrap, Full-bleed and Cloth are previewable, and switching between them completes without a new pipeline run.
- [ ] When models are missing or the download failed, the section explains the one-time download and offers a working retry/download action.
- [ ] Closing book detail mid-generation does not cancel the job; the result is available when the book is reopened.

