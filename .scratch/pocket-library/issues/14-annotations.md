# 14: Annotations

**What to build:** Highlights, notes, and bookmark UI in the EPUB reader, anchored so they survive re-renders and small text shifts. This is M4; the data model and internal selection wiring already exist.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Text can be selected and highlighted in four colours
- [ ] A note can be attached to a highlight and edited or deleted
- [ ] Annotations use a Readium-shaped Locator plus text-quote and text-position fallbacks
- [ ] A CFI that no longer resolves falls back to the quote and is repaired on next save
- [ ] An annotation list per book supports jumping to and deleting entries
- [ ] Annotations persist across relaunch and are included in backup/export
