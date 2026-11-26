#!/usr/bin/env node
/*
 * popular-app-route audit.
 *
 *   node popular-app-route/tests/audit.cjs
 *
 * Starts a static server, then checks the 5 popular-book v8-app runs, the 2
 * generative-art runs, the v6/v7 Hybrid + Art-only renders, image loading,
 * 390/320 px overflow and console/page/request errors.
 */

const { chromium } = require("@playwright/test");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HERE = __dirname;
const APP = path.resolve(HERE, "..");
const SERVE_ROOT = path.resolve(HERE, "../../..");
const PORT = Number(process.env.AUDIT_PORT || 4191);
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/spine-cover-art-prototype/popular-app-route/`;
const SHOTS = path.join(APP, "screenshots");

const EXPECTED = {
  "harry-potter": { verdict: "pass", route: "text-free crop" },
  "the-hunger-games": { verdict: "pass", route: "text-free crop" },
  "lord-of-the-rings": { verdict: "fallback", route: "fallback" },
  "the-hobbit": { verdict: "pass", route: "inpaint" },
  dune: { verdict: "pass", route: "text-free crop" },
};

const results = {
  schema: "pocketlibrary.popular-app-route-audit/1",
  generatedAt: new Date().toISOString(),
  url: URL,
  widths: [],
  errors: [],
  screenshots: [],
  images: null,
  verdict: null,
};

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
  return ok;
}

function waitForServer(url, attempts = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const ping = () => {
      http.get(url, (res) => {
        res.resume();
        resolve();
      }).on("error", () => {
        if (++n >= attempts) reject(new Error(`Server did not start at ${url}`));
        else setTimeout(ping, 120);
      });
    };
    ping();
  });
}

function watch(page, errors) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText || ""}`);
  });
  page.on("request", (req) => {
    if (!req.url().startsWith(BASE)) errors.push(`external request: ${req.url()}`);
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => window.PopularAppRoute && window.PopularAppRoute.ready, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });

  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: SERVE_ROOT,
    stdio: "ignore",
  });
  const shutdown = () => { try { server.kill("SIGTERM"); } catch {} };
  process.on("exit", shutdown);

  try {
    await waitForServer(URL);
    const browser = await chromium.launch();

    for (const width of [390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      watch(page, errors);

      await page.goto(URL, { waitUntil: "load" });
      await waitReady(page);

      const state = await page.evaluate(() => window.PopularAppRoute.getState());
      const expectedIds = Object.keys(EXPECTED);
      for (const [id, want] of Object.entries(EXPECTED)) {
        check(state.verdicts[id] === want.verdict, `${width}: ${id} verdict ${state.verdicts[id]} != ${want.verdict}`);
        check(state.routes[id] === want.route, `${width}: ${id} route ${state.routes[id]} != ${want.route}`);
      }

      const books = await page.locator(".book").count();
      check(books === 7, `${width}: expected 7 cards, got ${books}`);
      for (const id of expectedIds) {
        check(await page.locator(`[data-book="${id}"]`).count() === 1, `${width}: missing card ${id}`);
      }

      const spines = await page.locator(".spine").count();
      check(spines === 14, `${width}: expected 14 rendered spines, got ${spines}`);
      const badFit = state.spines.filter((s) => !(s.fit <= 1.01));
      check(badFit.length === 0, `${width}: ${badFit.length} spines over fit budget`);

      const img = await page.evaluate(async () => {
        const all = Array.from(document.images);
        await Promise.all(all.map((i) => i.complete ? null : new Promise((r) => {
          i.addEventListener("load", r, { once: true });
          i.addEventListener("error", r, { once: true });
        })));
        return {
          total: all.length,
          broken: all.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
          external: all.filter((i) => !i.currentSrc.startsWith(location.origin)).map((i) => i.currentSrc),
        };
      });
      check(img.total >= 35, `${width}: only ${img.total} images`);
      check(img.broken.length === 0, `${width}: broken images: ${img.broken.join(", ")}`);
      check(img.external.length === 0, `${width}: external images: ${img.external.join(", ")}`);
      if (width === 390) results.images = img;

      check(state.overflow.overflow === false, `${width}: page overflow ${JSON.stringify(state.overflow.offenders)}`);
      check(state.overflow.scrollWidth <= width, `${width}: scrollWidth ${state.overflow.scrollWidth} > ${width}`);

      // Belt-and-braces: no card may overflow the viewport either.
      const cardOverflow = await page.evaluate(() => {
        const inner = window.innerWidth;
        return Array.from(document.querySelectorAll(".book")).filter((n) => {
          const r = n.getBoundingClientRect();
          return r.right > inner + 1 || r.left < -1;
        }).map((n) => n.dataset.book);
      });
      check(cardOverflow.length === 0, `${width}: overflowing cards: ${cardOverflow.join(", ")}`);

      const summary = {
        width,
        books,
        spines,
        verdicts: state.verdicts,
        routes: state.routes,
        overflow: state.overflow,
        scrollWidth: state.overflow.scrollWidth,
        images: img.total,
        consoleErrors: 0,
      };

      await page.screenshot({ path: path.join(SHOTS, `route-${width}-full.png`), fullPage: true });
      await page.locator("#popular").screenshot({ path: path.join(SHOTS, `route-${width}-popular.png`) });
      await page.locator("#generative").screenshot({ path: path.join(SHOTS, `route-${width}-generative.png`) });
      results.screenshots.push(
        `screenshots/route-${width}-full.png`,
        `screenshots/route-${width}-popular.png`,
        `screenshots/route-${width}-generative.png`
      );

      check(errors.length === 0, `${width}: errors: ${errors.join(" | ")}`);
      summary.consoleErrors = errors.length;
      results.errors.push(...errors.map((e) => `${width}: ${e}`));
      results.widths.push(summary);
      await context.close();
    }

    await browser.close();
  } finally {
    shutdown();
  }

  results.verdict = failures.length ? "fail" : "pass";
  results.failures = failures;
  await fs.writeFile(path.join(HERE, "results.json"), JSON.stringify(results, null, 2) + "\n");

  if (failures.length) {
    console.error(`FAIL (${failures.length})`);
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
    console.log(`390: 7 cards, 14 spines, 0 overflow, 0 console errors`);
    console.log(`320: 7 cards, 14 spines, 0 overflow, 0 console errors`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
