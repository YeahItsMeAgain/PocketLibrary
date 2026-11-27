#!/usr/bin/env node
/* Turn measurements.json into report.json + report.md. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..");
const data = JSON.parse(fs.readFileSync(path.join(dir, "measurements.json"), "utf8"));
const tlPath = path.join(dir, "textless-measurements.json");
const tl = fs.existsSync(tlPath) ? JSON.parse(fs.readFileSync(tlPath, "utf8")) : { results: { books: [] } };
const tlBySlug = new Map(tl.results.books.map((b) => [b.slug, b]));
const evDir = path.resolve(dir, "..", "evidence");

const MANUAL = JSON.parse(fs.readFileSync(path.join(dir, "tools", "manual-notes.json"), "utf8"));

const STYLE_ORDER = ["wrap", "hybrid", "fullbleed", "artonly", "cloth", "editorial"];
const STYLE_NAME = {
  wrap: "Wrap", hybrid: "Hybrid", fullbleed: "Full-bleed",
  artonly: "Textless", cloth: "Cloth", editorial: "Editorial",
};

const books = data.results.books.map((b) => {
  const m = MANUAL.books[b.slug] || {};
  const styles = {};
  for (const s of STYLE_ORDER) {
    const raw = b.styles[s];
    styles[s] = {
      rendered: raw.rendered,
      titlePx: raw.titlePx,
      effectiveTitlePx33: raw.effectiveTitlePx33,
      fitRatio: raw.fitRatio,
      contrast: raw.contrast,
      flags: raw.flags,
      measured: raw.verdict,
      verdict: (m.styles && m.styles[s]) || raw.verdict,
      lumaStd: raw.lumaStd,
      localContrast: raw.localContrast ?? null,
      cropDelta: raw.cropDelta ?? null,
    };
  }
  return {
    slug: b.slug,
    title: b.title,
    pages: b.pages,
    route: b.route,
    pipelineVerdict: b.verdict,
    wrap: {
      spinePx: b.wrap.spinePx,
      spineMm: b.wrap.spineMm,
      sheetCss: b.wrap.sheetCssW + "x" + b.wrap.sheetCssH,
      seam: b.wrap.seam,
      shipVerdict: m.wrapVerdict,
      note: m.wrapNote,
    },
    styles,
  };
});

const summary = MANUAL.summary;

/* ---------- follow-up: post-removal inputs, panels, textless variant ------ */

const PANELS = [
  ["Front", "source.jpg — the published cover", "renderer.js:569–586 · const simg = book._img.source || art", "The only panel drawn from the original cover. May still contain printed text; spec.md:180 requires it."],
  ["Spine", "art.jpg at final.crop_box_work", "renderer.js:564 · drawArt() → artCropRect() → book._img.art", "Post-removal for inpaint; original cover for crop. Text-free on all six."],
  ["Back", "art.jpg, blurred to 24×34", "renderer.js:549–561 · const art = book._img.art || book._img.source", "Post-removal for inpaint; original cover for crop. Deliberately blurred."],
];

const inputs = data.results.books.map((b) => {
  const t = tlBySlug.get(b.slug) || {};
  const qa = JSON.parse(fs.readFileSync(path.join(evDir, b.slug, "qa.json"), "utf8"));
  const artOcr = qa.qa.chosen.art_residual_ocr || [];
  const qaLine = qa.decision.verdict + " · crop mask " +
    Number(qa.qa.chosen.crop_mask_coverage_pct).toFixed(1) + "% · art OCR " +
    (artOcr.length ? artOcr.map((o) => '"' + o.text + '" ' + o.conf.toFixed(2)).join(", ") : "[]");
  return {
    slug: b.slug,
    title: b.title,
    route: b.route,
    verdict: b.verdict,
    artSha256: b.artSha256,
    sourceSha256: b.sourceSha256,
    artIsSource: b.artIsSource,
    qaJson: qaLine,
    printedTextInArt: b.artIsSource ? "yes — printed text remains outside the crop" : "no — removed by MI-GAN",
    removal: b.artIsSource
      ? "none — crop route returns the original cover"
      : "MI-GAN inpaint output",
    frontPanelDiff: t.frontPanelDiff ?? null,
    spinePanelDiff: t.spinePanelDiff ?? null,
    backPanelDiff: t.backPanelDiff ?? null,
    spineLocalContrast: t.spineContrast ? t.spineContrast.localContrast : null,
  };
});

const followUp = {
  question: "Was the wrap tested after the generative model removed the text?",
  inputs,
  panels: PANELS.map(([panel, src, code, note]) => ({ panel, source: src, code, note })),
  variant: {
    renderer: "renderWrapTextless(): book._img.source is swapped to book._img.art for the draw only; renderer code unchanged",
    screenshots: ["textless-shot-390.png", "textless-shot-320.png", "textless-large-wrap-sheet.png"],
    measurement: "textless-measurements.json",
    books: inputs.map((b) => ({
      slug: b.slug,
      frontPanelDiff: b.frontPanelDiff,
      spinePanelDiff: b.spinePanelDiff,
      backPanelDiff: b.backPanelDiff,
      spineLocalContrast: b.spineLocalContrast,
    })),
  },
  answers: {
    inputs: summary.followUp.inputsConclusion,
    panels: summary.followUp.panelConclusion,
    warOfTheWorlds: summary.followUp.wotw,
    dune: summary.followUp.dune,
    verdict: summary.followUp.verdict,
  },
};

