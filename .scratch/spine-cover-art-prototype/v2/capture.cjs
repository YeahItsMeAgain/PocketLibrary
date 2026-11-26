// Throwaway capture + audit script for the v2 spine prototype.
// Run from the repo root:
//   node .scratch/spine-cover-art-prototype/v2/capture.cjs
// Expects the .scratch folder to be served at http://127.0.0.1:4173/.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:4173/spine-cover-art-prototype/v2/";
const OUT = path.join(__dirname, "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const audit = { widths: {}, interactions: {}, errors: [] };

(async () => {
  const browser = await chromium.launch();

  async function makePage(width) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
    });
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push("console: " + msg.text());
    });
    page.on("pageerror", (err) => errors.push("pageerror: " + err.message));
    page.on("requestfailed", (req) => errors.push("requestfailed: " + req.url()));
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    return { page, errors };
  }

  async function scrollTo(page, selector, offset = 10) {
    await page.evaluate(({ selector, offset }) => {
      const el = document.querySelector(selector);
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - offset), behavior: "instant" });
    }, { selector, offset });
    await page.waitForTimeout(300);
  }

  async function clipShot(page, selector, file) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await target.screenshot({ path: path.join(OUT, file) });
  }

  // ---- 390: the reference width ----------------------------------------
  {
    const { page, errors } = await makePage(390);
    await page.screenshot({ path: path.join(OUT, "01-hero-390.png") });

    const widthAudit = await page.evaluate(() => {
      const titles = [...document.querySelectorAll("#shelves .spine-title")];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        spines: document.querySelectorAll("#shelves .spine").length,
        clippedTitles: titles.filter((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map((t) => t.textContent),
        filmstrip: (() => {
          const r = document.querySelector(".filmstrip").getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right) };
        })(),
        cropPct: document.querySelector(".stats dd").textContent.trim(),
        sw: getComputedStyle(document.documentElement).getPropertyValue("--sw"),
        auto: [...document.querySelectorAll('#shelves .spine[data-auto="true"]')].map((s) => {
          const r = s.getBoundingClientRect();
          return {
            id: s.dataset.bookId,
            width: Math.round(r.width),
            height: Math.round(r.height),
            topCap: getComputedStyle(s).getPropertyValue("--toph"),
            band: getComputedStyle(s).getPropertyValue("--bandh"),
            status: s.dataset.autoStatus,
            title: s.querySelector(".spine-title").textContent,
          };
        }),
      };
    });

    await clipShot(page, ".case:nth-of-type(1)", "02-shelf-high-390.png");
    await clipShot(page, ".case:nth-of-type(3)", "03-shelf-hound-390.png");
    await clipShot(page, ".case:nth-of-type(4)", "14-shelf-auto-390.png");
    await page.locator("#auto").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator("#auto").screenshot({ path: path.join(OUT, "15-auto-section-390.png") });

    await page.locator('[data-auto-select="19"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "16-compare-whisper-390.png") });
    await page.locator('[data-auto-select="20"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "17-compare-rps-390.png") });
    await page.locator("#compare-detail").click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, "18-detail-rps-390.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.locator('.film-item[data-book-id="4"]').click();
    await page.waitForTimeout(350);

    await scrollTo(page, "#compare", 12);
    await page.screenshot({ path: path.join(OUT, "04-compare-high-390.png") });

    // vellum fallback detail
    await page.locator('#shelves .spine[data-book-id="13"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "05-detail-hound-390.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // old-style shelf and compare
    await page.locator("#mode-old").click();
    await page.waitForTimeout(350);
    await scrollTo(page, ".case:nth-of-type(1)", 10);
    await page.screenshot({ path: path.join(OUT, "06-shelf-old-390.png") });
    await scrollTo(page, "#compare", 12);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "07-compare-old-390.png") });
    const oldAudit = await page.evaluate(() => ({
      cropPct: document.querySelector(".stats dd").textContent.trim(),
      riskDots: [...document.querySelectorAll('#shelves .spine[data-risk="1"] .risk-dot')].map((d) => getComputedStyle(d).display),
      oldSource: getComputedStyle(document.querySelector(".spine-art")).backgroundImage.includes("/covers/old/"),
      scrollWidth: document.documentElement.scrollWidth,
    }));

    // full-page reference in high mode
    await page.locator("#mode-high").click();
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, "08-full-390.png"), fullPage: true });

    audit.widths[390] = { ...widthAudit, old: oldAudit };
    audit.errors.push(...errors);
    await page.close();
  }

  // ---- 360 and 320: overflow and title integrity -----------------------
  for (const width of [360, 320]) {
    const { page, errors } = await makePage(width);
    const shellAudit = await page.evaluate(() => {
      const titles = [...document.querySelectorAll("#shelves .spine-title")];
      return {
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        spines: document.querySelectorAll("#shelves .spine").length,
        clippedTitles: titles.filter((t) => t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1).map((t) => t.textContent),
        cropPct: document.querySelector(".stats dd").textContent.trim(),
        shelfPx: document.querySelector(".preview-caption").textContent.replace(/\s+/g, " ").trim(),
        sw: getComputedStyle(document.documentElement).getPropertyValue("--sw"),
      };
    });
    await page.screenshot({ path: path.join(OUT, `09-hero-${width}.png`) });
    await clipShot(page, ".case:nth-of-type(1)", `10-shelf-high-${width}.png`);
    await clipShot(page, ".case:nth-of-type(4)", `19-shelf-auto-${width}.png`);
    await page.locator("#auto").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator("#auto").screenshot({ path: path.join(OUT, `20-auto-section-${width}.png`) });
    await page.locator('[data-auto-select="20"]').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `21-compare-auto-${width}.png`) });
    await scrollTo(page, "#compare", 12);
    await page.locator('.film-item[data-book-id="4"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `11-compare-${width}.png`) });
    await page.locator('#shelves .spine[data-book-id="13"]').click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, `12-detail-hound-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    audit.widths[width] = shellAudit;
    audit.errors.push(...errors);
    await page.close();
  }

  // ---- interaction / accessibility regression --------------------------
  {
    const { page, errors } = await makePage(390);
    await page.locator(".film-item").nth(16).click();
    await page.waitForTimeout(250);
    const selected = await page.evaluate(() => ({
      title: document.querySelector(".compare-copy h3").textContent,
      pressed: document.querySelector('.film-item[aria-pressed="true"]').getAttribute("aria-label"),
    }));
    await page.locator('#shelves .spine[data-book-id="4"]').click();
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
      focusBook: document.activeElement.dataset ? document.activeElement.dataset.bookId : null,
    }));
    audit.interactions = { selected, open, closed };
    audit.errors.push(...errors);
    await page.close();
  }

  await browser.close();

  const uniqueErrors = [...new Set(audit.errors)];
  audit.errors = uniqueErrors;
  fs.writeFileSync(path.join(__dirname, "audit.json"), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
  const overflow = Object.entries(audit.widths).filter(([, v]) => v.scrollWidth > v.clientWidth || v.bodyScrollWidth > v.clientWidth);
  console.log(overflow.length ? "OVERFLOW: " + JSON.stringify(overflow) : "No horizontal overflow at 390 / 360 / 320.");
  console.log(uniqueErrors.length ? "Console errors: " + uniqueErrors.join(" | ") : "Console errors: none");
})();
