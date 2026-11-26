/* ==========================================================================
   Popular Editions Pack — gallery / app harness
   Loads and verifies the pack, caches it in IndexedDB, matches the app's
   catalogue, and renders v6/v7 Hybrid, Art-only and typographic fallbacks.
   ========================================================================== */

import {
  loadPack,
  clearPackCache,
  getCacheInfo,
  matchEdition,
  makeAssetUrls,
  normalizeIsbn,
} from "./pack-loader.js";
import {
  loadFonts,
  spineMarkup,
  layout,
  getMetrics,
} from "./spine-renderer.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const state = {
  library: null,
  packSize: null,
  pack: null,
  mode: "hybrid",
  scale: 1,
  policy: "study",
  selectedId: null,
  loadInfo: null,
  lastScenario: null,
  revokeAssets: null,
  busy: false,
  booted: false,
};

let logLines = [];

/* ---------- logging --------------------------------------------------- */

function log(message, tone = "") {
  const line = { at: new Date().toISOString().slice(11, 19), message, tone };
  logLines.push(line);
  if (logLines.length > 40) logLines = logLines.slice(-40);
  const node = $("#log");
  if (!node) return;
  node.innerHTML = logLines.map((l) =>
    `<div><span>${l.at}</span> <span class="${l.tone}">${esc(l.message)}</span></div>`
  ).join("");
  node.scrollTop = node.scrollHeight;
}

function formatBytes(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—";
}

/* ---------- pack load ------------------------------------------------- */

