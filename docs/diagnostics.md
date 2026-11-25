# Diagnostics and log export

PocketLibrary keeps a local diagnostics log so a reader can send a useful report
without developer tools, `adb` or a support code. Nothing is uploaded: the app
makes no network calls for diagnostics.

## What is recorded

The rolling `diagnostics.log` lives in the app's private data directory and is
not visible in the library folder. Events include:

- startup: app version, schema version and clean-shutdown marker;
- folder grant, scan start/finish, scan issues and relinks;
- backup import/export and diagnostics export;
- download queued/started/progress/complete/failed transitions;
- reader open/failure and position or annotation write failures;
- schema migrations;
- Rust panics, JS uncaught errors, unhandled promise rejections and failed
  Tauri commands.

The log is capped near 2 MB and 7 days; when either limit is exceeded, the
oldest entries are dropped. A missing clean-shutdown marker is reported on the
next launch as "previous session ended unexpectedly".

Paths and book titles are intentionally kept because the log stays on the
reader's device and they make reports actionable. Keystore secrets, passwords,
tokens and book contents are never written.

## Exporting a report

Open **Settings → Help & diagnostics**:

- **Send diagnostics** builds `pocketlibrary-diagnostics.zip` and hands it to the
  Android share sheet, so it can go to email, WhatsApp or Drive in one tap. If
  the WebView refuses file sharing, the system save picker is offered instead.
- **Copy summary** copies a short text summary for a message.
- The screen also shows the current log size and the last error.
- **Clear logs** empties the log; the session marker is kept so a crash can still
  be detected afterwards.

Scan, download, import and reader failure surfaces also offer a **Report** action
that runs the same export. After three failures in one session, a one-time hint
points to Help & diagnostics.

## What is in the zip

| File | Contents |
|---|---|
| `diagnostics.txt` | The current rolling log, oldest first. |
| `summary.json` | App name/version, schema version, Android version, device model, library/shelf/label/download counts and the log summary. |
| `recent-failures.txt` | The last 20 warnings and errors, one per line. |

## Writing a useful issue

Include:

1. the app version from **Settings → About** (for example `0.1.1`);
2. the Android version and device model;
3. the steps that led to the problem, the expected result and what happened;
4. the diagnostics zip, attached to the issue or sent to the maintainer.

Reports are public if filed on the issue tracker. Review the zip before
attaching it: it contains folder paths and book titles by design, though never
book contents or credentials.

## For developers

The core log implementation and its rotation/export tests are in
`core/src/diagnostics.rs`. The Tauri commands (`export_diagnostics`,
`save_diagnostics`, `diagnostics_summary`, `clear_diagnostics`) are in
`src-tauri/src/lib.rs`; the typed adapter is `sendDiagnostics` in
`src/platform.ts`. The Playwright share path is mocked, so the real Android
share sheet and SAF fallback remain a device check.
