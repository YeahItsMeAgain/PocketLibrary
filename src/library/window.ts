/**
 * Arithmetic shelf window.
 *
 * Every shelf has the same outer height, so the visible range can be derived
 * from scroll position without measuring the wall. The renderer keeps one
 * overscan shelf on each side and reuses a small slot pool; placeholders
 * reserve the exact height of every shelf outside that range.
 */
export const SHELF_UNIT_PX = 358;

/** Shelves at or below this count stay mounted: no window to manage. */
export const EAGER_SHELF_LIMIT = 12;

/**
 * One case of lead on each side, as the wall design asks for. The engine's
 * `content-visibility` handles the cases that are just outside the window.
 */
const OVERSCAN = 1;

/** Recyclable slots 0..8, plus slot 9 reserved for a pinned drag source. */
const POOL_SLOTS = 9;
const PINNED_SLOT = 9;

export interface ShelfRange {
  /** Inclusive. */
  start: number;
  /** Exclusive. */
  end: number;
}

export interface MountedShelf {
  index: number;
  slot: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeShelfRange(
  total: number,
  scrollY: number,
  viewportHeight: number,
  windowTop: number,
  unit = SHELF_UNIT_PX,
): ShelfRange {
  if (total <= EAGER_SHELF_LIMIT) return { start: 0, end: total };
  const local = scrollY - windowTop;
  const first = Math.floor(Math.max(0, local) / unit);
  const visibleEnd = Math.ceil((Math.max(0, local) + viewportHeight) / unit);
  return {
    start: clamp(first - OVERSCAN, 0, Math.max(0, total - 1)),
    end: clamp(visibleEnd + OVERSCAN, 0, total),
  };
}

/**
 * Slots are stable across scroll steps: shelf `index` always lands in the same
 * slot, so a one-shelf move only mounts the entering shelf and unmounts the
 * leaving one. The window is smaller than the pool, so slots cannot collide.
 */
export function mountedShelves(
  total: number,
  range: ShelfRange,
  pinnedIndex: number | null,
): MountedShelf[] {
  if (total <= EAGER_SHELF_LIMIT) {
    return Array.from({ length: total }, (_, index) => ({
      index,
      slot: index,
    }));
  }
  const mounted: MountedShelf[] = [];
  for (let index = range.start; index < range.end; index += 1) {
    mounted.push({ index, slot: index % POOL_SLOTS });
  }
  if (
    pinnedIndex !== null &&
    pinnedIndex >= 0 &&
    pinnedIndex < total &&
    (pinnedIndex < range.start || pinnedIndex >= range.end)
  ) {
    mounted.push({ index: pinnedIndex, slot: PINNED_SLOT });
  }
  return mounted;
}

/**
 * Contiguous unmounted ranges, used for exact-height placeholders. A pinned
 * source shelf can sit above one of these; the placeholder keeps its full
 * height so a drag never changes the wall's layout shape.
 */
export function placeholderRanges(total: number, range: ShelfRange): ShelfRange[] {
  if (total <= EAGER_SHELF_LIMIT) return [];
  const gaps: ShelfRange[] = [];
  if (range.start > 0) gaps.push({ start: 0, end: range.start });
  if (range.end < total) gaps.push({ start: range.end, end: total });
  return gaps;
}
