// Prototype: Art spine with the cap band removed and the full author name in
// the foot band. Renders current vs variant from the real app UI.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = "/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-engine/art-variants";
mkdirSync(here, { recursive: true });
const b64 = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const art = b64("/tmp/opencode/artifacts/rps/art.jpg");
const strip = b64("/tmp/opencode/artifacts/rps/spine-2x.jpg");

const book = {
  id: 1, contentHash: "variant", format: "epub", title: "Rock Paper Scissors",
  authors: ["Alice Feeney"], series: null, language: "English", description: null,
  publisher: null, publishedDate: null, identifier: null, pageCount: 320,
  addedAt: 1, shelfId: 1, slotIndex: 0, readingStatus: "unread",
  labels: [
    { id: 1, name: "Favourite", colour: "#6e2630", createdAt: 1 },
    { id: 2, name: "Book club", colour: "#214d4c", createdAt: 1 },
  ],
  spineStyle: "art",
};
const artifacts = {
  1: {
    bookId: 1, route: "inpaint", verdict: "review", maskPercent: 12,
    pagesApproximate: false, cropBox: { x: 0, y: 0, width: 126, height: 570 },
    artDataUrl: art, spineDataUrl: strip, fallbackDataUrl: strip,
    runJson: {}, qaJson: {},
  },
};

const TWO_LINE_CSS = `
.spine.variant3 .spine-band-top { display: none !important; }
.spine.variant3 .spine-generated {
  top: 0 !important;
  height: calc(100% - var(--band-bottom, 27%)) !important;
}
.spine.variant3 .spine-band-bottom {
  height: var(--band-bottom, 27%) !important;
  padding: 4px 1px 6px !important;
  gap: 9px !important;
  justify-content: center !important;
}
.spine.variant3 .spine-band-bottom .sa {
  display: block !important;
  width: 100% !important;
  max-height: none !important;
  overflow: visible !important;
  font-size: 6.8px !important;
  line-height: 1.02 !important;
  letter-spacing: 0.02em !important;
  text-align: center !important;
  white-space: normal !important;
  text-overflow: clip !important;
}
.spine.variant3 .spine-band-bottom .sa span { display: block; }

.spine.variant3 .spine-text.is-band-layout { top: 3px !important; }
`;
const NO_BAND_CSS = `
.spine.variant2 .spine-band-top { display: none !important; }
.spine.variant2 .spine-generated {
  top: 0 !important;
  height: 100% !important;
}
.spine.variant2 .spine-band-bottom {
  background: none !important;
  border-top: 0 !important;
  box-shadow: none !important;
}
.spine.variant2 .spine-band-bottom .sa {
  width: 100% !important;
  max-height: none !important;
  overflow: visible !important;
  font-size: 4.2px !important;
  letter-spacing: 0.02em !important;
  text-overflow: clip !important;
  text-align: center !important;
  color: var(--spine-ink, #e8d4a6) !important;
  -webkit-text-stroke: 0.35px var(--spine-halo, #000) !important;
  text-shadow: 0 0 2px var(--spine-halo, #000), 0 1px 1px var(--spine-halo, #000) !important;
  white-space: nowrap !important;
}
.spine.variant2 .spine-text.is-band-layout { top: 3px !important; }
`;
const VARIANT_CSS = `
.spine.variant .spine-band-top { display: none !important; }
.spine.variant .spine-generated {
  top: 0 !important;
  height: calc(100% - var(--band-bottom, 22%)) !important;
}
.spine.variant .spine-text.is-band-layout { top: 3px !important; }
.spine.variant .spine-band-bottom .sa {
  font-size: 4.6px !important;
  letter-spacing: 0.02em !important;
  white-space: nowrap !important;
}
`;

