// Final Art presentation from the real app: no cap band, 27% foot, full
// author over two lines, chips centred below.
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const here = "/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-engine/art-final";
mkdirSync(here, { recursive: true });
const b64 = (p) => "data:image/jpeg;base64," + readFileSync(p).toString("base64");
const art = b64("/tmp/opencode/artifacts/rps/art.jpg");
const strip = b64("/tmp/opencode/artifacts/rps/spine-2x.jpg");

const specs = [
  { id: 1, title: "Rock Paper Scissors", author: "Alice Feeney", labels: 2 },
  { id: 2, title: "The Hollow Crown", author: "A. Very Long Author Name", labels: 1 },
  { id: 3, title: "Dune", author: "Frank Herbert", labels: 0 },
  { id: 4, title: "Anonymous", author: null, labels: 0 },
];
const books = specs.map((spec, index) => ({
  id: spec.id, contentHash: `final-${spec.id}`, format: "epub", title: spec.title,
  authors: spec.author ? [spec.author] : [], series: null, language: "English",
  description: null, publisher: null, publishedDate: null, identifier: null,
  pageCount: 320, addedAt: index + 1, shelfId: 1, slotIndex: index,
  readingStatus: "unread",
  labels: Array.from({ length: spec.labels }, (_, label) => ({
    id: spec.id * 10 + label,
    name: label === 0 ? "Favourite" : "Book club",
    colour: label === 0 ? "#6e2630" : "#214d4c",
    createdAt: 1,
  })),
  spineStyle: "art",
}));
const artifacts = Object.fromEntries(
  books.map((book) => [
    book.id,
    {
      bookId: book.id, route: "inpaint", verdict: "review", maskPercent: 12,
      pagesApproximate: false, cropBox: { x: 0, y: 0, width: 126, height: 570 },
      artDataUrl: art, spineDataUrl: strip, fallbackDataUrl: strip,
      runJson: {}, qaJson: {},
    },
  ]),
);

const browser = await chromium.launch();
const metrics = {};
for (const width of [390, 320]) {
  const page = await browser.newPage({
    viewport: { width, height: 900 }, deviceScaleFactor: 3,
    hasTouch: true, isMobile: true,
  });
  await page.addInitScript(({ books, artifacts }) => {
    window.__POCKETLIBRARY_MOCK__ = {
      state: "ready", folderName: "PocketLibrary", books,
      shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
      spine: { backfillPending: false, queueStartPaused: true, artifacts },
    };
  }, { books, artifacts });
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${here}/wall-${width}.png` });
  metrics[width] = [];
  for (const book of books) {
    const spine = page.locator(
      `[data-testid="spine"][data-book-id="${book.id}"]`,
    );
    await spine.screenshot({ path: `${here}/spine-${book.id}-${width}.png` });
    metrics[width].push(
      await spine.evaluate((element) => {
        const sa = element.querySelector(".spine-band-bottom .sa");
        const band = element.querySelector(".spine-band-bottom");
        const chips = [...element.querySelectorAll(".spine-band-bottom .lb")];
        const frame = element.getBoundingClientRect();
        return {
          book: element.getAttribute("data-book-id"),
          hasTopBand: Boolean(element.querySelector(".spine-band-top")),
          bandRatio: band
            ? Number((band.getBoundingClientRect().height / frame.height).toFixed(3))
            : 0,
          author: sa?.textContent ?? null,
          authorFont: sa ? getComputedStyle(sa).fontSize : null,
          authorLines: sa?.querySelectorAll("span").length ?? 0,
          authorClipped: sa
            ? sa.scrollWidth > sa.clientWidth + 1 ||
              sa.scrollHeight > sa.clientHeight + 1
            : false,
          chips: chips.map((chip) => {
            const style = getComputedStyle(chip);
            return {
              text: chip.textContent,
              font: style.fontSize,
              clipped: chip.scrollWidth > chip.clientWidth + 1,
            };
          }),
        };
      }),
    );
  }
  await page.close();
}
await browser.close();
console.log(JSON.stringify(metrics, null, 2));

writeFileSync(
  resolve(here, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Art spine - final</title>
<style>
:root{color-scheme:dark}body{margin:0;padding:24px;background:#0b0710;color:#e8dcc2;font:16px/1.5 Georgia,serif}
h1{font-size:24px;letter-spacing:.12em;text-transform:uppercase;color:#e8cf9b;margin:0 0 6px}
h2{font-size:16px;color:#e8cf9b;margin:18px 0 8px}
p{color:#b9a37c;margin:0 0 16px;max-width:860px}
.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0;text-align:center}img{height:520px;border:1px solid rgba(201,168,106,.2)}
.wall{width:min(390px,100%);border:1px solid rgba(201,168,106,.2)}
figcaption{font:11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8f7c5b;margin-top:8px}
</style></head><body>
<h1>Art: no cap bar, full author on two lines</h1>
<p>The shipped presentation: the art runs to the top edge, the foot is 27% with the full author over two lines and the label chips centred beneath.</p>
<h2>390 px</h2>
<div class="row">
${books
  .map(
    (book) =>
      `<figure><img src="spine-${book.id}-390.png" alt=""><figcaption>${book.title}</figcaption></figure>`,
  )
  .join("\n")}
</div>
<h2>320 px</h2>
<div class="row">
${books
  .map(
    (book) =>
      `<figure><img src="spine-${book.id}-320.png" alt=""><figcaption>${book.title}</figcaption></figure>`,
  )
  .join("\n")}
</div>
<h2>Wall, 390 px</h2>
<figure><img class="wall" src="wall-390.png" alt=""><figcaption>Shelf</figcaption></figure>
</body></html>`,
);
console.log("gallery", resolve(here, "index.html"));
