import { BOOK_LIST, getBook } from "./books.js";
import {
  STOCKS,
  TRIMS,
  COVER_ALLOWANCE_MM,
  MM_PER_IN,
  getStock,
  getTrim,
  computeSpine,
  currentLayout,
  clamp,
} from "./geometry.js";
import {
  loadImage,
  sampleImage,
  analyzeWrap,
  renderWrap,
  renderPanel,
  renderCrop,
  formatContrast,
} from "./compose.js";

const els = {
  loading: document.getElementById("loading"),
  bookPicker: document.getElementById("bookPicker"),
  pagesRange: document.getElementById("pagesRange"),
  pagesNumber: document.getElementById("pagesNumber"),
  pagesOut: document.getElementById("pagesOut"),
  stockSelect: document.getElementById("stockSelect"),
  caliperNumber: document.getElementById("caliperNumber"),
  caliperOut: document.getElementById("caliperOut"),
  trimSelect: document.getElementById("trimSelect"),
  trimOut: document.getElementById("trimOut"),
  bleedSelect: document.getElementById("bleedSelect"),
  modeCover: document.getElementById("modeCover"),
  modeType: document.getElementById("modeType"),
  modeOut: document.getElementById("modeOut"),
  sourceSelect: document.getElementById("sourceSelect"),
  stressBtn: document.getElementById("stressBtn"),
  guidesToggle: document.getElementById("guidesToggle"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  statusLine: document.getElementById("statusLine"),
  // stats
  statSpine: document.getElementById("statSpine"),
  statSpineV: document.getElementById("statSpineV"),
  statSpineD: document.getElementById("statSpineD"),
  statWrapV: document.getElementById("statWrapV"),
  statWrapD: document.getElementById("statWrapD"),
  statTrimV: document.getElementById("statTrimV"),
  statTrimD: document.getElementById("statTrimD"),
  statPaperV: document.getElementById("statPaperV"),
  statPaperD: document.getElementById("statPaperD"),
  statFit: document.getElementById("statFit"),
  statFitV: document.getElementById("statFitV"),
  statFitD: document.getElementById("statFitD"),
  statStress: document.getElementById("statStress"),
  statStressV: document.getElementById("statStressV"),
  statStressD: document.getElementById("statStressD"),
  statEdgeV: document.getElementById("statEdgeV"),
  statEdgeD: document.getElementById("statEdgeD"),
  statModeV: document.getElementById("statModeV"),
  statModeD: document.getElementById("statModeD"),
  // viewer
  wrapCanvas: document.getElementById("wrapCanvas"),
  viewerMeta: document.getElementById("viewerMeta"),
  viewerAspect: document.getElementById("viewerAspect"),
  legend: document.getElementById("legend"),
  decisionMode: document.getElementById("decisionMode"),
  decisionReason: document.getElementById("decisionReason"),
  decisionList: document.getElementById("decisionList"),
  fitTitle: document.getElementById("fitTitle"),
  fitLength: document.getElementById("fitLength"),
  fitAcross: document.getElementById("fitAcross"),
  fitLimit: document.getElementById("fitLimit"),
  fitStress: document.getElementById("fitStress"),
  // 3d
  bookStage: document.querySelector(".book-stage"),
  book3d: document.getElementById("book3d"),
  faceFront: document.getElementById("faceFront"),
  faceBack: document.getElementById("faceBack"),
  faceSpine: document.getElementById("faceSpine"),
  rotateRange: document.getElementById("rotateRange"),
  rotateOut: document.getElementById("rotateOut"),
  threeMeta: document.getElementById("threeMeta"),
  // compare
  v3Image: document.getElementById("v3Image"),
  v3Caption: document.getElementById("v3Caption"),
  v3Metrics: document.getElementById("v3Metrics"),
  compareV4: document.getElementById("compareV4"),
  compareV4Zoom: document.getElementById("compareV4Zoom"),
  v4Title: document.getElementById("v4Title"),
  v4Caption: document.getElementById("v4Caption"),
  v4Metrics: document.getElementById("v4Metrics"),
};

const DEFAULT_BOOK = "whisper-man";
const state = {
  bookId: DEFAULT_BOOK,
  pages: 320,
  stockId: "cream80",
  caliperMm: 0.1,
  trimId: "6x9",
  bleedIn: 0.125,
  mode: getBook(DEFAULT_BOOK).recommendedMode,
  stripSource: "art",
  guides: true,
  rotateY: 30,
};

const assetCache = new Map();
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

let previewCanvas = null;
let previewPxPerIn = 0;
let current = null;
let refreshSeq = 0;
let queued = false;
let ready = false;
let fontWarning = "";

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function inToPx(inches, dpi = 300) {
  return Math.round(inches * dpi);
}

async function loadFonts() {
  if (!("FontFace" in window)) {
    fontWarning = "FontFace API unavailable; falling back to system serif.";
    return;
  }
  try {
    const faces = [
      new FontFace(
        "EB Garamond",
        'url("./fonts/EBGaramond-Regular.woff2") format("woff2")'
      ),
      new FontFace(
        "Literata",
        'url("./fonts/Literata-Regular.woff2") format("woff2")'
      ),
    ];
    const loaded = await Promise.all(faces.map((f) => f.load()));
    loaded.forEach((f) => document.fonts.add(f));
    await document.fonts.ready;
  } catch (err) {
    fontWarning = `Font load failed: ${err.message}. Falling back to system serif.`;
  }
}

async function ensureBookAssets(book) {
  if (assetCache.has(book.id)) return assetCache.get(book.id);
  const [front, art] = await Promise.all([
    loadImage(book.front),
    loadImage(book.art),
  ]);
  const frontSample = sampleImage(front);
  const artSample = sampleImage(art);
  const assets = {
    front,
    art,
    samples: {
      front: frontSample,
      art: artSample,
      edge: frontSample,
    },
  };
  assetCache.set(book.id, assets);
  return assets;
}

function buildBookPicker() {
  els.bookPicker.innerHTML = "";
  for (const book of BOOK_LIST) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "book-card";
    btn.dataset.id = book.id;
    btn.setAttribute("aria-pressed", String(book.id === state.bookId));
    btn.innerHTML = `
      <img src="${book.front}" alt="" />
      <span>
        <span class="t">${book.title}</span>
        <span class="m">${book.author} · ${book.edition}</span>
      </span>
    `;
    btn.addEventListener("click", () => {
      setBook(book.id);
    });
    els.bookPicker.appendChild(btn);
  }
}

