/* ==========================================================================
   PocketLibrary v6 — spine renderer + measured type
   No dependencies. All sizes are computed in CSS pixels at 1× and multiplied
   by a preview scale; the 1× result is the real shelf spine (40–55 px wide).
   ========================================================================== */

(function () {
  "use strict";

  const DATA = window.V6_DATA;
  const BOOKS = DATA.books;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (v) => String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const state = {
    direction: "hybrid",
    rail: true,
    light: "gallery",
    material: true,
    filter: "all",
    selected: 1,
    actual: false,
  };

  const cache = new Map();      // `${id}:${dir}` -> layout
  const artFailed = new Set();
  let lastMetrics = [];

  /* ---------- font + type specs ------------------------------------------ */

  const SPECS = {
    editorial: {
      name: "Modern editorial",
      title: { family: "Inter", weight: 500, track: 0.17, upper: true },
      author: { family: "Inter", weight: 400, track: 0.12 },
      maxTitle: (w) => Math.min(10.2, w * 0.205),
      maxAuthor: (w) => Math.min(5.5, w * 0.105),
    },
    cloth: {
      name: "Clothbound",
      title: { family: "Cormorant Garamond", weight: 600, track: 0.11, upper: true },
      author: { family: "Cormorant Garamond", weight: 500, track: 0.13 },
      maxTitle: (w) => Math.min(9.7, w * 0.193),
      maxAuthor: (w) => Math.min(5.6, w * 0.107),
    },
    hybrid: {
      name: "Hybrid",
      title: { family: "Cormorant Garamond", weight: 600, track: 0.055, upper: false },
      author: { family: "EB Garamond", weight: 400, track: 0.08 },
      maxTitle: (w) => Math.min(9.5, w * 0.193),
      maxAuthor: (w) => Math.min(5.3, w * 0.102),
    },
  };

  const GEOMETRY = {
    editorial: { head: 18, tail: 20, gap: 6, ornY: 7, ornSize: 8 },
    cloth: { head: 33, tail: 17, gap: 8, ornY: 13, ornSize: 11 },
    hybrid: { head: 26, tail: 16, gap: 5, ornY: 12, ornSize: 8 },
  };

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const metricsCache = new Map();

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

  /* ---------- colour helpers --------------------------------------------- */

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
  function readableInk(bg) {
    const cream = "#f2e6c9", dark = "#241a12";
    return contrast(bg, cream) >= contrast(bg, dark) ? cream : dark;
  }

  /* ---------- ornaments --------------------------------------------------- */

  const ORNAMENTS = ["lozenge", "sun", "wave", "sprig"];
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
    return open + '<path d="M12 2.7 21.3 12 12 21.3 2.7 12Z"/><path d="M12 7.2 16.8 12 12 16.8 7.2 12Z" opacity=".55"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>';
  }

  /* ---------- layout: the actual design algorithm ------------------------- */

  function artPosition(book, windowWidth, scale) {
    if (!book.art) return 50;
    const h = book.heightPx * scale;
    const imageWidth = h * (2 / 3);
    const slice = windowWidth / imageWidth;
    const focus = (book.focus && book.focus[0]) || 0.5;
    return clamp(((focus - slice / 2) / (1 - slice)) * 100, 0, 100);
  }

  function layout(book, dir) {
    const key = `${book.id}:${dir}`;
    if (cache.has(key)) return cache.get(key);
    const spec = SPECS[dir];
    const geo = GEOMETRY[dir];
    const w = book.widthPx;
    const h = book.heightPx;

    let railW = 0, paperW = 0, artW = w;
    let titleX = w / 2;
    let thickness = w - 9;
    if (dir === "editorial") {
      railW = w * 0.445;
      artW = w;
      thickness = railW - 2.5;
      titleX = w - 4 - railW / 2;
    } else if (dir === "hybrid") {
      paperW = w * 0.565;
      artW = w - paperW;
      thickness = paperW - 7;
      titleX = w - paperW / 2;
    }

    const titleText = spec.title.upper ? book.title.toLocaleUpperCase() : book.title;
    const authorText = book.author.toLocaleUpperCase();

    // Author first: its measured width reserves the bottom of the title rail.
    const am = measure(authorText, spec.author);
    const authorMax = spec.maxAuthor(w);
    const authorByThickness = thickness / am.ink;
    const authorByLength = (h * 0.31) / am.advance;
    let afs = Math.min(authorMax, authorByThickness, authorByLength);
    afs = Math.max(2.9, Math.floor(afs * 20) / 20);
    const authorW = am.advance * afs + 0.8;

    const len = h - geo.head - geo.tail;
    const availTitle = Math.max(24, len - authorW - geo.gap - 1.2);

    // 3.5% safety margin: the canvas metrics and the browser's rotated ink box
    // are close but not identical, and a spine must never show a clipped word.
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

    // A very long title in a 40–46 px spine can drop below 6 px. If there is
    // room across the rail, set it on two lines instead of shrinking further.
    // Two lines are the maximum: three no longer survive the 40 px case.
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

    // Contrast is measured, not guessed. Editorial rails are always smoked;
    // cloth and paper get the better of a cream or an ink brown.
    const avg = book.measured ? book.measured.avg : "#4a4a4a";
    const railComposite = mix("#0d0e10", avg, 0.12);
    const paper = mix("#ece2ca", book.cloth, 0.055);
    let ink;
    let contrastRatio;
    if (dir === "editorial") {
      ink = "#f2e8d4";
      contrastRatio = contrast(ink, railComposite);
    } else if (dir === "cloth") {
      ink = readableInk(book.cloth);
      contrastRatio = contrast(ink, book.cloth);
    } else {
      ink = "#2c2118";
      contrastRatio = contrast(ink, paper);
    }

    const look = {
      w, h, dir, spec, geo,
      railW, paperW, artW, titleX, thickness,
      titleText, authorText, lines, stacked,
      fs, afs, authorW,
      len, availTitle,
      titleY: geo.head + len / 2,
      head: geo.head, tail: geo.tail,
      ornX: dir === "editorial" ? w - 4 - railW / 2 : dir === "hybrid" ? w - paperW / 2 : w / 2,
      ornY: geo.ornY,
      ornSize: geo.ornSize,
      artPos: artPosition(book, dir === "hybrid" ? artW : w, 1),
      paper, ink, contrastRatio,
      fitLength, fitThickness, limitedBy,
      limiting: Math.max(fitLength, fitThickness),
      cssPx: fs,
    };
    cache.set(key, look);
    return look;
  }

  /* ---------- markup ------------------------------------------------------ */

  function styleString(book, look, scale) {
    const p = (v) => `${(v * scale).toFixed(2)}px`;
    const vars = [
      ["--w", p(look.w)],
      ["--h", p(look.h)],
      ["--cloth", book.cloth],
      ["--accent", book.accent],
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
    ];
    if (look.dir === "editorial") vars.push(["--rail-w", p(look.railW)]);
    if (look.dir === "hybrid") {
      vars.push(["--paper-w", p(look.paperW)]);
      vars.push(["--art-w", p(look.artW)]);
    }
    if (book.art && !artFailed.has(book.slug)) vars.push(["--art", `url('${book.art}')`]);
    return vars.map(([k, v]) => `${k}:${v}`).join(";");
  }

  function spineMarkup(book, opts) {
    const dir = (opts && opts.dir) || state.direction;
    const scale = (opts && opts.scale) || 1;
    const preview = !!(opts && opts.preview);
    const look = layout(book, dir);
    const tag = preview ? "div" : "button";
    const routeClass = `spine__prov--${book.route}`;
    const orn = ORNAMENTS[(book.id - 1) % ORNAMENTS.length];
    const artless = !book.art || artFailed.has(book.slug);
    const title = esc(book.title);
    const author = esc(book.author);
    const label = `${book.title} by ${book.author}. ${book.badge}. ${SPECS[dir].name} direction.`;
    const attrs = preview
      ? ' aria-hidden="true"'
      : ` type="button" aria-label="${esc(label)}" data-book-id="${book.id}"`;
    return `<${tag} class="spine spine--${dir}${book.route === "fallback" ? " spine--fallback" : ""}${artless ? " is-artless" : ""}"${attrs}` +
      ` data-route="${book.route}" data-fs="${look.fs.toFixed(2)}" data-fit="${look.limiting.toFixed(3)}"` +
      ` style="${styleString(book, look, scale)}">` +
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
        `<span class="spine__author">${author}</span>` +
        `<span class="spine__title${look.stacked ? " spine__title--stacked" : ""}">${look.stacked ? look.lines.map((l) => `<span class="spine__title-line">${esc(l)}</span>`).join("") : title}</span>` +
      `</span>` +
      `<span class="spine__grain"></span>` +
      `<span class="spine__sheen"></span>` +
      `<span class="spine__vignette"></span>` +
      `<span class="spine__edge spine__edge--l"></span>` +
      `<span class="spine__edge spine__edge--r"></span>` +
      `<span class="spine__prov ${routeClass}" aria-hidden="true"></span>` +
      `</${tag}>`;
  }

  function shelfMeta(books) {
    const o = books.filter((b) => b.route === "original").length;
    const r = books.filter((b) => b.route === "reconstructed").length;
    const f = books.filter((b) => b.route === "fallback").length;
    if (o === books.length) return `${books.length} volumes · original art`;
    const parts = [`${books.length} volumes`];
    if (o) parts.push(`${o} original`);
    if (r) parts.push(`${r} recon`);
    if (f) parts.push(`${f} fallback`);
    return parts.join(" · ");
  }

  function shelfHTML(books, index) {
    const numerals = ["I", "II", "III", "IV", "V", "VI"];
    return `<section class="shelf" aria-label="Shelf ${numerals[index] || index + 1}">` +
      `<div class="shelf__head"><span class="shelf__no">Shelf <b>${numerals[index] || index + 1}</b></span>` +
      `<span class="shelf__meta">${esc(shelfMeta(books))}</span></div>` +
      `<div class="shelf__stage">` +
        `<ul class="shelf__books">` +
          books.map((b) => `<li class="book${b.id === state.selected ? " book--selected" : ""}" data-id="${b.id}" style="--w:${b.widthPx}px;--h:${b.heightPx}px">${spineMarkup(b)}</li>`).join("") +
        `</ul>` +
        `<div class="shelf__board" aria-hidden="true"></div>` +
      `</div>` +
      `</section>`;
  }

  function pack(books, available, gap) {
    // Balanced contiguous partition. The shortest row count wins; among those,
    // minimise the sum of squared slack so the shelf never ends with a lonely
    // book (or a 15/6 split on a wide screen). Order is preserved.
    const n = books.length;
    if (!n) return [];
    const prefix = [0];
    for (const b of books) prefix.push(prefix[prefix.length - 1] + b.widthPx);
    const rowWidth = (i, j) => prefix[j] - prefix[i] + gap * (j - i - 1);
    const INF = 1e12;

    for (let rows = 1; rows <= n; rows++) {
      const dp = Array.from({ length: rows + 1 }, () => Array(n + 1).fill(INF));
      const from = Array.from({ length: rows + 1 }, () => Array(n + 1).fill(-1));
      dp[0][0] = 0;
      for (let r = 1; r <= rows; r++) {
        for (let j = 1; j <= n; j++) {
          for (let i = r - 1; i < j; i++) {
            if (dp[r - 1][i] >= INF) continue;
            const w = rowWidth(i, j);
            if (w > available + 0.01) continue;
            // Slightly favour a fuller first shelf: the eye reads left-to-right,
            // top-to-bottom, and a full top row sets the rhythm.
            const rowWeight = 1 + (rows - r) * 0.10;
            const cost = dp[r - 1][i] + Math.pow(available - w, 2) * rowWeight;
            if (cost < dp[r][j]) { dp[r][j] = cost; from[r][j] = i; }
          }
        }
      }
      if (dp[rows][n] < INF) {
        const balanced = [];
        let j = n;
        for (let r = rows; r >= 1; r--) {
          const i = from[r][j];
          balanced.unshift(books.slice(i, j));
          j = i;
        }
        // Prefer a front-heavy row count (6/5/5/5) over an equal-slack one
        // (5/5/6/5): a full first shelf sets the rhythm. Keep the balanced
        // partition if the front-heavy split cannot physically fit.
        const counts = Array.from({ length: rows }, (_, i) => Math.floor(n / rows) + (i < n % rows ? 1 : 0));
        let start = 0;
        let feasible = true;
        const front = [];
        for (const count of counts) {
          const end = start + count;
          if (rowWidth(start, end) > available + 0.01) { feasible = false; break; }
          front.push(books.slice(start, end));
          start = end;
        }
        return feasible ? front : balanced;
      }
    }
    return [books];
  }

  function filteredBooks() {
    return state.filter === "all" ? BOOKS : BOOKS.filter((b) => b.route === state.filter);
  }

  function shelfAvailable() {
    const zone = $("#shelves");
    const narrow = window.innerWidth <= 520;
    return Math.max(240, zone.clientWidth - (narrow ? 18 : 32));
  }

  function bookGap() {
    return window.innerWidth <= 380 ? 3.5 : window.innerWidth <= 520 ? 4 : 5;
  }

  function renderShelves() {
    const list = filteredBooks();
    const gap = bookGap();
    const rows = pack(list, shelfAvailable(), gap);
    let html = rows.map((row, i) => shelfHTML(row, i)).join("");
    if (!rows.length) {
      html = '<p class="empty">No spines in this provenance class.</p>';
    } else {
      html += `<p class="shelf-legend" aria-label="Provenance marks">` +
        `<span class="legend__item"><i class="mark mark--original" aria-hidden="true"></i>original art</span>` +
        `<span class="legend__item"><i class="mark mark--reconstructed" aria-hidden="true"></i>reconstructed</span>` +
        `<span class="legend__item"><i class="mark mark--fallback" aria-hidden="true"></i>typographic fallback</span>` +
        `<span class="legend__hint">select a spine to read its record</span>` +
        `</p>`;
    }
    const zone = $("#shelves");
    zone.innerHTML = html;
    zone.style.setProperty("--book-gap", `${gap}px`);
    $$(".shelf__books", zone).forEach((n) => n.style.setProperty("--book-gap", `${gap}px`));

    lastMetrics = list.map((b) => {
      const l = layout(b, state.direction);
      return {
        id: b.id, slug: b.slug, title: b.title, direction: state.direction,
        widthPx: b.widthPx, heightPx: b.heightPx,
        fontSize: l.fs, authorSize: l.afs,
        fitLength: l.fitLength, fitThickness: l.fitThickness,
        limiting: l.limiting, limitedBy: l.limitedBy, contrast: l.contrastRatio,
        titleText: l.titleText, stacked: l.stacked, lines: l.lines, visible: state.rail || b.route === "fallback",
      };
    });
    updateFitline();
  }

  /* ---------- detail ------------------------------------------------------ */

  function detailHTML(book) {
    const look = layout(book, state.direction);
    const previewScale = state.actual ? 1 : 1.55;
    const limiting = Math.round(look.limiting * 100);
    const routeName = book.route === "original" ? "Original art"
      : book.route === "reconstructed" ? "Reconstructed" : "Typographic fallback";
    const artCopy = book.route === "fallback"
      ? "No cover pixels. Measured edge colour and fitted type."
      : book.artSubtype + (book.route === "reconstructed" ? " · invented under the type" : " · used directly");
    return `<div class="detail__inner">` +
      `<div class="detail__stage"><div class="detail__spinewrap">${spineMarkup(book, { preview: true, scale: previewScale })}</div></div>` +
      `<div class="detail__body">` +
        `<p class="kicker">Selected spine · ${esc(SPECS[state.direction].name)}</p>` +
        `<h2 class="detail__title">${esc(book.title)}</h2>` +
        `<p class="detail__author">${esc(book.author)}</p>` +
        `<div class="detail__badges">` +
          `<span class="pill pill--${book.route}">${esc(book.badge)}</span>` +
          `<span class="pill pill--quiet">${esc(routeName)} route</span>` +
          `<span class="pill pill--quiet">${book.pages} pp</span>` +
        `</div>` +
        `<p class="detail__note">${esc(book.note)}</p>` +
        `<dl class="specs">` +
          `<div><dt>Spine model</dt><dd><b>${book.spineMm.toFixed(1)} mm</b><br><small>${book.pages} pp × 0.100 mm + 1.2 mm</small></dd></div>` +
          `<div><dt>Shelf width</dt><dd><b>${book.widthPx.toFixed(1)} px</b><br><small>display zoom, 40–55 clamp</small></dd></div>` +
          `<div><dt>Type size</dt><dd><b>${look.fs.toFixed(1)} px</b><br><small>${look.stacked ? "two lines" : Math.round(look.fitLength * 100) + "% length"}</small></dd></div>` +
          `<div><dt>Ink used</dt><dd><b>${limiting}%</b><br><small>${esc(look.limitedBy)} · no clipping</small></dd></div>` +
          `<div><dt>Contrast</dt><dd><b>${look.contrastRatio.toFixed(1)}:1</b><br><small>measured ink / field</small></dd></div>` +
          `<div><dt>Treatment</dt><dd><b>${esc(state.direction === "editorial" ? "full-bleed + rail" : state.direction === "cloth" ? "cloth + foil" : "art window + paper")}</b><br><small>${esc(artCopy)}</small></dd></div>` +
        `</dl>` +
        `<div class="detail__actions">` +
          `<button class="quiet-btn" type="button" data-actual>${state.actual ? "Enlarge" : "Actual size"}</button>` +
          `<button class="quiet-btn" type="button" data-copy>Copy tokens</button>` +
          `<span class="detail__swatches" aria-label="Palette">` +
            `<i style="background:${book.cloth}" title="cloth ${book.cloth}"></i>` +
            `<i style="background:${book.accent}" title="accent ${book.accent}"></i>` +
            `<i style="background:${look.paper}" title="paper ${look.paper}"></i>` +
            `<i style="background:${look.ink}" title="ink ${look.ink}"></i>` +
          `</span>` +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  function renderDetail() {
    let book = BOOKS.find((b) => b.id === state.selected);
    const list = filteredBooks();
    if (!book || !list.some((b) => b.id === book.id)) {
      book = list[0] || BOOKS[0];
      state.selected = book.id;
    }
    $("#detail").innerHTML = detailHTML(book);
  }

  function syncSelection() {
    $$(".book").forEach((li) => li.classList.toggle("book--selected", Number(li.dataset.id) === state.selected));
  }

  /* ---------- fit line ---------------------------------------------------- */

  function updateFitline() {
    const node = $("#fitline-text");
    if (!node) return;
    if (!lastMetrics.length) {
      node.textContent = "No spines in this view.";
      return;
    }
    const tightest = lastMetrics.reduce((m, x) => Math.max(m, x.limiting), 0);
    const smallest = lastMetrics.reduce((m, x) => Math.min(m, x.fontSize), 99);
    const lowContrast = lastMetrics.filter((x) => x.contrast < 4.5).length;
    if (!state.rail) {
      node.innerHTML = `<b>Rail off.</b> Type hidden; measured fit retained: ${lastMetrics.length}/${lastMetrics.length} titles fit, tightest <b>${Math.round(tightest * 100)}%</b> of its rail.`;
    } else {
      node.innerHTML = `Measured with canvas · <b>${lastMetrics.length}/${lastMetrics.length}</b> titles fit · tightest <b>${Math.round(tightest * 100)}%</b> · smallest <b>${smallest.toFixed(1)} px</b> · ${lowContrast ? `<b>${lowContrast}</b> below 4.5:1` : "all ink above 4.5:1"}.`;
    }
  }

  /* ---------- state changes ---------------------------------------------- */

  function setDirection(dir) {
    if (!SPECS[dir]) return;
    state.direction = dir;
    document.documentElement.dataset.dir = dir;
    $$("[data-dir-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.dirBtn === dir)));
    renderShelves();
    renderDetail();
  }

  function setRail(on) {
    state.rail = !!on;
    document.documentElement.dataset.rail = state.rail ? "on" : "off";
    $("#rail-on").setAttribute("aria-pressed", String(state.rail));
    $("#rail-off").setAttribute("aria-pressed", String(!state.rail));
    updateFitline();
  }

  function setLight(light) {
    state.light = light;
    document.body.dataset.light = light;
    $$("[data-light-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.lightBtn === light)));
  }

  function setMaterial(on) {
    state.material = !!on;
    document.documentElement.dataset.material = state.material ? "on" : "off";
    $("#material-toggle").setAttribute("aria-pressed", String(state.material));
    $("#material-text").textContent = state.material ? "Cues on" : "Cues off";
  }

  function setFilter(filter) {
    state.filter = filter;
    $$("[data-filter-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.filterBtn === filter)));
    const list = filteredBooks();
    if (!list.some((b) => b.id === state.selected) && list.length) state.selected = list[0].id;
    renderShelves();
    renderDetail();
  }

  function selectBook(id, scroll) {
    const book = BOOKS.find((b) => b.id === Number(id));
    if (!book) return;
    state.selected = book.id;
    syncSelection();
    renderDetail();
    if (scroll) $("#detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function copyTokens() {
    const book = BOOKS.find((b) => b.id === state.selected);
    if (!book) return;
    const look = layout(book, state.direction);
    const tokens = {
      book: book.title, direction: state.direction,
      spine: { pages: book.pages, mm: book.spineMm, shelfPx: book.widthPx },
      type: { family: look.spec.title.family, weight: look.spec.title.weight, sizePx: +look.fs.toFixed(2), tracking: look.spec.title.track, uppercase: look.spec.title.upper },
      author: { family: look.spec.author.family, sizePx: +look.afs.toFixed(2), tracking: look.spec.author.track },
      fit: { length: +look.fitLength.toFixed(3), thickness: +look.fitThickness.toFixed(3) },
      palette: { cloth: book.cloth, accent: book.accent, paper: look.paper, ink: look.ink },
      contrast: +look.contrastRatio.toFixed(2),
      provenance: book.route,
    };
    const done = () => {
      const btn = $("[data-copy]");
      if (btn) { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy tokens"; }, 1400); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(JSON.stringify(tokens, null, 2)).then(done).catch(done);
    } else {
      done();
    }
  }

  /* ---------- boot -------------------------------------------------------- */

  async function loadFonts() {
    // The faces are declared in CSS (so they carry the OFL files and the right
    // variable weight ranges). Trigger the ones we need, then wait for the set.
    const wanted = [
      '100 10px "Inter"',
      '600 10px "Cormorant Garamond"',
      '400 10px "EB Garamond"',
      '400 10px "Literata"',
    ];
    await Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => null)));
    await document.fonts.ready;
  }

  async function preloadArt() {
    const urls = Array.from(new Set(BOOKS.filter((b) => b.art).map((b) => b.art)));
    await Promise.allSettled(urls.map((url) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ url, ok: true });
      img.onerror = () => {
        const book = BOOKS.find((b) => b.art === url);
        if (book) artFailed.add(book.slug);
        resolve({ url, ok: false });
      };
      img.src = url;
    })));
  }

  function bind() {
    $$("[data-dir-btn]").forEach((n) => n.addEventListener("click", () => setDirection(n.dataset.dirBtn)));
    $("#rail-on").addEventListener("click", () => setRail(true));
    $("#rail-off").addEventListener("click", () => setRail(false));
    $$("[data-light-btn]").forEach((n) => n.addEventListener("click", () => setLight(n.dataset.lightBtn)));
    $("#material-toggle").addEventListener("click", () => setMaterial(!state.material));
    $$("[data-filter-btn]").forEach((n) => n.addEventListener("click", () => setFilter(n.dataset.filterBtn)));

    $("#shelves").addEventListener("click", (e) => {
      const spine = e.target.closest(".spine[data-book-id]");
      if (spine) selectBook(spine.dataset.bookId, true);
    });

    $("#detail").addEventListener("click", (e) => {
      if (e.target.closest("[data-copy]")) { copyTokens(); return; }
      if (e.target.closest("[data-actual]")) {
        state.actual = !state.actual;
        renderDetail();
      }
    });

    let timer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { renderShelves(); renderDetail(); }, 140);
    });
  }

  function updateCounts() {
    const counts = {
      all: BOOKS.length,
      original: BOOKS.filter((b) => b.route === "original").length,
      reconstructed: BOOKS.filter((b) => b.route === "reconstructed").length,
      fallback: BOOKS.filter((b) => b.route === "fallback").length,
    };
    $$("[data-count]").forEach((n) => { n.textContent = counts[n.dataset.count]; });
  }

  const ready = (async () => {
    $("#shelves").innerHTML = '<p class="empty">Loading the shelf…</p>';
    await loadFonts();
    updateCounts();
    renderShelves();
    renderDetail();
    bind();
    document.documentElement.dataset.rail = "on";
    await preloadArt();
    // Re-render once art loading has settled so failed images become cloth.
    renderShelves();
    renderDetail();
    document.body.classList.add("is-ready");
  })();

  window.PocketV6 = {
    ready,
    getState: () => ({ ...state }),
    setDirection,
    setRail,
    setLight,
    setMaterial,
    setFilter,
    selectBook: (id) => selectBook(id, false),
    getMetrics: () => lastMetrics.map((m) => ({ ...m })),
    getLayout: (id) => {
      const b = BOOKS.find((x) => x.id === Number(id));
      return b ? { ...layout(b, state.direction) } : null;
    },
    getAudit: () => {
      const books = filteredBooks();
      return {
        direction: state.direction,
        rail: state.rail,
        light: state.light,
        material: state.material,
        filter: state.filter,
        visible: books.length,
        shelves: $$(".shelf").length,
        metrics: lastMetrics.map((m) => ({ ...m })),
        tightest: lastMetrics.reduce((a, m) => Math.max(a, m.limiting), 0),
        smallestFont: lastMetrics.reduce((a, m) => Math.min(a, m.fontSize), 99),
        lowContrast: lastMetrics.filter((m) => m.contrast < 4.5).length,
      };
    },
  };
})();