async function load(options = {}) {
  const mode = options.mode || "bundled";
  const policy = options.policy || state.policy;
  state.policy = policy;
  $$("[data-policy-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.policyBtn === policy)));
  setBusy(true);
  const started = performance.now();
  try {
    const pack = await loadPack({
      ...options,
      mode,
      policy,
      latency: options.latency != null ? options.latency : mode === "download" ? 260 : 0,
      onProgress: (p) => {
        if (p.done === p.total) log(`Verified ${p.done}/${p.total} pack files.`, "ok");
      },
    });
    if (state.revokeAssets) state.revokeAssets();
    state.revokeAssets = makeAssetUrls(pack);
    state.pack = pack;
    state.loadInfo = {
      ...pack.stats,
      source: pack.source,
      at: new Date().toISOString(),
      wallMs: performance.now() - started,
      errors: pack.errors,
    };
    log(
      `Pack ${pack.version} ${pack.source}: ${pack.stats.verifiedFiles}/${pack.stats.files} files verified, ` +
      `${pack.stats.acceptedEntries}/${pack.stats.entries} accepted in ${Math.round(pack.stats.loadMs)} ms.`,
      pack.errors.length ? "warn" : "ok"
    );
    for (const err of pack.errors.slice(0, 4)) {
      log(`${err.scope}/${err.code}: ${err.entry ? err.entry + " " : ""}${err.kind ? err.kind + " " : ""}${err.message || ""}`, "bad");
    }
    updateStatus();
    renderShelf();
    renderDetail();
    return summarize();
  } catch (err) {
    log(`Pack load failed: ${err.message || err}`, "bad");
    updateStatus();
    renderShelf();
    renderDetail();
    return { ok: false, error: String(err.message || err), source: mode };
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  state.busy = busy;
  $$("[data-load], [data-clear], [data-scenario]").forEach((n) => {
    n.disabled = !!busy;
  });
}

/* ---------- status ---------------------------------------------------- */

async function updateStatus() {
  const pack = state.pack;
  const cache = await getCacheInfo();
  const info = state.loadInfo;
  const packSize = state.packSize;

  const editionNode = $("#fact-editions");
  if (editionNode) editionNode.textContent = pack ? String(pack.manifest.entryCount) : "6";
  const sizeNode = $("#fact-size");
  if (sizeNode) {
    const bytes = packSize ? packSize.totalBytes : info ? info.fileBytes + info.manifestBytes : null;
    sizeNode.innerHTML = `${formatBytes(bytes).replace(/ (KiB|MiB|B)$/, "")} <small>${formatBytes(bytes).replace(/^[\d.]+ /, "")}</small>`;
  }
  const verifiedNode = $("#fact-verified");
  if (verifiedNode) verifiedNode.textContent = info ? `${info.verifiedFiles}/${info.files}` : "—";
  const loadNode = $("#fact-load");
  if (loadNode) loadNode.innerHTML = info ? `${Math.round(info.loadMs)} <small>ms</small>` : "— <small>ms</small>";

  const bar = $("#statusbar");
  if (!bar) return;
  const parts = [];
  if (pack) {
    parts.push(`Pack <b>${esc(pack.version)}</b>`);
    parts.push(`Source <b>${esc(pack.source)}</b>`);
    parts.push(`Integrity <b class="${info && info.verifiedFiles === info.files ? "ok" : "warn"}">${info ? info.verifiedFiles + "/" + info.files : "—"} verified</b>`);
    if (info && info.corruptFiles) parts.push(`<span class="bad">${info.corruptFiles} corrupt</span>`);
    if (info && info.missingFiles) parts.push(`<span class="bad">${info.missingFiles} missing</span>`);
    parts.push(`Accepted <b>${info ? info.acceptedEntries + "/" + info.entries : "—"}</b>`);
  } else {
    parts.push("Pack <b>not loaded</b>");
  }
  parts.push(`Cache <b>${cache.files} files · ${formatBytes(cache.bytes)}</b>`);
  if (cache.version) parts.push(`Cached <b>${esc(cache.version)}</b>`);
  bar.innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
}

/* ---------- render resolution ---------------------------------------- */

function fallbackResult(book, reason, extra = {}) {
  return {
    book,
    entry: extra.entry || null,
    match: extra.match || null,
    mode: "fallback",
    provenance: "fallback",
    reason,
    artUrl: null,
    artUrl2x: null,
  };
}

function resolveBook(book) {
  if (!state.pack) return fallbackResult(book, "pack-unavailable");
  const match = matchEdition(book, state.pack.manifest);
  if (!match) return fallbackResult(book, "no-edition-match");
  const entry = state.pack.entries.find((e) => e.id === match.entry.id);
  if (!entry) return fallbackResult(book, "entry-missing", { match });
  if (entry.status !== "verified") return fallbackResult(book, "asset-integrity", { entry, match });
  if (entry.reason === "quality-reject") return fallbackResult(book, "quality-reject", { entry, match });
  if (entry.reason === "rights-restricted") return fallbackResult(book, "rights-restricted", { entry, match });
  if (!entry.accepted) return fallbackResult(book, entry.reason || "not-accepted", { entry, match });
  const file = state.scale === 2 ? entry.files.spine2x : entry.files.spine;
  const file2x = entry.files.spine2x;
  if (!file || !file.verified) return fallbackResult(book, "asset-missing", { entry, match });
  return {
    book,
    entry,
    match,
    mode: state.mode,
    provenance: "original",
    reason: "",
    artUrl: file.objectUrl,
    artUrl2x: file2x && file2x.verified ? file2x.objectUrl : file.objectUrl,
  };
}

/* ---------- shelf ----------------------------------------------------- */

function splitRows(items, perRow) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
}

function goalPerRow(avail, scale, gap) {
  const spineW = 52 * scale;
  return Math.max(1, Math.floor((avail + gap) / (spineW + gap)));
}

function renderShelf() {
  const zone = $("#shelves");
  if (!zone || !state.library) return;
  const books = state.library.books;
  const results = books.map(resolveBook);
  const narrow = window.innerWidth <= 520;
  const gap = state.scale === 2 ? 8 : window.innerWidth <= 380 ? 5 : 7;
  const avail = Math.max(120, zone.clientWidth - (narrow ? 18 : 32));
  const perRow = goalPerRow(avail, state.scale, gap);
  const rows = splitRows(results, perRow);
  const matched = results.filter((r) => r.mode !== "fallback").length;
  const fallback = results.length - matched;

  zone.innerHTML = rows.map((row, index) => {
    const rowMatched = row.filter((r) => r.mode !== "fallback").length;
    return `<section class="shelf" aria-label="Shelf ${index + 1}">` +
      `<div class="shelf__head"><span class="shelf__no">Shelf <b>${roman(index + 1)}</b></span>` +
      `<span class="shelf__meta">${row.length} volumes · ${rowMatched} art · ${row.length - rowMatched} fallback</span></div>` +
      `<div class="shelf__stage">` +
        `<ul class="shelf__books" style="--book-gap:${gap}px">` +
          row.map((r) => {
            const b = r.book;
            return `<li class="book${b.id === state.selectedId ? " book--selected" : ""}" data-id="${esc(b.id)}"` +
              ` style="--w:${52 * state.scale}px;--h:${236 * state.scale}px">` +
              spineMarkup(b, {
                mode: r.mode,
                scale: state.scale,
                artUrl: r.artUrl,
                provenance: r.provenance,
                reason: r.reason,
              }) +
              `</li>`;
          }).join("") +
        `</ul>` +
        `<div class="shelf__board" aria-hidden="true"></div>` +
      `</div>` +
    `</section>`;
  }).join("");

  const legend = `<p class="shelf-legend" aria-label="Provenance marks">` +
    `<span class="legend__item"><i class="mark mark--original" aria-hidden="true"></i>verified pack art</span>` +
    `<span class="legend__item"><i class="mark mark--fallback" aria-hidden="true"></i>typographic fallback</span>` +
    `<span class="legend__hint">${52 * state.scale} × ${236 * state.scale} px · ${state.scale}× · select a spine</span>` +
  `</p>`;
  zone.insertAdjacentHTML("beforeend", legend);

  const metrics = results.map((r) => ({
    id: r.book.id,
    title: r.book.title,
    mode: r.mode,
    reason: r.reason,
    matched: r.mode !== "fallback",
    entryId: r.entry ? r.entry.id : null,
    matchReason: r.match ? r.match.reason : null,
    ...getMetrics(r.book, r.mode),
  }));
  state.metrics = metrics;
  updateFitline(metrics, matched, fallback);
}

function updateFitline(metrics, matched, fallback) {
  const node = $("#fitline-text");
  if (!node) return;
  if (!metrics.length) { node.textContent = "No spines."; return; }
  const tightest = metrics.reduce((m, x) => Math.max(m, x.limiting), 0);
  const smallest = metrics.reduce((m, x) => Math.min(m, x.fontSize), 99);
  const lowContrast = metrics.filter((x) => x.contrast < 4.5).length;
  node.innerHTML = `Measured with canvas · <b>${matched}</b> art spines · <b>${fallback}</b> fallback · ` +
    `tightest <b>${Math.round(tightest * 100)}%</b> · smallest <b>${smallest.toFixed(1)} px</b> · ` +
    `${lowContrast ? `<b>${lowContrast}</b> below 4.5:1` : "all ink above 4.5:1"}.`;
}

function roman(n) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n - 1] || String(n);
}

