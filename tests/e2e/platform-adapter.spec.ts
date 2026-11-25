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
                schemaVersion: 2,
              };
            case "list_books":
              return [];
            case "list_shelves":
              return [{ id: 1, ordinal: 0, capacity: 12 }];
            case "library_status":
              return { state: "ready", folderName: "PocketLibrary" };
            case "rescan_library":
              return {
                total: 0,
                added: 0,
                relinked: 0,
                removed: 0,
                duplicates: 0,
                skipped: [],
                placements: [],
              };
            case "get_shelf_capacity":
              return 12;
            case "label_usage":
              return [];
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

test("the Tauri adapter uses the native share result without saving", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { createTauriPlatform } = await import("/src/platform.ts");
    const commands: string[] = [];
    const fakeInvoke = async (command: string) => {
      commands.push(command);
      if (command === "share_diagnostics") {
        return {
          fileName: "pocketlibrary-diagnostics.zip",
          bytes: 4096,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    const adapter = createTauriPlatform(
      fakeInvoke as Parameters<typeof createTauriPlatform>[0],
    );

    return { exported: await adapter.sendDiagnostics(), commands };
  });

  expect(result.exported).toEqual({
    fileName: "pocketlibrary-diagnostics.zip",
    bytes: 4096,
    method: "share",
    cancelled: false,
  });
  expect(result.commands).toEqual(["share_diagnostics"]);
});

test("the Tauri adapter falls back to saving when native sharing fails", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { createTauriPlatform } = await import("/src/platform.ts");
    const commands: string[] = [];
    const fakeInvoke = async (command: string) => {
      commands.push(command);
      if (command === "share_diagnostics") {
        throw { code: "diagnostics_share", message: "Sharing failed." };
      }
      if (command === "log_diagnostic") return undefined;
      if (command === "save_diagnostics") {
        return { fileName: "saved-diagnostics.zip", bytes: 3072 };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    const adapter = createTauriPlatform(
      fakeInvoke as Parameters<typeof createTauriPlatform>[0],
    );

    return { exported: await adapter.sendDiagnostics(), commands };
  });

  expect(result.exported).toEqual({
    fileName: "saved-diagnostics.zip",
    bytes: 3072,
    method: "save",
    cancelled: false,
  });
  expect(result.commands).toContain("share_diagnostics");
  expect(result.commands).toContain("save_diagnostics");
});
