#!/usr/bin/env node
/*
 * Build the Popular Editions Pack.
 *
 * The pack is data, not a pipeline: textless art + 52x236 and 104x472 spine
 * crops, a manifest with rights/provenance, and SHA-256 for every file. This
 * script reads the throwaway study assets in v7/ and v3/, copies the images into
 * popular-app/pack/files/, derives the two spine sizes with ffmpeg, and writes
 * manifest.json, latest.json, library.json and size.json.
 *
 * Usage (from the repo root):
 *   node .scratch/spine-cover-art-prototype/popular-app/tools/build-pack.mjs
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const ROOT = path.resolve(APP, "..");
const PACK = path.join(APP, "pack");
const FILES = path.join(PACK, "files");

const PACK_ID = "popular-editions";
const PACK_VERSION = "2026.11.26.1";
const PUBLISHED_AT = "2026-11-26T21:30:00Z";

const SPINE_W = 52;
const SPINE_H = 236;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function imageSize(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    file,
  ], { encoding: "utf8" }).trim();
  const [width, height] = out.split("x").map(Number);
  return { width, height };
}

function cropTo(src, dest, width, height) {
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", src,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-frames:v", "1",
    "-q:v", "3",
    dest,
  ]);
}

async function fileRecord(relPath) {
  const abs = path.join(PACK, relPath);
  const buffer = await fs.readFile(abs);
  const { width, height } = imageSize(abs);
  return {
    path: relPath,
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    width,
    height,
    mime: "image/jpeg",
  };
}

/*
 * The four popular editions come from v7. The two public-domain editions come
 * from v3. The content hash is taken from the cover the app would actually
 * ingest, not from the derived spine crop, so ISBN-less editions can still be
 * matched after a file is re-imported.
 */
