# 08: Prove it on real Android devices

**What to build:** A device pass that shows the whole flow works on phones we do not control. Random
downloadable books get spines on real hardware, low-RAM devices survive the job, 16 KB-page devices
load the runtime, airplane mode after a warm cache produces identical output with no network, and a
corrupt bundle recovers without a crash. Real timings and peak memory are recorded so the UI budget
stops being a guess.

**Blocked by:** 07 (automatic queue and cache)

**Status:** ready-for-agent

- [ ] At least five random downloaded books produce a spine on a real arm64 phone, each with a recorded route, verdict and timing.
- [ ] The flow completes on a low-RAM device and on a 16 KB-page device without load failures or OOM kills, with measured peak memory recorded.
- [ ] With a warm cache and the radio off, the same book produces byte-identical output and the app makes zero network requests.
- [ ] A deliberately corrupted bundle is detected, retried once, and ends in a clear error state with cloth spines still usable.
- [ ] A cold start with no bundle still paints the shelf immediately and lets the user reach the download control.
- [ ] Measured generation time and memory are written down and compared against the 5–20 s design budget.