const browser = await chromium.launch();
const shots = {};
for (const width of [390, 320]) {
  const page = await browser.newPage({
    viewport: { width, height: 900 }, deviceScaleFactor: 3,
    hasTouch: true, isMobile: true,
  });
  await page.addInitScript(({ book, artifacts }) => {
    window.__POCKETLIBRARY_MOCK__ = {
      state: "ready", folderName: "PocketLibrary", books: [book],
      shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
      spine: { backfillPending: false, queueStartPaused: true, artifacts },
    };
  }, { book, artifacts });
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForTimeout(700);
  await page.locator('[data-testid="spine"]').screenshot({ path: `${here}/current-${width}.png` });

  await page.addStyleTag({ content: VARIANT_CSS });
  await page.evaluate(() => {
    const spine = document.querySelector('[data-testid="spine"]');
    spine.classList.add("variant");
    const sa = spine.querySelector(".sa");
    if (sa) sa.textContent = "Alice Feeney";
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="spine"]').screenshot({ path: `${here}/no-cap-full-author-${width}.png` });
  await page.screenshot({ path: `${here}/wall-no-cap-full-author-${width}.png` });

  // Third variant: no cap bar, no dark foot band, full author over the art.
  await page.addStyleTag({ content: NO_BAND_CSS });
  await page.evaluate(() => {
    const spine = document.querySelector('[data-testid="spine"]');
    spine.classList.remove("variant");
    spine.classList.add("variant2");
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="spine"]').screenshot({ path: `${here}/no-cap-no-band-full-author-${width}.png` });
  await page.screenshot({ path: `${here}/wall-no-cap-no-band-full-author-${width}.png` });

  // Fourth variant: no cap, taller dark foot, full author on two lines.
  await page.addStyleTag({ content: TWO_LINE_CSS });
  await page.evaluate(() => {
    const spine = document.querySelector('[data-testid="spine"]');
    spine.classList.remove("variant2");
    spine.classList.add("variant3");
    spine.style.setProperty("--band-bottom", "27%");
    const sa = spine.querySelector(".sa");
    const words = "Alice Feeney".split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    sa.textContent = "";
    for (const chunk of [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]) {
      const line = document.createElement("span");
      line.textContent = chunk;
      sa.appendChild(line);
    }
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="spine"]').screenshot({ path: `${here}/no-cap-two-line-author-${width}.png` });

  await page.evaluate(() => {
    const spine = document.querySelector('[data-testid="spine"]');
    const sa = spine.querySelector(".sa");
    sa.style.setProperty("font-size", "4.2px", "important");
    const words = "A. Very Long Author Name".split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    sa.textContent = "";
    for (const chunk of [words.slice(0, mid).join(" "), words.slice(mid).join(" ")]) {
      const line = document.createElement("span");
      line.textContent = chunk;
      sa.appendChild(line);
    }
    window.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="spine"]').screenshot({ path: `${here}/no-cap-two-line-long-author-${width}.png` });

  shots[width] = await page.evaluate(() => {
    const spine = document.querySelector('[data-testid="spine"]');
    const band = spine.querySelector(".spine-band-bottom").getBoundingClientRect();
    const sa = spine.querySelector(".sa");
    const sr = sa.getBoundingClientRect();
    return {
      spineH: spine.getBoundingClientRect().height,
      bandH: band.height,
      author: sa.textContent,
      authorW: sr.width,
      bandW: band.width,
      authorFont: getComputedStyle(sa).fontSize,
    };
  });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(shots, null, 2));

writeFileSync(
  resolve(here, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Art spine - cap bar removed, full author</title>
<style>
:root{color-scheme:dark}body{margin:0;padding:24px;background:#0b0710;color:#e8dcc2;font:16px/1.5 Georgia,serif}
h1{font-size:24px;letter-spacing:.12em;text-transform:uppercase;color:#e8cf9b;margin:0 0 6px}
h2{font-size:16px;color:#e8cf9b;margin:18px 0 8px}
p{color:#b9a37c;margin:0 0 16px;max-width:820px}
.row{display:flex;gap:28px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0;text-align:center}img{height:520px;border:1px solid rgba(201,168,106,.2)}
figcaption{font:11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8f7c5b;margin-top:8px}
code{color:#e8cf9b}
</style></head><body>
<h1>Art: remove the cap bar, full author in the foot</h1>
<p>Same generated strip; the 9% top band is gone and the foot band shows the full author name instead of the surname. The third column also removes the dark band behind the author, so the author sits on the art with the same adaptive ink as the title; only the label chips keep their colour.</p>
<h2>390 px</h2>
<div class="row">
  <figure><img src="current-390.png" alt=""><figcaption>Current</figcaption></figure>
  <figure><img src="no-cap-full-author-390.png" alt=""><figcaption>No cap + full author</figcaption></figure>
  <figure><img src="no-cap-no-band-full-author-390.png" alt=""><figcaption>No cap, no dark band, full author</figcaption></figure>
  <figure><img src="no-cap-two-line-author-390.png" alt=""><figcaption>No cap, two-line author, taller band</figcaption></figure>
  <figure><img src="no-cap-two-line-long-author-390.png" alt=""><figcaption>Same, long author</figcaption></figure>
</div>
<h2>320 px</h2>
<div class="row">
  <figure><img src="current-320.png" alt=""><figcaption>Current</figcaption></figure>
  <figure><img src="no-cap-full-author-320.png" alt=""><figcaption>No cap + full author</figcaption></figure>
  <figure><img src="no-cap-no-band-full-author-320.png" alt=""><figcaption>No cap, no dark band, full author</figcaption></figure>
  <figure><img src="no-cap-two-line-author-320.png" alt=""><figcaption>No cap, two-line author, taller band</figcaption></figure>
  <figure><img src="no-cap-two-line-long-author-320.png" alt=""><figcaption>Same, long author</figcaption></figure>
</div>
</body></html>`,
);
console.log("gallery", resolve(here, "index.html"));