function buildOptions() {
  els.stockSelect.innerHTML = STOCKS.map(
    (s) => `<option value="${s.id}">${s.label}</option>`
  ).join("");
  els.trimSelect.innerHTML = TRIMS.map(
    (t) => `<option value="${t.id}">${t.label}</option>`
  ).join("");
}

function setBook(id) {
  const book = getBook(id);
  state.bookId = book.id;
  state.mode = book.recommendedMode;
  state.stripSource = "art";
  syncControls();
  queueRefresh(`Loaded ${book.title}.`);
}

function syncControls() {
  const book = getBook(state.bookId);
  els.pagesRange.value = String(state.pages);
  els.pagesNumber.value = String(state.pages);
  els.pagesOut.textContent = `${state.pages} pages`;
  els.stockSelect.value = state.stockId;
  els.caliperNumber.value = state.caliperMm.toFixed(3);
  els.caliperOut.textContent = `${state.caliperMm.toFixed(3)} mm / leaf`;
  els.trimSelect.value = state.trimId;
  const trim = getTrim(state.trimId);
  els.trimOut.textContent = `${trim.w} × ${trim.h} in`;
  els.bleedSelect.value = String(state.bleedIn);
  els.modeCover.setAttribute("aria-pressed", String(state.mode === "cover"));
  els.modeType.setAttribute("aria-pressed", String(state.mode === "type"));
  els.modeOut.textContent =
    state.mode === "cover" ? "Cover-derived" : "Typographic";
  els.sourceSelect.disabled = state.mode !== "cover";
  els.guidesToggle.checked = state.guides;
  els.bookPicker.querySelectorAll(".book-card").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.id === book.id));
  });
}

