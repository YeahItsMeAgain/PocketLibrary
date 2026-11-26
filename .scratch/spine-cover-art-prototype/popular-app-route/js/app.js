/* ==========================================================================
   popular-app-route — reads the v8-app run records and renders each result
   in the v6/v7 Hybrid and Art-only engines. No pack lookup is required.
   ========================================================================== */

import { BOOKS, PACK_SPINE } from "./data.js";
import { loadFonts, spineMarkup, layout, getMetrics } from "./spine-renderer.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const state = {
  ready: false,
  records: new Map(),
  errors: [],
  spines: [],
};

const PLAN_LABEL = {
  "text-free crop": "Text-free crop",
  inpaint: "Inpaint",
  fallback: "Fallback",
};

function prettyRoute(route) {
  return PLAN_LABEL[route] || route || "—";
}

function readRecord(book) {
  return fetch(`v8/${book.slug}/run.json`, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`${book.slug}: HTTP ${r.status}`);
      return r.json();
    });
}

function pct(v) {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

function secs(v) {
  return v == null ? "—" : `${Number(v).toFixed(2)} s`;
}

function decisionReasons(record) {
  const reasons = record.decision_reasons || [];
  return reasons.length ? reasons.join(" · ") : "—";
}

function renderCard(book, record) {
  const verdict = record.verdict || "fallback";
  const route = record.route || "fallback";
  const mask = record.mask || {};
  const runtime = record.runtime_s || {};
  const qa = record.qa || {};
  const qaBlock = qa.chosen || qa.text_free || qa.inpaint || {};
  const spineQa = qaBlock.spine || {};

  // The crop-native file is the text-free result the route actually ships.
  // art.jpg is the full reconstruction and, on crop routes, still carries type.
  const artUrl = `v8/${book.slug}/crop-native.jpg`;
  const isFallback = verdict === "fallback";
  const nativeSpine = isFallback ? `v8/${book.slug}/fallback-spine.jpg` : `v8/${book.slug}/spine-2x.jpg`;
  const nativeLabel = isFallback ? "V8 fallback" : "V8 native";
  const hybridMode = isFallback ? "fallback" : "hybrid";
  const hybridLabel = isFallback ? "Hybrid · fallback cloth" : "Hybrid · v6/v7";
  const artOnlyFlag = isFallback
    ? '<span class="render__flag render__flag--reject">QA fallback<br>do not ship</span>'
    : verdict === "review"
      ? '<span class="render__flag">Review · fallback<br>shipped alongside</span>'
      : "";

  const hybrid = spineMarkup(book, {
    mode: hybridMode,
    scale: 1,
    preview: true,
    artUrl,
    provenance: isFallback ? "fallback" : verdict === "review" ? "reconstructed" : "original",
    reason: isFallback ? decisionReasons(record) : "",
  });
  const artonly = spineMarkup(book, {
    mode: "artonly",
    scale: 1,
    preview: true,
    artUrl,
    provenance: isFallback ? "fallback" : verdict === "review" ? "reconstructed" : "original",
    reason: verdict === "review" ? decisionReasons(record) : "",
  });

  const pack = book.pack
    ? `<div class="packrow">
        <img src="${PACK_SPINE}/${esc(book.pack.id)}.jpg" alt="Curated pack spine for ${esc(book.title)}">
        <div class="packrow__text">
          <b>Optional pack · ${esc(book.pack.status)} ${book.pack.score}/25</b>
          <p>${book.pack.status === "reject"
            ? '<span class="bad">The curated pack also rejects this edition.</span> Both routes agree: ship the typographic cloth fallback.'
            : '<span class="ok">Bonus, not required.</span> A rights-cleared fast path if it is already on the device; v8-app produced this spine without it.'}</p>
        </div>
      </div>`
    : `<div class="packrow">
        <div class="packrow__text">
          <b>No pack entry</b>
          <p>${book.unseen ? "Unseen title, deliberately outside the curated pack. " : ""}v8-app is the route; no pack lookup happened.</p>
        </div>
      </div>`;

  const badges = [
    `<span class="verdict verdict--${esc(verdict)}">${esc(verdict)}</span>`,
    book.unseen ? '<span class="tag tag--unseen">Unseen title</span>' : "",
    book.group === "generative" ? '<span class="tag">Generative-art case</span>' : "",
  ].filter(Boolean).join("");

  const cardClass = [
    "book",
    isFallback ? "book--fallback" : "",
    book.unseen ? "book--unseen" : "",
  ].filter(Boolean).join(" ");

  return `<article class="${cardClass}" data-book="${esc(book.id)}" data-verdict="${esc(verdict)}" data-route="${esc(route)}">
    <header class="book__head">
      <div>
        <p class="kicker">${book.group === "generative" ? "Generative art" : "Popular"} · ${esc(prettyRoute(route))}</p>
        <h3>${esc(book.title)}</h3>
        <p class="book__meta">${esc(book.author)} · ${book.pages} pp${book.isbn ? ` · ISBN ${esc(book.isbn)}` : ""}</p>
      </div>
      <div class="book__badges">${badges}</div>
    </header>
    <div class="book__body">
      <div class="evidence">
        <figure><img src="v8/${esc(book.slug)}/source.jpg" alt="Source cover for ${esc(book.title)}"><figcaption>Source</figcaption></figure>
        <figure><img src="v8/${esc(book.slug)}/mask-preview.jpg" alt="Automatic text mask for ${esc(book.title)}"><figcaption>V8 mask</figcaption></figure>
        <figure><img src="v8/${esc(book.slug)}/crop-native.jpg" alt="V8 text-free crop for ${esc(book.title)}"><figcaption>V8 text-free</figcaption></figure>
        <figure><img class="evidence__spine" src="${nativeSpine}" alt="V8 native 52 by 236 spine for ${esc(book.title)}"><figcaption>V8 spine</figcaption></figure>
      </div>

      <dl class="routefacts">
        <div><dt>Route</dt><dd><b>${esc(prettyRoute(route))}</b><small>${esc(verdict)}</small></dd></div>
        <div><dt>Mask coverage</dt><dd><b>${pct(mask.coverage_pct)}</b><small>${mask.detection_boxes || 0} text boxes</small></dd></div>
        <div><dt>Runtime</dt><dd><b>${secs(runtime.total)}</b><small>host, same Rust path</small></dd></div>
        <div><dt>Spine QA</dt><dd><b>${spineQa.luma_std == null ? "—" : Number(spineQa.luma_std).toFixed(1)} luma σ</b><small>edge ${spineQa.edge_density == null ? "—" : Number(spineQa.edge_density).toFixed(3)}</small></dd></div>
        <div><dt>Flat fill</dt><dd><b>${pct(mask.flat_fill_pct)}</b><small>${qaBlock.crop_mask_coverage_pct == null ? "no crop" : pct(qaBlock.crop_mask_coverage_pct) + " in crop"}</small></dd></div>
        <div><dt>Residual OCR</dt><dd><b>${(qaBlock.spine_residual_ocr || []).length}</b><small>words on spine</small></dd></div>
      </dl>

      <p class="book__reason"><b>Decision:</b> ${esc(decisionReasons(record))}.</p>

      <div class="renders">
        <div class="render">
          <p class="render__label"><b>${esc(hybridLabel)}</b><br>52 × 236</p>
          <div class="render__stack">${hybrid}</div>
        </div>
        <div class="render">
          <p class="render__label"><b>Art only · v6/v7</b><br>52 × 236</p>
          <div class="render__stack">${artonly}${artOnlyFlag}</div>
        </div>
        <div class="render render--native">
          <p class="render__label"><b>${esc(nativeLabel)}</b><br>${isFallback ? "52 × 236" : "2× export"}</p>
          <div class="render__stack"><img src="${nativeSpine}" alt="${esc(nativeLabel)} spine for ${esc(book.title)}"></div>
        </div>
      </div>

      ${pack}
    </div>
  </article>`;
}

function measureOverflow() {
  const doc = document.documentElement;
  const inner = window.innerWidth;
  const offenders = [];
  for (const node of document.querySelectorAll("body *")) {
    const r = node.getBoundingClientRect();
    if (r.width > 0 && (r.right > inner + 1 || r.left < -1)) {
      offenders.push({
        tag: node.tagName.toLowerCase(),
        cls: node.className && typeof node.className === "string" ? node.className.slice(0, 60) : "",
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
      if (offenders.length >= 8) break;
    }
  }
  return {
    overflow: doc.scrollWidth > inner + 1 || offenders.length > 0,
    scrollWidth: doc.scrollWidth,
    innerWidth: inner,
    offenders,
  };
}

function collectSpines() {
  return Array.from(document.querySelectorAll(".spine")).map((node) => {
    const r = node.getBoundingClientRect();
    return {
      book: node.closest("[data-book]")?.dataset.book || null,
      mode: node.dataset.mode,
      prov: node.dataset.prov,
      width: Math.round(r.width),
      height: Math.round(r.height),
      fit: Number(node.dataset.fit),
    };
  });
}

async function boot() {
  const popular = $("#popular-books");
  const generative = $("#generative-books");

  try {
    await loadFonts();
  } catch (err) {
    state.errors.push(`fonts: ${err.message}`);
  }

  const records = await Promise.all(BOOKS.map(async (book) => {
    try {
      const record = await readRecord(book);
      state.records.set(book.id, record);
      return { book, record };
    } catch (err) {
      state.errors.push(err.message);
      return { book, record: null };
    }
  }));

  popular.innerHTML = records
    .filter(({ book }) => book.group === "popular")
    .map(({ book, record }) => record ? renderCard(book, record) : `<p class="kicker">Missing run: ${esc(book.slug)}</p>`)
    .join("");

  generative.innerHTML = records
    .filter(({ book }) => book.group === "generative")
    .map(({ book, record }) => record ? renderCard(book, record) : `<p class="kicker">Missing run: ${esc(book.slug)}</p>`)
    .join("");

  const popularRecords = records.filter(({ book, record }) => book.group === "popular" && record).map(({ record }) => record);
  const pass = popularRecords.filter((r) => r.verdict === "pass").length;
  const review = popularRecords.filter((r) => r.verdict === "review").length;
  const fallback = popularRecords.filter((r) => r.verdict === "fallback").length;

  $("#fact-covers").textContent = String(popularRecords.length);
  $("#fact-verdicts").textContent = `${pass} pass · ${fallback} fallback${review ? ` · ${review} review` : ""}`;

  state.spines = collectSpines();
  const badFit = state.spines.filter((s) => !(s.fit <= 1.01));
  if (badFit.length) state.errors.push(`${badFit.length} spines over fit budget`);

  state.ready = true;
  window.PopularAppRoute = {
    ready: true,
    getState: () => ({
      ready: state.ready,
      errors: state.errors.slice(),
      overflow: measureOverflow(),
      spines: collectSpines(),
      verdicts: Object.fromEntries(
        records.filter(({ record }) => record).map(({ book, record }) => [book.id, record.verdict])
      ),
      routes: Object.fromEntries(
        records.filter(({ record }) => record).map(({ book, record }) => [book.id, record.route])
      ),
    }),
    measureOverflow,
    metrics: () => BOOKS.map((b) => ({
      id: b.id,
      hybrid: getMetrics(b, "hybrid"),
      artonly: getMetrics(b, "artonly"),
      fallback: getMetrics(b, "fallback"),
    })),
  };
}

boot().catch((err) => {
  state.errors.push(String(err && err.stack || err));
  const mount = $("#popular-books");
  if (mount) mount.innerHTML = `<p class="kicker">Gallery failed to boot: ${esc(err.message || err)}</p>`;
  window.PopularAppRoute = {
    ready: false,
    getState: () => ({ ready: false, errors: state.errors.slice(), overflow: measureOverflow(), spines: [] }),
    measureOverflow,
  };
});