/* ---------- detail ---------------------------------------------------- */

const REASON_COPY = {
  "pack-unavailable": "No verified pack is loaded.",
  "no-edition-match": "The library book has no edition in this pack (ISBN, content hash and title+author all missed).",
  "entry-missing": "The manifest match could not be found in the loaded entries.",
  "asset-integrity": "At least one pack asset failed its SHA-256 or byte-length check.",
  "quality-reject": "The edition is in the pack but was rejected at spine scale.",
  "rights-restricted": "Release policy excludes this restricted-rights edition; study policy shows it.",
  "asset-missing": "The required spine file is not available in the verified pack.",
  "not-accepted": "The pack marked this edition as not accepted.",
};

function rightsClass(entry) {
  if (!entry) return "";
  return entry.edition.rights.distribution === "cleared" ? "quality--rights" : "quality--rights";
}

function detailHTML(book) {
  const r = resolveBook(book);
  const look = layout(book, r.mode === "fallback" ? "fallback" : "hybrid");
  const entry = r.entry;
  const quality = entry ? entry.quality : null;
  const edition = entry ? entry.edition : null;
  const rights = edition ? edition.rights : null;
  const match = r.match;

  const pair = r.mode === "fallback"
    ? pairGroup("Typographic fallback", r, true)
    : pairGroup("Hybrid", { ...r, mode: "hybrid" }, false) + pairGroup("Art only", { ...r, mode: "artonly" }, false);

  const fallbackNote = r.mode === "fallback"
    ? `<p class="fallbackNote"><b>Fallback:</b> ${esc(REASON_COPY[r.reason] || r.reason)} The spine uses cloth colour and measured type, not pack art.</p>`
    : "";

  const qualityBadge = quality
    ? `<span class="quality ${quality.status === "pass" ? "quality--pass" : "quality--reject"}">${esc(quality.status)}</span>`
    : `<span class="quality quality--reject">no edition</span>`;
  const rightsBadge = rights
    ? `<span class="quality ${rights.distribution === "cleared" ? "quality--rights" : ""}">${esc(rights.status)}</span>`
    : "";

  const assetRows = entry
    ? ["art", "spine", "spine2x"].map((kind) => {
        const f = entry.files[kind];
        return `<tr><td>${kind}</td><td>${f.width || "?"} × ${f.height || "?"}</td><td>${formatBytes(f.bytes)}</td>` +
          `<td class="${f.verified ? "ok" : "bad"}">${f.verified ? "verified" : f.failure || "unverified"}</td>` +
          `<td><code title="${esc(f.sha256)}">${esc(shortHash(f.sha256))}</code></td></tr>`;
      }).join("")
    : "";

  return `<div class="detail__inner">` +
    `<div class="detail__stage"><div class="detail__pair">${pair}</div></div>` +
    `<div class="detail__body">` +
      `<p class="kicker">Selected spine · ${esc(r.mode === "fallback" ? "typographic fallback" : r.mode === "artonly" ? "Art only" : "Hybrid")} · ${state.scale}× view</p>` +
      `<h2 class="detail__title">${esc(book.title)}</h2>` +
      `<p class="detail__author">${esc(book.author)}${book.pages ? " · " + book.pages + " pp" : ""}</p>` +
      `<div class="detail__badges">` +
        qualityBadge + rightsBadge +
        `<span class="pill pill--quiet">${esc(book.isbn || "no ISBN")}</span>` +
        (match ? `<span class="pill pill--${match.reason === "isbn" ? "original" : "quiet"}">${esc(match.reason)} · ${Math.round(match.confidence * 100)}%</span>` : `<span class="pill pill--fallback">no pack match</span>`) +
      `</div>` +
      `<p class="detail__note">${esc(entry ? entry.quality.reason : "This book is deliberately absent from the pack, so the loader cannot use edition art. The shelf stays readable by drawing a typographic cloth spine from the catalogue record.")}</p>` +
      fallbackNote +
      `<dl class="specs">` +
        `<div><dt>Spine</dt><dd><b>${look.w} × ${look.h} px</b><br><small>${state.scale}× render · ${look.stacked ? "two lines" : "one line"}</small></dd></div>` +
        `<div><dt>Type</dt><dd><b>${look.fs.toFixed(1)} px</b><br><small>${esc(look.limitedBy)} · ${Math.round(look.limiting * 100)}% used</small></dd></div>` +
        `<div><dt>Contrast</dt><dd><b>${look.contrastRatio.toFixed(1)}:1</b><br><small>measured ink / field</small></dd></div>` +
        `<div><dt>Cache</dt><dd><b>${entry && entry.files.spine.verified ? "verified" : "fallback"}</b><br><small>SHA-256 before render</small></dd></div>` +
      `</dl>` +
      `<div class="detail__actions">` +
        `<button class="quiet-btn" type="button" data-copy>Copy edition JSON</button>` +
        `<span class="detail__swatches" aria-label="Palette">` +
          `<i style="background:${esc(book.cloth)}" title="cloth ${esc(book.cloth)}"></i>` +
          `<i style="background:${esc(book.accent)}" title="accent ${esc(book.accent)}"></i>` +
          `<i style="background:${esc(look.paper)}" title="paper ${esc(look.paper)}"></i>` +
          `<i style="background:${esc(look.ink)}" title="ink ${esc(look.ink)}"></i>` +
        `</span>` +
      `</div>` +
      `<div class="prov">` +
      `<div><dt>Edition</dt><dd>${edition ? esc(edition.title) + `<small>${esc(edition.publisher)} · ${edition.year} · ISBN ${esc(edition.isbn || "none")}</small>` : "not in pack"}</dd></div>` +
      `<div><dt>Cover artist</dt><dd>${edition ? esc(edition.coverArtist) : "—"}<small>${edition ? esc(edition.editionNote) : "catalogue record only"}</small></dd></div>` +
      `<div><dt>Source</dt><dd>${edition ? esc(edition.source.name) : "—"}<small>${edition ? esc(edition.source.url) : ""}</small></dd></div>` +
      `<div><dt>Rights</dt><dd>${rights ? esc(rights.status) + `<small>${esc(rights.credit)}</small>` : "—"}</dd></div>` +
      `<div><dt>Quality</dt><dd>${quality ? esc(quality.status) + " · " + quality.score + "/25" + `<small>${esc(quality.caveat || "")}</small>` : "—"}</dd></div>` +
      `<div><dt>Match</dt><dd>${match ? esc(match.reason) + " · " + Math.round(match.confidence * 100) + "%" + `<small>ISBN ${esc(book.isbn || "none")}</small>` : "none"}${entry ? `<small>manifest ${esc(entry.id)}</small>` : ""}</dd></div>` +
      `<div><dt>Manifest SHA-256</dt><dd><code>${esc(shortHash(state.pack ? state.pack.latest.manifestSha256 : null))}</code><small>verified before any file is cached</small></dd></div>` +
      `<div><dt>Content hash</dt><dd><code>${esc(shortHash(book.contentHash))}</code><small>source cover, used after ISBN</small></dd></div>` +
    `</div>` +
      (entry ? `<table class="assetTable"><thead><tr><th>Asset</th><th>Size</th><th>Bytes</th><th>SHA-256</th><th>Digest</th></tr></thead><tbody>${assetRows}</tbody></table>` : "") +
      (entry ? `<p class="fallbackNote"><b>Rights note:</b> ${esc(rights.note)} <br><b>Takedown:</b> ${esc(rights.takedown)}</p>` : "") +
    `</div>` +
  `</div>`;
}

