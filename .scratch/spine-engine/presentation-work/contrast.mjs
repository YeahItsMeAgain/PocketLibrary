import { chromium } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const phase = process.env.PHASE ?? "after";
const out = resolve(here, `${phase}-contrast`);
mkdirSync(out, { recursive: true });

const dataUrl = (p, mime = "image/jpeg") =>
  `data:${mime};base64,${readFileSync(p).toString("base64")}`;
const A = "/tmp/opencode/artifacts";

function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported png color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[src + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels
          ? pixels[(y - 1) * stride + x - channels]
          : 0;
      let result;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          result = value + predictor;
          break;
        }
        default:
          throw new Error(`bad filter ${filter}`);
      }
      pixels[y * stride + x] = result & 255;
    }
    src += stride;
  }
  return { width, height, channels, data: pixels };
}

const lum = ([r, g, b]) => {
  const channel = (part) => {
    const value = part / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (left, right) => {
  const a = lum(left);
  const b = lum(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const books = [
  ["Rock Paper Scissors", "Alice Feeney", "rps"],
  ["The Picture of Dorian Gray", "Oscar Wilde", "dorian"],
].map(([title, author, key], index) => ({
  id: index + 1,
  contentHash: `contrast-${key}`,
  format: "epub",
  title,
  authors: [author],
  series: null,
  language: "English",
  description: null,
  publisher: null,
  publishedDate: null,
  identifier: null,
  pageCount: 320,
  addedAt: 1,
  shelfId: 1,
  slotIndex: index,
  readingStatus: "unread",
  labels: [],
  spineStyle: "wrap",
}));
const artifacts = Object.fromEntries(
  books.map((book, index) => [
    book.id,
    {
      bookId: book.id,
      route: "crop",
      verdict: "pass",
      maskPercent: 0,
      pagesApproximate: false,
      cropBox: { x: 1, y: 0, width: 52, height: 236 },
      artDataUrl: dataUrl(`${A}/${index === 0 ? "rps" : "dorian"}/art.jpg`),
      spineDataUrl: dataUrl(
        `${A}/${index === 0 ? "rps" : "dorian"}/spine-2x.jpg`,
      ),
      fallbackDataUrl: dataUrl(
        `${A}/${index === 0 ? "rps" : "dorian"}/spine-2x.jpg`,
      ),
      runJson: {},
      qaJson: {},
    },
  ]),
);
const config = {
  state: "ready",
  folderName: "PocketLibrary",
  books,
  shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
  spine: { backfillPending: false, queueStartPaused: true, artifacts },
};

const browser = await chromium.launch();
const results = { phase, widths: {} };
for (const width of [390, 320]) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    window.__POCKETLIBRARY_MOCK__ = seed;
    window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
  }, config);
  await page.goto("http://localhost:1420/");
  await page.getByTestId("library-wall").waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll("img.spine-generated").length === 2,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(900);
  results.widths[width] = {};

  for (const [index, title] of [
    "Rock Paper Scissors",
    "The Picture of Dorian Gray",
  ].entries()) {
    const spine = page.getByTestId("spine").nth(index);
    const style = await spine.evaluate((element) => {
      const st = element.querySelector(".st");
      const sa = element.querySelector(".sa");
      return {
        ink: st ? getComputedStyle(st).color : null,
        stroke: st
          ? getComputedStyle(st).getPropertyValue("-webkit-text-stroke")
          : null,
        authorInk: sa ? getComputedStyle(sa).color : null,
      };
    });
    const box = await spine.boundingBox();
    if (!box) continue;
    const withTextBuffer = await page.screenshot({
      path: resolve(out, `${phase}-${index === 0 ? "rps" : "dorian"}-${width}.png`),
      clip: box,
    });
    await spine.evaluate((element) => {
      element
        .querySelectorAll(".st")
        .forEach((node) => (node.style.visibility = "hidden"));
    });
    const behind = await page.screenshot({ clip: box });
    await spine.evaluate((element) => {
      element
        .querySelectorAll(".st")
        .forEach((node) => {
          node.style.visibility = "";
          node.style.color = "transparent";
          node.style.textShadow = "none";
        });
    });
    const haloOnly = await page.screenshot({ clip: box });
    await spine.evaluate((element) => {
      element.querySelectorAll(".st").forEach((node) => {
        node.style.color = "";
        node.style.textShadow = "";
      });
    });
    const withText = decodePng(withTextBuffer);
    const withoutText = decodePng(behind);
    const halo = decodePng(haloOnly);
    const pixelsOf = (image, offset) => [
      image.data[offset],
      image.data[offset + 1],
      image.data[offset + 2],
    ];
    const fillSamples = [];
    const haloArtSamples = [];
    const rawArtSamples = [];
    for (let y = 0; y < withText.height; y += 1) {
      for (let x = 0; x < withText.width; x += 1) {
        const offset = (y * withText.width + x) * withText.channels;
        const a = pixelsOf(withText, offset);
        const b = pixelsOf(withoutText, offset);
        const c = pixelsOf(halo, offset);
        const fillDelta = Math.max(
          Math.abs(a[0] - c[0]),
          Math.abs(a[1] - c[1]),
          Math.abs(a[2] - c[2]),
        );
        const haloDelta = Math.max(
          Math.abs(c[0] - b[0]),
          Math.abs(c[1] - b[1]),
          Math.abs(c[2] - b[2]),
        );
        const rawDelta = Math.max(
          Math.abs(a[0] - b[0]),
          Math.abs(a[1] - b[1]),
          Math.abs(a[2] - b[2]),
        );
        if (fillDelta >= 150) fillSamples.push(contrast(a, c));
        if (haloDelta >= 80) haloArtSamples.push(contrast(c, b));
        if (rawDelta >= 150) rawArtSamples.push(contrast(a, b));
      }
    }
    const stats = (values) => {
      const sorted = [...values].sort((left, right) => left - right);
      const at = (fraction) =>
        sorted[Math.floor(sorted.length * fraction)] ?? 0;
      return {
        pixels: sorted.length,
        min: +at(0).toFixed(2),
        p10: +at(0.1).toFixed(2),
        median: +at(0.5).toFixed(2),
      };
    };
    results.widths[width][index === 0 ? "rps" : "dorian"] = {
      title,
      ...style,
      fillVsHalo: stats(fillSamples),
      haloVsArt: stats(haloArtSamples),
      rawInkVsArt: stats(rawArtSamples),
    };
  }
  await context.close();
}
await browser.close();
writeFileSync(resolve(out, "report.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
