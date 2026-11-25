import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_DOWNLOAD_NAMING } from "../../src/platform";

async function bootSettings(page: Page) {
  await page.addInitScript(() => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await openSettings(page);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("download naming saves, previews, rejects bad patterns and resets", async ({
  page,
}) => {
  await bootSettings(page);

  const input = page.getByTestId("download-naming");
  const example = page.getByTestId("download-naming-example");
  await expect(input).toHaveValue(DEFAULT_DOWNLOAD_NAMING);
  await expect(example).toContainText(
    "Ursula K. Le Guin - The Left Hand of Darkness (1969).epub",
  );

  const custom = "{title} - {author} ({year})";
  await input.fill(custom);
  await expect(example).toContainText(
    "The Left Hand of Darkness - Ursula K. Le Guin (1969).epub",
  );
  await expect(page.getByTestId("save-download-naming")).toBeEnabled();
  await page.getByTestId("save-download-naming").click();
  await expect(page.getByTestId("download-naming-saved")).toContainText(
    custom,
  );

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId("download-naming")).toHaveValue(custom);

  await page.getByTestId("download-naming").fill("{series} - {title}");
  await page.getByTestId("save-download-naming").click();
  await expect(page.getByTestId("download-naming-error")).toContainText(
    "only {author}, {title} and {year}",
  );
  await expect(page.getByTestId("download-naming")).toHaveValue(
    "{series} - {title}",
  );

  await page.getByTestId("reset-download-naming").click();
  await expect(page.getByTestId("download-naming")).toHaveValue(
    DEFAULT_DOWNLOAD_NAMING,
  );
  await expect(page.getByTestId("download-naming-saved")).toContainText(
    DEFAULT_DOWNLOAD_NAMING,
  );

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId("download-naming")).toHaveValue(
    DEFAULT_DOWNLOAD_NAMING,
  );
});
