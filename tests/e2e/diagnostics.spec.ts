import { expect, test, type Page } from "@playwright/test";

async function boot(page: Page, mock: Record<string, unknown> = {}) {
  await page.addInitScript((config) => {
    window.localStorage.setItem(
      "pocketlibrary.mock.diagnostics",
      JSON.stringify([
        {
          at: Date.now() - 60_000,
          level: "error",
          event: "download.failed",
          message: "Book One: mirror_failed",
        },
        {
          at: Date.now() - 30_000,
          level: "warn",
          event: "folder.scan",
          message: "skipped one unreadable file",
        },
      ]),
    );
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = {
      state: "ready",
      folderName: "PocketLibrary",
      books: [],
      shelves: [{ id: 1, ordinal: 0, capacity: 6 }],
      diagnosticsSave: {
        fileName: "my-diagnostics.zip",
        bytes: 4096,
      },
      ...config,
    };
  }, mock);
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("settings shows log details, sends, copies and clears", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
        },
      },
    });
  });
  await boot(page);
  await openSettings(page);

  await expect(page.getByTestId("diagnostics-size")).toContainText(
    "2 entries",
  );
  await expect(page.getByTestId("diagnostics-last-error")).toContainText(
    "download.failed",
  );

  await page.getByTestId("settings-send-diagnostics").click();
  await expect(page.getByTestId("diagnostics-notice")).toContainText(
    "Saved diagnostics to my-diagnostics.zip",
  );

  await page.getByTestId("settings-copy-summary").click();
  await expect(page.getByTestId("diagnostics-notice")).toContainText(
    "Summary copied",
  );
  const copied = await page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied,
  );
  expect(copied).toContain("PocketLibrary v0.1.11");
  expect(copied).toContain("1 error, 1 warning");
  expect(copied).toContain("Book One");

  await page.getByTestId("settings-clear-diagnostics").click();
  await expect(page.getByTestId("diagnostics-notice")).toContainText(
    "Logs cleared",
  );
  await expect(page.getByTestId("diagnostics-size")).toContainText(
    "0 entries",
  );
  await expect(page.getByTestId("diagnostics-last-error")).toContainText(
    "None recorded",
  );
});

test("copy logs writes the full report including spine.log", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
        },
      },
    });
  });
  await boot(page);
  await openSettings(page);

  const send = page.getByTestId("settings-send-diagnostics");
  const copyLogs = page.getByTestId("settings-copy-logs");
  await expect(send).toBeVisible();
  await expect(copyLogs).toBeVisible();
  await expect(
    send.locator("xpath=following-sibling::button[1]"),
  ).toHaveAttribute("data-testid", "settings-copy-logs");

  await copyLogs.click();
  await expect(page.getByTestId("copy-logs-notice")).toContainText(
    "Copied to clipboard",
  );
  const copied = await page.evaluate(
    () => (window as unknown as { __copied?: string }).__copied,
  );
  expect(copied).toContain("PocketLibrary v0.1.11");
  expect(copied).toContain("===== spine.log =====");
  expect(copied).toContain("ensure_models: start");
  expect(copied).toContain("Book One: mirror_failed");
});

test("copy logs offers a selected textarea when the clipboard is refused", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("clipboard denied");
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
  });
  await boot(page);
  await openSettings(page);

  await page.getByTestId("settings-copy-logs").click();
  const sheet = page.getByTestId("diagnostics-copy-fallback");
  const area = page.getByTestId("diagnostics-copy-text");
  await expect(sheet).toBeVisible();
  await expect(area).toBeFocused();
  await expect(area).toHaveValue(/===== spine\.log =====/);
  const selection = await area.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    return [
      textarea.selectionStart,
      textarea.selectionEnd,
      textarea.value.length,
    ];
  });
  expect(selection[0]).toBe(0);
  expect(selection[1]).toBe(selection[2]);
  await expect(page.getByTestId("diagnostics-copy-select-all")).toBeVisible();

  await page.getByTestId("diagnostics-copy-close").click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("settings-copy-logs")).toBeFocused();
});

test("copy logs stays inside 390 and 320 wide screens", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("clipboard denied");
        },
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
  });
  await boot(page);
  await openSettings(page);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByTestId("settings-copy-logs").click();
    await expect(page.getByTestId("diagnostics-copy-fallback")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const box = await page.getByTestId("diagnostics-copy-fallback").boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.getByTestId("diagnostics-copy-close").click();
  }
});

test("send diagnostics hands the zip to the native share sheet", async ({
  page,
}) => {
  await boot(page, {
    diagnosticsShare: {
      fileName: "pocketlibrary-diagnostics.zip",
      bytes: 4096,
    },
    diagnosticsSave: null,
  });
  await openSettings(page);

  await page.getByTestId("settings-send-diagnostics").click();
  await expect(page.getByTestId("diagnostics-notice")).toContainText(
    "Diagnostics handed to the share sheet.",
  );
});

test("send diagnostics falls back to the save picker when sharing is unavailable", async ({
  page,
}) => {
  await boot(page, {
    diagnosticsShare: null,
    diagnosticsSave: { fileName: "fallback-diagnostics.zip", bytes: 2048 },
  });
  await openSettings(page);

  await page.getByTestId("settings-send-diagnostics").click();
  await expect(page.getByTestId("diagnostics-notice")).toContainText(
    "Saved diagnostics to fallback-diagnostics.zip.",
  );
});

test("a failed download offers the same report action", async ({ page }) => {
  await boot(page, {
    downloadFail: true,
    downloadStepMs: 10,
    diagnosticsSave: { fileName: "my-diagnostics.zip", bytes: 2048 },
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await page.getByTestId("search-result").first().click();
  await page.getByTestId("result-download").click();

  const report = page.getByTestId("download-report");
  await expect(report).toBeVisible();
  await report.click();
  await expect(page.getByTestId("download-report-notice")).toContainText(
    "Saved diagnostics",
  );
});

test("repeated failures show a one-time diagnostics hint", async ({ page }) => {
  await boot(page, {
    backupError: {
      code: "archive_corrupt",
      message: "That backup file is damaged and cannot be restored.",
    },
  });
  await openSettings(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByTestId("settings-import").click();
    await expect(page.getByTestId("backup-error")).toBeVisible();
  }

  await expect(page.getByTestId("diagnostics-hint")).toBeVisible();
  await page.getByTestId("diagnostics-hint-dismiss").click();
  await expect(page.getByTestId("diagnostics-hint")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("library-wall")).toBeVisible();
  await expect(page.getByTestId("diagnostics-hint")).toHaveCount(0);
});

test("command failures are written to the local log", async ({ page }) => {
  await boot(page, { searchMode: "offline" });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog", { name: "Navigation" })
    .getByRole("button", { name: "Search" })
    .click();
  await page.getByTestId("search-query").fill("Rock Paper Scissors");
  await page.getByTestId("search-submit").click();
  await expect(page.getByTestId("search-error")).toBeVisible();

  const logged = await page.evaluate(() => {
    const raw = window.localStorage.getItem("pocketlibrary.mock.diagnostics");
    return raw ? (JSON.parse(raw) as Array<{ event: string; message: string }>) : [];
  });
  expect(
    logged.some(
      (entry) =>
        entry.event === "command_failed" &&
        entry.message.includes("searchLibgen"),
    ),
  ).toBe(true);

  await page.getByTestId("search-back").click();
  await openSettings(page);
  await expect(page.getByTestId("diagnostics-last-error")).toContainText(
    "command_failed",
  );
});
