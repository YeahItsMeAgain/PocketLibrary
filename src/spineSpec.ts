/**
 * The spine geometry and engine identifiers shared by the TS UI and mock.
 *
 * The Rust side (`core/`, `src-tauri/`) has its own copies of these constants
 * and must stay in sync: changing a value here alone will make the mock and
 * the real engine disagree about the rendered spine, the model bundle or the
 * event names.
 */

/** Width of a rendered spine, in CSS pixels. */
export const SPINE_WIDTH = 52;

/** Height of a rendered spine, in CSS pixels. */
export const SPINE_HEIGHT = 236;

/** Width the engine renders before the spine is cropped. */
export const SPINE_ENGINE_WIDTH = 104;

/** Height the engine renders before the spine is cropped. */
export const SPINE_ENGINE_HEIGHT = 472;

/** Page count assumed when a book has no usable page metadata. */
export const DEFAULT_PAGE_ESTIMATE = 320;

/** Identifier of the model bundle the queue prepares the library for. */
export const SPINE_BUNDLE_ID = "spine-v1";

/** Event emitted whenever the queue's counts or current job change. */
export const SPINE_QUEUE_EVENT = "spine://queue";

/** Event emitted once per pipeline stage of the current job. */
export const SPINE_PROGRESS_EVENT = "spine://progress";
