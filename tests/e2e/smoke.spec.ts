import { expect, test } from "@playwright/test";

test("fresh install opens on folder onboarding", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("onboarding")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pocket Library" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose library folder" }),
  ).toBeVisible();
  await expect(page.getByTestId("library-wall")).toHaveCount(0);

  const appInfo = page.getByTestId("app-info");
  await expect(appInfo).toContainText("PocketLibrary");
  await expect(appInfo).toContainText("v0.1.0");
  await expect(appInfo).toContainText("schema 3");
});

test("the brass drawer navigates between Library, Search and Settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __POCKETLIBRARY_MOCK__: unknown }).__POCKETLIBRARY_MOCK__ =
      { state: "ready", folderName: "PocketLibrary", books: [] };
  });
  await page.goto("/");

  const pull = page.getByRole("button", { name: "Open navigation" });
  await expect(pull).toBeVisible();
  await expect(page.getByTestId("library-wall")).toBeVisible();

  await pull.click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Library" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Settings" })).toBeVisible();

  await drawer.getByRole("button", { name: "Search" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId("search-view")).toContainText("Search Libgen");

  await pull.click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Library" })
    .click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("search-view")).toHaveCount(0);
});

test("Escape closes the drawer and returns focus to the pull", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __POCKETLIBRARY_MOCK__: unknown }).__POCKETLIBRARY_MOCK__ =
      { state: "ready", folderName: "PocketLibrary", books: [] };
  });
  await page.goto("/");

  const pull = page.getByRole("button", { name: "Open navigation" });
  await pull.click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  await expect(pull).toBeFocused();
});
