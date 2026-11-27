// Renders a review gallery of the four spine styles from the real app UI and
// the real engine art. Run with the dev server on :1420.
//
//   node .scratch/spine-engine/spines-preview/render.mjs
//
// It writes PNGs next to this script plus index.html, served by the static
// server under /spine-engine/spines-preview/.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "shots");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const ART = "/tmp/opencode/artifacts";
const b64 = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const art = Object.fromEntries(
  ["rps", "dorian", "alice", "cover"].map((key) => [
    key,
    {
      art: b64(`${ART}/${key}/art.jpg`),
      spine: b64(`${ART}/${key}/spine-2x.jpg`),
      fallback: b64(`${ART}/${key}/fallback-spine.jpg`),
    },
  ]),
);

const books = [
  { key: "rps", title: "Rock Paper Scissors", author: "Alice Feeney", style: "art", pages: 320, labels: [
    { id: 1, name: "Favourite", colour: "#6e2630", createdAt: 1 },
    { id: 2, name: "Book club", colour: "#214d4c", createdAt: 1 },
  ] },
  { key: "rps", title: "Rock Paper Scissors", author: "Alice Feeney", style: "cloth", pages: 320 },
  { key: "rps", title: "Rock Paper Scissors", author: "Alice Feeney", style: "typography", pages: 320 },
  { key: "dorian", title: "The Picture of Dorian Gray", author: "Oscar Wilde", style: "art", pages: 288, labels: [
    { id: 3, name: "Classics", colour: "#3b4d6b", createdAt: 1 },
  ] },
  { key: "alice", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll", style: "art", pages: 200 },
  { key: "cover", title: "The Extraordinarily Long and Unabridged Chronicle of the Lighthouse Keeper's Daughter", author: "A. Very Long Author Name", style: "art", pages: 520 },
  { key: "dorian", title: "Dune", author: "Frank Herbert", style: "art", pages: 412 },
];

function mockBooks() {
  return books.map((b, i) => ({
    id: i + 1,
    contentHash: `preview-${i}`,
    format: "epub",
    title: b.title,
    authors: [b.author],
    series: null,
    language: "English",
    description: null,
    publisher: null,
    publishedDate: null,
    identifier: null,
    pageCount: b.pages,
    addedAt: 1,
    shelfId: 1,
    slotIndex: i,
    readingStatus: "unread",
    labels: b.labels ?? [],
    spineStyle: b.style,
  }));
}

function mockArtifacts() {
  return Object.fromEntries(
    books.map((b, i) => [
      i + 1,
      {
        bookId: i + 1,
        route: b.key === "rps" ? "inpaint" : "crop",
        verdict: "review",
        maskPercent: 12,
        pagesApproximate: false,
        cropBox: { x: 0, y: 0, width: 126, height: 570 },
        artDataUrl: art[b.key].art,
        spineDataUrl: art[b.key].spine,
        fallbackDataUrl: art[b.key].fallback,
        runJson: {},
        qaJson: {},
      },
    ]),
  );
}

const browser = await chromium.launch();
for (const width of [390, 320]) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  await page.addInitScript(
    ({ books: list, artifacts }) => {
      window.__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: list,
        shelves: [{ id: 1, ordinal: 0, capacity: 16 }],
        spine: { backfillPending: false, queueStartPaused: true, artifacts },
      };
    },
    { books: mockBooks(), artifacts: mockArtifacts() },
  );
  page.on('pageerror', (error) => console.error('PAGEERROR', error));
  page.on('console', (message) => { if (message.type() === 'error') console.error('CONSOLE', message.text()); });
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(out, `shelf-${width}.png`) });

  for (const style of ["art", "cloth", "typography"]) {
    const index = books.findIndex((b) => b.style === style);
    if (index < 0) continue;
    await page
      .locator(`[data-testid="spine"][data-book-id="${index + 1}"]`)
      .screenshot({ path: resolve(out, `spine-${style}-${width}.png`) });
  }
  // The dark-art and long-title Art spines, so the bands and fitted type can
  // be judged without hunting through the shelf.
  const darkIndex = books.findIndex(
    (b) => b.style === "art" && b.key === "dorian",
  );
  if (darkIndex >= 0) {
    await page
      .locator(`[data-testid="spine"][data-book-id="${darkIndex + 1}"]`)
      .screenshot({ path: resolve(out, `spine-art-dark-${width}.png`) });
  }
  const longIndex = books.findIndex(
    (b) => b.style === "art" && b.title.startsWith("The Extraordinarily"),
  );
  if (longIndex >= 0) {
    await page
      .locator(`[data-testid="spine"][data-book-id="${longIndex + 1}"]`)
      .screenshot({ path: resolve(out, `spine-art-long-${width}.png`) });
  }
  // The picker: open the first book, Edit, scroll to the Spine section.
  await page.locator('[data-testid="spine"][data-book-id="1"]').click();
  await page.getByTestId("book-detail").waitFor();
  await page.getByTestId("detail-edit").click();
  await page.getByTestId("edit-book").waitFor();
  await page.getByTestId("spine-style-grid").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(out, `picker-${width}.png`) });
  for (const style of ["art", "cloth", "typography"]) {
    const tile = page.getByTestId(`spine-style-${style}`);
    if (await tile.count()) {
      await tile.click();
      await page.waitForTimeout(450);
      await page.screenshot({ path: resolve(out, `preview-${style}-${width}.png`) });
    }
  }
  await page.close();
}
await browser.close();