function pairGroup(label, r, forceFallback) {
  const book = r.book;
  const mode = forceFallback ? "fallback" : r.mode;
  const one = spineMarkup(book, {
    mode,
    scale: 1,
    artUrl: mode === "fallback" ? null : r.artUrl,
    provenance: mode === "fallback" ? "fallback" : "original",
    reason: r.reason,
    preview: true,
  });
  const twoArt = mode === "fallback" ? null : r.artUrl2x || r.artUrl;
  const two = spineMarkup(book, {
    mode,
    scale: 2,
    artUrl: twoArt,
    provenance: mode === "fallback" ? "fallback" : "original",
    reason: r.reason,
    preview: true,
  });
  return `<figure class="detail__pairGroup">` +
    `<figcaption>${esc(label)}</figcaption>` +
    `<div class="detail__pairScale">` +
      `<figure>${one}<figcaption>52 × 236</figcaption></figure>` +
      `<figure>${two}<figcaption>104 × 472</figcaption></figure>` +
    `</div>` +
  `</figure>`;
}

function renderDetail() {
  const host = $("#detail");
  if (!host || !state.library) return;
  let book = state.library.books.find((b) => b.id === state.selectedId);
  if (!book) book = state.library.books[0];
  if (!book) return;
  state.selectedId = book.id;
  host.innerHTML = detailHTML(book);
}