function queueRefresh(message = "") {
  if (message) els.statusLine.textContent = message;
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    refreshNow().catch((err) => {
      console.error(err);
      els.statusLine.textContent = `Could not compose the wrap: ${err.message}`;
    });
  });
}

function buildPrintState(book, assets) {
  const spine = computeSpine({
    pages: state.pages,
    caliperMm: state.caliperMm,
    allowanceMm: COVER_ALLOWANCE_MM,
  });
  state.pages = spine.pages;
  const trim = getTrim(state.trimId);
  const layout = currentLayout(state, book, spine);
  const analysis = analyzeWrap({
    book,
    state,
    layout,
    samples: assets.samples,
    measureCtx,
    pxPerIn: 300,
  });
  return { spine, trim, layout, analysis };
}

async function refreshNow() {
  const seq = ++refreshSeq;
  const book = getBook(state.bookId);
  const assets = await ensureBookAssets(book);
  if (seq !== refreshSeq) return;

  const { spine, trim, layout, analysis } = buildPrintState(book, assets);
  current = { book, assets, spine, trim, layout, analysis };
  syncControls();
  updateStats(current);
  updateDecision(current);
  renderDisplay(current);
  renderPreviewAnd3D(current);
  renderCompare(current);
  updateViewerMeta(current);
  updateStatus(current);
  ready = true;
  els.loading.classList.add("hidden");
}

function updateViewerMeta(c) {
  const { layout, trim } = c;
  const W = inToPx(layout.totalW);
  const H = inToPx(layout.totalH);
  els.viewerMeta.textContent = `${layout.totalW.toFixed(3)} × ${layout.totalH.toFixed(3)} in · ${W.toLocaleString()} × ${H.toLocaleString()} px at 300 dpi`;
  els.viewerAspect.textContent = `wrap aspect ${(layout.totalW / layout.totalH).toFixed(4)} · trim ${trim.w} × ${trim.h} in`;
  els.legend.hidden = !state.guides;
}

function updateStatus(c) {
  const { spine, layout, book } = c;
  const mode = c.analysis.effectiveMode === "cover" ? "cover-derived" : "typographic";
  els.statusLine.textContent = `${book.title}: ${spine.pages} pages · ${spine.leaves} leaves · ${state.caliperMm.toFixed(3)} mm → ${spine.spineIn.toFixed(3)} in spine · ${layout.totalW.toFixed(2)} × ${layout.totalH.toFixed(2)} in wrap · ${mode}.`;
}

