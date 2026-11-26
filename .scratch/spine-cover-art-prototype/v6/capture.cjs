/**
 * Capture + audit the v6 spine study.
 * Run from the repo root:
 *   node .scratch/spine-cover-art-prototype/v6/capture.cjs
 * Playwright is resolved from the repo's existing node_modules.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.resolve(process.cwd(), "node_modules/playwright"));

const URL = "http://127.0.0.1:4173/spine-cover-art-prototype/v6/";
const OUT = path.join(__dirname, "screenshots");
const AUDIT = path.join(__dirname, "audit.json");
fs.mkdirSync(OUT, { recursive: true });

const DIRECTIONS = ["editorial", "cloth", "hybrid"];
const WIDTHS = [390, 360, 320];

async function settle(page) {
  await page.evaluate(async () => {
    await window.PocketV6.ready;
    await document.fonts.ready;
  });
  await page.waitForTimeout(180);
}

async function auditPage(page) {
  return page.evaluate(() => {
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const titleClips = [];
    $$(".spine__title, .spine__author").forEach((t) => {
      const sp = t.closest(".spine");
      if (!sp) return;
      const tr = t.getBoundingClientRect();
      const sr = sp.getBoundingClientRect();
      const tol = 0.8;
      const clipped = tr.left < sr.left - tol || tr.right > sr.right + tol ||
        tr.top < sr.top - tol || tr.bottom > sr.bottom + tol;
      if (clipped) titleClips.push({ text: t.textContent, spine: sp.getAttribute("aria-label"), rect: [tr.left, tr.top, tr.right, tr.bottom], spineRect: [sr.left, sr.top, sr.right, sr.bottom] });
    });
    const overflowEls = [];
    $$(".console, .detail__inner, .detail__title, .dir__text b, .seg__btn, .shelf__no, .shelf__meta, .fitline, .system__grid, .verdict, .verdict__modes, .shelf-legend, .footer").forEach((n) => {
      if (n.scrollWidth > n.clientWidth + 1) {
        overflowEls.push({ cls: n.className, text: (n.textContent || "").trim().slice(0, 50), sw: n.scrollWidth, cw: n.clientWidth });
      }
    });
    const m = window.PocketV6.getAudit();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      titleClips,
      overflowEls,
      shelves: $$(".shelf").length,
      shelfSizes: $$(".shelf").map((s) => s.querySelectorAll(".spine").length),
      spines: $$(".shelf .spine").length,
      fonts: document.fonts.status,
      fontChecks: {
        inter: document.fonts.check('500 10px "Inter"'),
        cormorant: document.fonts.check('600 10px "Cormorant Garamond"'),
        garamond: document.fonts.check('400 10px "EB Garamond"'),
        literata: document.fonts.check('400 10px "Literata"'),
      },
      metrics: m.metrics,
      tightest: m.tightest,
      smallestFont: m.smallestFont,
      lowContrast: m.lowContrast,
      artless: $$(".shelf .spine.is-artless").length,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const assetResponses = [];
  const audit = { url: URL, generated: new Date().toISOString(), passes: [], interactions: {}, screenshots: [] };
  let seq = 1;

  async function newPage(width) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("response", (r) => {
      const u = r.url();
      if (u.includes("/v6/") && /\.(jpg|jpeg|png|woff2|css|js)$/.test(u)) {
        const rec = { status: r.status(), file: u.split("/v6/")[1] || u };
        assetResponses.push(rec);
        if (r.status() >= 400) failedRequests.push(rec);
      }
    });
    await page.goto(URL, { waitUntil: "networkidle" });
    await settle(page);
    return page;
  }

  async function shot(page, name, locator) {
    const file = path.join(OUT, name);
    if (locator) await page.locator(locator).first().screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: true });
    audit.screenshots.push(path.relative(__dirname, file));
  }

  /* 1. width × direction passes */
  for (const width of WIDTHS) {
    const page = await newPage(width);
    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, "00-hero-390.png") });
      audit.screenshots.push("screenshots/00-hero-390.png");
    }
    for (const dir of DIRECTIONS) {
      await page.evaluate((d) => window.PocketV6.setDirection(d), dir);
      await page.waitForTimeout(220);
      const a = await auditPage(page);
      audit.passes.push({ width, direction: dir, ...a });
      await shot(page, `${String(seq++).padStart(2, "0")}-shelf-${dir}-${width}.png`, ".shelf");
    }
    await page.evaluate(() => window.PocketV6.setDirection("hybrid"));
    await page.waitForTimeout(200);
    await shot(page, `${String(seq++).padStart(2, "0")}-full-${width}.png`);
    await page.close();
  }

  /* 2. interaction pass at 390 */
  const page = await newPage(390);
  await shot(page, "20-shelf-editorial-390.png", ".shelf");
  await page.evaluate(() => window.PocketV6.setDirection("cloth"));
  await page.waitForTimeout(200);
  await shot(page, "21-shelf-cloth-390.png", ".shelf");
  await page.evaluate(() => window.PocketV6.setDirection("hybrid"));
  await page.waitForTimeout(200);
  await shot(page, "22-shelf-hybrid-390.png", ".shelf");
  await shot(page, "23-shelves-hybrid-390.png", ".shelf-zone");

  // detail previews
  for (const dir of DIRECTIONS) {
    await page.evaluate((d) => window.PocketV6.setDirection(d), dir);
    await page.evaluate(() => window.PocketV6.selectBook(1));
    await page.waitForTimeout(180);
    await shot(page, `24-detail-${dir}-390.png`, ".detail");
  }
  await page.evaluate(() => window.PocketV6.setDirection("cloth"));
  await page.waitForTimeout(150);
  await page.locator("[data-actual]").click();
  await page.waitForTimeout(150);
  await shot(page, "25-detail-actual-size-390.png", ".detail");
  audit.interactions.actualSize = await page.evaluate(() => window.PocketV6.getState().actual);

  // rail off
  await page.evaluate(() => { window.PocketV6.setRail(false); window.PocketV6.setDirection("editorial"); window.PocketV6.selectBook(1); });
  await page.waitForTimeout(180);
  await shot(page, "26-rail-off-390.png", ".shelf");
  audit.interactions.railOff = await page.evaluate(() => ({ state: window.PocketV6.getState(), audit: window.PocketV6.getAudit() }));

  // material off + lighting
  await page.evaluate(() => { window.PocketV6.setRail(true); window.PocketV6.setDirection("hybrid"); window.PocketV6.setMaterial(false); });
  await page.waitForTimeout(180);
  await shot(page, "27-material-off-390.png", ".shelf");
  audit.interactions.materialOff = await page.evaluate(() => window.PocketV6.getState());

  await page.evaluate(() => window.PocketV6.setMaterial(true));
  for (const light of ["lamp", "dusk"]) {
    await page.evaluate((l) => window.PocketV6.setLight(l), light);
    await page.waitForTimeout(160);
    await shot(page, `28-light-${light}-390.png`, ".shelf");
    audit.interactions[`light-${light}`] = await page.evaluate(() => window.PocketV6.getState());
  }
  await page.evaluate(() => window.PocketV6.setLight("gallery"));

  // provenance filters
  for (const filter of ["reconstructed", "fallback"]) {
    await page.evaluate((f) => window.PocketV6.setFilter(f), filter);
    await page.waitForTimeout(200);
    const a = await auditPage(page);
    audit.interactions[`filter-${filter}`] = { shelves: a.shelves, spines: a.spines, shelfSizes: a.shelfSizes, overflow: a.overflow, titleClips: a.titleClips };
    await shot(page, `29-filter-${filter}-390.png`, ".shelf-zone");
  }
  await page.evaluate(() => window.PocketV6.setFilter("all"));
  await page.waitForTimeout(160);
  await page.evaluate(() => { window.PocketV6.selectBook(21); window.PocketV6.setDirection("hybrid"); });
  await page.waitForTimeout(200);
  await shot(page, "30-fallback-detail-390.png", ".detail");

  /* 3. selected long-title spines at 320, actual size detail */
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => { window.PocketV6.setDirection("cloth"); window.PocketV6.selectBook(13); });
  await page.waitForTimeout(250);
  const narrow = await auditPage(page);
  audit.passes.push({ width: 320, direction: "cloth-long-title", ...narrow });
  await shot(page, "31-long-title-cloth-320.png", ".detail");

  audit.consoleErrors = consoleErrors;
  audit.pageErrors = pageErrors;
  audit.failedRequests = failedRequests;
  audit.assetResponses = assetResponses;
  audit.assetSummary = {
    assets: new Set(assetResponses.map((r) => r.file)).size,
    failures: failedRequests.length,
  };

  await page.close();
  await browser.close();

  fs.writeFileSync(AUDIT, JSON.stringify(audit, null, 2));
  console.log(`Captured ${audit.screenshots.length} screenshots.`);
  console.log(`Passes: ${audit.passes.length}; console errors: ${consoleErrors.length}; page errors: ${pageErrors.length}; failed requests: ${failedRequests.length}`);
  for (const p of audit.passes) {
    console.log(`${p.width}px ${p.direction}: shelves ${p.shelfSizes.join("/")} · overflow ${p.overflow} · clips ${p.titleClips.length} · tightest ${(p.tightest * 100).toFixed(1)}% · min ${p.smallestFont.toFixed(2)}px · low contrast ${p.lowContrast}`);
  }
})().catch((err) => { console.error(err); process.exit(1); });
