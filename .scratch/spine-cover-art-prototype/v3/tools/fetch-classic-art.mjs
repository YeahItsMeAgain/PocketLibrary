// Fetch public-domain source paintings used by the Standard Ebooks covers.
// Run from the repo root: node .scratch/spine-cover-art-prototype/v3/tools/fetch-classic-art.mjs
// Special:FilePath redirects to a scaled JPEG thumbnail; no API key needed.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const OUT = path.join(ROOT, "assets", "classic-originals");
fs.mkdirSync(OUT, { recursive: true });

const items = [
  ["moby-dick", "Albert Pinkham Ryder - Flying Dutchman - Smithsonian.jpg"],
  ["jane-eyre", "Vilhelm Hammershøi - Portrait of a young woman. The artist's sister Anna Hammershøi - Google Art Project.jpg"],
  ["pride-and-prejudice", "Edmund Blair Leighton - A Wet Sunday Morning.jpg"],
  ["dracula", "Joseph Magnus Stäck - Italienskt ruinlandskap i månsken.jpg"],
  ["great-expectations", "Clevelandart 1937.575.jpg"],
  ["bleak-house", "The Writing Master MET DT2038.jpg"],
  ["middlemarch", "John Constable - The Grove, or the Admiral's House in Hampstead - Google Art Project.jpg"],
  ["moonstone", "Study for \"Portrait of an Indian\" MET DP135221.jpg"],
  ["time-machine", "La Pendule noire, par Paul Cézanne.jpg"],
  ["treasure-island", "One More Step, Mr. Hands.jpg"],
  ["jekyll-and-hyde", "Doppelbildnis Marées und Lenbach (1863).jpg"],
  ["hound-of-the-baskervilles", "Caspar David Friedrich - Riesengebirge Landscape with Rising Fog - WGA8257.jpg"],
  ["dorian-gray", "John Collier - The Garden Of Armida.jpg"],
  ["scarlet-letter", "Hugues Merle - The Scarlet Letter - Walters 37172.jpg"],
  ["wuthering-heights", "Edith Villiers, later Countess of Lytton by George Frederic Watts.jpg"],
];

for (const [slug, title] of items) {
  const url = "https://commons.wikimedia.org/wiki/Special:FilePath/" +
    encodeURIComponent(title).replace(/%20/g, "_") + "?width=1800";
  const dest = path.join(OUT, `${slug}.jpg`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "PocketLibraryPrototype/1.0 (design research)" }, redirect: "follow" });
    if (!res.ok) { console.log(slug, res.status, title); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(slug, (buf.length / 1024 / 1024).toFixed(1) + "MB", title);
  } catch (e) { console.log(slug, "ERR", e.message); }
  await new Promise((r) => setTimeout(r, 1200));
}
