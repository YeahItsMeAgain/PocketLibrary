import { loadManifest, hydratePack, resolveBook } from "./pack.js";
import { clearAll, stats as cacheStats } from "./idb.js";
import { shortHash, titleAuthorKey } from "./hash.js";
import { seedFromString, renderSpine, downloadCanvasPng } from "./spine.js";

const params = new URLSearchParams(location.search);
const fixture = params.get("fixture");
const packBase = params.get("pack") || "pack/";
const LOCK = window.TEXTLESS_PACK_LOCK;
const CATALOG = window.TEXTLESS_CATALOG || [];

const UNKNOWN_BOOK = {
  id: "probe-unknown",
  title: "A Book Not In The Pack",
  author: "I. M. Unknown",
  isbn: null,
  contentHash: null,
};

const state = {
  ready: false,
  rendered: false,
  manifest: null,
  manifestSource: "loading",
  manifestError: null,
  manifestSha256: null,
  results: new Map(),
  counters: null,
  timings: { totalMs: 0, manifestMs: 0, hydrateMs: 0, readyMs: 0 },
  entries: [],
  selectedId: null,
  cacheStats: null,
};

const bitmaps = new Map();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const esc = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function formatMs(ms) {
  const n = Number(ms) || 0;
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

function bookKey(book) {
  return `b:${book.id}`;
}
function fallbackSeed(book) {
  return seedFromString(`${book.title}|${book.author}`);
}

async function bitmapFor(blob, key) {
  if (!blob) return null;
  if (bitmaps.has(key)) return bitmaps.get(key);
  try {
    const bitmap = await createImageBitmap(blob);
    bitmaps.set(key, bitmap);
    return bitmap;
  } catch {
    return null;
  }
}

function buildEntries() {
  const books = fixture === "unknown" ? [...CATALOG, UNKNOWN_BOOK] : [...CATALOG];
  return books.map((book) => {
    const item = state.manifest ? resolveBook(state.manifest, book) : null;
    let status = "missing";
    let reason = "";
    let spineBlob = null;
    let artBlob = null;

    if (!state.manifest) {
      status = "missing";
      reason = state.manifestError || "No pack manifest is available.";
    } else if (!item) {
      status = "unknown";
      reason = "No content-hash, ISBN or title+author match in the pack index.";
    } else if (item.status !== "available") {
      status = "unavailable";
      reason = item.unavailableReason === "not-public-domain"
        ? "This edition is in copyright; the pack ships metadata and ISBN only."
        : "This item is not available in the pack.";
    } else {
      const result = state.results.get(item.id);
      if (!result) {
        status = "missing";
        reason = "The item is listed but its assets were not hydrated.";
      } else {
        status = result.status;
        reason = result.reason || "";
        spineBlob = result.spineBlob || null;
        artBlob = result.artBlob || null;
      }
    }

    return {
      book: {
        ...book,
        title: item?.title || book.title,
        author: item?.author || book.author,
        isbn: item?.isbn || book.isbn || null,
      },
      item,
      status,
      reason,
      spineBlob,
      artBlob,
      key: bookKey(book),
    };
  });
}

function statusLabel(status) {
  return {
    ready: "pack",
    unavailable: "licence",
    unknown: "unknown",
    corrupt: "corrupt",
    missing: "fallback",
  }[status] || status;
}

function counts() {
  const c = { ready: 0, unavailable: 0, unknown: 0, corrupt: 0, missing: 0, art: 0, fallback: 0 };
  for (const entry of state.entries) {
    c[entry.status] = (c[entry.status] || 0) + 1;
    if (entry.status === "ready") c.art += 1;
    else c.fallback += 1;
  }
  return c;
}

function setProgress(done, total) {
  const pct = total > 0 ? clamp(Math.round((done / total) * 100), 0, 100) : 0;
  $("#progress").setAttribute("aria-valuenow", String(pct));
  $("#progress-bar").style.width = `${pct}%`;
}

function setStatusText(html, tone = "") {
  const note = $("#status-note");
  note.innerHTML = html;
  if (tone) note.dataset.tone = tone;
  else delete note.dataset.tone;
}

function renderStatus() {
  const c = counts();
  const pack = state.manifest?.pack;
  const lock = LOCK || {};
  const totalBytes = (lock.manifestBytes || 0) + (lock.totalAssetBytes || 0);
  const title = pack ? `${pack.title} · v${pack.version}` : "No pack available";
  const sourceLabel = {
    network: "Pack fetched and verified",
    cache: "Offline reload · verified from IndexedDB",
    missing: "Pack absent · generated plates",
    loading: "Loading",
  }[state.manifestSource] || state.manifestSource;

  $("#status-title").textContent = title;
  $("#status-sub").textContent = pack
    ? `${pack.availableCount} public-domain books · ${pack.itemCount} records · ${pack.description}`
    : "The bundled catalog still renders; every spine uses the generated plate.";

  const verified = state.counters?.verified ?? 0;
  const total = state.counters?.total ?? 0;
  const rejected = state.counters?.rejectedCacheReads ?? 0;
  const badges = [
    `<span class="badge" data-tone="${state.manifestSource === "missing" ? "bad" : state.manifestSource === "cache" ? "info" : "ok"}">${esc(state.manifestSource)}</span>`,
    `<span class="badge" data-tone="${rejected ? "bad" : "ok"}">${verified}/${total || 0} sha-256</span>`,
    `<span class="badge" data-tone="ok">PD only</span>`,
    `<span class="badge" data-tone="info">IndexedDB</span>`,
  ];
  $("#status-badges").innerHTML = badges.join("");

  const metrics = [
    ["Pack size", formatBytes(totalBytes)],
    ["Art books", `${c.art} / ${state.entries.length}`],
    ["Manifest", formatBytes(lock.manifestBytes || 0)],
    ["Ready", state.rendered ? formatMs(state.timings.readyMs) : "…"],
  ];
  $("#metrics").innerHTML = metrics
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");

  const fixtureNote = {
    missing: " <b>Fixture:</b> the pack fetch is deliberately skipped; no cached manifest exists, so every book falls back.",
    corrupt: " <b>Fixture:</b> one spine bitmap is flipped after fetch; its SHA-256 fails and only that book falls back.",
    unknown: " <b>Fixture:</b> the catalog includes a book that is absent from the manifest index.",
  }[fixture] || "";
  const srcNote = state.manifestSource === "cache"
    ? "The network manifest was unavailable, so the last lock-verified manifest was read from IndexedDB."
    : state.manifestSource === "missing"
      ? "No manifest could be read. The catalog records are bundled in the app shell, so the shelf still renders."
      : "Fetched the manifest, checked it against the app-side lock, then verified every spine and art file before caching.";
  setStatusText(`${srcNote}${fixtureNote}`, state.manifestSource === "missing" ? "bad" : "");

  setProgress(state.counters?.done ?? 0, state.counters?.total ?? 0);
  if (state.ready) setProgress(1, 1);
}

function renderShelfSkeleton() {
  const shelf = $("#shelf");
  shelf.innerHTML = state.entries
    .map(
      (entry) => `
      <figure class="book-card" data-id="${esc(entry.book.id)}" data-status="${esc(entry.status)}" data-selected="${entry.book.id === state.selectedId}">
        <button class="spine-btn" type="button" data-select="${esc(entry.book.id)}" aria-label="Open ${esc(entry.book.title)} by ${esc(entry.book.author)}">
          <canvas class="spine-canvas" width="104" height="472" role="img" aria-label="Art-only spine for ${esc(entry.book.title)}"></canvas>
        </button>
        <figcaption>
          <span class="book-title">${esc(entry.book.title)}</span>
          <span class="book-author">${esc(entry.book.author)}</span>
          <em class="book-state" data-status="${esc(entry.status)}" title="${esc(entry.reason)}">${esc(statusLabel(entry.status))}</em>
        </figcaption>
      </figure>`,
    )
    .join("");

  $$(".spine-btn", shelf).forEach((button) => {
    button.addEventListener("click", () => selectBook(button.dataset.select));
  });
}

async function paintShelf() {
  renderShelfSkeleton();
  await Promise.all(
    state.entries.map(async (entry) => {
      const card = $(`.book-card[data-id="${cssEscape(entry.book.id)}"]`);
      const canvas = card?.querySelector("canvas");
      if (!canvas) return;
      let bitmap = null;
      if (entry.status === "ready") {
        bitmap = await bitmapFor(entry.spineBlob, entry.book.id);
        if (!bitmap) {
          entry.status = "corrupt";
          entry.reason = "The verified bitmap could not be decoded; using the generated plate.";
          const badge = card.querySelector(".book-state");
          badge.dataset.status = "corrupt";
          badge.textContent = statusLabel("corrupt");
          badge.title = entry.reason;
          card.dataset.status = "corrupt";
        }
      }
      renderSpine(canvas, {
        bitmap,
        seed: fallbackSeed(entry.book),
        width: 104,
        height: 472,
      });
    }),
  );

  const c = counts();
  $("#shelf-count").textContent = `${c.art} art · ${c.fallback} fallback`;
  $("#shelf-caption").innerHTML =
    `<b>${c.ready}</b> from the pack` +
    (c.unavailable ? ` · <b>${c.unavailable}</b> in-copyright records (metadata only)` : "") +
    (c.corrupt ? ` · <b>${c.corrupt}</b> hash rejected` : "") +
    (c.unknown ? ` · <b>${c.unknown}</b> unknown book` : "") +
    (c.missing ? ` · <b>${c.missing}</b> missing pack` : "") +
    ` · ${verifiedText()}`;
}

function verifiedText() {
  const counters = state.counters;
  if (!counters) return "no assets hydrated";
  return `${counters.verified}/${counters.total} assets SHA-256 verified · ${counters.downloads} fetched · ${counters.cacheHits} cache hits`;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

let detailObjectUrl = null;

async function selectBook(id) {
  state.selectedId = id;
  $$(".book-card").forEach((card) => {
    card.dataset.selected = String(card.dataset.id === id);
  });
  await renderDetail();
}

async function renderDetail() {
  const entry = state.entries.find((candidate) => candidate.book.id === state.selectedId) || state.entries[0];
  if (!entry) return;
  state.selectedId = entry.book.id;
  const detail = $("#detail");
  const item = entry.item;
  const badgeTone = entry.status === "ready" ? "ok" : entry.status === "corrupt" ? "bad" : "warn";
  $("#detail-status").textContent = statusLabel(entry.status);

  const sourcePage = item?.source?.page;
  let sourceHost = "";
  try {
    sourceHost = sourcePage ? new URL(sourcePage).hostname : "";
  } catch {
    sourceHost = "source";
  }
  const sourceLink = sourcePage
    ? `<a href="${esc(sourcePage)}" target="_blank" rel="noreferrer">${esc(sourceHost)}</a>`
    : "—";
  const contentHash = item?.contentHash || entry.book.contentHash;
  const identifiers = [
    item?.isbn ? ["ISBN", esc(item.isbn)] : null,
    ["Title+author key", `<code>${esc(titleAuthorKey(entry.book.title, entry.book.author))}</code>`],
    contentHash ? ["Source content hash", `<code>${esc(shortHash(contentHash, 12))}</code>`] : null,
  ].filter(Boolean);

  const assetRows = item?.assets
    ? [
        ["Spine 2×", `${item.assets.spine.width}×${item.assets.spine.height} · ${formatBytes(item.assets.spine.bytes)}`, item.assets.spine.sha256],
        ["Art file", `${item.assets.art.width}×${item.assets.art.height} · ${formatBytes(item.assets.art.bytes)}`, item.assets.art.sha256],
      ]
    : [];

  const note =
    entry.status === "ready"
      ? "The spine crop and art file below are the verified pack bytes. The shelf canvas is a 104 × 472 render of the 52 × 236 object; the caption is app UI, not printed cover type."
      : entry.status === "unavailable"
        ? "This edition is in copyright. The pack carries its ISBN and identity only; no cover pixels ship. A textless spine for it would need the v8-app on-device route."
        : entry.status === "corrupt"
          ? "A hash failed. The asset was deleted instead of cached, and this generated plate is the deterministic fallback."
          : entry.status === "unknown"
            ? "No manifest key matched. The generated plate is seeded from title+author, so it stays stable across reloads."
            : "The pack was unavailable or this item was not hydrated. The generated plate shows what the app can always draw offline.";

  detail.innerHTML = `
    <div class="detail-preview">
      <canvas id="detail-canvas" width="208" height="944" role="img" aria-label="Large art-only spine for ${esc(entry.book.title)}"></canvas>
      <span>Preview 4× · object 52×236</span>
    </div>
    <div class="detail-body">
      <h3 class="detail-title">${esc(entry.book.title)}</h3>
      <p class="detail-author">${esc(entry.book.author)}${item?.year ? ` · ${esc(item.year)}` : ""}</p>
      <div class="badges" style="justify-content:flex-start;max-width:none;margin-top:7px">
        <span class="badge" data-tone="${badgeTone}">${esc(statusLabel(entry.status))}</span>
        ${item?.methodLabel ? `<span class="badge" data-tone="info">${esc(item.methodLabel)}</span>` : ""}
        ${item?.source?.licence ? `<span class="badge" data-tone="ok">${/^Public domain/i.test(item.source.licence) ? "public domain" : "metadata only"}</span>` : ""}
      </div>
      <dl class="detail-meta">
        <div><dt>Provenance</dt><dd>${esc(item?.source?.provenance || entry.reason || "No pack record")}</dd></div>
        <div><dt>Licence</dt><dd>${esc(item?.source?.licence || "—")}</dd></div>
        <div><dt>Credit</dt><dd>${esc(item?.credit || "—")}</dd></div>
        <div><dt>Source</dt><dd>${sourceLink}</dd></div>
        ${identifiers.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join("")}
        ${assetRows
          .map(
            ([label, size, hash]) =>
              `<div><dt>${esc(label)}</dt><dd>${esc(size)} · <code>${esc(shortHash(hash, 12))}</code></dd></div>`,
          )
          .join("")}
      </dl>
      <div class="detail-actions">
        <button class="btn btn--small" type="button" id="btn-52">Download 52×236 PNG</button>
        <button class="btn btn--small" type="button" id="btn-2x">Download 2× PNG</button>
      </div>
    </div>
    ${
      entry.artBlob
        ? `<figure class="detail-art"><img alt="Art file for ${esc(entry.book.title)}" id="detail-art-img"><figcaption>Art file · ${esc(item?.assets?.art.width)}×${esc(item?.assets?.art.height)} · ${formatBytes(item?.assets?.art.bytes)}</figcaption></figure>`
        : ""
    }
    <p class="detail-note">${esc(note)}</p>
  `;

  const canvas = $("#detail-canvas");
  const bitmap = entry.status === "ready" ? await bitmapFor(entry.spineBlob, entry.book.id) : null;
  renderSpine(canvas, {
    bitmap,
    seed: fallbackSeed(entry.book),
    width: 208,
    height: 944,
  });

  if (detailObjectUrl) {
    URL.revokeObjectURL(detailObjectUrl);
    detailObjectUrl = null;
  }
  if (entry.artBlob) {
    detailObjectUrl = URL.createObjectURL(entry.artBlob);
    const img = $("#detail-art-img");
    if (img) img.src = detailObjectUrl;
  }

  $("#btn-52")?.addEventListener("click", () => exportSpine(entry, 52, 236));
  $("#btn-2x")?.addEventListener("click", () => exportSpine(entry, 104, 472));
}

async function exportSpine(entry, width, height) {
  const canvas = document.createElement("canvas");
  const bitmap = entry.status === "ready" ? await bitmapFor(entry.spineBlob, entry.book.id) : null;
  renderSpine(canvas, { bitmap, seed: fallbackSeed(entry.book), width, height });
  await downloadCanvasPng(canvas, `${entry.book.id}-spine-${width}x${height}.png`);
}

function renderIntegrity() {
  const rows = state.entries.map((entry) => {
    const item = entry.item;
    const spine = item?.assets?.spine;
    const art = item?.assets?.art;
    const stateLabel = statusLabel(entry.status);
    return `<tr>
      <td>${esc(entry.book.title)}</td>
      <td><code>${spine ? esc(shortHash(spine.sha256, 10)) : "—"}</code></td>
      <td><code>${art ? esc(shortHash(art.sha256, 10)) : "not shipped"}</code></td>
      <td class="num">${item?.bytes ? formatBytes(item.bytes) : "—"}</td>
      <td class="state-${esc(entry.status)}">${esc(stateLabel)}</td>
    </tr>`;
  });
  $("#integrity-table tbody").innerHTML = rows.join("");
  const totalBytes = state.entries.reduce((n, entry) => n + (entry.item?.bytes || 0), 0);
  $("#integrity-count").textContent = `${state.counters?.total || 0} assets · ${formatBytes(totalBytes)}`;

  const lock = LOCK || {};
  const match = state.manifestSha256 && state.manifestSha256 === lock.manifestSha256;
  const cached = state.cacheStats || { assetCount: 0, manifestCount: 0 };
  $("#hash-lock").innerHTML = `
    <div><dt>Manifest lock</dt><dd>${esc(shortHash(lock.manifestSha256, 18))}</dd></div>
    <div><dt>Manifest read</dt><dd class="${match ? "match" : ""}">${esc(shortHash(state.manifestSha256, 18))} ${match ? "· match" : state.manifestSha256 ? "· MISMATCH" : ""}</dd></div>
    <div><dt>Pack id</dt><dd>${esc(lock.packId || "—")} · ${esc(lock.packVersion || "—")}</dd></div>
    <div><dt>IndexedDB</dt><dd>${cached.manifestCount} manifest · ${cached.assetCount} verified assets</dd></div>
    <div><dt>Trust anchor</dt><dd>pack-lock.js ships with the app shell (not inside the downloaded pack)</dd></div>
  `;
}

function renderStates() {
  const states = [
    ["First load", "no query", "Network manifest + 36 assets verified; 18 art spines, 2 licence fallbacks."],
    ["Offline reload", "first load, then offline", "App shell from the service worker; manifest + assets from IndexedDB; same 18 art spines."],
    ["Missing pack", "?fixture=missing", "No manifest and no cache; all 20 books draw generated plates, no throw."],
    ["Corrupt hash", "?fixture=corrupt", "One fetched spine is bit-flipped; that book is rejected and falls back; 17 remain art."],
    ["Unknown book", "?fixture=unknown", "A catalog book absent from the index draws a generated plate and reports ‘unknown’."],
  ];
  $("#states-table tbody").innerHTML = states
    .map(([name, input, expected]) => `<tr><td>${esc(name)}</td><td><code>${esc(input)}</code></td><td>${esc(expected)}</td></tr>`)
    .join("");

  const links = [
    ["First load", "./"],
    ["Missing pack", "?fixture=missing"],
    ["Corrupt hash", "?fixture=corrupt"],
    ["Unknown book", "?fixture=unknown"],
  ];
  $("#state-links").innerHTML = links
    .map(([label, href]) => {
      const active = (!fixture && label === "First load") || fixture === href.split("fixture=")[1];
      return `<a href="${esc(href)}"${active ? ' aria-current="true"' : ""}>${esc(label)}</a>`;
    })
    .join("");
}

async function runLookupChecks() {
  const list = $("#lookup-results");
  if (!state.manifest) {
    list.innerHTML = `<li data-ok="false">No manifest loaded; lookups cannot run.</li>`;
    return [];
  }
  const moby = CATALOG.find((book) => book.id === "moby-dick") || CATALOG[0];
  const whisper = CATALOG.find((book) => book.id === "whisper-man");
  const checks = [
    {
      label: "content hash",
      book: { contentHash: moby.contentHash, title: "Wrong title", author: "Wrong author" },
      expect: "moby-dick",
    },
    {
      label: "ISBN 978-1-405-93601-9",
      book: { isbn: "978-1-405-93601-9", title: "Wrong title", author: "Wrong author" },
      expect: "whisper-man",
    },
    {
      label: "title+author",
      book: { title: "Moby-Dick", author: "Herman Melville" },
      expect: "moby-dick",
    },
    {
      label: "unknown book",
      book: { title: "A Book Not In The Pack", author: "I. M. Unknown" },
      expect: null,
    },
  ];
  const results = checks.map((check) => {
    const item = resolveBook(state.manifest, check.book);
    const id = item?.id ?? null;
    return { ...check, got: id, ok: id === check.expect };
  });
  list.innerHTML = results
    .map(
      (r) =>
        `<li data-ok="${r.ok}">${r.ok ? "pass" : "fail"} · ${esc(r.label)} → ${esc(r.got ?? "null")}${r.expect ? ` (expected ${esc(r.expect)})` : " (expected null)"}</li>`,
    )
    .join("");
  return results;
}

async function downloadManifest() {
  let text;
  let name = "textless-pack-manifest.json";
  if (state.manifest) {
    text = JSON.stringify(state.manifest, null, 2);
  } else {
    try {
      const response = await fetch(new URL(`${packBase}manifest.json`, document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (error) {
      setStatusText(`Could not download the manifest: ${esc(error.message)}`, "bad");
      return;
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function boot() {
  const started = performance.now();
  renderStates();
  renderShelfSkeleton();
  setStatusText("Reading the manifest and checking the app-side lock…");

  const manifestLoad = await loadManifest({ packBase, fixture, lock: LOCK });
  state.manifest = manifestLoad.manifest;
  state.manifestSource = manifestLoad.source;
  state.manifestError = manifestLoad.error;
  state.manifestSha256 = manifestLoad.manifestSha256;

  const hydration = await hydratePack(state.manifest, {
    packBase,
    fixture,
    onProgress: (progress) => {
      state.counters = progress;
      setProgress(progress.done, progress.total);
      setStatusText(
        `Verifying ${progress.done}/${progress.total} assets · ${formatBytes(progress.bytesFetched)} fetched · ${progress.cacheHits} cache hits`,
      );
    },
  });
  state.results = hydration.results;
  state.counters = hydration.counters;

  state.entries = buildEntries();
  if (!state.selectedId || !state.entries.some((entry) => entry.book.id === state.selectedId)) {
    state.selectedId =
      state.entries.find((entry) => entry.status === "ready")?.book.id || state.entries[0]?.book.id || null;
  }

  await paintShelf();
  renderStatus();
  await renderDetail();
  state.cacheStats = await cacheStats();
  renderIntegrity();
  renderStatus();
  await runLookupChecks();

  const now = performance.now();
  state.timings = {
    totalMs: manifestLoad.loadMs + hydration.hydrateMs,
    manifestMs: manifestLoad.loadMs,
    hydrateMs: hydration.hydrateMs,
    readyMs: now - started,
  };
  state.ready = true;
  state.rendered = true;
  renderStatus();
  document.documentElement.dataset.state = state.manifestSource;
  return state;
}

function wireControls() {
  $("#btn-verify").addEventListener("click", () => location.reload());
  $("#btn-clear").addEventListener("click", async () => {
    $("#btn-clear").disabled = true;
    await clearAll();
    location.reload();
  });
  $("#btn-manifest").addEventListener("click", downloadManifest);
  $("#btn-lookup").addEventListener("click", runLookupChecks);
}

const swReady =
  "serviceWorker" in navigator
    ? navigator.serviceWorker
        .register("sw.js")
        .then(() => navigator.serviceWorker.ready)
        .catch(() => null)
    : Promise.resolve(null);

const readyPromise = (async () => {
  wireControls();
  try {
    return await boot();
  } catch (error) {
    state.manifestSource = "missing";
    state.manifestError = error.message;
    state.entries = buildEntries();
    state.selectedId = state.entries[0]?.book.id || null;
    await paintShelf();
    renderStatus();
    await renderDetail();
    renderIntegrity();
    state.ready = true;
    state.rendered = true;
    setStatusText(`Pack boot failed: ${esc(error.message)}. Every spine fell back.`, "bad");
    return state;
  }
})();

window.__textless = {
  readyPromise: Promise.all([readyPromise, swReady]).then(() => state),
  swReady,
  getState: () => ({
    ready: state.ready,
    rendered: state.rendered,
    manifestSource: state.manifestSource,
    manifestError: state.manifestError,
    manifestSha256: state.manifestSha256,
    packId: state.manifest?.pack?.id || null,
    packVersion: state.manifest?.pack?.version || null,
    timings: state.timings,
    counters: state.counters,
    counts: counts(),
    totalBytes: (LOCK?.manifestBytes || 0) + (LOCK?.totalAssetBytes || 0),
    selectedId: state.selectedId,
  }),
  resolveBook: (book) => resolveBook(state.manifest, book),
  runLookupChecks,
};