const EDITIONS = [
  {
    id: "harry-potter",
    source: {
      art: "v7/assets/art/harry-potter.jpg",
      spine: "v7/assets/spine/harry-potter.jpg",
      spine2x: "v7/assets/retina/harry-potter.jpg",
      cover: "v7/assets/source/harry-potter.jpg",
    },
    match: {
      isbn: "9780747532699",
      title: "Harry Potter and the Philosopher's Stone",
      author: "J.K. Rowling",
    },
    edition: {
      title: "Harry Potter and the Philosopher's Stone",
      author: "J.K. Rowling",
      year: 1997,
      publisher: "Bloomsbury (UK)",
      isbn: "9780747532699",
      pages: 223,
      spineMm: 12.35,
      editionNote: "First-edition ISBN; Thomas Taylor artwork with the later 15th-anniversary badge and Smarties band.",
      coverArtist: "Thomas Taylor",
      source: {
        name: "Amazon product image (ISBN-keyed)",
        url: "https://www.amazon.co.uk/dp/0747532699",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "restricted-reference",
        distribution: "restricted",
        holder: "J.K. Rowling / Bloomsbury",
        note: "In copyright. The prototype pack is for local design evaluation only and must not be redistributed or bundled in a release until a licence is obtained.",
        credit: "Cover art © J.K. Rowling / Bloomsbury. Thomas Taylor, 1997.",
        takedown: "Remove this entry from manifest.json and delete its three files. Cached clients fall back to the typographic spine after the next pack refresh.",
      },
    },
    quality: {
      status: "pass",
      score: 20,
      testedAt: "2026-11-26",
      reason: "Pass at spine scale only with a detail crop below the title block; the Hogwarts Express still reads at 52 px.",
      preferredDirection: "hybrid",
      caveat: "Full-cover art rejected; the pack ships the detail crop, not the full reconstruction.",
    },
    design: {
      cloth: "#6e1f3a",
      accent: "#e8c76b",
      tone: "warm",
      focus: [0.36, 0.5],
      lightCloth: false,
      measured: { avg: "#a7676a", dominant: "#7a2040" },
    },
  },
  {
    id: "lord-of-the-rings",
    source: {
      art: "v7/assets/art/lord-of-the-rings.jpg",
      spine: "v7/assets/spine/lord-of-the-rings.jpg",
      spine2x: "v7/assets/retina/lord-of-the-rings.jpg",
      cover: "v7/assets/source/lord-of-the-rings.jpg",
    },
    match: {
      isbn: "9780261103252",
      title: "The Lord of the Rings",
      author: "J.R.R. Tolkien",
    },
    edition: {
      title: "The Lord of the Rings",
      author: "J.R.R. Tolkien",
      year: 1954,
      publisher: "HarperCollins (UK)",
      isbn: "9780261103252",
      pages: 1031,
      spineMm: 52.75,
      editionNote: "One-volume black edition, 2004 (ISBN 9780261103252 / 0261103253).",
      coverArtist: "HarperCollins design after Tolkien's ring inscription",
      source: {
        name: "Amazon product image (ISBN-keyed)",
        url: "https://www.amazon.co.uk/dp/0261103253",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "restricted-reference",
        distribution: "restricted",
        holder: "HarperCollins / The Tolkien Estate",
        note: "In copyright. The prototype pack is for local design evaluation only and must not be redistributed or bundled in a release until a licence is obtained.",
        credit: "Cover design © HarperCollins. Ring inscription after J.R.R. Tolkien.",
        takedown: "Remove this entry from manifest.json and delete its three files. Cached clients fall back to the typographic spine after the next pack refresh.",
      },
    },
    quality: {
      status: "reject",
      score: 17,
      testedAt: "2026-11-26",
      reason: "Rejected at spine scale: a near-black strip with thin red script; the identity was the typography, not the art.",
      preferredDirection: "fallback",
      caveat: "The loader accepts the files but marks the edition rejected. The renderer must not show the art alone.",
    },
    design: {
      cloth: "#141210",
      accent: "#d8452c",
      tone: "dark",
      focus: [0.5, 0.48],
      lightCloth: false,
      measured: { avg: "#412e2a", dominant: "#0e0c0b" },
    },
  },
  {
    id: "the-hobbit",
    source: {
      art: "v7/assets/art/the-hobbit.jpg",
      spine: "v7/assets/spine/the-hobbit.jpg",
      spine2x: "v7/assets/retina/the-hobbit.jpg",
      cover: "v7/assets/source/the-hobbit.jpg",
    },
    match: {
      isbn: "9780261102217",
      title: "The Hobbit",
      author: "J.R.R. Tolkien",
    },
    edition: {
      title: "The Hobbit",
      author: "J.R.R. Tolkien",
      year: 1937,
      publisher: "HarperCollins (UK)",
      isbn: "9780261102217",
      pages: 310,
      spineMm: 16.7,
      editionNote: "HarperCollins black edition, 2009 (ISBN 9780261102217 / 0261102214).",
      coverArtist: "HarperCollins design; mountain/sun motif after Tolkien (artist unconfirmed)",
      source: {
        name: "Amazon product image (ISBN-keyed)",
        url: "https://www.amazon.co.uk/dp/0261102214",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "restricted-reference",
        distribution: "restricted",
        holder: "The Tolkien Estate / HarperCollins",
        note: "In copyright. The prototype pack is for local design evaluation only and must not be redistributed or bundled in a release until a licence is obtained.",
        credit: "Cover art © The Tolkien Estate / HarperCollins.",
        takedown: "Remove this entry from manifest.json and delete its three files. Cached clients fall back to the typographic spine after the next pack refresh.",
      },
    },
    quality: {
      status: "pass",
      score: 22,
      testedAt: "2026-11-26",
      reason: "Pass. The red sun and grey peaks are strong at 52 px; the flat black fill removed the title cleanly.",
      preferredDirection: "hybrid",
      caveat: "The full cover loses faint cloud lines; the spine crop is clean.",
    },
    design: {
      cloth: "#101010",
      accent: "#d92b26",
      tone: "dark",
      focus: [0.5, 0.52],
      lightCloth: false,
      measured: { avg: "#1d1617", dominant: "#050505" },
    },
  },
  {
    id: "the-hunger-games",
    source: {
      art: "v7/assets/art/the-hunger-games.jpg",
      spine: "v7/assets/spine/the-hunger-games.jpg",
      spine2x: "v7/assets/retina/the-hunger-games.jpg",
      cover: "v7/assets/source/the-hunger-games.jpg",
    },
    match: {
      isbn: "9780439023481",
      title: "The Hunger Games",
      author: "Suzanne Collins",
    },
    edition: {
      title: "The Hunger Games",
      author: "Suzanne Collins",
      year: 2008,
      publisher: "Scholastic (US)",
      isbn: "9780439023481",
      pages: 384,
      spineMm: 20.4,
      editionNote: "First US hardcover, 2008 (ISBN 9780439023481).",
      coverArtist: "Tim O'Brien",
      source: {
        name: "Amazon product image (ISBN-keyed)",
        url: "https://www.amazon.co.uk/dp/0439023483",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "restricted-reference",
        distribution: "restricted",
        holder: "Scholastic / Suzanne Collins",
        note: "In copyright. The prototype pack is for local design evaluation only and must not be redistributed or bundled in a release until a licence is obtained.",
        credit: "Cover art © Scholastic. Tim O'Brien, 2008.",
        takedown: "Remove this entry from manifest.json and delete its three files. Cached clients fall back to the typographic spine after the next pack refresh.",
      },
    },
    quality: {
      status: "pass",
      score: 21,
      testedAt: "2026-11-26",
      reason: "Pass. The gold mockingjay pin survives the 52 px crop and carries the identity.",
      preferredDirection: "hybrid",
      caveat: "The title block takes the top target ring with it; the pin still reads.",
    },
    design: {
      cloth: "#1b1a18",
      accent: "#d4ad45",
      tone: "dark",
      focus: [0.46, 0.5],
      lightCloth: false,
      measured: { avg: "#4e443d", dominant: "#151413" },
    },
  },
  {
    id: "moby-dick",
    source: {
      art: "v3/art/moby-dick-art.jpg",
      spine: "v3/crops/moby-dick-spine.jpg",
      cover: "v3/assets/classic-covers/moby-dick.jpg",
    },
    match: {
      isbn: null,
      title: "Moby-Dick",
      author: "Herman Melville",
    },
    edition: {
      title: "Moby-Dick",
      author: "Herman Melville",
      year: 1851,
      publisher: "Standard Ebooks",
      isbn: null,
      pages: 720,
      spineMm: 38.0,
      editionNote: "Standard Ebooks edition; the cover uses a public-domain painting, not the printed title block.",
      coverArtist: "Albert Pinkham Ryder (painting, 1887)",
      source: {
        name: "Standard Ebooks / Wikimedia Commons",
        url: "https://standardebooks.org/ebooks/herman-melville/moby-dick",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "public-domain",
        distribution: "cleared",
        holder: "Public domain",
        note: "The novel and the painting are public domain. Standard Ebooks dedicates its cover work to the public domain.",
        credit: "The Flying Dutchman, Albert Pinkham Ryder (1887). Cover: Standard Ebooks.",
        takedown: "No rights restriction. Replace or remove the entry as a normal catalogue update.",
      },
    },
    quality: {
      status: "pass",
      score: 22,
      testedAt: "2026-11-26",
      reason: "Pass. A genuine textless public-domain painting; no inpainting and no residual type.",
      preferredDirection: "hybrid",
      caveat: "The spine crop is a detail of the painting, not a reconstruction.",
    },
    design: {
      cloth: "#1d2a33",
      accent: "#c9a45c",
      tone: "dark",
      focus: [0.45, 0.5],
      lightCloth: false,
      measured: { avg: "#2b3c45", dominant: "#132028" },
    },
  },
  {
    id: "hound-of-the-baskervilles",
    source: {
      art: "v3/art/hound-of-the-baskervilles-art.jpg",
      spine: "v3/crops/hound-of-the-baskervilles-spine.jpg",
      cover: "v3/assets/classic-covers/hound-of-the-baskervilles.jpg",
    },
    match: {
      isbn: null,
      title: "The Hound of the Baskervilles",
      author: "Arthur Conan Doyle",
    },
    edition: {
      title: "The Hound of the Baskervilles",
      author: "Arthur Conan Doyle",
      year: 1902,
      publisher: "Standard Ebooks",
      isbn: null,
      pages: 256,
      spineMm: 15.0,
      editionNote: "Standard Ebooks edition; the cover uses a public-domain landscape, not the printed title block.",
      coverArtist: "Caspar David Friedrich (painting, 1820)",
      source: {
        name: "Standard Ebooks / Wikimedia Commons",
        url: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-hound-of-the-baskervilles",
        retrieved: "2026-11-26",
      },
      rights: {
        status: "public-domain",
        distribution: "cleared",
        holder: "Public domain",
        note: "The novel and the painting are public domain. Standard Ebooks dedicates its cover work to the public domain.",
        credit: "Riesengebirgslandschaft mit aufsteigendem Nebel, Caspar David Friedrich (1820). Cover: Standard Ebooks.",
        takedown: "No rights restriction. Replace or remove the entry as a normal catalogue update.",
      },
    },
    quality: {
      status: "pass",
      score: 21,
      testedAt: "2026-11-26",
      reason: "Pass. A genuine textless public-domain landscape; the fog and ridge survive at 52 px.",
      preferredDirection: "hybrid",
      caveat: "The spine crop is a detail of the painting, not a reconstruction.",
    },
    design: {
      cloth: "#3b3a33",
      accent: "#b7a06a",
      tone: "light",
      focus: [0.55, 0.5],
      lightCloth: true,
      measured: { avg: "#6f6d63", dominant: "#4a4a44" },
    },
  },
];

