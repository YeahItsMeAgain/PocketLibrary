// Throwaway measurement config. Same as the repo config, minus implicit work
// that the repo does not intend to pay for: no failure screenshots, no trace.
// Takes DPR from DPR env (default 3).
import { defineConfig } from "@playwright/test";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const dpr = Number(process.env.DPR ?? "3");

export default defineConfig({
  testDir: path.join(root, "tests/e2e"),
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    trace: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium" }],
});