function updateStats(c) {
  const { spine, layout, trim, analysis, book } = c;
  const fit = analysis.fit;
  const stress = analysis.stressTitle;
  const edge = c.assets.samples.edge;
  const printW = inToPx(layout.totalW);
  const printH = inToPx(layout.totalH);

  els.statSpineV.textContent = `${spine.spineIn.toFixed(3)} in`;
  els.statSpineD.textContent = `${spine.spineMm.toFixed(1)} mm · ${inToPx(spine.spineIn)} px @300${
    spine.clamped ? " · clamped to 0.20 in minimum" : ""
  }`;

  els.statWrapV.textContent = `${layout.totalW.toFixed(2)} × ${layout.totalH.toFixed(2)} in`;
  els.statWrapD.textContent = `${printW.toLocaleString()} × ${printH.toLocaleString()} px @300 · aspect ${(layout.totalW / layout.totalH).toFixed(4)}`;

  els.statTrimV.textContent = `${trim.w} × ${trim.h} in`;
  els.statTrimD.textContent = `${state.bleedIn} in bleed each edge · ${(
    trim.w * 2 +
    spine.spineIn
  ).toFixed(2)} in trim span`;

  els.statPaperV.textContent = `${state.caliperMm.toFixed(3)} mm / leaf`;
  els.statPaperD.textContent = `${spine.leaves} leaves · text block ${spine.textBlockMm.toFixed(1)} mm + ${COVER_ALLOWANCE_MM} mm cover`;

  els.statFitV.innerHTML = `${fit.pt.toFixed(1)} pt <span class="pill ${fit.ok ? "ok" : "bad"}">${fit.ok ? "fits" : "clip risk"}</span>`;
  els.statFitD.textContent = `${(fit.lengthPx / 300).toFixed(2)} / ${(fit.availableLengthPx / 300).toFixed(2)} in long · ${(fit.acrossPx / 300).toFixed(2)} / ${(fit.availableAcrossPx / 300).toFixed(2)} in across · ${Math.round(fit.ratio * 100)}% of limit`;
  els.statFit.classList.toggle("good", fit.ok);
  els.statFit.classList.toggle("warn", !fit.ok);

  els.statStressV.innerHTML = `<span class="pill ${analysis.stressOk ? "ok" : "bad"}">${analysis.stressOk ? "PASS" : "FAIL"}</span> ${stress.pt.toFixed(1)} pt`;
  els.statStressD.textContent = `1.00 in cover rail · ${(stress.acrossPx / 300).toFixed(2)} in across · ${(stress.lengthPx / 300).toFixed(2)} in long · ${analysis.stressOk ? "no clip" : "would clip"}`;
  els.statStress.classList.toggle("good", analysis.stressOk);
  els.statStress.classList.toggle("warn", !analysis.stressOk);

  els.statEdgeV.innerHTML = `<span style="display:inline-block;width:0.86em;height:0.86em;border-radius:2px;background:${edge.hex};box-shadow:inset 0 0 0 1px rgba(0,0,0,.18);margin-right:.36em;vertical-align:-.06em"></span>${edge.hex}`;
  els.statEdgeD.textContent = `left 12% of front · row-mean SD ${edge.sd.toFixed(1)} · ink contrast ${formatContrast(analysis)}${edge.sd < 8 ? " · flat edge" : ""}`;

  const modeLabel =
    analysis.effectiveMode === "cover" ? "Cover-derived" : "Typographic";
  els.statModeV.textContent = modeLabel;
  els.statModeD.textContent =
    analysis.effectiveMode === "cover"
      ? book.artVerdict === "source"
        ? "genuine textless painting · strip is original art"
        : `${book.removalPct.toFixed(1)}% inpainted · textless art ${book.artVerdict}`
      : book.artVerdict === "review"
        ? `Textless art review / fail · ${book.removalPct.toFixed(1)}% inpainted`
        : "no cover pixels on spine · edge colour only";
}

