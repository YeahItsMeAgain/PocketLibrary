import { expect, test } from "@playwright/test";

test("app root renders at a phone viewport", async ({ page }) => {
  await page.goto("/");

  const root = page.locator("#root");
  await expect(root).toBeVisible();
  await expect(root.locator("h1")).toContainText("Storage Spike");
});
