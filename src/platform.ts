/**
 * The single seam between the React UI and the Rust command API.
 *
 * Every screen talks to `platform`, never to Tauri directly. On a phone the
 * Tauri implementation forwards to `invoke`; in a browser (Vite dev and
 * Playwright) the mock answers with the same types so the UI is testable
 * without a device.
 *
 * The implementation lives in `./platform/`; this file stays a thin barrel so
 * existing `from "../platform"` imports keep working.
 */
export * from "./platform/index";
