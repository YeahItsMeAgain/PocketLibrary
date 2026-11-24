import { expect, test } from "@playwright/test";

test("fresh install opens on an empty library wall", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pocket Library" })).toBeVisible();
  await expect(page.getByTestId("empty-shelf")).toHaveCount(3);
  await expect(page.getByText("Awaiting its first volume").first()).toBeVisible();

  const appInfo = page.getByTestId("app-info");
  await expect(appInfo).toContainText("PocketLibrary");
  await expect(appInfo).toContainText("v0.1.0");
  await expect(appInfo).toContainText("schema 1");
});

test("the brass drawer navigates between Library, Search and Settings", async ({
  page,
}) => {
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
  await expect(page.getByTestId("placeholder-view")).toContainText("Search");

  await pull.click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Library" })
    .click();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("placeholder-view")).toHaveCount(0);
});

test("Escape closes the drawer and returns focus to the pull", async ({ page }) => {
  await page.goto("/");

  const pull = page.getByRole("button", { name: "Open navigation" });
  await pull.click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  await expect(pull).toBeFocused();
});
