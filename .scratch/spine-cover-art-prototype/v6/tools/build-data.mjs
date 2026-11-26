// Build v6's data.js from the vendored provenance dataset plus v6-only design fields.
// Reads tools/source-data.js, never writes outside v6. Run from the repo root:
//   node .scratch/spine-cover-art-prototype/v6/tools/build-data.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const v6 = path.resolve(here, "..");
const v5DataPath = path.resolve(here, "source-data.js");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(v5DataPath, "utf8"), sandbox, { filename: v5DataPath });
const V5 = sandbox.window.V5_DATA;

// Page counts are edition-shaped, not fetched metadata. They exist to make the
// shelf thickness vary from the v4-wrap page/caliper model:
//   spine_mm = (pages / 2) * 0.100 + 1.2
// The on-screen width is a separate display scale, clamped to 40–55 px.
const pages = {
  "moby-dick": 448,
  "jane-eyre": 416,
  "pride-and-prejudice": 384,
  frankenstein: 288,
  dracula: 352,
  "great-expectations": 432,
  "bleak-house": 464,
  middlemarch: 480,
  moonstone: 400,
  "time-machine": 240,
  "treasure-island": 304,
  "jekyll-and-hyde": 256,
  "hound-of-the-baskervilles": 336,
  "dorian-gray": 320,
  "scarlet-letter": 272,
  "turn-of-the-screw": 208,
  alice: 224,
  "wuthering-heights": 368,
  "whisper-man": 368,
  "rock-paper-scissors": 336,
  "rock-paper-scissors-fallback": 336,
};

// Cloth + foil palette. Hues are chosen against each painting; the measured
// average/dominant colours below come from a 24 × 32 ffmpeg sample of the art.
// Keeping the cloth curated (instead of raw dominant) is what stops 21 spines
// turning into mud: S and L are constrained, only the hue is borrowed.
const palette = {
  "moby-dick":               { cloth: "#1d2c3d", accent: "#c9a45c", avg: "#756d40", dom: "#756a31" },
  "jane-eyre":               { cloth: "#3c493a", accent: "#e4d8bd", avg: "#353835", dom: "#0a1114" },
  "pride-and-prejudice":     { cloth: "#75494b", accent: "#f0e3c8", avg: "#93815b", dom: "#ad976b" },
  frankenstein:              { cloth: "#3f4a34", accent: "#d8c98a", avg: "#6e392e", dom: "#934832" },
  dracula:                   { cloth: "#4a2026", accent: "#e5d4b6", avg: "#3c3f3b", dom: "#2f2d26" },
  "great-expectations":      { cloth: "#2e4446", accent: "#c9aa6c", avg: "#454130", dom: "#343226" },
  "bleak-house":             { cloth: "#3a322b", accent: "#c99a6b", avg: "#393229", dom: "#111212" },
  middlemarch:               { cloth: "#494e37", accent: "#e4d7b4", avg: "#565847", dom: "#29261b" },
  moonstone:                 { cloth: "#b6ae9c", accent: "#2c3444", avg: "#847362", dom: "#abb7b0", light: true },
  "time-machine":            { cloth: "#6a5736", accent: "#e1c98f", avg: "#7f776b", dom: "#cfc6af" },
  "treasure-island":         { cloth: "#2b4357", accent: "#d6b97a", avg: "#7c6d5e", dom: "#332c30" },
  "jekyll-and-hyde":         { cloth: "#26302b", accent: "#d9cfb7", avg: "#5c4124", dom: "#2d1808" },
  "hound-of-the-baskervilles": { cloth: "#66533d", accent: "#e6d7b5", avg: "#958a7d", dom: "#d5d4ca" },
  "dorian-gray":             { cloth: "#4b3446", accent: "#c9a45c", avg: "#5e4c35", dom: "#2f2d26" },
  "scarlet-letter":          { cloth: "#592229", accent: "#e8d9bd", avg: "#5f4c43", dom: "#1d0d16" },
  "turn-of-the-screw":       { cloth: "#495048", accent: "#ddd2ba", avg: "#838870", dom: "#aab298" },
  alice:                     { cloth: "#2f5a5c", accent: "#d5b66f", avg: "#705b40", dom: "#564a35" },
  "wuthering-heights":       { cloth: "#5b4a58", accent: "#e0d3c0", avg: "#5d5146", dom: "#4f5447" },
  "whisper-man":             { cloth: "#141a24", accent: "#b9a27a", avg: "#21120b", dom: "#100a06" },
  "rock-paper-scissors":     { cloth: "#8d9295", accent: "#6b2a2a", avg: "#d2c3c2", dom: "#d2d1d0", light: true },
  "rock-paper-scissors-fallback": { cloth: "#dad2d1", accent: "#8a3a34", avg: "#d2c3c2", dom: "#d2d1d0", light: true },
};

const trimPages = (b) => pages[b.slug];
const p = (b) => palette[b.slug];

const books = V5.items.map((b) => {
  const pg = trimPages(b);
  const pal = p(b);
  const spineMm = (pg / 2) * 0.1 + 1.2;
  // Display scale: 40 px at 208 pages, 54 px at 480, i.e. a shelf zoom of
  // ~2.3 px/mm at 320 pages. Clamped so a 40 px spine is still readable.
  const widthPx = Math.min(55, Math.max(40, 40 + (pg - 208) * (14 / 272)));
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    author: b.author,
    year: b.year,
    route: b.route,
    routeNumber: b.routeNumber,
    routeName: b.routeName,
    badge: b.badge,
    tone: b.tone,
    pages: pg,
    spineMm: +spineMm.toFixed(2),
    widthPx: +widthPx.toFixed(2),
    heightPx: 226 + ((b.id * 13) % 17),
    cloth: pal.cloth,
    accent: pal.accent,
    lightCloth: !!pal.light,
    measured: { avg: pal.avg, dominant: pal.dom },
    art: b.art || null,
    cover: b.cover,
    crop: b.crop || null,
    focus: b.focus || null,
    artSubtype: b.artSubtype || (b.route === "fallback" ? "Typographic fallback" : "Artwork"),
    note: b.note || "",
    credit: b.credit || "",
    license: b.license || "",
    artLicense: b.artLicense || "",
    sourcePage: b.sourcePage || "",
    edgeHex: b.edgeHex || null,
    inkHex: b.inkHex || null,
    artPixels: b.artPixels || "—",
  };
});

const out = {
  generated: new Date().toISOString().slice(0, 10),
  version: 6,
  policy: V5.policy,
  counts: {
    books: books.length,
    original: books.filter((b) => b.route === "original").length,
    reconstructed: books.filter((b) => b.route === "reconstructed").length,
    fallback: books.filter((b) => b.route === "fallback").length,
  },
  books,
};

const banner = `// Generated by tools/build-data.mjs from tools/source-data.js.
// Do not edit by hand; edit the page/palette maps in tools/build-data.mjs.
// \`window.V6_DATA.books\` is the only input the v6 renderer needs.
`;
fs.writeFileSync(path.join(v6, "data.js"), banner + "window.V6_DATA = " + JSON.stringify(out, null, 2) + ";\n");
console.log(`wrote data.js — ${books.length} books, ${out.counts.original} original / ${out.counts.reconstructed} reconstructed / ${out.counts.fallback} fallback`);
