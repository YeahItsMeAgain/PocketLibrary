# 11: Reduce to Wrap, Full-bleed and Cloth with contrast and RTL

**What to build:** Exactly three renderers survive: Wrap (default), Full-bleed and Cloth. Hybrid,
Textless and Editorial are deleted from the codebase, copy and tests, not feature-flagged. Full-bleed
centres title and author as one block on both axes over a soft gradient scrim, two lines maximum,
shrinking to fit and never truncating. Wrap rail type passes the same contrast guard. Hebrew and other
RTL titles render correctly through direction detection and mirrored alignment, covered by a fixture.

**Blocked by:** 06 (wrap renderer and shelf presentation)

**Status:** ready-for-agent

- [ ] Hybrid, Textless and Editorial renderers, style strings, copy and tests are removed; no dead feature flags remain.
- [ ] Detail and any style switch offer only Wrap, Full-bleed and Cloth, with Wrap as the default.
- [ ] Full-bleed draws title and author centred on both axes as one block over a soft gradient scrim.
- [ ] Full-bleed caps at two lines, shrinks type to fit, and never truncates mid-word; long and short titles both hold.
- [ ] Wrap rail type uses the same contrast guard and stays legible over light and dark art.
- [ ] RTL detection uses the first strong character, sets canvas direction, mirrors alignment, and a Hebrew fixture renders correctly.
- [ ] Switching among the three styles redraws from cached art without a pipeline run.