let followUpMd = `## Follow-up: was the wrap tested after the text was removed?

Short answer: **yes for the spine and the back, no for the front — until this variant.** Both panels
that carry the art spine were already drawn from the engine's \`art.jpg\`. The front is drawn from the
published \`source.jpg\` by design.

### 1. Input proof — what was rendered, and whether removal happened

\`art.jpg\` is the engine's working art; \`source.jpg\` is the working copy of the published cover.
Full SHA-256 of the bytes actually rendered:

| Book | run.json route | verdict | qa.json | art.jpg SHA-256 | art == source | art.jpg is… | Printed text in art? |
|---|---|---|---|---|---|---|---|
`;
for (const b of inputs) {
  followUpMd += `| ${b.title} | ${b.route} | ${b.verdict} | ${b.qaJson} | \`${b.artSha256}\` | ${b.artIsSource ? "**yes**" : "no"} | ${b.removal} | ${b.printedTextInArt} |\n`;
}
followUpMd += `\n${summary.followUp.inputsConclusion}\n\n### 2. What each Wrap panel uses (verified in code)\n\n| Panel | Source | Code | Note |\n|---|---|---|---|\n`;
for (const p of followUp.panels) followUpMd += `| ${p.panel} | ${p.source} | \`${p.code}\` | ${p.note} |\n`;
followUpMd += `\n${summary.followUp.panelConclusion}\n\n### 3. Textless-wrap variant\n\n` +
`Same \`renderWrap\` geometry and typography; the front reference is swapped to \`art.jpg\` for the draw\n` +
`only (\`renderWrapTextless\`). Screenshots: \`textless-shot-390.png\`, \`textless-shot-320.png\`, \`textless-large-wrap-sheet.png\`.\n\n` +
`| Book | Front panel Δ vs shipped | Spine Δ | Back Δ | Spine local contrast | What changed |\n|---|---:|---:|---:|---:|---|\n`;
for (const b of inputs) {
  let what;
  if (b.artIsSource) what = "Nothing — crop route, art.jpg is the same bytes";
  else if (b.slug === "the-war-of-the-worlds") what = "Front loses its title; MI-GAN patch visible; spine identical";
  else if (b.slug === "rock-paper-scissors") what = "Front becomes blank snow; title survives only on the spine";
  else what = "Front loses title/author; art intact";
  followUpMd += `| ${b.title} | ${b.frontPanelDiff} | ${b.spinePanelDiff} | ${b.backPanelDiff} | ${b.spineLocalContrast} | ${what} |\n`;
}
followUpMd += `\nA zero spine Δ means the pixels are identical: only the front panel changes, and only on the\ninpaint books. Backs are also unchanged. Spine local contrast repeats within ±0.05 between runs\nbecause the renderer's paper grain is random; the War of the Worlds value is 1.01 in both.\n\n### 4. Corrected answer for the two named cases\n\n` +
`**The War of the Worlds — still fails, and it is typography, not leftover text.** ${summary.followUp.wotw}\n\n` +
`**Dune — still shows the giant letterforms.** ${summary.followUp.dune}\n\n` +
`**Distinction.** Leftover cover text/art = pixels already in \`art.jpg\` (Dune's \`DUNE\`, the WotW MI-GAN patch).\n` +
`Renderer typography = the cream \`THE WAR OF THE WORLDS\` set by \`renderWrap\` on the spine. The WotW\n` +
`failure is the second; Dune's is the first.\n\n### 5. Verdict\n\n${summary.followUp.verdict}\n`;


const report = {
  generated: data.captured,
  harness: {
    page: "index.html",
    sheetsPage: "wrap-sheets.html",
    tile: data.results.tile,
    dpr: data.results.dpr,
    renderer: ".scratch/spine-cover-art-prototype/app-renderers/renderer/renderer.js (verbatim, internal export hook only)",
    inputs: ".scratch/spine-engine/evidence/<slug>/{art.jpg,source.jpg,spine-2x.jpg,run.json,qa.json}",
    screenshots: ["shot-390.png", "shot-320.png", "large-wrap-sheet.png", "textless-shot-390.png", "textless-shot-320.png", "textless-large-wrap-sheet.png"],
    consoleErrors: data.errors,
  },
  followUp,
  broken: summary.broken,
  answers: {
    wrapShipDefault: summary.wrapShipDefault,
    wrapShipReason: summary.wrapShipReason,
    saferAlternates: summary.saferAlternates,
    biggestProblem: summary.biggestProblem,
    perBook: summary.perBook,
  },
  books,
};

fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");

/* ---------- markdown ------------------------------------------------------ */

const yes = (b) => (b ? "yes" : "no");
function fmt(v, d = 2) { return v == null ? "—" : Number(v).toFixed(d); }

let md = `# Wrap check — real engine evidence, six styles

Throwaway harness under \`.scratch/spine-engine/wrap-check/\`. Every tile is drawn by the
proven prototype renderer (\`app-renderers/renderer/renderer.js\`, reused verbatim) from the
real \`spine/\` host run: \`art.jpg\` + \`final.crop_box_work\` from \`run.json\`, front from the
evidence \`source.jpg\`.

- Grid tile: **52 × 236 px**. Wrap is the wrap sheet's spine column at its real page-count width
  (11–33 px), centred in the slot — not stretched.
- Shelf strip: **33 × 236 px** slot with the wrap spine drawn to fill it, the way a fixed shelf slot would.
- Wrap sheets: **338–360 × 236** CSS px, rendered at 4× in \`large-wrap-sheet.png\`.
- Screenshots: \`shot-390.png\`, \`shot-320.png\`, \`large-wrap-sheet.png\`; variant: \`textless-shot-390.png\`, \`textless-shot-320.png\`, \`textless-large-wrap-sheet.png\`.
- Console errors: ${data.errors.length ? data.errors.join("; ") : "none"}.

${followUpMd}

## Answer

**Does Wrap look good enough to ship as the default for these six books? — ${summary.wrapShipDefault ? "Yes" : "No / with exceptions"}.**

${summary.wrapShipReason}

**Safer alternates for the review cases.** ${summary.saferAlternates}

**Single biggest visual problem.** ${summary.biggestProblem}

## Per-book Wrap verdict

| Book | Route / QA | Native spine | Fold Δ back / front | Wrap verdict | Note |
|---|---|---:|---:|---|---|
`;
for (const b of books) {
  const s = b.wrap.seam;
  md += `| ${b.title} | ${b.route} / ${b.pipelineVerdict} | ${b.wrap.spinePx} px · ${b.wrap.spineMm} mm | ${fmt(s.backFoldDelta, 1)} (${s.backFold}) / ${fmt(s.frontFoldDelta, 1)} (${s.frontFold}) | **${b.wrap.shipVerdict}** | ${b.wrap.note} |\n`;
}

md += `\n## What looks broken

${summary.broken.map((b) => "- " + b).join("\n")}

## All six styles, measured

Ratios: \`fit\` is the renderer's own limiting ratio (line length or thickness / box; > 1 means
it overflowed at the minimum size). Contrast is the renderer's ink-vs-field WCAG ratio.
\`33 px\` is the effective title size at the 33 px shelf slot.

| Book | Style | Rendered | Title px | 33 px | fit | Contrast | Local | Flags | Verdict |
|---|---|:--:|---:|---:|---:|---:|---:|---|---|
`;
for (const b of books) {
  for (const s of STYLE_ORDER) {
    const v = b.styles[s];
    md += `| ${b.title} | ${STYLE_NAME[s]} | ${yes(v.rendered)} | ${fmt(v.titlePx, 1)} | ${fmt(v.effectiveTitlePx33, 1)} | ${fmt(v.fitRatio, 2)} | ${v.contrast == null ? "—" : fmt(v.contrast, 1)} | ${v.localContrast == null ? "—" : fmt(v.localContrast, 2)} | ${v.flags.join(", ") || "—"} | ${v.verdict} |\n`;
  }
}

md += `\n## What the screenshots show

${summary.screenshots}

## Method notes

- Wrap canvas is \`wrapGeometry(pages)\`: 6 × 9 in trim, 0.100 mm/leaf, 1.2 mm cover allowance,
  clamped spine 10–40 px at 236 px height. Front is the published cover; back is the blurred
  v8 art plus the vellum card; spine is the text-free crop.
- The 52 px comparison tile crops the wrap sheet's spine column and centres it at its real
  page-count width (11–33 px) in the 52 px slot. The 33 px shelf strip instead stretches that
  spine to fill the slot, which is how a fixed-width shelf tile would draw it.
- \`crop-mismatch\` compares the type-free art tile against the pipeline's own \`spine-2x.jpg\`
  (mean abs RGB diff, central 84%). It flags a renderer that picks a different window than
  \`final.crop_box_work\`; no book tripped it (2.6–4.9).
- Seam deltas compare the median per-row RGB difference of columns 2 px either side of each
  fold: < 20 subtle, 20–35 visible, > 35 strong. Back folds are expected to be visible because
  the back panel is deliberately blurred; the front fold is the continuity test.
- Measurements come from \`measurements.json\`, captured in headless Chromium at 390 and 320 px.
`;

fs.writeFileSync(path.join(dir, "report.md"), md);
console.log("wrote report.json and report.md");
