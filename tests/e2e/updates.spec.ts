import { expect, test, type Page } from "@playwright/test";

import type { MockUpdateConfig } from "../../src/platform";

async function boot(page: Page, updates: MockUpdateConfig) {
  await page.addInitScript((config) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
      updates: config,
    };
  }, updates);
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

const AVAILABLE: MockUpdateConfig = {
  scenario: "available",
  currentVersion: "0.1.1",
  latestVersion: "0.2.0",
  notes: "Fixes shelf placement.\nFaster imports.",
  pubDate: "2026-11-25T10:00:00Z",
  size: 800_000,
  stepMs: 40,
};

test("settings reports an up-to-date app after the automatic check", async ({
  page,
}) => {
  await boot(page, { scenario: "upToDate", currentVersion: "0.1.1" });

  await expect(page.getByTestId("update-current-version")).toContainText(
    "v0.1.1",
  );
  await expect(page.getByTestId("update-status")).toContainText(
    "You're up to date",
  );
  await expect(page.getByTestId("update-last-checked")).toContainText(
    "Last checked",
  );
  await expect(page.getByTestId("update-download")).toHaveCount(0);
  await expect(page.getByTestId("update-install")).toHaveCount(0);
  await expect(page.getByTestId("update-check")).toBeEnabled();
});

test("an available update downloads with progress, then installs", async ({
  page,
}) => {
  await boot(page, AVAILABLE);

  await expect(page.getByTestId("update-status")).toContainText(
    "Version 0.2.0 is available",
  );
  await expect(page.getByTestId("update-latest-version")).toContainText(
    "v0.2.0",
  );
  await expect(page.getByTestId("update-date")).toContainText("25 Nov 2026");
  await expect(page.getByTestId("update-size")).toContainText("781 KB");
  await expect(page.getByTestId("update-notes")).toContainText(
    "Fixes shelf placement.",
  );
  // The automatic check is metadata-only.
  await expect(page.getByTestId("update-progress")).toHaveCount(0);

  await page.getByTestId("update-download").click();
  const bar = page.getByTestId("update-progress");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuemax", "800000");
  await expect
    .poll(async () => Number(await bar.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);

  await expect(page.getByTestId("update-install")).toBeVisible();
  await expect(page.getByTestId("update-progress-text")).toContainText(
    "Ready to install",
  );

  await page.getByTestId("update-install").click();
  await expect(page.getByTestId("update-install-notice")).toContainText(
    "Installer opened",
  );
});

test("a failed download keeps the update available and offers a retry", async ({
  page,
}) => {
  await boot(page, {
    ...AVAILABLE,
    scenario: "downloadError",
  });

  await expect(page.getByTestId("update-status")).toContainText(
    "Version 0.2.0 is available",
  );
  await page.getByTestId("update-download").click();
  await expect(page.getByTestId("update-download-error")).toContainText(
    "download stopped",
  );
  await expect(page.getByTestId("update-install")).toHaveCount(0);
  await expect(page.getByTestId("update-download")).toContainText(
    "Try download again",
  );

  await page.getByTestId("update-download").click();
  await expect(page.getByTestId("update-install")).toBeVisible();
  await expect(page.getByTestId("update-download-error")).toHaveCount(0);
});

test("the Android install permission opens instructions and retries", async ({
  page,
}) => {
  await boot(page, {
    ...AVAILABLE,
    scenario: "installPermission",
  });

  await page.getByTestId("update-download").click();
  await expect(page.getByTestId("update-install")).toBeVisible();
  // Nothing installs until the user asks.
  await expect(page.getByTestId("update-install-notice")).toHaveCount(0);

  await page.getByTestId("update-install").click();
  await expect(page.getByTestId("update-permission")).toContainText(
    "unknown apps",
  );
  await expect(page.getByTestId("update-install-notice")).toHaveCount(0);

  await page.getByTestId("update-retry-install").click();
  await expect(page.getByTestId("update-install-notice")).toContainText(
    "Installer opened",
  );
  await expect(page.getByTestId("update-permission")).toHaveCount(0);
});