function selectBook(id) {
  if (!state.library || !state.library.books.some((b) => b.id === id)) return false;
  state.selectedId = id;
  $$(".book").forEach((li) => li.classList.toggle("book--selected", li.dataset.id === id));
  renderDetail();
  renderShelf();
  return true;
}

/* ---------- controls -------------------------------------------------- */

function setMode(mode) {
  if (!["hybrid", "artonly"].includes(mode)) return;
  state.mode = mode;
  $$("[data-mode-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.modeBtn === mode)));
  renderShelf();
  renderDetail();
}

function setScale(scale) {
  state.scale = Number(scale) === 2 ? 2 : 1;
  $$("[data-scale-btn]").forEach((n) => n.setAttribute("aria-pressed", String(Number(n.dataset.scaleBtn) === state.scale)));
  renderShelf();
  renderDetail();
}

async function setPolicy(policy) {
  if (!["study", "release"].includes(policy)) return;
  state.policy = policy;
  $$("[data-policy-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.policyBtn === policy)));
  if (state.pack) await load({ mode: "bundled", policy });
  else renderShelf();
}

/* ---------- matching / scenario report -------------------------------- */

function summarize() {
  const metrics = state.metrics || [];
  const overflow = measureOverflow();
  return {
    ok: Boolean(state.pack),
    source: state.pack ? state.pack.source : null,
    version: state.pack ? state.pack.version : null,
    stats: state.loadInfo ? { ...state.loadInfo } : null,
    selectedId: state.selectedId,
    mode: state.mode,
    scale: state.scale,
    policy: state.policy,
    cache: null,
    overflow,
    metrics,
    scenarios: state.lastScenario ? [state.lastScenario] : [],
  };
}

function measureOverflow() {
  const doc = document.documentElement;
  const width = window.innerWidth;
  const offenders = [];
  for (const el of document.body.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && (rect.right > width + 1 || rect.left < -1)) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string" ? el.className : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
      if (offenders.length >= 8) break;
    }
  }
  return {
    innerWidth: width,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: doc.scrollWidth > width + 1 || offenders.length > 0,
    offenders,
  };
}