function updateDecision(c) {
  const { analysis, book, layout, spine } = c;
  const fit = analysis.fit;
  els.decisionMode.textContent =
    analysis.effectiveMode === "cover"
      ? "Cover-derived spine"
      : "Typographic fallback";

  if (analysis.effectiveMode === "type" && state.mode === "cover") {
    els.decisionReason.textContent =
      "The measured cover rail could not hold the title at 7 pt, so the compositor switched to the typographic fallback rather than clipping.";
  } else if (analysis.effectiveMode === "type") {
    els.decisionReason.textContent = book.recommendation;
  } else {
    els.decisionReason.textContent = book.recommendation;
  }

  const list = [];
  if (analysis.effectiveMode === "cover") {
    list.push(
      `Strip source: ${
        state.stripSource === "art" ? "textless art" : "published front cover"
      }, sampled from the fold-adjacent left ${(book.stripX * 100).toFixed(1)}% at the same vertical scale as the front.`
    );
    list.push(
      `Rail on the ${book.railSide}; ink chosen at ${formatContrast(analysis)} against the strip (${analysis.lightRail ? "dark ink" : "cream ink"}).`
    );
  } else {
    list.push(
      `Pattern: edge colour ${c.assets.samples.edge.hex} (left 12% of front, row-mean SD ${c.assets.samples.edge.sd.toFixed(1)}) plus a blurred edge texture. No cover pixels are painted on the spine.`
    );
    list.push(
      `Full spine width used for type; ink chosen at ${formatContrast(analysis)} (${analysis.lightRail ? "dark ink" : "cream ink"}).`
    );
  }
  list.push(
    `Spine ${spine.spineIn.toFixed(3)} in from ${spine.leaves} leaves × ${state.caliperMm.toFixed(3)} mm + ${COVER_ALLOWANCE_MM} mm cover allowance.`
  );
  list.push(
    `1.00 in stress: ${analysis.stressOk ? "passes" : "fails"} at ${analysis.stressTitle.pt.toFixed(1)} pt with ${(analysis.stressTitle.lengthPx / 300).toFixed(2)} in of title length.`
  );
  for (const d of analysis.decisions) list.push(d);

  els.decisionList.innerHTML = list.map((t) => `<li>${t}</li>`).join("");

  els.fitTitle.textContent = `${fit.pt.toFixed(1)} pt · ${fit.text}`;
  els.fitLength.textContent = `${(fit.lengthPx / 300).toFixed(2)} / ${(fit.availableLengthPx / 300).toFixed(2)} in (${Math.round(fit.lengthRatio * 100)}%)`;
  els.fitAcross.textContent = `${(fit.acrossPx / 300).toFixed(2)} / ${(fit.availableAcrossPx / 300).toFixed(2)} in (${Math.round(fit.acrossRatio * 100)}%)`;
  els.fitLimit.textContent =
    fit.lengthRatio >= fit.acrossRatio ? "length" : "rail width";
  els.fitStress.innerHTML = `<span class="pill ${analysis.stressOk ? "ok" : "bad"}">${analysis.stressOk ? "PASS" : "FAIL"}</span> ${analysis.stressTitle.pt.toFixed(1)} pt`;
}

function renderOpts(c, pxPerIn, guides) {
  return {
    book: c.book,
    state,
    layout: c.layout,
    spine: c.spine,
    images: c.assets,
    samples: c.assets.samples,
    analysis: c.analysis,
    pxPerIn,
    guides,
  };
}

function renderDisplay(c) {
  const holder = els.wrapCanvas.parentElement;
  const cssW = Math.max(240, holder.clientWidth || 600);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetPx = clamp(Math.round(cssW * dpr), 640, 1800);
  const pxPerIn = targetPx / c.layout.totalW;
  renderWrap(els.wrapCanvas, renderOpts(c, pxPerIn, state.guides));
}

function renderPreviewAnd3D(c) {
  const targetPx = 1400;
  previewPxPerIn = targetPx / c.layout.totalW;
  if (!previewCanvas) previewCanvas = document.createElement("canvas");
  renderWrap(previewCanvas, renderOpts(c, previewPxPerIn, false));

  renderPanel(els.faceFront, { layout: c.layout, pxPerIn: previewPxPerIn, source: previewCanvas }, "front");
  renderPanel(els.faceBack, { layout: c.layout, pxPerIn: previewPxPerIn, source: previewCanvas }, "back");
  renderPanel(els.faceSpine, { layout: c.layout, pxPerIn: previewPxPerIn, source: previewCanvas }, "spine");

  const r = els.bookStage.getBoundingClientRect();
  const stageW = r.width || 340;
  const stageH = r.height || 300;
  const bookW = Math.min(
    220,
    Math.max(112, Math.min(stageW * 0.44, (stageH - 54) / 1.5))
  );
  const bookH = (bookW * c.trim.h) / c.trim.w;
  const spineCss = (bookW * c.spine.spineIn) / c.trim.w;
  els.book3d.style.setProperty("--bw", `${bookW.toFixed(1)}px`);
  els.book3d.style.setProperty("--bh", `${bookH.toFixed(1)}px`);
  els.book3d.style.setProperty("--sp", `${Math.max(8, spineCss).toFixed(1)}px`);
  els.book3d.style.setProperty("--ry", String(state.rotateY));
  els.rotateOut.textContent = `${state.rotateY}°`;
  els.threeMeta.textContent = `${c.spine.spineIn.toFixed(2)} in spine · ${Math.round(spineCss)} CSS px · front/back faces are trim crops of the same wrap`;
}

