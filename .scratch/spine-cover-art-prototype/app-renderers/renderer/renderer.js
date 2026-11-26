/* PocketLibrary app-renderers — v8-app output -> four spine styles.
 *
 * Pure canvas/DOM. Consumes the files the v8-app / v8-android pipeline writes:
 *   source.jpg (original), art.jpg (textless art), spine-2x.jpg (52x236 crop),
 *   fallback-spine.jpg, run.json / qa.json metadata.
 *
 * The same module runs in the gallery (HTTP) and in the Android WebView test
 * APK (data: URIs supplied by the native side). No network, no dependencies.
 */
(function (global) {
  "use strict";

  const SERIF = '"EB Garamond", "Literata", Georgia, serif';
  const SANS = 'ui-sans-serif, system-ui, "Roboto", "Helvetica Neue", Arial, sans-serif';
  const SPINE_W = 52;
  const SPINE_H = 236;
  const STYLES = ["fullbleed", "artonly", "wrap", "hybrid", "cloth", "editorial"];

  const LABELS = {
    fullbleed: "Full-bleed",
    artonly: "Textless art-only",
    wrap: "Wrap engine",
    hybrid: "Design system · Hybrid",
    cloth: "Design system · Cloth",
    editorial: "Design system · Editorial",
  };

  const BLURBS = {
    fullbleed: "v8 crop full bleed with a smoked title rail. Literal, cover-derived.",
    artonly: "The same crop with zero typography. Only the pipeline's art and edge shading.",
    wrap: "Page-count spine width. Front is the published cover; spine is the v8 crop; back is generated from v8 art.",
    hybrid: "Art window plus a measured paper label. The v6 recommendation.",
    cloth: "Cloth colour sampled from the v8 art, foil type, no art window.",
    editorial: "Full-bleed art and a narrow type rail in one sans voice.",
  };

  /* ---------- utilities --------------------------------------------------- */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (!src) return reject(new Error("no image"));
      const img = new Image();
      img.decoding = "async";
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image failed: " + src.slice(0, 80)));
      img.src = src;
    });
  }

  /* ---------- palette sampling ------------------------------------------- */

  const palCache = new WeakMap();
  function paletteFor(book) {
    if (palCache.has(book)) return palCache.get(book);
    const img = book._img.art || book._img.source;
    const out = {
      avg: "#4a4a4a", dominant: "#3b3b3b", edge: "#303030",
      light: false, luma: 0.28,
    };
    if (!img) { palCache.set(book, out); return out; }
    try {
      const c = document.createElement("canvas");
      c.width = 32; c.height = 48;
      const x = c.getContext("2d", { willReadFrequently: true });
      const r = artCropRect(book);
      x.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let sr = 0, sg = 0, sb = 0, n = 0, sumL = 0;
      const buckets = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
        sr += r0; sg += g0; sb += b0; n++;
        const L = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
        sumL += L;
        const key = ((r0 >> 4) << 8) | ((g0 >> 4) << 4) | (b0 >> 4);
        const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        b.n++; b.r += r0; b.g += g0; b.b += b0;
        buckets.set(key, b);
      }
      const avg = rgbToHex([sr / n, sg / n, sb / n]);
      let best = null;
      buckets.forEach((b) => { if (!best || b.n > best.n) best = b; });
      const dom = best ? rgbToHex([best.r / best.n, best.g / best.n, best.b / best.n]) : avg;
      // left 10 % edge colour (where a fold-adjacent strip would sit)
      const ec = document.createElement("canvas");
      ec.width = 8; ec.height = 32;
      const ex = ec.getContext("2d", { willReadFrequently: true });
      ex.drawImage(img, r[0], r[1], Math.max(2, r[2] * 0.1), r[3], 0, 0, ec.width, ec.height);
      const ed = ex.getImageData(0, 0, ec.width, ec.height).data;
      let er = 0, eg = 0, eb = 0, en = 0;
      for (let i = 0; i < ed.length; i += 4) { er += ed[i]; eg += ed[i + 1]; eb += ed[i + 2]; en++; }
      out.avg = avg;
      out.dominant = dom;
      out.edge = rgbToHex([er / en, eg / en, eb / en]);
      out.luma = sumL / n;
      out.light = out.luma > 0.56;
    } catch (e) { /* tainted canvas in file:// -> neutral palette */ }
    palCache.set(book, out);
    return out;
  }

  /* ---------- image geometry --------------------------------------------- */

  function fallbackCrop(img) {
    if (!img) return [0, 0, 10, 10];
    const ar = SPINE_W / SPINE_H;
    let sw = img.naturalHeight * ar;
    if (sw > img.naturalWidth) { const sh = img.naturalWidth / ar; return [0, (img.naturalHeight - sh) / 2, img.naturalWidth, sh]; }
    return [(img.naturalWidth - sw) / 2, 0, sw, img.naturalHeight];
  }

  // The v8 pipeline writes final.crop_box_work in art.jpg coordinates.
  function artCropRect(book) {
    const img = book._img && (book._img.art || book._img.source);
    if (!img) return [0, 0, 10, 10];
    const box = book.cropBox;
    if (Array.isArray(box) && box.length === 4 && box[2] > 4 && box[3] > 4) {
      const x = clamp(box[0], 0, img.naturalWidth - 2);
      const y = clamp(box[1], 0, img.naturalHeight - 2);
      const w = clamp(box[2], 2, img.naturalWidth - x);
      const h = clamp(box[3], 2, img.naturalHeight - y);
      return [x, y, w, h];
    }
    return fallbackCrop(img);
  }

  // cover-fit a source rectangle into a destination rectangle
  function drawCover(ctx, img, src, dx, dy, dw, dh, mirror) {
    const [sx, sy, sw, sh] = src;
    const sAR = sw / sh, dAR = dw / dh;
    let cw, ch, cx, cy;
    if (sAR > dAR) { ch = sh; cw = sh * dAR; cx = sx + (sw - cw) / 2; cy = sy; }
    else { cw = sw; ch = sw / dAR; cx = sx; cy = sy + (sh - ch) / 2; }
    ctx.save();
    if (mirror) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1); ctx.drawImage(img, cx, cy, cw, ch, 0, 0, dw, dh); }
    else ctx.drawImage(img, cx, cy, cw, ch, dx, dy, dw, dh);
    ctx.restore();
  }

  function drawArt(ctx, book, dx, dy, dw, dh, mirror) {
    const img = book._img.art || book._img.source;
    if (!img) {
      ctx.fillStyle = paletteFor(book).avg;
      ctx.fillRect(dx, dy, dw, dh);
      return;
    }
    drawCover(ctx, img, artCropRect(book), dx, dy, dw, dh, mirror);
  }

  // wider crop of the art for a 2:3 wrap panel, focused on the v8 crop centre
  function panelCrop(book) {
    const img = book._img.art || book._img.source;
    if (!img) return [0, 0, 10, 10];
    const [x, y, w, h] = artCropRect(book);
    const focusX = x + w / 2;
    const ar = 2 / 3;
    let sw = img.naturalHeight * ar;
    if (sw > img.naturalWidth) sw = img.naturalWidth;
    const sh = sw / ar;
    let sx = clamp(focusX - sw / 2, 0, img.naturalWidth - sw);
    const sy = clamp(y + h / 2 - sh / 2, 0, img.naturalHeight - sh);
    return [sx, sy, sw, sh];
  }

  /* ---------- canvas + measured type ------------------------------------- */

  function makeCanvas(w, h, dpr) {
    dpr = dpr || Math.min(global.devicePixelRatio || 1, 2);
    const c = document.createElement("canvas");
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + "px";
    c.style.height = h + "px";
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingQuality = "high";
    c._dpr = dpr;
    return { canvas: c, ctx, w, h };
  }

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  function metrics(text, family, weight, track) {
    measureCtx.font = `${weight || 400} 100px ${family}`;
    const m = measureCtx.measureText(text);
    const asc = m.actualBoundingBoxAscent == null ? 72 : m.actualBoundingBoxAscent;
    const desc = m.actualBoundingBoxDescent == null ? 20 : m.actualBoundingBoxDescent;
    const chars = Math.max(1, String(text).length);
    return {
      adv: (m.width / 100) + (track || 0) * chars,
      ink: (asc + desc) / 100,
      nativeAdv: m.width / 100,
    };
  }

  function scaleSize(m, fs) { return { adv: m.adv * fs, ink: m.ink * fs, nativeAdv: m.nativeAdv * fs }; }

  function bestSplit(text) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const ma = metrics(a, SERIF, 400, 0);
      const mb = metrics(b, SERIF, 400, 0);
      const score = Math.max(ma.adv, mb.adv) + Math.abs(ma.adv - mb.adv) * 0.15;
      if (!best || score < best.score) best = { lines: [a, b], score };
    }
    return best;
  }

  // Vertical (rotated) spine type. Returns the chosen size and lines.
  function fitVertical(text, opts) {
    const o = Object.assign({ family: SERIF, weight: 400, track: 0.02, maxSize: 11, minSize: 2.8, stack: true }, opts || {});
    const one = metrics(text, o.family, o.weight, o.track);
    const byThick = (o.thick * 0.965) / Math.max(0.05, one.ink);
    const byLen = (o.length * 0.968) / Math.max(0.05, one.adv);
    let fs = Math.min(o.maxSize, byThick, byLen);
    let lines = [text];
    let stacked = false;
    if (fs < Math.max(6.2, o.minSize + 2) && o.stack) {
      const split = bestSplit(text);
      if (split) {
        const ms = split.lines.map((l) => metrics(l, o.family, o.weight, o.track));
        const adv = Math.max(...ms.map((m) => m.adv));
        const ink = Math.max(...ms.map((m) => m.ink));
        const f2 = Math.min(o.maxSize, (o.thick * 0.965) / (2 * 1.08 * ink), (o.length * 0.968) / adv);
        if (f2 > fs * 1.06) { fs = f2; lines = split.lines; stacked = true; }
      }
    }
    fs = Math.max(o.minSize, Math.floor(fs * 40) / 40);
    const ms = lines.map((l) => metrics(l, o.family, o.weight, o.track));
    const adv = Math.max(...ms.map((m) => m.adv)) * fs;
    const thickNeed = (stacked ? 2 * 1.08 : 1) * Math.max(...ms.map((m) => m.ink)) * fs;
    return {
      fs, lines, stacked,
      lengthRatio: adv / o.length,
      thickRatio: thickNeed / o.thick,
      limiting: Math.max(adv / o.length, thickNeed / o.thick),
    };
  }

  function drawVertical(ctx, fit, cx, cy, color, opts) {
    const o = Object.assign({ family: SERIF, weight: 400, track: 0.02, lineGap: 1.08 }, opts || {});
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${o.weight} ${fit.fs}px ${o.family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = (o.track * fit.fs).toFixed(2) + "px";
    const lh = fit.fs * o.lineGap;
    fit.lines.forEach((line, i) => ctx.fillText(line, 0, (i - (fit.lines.length - 1) / 2) * lh));
    ctx.restore();
  }

  function fitHorizontal(text, opts) {
    const o = Object.assign({ family: SERIF, weight: 400, track: 0.01, maxSize: 30, minSize: 8, maxLines: 2 }, opts || {});
    const one = metrics(text, o.family, o.weight, o.track);
    let fs = Math.min(o.maxSize, (o.width * 0.96) / Math.max(0.05, one.adv));
    let lines = [text];
    if (fs < 13 && o.maxLines > 1) {
      const split = bestSplit(text);
      if (split) {
        const ms = split.lines.map((l) => metrics(l, o.family, o.weight, o.track));
        const adv = Math.max(...ms.map((m) => m.adv));
        const f2 = Math.min(o.maxSize, (o.width * 0.96) / adv);
        if (f2 > fs * 1.05) { fs = f2; lines = split.lines; }
      }
    }
    fs = Math.max(o.minSize, Math.floor(fs * 20) / 20);
    return { fs, lines, family: o.family, weight: o.weight, track: o.track };
  }

  function drawHorizontal(ctx, fit, x, y, color, opts) {
    const o = Object.assign({ align: "left", gap: 1.05 }, opts || {});
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = o.align;
    ctx.textBaseline = "top";
    ctx.font = `${fit.weight} ${fit.fs}px ${fit.family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = ((fit.track || 0) * fit.fs).toFixed(2) + "px";
    fit.lines.forEach((line, i) => ctx.fillText(line, x, y + i * fit.fs * o.gap));
    ctx.restore();
  }

  /* ---------- common spine furniture ------------------------------------- */

  function spineEdges(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(0,0,0,.45)");
    g.addColorStop(0.05, "rgba(0,0,0,0)");
    g.addColorStop(0.95, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, "rgba(0,0,0,.32)");
    v.addColorStop(0.09, "rgba(0,0,0,0)");
    v.addColorStop(0.9, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,.30)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  function grain(ctx, w, h, amount) {
    ctx.save();
    ctx.globalAlpha = amount == null ? 0.05 : amount;
    for (let i = 0; i < Math.round(w * h / 16); i++) {
      const x = Math.random() * w, y = Math.random() * h;
      ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  function provenance(book) {
    if (book.verdict === "fallback") return "fallback";
    if (book.route === "inpaint") return "reconstructed";
    return "original";
  }

  function drawProvenance(ctx, x, y, kind) {
    const r = 2.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    if (kind === "original") { ctx.fillStyle = "rgba(240,226,196,.92)"; ctx.fill(); }
    else if (kind === "reconstructed") {
      ctx.fillStyle = "rgba(240,226,196,.35)"; ctx.fill();
      ctx.strokeStyle = "rgba(240,226,196,.95)"; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(240,226,196,.85)"; ctx.lineWidth = 0.9; ctx.stroke();
    }
    ctx.restore();
  }

  function vignette(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,0,0,.18)");
    g.addColorStop(0.2, "rgba(0,0,0,0)");
    g.addColorStop(0.82, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---------- spine renderers -------------------------------------------- */

  function renderFullBleed(book, dpr) {
    const { canvas, ctx } = makeCanvas(SPINE_W, SPINE_H, dpr);
    drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
    vignette(ctx, SPINE_W, SPINE_H);
    spineEdges(ctx, SPINE_W, SPINE_H);
    const pal = paletteFor(book);
    const railW = 20;
    const railX = SPINE_W - railW - 2;
    ctx.fillStyle = mix("#0c0d10", pal.avg, 0.10);
    ctx.globalAlpha = 0.88;
    ctx.fillRect(railX, 27, railW, SPINE_H - 54);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(240,226,196,.24)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(railX + 0.3, 27.3, railW - 0.6, SPINE_H - 54.6);
    const ink = "#f2e8d4";
    const authorFit = fitVertical(book.author || "", { family: SANS, weight: 500, track: 0.10, thick: railW - 4, length: 48, maxSize: 4.2, minSize: 2.8, stack: false });
    const authorLen = Math.max(...authorFit.lines.map((l) => metrics(l, SANS, 500, 0.10).adv)) * authorFit.fs;
    const titleArea = SPINE_H - 54 - authorLen - 8;
    const title = fitVertical(String(book.title || "").toUpperCase(), { family: SANS, weight: 600, track: 0.06, thick: railW - 3.4, length: titleArea, maxSize: 9.4, minSize: 2.8 });
    drawVertical(ctx, title, railX + railW / 2, 27 + titleArea / 2, ink, { family: SANS, weight: 600, track: 0.06 });
    drawVertical(ctx, authorFit, railX + railW / 2, SPINE_H - 27 - authorLen / 2, "rgba(242,232,212,.86)", { family: SANS, weight: 500, track: 0.10 });
    // small rule under the head
    ctx.fillStyle = "rgba(242,232,212,.55)";
    ctx.fillRect(railX + 4, 20, railW - 8, 0.7);
    drawProvenance(ctx, railX + railW / 2, SPINE_H - 16, provenance(book));
    grain(ctx, SPINE_W, SPINE_H, 0.035);
    return {
      canvas, style: "fullbleed", label: LABELS.fullbleed,
      metrics: { width: SPINE_W, height: SPINE_H, titlePx: title.fs, fit: title.limiting, contrast: contrast(ink, mix("#0c0d10", pal.avg, 0.10)) },
    };
  }

  function renderArtOnly(book, dpr) {
    const { canvas, ctx } = makeCanvas(SPINE_W, SPINE_H, dpr);
    drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
    vignette(ctx, SPINE_W, SPINE_H);
    spineEdges(ctx, SPINE_W, SPINE_H);
    grain(ctx, SPINE_W, SPINE_H, 0.03);
    return {
      canvas, style: "artonly", label: LABELS.artonly,
      metrics: { width: SPINE_W, height: SPINE_H, titlePx: 0, fit: 0, contrast: null, type: "none" },
    };
  }

  /* design-system spine: shared layout */
  function renderDesign(book, kind, dpr) {
    const { canvas, ctx } = makeCanvas(SPINE_W, SPINE_H, dpr);
    const pal = paletteFor(book);
    let cloth = pal.light ? mix(pal.avg, "#1c1611", 0.68) : mix(pal.avg, "#0d0b09", 0.58);
    if (luminance(cloth) > 0.24) cloth = mix(cloth, "#0b0907", 0.35);
    const paper = mix("#ece2ca", cloth, 0.055);
    const foil = readableInk(cloth) === "#f2e6c9" ? "#e8d3a1" : "#2b2018";
    let ink, look;

    if (kind === "editorial") {
      drawArt(ctx, book, 0, 0, SPINE_W, SPINE_H);
      vignette(ctx, SPINE_W, SPINE_H);
      spineEdges(ctx, SPINE_W, SPINE_H);
      const railW = 23.1;
      const railX = SPINE_W - railW;
      ctx.fillStyle = "rgba(9,10,12,.80)";
      ctx.fillRect(railX, 0, railW, SPINE_H);
      ctx.fillStyle = "rgba(242,232,212,.22)";
      ctx.fillRect(railX, 0, 0.6, SPINE_H);
      ink = "#f2e8d4";
      look = { x: railX + railW / 2, thick: railW - 4, head: 18, tail: 20, ornY: 11, ornSize: 7, serif: false };
    } else if (kind === "cloth") {
      ctx.fillStyle = cloth;
      ctx.fillRect(0, 0, SPINE_W, SPINE_H);
      // subtle woven grain
      ctx.save();
      ctx.globalAlpha = 0.09;
      for (let x = 0; x < SPINE_W; x += 2) {
        ctx.fillStyle = x % 4 === 0 ? "#fff" : "#000";
        ctx.fillRect(x, 0, 0.5, SPINE_H);
      }
      ctx.restore();
      ink = foil;
      look = { x: SPINE_W / 2, thick: SPINE_W - 10, head: 34, tail: 20, ornY: 15, ornSize: 10, serif: true };
      // head / tail bands and double rules
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 27, SPINE_W, 0.8);
      ctx.fillRect(0, SPINE_H - 27, SPINE_W, 0.8);
      ctx.fillStyle = foil;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(9, 12, SPINE_W - 18, 0.7);
      ctx.fillRect(9, SPINE_H - 12, SPINE_W - 18, 0.7);
      ctx.globalAlpha = 1;
    } else { // hybrid
      const paperW = SPINE_W * 0.565;
      const artW = SPINE_W - paperW;
      drawArt(ctx, book, 0, 0, artW, SPINE_H);
      spineEdges(ctx, SPINE_W, SPINE_H);
      ctx.fillStyle = paper;
      ctx.fillRect(artW, 0, paperW, SPINE_H);
      ctx.fillStyle = "rgba(40,30,20,.30)";
      ctx.fillRect(artW, 0, 0.8, SPINE_H);
      ctx.fillStyle = "rgba(40,30,20,.12)";
      ctx.fillRect(artW + 3, 0, 0.6, SPINE_H);
      ink = "#2c2118";
      look = { x: artW + paperW / 2, thick: paperW - 7, head: 24, tail: 18, ornY: 12, ornSize: 7, serif: true };
    }

    const authorFamily = look.serif ? SERIF : SANS;
    const titleFamily = look.serif ? SERIF : SANS;
    const authorFit = fitVertical(book.author || "", {
      family: authorFamily, weight: look.serif ? 400 : 500, track: look.serif ? 0.02 : 0.10,
      thick: look.thick, length: SPINE_H * 0.30, maxSize: 4.6, minSize: 2.8, stack: false,
    });
    const authorLen = Math.max(...authorFit.lines.map((l) => metrics(l, authorFamily, look.serif ? 400 : 500, look.serif ? 0.02 : 0.10).adv)) * authorFit.fs;
    const titleArea = SPINE_H - look.head - look.tail - authorLen - 7;
    const title = fitVertical(String(book.title || ""), {
      family: titleFamily, weight: look.serif ? 400 : 700,
      track: look.serif ? 0.01 : 0.07, thick: look.thick, length: titleArea,
      maxSize: look.serif ? 11.2 : 9.2, minSize: 2.8,
    });
    drawVertical(ctx, title, look.x, look.head + titleArea / 2, ink, { family: titleFamily, weight: look.serif ? 400 : 700, track: look.serif ? 0.01 : 0.07 });
    drawVertical(ctx, authorFit, look.x, SPINE_H - look.tail - authorLen / 2, ink, { family: authorFamily, weight: look.serif ? 400 : 500, track: look.serif ? 0.02 : 0.10, lineGap: 1.1 });
    // ornament at head
    ctx.save();
    ctx.translate(look.x, look.ornY);
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 0.9;
    if (kind === "editorial") {
      ctx.fillRect(-3.2, -0.35, 6.4, 0.7);
    } else {
      ctx.beginPath(); ctx.moveTo(0, -look.ornSize / 2); ctx.lineTo(look.ornSize / 2, 0); ctx.lineTo(0, look.ornSize / 2); ctx.lineTo(-look.ornSize / 2, 0); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, look.ornSize * 0.13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    drawProvenance(ctx, look.x, SPINE_H - 9, provenance(book));
    grain(ctx, SPINE_W, SPINE_H, kind === "cloth" ? 0.07 : 0.025);
    return {
      canvas, style: kind, label: LABELS[kind],
      metrics: { width: SPINE_W, height: SPINE_H, titlePx: title.fs, fit: title.limiting, contrast: contrast(ink, kind === "editorial" ? "#101114" : kind === "cloth" ? cloth : paper), cloth, paper, ink },
    };
  }

  /* ---------- wrap engine ------------------------------------------------ */

  function wrapGeometry(pages) {
    const caliper = 0.1;        // mm per leaf (80 gsm cream)
    const coverAllowance = 1.2; // mm
    const spineMm = (Math.max(0, pages) / 2) * caliper + coverAllowance;
    const H = SPINE_H;
    const frontW = H * (6 / 9);
    const spineW = clamp(Math.round(H * (spineMm / 228.6)), 10, 40);
    const bleed = 6;
    return { H, frontW, spineW, bleed, totalW: Math.round(bleed * 2 + frontW * 2 + spineW), spineMm, trim: "6 × 9 in" };
  }

  function renderWrap(book, dpr) {
    const g = wrapGeometry(book.pages || 320);
    const { canvas, ctx } = makeCanvas(g.totalW, g.H, dpr);
    const pal = paletteFor(book);
    const frontX = g.bleed + g.frontW + g.spineW;
    const spineX = g.bleed + g.frontW;
    const panel = panelCrop(book);

    // bleed field
    ctx.fillStyle = mix(pal.avg, "#0b0908", 0.55);
    ctx.fillRect(0, 0, g.totalW, g.H);

    // back panel — the v8 art, deliberately blurred so any text that was
    // outside the chosen crop cannot read as cover copy.
    const art = book._img.art || book._img.source;
    const tiny = document.createElement("canvas");
    tiny.width = 24; tiny.height = 34;
    const tctx = tiny.getContext("2d");
    tctx.drawImage(art, panel[0], panel[1], panel[2], panel[3], 0, 0, tiny.width, tiny.height);
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.drawImage(tiny, g.bleed, 0, g.frontW, g.H);
    ctx.restore();
    ctx.fillStyle = "rgba(10,8,7,.55)";
    ctx.fillRect(g.bleed, 0, g.frontW, g.H);

    // spine — the pipeline's text-free crop
    drawArt(ctx, book, spineX, 0, g.spineW, g.H);
    ctx.fillStyle = "rgba(0,0,0,.16)";
    ctx.fillRect(spineX, 0, g.spineW, g.H);
    spineEdges(ctx, g.totalW, g.H);

    // front panel — the published cover, unchanged and uncropped. The wrap
    // engine supplies thickness and the back; it does not pretend the front
    // art is textless, and it does not crop a taller cover to a 6:9 panel.
    const simg = book._img.source || art;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.drawImage(tiny, frontX, 0, g.frontW, g.H);
    ctx.restore();
    ctx.fillStyle = "rgba(10,8,7,.42)";
    ctx.fillRect(frontX, 0, g.frontW, g.H);
    const sAR = simg.naturalWidth / simg.naturalHeight;
    const dAR = g.frontW / g.H;
    let dw, dh;
    if (sAR > dAR) { dw = g.frontW; dh = g.frontW / sAR; }
    else { dh = g.H; dw = g.H * sAR; }
    const dx = frontX + (g.frontW - dw) / 2;
    const dy = (g.H - dh) / 2;
    ctx.drawImage(simg, 0, 0, simg.naturalWidth, simg.naturalHeight, dx, dy, dw, dh);
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(dx + 0.3, dy + 0.3, dw - 0.6, dh - 0.6);
    // a small study mark only, never a second title
    ctx.fillStyle = "rgba(8,7,6,.55)";
    ctx.fillRect(frontX + g.frontW - 45, g.H - 13, 39, 10);
    ctx.fillStyle = "rgba(244,234,210,.72)";
    ctx.font = `500 4.4px ${SANS}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.12em";
    ctx.textAlign = "right";
    ctx.fillText("POCKET / WRAP", frontX + g.frontW - 8, g.H - 5.6);
    ctx.textAlign = "left";
    const titleFit = { fs: 0, lines: [] };

    // spine type
    const spineInk = readableInk(pal.avg);
    const sAuthor = fitVertical(book.author || "", { family: SANS, weight: 500, track: 0.12, thick: g.spineW - 3, length: 48, maxSize: 3.6, minSize: 2.4, stack: false });
    const sAuthorLen = Math.max(...sAuthor.lines.map((l) => metrics(l, SANS, 500, 0.12).adv)) * sAuthor.fs;
    const sTitle = fitVertical(String(book.title || "").toUpperCase(), { family: SANS, weight: 600, track: 0.05, thick: g.spineW - 3, length: g.H - 50 - sAuthorLen - 14, maxSize: 7.8, minSize: 2.6 });
    drawVertical(ctx, sTitle, spineX + g.spineW / 2, 25 + (g.H - 50 - sAuthorLen - 14) / 2, spineInk, { family: SANS, weight: 600, track: 0.05 });
    drawVertical(ctx, sAuthor, spineX + g.spineW / 2, g.H - 25 - sAuthorLen / 2, spineInk, { family: SANS, weight: 500, track: 0.12 });

    // back-cover vellum card (generated, labelled as such)
    const cardX = g.bleed + g.frontW * 0.12;
    const cardY = g.H * 0.13;
    const cardW = g.frontW * 0.76;
    const cardH = g.H * 0.74;
    ctx.fillStyle = "rgba(236,226,202,.94)";
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeStyle = "rgba(40,30,20,.22)";
    ctx.lineWidth = 0.6;
    ctx.strokeRect(cardX + 0.3, cardY + 0.3, cardW - 0.6, cardH - 0.6);
    const bTitle = fitHorizontal(book.title || "", { width: cardW - 16, maxSize: 12, minSize: 6, maxLines: 2, family: SERIF, weight: 400 });
    drawHorizontal(ctx, bTitle, cardX + 8, cardY + 10, "#2c2118", { gap: 1 });
    ctx.font = `500 5.4px ${SANS}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.10em";
    ctx.fillStyle = "#6a5b45";
    ctx.fillText(String(book.author || "").toUpperCase(), cardX + 8, cardY + 14 + bTitle.lines.length * bTitle.fs);
    ctx.fillStyle = "rgba(44,33,24,.30)";
    ctx.fillRect(cardX + 8, cardY + 30 + bTitle.lines.length * bTitle.fs, cardW - 16, 0.6);
    ctx.font = `400 4.4px ${SERIF}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0";
    ctx.fillStyle = "#4d4132";
    const lines = [
      "A PocketLibrary study compositing",
      "the v8 textless art into a single",
      "continuous case. Back cover and",
      "copy are generated for the study,",
      "not publisher artwork.",
      "",
      "Spine width is derived from the",
      "page count and a paper caliper.",
    ];
    lines.forEach((line, i) => ctx.fillText(line, cardX + 8, cardY + 40 + bTitle.lines.length * bTitle.fs + i * 6.2));
    // barcode
    const bx = cardX + cardW - 30, by = cardY + cardH - 22;
    let seed = 7;
    for (let i = 0; i < 22; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      ctx.fillStyle = i % 2 ? "#f3ead4" : "#221a12";
      ctx.fillRect(bx + i * 1.05, by, i % 2 ? 0.5 : 0.75, 15);
    }
    ctx.fillStyle = "#5f513d";
    ctx.font = `400 3.4px ${SANS}`;
    ctx.textAlign = "center";
    ctx.fillText("978-0-00-000000-0", bx + 11.5, by + 18.5);
    ctx.textAlign = "left";
    // fold lines
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(spineX - 0.4, 0, 0.8, g.H);
    ctx.fillRect(frontX - 0.4, 0, 0.8, g.H);

    return {
      canvas, style: "wrap", label: LABELS.wrap,
      metrics: {
        width: g.totalW, height: g.H, spinePx: g.spineW, spineMm: Number(g.spineMm.toFixed(1)),
        widthMm: Number((g.spineMm + 2 * 152.4 + 2 * 3.175).toFixed(1)), pages: book.pages,
        titlePx: titleFit.fs, fit: titleFit.fs / 26, type: "back/spine/front",
      },
    };
  }

  /* ---------- public render ----------------------------------------------- */

  function render(book, style, opts) {
    const dpr = (opts && opts.dpr) || Math.min(global.devicePixelRatio || 1, 2);
    if (style === "fullbleed") return renderFullBleed(book, dpr);
    if (style === "artonly") return renderArtOnly(book, dpr);
    if (style === "wrap") return renderWrap(book, dpr);
    if (style === "hybrid" || style === "cloth" || style === "editorial") return renderDesign(book, style, dpr);
    throw new Error("unknown style " + style);
  }

  async function loadBook(book) {
    if (book._loaded) return book;
    const img = {};
    const entries = [["source", book.source], ["art", book.art], ["spine", book.spine], ["fallback", book.fallback]];
    await Promise.all(entries.map(async ([key, src]) => {
      if (!src) return;
      try { img[key] = await loadImage(src); } catch (e) { img[key] = null; }
    }));
    if (!img.art) img.art = img.source;
    if (!img.source) img.source = img.art;
    if (!img.art) throw new Error("no usable image for " + (book.slug || book.title));
    book._img = img;
    book._loaded = true;
    return book;
  }

  function fmt(n, d) { return n == null || isNaN(n) ? "—" : Number(n).toFixed(d == null ? 1 : d); }

  function statusClass(book) {
    return book.verdict === "pass" ? "pass" : book.verdict === "review" ? "review" : "fallback";
  }

  function artNote(book) {
    const dims = `${book.artWidth || "?"} × ${book.artHeight || "?"} px · mask ${fmt(book.maskCoverage, 1)}%`;
    if (book.route === "inpaint") return "inpainted textless art · " + dims;
    return "working art (printed text remains outside the crop) · " + dims;
  }

  function cropOverlay(book) {
    const box = book.cropBox, W = book.artWidth, H = book.artHeight;
    if (!Array.isArray(box) || box.length !== 4 || !W || !H) return "";
    const left = (box[0] / W) * 100, top = (box[1] / H) * 100;
    const width = (box[2] / W) * 100, height = (box[3] / H) * 100;
    return `<span class="rer-cropbox" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${width.toFixed(2)}%;height:${height.toFixed(2)}%"></span>`;
  }

  /* ---------- gallery mount ----------------------------------------------- */

  async function mountBook(book, root, opts) {
    opts = opts || {};
    await loadBook(book);
    const pal = paletteFor(book);
    const prov = provenance(book);
    const section = document.createElement("section");
    section.className = "rer-book";
    section.dataset.slug = book.slug;
    section.innerHTML = `
      <header class="rer-book__head">
        <div>
          <p class="rer-kicker">${opts.holdout ? "Unseen holdout" : "Random-book study"} · v8-app output</p>
          <h2>${esc(book.title)}</h2>
          <p class="rer-byline">${esc(book.author)} · ${book.pages || "—"} pp · <span class="rer-prov rer-prov--${prov}">${prov}</span></p>
        </div>
        <div class="rer-verdict rer-verdict--${statusClass(book)}">
          <b>${esc(book.verdict)}</b>
          <span>${esc(book.route)}</span>
        </div>
      </header>
      <div class="rer-chain">
        <figure><img alt="Original cover of ${esc(book.title)}" src="${esc(book.source)}"><figcaption>1 · Original cover<small>${esc(book.sourceNote || "as downloaded")}</small></figcaption></figure>
        <figure>
          <div class="rer-artwrap" style="aspect-ratio:${book.artWidth || 2} / ${book.artHeight || 3}">
            <img alt="v8 working art for ${esc(book.title)}" src="${esc(book.art)}">
            ${cropOverlay(book)}
          </div>
          <figcaption>2 · v8 art output<small>${esc(artNote(book))}</small></figcaption>
        </figure>
        <figure><img class="rer-strip" alt="v8 52 by 236 spine crop" src="${esc(book.spine)}"><figcaption>3 · v8 text-free crop<small>52 × 236 · box [${(book.cropBox || []).join(", ")}]</small></figcaption></figure>
      </div>
      <div class="rer-grid" data-styles></div>
      <details class="rer-qa">
        <summary>QA and provenance for ${esc(book.title)}</summary>
        <div class="rer-qa__body">
          <dl>
            <div><dt>Pipeline</dt><dd>v8-app Rust/ONNX (${esc(book.execution || "host")})</dd></div>
            <div><dt>Route</dt><dd>${esc(book.route)}</dd></div>
            <div><dt>Verdict</dt><dd>${esc(book.verdict)}</dd></div>
            <div><dt>Reasons</dt><dd>${esc((book.reasons || []).join("; "))}</dd></div>
            <div><dt>Mask coverage</dt><dd>${fmt(book.maskCoverage, 2)}% · ${book.detectionBoxes || 0} DBNet boxes</dd></div>
            <div><dt>Spine QA</dt><dd>luma σ ${fmt(book.spineLumaStd, 1)} · edge ${fmt(book.spineEdge, 3)} · residual OCR ${(book.spineOcr || []).length}</dd></div>
            <div><dt>Art crop</dt><dd>[${(book.cropBox || []).join(", ")}] in ${book.artWidth || "?"} × ${book.artHeight || "?"}</dd></div>
            <div><dt>Sampled palette</dt><dd><i class="sw" style="background:${pal.avg}"></i>${pal.avg} avg · <i class="sw" style="background:${pal.edge}"></i>${pal.edge} edge</dd></div>
            <div><dt>Provenance</dt><dd>${esc(book.provenance || "v8-app textless art / crop, run for this study")}</dd></div>
            <div><dt>Licence</dt><dd>${esc(book.license || "Design reference only")}</dd></div>
          </dl>
          <p class="rer-note">${esc(book.note || "")}</p>
        </div>
      </details>`;

    const grid = section.querySelector("[data-styles]");
    const order = ["fullbleed", "artonly", "wrap", "hybrid", "cloth", "editorial"];
    for (const style of order) {
      const out = render(book, style, { dpr: opts.dpr });
      const fig = document.createElement("figure");
      fig.className = "rer-style" + (style === "wrap" ? " rer-style--wide" : "");
      fig.dataset.style = style;
      const holder = document.createElement("div");
      holder.className = "rer-style__canvas";
      holder.appendChild(out.canvas);
      fig.appendChild(holder);
      const cap = document.createElement("figcaption");
      cap.innerHTML = `<b>${esc(out.label)}</b><span>${esc(BLURBS[style])}</span><small>${describeMetrics(style, out.metrics)}</small>`;
      fig.appendChild(cap);
      grid.appendChild(fig);
    }
    root.appendChild(section);
    return section;
  }

  function describeMetrics(style, m) {
    if (style === "artonly") return "0 type · art only";
    if (style === "wrap") return `${m.spinePx} px spine · ${m.spineMm} mm · ${m.pages} pp · front published cover`;
    return `${m.width} × ${m.height} · title ${m.titlePx} px · ${Math.round((m.fit || 0) * 100)}% of box · ${m.contrast ? m.contrast.toFixed(1) + ":1" : ""}`;
  }

  async function mountAll(books, root, opts) {
    for (const b of books) {
      try { await mountBook(b, root, opts); }
      catch (e) {
        const p = document.createElement("p");
        p.className = "rer-error";
        p.textContent = "Could not render " + (b.title || b.slug) + ": " + e.message;
        root.appendChild(p);
      }
    }
  }

  function ready() {
    if (!global.document || !document.fonts) return Promise.resolve();
    return Promise.all([
      document.fonts.load('12px "EB Garamond"'),
      document.fonts.load('12px "Literata"'),
    ]).catch(() => {});
  }

  global.PocketRenderers = {
    STYLES, LABELS, wrapGeometry, render, loadBook, mountBook, mountAll, ready,
    paletteFor, artCropRect, provenance,
  };
})(typeof window !== "undefined" ? window : this);
