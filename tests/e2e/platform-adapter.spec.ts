import { expect, test } from "@playwright/test";

test("the real Tauri adapter renders values from a mocked invoke", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ =
      {
        invoke: async (command: string) => {
          switch (command) {
            case "app_info":
              return {
                name: "PocketLibrary",
                appVersion: "9.8.7",
                schemaVersion: 1,
              };
            case "list_books":
              return [];
            case "list_shelves":
              return [{ id: 1, ordinal: 0, capacity: 12 }];
            default:
              throw new Error(`unexpected command: ${command}`);
          }
        },
      };
  });

  await page.goto("/");

  await expect(page.getByTestId("app-info")).toContainText("v9.8.7");
  await expect(page.getByTestId("empty-shelf")).toHaveCount(1);
});

test("the Tauri adapter accepts an injected invoke function", async ({
  page,
}) => {
  await page.goto("/");

  const version = await page.evaluate(async () => {
    const { createTauriPlatform } = await import("/src/platform.ts");
    const fakeInvoke = async (command: string) => {
      if (command !== "app_info") {
        throw new Error(`unexpected command: ${command}`);
      }
      return { name: "PocketLibrary", appVersion: "1.2.3", schemaVersion: 1 };
    };
    const adapter = createTauriPlatform(
      fakeInvoke as Parameters<typeof createTauriPlatform>[0],
    );

    return (await adapter.appInfo()).appVersion;
  });

  expect(version).toBe("1.2.3");
});