const MISSING_EDITION = {
  id: "project-hail-mary",
  spineId: null,
  title: "Project Hail Mary",
  author: "Andy Weir",
  isbn: "9780593135204",
  contentHash: null,
  cloth: "#1b2a3a",
  accent: "#e0b34a",
  tone: "dark",
  focus: [0.5, 0.5],
  lightCloth: false,
  pages: 496,
  note: "Deliberately not in the pack: proves a library book with no matching edition still gets a readable typographic spine.",
};

async function main() {
  await fs.rm(FILES, { recursive: true, force: true });
  await fs.mkdir(path.join(FILES, "art"), { recursive: true });
  await fs.mkdir(path.join(FILES, "spine"), { recursive: true });
  await fs.mkdir(path.join(FILES, "spine-2x"), { recursive: true });

  const entries = [];
  const library = [];

  for (const edition of EDITIONS) {
    const src = (p) => path.join(ROOT, p);
    const artRel = `files/art/${edition.id}.jpg`;
    const spineRel = `files/spine/${edition.id}.jpg`;
    const spine2xRel = `files/spine-2x/${edition.id}.jpg`;

    await fs.copyFile(src(edition.source.art), path.join(PACK, artRel));

    // 1x spine: copy an exact 52x236 crop if the source already has it,
    // otherwise resample the available crop.
    const spineSrc = src(edition.source.spine);
    const spineSize = imageSize(spineSrc);
    if (spineSize.width === SPINE_W && spineSize.height === SPINE_H) {
      await fs.copyFile(spineSrc, path.join(PACK, spineRel));
    } else {
      cropTo(spineSrc, path.join(PACK, spineRel), SPINE_W, SPINE_H);
    }

    // 2x spine: copy an exact 104x472 retina crop, otherwise derive it from
    // the textless art so it is a true 2x asset rather than an upscale.
    if (edition.source.spine2x) {
      const retinaSrc = src(edition.source.spine2x);
      const retinaSize = imageSize(retinaSrc);
      if (retinaSize.width === SPINE_W * 2 && retinaSize.height === SPINE_H * 2) {
        await fs.copyFile(retinaSrc, path.join(PACK, spine2xRel));
      } else {
        cropTo(retinaSrc, path.join(PACK, spine2xRel), SPINE_W * 2, SPINE_H * 2);
      }
    } else {
      cropTo(src(edition.source.art), path.join(PACK, spine2xRel), SPINE_W * 2, SPINE_H * 2);
    }

    const coverBuffer = await fs.readFile(src(edition.source.cover));
    const contentHash = `sha256:${sha256(coverBuffer)}`;

    const files = {
      art: await fileRecord(artRel),
      spine: await fileRecord(spineRel),
      spine2x: await fileRecord(spine2xRel),
    };

    entries.push({
      id: edition.id,
      schema: "pocketlibrary.popular-edition/1",
      match: {
        isbn: edition.match.isbn,
        title: edition.match.title,
        author: edition.match.author,
        contentHash,
        contentHashOf: "source cover image",
      },
      edition: edition.edition,
      quality: edition.quality,
      design: edition.design,
      files,
      render: {
        widthPx: SPINE_W,
        heightPx: SPINE_H,
        retina: 2,
        artKind: "textless-crop",
      },
    });

    library.push({
      id: edition.id,
      spineId: edition.id,
      title: edition.match.title,
      author: edition.match.author,
      isbn: edition.match.isbn,
      contentHash,
      cloth: edition.design.cloth,
      accent: edition.design.accent,
      tone: edition.design.tone,
      focus: edition.design.focus,
      lightCloth: edition.design.lightCloth,
      measured: edition.design.measured,
      pages: edition.edition.pages,
      widthPx: SPINE_W,
      heightPx: SPINE_H,
    });
  }

  library.push(MISSING_EDITION);

  const manifest = {
    schema: "pocketlibrary.popular-editions-pack/1",
    id: PACK_ID,
    name: "Popular Editions Pack",
    version: PACK_VERSION,
    publishedAt: PUBLISHED_AT,
    minAppVersion: "0.1.7",
    description: "Curated textless art and spine crops for popular editions, with per-entry rights and provenance. Data only; no on-device generation.",
    spine: { widthPx: SPINE_W, heightPx: SPINE_H, retina: 2 },
    policy: {
      releaseRequiresClearedRights: true,
      rejectQualityStatus: ["reject"],
      fallback: "typographic-cloth",
      matchingOrder: ["isbn", "contentHash", "title+author"],
    },
    entryCount: entries.length,
    entries,
  };

  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await fs.writeFile(path.join(PACK, "manifest.json"), manifestText);

  const manifestSha256 = sha256(Buffer.from(manifestText));
  const fileList = [];
  for (const entry of entries) {
    for (const kind of ["art", "spine", "spine2x"]) {
      const f = entry.files[kind];
      fileList.push({ path: f.path, sha256: f.sha256, bytes: f.bytes });
    }
  }
  const totalBytes = fileList.reduce((sum, f) => sum + f.bytes, 0)
    + Buffer.byteLength(manifestText);
  const latest = {
    schema: "pocketlibrary.popular-editions-latest/1",
    id: PACK_ID,
    version: PACK_VERSION,
    publishedAt: PUBLISHED_AT,
    manifest: "manifest.json",
    manifestSha256,
    manifestBytes: Buffer.byteLength(manifestText),
    totalBytes,
    fileCount: fileList.length,
    notes: "Atomic update: verify manifestSha256, then each file sha256, then swap the IndexedDB version. Keep the previous version for one rollback.",
  };
  const latestText = JSON.stringify(latest, null, 2) + "\n";
  await fs.writeFile(path.join(PACK, "latest.json"), latestText);

  await fs.writeFile(path.join(APP, "library.json"), JSON.stringify({
    schema: "pocketlibrary.popular-library/1",
    version: PACK_VERSION,
    note: "The app's own catalogue snapshot. It contains a content hash of the source cover for matching, and one deliberate miss (Project Hail Mary).",
    books: library,
  }, null, 2) + "\n");

  const size = {
    packId: PACK_ID,
    version: PACK_VERSION,
    entryCount: entries.length,
    fileCount: fileList.length,
    manifestBytes: Buffer.byteLength(manifestText),
    latestBytes: Buffer.byteLength(latestText),
    assetBytes: totalBytes - Buffer.byteLength(manifestText),
    totalBytes: totalBytes + Buffer.byteLength(latestText),
    totalKiB: Math.round((totalBytes + Buffer.byteLength(latestText)) / 102.4) / 10,
    assets: fileList,
  };
  await fs.writeFile(path.join(PACK, "size.json"), JSON.stringify(size, null, 2) + "\n");

  // A single-file distribution. The gallery loads the directory bundle; the zip
  // is the artefact a real app would download and unpack through Rust.
  const zipPath = path.join(PACK, "popular-editions-pack.zip");
  await fs.rm(zipPath, { force: true });
  execFileSync("python3", ["-c", `
import os, zipfile
base = ${JSON.stringify(PACK)}
out = ${JSON.stringify(zipPath)}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in ["latest.json", "manifest.json", "size.json"]:
        z.write(os.path.join(base, name), name)
    for root, dirs, files in os.walk(os.path.join(base, "files")):
        for f in sorted(files):
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, base))
`], { stdio: "inherit" });
  const zipStat = await fs.stat(zipPath);
  size.zipBytes = zipStat.size;
  size.zipKiB = Math.round(zipStat.size / 102.4) / 10;
  await fs.writeFile(path.join(PACK, "size.json"), JSON.stringify(size, null, 2) + "\n");

  console.log(`Built ${entries.length} editions`);
  console.log(`  files:    ${fileList.length}`);
  console.log(`  bundle:   ${size.totalKiB} KiB (loader downloads manifest + assets)`);
  console.log(`  zip:      ${size.zipKiB} KiB`);
  console.log(`  manifest: ${manifestSha256}`);
  console.log(`  output:   ${path.relative(ROOT, PACK)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