function renderCompare(c) {
  const { book, analysis, spine, trim } = c;
  els.v3Image.src = book.v3Spine;
  els.v3Image.alt = `${book.title} v3 art-only spine crop`;
  els.v3Caption.textContent =
    book.artVerdict === "source"
      ? "A genuine text-free painting, cropped to a fixed 160 × 727 spine. Beautiful pixels, but no thickness and no wrap."
      : book.artVerdict === "review"
        ? "The RPS crop is mostly reconstructed snow after 70.4% of the cover was masked. The textless-art study exposes this as a failure instead of hiding it."
        : "The Whisper Man crop survives the inpaint and reads as door/wood at shelf scale, but it is still a fixed crop with no thickness.";
  els.v3Metrics.textContent = `160 × 727 px · ${book.artNote} · no front/back, no spine arithmetic`;

  renderPanel(
    els.compareV4,
    { layout: c.layout, pxPerIn: previewPxPerIn, source: previewCanvas },
    "spine"
  );
  renderCrop(els.compareV4Zoom, {
    source: previewCanvas,
    pxPerIn: previewPxPerIn,
    box: {
      x: c.layout.spineX,
      y: c.layout.bleedIn + c.layout.trimH * 0.27,
      w: c.layout.spineIn,
      h: c.layout.trimH * 0.42,
    },
  });

  const mode = analysis.effectiveMode;
  els.v4Title.textContent =
    mode === "cover"
      ? `${spine.spineIn.toFixed(2)} in computed spine`
      : `${spine.spineIn.toFixed(2)} in typographic spine`;
  els.v4Caption.textContent =
    mode === "cover"
      ? `Fold-adjacent strip from ${
          state.stripSource === "art" ? "the textless art" : "the published cover"
        }, with a readable rail and measured type. The wrap is ${c.layout.totalW.toFixed(
          2
        )} in wide.`
      : `Edge colour ${c.assets.samples.edge.hex} plus fitted type. No cover pixels are painted onto the spine, which is the honest choice here.`;
  els.v4Metrics.textContent = `${spine.spineIn.toFixed(3)} × ${trim.h} in · ${analysis.fit.pt.toFixed(
    1
  )} pt title · 1-in ${analysis.stressOk ? "PASS" : "FAIL"} · ${mode} mode`;
}

function setPages(pages, message) {
  const even = clamp(Math.round(Number(pages) / 2) * 2, 48, 900);
  state.pages = even;
  syncControls();
  queueRefresh(message || `Set extent to ${even} pages.`);
}

function setStock(id) {
  const stock = getStock(id);
  state.stockId = stock.id;
  if (stock.caliperMm != null) state.caliperMm = stock.caliperMm;
  syncControls();
  queueRefresh(
    stock.caliperMm == null
      ? "Custom caliper selected."
      : `${stock.label}: ${stock.caliperMm.toFixed(3)} mm per leaf.`
  );
}

function stressOneInch() {
  const targetMm = MM_PER_IN;
  const leaves = (targetMm - COVER_ALLOWANCE_MM) / state.caliperMm;
  const pages = clamp(Math.round(leaves) * 2, 48, 900);
  state.pages = pages;
  syncControls();
  const actual = computeSpine({
    pages,
    caliperMm: state.caliperMm,
    allowanceMm: COVER_ALLOWANCE_MM,
  });
  queueRefresh(
    `1.00 in stress target: ${pages} pages gives ${actual.spineIn.toFixed(3)} in at ${state.caliperMm.toFixed(3)} mm/leaf. The fit test still runs at exactly 1.000 in.`
  );
}

