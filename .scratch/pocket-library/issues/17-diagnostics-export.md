# 17: Diagnostics and log export

**What to build:** A local diagnostics log with a one-tap "Send diagnostics" export for a non-technical family member. When something fails, they can send a file to the developer without enabling developer tools or understanding logs.

**Blocked by:** 09 (Settings), 01 (app shell)

**Status:** awaiting-device-test

**Device-only:** the real Android share sheet (and SAF save-picker fallback) for
`pocketlibrary-diagnostics.zip` still needs a phone; the WebView share path is
mocked in Playwright. See the README device checklist.

- [x] Rolling app-level log: errors, warnings and lifecycle events (startup/version/schema, folder grant and scan results, import/export, download transitions/failures, reader open/failure, migrations). Cap ~2 MB and 7 days.
- [x] No redaction by default (family-only logs): include paths and book titles where useful to debug. Never include keystore/password/tokens or book contents.
- [x] Rust panics, JS uncaught errors/unhandled rejections, and command failures are captured. A missing clean-shutdown marker records "previous session ended unexpectedly" on next launch.
- [x] Export produces a zip with `diagnostics.txt`, `summary.json` (app/schema/Android/device/counts), and `recent-failures.txt` (last 20).
- [x] Primary action: Android share sheet (one tap to email/WhatsApp/Drive). Fallback: save via the system file picker. A "Copy summary" action exists for quick messages. No network calls from the app.
- [x] Settings → Help & diagnostics shows the action, log size/last error, and a clear-logs control. Error states (scan/download/import/reader) offer a Report action.
- [x] After repeated failures, show a one-time gentle hint pointing to diagnostics.
- [x] No support code and no verbose toggle.
- [x] Tests: log write/rotation, export contents, crash/previous-session marker, JS error capture, share fallback, UI actions.
- [x] Signed release APK; README/release notes updated.