function scenarioResult(name, ok, detail, extra = {}) {
  const result = {
    name,
    ok,
    at: new Date().toISOString(),
    detail,
    ...extra,
    overflow: measureOverflow(),
  };
  state.lastScenario = result;
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`, ok ? "ok" : "bad");
  updateStatus();
  return result;
}

async function runScenario(name) {
  try {
    if (name === "first-load") {
      await clearPackCache();
      const r = await load({ mode: "bundled", ignoreCache: true });
      const cache = await getCacheInfo();
      const ok = r.ok && r.stats.verifiedFiles === r.stats.files && cache.files === r.stats.files;
      return scenarioResult(name, ok,
        `${r.stats ? r.stats.verifiedFiles + "/" + r.stats.files : "0"} files verified; ${cache.files} in IndexedDB; ${Math.round(r.stats ? r.stats.loadMs : 0)} ms.`,
        { cache, stats: r.stats });
    }

    if (name === "download") {
      await clearPackCache();
      const r = await load({ mode: "download", latency: 180, ignoreCache: true });
      const ok = r.ok && r.source === "download" && r.stats.verifiedFiles === r.stats.files;
      return scenarioResult(name, ok,
        `Simulated download verified ${r.stats ? r.stats.verifiedFiles + "/" + r.stats.files : "0"} files in ${Math.round(r.stats ? r.stats.loadMs : 0)} ms.`,
        { stats: r.stats, source: r.source });
    }

    if (name === "offline-reload") {
      if (!state.pack) await load({ mode: "bundled" });
      const r = await load({ mode: "offline" });
      const ok = r.ok && r.source === "cache" && r.stats.verifiedFiles === r.stats.files && r.stats.networkFiles === 0;
      return scenarioResult(name, ok,
        `Offline load used ${r.stats ? r.stats.cachedFiles : 0} cached files, ${r.stats ? r.stats.verifiedFiles + "/" + r.stats.files : "0"} verified, no network.`,
        { stats: r.stats, source: r.source });
    }

    if (name === "missing-edition") {
      if (!state.pack) await load({ mode: "bundled" });
      selectBook("project-hail-mary");
      const r = resolveBook(state.library.books.find((b) => b.id === "project-hail-mary"));
      const ok = r.mode === "fallback" && r.reason === "no-edition-match";
      renderShelf();
      renderDetail();
      return scenarioResult(name, ok,
        `Project Hail Mary matched no pack edition; spine is ${r.mode} (${r.reason}).`);
    }

    if (name === "corrupt-asset") {
      const r = await load({ mode: "bundled", corrupt: "the-hobbit", ignoreCache: true });
      const entry = r.ok ? state.pack.entries.find((e) => e.id === "the-hobbit") : null;
      const resolved = state.pack ? resolveBook(state.library.books.find((b) => b.id === "the-hobbit")) : null;
      selectBook("the-hobbit");
      const ok = Boolean(entry && entry.status !== "verified" && resolved && resolved.mode === "fallback" && resolved.reason === "asset-integrity");
      return scenarioResult(name, ok,
        `The Hobbit asset was flipped after fetch; SHA-256 rejected it (${entry ? entry.status : "no entry"}) and the spine fell back to ${resolved ? resolved.mode : "?"}.`,
        { stats: r.stats, entryStatus: entry ? entry.status : null, reason: resolved ? resolved.reason : null });
    }

    if (name === "rejected-art") {
      const r = await load({ mode: "bundled", ignoreCache: true, policy: "study" });
      selectBook("lord-of-the-rings");
      const resolved = resolveBook(state.library.books.find((b) => b.id === "lord-of-the-rings"));
      const entry = state.pack ? state.pack.entries.find((e) => e.id === "lord-of-the-rings") : null;
      const ok = Boolean(r.ok && entry && entry.quality.status === "reject" && resolved.mode === "fallback" && resolved.reason === "quality-reject");
      return scenarioResult(name, ok,
        `The Lord of the Rings is present and verified but quality=reject; spine is ${resolved ? resolved.mode : "?"} (${resolved ? resolved.reason : "?"}).`,
        { stats: r.stats, reason: resolved ? resolved.reason : null });
    }

    if (name === "rights-gate") {
      state.policy = "release";
      $$("[data-policy-btn]").forEach((n) => n.setAttribute("aria-pressed", String(n.dataset.policyBtn === "release")));
      const r = await load({ mode: "bundled", ignoreCache: true, policy: "release" });
      selectBook("harry-potter");
      const resolved = resolveBook(state.library.books.find((b) => b.id === "harry-potter"));
      const ok = Boolean(r.ok && resolved.mode === "fallback" && resolved.reason === "rights-restricted" && r.stats.acceptedEntries === 2);
      return scenarioResult(name, ok,
        `Release policy accepted ${r.stats ? r.stats.acceptedEntries : "?"} cleared entries; Harry Potter fell back (${resolved ? resolved.reason : "?"}).`,
        { stats: r.stats, reason: resolved ? resolved.reason : null });
    }

    return scenarioResult(name, false, "Unknown scenario.");
  } catch (err) {
    return scenarioResult(name, false, String(err.message || err));
  }
}

/* ---------- boot ------------------------------------------------------ */

let swRegistration = null;

async function registerShellWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register("sw.js");
    return swRegistration;
  } catch (err) {
    log(`Shell service worker unavailable: ${err.message || err}`, "warn");
    return null;
  }
}

async function boot() {
  log("Boot: loading fonts, catalogue and pack…");
  try {
    await registerShellWorker();
    await loadFonts();
    const [libraryRes, sizeRes] = await Promise.all([
      fetch("library.json", { cache: "no-store" }),
      fetch("pack/size.json", { cache: "no-store" }).catch(() => null),
    ]);
    if (!libraryRes.ok) throw new Error(`library.json HTTP ${libraryRes.status}`);
    state.library = await libraryRes.json();
    if (sizeRes && sizeRes.ok) state.packSize = await sizeRes.json();
    state.selectedId = state.library.books[0] ? state.library.books[0].id : null;
    bind();
    await load({ mode: "auto" });
    state.booted = true;
    document.body.classList.add("is-ready");
    log("Ready. Use a scenario button or the pack actions.", "ok");
  } catch (err) {
    log(`Boot failed: ${err.message || err}`, "bad");
    renderShelf();
    renderDetail();
    state.booted = true;
  }
  await updateStatus();
}

function bind() {
  $$("[data-mode-btn]").forEach((n) => n.addEventListener("click", () => setMode(n.dataset.modeBtn)));
  $$("[data-scale-btn]").forEach((n) => n.addEventListener("click", () => setScale(n.dataset.scaleBtn)));
  $$("[data-policy-btn]").forEach((n) => n.addEventListener("click", () => setPolicy(n.dataset.policyBtn)));

  $$("[data-load]").forEach((n) => n.addEventListener("click", () => {
    const mode = n.dataset.load;
    if (mode === "offline") log("Reloading only from IndexedDB; no network fetch.", "");
    load({
      mode,
      latency: mode === "download" ? 260 : 0,
      ignoreCache: mode === "bundled" || mode === "download",
    });
  }));

  $$("[data-scenario]").forEach((n) => n.addEventListener("click", () => runScenario(n.dataset.scenario)));

  $("[data-clear]").addEventListener("click", async () => {
    await clearPackCache();
    log("Cache cleared. The next load must fetch the pack.", "warn");
    renderShelf();
    renderDetail();
    await updateStatus();
  });

  $("#shelves").addEventListener("click", (e) => {
    const spine = e.target.closest(".spine[data-book-id]");
    if (spine) selectBook(spine.dataset.bookId);
  });

  $("#detail").addEventListener("click", async (e) => {
    if (e.target.closest("[data-copy]")) {
      const book = state.library.books.find((b) => b.id === state.selectedId);
      const r = book ? resolveBook(book) : null;
      const payload = JSON.stringify({
        book,
        resolved: r ? { mode: r.mode, reason: r.reason, match: r.match ? r.match.reason : null, entryId: r.entry ? r.entry.id : null } : null,
        pack: state.pack ? { version: state.pack.version, manifestSha256: state.pack.latest.manifestSha256 } : null,
      }, null, 2);
      try {
        await navigator.clipboard.writeText(payload);
        log("Copied edition JSON to the clipboard.", "ok");
      } catch {
        log("Clipboard unavailable; edition JSON is in the console.", "warn");
        console.info(payload);
      }
    }
  });

  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderShelf(); renderDetail(); }, 140);
  });
}

/* ---------- public harness ------------------------------------------- */

const ready = boot();

window.PopularApp = {
  ready,
  swReady: ("serviceWorker" in navigator)
    ? navigator.serviceWorker.ready.then(() => true).catch(() => false)
    : Promise.resolve(false),
  load,
  clearCache: clearPackCache,
  getCacheInfo,
  getState: async () => ({ ...summarize(), cache: await getCacheInfo(), booted: state.booted, busy: state.busy, packSize: state.packSize }),
  getMetrics: () => (state.metrics || []).map((m) => ({ ...m })),
  getPackInfo: () => ({
    id: state.pack ? state.pack.packId : null,
    version: state.pack ? state.pack.version : null,
    latest: state.pack ? state.pack.latest : null,
    stats: state.loadInfo ? { ...state.loadInfo } : null,
    errors: state.pack ? state.pack.errors : [],
    size: state.packSize,
    library: state.library ? { version: state.library.version, books: state.library.books.length } : null,
  }),
  getEntry: (id) => {
    if (!state.pack) return null;
    const entry = state.pack.entries.find((e) => e.id === id);
    if (!entry) return null;
    return {
      id: entry.id,
      status: entry.status,
      accepted: entry.accepted,
      reason: entry.reason,
      quality: entry.quality,
      rights: entry.edition.rights,
      files: Object.fromEntries(["art", "spine", "spine2x"].map((k) => [k, {
        path: entry.files[k].path,
        sha256: entry.files[k].sha256,
        bytes: entry.files[k].bytes,
        width: entry.files[k].width,
        height: entry.files[k].height,
        verified: entry.files[k].verified,
        failure: entry.files[k].failure,
      }])),
    };
  },
  resolve: (id) => {
    const book = state.library && state.library.books.find((b) => b.id === id);
    if (!book) return null;
    const r = resolveBook(book);
    return { id, mode: r.mode, reason: r.reason, entryId: r.entry ? r.entry.id : null, match: r.match ? { reason: r.match.reason, confidence: r.match.confidence } : null };
  },
  match: (book) => (state.pack ? matchEdition(book, state.pack.manifest) : null),
  selectBook,
  setMode,
  setScale,
  setPolicy: async (p) => { await setPolicy(p); return summarize(); },
  runScenario,
  measureOverflow,
  getLog: () => logLines.map((l) => ({ ...l })),
};
