/* ==========================================================================
   v6/v7 measured spine renderer, app-safe.
   Modes: hybrid (paper label + art window), artonly (full-width art, no type),
   fallback (typographic cloth). All geometry is computed for 52 x 236 and 2x.
   ========================================================================== */

const esc = (v) => String(v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const SPECS = {
  hybrid: {
    name: "Hybrid",
    title: { family: "Cormorant Garamond", weight: 600, track: 0.055, upper: false },
    author: { family: "EB Garamond", weight: 400, track: 0.08 },
    maxTitle: (w) => Math.min(9.5, w * 0.193),
    maxAuthor: (w) => Math.min(5.3, w * 0.102),
  },
  cloth: {
    name: "Typographic cloth",
    title: { family: "Cormorant Garamond", weight: 600, track: 0.11, upper: true },
    author: { family: "Cormorant Garamond", weight: 500, track: 0.13 },
    maxTitle: (w) => Math.min(9.5, w * 0.193),
    maxAuthor: (w) => Math.min(5.3, w * 0.102),
  },
};

const GEOMETRY = {
  hybrid: { head: 26, tail: 16, gap: 5, ornY: 12, ornSize: 8 },
  cloth: { head: 26, tail: 16, gap: 5, ornY: 12, ornSize: 8 },
};

const ORNAMENTS = ["lozenge", "sun", "wave", "sprig"];

const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");
const metricsCache = new Map();
const layoutCache = new Map();

function measure(text, spec) {
  const key = `${spec.family}|${spec.weight}|${spec.track}|${text}`;
  if (metricsCache.has(key)) return metricsCache.get(key);
  measureCtx.font = `${spec.weight} 100px "${spec.family}", serif`;
  const m = measureCtx.measureText(text);
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  const ink = (asc == null ? 72 : asc) + (desc == null ? 20 : desc);
  const value = {
    advance: (m.width + spec.track * 100 * Math.max(1, text.length)) / 100,
    ink: ink / 100,
  };
  metricsCache.set(key, value);
  return value;
}

function hexToRgb(hex) {
  let h = String(hex || "#777").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(rgb) {
  return "#" + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function ornamentSVG(kind) {
  const open = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  if (kind === "sun") {
    return open + '<circle cx="12" cy="12" r="3.6"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>';
  }
  if (kind === "wave") {
    return open + '<path d="M2 8.2c2.2-2.1 4.4-2.1 6.6 0s4.4 2.1 6.6 0 4.4-2.1 6.6 0"/><path d="M2 12.6c2.2-2.1 4.4-2.1 6.6 0s4.4 2.1 6.6 0 4.4-2.1 6.6 0" opacity=".72"/><path d="M2 17c2.2-2.1 4.4-2.1 6.6 0s4.4 2.1 6.6 0 4.4-2.1 6.6 0" opacity=".45"/></svg>';
  }
  if (kind === "sprig") {
    return open + '<path d="M12 21V4.2"/><path d="M12 9.4c-2.9 0-4.6-1.5-4.9-4 2.8-.2 4.5 1.2 4.9 4Z"/><path d="M12 14.2c2.9 0 4.6-1.5 4.9-4-2.8-.2-4.5 1.2-4.9 4Z"/><path d="M12 4.2c-1.4 0-2.4-.8-2.7-2.2 1.5-.1 2.4.7 2.7 2.2Z"/></svg>';
  }
  return open + '<path d="M12 2.7 21.3 12 12 21.3 2.7 12Z"/><path d="M12 7.2 16.8 12 12 16.8 7.2 12" opacity=".55"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>';
}

function artPosition(book, windowWidth) {
  const h = book.heightPx || 236;
  const imageWidth = h * (2 / 3);
  const slice = windowWidth / imageWidth;
  const focus = (book.focus && book.focus[0]) || 0.5;
  if (slice >= 1) return 50;
  return clamp(((focus - slice / 2) / (1 - slice)) * 100, 0, 100);
}

export function layout(book, mode = "hybrid") {
  const key = `${book.id}:${mode}:${book.title}:${book.author}:${book.widthPx}x${book.heightPx}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const fallback = mode === "fallback";
  const spec = fallback ? SPECS.cloth : SPECS.hybrid;
  const geo = fallback ? GEOMETRY.cloth : GEOMETRY.hybrid;
  const w = book.widthPx || 52;
  const h = book.heightPx || 236;

  const paperW = mode === "hybrid" ? w * 0.565 : 0;
  const artW = w - paperW;
  const thickness = mode === "hybrid" ? paperW - 7 : w - 9;
  const titleX = mode === "hybrid" ? w - paperW / 2 : w / 2;

  const titleText = spec.title.upper ? book.title.toLocaleUpperCase() : book.title;
  const authorText = book.author.toLocaleUpperCase();

  const am = measure(authorText, spec.author);
  const authorMax = spec.maxAuthor(w);
  const authorByThickness = thickness / am.ink;
  const authorByLength = (h * 0.31) / am.advance;
  let afs = Math.min(authorMax, authorByThickness, authorByLength);
  afs = Math.max(2.9, Math.floor(afs * 20) / 20);
  const authorW = am.advance * afs + 0.8;

  const len = h - geo.head - geo.tail;
  const availTitle = Math.max(24, len - authorW - geo.gap - 1.2);

  const SAFE = 0.965;
  const LINE = 1.06;
  const tm = measure(titleText, spec.title);
  let fs = Math.min(
    spec.maxTitle(w),
    ((thickness - 0.8) * SAFE) / tm.ink,
    (availTitle * SAFE) / tm.advance
  );
  fs = Math.max(2.8, Math.floor(fs * 20) / 20);
  let guard = 0;
  while (fs > 2.8 && guard++ < 80) {
    if (tm.advance * fs <= availTitle + 0.02 && tm.ink * fs <= thickness + 0.02) break;
    fs -= 0.025;
  }
  fs = Math.floor(fs * 40) / 40;

  let stacked = false;
  let lines = [titleText];
  let maxAdvance = tm.advance;
  let maxInk = tm.ink;

  if (fs < 6.9 && thickness >= 12) {
    const words = titleText.split(/\s+/);
    if (words.length > 1) {
      let best = null;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" ");
        const b = words.slice(i).join(" ");
        const ma = measure(a, spec.title);
        const mb = measure(b, spec.title);
        const score = Math.max(ma.advance, mb.advance) + Math.abs(ma.advance - mb.advance) * 0.16;
        if (!best || score < best.score) best = { lines: [a, b], adv: Math.max(ma.advance, mb.advance), ink: Math.max(ma.ink, mb.ink), score };
      }
      if (best) {
        let fs2 = Math.min(
          spec.maxTitle(w),
          (thickness * SAFE) / (2 * LINE),
          (availTitle * SAFE) / best.adv
        );
        fs2 = Math.max(2.8, Math.floor(fs2 * 20) / 20);
        let g2 = 0;
        while (fs2 > 2.8 && g2++ < 80) {
          if (best.adv * fs2 <= availTitle + 0.02 && 2 * LINE * fs2 <= thickness + 0.02) break;
          fs2 -= 0.025;
        }
        fs2 = Math.floor(fs2 * 40) / 40;
        if (fs2 > fs * 1.08) {
          stacked = true;
          lines = best.lines;
          fs = fs2;
          maxAdvance = best.adv;
          maxInk = best.ink;
        }
      }
    }
  }

  const fitLength = (maxAdvance * fs) / availTitle;
  const fitThickness = stacked ? (2 * LINE * fs) / thickness : (maxInk * fs) / thickness;
  const cap = spec.maxTitle(w);
  const limitedBy = fs >= cap - 0.06
    ? (stacked ? "two-line cap" : "aesthetic cap")
    : fitLength >= fitThickness ? "length" : "thickness";

  const avg = book.measured ? book.measured.avg : "#4a4a4a";
  const railComposite = mix("#0d0e10", avg, 0.12);
  const paper = mix("#ece2ca", book.cloth || "#333", 0.055);
  let ink, contrastRatio;
  if (fallback) {
    ink = "#f2e6c9";
    contrastRatio = contrast(ink, book.cloth || "#333");
  } else {
    ink = "#2c2118";
    contrastRatio = contrast(ink, paper);
  }

  const look = {
    w, h, mode, spec, geo,
    railW: 0, paperW, artW, titleX, thickness,
    titleText, authorText, lines, stacked,
    fs, afs, authorW, len, availTitle,
    titleY: geo.head + len / 2,
    head: geo.head, tail: geo.tail,
    ornX: titleX,
    ornY: geo.ornY,
    ornSize: geo.ornSize,
    artPos: artPosition(book, artW),
    paper, ink, contrastRatio, railComposite,
    fitLength, fitThickness, limitedBy,
    limiting: Math.max(fitLength, fitThickness),
    cssPx: fs,
  };
  layoutCache.set(key, look);
  return look;
}

export function styleString(book, look, scale, artUrl) {
  const p = (v) => `${(v * scale).toFixed(2)}px`;
  const vars = [
    ["--w", p(look.w)],
    ["--h", p(look.h)],
    ["--cloth", book.cloth || "#333"],
    ["--accent", book.accent || "#c9a45c"],
    ["--paper", look.paper],
    ["--ink", look.ink],
    ["--fs", p(look.fs)],
    ["--afs", p(look.afs)],
    ["--author-w", p(look.authorW)],
    ["--title-len", p(look.len)],
    ["--title-thick", p(look.thickness)],
    ["--title-x", p(look.titleX)],
    ["--title-y", p(look.titleY)],
    ["--title-track", `${look.spec.title.track}em`],
    ["--author-track", `${look.spec.author.track}em`],
    ["--orn-x", p(look.ornX)],
    ["--orn-y", p(look.ornY)],
    ["--orn-size", p(look.ornSize)],
    ["--title-gap", p(look.geo.gap)],
    ["--art-pos", `${look.artPos.toFixed(2)}%`],
    ["--paper-w", p(look.paperW)],
    ["--art-w", p(look.artW)],
  ];
  if (artUrl && look.mode !== "fallback") vars.push(["--art", `url('${artUrl}')`]);
  return vars.map(([k, v]) => `${k}:${v}`).join(";");
}

export function spineMarkup(book, options = {}) {
  const mode = options.mode || "hybrid";
  const scale = options.scale || 1;
  const preview = !!options.preview;
  const artUrl = options.artUrl || null;
  const provenance = options.provenance || "original";
  const reason = options.reason || "";
  const look = layout(book, mode);
  const tag = preview ? "div" : "button";
  const cls = mode === "fallback" ? "spine--cloth spine--fallback" : "spine--hybrid";
  const modeCls = mode === "artonly" ? " spine--artonly" : mode === "fallback" ? " spine--fallback" : "";
  const artless = mode === "fallback" || !artUrl;
  const provClass = provenance === "fallback" ? "spine__prov--fallback" : "spine__prov--original";
  const orn = ORNAMENTS[(Number(book.id) || 1) - 1] || ORNAMENTS[0];
  const label = `${book.title} by ${book.author}. ${mode === "fallback" ? "Typographic fallback" : mode === "artonly" ? "Art only" : "Hybrid"} spine. ${reason}`;
  const attrs = preview
    ? ' aria-hidden="true"'
    : ` type="button" aria-label="${esc(label)}" data-book-id="${esc(book.id)}"`;
  return `<${tag} class="spine ${cls}${modeCls}${artless ? " is-artless" : ""}"${attrs}` +
    ` data-mode="${mode}" data-prov="${provenance}" data-reason="${esc(reason)}"` +
    ` data-fs="${look.fs.toFixed(2)}" data-fit="${look.limiting.toFixed(3)}"` +
    ` style="${styleString(book, look, scale, artUrl)}">` +
    `<span class="spine__base"></span>` +
    `<span class="spine__art"></span>` +
    `<span class="spine__wash"></span>` +
    `<span class="spine__paper"></span>` +
    `<span class="spine__rail"></span>` +
    `<span class="spine__frame"></span>` +
    `<span class="spine__band spine__band--head"></span>` +
    `<span class="spine__band spine__band--tail"></span>` +
    `<span class="spine__rule spine__rule--head"></span>` +
    `<span class="spine__rule spine__rule--tail"></span>` +
    `<span class="spine__ornament">${ornamentSVG(orn)}</span>` +
    `<span class="spine__titlebox">` +
      `<span class="spine__author">${esc(book.author)}</span>` +
      `<span class="spine__title${look.stacked ? " spine__title--stacked" : ""}">${look.stacked ? look.lines.map((l) => `<span class="spine__title-line">${esc(l)}</span>`).join("") : esc(look.titleText)}</span>` +
    `</span>` +
    `<span class="spine__grain"></span>` +
    `<span class="spine__sheen"></span>` +
    `<span class="spine__vignette"></span>` +
    `<span class="spine__edge spine__edge--l"></span>` +
    `<span class="spine__edge spine__edge--r"></span>` +
    `<span class="spine__prov ${provClass}" aria-hidden="true"></span>` +
    `</${tag}>`;
}

export function getMetrics(book, mode) {
  const l = layout(book, mode);
  return {
    mode,
    widthPx: l.w,
    heightPx: l.h,
    fontSize: l.fs,
    authorSize: l.afs,
    fitLength: l.fitLength,
    fitThickness: l.fitThickness,
    limiting: l.limiting,
    limitedBy: l.limitedBy,
    contrast: l.contrastRatio,
    stacked: l.stacked,
  };
}

export async function loadFonts() {
  const wanted = [
    '100 10px "Inter"',
    '600 10px "Cormorant Garamond"',
    '400 10px "EB Garamond"',
    '400 10px "Literata"',
  ];
  await Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
}
