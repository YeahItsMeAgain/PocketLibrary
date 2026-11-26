// Throwaway capture + audit script for the v3 spine prototype.
// Run from the repo root:
//   node .scratch/spine-cover-art-prototype/v3/capture.cjs
// Expects the .scratch folder to be served at http://127.0.0.1:4173/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype/v3/";
const OUT = path.join(__dirname, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const audit = { widths: {}, interactions: {}, images: {}, errors: [] };

(async () => {
  const browser = await chromium.launch();

  async function makePage(width) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push("console: " + msg.text()); });
    page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
    page.on("requestfailed", (req) => errors.push("requestfailed: " + req.url()));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    return { page, errors };
  }

  async function shot(page, selector, file) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await target.screenshot({ path: path.join(OUT, file) });
  }

  async function selectFilm(page, index) {
    await page.locator(".film-item").nth(index).click();
    await page.waitForTimeout(450);
  }

  // ---- 390: reference width ------------------------------------------------
  {
    const { page, errors } = await makePage(390);
    await page.screenshot({ path: path.join(OUT, "01-hero-390.png") });
    await shot(page, ".case:nth-of-type(1)", "02-shelf-art-390.png");
    await shot(page, ".case:nth-of-type(3)", "03-shelf-classics-390.png");
    await shot(page, ".case:nth-of-type(4)", "04-new-arrivals-390.png");

    await page.locator("#rail-on").click();
    await page.waitForTimeout(350);
    await shot(page, ".case:nth-of-type(1)", "05-shelf-rail-390.png");
    await shot(page, ".case:nth-of-type(4)", "06-new-arrivals-rail-390.png");

    // compare: a classic, the pass, the failure
    await selectFilm(page, 0);
    await shot(page, "#compare", "07-compare-classic-390.png");
    await selectFilm(page, 18);
    await shot(page, "#compare", "08-compare-whisper-390.png");
    await selectFilm(page, 19);
    await shot(page, "#compare", "09-compare-rps-390.png");

    // detail sheets
    await page.locator("#compare-detail").click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, "10-detail-rps-390.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.locator("#rail-on").click();
    await page.waitForTimeout(300);
    await page.locator("#shelves .spine").first().click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, "11-detail-art-390.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);

    await shot(page, "#research", "12-research-390.png");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, "13-full-390.png"), fullPage: true });

    const widthAudit = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      const titles = [...document.querySelectorAll("#shelves .spine-title")];
      const imgs = [...document.images];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: cw,
        spines: document.querySelectorAll("#shelves .spine").length,
        clippedTitles: titles.filter((t) => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent),
        images: imgs.map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight })),
        overflowers: [...document.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > cw + 1 || r.left < -1; }).slice(0, 8).map((el) => ({ tag: el.tagName, cls: el.className })),
        rail: document.documentElement.dataset.rail,
        cropPct: document.querySelector(".metrics dd").textContent.trim(),
      };
    });
    audit.widths[390] = widthAudit;
    audit.errors.push(...errors);
    await page.close();
  }

  // ---- 360 / 320: overflow, title integrity -------------------------------
  for (const width of [360, 320]) {
    const { page, errors } = await makePage(width);
    const shellAudit = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: cw,
        spines: document.querySelectorAll("#shelves .spine").length,
        rail: document.documentElement.dataset.rail,
      };
    });
    await page.screenshot({ path: path.join(OUT, `14-hero-${width}.png`) });
    await shot(page, ".case:nth-of-type(1)", `15-shelf-art-${width}.png`);
    await shot(page, ".case:nth-of-type(4)", `16-new-arrivals-${width}.png`);
    await page.locator("#rail-on").click();
    await page.waitForTimeout(350);
    await shot(page, ".case:nth-of-type(1)", `17-shelf-rail-${width}.png`);
    const railAudit = await page.evaluate(() => {
      const titles = [...document.querySelectorAll("#shelves .spine-title")];
      return {
        clippedTitles: titles.filter((t) => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent),
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    await selectFilm(page, 19);
    await shot(page, "#compare", `18-compare-rps-${width}.png`);
    await page.locator("#compare-detail").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `19-detail-rps-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    audit.widths[width] = { ...shellAudit, rail: railAudit };
    audit.errors.push(...errors);
    await page.close();
  }

  // ---- interaction / accessibility regression ----------------------------
  {
    const { page, errors } = await makePage(390);
    await page.locator("#rail-on").click();
    await page.waitForTimeout(300);
    const railOn = await page.evaluate(() => ({
      rail: document.documentElement.dataset.rail,
      pressedOn: document.getElementById("rail-on").getAttribute("aria-pressed"),
      pressedOff: document.getElementById("rail-off").getAttribute("aria-pressed"),
    }));
    await page.locator("#rail-off").click();
    await page.waitForTimeout(250);
    await page.locator(".film-item").nth(5).click();
    await page.waitForTimeout(300);
    const selected = await page.evaluate(() => ({
      title: document.querySelector(".compare-title h3").textContent,
      pressed: document.querySelector('.film-item[aria-pressed="true"]').getAttribute("aria-label"),
    }));
    await page.locator("#shelves .spine").first().click();
    await page.waitForTimeout(400);
    const open = await page.evaluate(() => ({
      sheetOpen: !document.getElementById("sheet-layer").hidden,
      title: document.getElementById("sheet-title").textContent,
      focus: document.activeElement.id,
      bodyOverflow: document.body.style.overflow,
    }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => ({
      sheetHidden: document.getElementById("sheet-layer").hidden,
      bodyOverflow: document.body.style.overflow,
    }));
    await page.locator(".film-item").nth(19).click();
    await page.waitForTimeout(300);
    const rps = await page.evaluate(() => ({
      title: document.querySelector(".compare-title h3").textContent,
      audit: document.querySelector(".audit").textContent.trim(),
      mask: [...document.querySelectorAll(".metrics dd")].map((d) => d.textContent.trim()),
    }));
    audit.interactions = { railOn, selected, open, closed, rps };
    audit.errors.push(...errors);
    await page.close();
  }

  // ---- image integrity ----------------------------------------------------
  {
    const { page, errors } = await makePage(390);
    audit.images = await page.evaluate(() => {
      const bad = [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src);
      return { total: document.images.length, bad };
    });
    audit.errors.push(...errors);
    await page.close();
  }

  await browser.close();
  const uniqueErrors = [...new Set(audit.errors)];
  audit.errors = uniqueErrors;
  fs.writeFileSync(path.join(__dirname, "audit.json"), JSON.stringify(audit, null, 2));
  const overflow = Object.entries(audit.widths).filter(([, v]) => v.scrollWidth > v.clientWidth || v.bodyScrollWidth > v.clientWidth);
  console.log("OVERFLOW:", overflow.length ? JSON.stringify(overflow) : "none");
  console.log("CLIPPED TITLES:", JSON.stringify(Object.fromEntries(Object.entries(audit.widths).map(([w, v]) => [w, v.clippedTitles || v.rail?.clippedTitles || []]))));
  console.log("IMAGES:", JSON.stringify(audit.images));
  console.log("ERRORS:", uniqueErrors.length ? uniqueErrors.join(" | ") : "none");
})();
