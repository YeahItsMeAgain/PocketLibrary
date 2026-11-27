/* wrap-check harness: render the six styles from real evidence and measure them.
 * All drawing is done by the prototype renderer (renderer-export.js, verbatim).
 */
(function (global) {
  "use strict";

  const R = global.PocketRenderers;
  const I = global.__WRAP_INTERNALS__;
  const SANS = I.SANS, SERIF = I.SERIF;

  const ORDER = [
    ["wrap", "Wrap", "default"],
    ["hybrid", "Hybrid", "paper label"],
    ["fullbleed", "Full-bleed", "art + rail"],
    ["artonly", "Textless", "no type"],
    ["cloth", "Cloth", "foil on cloth"],
    ["editorial", "Editorial", "dark rail"],
  ];

  const TILE_W = 52, TILE_H = 236, DPR = 2;

  /* ---------- pixel helpers ---------------------------------------------- */

  function stats(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, sum2 = 0, n = 0, nonDark = 0;
    let grad = 0, gradN = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        sum += L; sum2 += L * L; n++;
        if (L > 0.10) nonDark++;
        if (x > 0) {
          const j = i - 4;
          grad += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
          gradN++;
        }
        if (y > 0) {
          const j = i - w * 4;
          grad += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
          gradN++;
        }
      }
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return {
      lumaMean: round(mean * 255, 1),
      lumaStd: round(std * 255, 1),
      nonDarkPct: round((nonDark / n) * 100, 1),
      edgeDensity: round(grad / gradN / 255, 3),
    };
  }

  function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

  function drawTo(src, dw, dh) {
    const c = document.createElement("canvas");
    c.width = dw; c.height = dh;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, src.width, src.height, 0, 0, dw, dh);
    return c;
  }

  function meanAbsDiff(a, b) {
    const A = a.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, a.width, a.height).data;
    const B = b.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, b.width, b.height).data;
    const w = a.width, h = a.height;
    let sum = 0, n = 0;
    // central 84%: ignore vignette/edge shading the pipeline spine does not have
    const x0 = Math.floor(w * 0.08), x1 = Math.ceil(w * 0.92);
    const y0 = Math.floor(h * 0.08), y1 = Math.ceil(h * 0.92);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        n += 3;
      }
    }
    return round(sum / n, 1);
  }

  function columnDelta(canvas, xa, xb, dpr) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const d = ctx.getImageData(0, 0, w, h).data;
    const A = Math.round(xa * dpr), B = Math.round(xb * dpr);
    if (A < 0 || B < 0 || A >= w || B >= w) return null;
    const deltas = [];
    for (let y = 4; y < h - 4; y++) {
      const i = (y * w + A) * 4, j = (y * w + B) * 4;
      deltas.push((Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2])) / 3);
    }
    deltas.sort((p, q) => p - q);
    const med = deltas[Math.floor(deltas.length / 2)];
    return round(med, 1);
  }

  function lumaPercentiles(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    const d = ctx.getImageData(0, 0, w, h).data;
    const vals = [];
    // central vertical band: where rotated spine type sits
    const x0 = Math.floor(w * 0.34), x1 = Math.ceil(w * 0.66);
    const y0 = Math.floor(h * 0.08), y1 = Math.ceil(h * 0.92);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        vals.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
      }
    }
    vals.sort((a, b) => a - b);
    const pick = (q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
    return { p10: pick(0.10), p50: pick(0.50), p90: pick(0.90) };
  }

  function contrastVsLuma(inkHex, L) {
    const c = "#" + [L, L, L].map((v) => Math.round(clamp(v * 255, 0, 255)).toString(16).padStart(2, "0")).join("");
    return I.contrast(inkHex, c);
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- wrap helpers ------------------------------------------------ */

  // Mirrors the parameter block in renderWrap() so the measured title fit is
  // the same fit the renderer drew. Only measurement lives here.
  function wrapTitleFit(book) {
    const g = I.wrapGeometry(book.pages || 320);
    const sAuthor = I.fitVertical(book.author || "", {
      family: SANS, weight: 500, track: 0.12, thick: g.spineW - 3,
      length: 48, maxSize: 3.6, minSize: 2.4, stack: false,
    });
    const sAuthorLen = Math.max(...sAuthor.lines.map((l) => I.metrics(l, SANS, 500, 0.12).adv)) * sAuthor.fs;
    const length = g.H - 50 - sAuthorLen - 14;
    const sTitle = I.fitVertical(String(book.title || "").toUpperCase(), {
      family: SANS, weight: 600, track: 0.05, thick: g.spineW - 3,
      length, maxSize: 7.8, minSize: 2.6,
    });
    return { g, sTitle, sAuthor, titleLength: length, authorPx: sAuthor.fs };
  }

  function wrapSheet(book, dpr) {
    return R.render(book, "wrap", { dpr: dpr || 2 });
  }

  function sliceSpine(sheet, book, outW, outH, dpr, mode) {
    const g = I.wrapGeometry(book.pages || 320);
    const spineX = g.bleed + g.frontW;
    const c = document.createElement("canvas");
    c.width = Math.round(outW * dpr);
    c.height = Math.round(outH * dpr);
    c.style.width = outW + "px";
    c.style.height = outH + "px";
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    let w = c.width, x0 = 0;
    if (mode !== "stretch") {
      // keep the real (page-count) spine width, centred in the slot
      w = Math.round(g.spineW * dpr * (c.height / (g.H * dpr)));
      x0 = Math.round((c.width - w) / 2);
    }
    x.drawImage(
      sheet,
      spineX * dpr, 0, g.spineW * dpr, g.H * dpr,
      x0, 0, w, c.height
    );
    return c;
  }

  /* ---------- textless-wrap variant -------------------------------------- */

  // Renders Wrap with every art-bearing panel taken from the engine's art.jpg
  // (front art included) instead of the published cover. The renderer itself
  // chooses the front via book._img.source, so the variant swaps that reference
  // for the duration of the draw and restores it. No renderer code changes.
  function renderWrapTextless(book, dpr) {
    const img = book._img;
    const origSource = img.source;
    try {
      img.source = img.art;
      return R.render(book, "wrap", { dpr: dpr || 2 });
    } finally {
      img.source = origSource;
    }
  }

  function wrapContrast(book) {
    const pal = I.paletteFor(book);
    const artOnly = R.render(book, "artonly", { dpr: DPR }).canvas;
    const lp = lumaPercentiles(artOnly);
    const ink = I.readableInk(pal.avg);
    return {
      ink,
      palAvg: pal.avg,
      p10: round(lp.p10 * 255, 1),
      p50: round(lp.p50 * 255, 1),
      p90: round(lp.p90 * 255, 1),
      avgContrast: round(I.contrast(ink, pal.avg), 2),
      localContrast: round(Math.min(contrastVsLuma(ink, lp.p10), contrastVsLuma(ink, lp.p90)), 2),
    };
  }

  function diffRegion(a, b, rect, dpr) {
    const ax = a.getContext("2d", { willReadFrequently: true });
    const bx = b.getContext("2d", { willReadFrequently: true });
    const x0 = Math.round(rect[0] * dpr), y0 = Math.round(rect[1] * dpr);
    const w = Math.round(rect[2] * dpr), h = Math.round(rect[3] * dpr);
    const A = ax.getImageData(x0, y0, w, h).data;
    const B = bx.getImageData(x0, y0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < A.length; i += 4) {
      sum += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      n += 3;
    }
    return round(sum / n, 1);
  }

  /* ---------- measure ---------------------------------------------------- */

  function analyseTile(book, style, out, tile, extra, measure) {
    const st = stats(measure || tile);
    const m = out.metrics || {};
    let titlePx = m.titlePx || 0;
    let fit = m.fit;
    let contrast = m.contrast == null ? null : m.contrast;
    let nativeW = TILE_W;
    let shelfScale = 33 / TILE_W;

    if (style === "wrap") {
      const wf = wrapTitleFit(book);
      const pal = I.paletteFor(book);
      nativeW = wf.g.spineW;
      titlePx = wf.sTitle.fs;
      fit = wf.sTitle.limiting;
      contrast = I.contrast(I.readableInk(pal.avg), pal.avg);
      const artOnly = R.render(book, "artonly", { dpr: DPR }).canvas;
      const lp = lumaPercentiles(artOnly);
      const ink = I.readableInk(pal.avg);
      const localContrast = Math.min(contrastVsLuma(ink, lp.p10), contrastVsLuma(ink, lp.p90));
      shelfScale = 33 / nativeW;
      extra = Object.assign({}, extra, {
        localContrast: round(localContrast, 2),
        backdropP10: round(lp.p10 * 255, 1),
        backdropP50: round(lp.p50 * 255, 1),
        backdropP90: round(lp.p90 * 255, 1),
        ink: ink,
        spinePx: nativeW,
        spineMm: round(wf.g.spineMm, 1),
        sheetW: wf.g.totalW,
        sheetH: wf.g.H,
        stretchTo52: round(TILE_W / nativeW, 2),
        titleLengthRatio: round(wf.sTitle.lengthRatio, 3),
        authorPx: wf.authorPx,
        palAvg: pal.avg,
      });
    }

    const r = {
      label: out.label,
      rendered: st.lumaStd > 0.5 && st.edgeDensity > 0.001,
      size: TILE_W + "×" + TILE_H,
      titlePx: round(titlePx, 2),
      effectiveTitlePx33: round(titlePx * shelfScale, 2),
      fitRatio: fit == null ? null : round(fit, 3),
      contrast: contrast == null ? null : round(contrast, 2),
      lumaMean: st.lumaMean,
      lumaStd: st.lumaStd,
      nonDarkPct: st.nonDarkPct,
      edgeDensity: st.edgeDensity,
      ...extra,
    };
    r.flags = flagsFor(style, r);
    r.verdict = verdictFor(style, r);
    return r;
  }

  function flagsFor(style, r) {
    const f = [];
    if (!r.rendered) f.push("blank");
    if (r.lumaStd < 12 || r.nonDarkPct < 8) f.push("flat-or-empty");
    if (r.fitRatio != null && r.fitRatio > 1.02) f.push("type-clipped");
    if (style !== "artonly" && r.effectiveTitlePx33 > 0 && r.effectiveTitlePx33 < 2.2) f.push("type-tiny-at-33");
    if ((r.localContrast != null ? r.localContrast : r.contrast) != null && (r.localContrast != null ? r.localContrast : r.contrast) < 3) f.push("low-contrast");
    if (style !== "artonly" && r.titlePx > 0.85 * (style === "wrap" ? r.spinePx : TILE_W)) f.push("giant-type");
    if (r.cropDelta != null && r.cropDelta > 28) f.push("crop-mismatch");
    return f;
  }

  function verdictFor(style, r) {
    if (r.flags.includes("blank") || r.flags.includes("flat-or-empty")) {
      return style === "artonly" ? "Art is essentially flat here; nothing to read." : "Unreadable / effectively blank at spine size.";
    }
    if (r.flags.includes("type-clipped")) return "Title is clipped: the fit runs past the box at minimum size.";
    if (r.flags.includes("type-tiny-at-33")) return "Title type is below 2.2 px at 33 px: not legible on a shelf.";
    if (r.flags.includes("low-contrast")) return "Ink contrast under 3:1 against the actual pixels behind the type.";
    if (r.flags.includes("crop-mismatch")) return "The rendered art does not match the pipeline's spine crop.";
    if (r.flags.includes("giant-type")) return "Type fills more than half the spine thickness; it reads as decoration.";
    return "Legible, correctly cropped, no clipping.";
  }

  /* ---------- boot ------------------------------------------------------- */

  async function init(root) {
    if (!R || !I) throw new Error("renderer not loaded");
    const books = global.WRAP_CHECK_BOOKS || [];
    await R.ready();
    await document.fonts.ready;

    const results = [];
    root.textContent = "";
    document.getElementById("f-books").textContent = books.length;

    for (const book of books) {
      await R.loadBook(book);
      const section = document.createElement("section");
      section.className = "book";
      section.dataset.slug = book.slug;

      const head = document.createElement("header");
      head.className = "book__head";
      head.innerHTML =
        '<div><h2>' + esc(book.title) + "</h2>" +
        '<p class="book__byline">' + esc(book.author) + " · " + book.pages + " pp · " +
        esc(book.route) + " · mask " + book.maskCoverage.toFixed(1) + "%</p></div>" +
        '<div class="pill pill--' + (book.verdict === "pass" ? "pass" : "review") + '"><b>' +
        esc(book.verdict) + "</b><span>" + esc(book.route) + "</span></div>";
      section.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "grid";
      section.appendChild(grid);

      const row = { slug: book.slug, title: book.title, pages: book.pages, route: book.route, verdict: book.verdict, artSha256: book.artSha256, sourceSha256: book.sourceSha256, artIsSource: book.artIsSource, styles: {} };

      // pipeline spine for the crop-accuracy check
      const pipeline = await loadCanvas(book.spine);
      const pipe52 = drawTo(pipeline, TILE_W, TILE_H);

      let sheet = null;
      for (const [style, label, sub] of ORDER) {
        const out = R.render(book, style, { dpr: DPR });
        let tile;
        let extra = {};
        let measureCanvas = null;
        if (style === "wrap") {
          sheet = out.canvas;
          const g = I.wrapGeometry(book.pages || 320);
          tile = sliceSpine(sheet, book, TILE_W, TILE_H, DPR, "contain");
          measureCanvas = sliceSpine(sheet, book, g.spineW, TILE_H, DPR, "contain");
          extra.spinePxNative = g.spineW;
        } else {
          tile = out.canvas;
        }
        // crop check only on the pure art render
        if (style === "artonly") {
          const flat = R.render(book, style, { dpr: 1 }).canvas;
          extra.cropDelta = meanAbsDiff(flat, pipe52);
        }
        const m = analyseTile(book, style, out, tile, extra, measureCanvas);

        const fig = document.createElement("figure");
        fig.className = "tile";
        fig.dataset.style = style;
        const slot = document.createElement("div");
        slot.className = "tile__slot";
        slot.appendChild(tile);
        fig.appendChild(slot);
        const cap = document.createElement("figcaption");
        cap.innerHTML = "<b>" + esc(label) + "</b><small>" + esc(metricLine(style, m, sub)) + "</small>";
        fig.appendChild(cap);
        grid.appendChild(fig);
        row.styles[style] = m;
      }

      // full sheet + 33 px shelf strip
      const g = I.wrapGeometry(book.pages || 320);
      row.wrap = {
        spinePx: g.spineW,
        spineMm: round(g.spineMm, 1),
        sheetCssW: g.totalW,
        sheetCssH: g.H,
        trim: g.trim,
      };
      row.wrap.seam = seamCheck(sheet, g, DPR);

      const row2 = document.createElement("div");
      row2.className = "row2";
      const sheetBox = document.createElement("div");
      sheetBox.className = "sheetbox";
      sheetBox.innerHTML = "<h3>Wrap sheet · back / spine / front</h3>";
      sheet.style.width = "100%";
      sheet.style.height = "auto";
      sheetBox.appendChild(sheet);
      const note = document.createElement("p");
      note.className = "sheetnote";
      note.textContent = g.totalW + " × " + g.H + " px · " + g.spineMm.toFixed(1) +
        " mm spine → " + g.spineW + " px · " + g.trim + " trim · front is the published cover";
      sheetBox.appendChild(note);
      row2.appendChild(sheetBox);

      const shelfBox = document.createElement("div");
      shelfBox.className = "shelfbox";
      shelfBox.innerHTML = "<h3>Shelf · wrap spine at 33 px</h3>";
      const shelfRow = document.createElement("div");
      shelfRow.className = "shelfrow";
      const strip33 = sliceSpine(sheet, book, 33, 236, DPR, "stretch");
      const s = document.createElement("div");
      s.className = "shelf";
      s.appendChild(strip33);
      const sl = document.createElement("span");
      sl.textContent = book.title;
      s.appendChild(sl);
      shelfRow.appendChild(s);
      shelfBox.appendChild(shelfRow);
      const sn = document.createElement("p");
      sn.className = "sheetnote";
      sn.textContent = "native " + g.spineW + " px spine, drawn at the 33 px shelf slot";
      shelfBox.appendChild(sn);
      row2.appendChild(shelfBox);
      section.appendChild(row2);

      section.appendChild(notesBlock(book, row));
      root.appendChild(section);
      results.push(row);
    }

    global.__WRAP_CHECK__ = {
      generated: new Date().toISOString(),
      tile: TILE_W + "×" + TILE_H,
      dpr: DPR,
      books: results,
    };
    return results;
  }

  function metricLine(style, m, sub) {
    const bits = [];
    if (style === "artonly") bits.push("0 type");
    else bits.push("title " + m.titlePx + "px · " + Math.round((m.fitRatio || 0) * 100) + "% of box");
    if (style === "wrap") bits.push(m.spinePx + "px spine");
    if (style === "wrap" && m.localContrast != null) bits.push("local " + m.localContrast.toFixed(1) + ":1");
    else if (m.contrast != null) bits.push(m.contrast.toFixed(1) + ":1");
    if (m.flags.length) bits.push(m.flags[0]);
    return bits.join(" · ");
  }

  function seamCheck(sheet, g, dpr) {
    const spineX = g.bleed + g.frontW;
    const frontX = g.bleed + g.frontW + g.spineW;
    const interior = columnDelta(sheet, spineX + 8, spineX + 9, dpr);
    const backFold = columnDelta(sheet, spineX - 2, spineX + 2, dpr);
    const frontFold = columnDelta(sheet, frontX - 2, frontX + 2, dpr);
    const level = (v) => v == null ? null : v < 20 ? "subtle" : v <= 35 ? "visible" : "strong";
    return {
      interiorDelta: interior,
      backFoldDelta: backFold,
      frontFoldDelta: frontFold,
      backFold: level(backFold),
      frontFold: level(frontFold),
    };
  }

  function notesBlock(book, row) {
    const known = {
      "the-great-gatsby": [
        ["warn", "Cover is a white jacket border; the crop is a clean rule strip but does not identify the book."],
      ],
      "dune": [
        ["bad", "The huge decorative DUNE letterforms survive inside the crop (detector cannot box display type). Pass is structural, not text-free."],
      ],
      "pride-and-prejudice": [
        ["ok", "Warm portrait strip; faces and shawl survive at 52 px."],
      ],
      "rock-paper-scissors": [
        ["bad", "44% of the cover is reconstructed; spine is snow texture with a red edge, not a recognisable title."],
      ],
      "the-war-of-the-worlds": [
        ["warn", "Full art has a dark MI-GAN patch where the title band was; the chosen spine crop avoids it, a wrap back taken from the same art would show it."],
      ],
      "the-hobbit": [
        ["warn", "Very dark spine (luma p5 = 0, 43% non-dark); cream type is the only thing that reads."],
      ],
    };
    const dl = document.createElement("details");
    dl.className = "detail";
    const flagged = [];
    for (const [style] of ORDER) {
      const m = row.styles[style];
      if (m.flags.length) flagged.push(style + ": " + m.flags.join(", "));
    }
    const ul = document.createElement("ul");
    ul.className = "notes";
    (known[book.slug] || []).forEach(([cls, text]) => {
      const li = document.createElement("li");
      li.className = cls;
      li.textContent = text;
      ul.appendChild(li);
    });
    if (flagged.length) {
      const li = document.createElement("li");
      li.className = "warn";
      li.textContent = "Measured flags — " + flagged.join(" · ");
      ul.appendChild(li);
    }
    dl.appendChild(ul);
    return dl;
  }

  function loadCanvas(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve(c);
      };
      img.onerror = () => reject(new Error("failed " + src));
      img.src = src;
    });
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  global.WrapCheck = { init, wrapSheet, sliceSpine, wrapTitleFit, stats, renderWrapTextless, wrapContrast, diffRegion, TILE_W, TILE_H, ORDER, esc };
})(window);

(async function () {
  const root = document.getElementById("books");
  if (!root) return;
  try {
    await window.WrapCheck.init(root);
    window.__WRAP_CHECK_READY__ = true;
  } catch (e) {
    root.innerHTML =
      '<p class="loading">Render failed: ' + String(e && e.message || e) + "</p>";
    window.__WRAP_CHECK_ERROR__ = String(e && e.stack || e);
  }
})();
