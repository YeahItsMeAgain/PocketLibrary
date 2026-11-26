#!/usr/bin/env node
/**
 * Build the Textless Art Pack from the v3 study read-only.
 *
 * Inputs (never modified):
 *   ../v3/sources.json
 *   ../v3/art/<slug>-art.jpg
 *   ../v3/assets/classic-covers/<slug>.jpg  (content-hash key only)
 *
 * Outputs:
 *   pack/manifest.json
 *   pack/items/<slug>-spine.jpg    104 x 472  (52 x 236 at 2x)
 *   pack/items/<slug>-art.jpg      <= 480 x 720
 *   pack-lock.js                   app-side trust anchor for the manifest
 *
 * The spine crop is generated from the art's focus point, not copied from the
 * v3 hand-prepared crop. Only public-domain items ship pixels. The two modern
 * in-copyright editions are listed as unavailable so ISBN/keys can be
 * demonstrated without distributing their covers.
 *
 * Usage: node tools/build-pack.mjs [--generated YYYY-MM-DD]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const STUDY = resolve(APP, "..");
const V3 = join(STUDY, "v3");
const PACK = join(APP, "pack");
const ITEMS = join(PACK, "items");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const generated = flag("--generated", new Date().toISOString().slice(0, 10));
const SPINE_W = 104;
const SPINE_H = 472;
const SPINE_ASPECT = SPINE_W / SPINE_H; // 52 / 236

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function probeSize(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    file,
  ]).toString().trim();
  const [width, height] = out.split("x").map(Number);
  if (!width || !height) throw new Error(`Could not read size of ${file}`);
  return { width, height };
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function cropFor(art, focus) {
  const { width: w, height: h } = art;
  // Full-height vertical slice, centred on the focus x. This matches the v3
  // CSS background crop (image height = spine height, horizontal position
  // from focus), but produces a fixed 2x bitmap for the app.
  let cropW = Math.round(h * SPINE_ASPECT);
  let cropH = h;
  if (cropW > w) {
    cropW = w;
    cropH = Math.round(w / SPINE_ASPECT);
  }
  const x = Math.max(0, Math.min(w - cropW, Math.round(focus[0] * w - cropW / 2)));
  const y = Math.max(0, Math.min(h - cropH, Math.round(focus[1] * h - cropH / 2)));
  return { x, y, width: cropW, height: cropH };
}

function normalise(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const titleAuthorKey = (title, author) => `${normalise(title)}|${normalise(author)}`;

function main() {
  const sources = JSON.parse(readFileSync(join(V3, "sources.json"), "utf8")).items;
  rmSync(ITEMS, { recursive: true, force: true });
  mkdirSync(ITEMS, { recursive: true });

  const items = [];
  const byContentHash = {};
  const byIsbn = {};
  const byTitleAuthor = {};

  for (const src of sources) {
    const artPath = join(V3, "art", `${src.slug}-art.jpg`);
    const coverPath = join(V3, "assets", "classic-covers", `${src.slug}.jpg`);
    const isPublicDomain = /^Public domain/i.test(src.artLicense || "");
    const item = {
      id: src.slug,
      slug: src.slug,
      title: src.title,
      author: src.author,
      year: src.year,
      isbn: src.isbn || null,
      method: src.method,
      methodLabel: src.methodLabel,
      status: isPublicDomain ? "available" : "excluded",
      unavailableReason: isPublicDomain ? null : "not-public-domain",
      contentHash: existsSync(coverPath) ? sha256(readFileSync(coverPath)) : null,
      titleAuthorKey: titleAuthorKey(src.title, src.author),
      tone: src.tone,
      meanLum: src.meanLum,
      p95Lum: src.p95Lum,
      railSide: src.railSide,
      focus: src.focus,
      credit: src.credit,
      source: {
        kind: src.method === "original" ? "wikimedia-painting" : src.method === "cover-crop" ? "standard-ebooks" : "edition-cover",
        page: src.paintingUrl || src.sourcePage || null,
        coverPage: src.sourcePage || null,
        credit: src.credit,
        licence: src.artLicense,
        provenance: isPublicDomain
          ? src.method === "original"
            ? "Public-domain painting from Wikimedia Commons; spine slice generated from the focus point at pack build."
            : "Standard Ebooks public-domain cover; the title plate is excluded above the crop. No inpainting."
          : "In-copyright edition cover. Metadata and ISBN only; no pixels are shipped in this pack.",
      },
    };

    if (isPublicDomain) {
      if (!existsSync(artPath)) throw new Error(`Missing art for ${src.slug}: ${artPath}`);
      const art = probeSize(artPath);
      const crop = cropFor(art, src.focus);
      const spineName = `${src.slug}-spine.jpg`;
      const artName = `${src.slug}-art.jpg`;

      // 2x spine bitmap, exactly 104 x 472.
      ffmpeg([
        "-i", artPath,
        "-vf", `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${SPINE_W}:${SPINE_H}:flags=lanczos`,
        "-frames:v", "1", "-q:v", "4",
        join(ITEMS, spineName),
      ]);
      // Detail art, at most 480 x 720.
      ffmpeg([
        "-i", artPath,
        "-vf", "scale=480:720:force_original_aspect_ratio=decrease:flags=lanczos",
        "-frames:v", "1", "-q:v", "5",
        join(ITEMS, artName),
      ]);

      const spineBytes = readFileSync(join(ITEMS, spineName));
      const artBytes = readFileSync(join(ITEMS, artName));
      const artSize = probeSize(join(ITEMS, artName));
      item.assets = {
        spine: {
          path: `items/${spineName}`,
          mime: "image/jpeg",
          sha256: sha256(spineBytes),
          bytes: spineBytes.byteLength,
          width: SPINE_W,
          height: SPINE_H,
          scale: 2,
        },
        art: {
          path: `items/${artName}`,
          mime: "image/jpeg",
          sha256: sha256(artBytes),
          bytes: artBytes.byteLength,
          width: artSize.width,
          height: artSize.height,
        },
      };
      item.crop = { ...crop, sourceWidth: art.width, sourceHeight: art.height };
      item.bytes = spineBytes.byteLength + artBytes.byteLength;
    } else {
      item.assets = null;
      item.bytes = 0;
    }

    items.push(item);
    if (item.contentHash) byContentHash[item.contentHash] = src.slug;
    if (item.isbn) byIsbn[String(item.isbn).replace(/[^0-9Xx]/g, "")] = src.slug;
    byTitleAuthor[item.titleAuthorKey] = src.slug;
  }

  const available = items.filter((i) => i.status === "available");
  const totalAssetBytes = available.reduce((n, i) => n + i.bytes, 0);
  const manifest = {
    schema: "pocketlibrary.textless-art-pack/1",
    pack: {
      id: "textless-classics-pd",
      version: `1.0.${generated.replace(/-/g, "")}`,
      generated,
      title: "Textless classics",
      description:
        "Public-domain cover art for a textless art-only spine. Spine crops are generated at build time; no on-device OCR, masks, inpainting or model weights.",
      licence: "Public domain artwork; Standard Ebooks covers CC0. See per-item provenance.",
      itemCount: items.length,
      availableCount: available.length,
      totalAssetBytes,
      spineSize: { width: SPINE_W, height: SPINE_H, scale: 2 },
      integrity: { algorithm: "sha256", manifestHashIn: "pack-lock.js" },
    },
    index: { byContentHash, byIsbn, byTitleAuthor },
    items,
  };

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(PACK, "manifest.json"), manifestBytes);

  const lock = {
    packId: manifest.pack.id,
    packVersion: manifest.pack.version,
    builtAt: new Date().toISOString(),
    generated,
    manifestSha256: sha256(manifestBytes),
    manifestBytes: manifestBytes.byteLength,
    totalAssetBytes,
    assetCount: available.length * 2,
    spineSize: manifest.pack.spineSize,
  };
  const lockJs = `/* Generated by tools/build-pack.mjs. This is the app-side trust anchor. */\nwindow.TEXTLESS_PACK_LOCK = Object.freeze(${JSON.stringify(lock, null, 2)});\n`;
  writeFileSync(join(APP, "pack-lock.js"), lockJs);

  const catalog = items.map((i) => ({
    id: i.id,
    title: i.title,
    author: i.author,
    isbn: i.isbn,
    contentHash: i.contentHash,
  }));
  const catalogJs = `/* Generated by tools/build-pack.mjs. Library records exist with or without the pack. */\nwindow.TEXTLESS_CATALOG = Object.freeze(${JSON.stringify(catalog, null, 2)});\n`;
  writeFileSync(join(APP, "catalog.js"), catalogJs);

  const packBytes = walkBytes(PACK);
  const summary = {
    generated,
    items: items.length,
    available: available.length,
    excluded: items.length - available.length,
    manifestBytes: manifestBytes.byteLength,
    packBytes,
    packMiB: +(packBytes / 1048576).toFixed(3),
    spineBytes: sum(available.map((i) => i.assets.spine.bytes)),
    artBytes: sum(available.map((i) => i.assets.art.bytes)),
    manifestSha256: lock.manifestSha256,
  };
  writeFileSync(join(APP, "pack-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
function walkBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? walkBytes(p) : statSync(p).size;
  }
  return total;
}

main();
