// Spine and wrap geometry. All internal lengths are inches unless the name says mm.
// Nothing here touches the DOM; it is plain arithmetic so the numbers can be audited.

export const MM_PER_IN = 25.4;

// Caliper is per leaf (one sheet of paper, two pages).
// The values are representative trade-paperback figures, not paper-mill guarantees.
export const STOCKS = [
  {
    id: "cream80",
    label: "Cream 80 gsm — standard novel",
    caliperMm: 0.1,
    note: "Bulk 1.2 · about 508 PPI",
  },
  {
    id: "white80",
    label: "White 80 gsm — trade",
    caliperMm: 0.096,
    note: "Bulk 1.15 · about 529 PPI",
  },
  {
    id: "cream70",
    label: "Cream 70 gsm — bulky",
    caliperMm: 0.12,
    note: "Bulk 1.5 · about 423 PPI",
  },
  {
    id: "white90",
    label: "White 90 gsm — premium",
    caliperMm: 0.111,
    note: "Bulk 1.1 · about 458 PPI",
  },
  {
    id: "cream55",
    label: "US 55# cream — mass market",
    caliperMm: 0.081,
    note: "Bulk 1.05 · about 627 PPI",
  },
  {
    id: "white100",
    label: "White 100 gsm — art book",
    caliperMm: 0.12,
    note: "Bulk 1.0 · about 423 PPI",
  },
  {
    id: "custom",
    label: "Custom caliper",
    caliperMm: null,
    note: "Set the caliper below",
  },
];

export const TRIMS = [
  { id: "6x9", label: "6 × 9 in — trade", w: 6, h: 9 },
  { id: "5.5x8.5", label: "5.5 × 8.5 in — digest", w: 5.5, h: 8.5 },
  { id: "5x8", label: "5 × 8 in — pocket", w: 5, h: 8 },
  { id: "5.25x8", label: "5.25 × 8 in — UK B-format", w: 5.25, h: 8 },
];

// A paperback cover wraps around the spine, so the printed spine is slightly
// wider than the text block. 1.2 mm is a common allowance for two cover panels.
export const COVER_ALLOWANCE_MM = 1.2;
export const MIN_SPINE_IN = 0.2;

export function getStock(id) {
  return STOCKS.find((s) => s.id === id) || STOCKS[0];
}

export function getTrim(id) {
  return TRIMS.find((t) => t.id === id) || TRIMS[0];
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Spine width from page count and paper caliper.
 * pages / 2 leaves × caliper + cover allowance.
 */
export function computeSpine({ pages, caliperMm, allowanceMm = COVER_ALLOWANCE_MM }) {
  const safePages = Math.max(2, Math.round(pages / 2) * 2);
  const leaves = safePages / 2;
  const textBlockMm = leaves * caliperMm;
  const calculatedMm = textBlockMm + allowanceMm;
  const clamped = calculatedMm < MIN_SPINE_IN * MM_PER_IN;
  const spineMm = Math.max(calculatedMm, MIN_SPINE_IN * MM_PER_IN);
  return {
    pages: safePages,
    leaves,
    caliperMm,
    allowanceMm,
    textBlockMm,
    calculatedMm,
    spineMm,
    spineIn: spineMm / MM_PER_IN,
    clamped,
  };
}

/**
 * The fold map for a continuous back + spine + front wrap.
 * x is measured from the left edge of the bleed.
 */
export function computeLayout({ trimW, trimH, spineIn, bleedIn = 0.125 }) {
  const backX = 0;
  const backTrimX = bleedIn;
  const backFold = bleedIn + trimW;
  const spineX = backFold;
  const frontFold = spineX + spineIn;
  const frontTrimX = frontFold;
  const frontTrimRight = frontTrimX + trimW;
  const totalW = frontTrimRight + bleedIn;
  const totalH = trimH + bleedIn * 2;
  return {
    trimW,
    trimH,
    spineIn,
    bleedIn,
    backX,
    backTrimX,
    backFold,
    spineX,
    frontFold,
    frontTrimX,
    frontTrimRight,
    totalW,
    totalH,
    // panel boxes including the bleed they own
    backPanel: { x: backX, y: 0, w: backFold, h: totalH },
    spinePanel: { x: spineX, y: 0, w: spineIn, h: totalH },
    frontPanel: { x: frontFold, y: 0, w: totalW - frontFold, h: totalH },
    trimBox: { x: backTrimX, y: bleedIn, w: 2 * trimW + spineIn, h: trimH },
  };
}

export function layoutForSpineIn(state, book, spineIn) {
  const trim = getTrim(state.trimId);
  return computeLayout({
    trimW: trim.w,
    trimH: trim.h,
    spineIn,
    bleedIn: state.bleedIn,
  });
}

export function currentLayout(state, book, spine) {
  const trim = getTrim(state.trimId);
  return computeLayout({
    trimW: trim.w,
    trimH: trim.h,
    spineIn: spine.spineIn,
    bleedIn: state.bleedIn,
  });
}

export function fmtIn(n, digits = 3) {
  return `${n.toFixed(digits)} in`;
}

export function fmtMm(n, digits = 1) {
  return `${n.toFixed(digits)} mm`;
}

export function fmtPx(n) {
  return `${Math.round(n).toLocaleString("en-US")} px`;
}
