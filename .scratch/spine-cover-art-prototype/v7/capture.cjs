/**
 * Capture + audit the v7 popular-cover spine study.
 * Run from the repo root:
 *   node .scratch/spine-cover-art-prototype/v7/capture.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.resolve(process.cwd(), "node_modules/playwright"));

const URL = "http://127.0.0.1:4173/spine-cover-art-prototype/v7/";
const OUT = path.join(__dirname, "screenshots");
const AUDIT = path.join(__dirname, "audit.json");
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [390, 360, 320];

async function settle(page) {
  await page.evaluate(async () => {
    await window.PocketV7.ready;
    await document.fonts.ready;
  });
  await page.waitForTimeout(220);
}

async function hideDock(page) {
  await page.addStyleTag({ content: ".study-dock,.study-dock__spacer{display:none!important}" });
}

async function auditPage(page) {
  return page.evaluate(() => {
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
    const clips = [];
    $$(".spine__title, .spine__author").forEach((t) => {
      const sp = t.closest(".spine");
      if (!sp) return;
      const tr = t.getBoundingClientRect();
      const sr = sp.getBoundingClientRect();
      const tol = 0.8;
      const clipped = tr.left < sr.left - tol || tr.right > sr.right + tol ||
        tr.top < sr.top - tol || tr.bottom > sr.bottom + tol;
      if (clipped) clips.push({ text: t.textContent, spine: sp.getAttribute("aria-label"), rect: [tr.left, tr.top, tr.right, tr.bottom], spineRect: [sr.left, sr.top, sr.right, sr.bottom] });
    });
    const imgs = $$("img").map((img) => ({
      src: img.getAttribute("src"),
      complete: img.complete,
      natural: [img.naturalWidth, img.naturalHeight],
      displayed: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)],
    }));
    const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const uiOverflow = [];
    $$(".console, .shelf, .case, .detail, .system, .footer").forEach((n) => {
      if (n.scrollWidth > n.clientWidth + 1) uiOverflow.push({ cls: n.className, scroll: n.scrollWidth, client: n.clientWidth });
    });
    return {
      state: window.PocketV7.getState(),
      audit: window.PocketV7.getAudit(),
      clips,
      overflowX,
      uiOverflow,
      imgs,
      fonts: document.fonts.status,
      cards: $$(".case").length,
    };
  });
}

async function shot(page, name, fullPage) {
  await page.screenshot({ path: path.join(OUT, name), fullPage: !!fullPage });
}

async function shotEl(page, sel, name) {
  await page.locator(sel).screenshot({ path: path.join(OUT, name) });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const audit = { url: URL, captured: new Date().toISOString(), widths: {}, passes: [] };
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ width, text: m.text() }); });
    page.on("pageerror", (e) => pageErrors.push({ width, text: e.message }));
    page.on("requestfailed", (r) => failedRequests.push({ width, url: r.url(), error: r.failure() && r.failure().errorText }));

    await page.goto(URL, { waitUntil: "networkidle" });
    await settle(page);
    await hideDock(page);

    if (width === 390) {
      await shot(page, "00-hero-390.png");
      await shotEl(page, "#shelves", "01-shelf-hybrid-390.png");
      await shotEl(page, '.case[data-id="1"]', "02-case-harry-potter-390.png");
      await shotEl(page, "#detail", "03-detail-hybrid-390.png");
      await page.evaluate(() => window.PocketV7.setFilter("reject"));
      await page.waitForTimeout(200);
      await shotEl(page, "#shelves", "04-shelf-rejected-390.png");
      await shotEl(page, '.case[data-id="2"]', "05-case-lotr-390.png");
      await page.evaluate(() => window.PocketV7.setFilter("pass"));
      await page.waitForTimeout(200);
      await shotEl(page, "#shelves", "06-shelf-pass-390.png");
      await page.evaluate(() => window.PocketV7.setFilter("all"));
      await page.evaluate(() => window.PocketV7.setDirection("editorial"));
      await page.waitForTimeout(200);
      await shotEl(page, "#shelves", "07-shelf-editorial-390.png");
      await page.evaluate(() => window.PocketV7.setRail(false));
      await page.waitForTimeout(200);
      await shotEl(page, "#shelves", "08-shelf-art-only-390.png");
      await page.evaluate(() => { window.PocketV7.setRail(true); window.PocketV7.setDirection("hybrid"); });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.PocketV7.selectBook(2));
      await page.waitForTimeout(200);
      await shotEl(page, "#detail", "09-detail-lotr-390.png");
      await page.evaluate(() => { window.PocketV7.selectBook(1); window.PocketV7.setLight("lamp"); });
      await page.waitForTimeout(200);
      await shotEl(page, "#shelves", "10-shelf-lamp-390.png");
      await page.evaluate(() => window.PocketV7.setLight("gallery"));
      await page.waitForTimeout(200);
      await shotEl(page, ".system", "13-system-390.png");
      await page.evaluate(() => window.PocketV7.selectBook(3));
      await page.waitForTimeout(200);
      await shotEl(page, "#detail", "14-detail-hobbit-390.png");
      await page.evaluate(() => window.PocketV7.selectBook(1));
      await page.waitForTimeout(150);
      await shot(page, "11-full-390.png", true);
      const cardAudit = await auditPage(page);
      audit.widths[390] = cardAudit;
      audit.passes.push({ width: 390, check: "load", ...cardAudit.audit });
    }

    if (width !== 390) {
      await shotEl(page, "#shelves", `20-shelf-hybrid-${width}.png`);
      await shot(page, `21-full-${width}.png`, true);
      audit.widths[width] = await auditPage(page);
    }

    await page.close();
  }

  // mode checks: filters, rail off, editorial at 320
  {
    const page = await browser.newPage({ viewport: { width: 320, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: "networkidle" });
    await settle(page);
    await hideDock(page);
    audit.modes = [];
    for (const [dir, rail, filter] of [["hybrid", true, "all"], ["editorial", true, "all"], ["hybrid", false, "all"], ["hybrid", true, "reject"], ["editorial", false, "pass"]]) {
      await page.evaluate(([d, r, f]) => { window.PocketV7.setDirection(d); window.PocketV7.setRail(r); window.PocketV7.setFilter(f); }, [dir, rail, filter]);
      await page.waitForTimeout(160);
      const m = await page.evaluate(() => {
        const visible = (t) => t.getClientRects().length > 0;
        const clips = Array.from(document.querySelectorAll(".spine__title,.spine__author")).filter(visible).filter((t) => {
          const sp = t.closest(".spine");
          const a = t.getBoundingClientRect();
          const b = sp.getBoundingClientRect();
          return a.left < b.left - 0.8 || a.right > b.right + 0.8 || a.top < b.top - 0.8 || a.bottom > b.bottom + 0.8;
        }).length;
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clips,
          shelves: document.querySelectorAll(".shelf").length,
          cards: document.querySelectorAll(".case").length,
          pass: window.PocketV7.getAudit().pass,
          reject: window.PocketV7.getAudit().reject,
        };
      });
      audit.modes.push({ width: 320, dir, rail, filter, ...m });
    }
    await page.close();
  }

  // actual-size preview and docks at 390
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: "networkidle" });
    await settle(page);
    await hideDock(page);
    await page.evaluate(() => window.PocketV7.selectBook(1));
    await page.waitForTimeout(150);
    await page.locator("#detail [data-actual]").click();
    await page.waitForTimeout(200);
    await shotEl(page, "#detail", "12-detail-actual-390.png");
    audit.passes.push({ width: 390, check: "actual-size", state: await page.evaluate(() => window.PocketV7.getState()) });
    await page.close();
  }

  audit.consoleErrors = consoleErrors;
  audit.pageErrors = pageErrors;
  audit.failedRequests = failedRequests;
  fs.writeFileSync(AUDIT, JSON.stringify(audit, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    widths: Object.fromEntries(Object.entries(audit.widths).map(([w, v]) => [w, {
      overflowX: v.overflowX, clips: v.clips.length, cards: v.cards, uiOverflow: v.uiOverflow.length,
      fonts: v.fonts, pass: v.audit.pass, reject: v.audit.reject,
    }])),
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    failedRequests: failedRequests.length,
  }, null, 2));
})();