const styleNotes = {
  art: ["Art", "Generated art cropped between a cap band and a foot band for the author and labels."],
  cloth: ["Cloth", "No art. Woven cloth board with foil type."],
  typography: ["Typography", "No art. The original flat board and typographic face."],
};

const styles = ["art", "cloth", "typography"];
const cards = styles
  .map(
    (style) => `
    <section class="card">
      <h2>${styleNotes[style][0]}</h2>
      <p>${styleNotes[style][1]}</p>
      <div class="row">
        <figure><img src="shots/spine-${style}-390.png" alt=""><figcaption>Spine at 390px shelf</figcaption></figure>
        <figure><img src="shots/spine-${style}-320.png" alt=""><figcaption>Spine at 320px shelf</figcaption></figure>
        <figure><img src="shots/preview-${style}-390.png" alt=""><figcaption>Edit preview</figcaption></figure>
      </div>
    </section>`,
  )
  .join("");

writeFileSync(
  resolve(here, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PocketLibrary — spine styles, pre-APK review</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0b0710; color:#e8dcc2; font:16px/1.5 Georgia,serif; }
  h1 { font-size:26px; letter-spacing:.14em; text-transform:uppercase; color:#e8cf9b; margin:0 0 6px; }
  h2 { font-size:18px; color:#e8cf9b; margin:0 0 2px; letter-spacing:.08em; }
  p { margin:0 0 14px; color:#b9a37c; }
  .lede { max-width:760px; margin-bottom:22px; }
  .card { border:1px solid rgba(201,168,106,.28); background:rgba(255,255,255,.02); padding:18px; margin:0 0 18px; }
  .row { display:flex; gap:18px; overflow-x:auto; align-items:flex-start; }
  figure { margin:0; flex:0 0 auto; }
  figure img { height:420px; width:auto; display:block; border:1px solid rgba(201,168,106,.18); background:#120b18; }
  figcaption { font:11px/1.4 system-ui,sans-serif; letter-spacing:.08em; text-transform:uppercase; color:#8f7c5b; margin-top:6px; }
  .shelves { display:flex; gap:18px; flex-wrap:wrap; margin-bottom:22px; }
  .shelves img { width:100%; max-width:390px; border:1px solid rgba(201,168,106,.18); }
  .note { border-left:2px solid #8a6f3a; padding-left:12px; color:#b9a37c; max-width:760px; }
  code, a { color:#e8cf9b; }
  a { text-underline-offset: 2px; }
</style></head>
<body>
  <h1>Spine styles — pre-APK review</h1>
  <p class="lede">Rendered from the real app UI with real engine art. Nothing here is a mockup. The first four spines use the same cover so you can compare the treatments directly.</p>
  <div class="shelves">
    <figure><img src="shots/shelf-390.png" alt=""><figcaption>Wall at 390px</figcaption></figure>
    <figure><img src="shots/shelf-320.png" alt=""><figcaption>Wall at 320px</figcaption></figure>
  </div>
  ${cards}
  <p class="note">Compare against the original studies: <a href="/spine-cover-art-prototype/">the prototype index</a> (v4-wrap, v4-generative, v8-auto, app-renderers). These are the reference for the original look, not the current app.</p>
  <p class="note">If any of these are wrong, say which style and what you want changed — this page is the approval gate before the APK.</p>
</body></html>`,
);
console.log("gallery written to", resolve(here, "index.html"));
