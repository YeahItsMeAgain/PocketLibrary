import { expect, test, type Page } from "@playwright/test";

import type { MockUpdateConfig } from "../../src/platform";

const NOTES =
  "# PocketLibrary 0.2.0 release notes\n\n" +
  "A **larger** edition with a few repairs.\n\n" +
  "## Highlights\n\n" +
  "- **Shelf placement is repaired.** Books return to the right case.\n" +
  "- *Faster imports* for a full folder.\n" +
  "- **Delete book** is offered with confirmation.\n" +
  "- A fourth item stays in the full notes.\n\n" +
  "## Upgrade notes\n\n" +
  "Install over 0.1.7 without uninstalling.\n";

const AVAILABLE: MockUpdateConfig = {
  scenario: "available",
  currentVersion: "0.1.7",
  latestVersion: "0.2.0",
  notes: NOTES,
  pubDate: "2026-11-25T10:00:00Z",
  size: 800_000,
  stepMs: 40,
};

async function boot(
  page: Page,
  updates: MockUpdateConfig,
  openSettings = false,
) {
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
  if (openSettings) await openSettingsView(page);
}

async function openSettingsView(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("an available release raises a compact banner with version and highlights", async ({
  page,
}) => {
  await boot(page, AVAILABLE);

  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("A new edition is ready");
  await expect(banner).toContainText("v0.2.0");
  await expect(banner.getByTestId("update-banner-action")).toHaveText(
    "See update",
  );
  await expect(banner).toHaveAttribute("role", "status");
  await expect(page.getByTestId("update-banner-dismiss")).toHaveAttribute(
    "aria-label",
    /version 0\.2\.0/,
  );
  await expect(banner.locator(".update-banner-highlights li")).toHaveCount(3);
  await expect(banner).toContainText("Shelf placement is repaired.");
  await expect(banner).toContainText("Faster imports for a full folder.");
  await expect(banner).not.toContainText("A fourth item");
  await expect(banner).not.toContainText("##");
  await expect(banner).not.toContainText("**");

  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    body: document.body.scrollWidth > document.body.clientWidth,
  }));
  expect(overflow.document).toBe(false);
  expect(overflow.body).toBe(false);
  const box = await banner.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test("reduced motion removes the banner entrance animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page, AVAILABLE);

  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible();
  const duration = await banner.evaluate((element) =>
    parseFloat(getComputedStyle(element).animationDuration),
  );
  expect(duration).toBeLessThan(0.01);
});

test("a release with no notes falls back to the Settings sentence", async ({
  page,
}) => {
  await boot(page, { ...AVAILABLE, notes: "" });

  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Release notes are available in Settings.",
  );
  await expect(banner.locator(".update-banner-highlights li")).toHaveCount(1);
});

test("no banner appears when up to date or when the check fails", async ({
  page,
}) => {
  await boot(page, { scenario: "upToDate", currentVersion: "0.1.7" });
  await expect(page.getByTestId("update-banner")).toHaveCount(0);

  await page.addInitScript(() => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
      updates: { scenario: "checkError", currentVersion: "0.1.7" },
    };
  });
  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
});

test("dismissing remembers the version through a reload", async ({ page }) => {
  await boot(page, AVAILABLE);
  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible();

  await page.getByTestId("update-banner-dismiss").click();
  await expect(banner).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem(
          "pocketlibrary.updateDismissedVersion",
        ),
      ),
    )
    .toBe("0.2.0");

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await openSettingsView(page);
  await expect(page.getByTestId("update-status")).toContainText(
    "Version 0.2.0 is available",
  );
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
});

test("a newer release raises the banner after an older one was dismissed", async ({
  page,
}) => {
  await boot(page, AVAILABLE);
  await page.getByTestId("update-banner-dismiss").click();
  await expect(page.getByTestId("update-banner")).toHaveCount(0);

  await page.addInitScript(() => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
      updates: {
        scenario: "available",
        currentVersion: "0.1.7",
        latestVersion: "0.2.1",
        notes: "## Highlights\n\n- A later repair.\n",
      },
    };
  });
  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("update-banner")).toContainText("v0.2.1");
  await expect(page.getByTestId("update-banner")).toContainText(
    "A later repair.",
  );
});

test("See update opens Settings, focuses Updates and performs one check", async ({
  page,
}) => {
  await boot(page, { ...AVAILABLE, checks: 0 });
  await expect(page.getByTestId("update-banner")).toBeVisible();

  await page.getByTestId("update-banner-action").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-updates")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Updates" }),
  ).toBeFocused();
  await expect(page.getByTestId("update-status")).toContainText(
    "Version 0.2.0 is available",
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __POCKETLIBRARY_MOCK__: { updates: { checks?: number } };
          }
        ).__POCKETLIBRARY_MOCK__.updates.checks,
    ),
  ).toBe(1);

  await page.getByTestId("update-check").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __POCKETLIBRARY_MOCK__: { updates: { checks?: number } };
            }
          ).__POCKETLIBRARY_MOCK__.updates.checks,
      ),
    )
    .toBe(2);
});

test("release notes show highlights first and expand to parsed notes", async ({
  page,
}) => {
  await boot(page, AVAILABLE, true);

  const notes = page.getByTestId("update-notes");
  await expect(notes).toBeVisible();
  const highlights = page.getByTestId("update-highlights");
  await expect(highlights).toContainText("Shelf placement is repaired.");
  await expect(highlights).not.toContainText("##");
  await expect(highlights).not.toContainText("**");
  await expect(page.getByTestId("update-notes-full")).toBeHidden();

  await page.getByTestId("update-notes-toggle").click();
  const full = page.getByTestId("update-notes-full");
  await expect(full).toBeVisible();
  await expect(full).toContainText("PocketLibrary 0.2.0 release notes");
  await expect(full).toContainText("Upgrade notes");
  await expect(full).toContainText("Install over 0.1.7 without uninstalling.");
  await expect(full).not.toContainText("##");
  await expect(full).not.toContainText("**");
});

test("a downloaded update changes the banner action to installation", async ({
  page,
}) => {
  await boot(page, AVAILABLE, true);
  await page.getByTestId("update-download").click();
  await expect(page.getByTestId("update-install")).toBeVisible();

  const banner = page.getByTestId("update-banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByTestId("update-banner-action")).toHaveText(
    "See install",
  );

  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("update-banner")).toContainText("See install");
});
