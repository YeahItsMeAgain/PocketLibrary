# 04: Expose the spine engine through the app's commands

**What to build:** The frontend can ask the app to generate a spine for a book, read back an existing
artifact, and check engine status, all through the three commands and the wire shapes fixed in
`CONTRACT.md`. Calls are async from the UI but synchronous in effect: generation blocks that one
request on a worker thread, a second request for the same book waits rather than racing, and the
artifact arrives with data URLs the WebView can draw directly.

**Blocked by:** 02 (crop pipeline), 03 (inpaint route)

**Status:** ready-for-agent

- [ ] Generating a book returns the artifact shape in `CONTRACT.md` — route, verdict, mask percent, crop box, art, spine and fallback data URLs, and both JSON payloads — with camelCase fields on the wire.
- [ ] Reading an artifact for a book that has never been generated returns null, and for a generated book returns the cached result without re-running detection.
- [ ] Engine status reports the model state, bundle id, total bytes and any error, and matches what the Settings row says.
- [ ] Two simultaneous generate calls for the same book produce one pipeline run and both callers receive the same result.
- [ ] A generation that hits the timeout returns a clear error to the caller and leaves the cloth presentation intact.