async function exportPNG() {
  if (!current) return;
  els.exportBtn.disabled = true;
  els.statusLine.textContent = "Rendering 300 dpi wrap…";
  try {
    const canvas = document.createElement("canvas");
    const result = renderWrap(canvas, renderOpts(current, 300, false));
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
    });
    const mode = current.analysis.effectiveMode;
    const name = `pocketlibrary-wrap-${current.book.id}-${current.spine.pages}pp-${current.spine.spineIn.toFixed(3)}in-${mode}-300dpi.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    els.statusLine.textContent = `Downloaded ${name} · ${result.width.toLocaleString()} × ${result.height.toLocaleString()} px · ${(blob.size / 1024 / 1024).toFixed(2)} MB.`;
  } catch (err) {
    els.statusLine.textContent = `Export failed: ${err.message}`;
  } finally {
    els.exportBtn.disabled = false;
  }
}

function metricsSnapshot() {
  if (!current) return { ready: false };
  const { book, spine, layout, analysis, trim, assets } = current;
  const stripDown = (fit) => ({
    text: fit.text,
    pt: fit.pt,
    fontPx: fit.fontPx,
    lengthPx: fit.lengthPx,
    acrossPx: fit.acrossPx,
    availableLengthPx: fit.availableLengthPx,
    availableAcrossPx: fit.availableAcrossPx,
    lengthRatio: fit.lengthRatio,
    acrossRatio: fit.acrossRatio,
    ratio: fit.ratio,
    ok: fit.ok,
    cappedAtMax: fit.cappedAtMax,
  });
  return {
    ready,
    book: { id: book.id, title: book.title, author: book.author },
    state: { ...state },
    spine: {
      pages: spine.pages,
      leaves: spine.leaves,
      caliperMm: spine.caliperMm,
      textBlockMm: spine.textBlockMm,
      allowanceMm: spine.allowanceMm,
      spineMm: spine.spineMm,
      spineIn: spine.spineIn,
      clamped: spine.clamped,
    },
    layout: {
      trimW: trim.w,
      trimH: trim.h,
      bleedIn: layout.bleedIn,
      spineIn: layout.spineIn,
      totalW: layout.totalW,
      totalH: layout.totalH,
      backFold: layout.backFold,
      spineX: layout.spineX,
      frontFold: layout.frontFold,
    },
    print: { width: inToPx(layout.totalW), height: inToPx(layout.totalH), dpi: 300 },
    effectiveMode: analysis.effectiveMode,
    mode: state.mode,
    fit: stripDown(analysis.fit),
    authorFit: stripDown(analysis.authorFit),
    coverFit: stripDown(analysis.coverFit),
    coverAuthorFit: stripDown(analysis.coverAuthorFit),
    typeFit: stripDown(analysis.typeFit),
    stress: { ...stripDown(analysis.stressTitle), ok: analysis.stressOk },
    stressAuthor: { ...stripDown(analysis.stressAuthor), ok: analysis.stressAuthor.ok },
    decisions: analysis.decisions,
    edge: {
      hex: assets.samples.edge.hex,
      sd: assets.samples.edge.sd,
      lum: assets.samples.edge.lum,
      contrastInk: assets.samples.edge.contrastInk,
      contrastCream: assets.samples.edge.contrastCream,
    },
    art: {
      hex: assets.samples.art.hex,
      sd: assets.samples.art.sd,
      verdict: book.artVerdict,
      removalPct: book.removalPct,
    },
    railContrast: analysis.railStyle.contrast,
    canvases: {
      display: { width: els.wrapCanvas.width, height: els.wrapCanvas.height },
      preview: previewCanvas
        ? { width: previewCanvas.width, height: previewCanvas.height }
        : null,
      compare: { width: els.compareV4.width, height: els.compareV4.height },
      zoom: { width: els.compareV4Zoom.width, height: els.compareV4Zoom.height },
    },
    fonts: {
      loaded: document.fonts.check('16px "EB Garamond"'),
      warning: fontWarning,
    },
  };
}

// ---------- events ----------

els.pagesRange.addEventListener("input", (e) => setPages(e.target.value));
els.pagesNumber.addEventListener("change", (e) => setPages(e.target.value));
els.stockSelect.addEventListener("change", (e) => setStock(e.target.value));
els.caliperNumber.addEventListener("change", (e) => {
  const v = clamp(Number(e.target.value) || 0.1, 0.06, 0.2);
  state.caliperMm = v;
  state.stockId = "custom";
  syncControls();
  queueRefresh(`Custom caliper: ${v.toFixed(3)} mm per leaf.`);
});
els.trimSelect.addEventListener("change", (e) => {
  state.trimId = e.target.value;
  syncControls();
  queueRefresh(`Trim set to ${getTrim(state.trimId).label}.`);
});
els.bleedSelect.addEventListener("change", (e) => {
  state.bleedIn = Number(e.target.value);
  syncControls();
  queueRefresh(`Bleed set to ${state.bleedIn} in.`);
});
els.modeCover.addEventListener("click", () => {
  state.mode = "cover";
  syncControls();
  queueRefresh("Cover-derived spine: strip sampled from the fold-adjacent art.");
});
els.modeType.addEventListener("click", () => {
  state.mode = "type";
  syncControls();
  queueRefresh("Typographic spine: edge colour and measured type, no cover pixels.");
});
els.sourceSelect.addEventListener("change", (e) => {
  state.stripSource = e.target.value;
  queueRefresh(
    `Spine strip source: ${state.stripSource === "art" ? "textless art" : "published front cover"}.`
  );
});
els.guidesToggle.addEventListener("change", (e) => {
  state.guides = e.target.checked;
  if (current) {
    renderDisplay(current);
    updateViewerMeta(current);
  }
});
els.stressBtn.addEventListener("click", stressOneInch);
els.exportBtn.addEventListener("click", exportPNG);
els.resetBtn.addEventListener("click", () => {
  const book = getBook(state.bookId);
  state.pages = 320;
  state.stockId = "cream80";
  state.caliperMm = 0.1;
  state.trimId = "6x9";
  state.bleedIn = 0.125;
  state.mode = book.recommendedMode;
  state.stripSource = "art";
  state.guides = true;
  syncControls();
  queueRefresh("Reset to 320 pages, cream 80 gsm, 6 × 9 in, 0.125 in bleed.");
});
els.rotateRange.addEventListener("input", (e) => {
  state.rotateY = Number(e.target.value);
  els.book3d.style.setProperty("--ry", String(state.rotateY));
  els.rotateOut.textContent = `${state.rotateY}°`;
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (current) {
      renderDisplay(current);
      renderPreviewAnd3D(current);
      renderCompare(current);
    }
  }, 90);
});

// ---------- boot ----------

window.PocketWrap = {
  get ready() {
    return ready;
  },
  getState: () => ({ ...state }),
  setState: async (patch) => {
    Object.assign(state, patch);
    if (patch.bookId) {
      const b = getBook(patch.bookId);
      state.bookId = b.id;
      if (!patch.mode) state.mode = b.recommendedMode;
    }
    syncControls();
    await refreshNow();
    return metricsSnapshot();
  },
  setBook: async (id) => {
    const book = getBook(id);
    state.bookId = book.id;
    state.mode = book.recommendedMode;
    state.stripSource = "art";
    syncControls();
    await refreshNow();
    return metricsSnapshot();
  },
  getMetrics: metricsSnapshot,
  exportPNG,
  stressOneInch,
  refresh: refreshNow,
};

(async function boot() {
  buildOptions();
  buildBookPicker();
  await loadFonts();
  await refreshNow();
  // Preload the other two books without blocking the first paint.
  BOOK_LIST.forEach((b) => {
    if (b.id !== state.bookId) ensureBookAssets(b).catch(() => {});
  });
  if (fontWarning) {
    els.statusLine.textContent = fontWarning;
  }
})().catch((err) => {
  console.error(err);
  els.loading.textContent = `Could not start: ${err.message}`;
  els.statusLine.textContent = `Could not start: ${err.message}`;
});
