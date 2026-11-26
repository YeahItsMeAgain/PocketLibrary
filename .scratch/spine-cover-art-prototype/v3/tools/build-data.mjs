// Build the v3 data file from the v2 attribution manifest, the art manifest
// and the removal audit. Output: data.js (window.V3_DATA), so the page also
// works from file:// with no fetch/CORS surprises.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const V2 = path.join(ROOT, "..", "v2", "sources.json");
const art = JSON.parse(fs.readFileSync(path.join(ROOT, "art", "manifest.json"), "utf8"));
const source = JSON.parse(fs.readFileSync(V2, "utf8"));
const masks = {
  "whisper-man": JSON.parse(fs.readFileSync(path.join(ROOT, "masks", "whisper-man.json"), "utf8")),
  "rock-paper-scissors": JSON.parse(fs.readFileSync(path.join(ROOT, "masks", "rock-paper-scissors.json"), "utf8")),
};

const COMMONS = {
  "moby-dick": "Albert Pinkham Ryder - Flying Dutchman - Smithsonian.jpg",
  "jane-eyre": "Vilhelm Hammershøi - Portrait of a young woman. The artist's sister Anna Hammershøi - Google Art Project.jpg",
  "pride-and-prejudice": "Edmund Blair Leighton - A Wet Sunday Morning.jpg",
  "dracula": "Joseph Magnus Stäck - Italienskt ruinlandskap i månsken.jpg",
  "great-expectations": "Clevelandart 1937.575.jpg",
  "bleak-house": "The Writing Master MET DT2038.jpg",
  "middlemarch": "John Constable - The Grove, or the Admiral's House in Hampstead - Google Art Project.jpg",
  "moonstone": "Study for \"Portrait of an Indian\" MET DP135221.jpg",
  "time-machine": "La Pendule noire, par Paul Cézanne.jpg",
  "treasure-island": "One More Step, Mr. Hands.jpg",
  "jekyll-and-hyde": "Doppelbildnis Marées und Lenbach (1863).jpg",
  "hound-of-the-baskervilles": "Caspar David Friedrich - Riesengebirge Landscape with Rising Fog - WGA8257.jpg",
  "dorian-gray": "John Collier - The Garden Of Armida.jpg",
  "scarlet-letter": "Hugues Merle - The Scarlet Letter - Walters 37172.jpg",
  "wuthering-heights": "Edith Villiers, later Countess of Lytton by George Frederic Watts.jpg",
};

const items = source.items.map((s) => {
  const a = art[s.slug];
  const modern = Boolean(masks[s.slug]);
  const m = masks[s.slug];
  const commons = COMMONS[s.slug];
  const paintingUrl = commons
    ? "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(commons).replace(/%20/g, "_")
    : null;
  const methodLabel = modern
    ? "OCR + LaMa"
    : a.method === "original"
      ? "Original painting"
      : "Cover crop above plate";
  const artLicense = modern
    ? "Edition cover used only for this design prototype; not public domain."
    : a.method === "original"
      ? "Public domain (original painting)"
      : "Public domain (Standard Ebooks cover art)";
  return {
    id: source.items.indexOf(s) + 1,
    slug: s.slug,
    title: s.title,
    author: s.author,
    year: s.year,
    edition: s.edition || "Standard Ebooks edition",
    isbn: s.isbn || null,
    source: s.source,
    sourcePage: s.page_url,
    coverUrl: s.cover_url,
    license: s.license,
    credit: s.cover_credit,
    cover: modern ? `assets/${s.slug}-cover.jpg` : `assets/classic-covers/${s.slug}.jpg`,
    original: modern ? `assets/${s.slug}-cover.jpg` : `assets/classic-covers/${s.slug}.jpg`,
    art: a.art,
    crop: a.crop,
    artPixels: a.art_pixels,
    sourcePixels: a.source_pixels,
    focus: a.focus,
    method: a.method,
    methodLabel,
    note: a.note,
    artLicense,
    artSource: modern ? "Edition cover, text removed" : a.method === "original" ? "Wikimedia Commons" : "Standard Ebooks cover",
    paintingUrl,
    commons: commons || null,
    tone: a.mean_lum > 0.32 ? "light" : "dark",
    railSide: a.rail_side,
    meanLum: a.mean_lum,
    p95Lum: a.p95,
    maskPreview: modern ? `masks/${s.slug}-mask-preview.jpg` : null,
    maskPng: modern ? `masks/${s.slug}-mask.png` : null,
    removed: modern ? `removed/${s.slug}-textless.jpg` : null,
    removal: m
      ? {
          maskFraction: m.mask_fraction,
          ocrBoxes: m.ocr_boxes,
          ocrSeconds: m.ocr_seconds,
          inpaintSeconds: m.inpaint_seconds,
          residual: m.residual_ocr,
          engine: m.engine,
          texts: m.text_items.map((t) => t.text),
        }
      : null,
    status:
      s.slug === "rock-paper-scissors" ? "review" : s.slug === "whisper-man" ? "pass" : "source",
  };
});

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  items,
};
fs.writeFileSync(path.join(ROOT, "data.js"), "window.V3_DATA = " + JSON.stringify(payload, null, 2) + ";\n");
fs.writeFileSync(path.join(ROOT, "sources.json"), JSON.stringify(payload, null, 2) + "\n");
console.log("wrote data.js and sources.json:", items.length, "items");
console.log(items.map((i) => `${i.slug} ${i.method} ${i.tone} ${i.artPixels}`).join("\n"));
