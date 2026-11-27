import { defineConfig } from "@playwright/test";

const PORT = 1420;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Phone-shaped viewport so web tests match the Android target.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    trace: "on-first-retry",
    // Playwright's "only-on-failure" still captures a throwaway DPR-3
    // screenshot after every passing test in this version (~3s/test). Tests
    // that need a screenshot take one explicitly; failures keep the trace.
    screenshot: "off",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: "npm run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The built app carries the production CSP meta tag; the dev server
      // needs 'unsafe-inline' for React refresh. The CSP spec runs here.
      command:
        "npm run build && npm run preview -- --port 1421 --strictPort",
      url: "http://localhost:1421",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
