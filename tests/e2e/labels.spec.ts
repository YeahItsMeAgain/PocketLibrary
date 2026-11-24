import { expect, test } from "@playwright/test";

import type { Book, Label, MockConfig, ReadingStatus } from "../../src/platform";

const OXBLOOD = "#6e2630";
const FOREST = "#294735";
const MUSTARD = "#6b4d18";

function mockLabel(id: number, name: string, colour: string): Label {
  return { id, name, colour, createdAt: 1_700_000_000 + id };
}

function mockBook(
  id: number,
  title: string,
  slotIndex: number,
  status: ReadingStatus = "unread",
  labels: Label[] = [],
): Book {
  return {
    id,
    contentHash: `hash-${id}`,
    format: "epub",
    title,
    authors: [],
    series: null,
    language: null,
    description: null,
    publisher: null,
    publishedDate: null,
    identifier: null,
    pageCount: null,
    addedAt: 1_700_000_000,
    shelfId: 1,
    slotIndex,
    readingStatus: status,
    labels,
  };
}

async function seed(
  page: Parameters<typeof test>[0]["page"],
  config: MockConfig,
) {
  await page.addInitScript((nextConfig) => {
    (
      window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
    ).__POCKETLIBRARY_MOCK__ = nextConfig;
  }, config);
  await page.goto("/");
}

test("creating a label, attaching it from the detail, and seeing the spine band", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "The Hollow Crown", 0), mockBook(2, "A Field Guide", 1)],
  });

  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await expect(manager).toBeVisible();
  await manager.getByTestId("label-name").fill("Gothic");
  await manager.getByRole("button", { name: "Mustard" }).click();
  await manager.getByTestId("create-label").click();

  const row = manager.getByTestId("label-row").filter({ hasText: "Gothic" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("0 books");
  await manager.getByRole("button", { name: "Close label manager" }).click();

  await page.getByTestId("spine").first().click();
  await page.getByTestId("detail-add-label").click();
  await page
    .getByTestId("book-detail")
    .getByRole("menuitem", { name: "Gothic" })
    .click();
  await expect(
    page.getByTestId("detail-label-chip").filter({ hasText: "Gothic" }),
  ).toBeVisible();
  await page.getByTestId("detail-back").click();

  const firstSpine = page.getByTestId("spine").first();
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveCount(1);
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveText("Gothic");
  await expect(firstSpine.getByTestId("spine-label-band")).toHaveCSS(
    "background-color",
    "rgb(107, 77, 24)",
  );
});

test("filtering dims non-matching spines without moving them and ANDs with status", async ({
  page,
}) => {
  const gothic = mockLabel(1, "Gothic", OXBLOOD);
  const winter = mockLabel(2, "Winter", MUSTARD);
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    labels: [gothic, winter],
    books: [
      mockBook(1, "Raven Hall", 0, "reading", [gothic]),
      mockBook(2, "The Old Curiosity", 1, "unread", [gothic]),
      mockBook(3, "Snow Country", 2, "finished", [winter]),
    ],
  });

  const spines = page.getByTestId("spine");
  await expect(spines).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const before = await spines.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().left),
  );

  await page
    .getByTestId("filter-label-chip")
    .filter({ hasText: "Gothic" })
    .click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "2 of 3 books match",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(1);
  await expect(spines.nth(2)).toHaveAttribute("data-dimmed", "true");
  await expect(spines.nth(0)).not.toHaveAttribute("data-dimmed", "true");

  await page.getByTestId("filter-status-reading").click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "1 of 3 books match",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(2);

  const after = await spines.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().left),
  );
  expect(after).toEqual(before);

  await page.getByTestId("filter-clear").click();
  await expect(page.getByTestId("filter-count")).toHaveText(
    "3 books on the wall",
  );
  await expect(page.locator('[data-testid="spine"][data-dimmed="true"]')).toHaveCount(0);
});

test("deleting a label removes its bands but leaves every book", async ({
  page,
}) => {
  const gothic = mockLabel(1, "Gothic", OXBLOOD);
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    labels: [gothic],
    books: [
      mockBook(1, "Raven Hall", 0, "unread", [gothic]),
      mockBook(2, "The Old Curiosity", 1, "unread", [gothic]),
    ],
  });

  await expect(page.getByTestId("spine-label-band")).toHaveCount(2);
  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await manager.getByRole("button", { name: "Delete Gothic" }).click();
  await expect(manager.getByTestId("manage-empty")).toBeVisible();
  await manager.getByRole("button", { name: "Close label manager" }).click();

  await expect(page.getByTestId("spine")).toHaveCount(2);
  await expect(page.getByTestId("spine-label-band")).toHaveCount(0);
  await expect(page.getByTestId("filter-strip")).toContainText("No labels yet");
});

test("the detail cover shows a paper percentage sticker, a gold sticker, and a manual status control", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    readingProgress: { 2: 0.37 },
    books: [
      mockBook(1, "Unopened", 0, "unread"),
      mockBook(2, "In Progress", 1, "reading"),
      mockBook(3, "Completed", 2, "finished"),
    ],
  });

  await page.getByTestId("spine").nth(1).click();
  const readingSticker = page.getByTestId("detail-sticker");
  await expect(readingSticker).toBeVisible();
  await expect(readingSticker).toHaveAttribute("data-sticker", "paper");
  await expect(readingSticker).toHaveText("37%");
  await page.getByTestId("detail-back").click();

  await page.getByTestId("spine").nth(2).click();
  await expect(page.getByTestId("detail-sticker")).toHaveAttribute(
    "data-sticker",
    "gold",
  );
  await page.getByTestId("detail-back").click();

  await page.getByTestId("spine").nth(0).click();
  await expect(page.getByTestId("detail-title")).toBeVisible();
  await expect(page.getByTestId("detail-sticker")).toHaveCount(0);
  await expect(page.getByTestId("detail-meta")).not.toContainText(
    /reading status/i,
  );

  await page.getByTestId("detail-status-control").click();
  await page.getByTestId("detail-status-option-finished").click();
  await expect(page.getByTestId("detail-sticker")).toHaveAttribute(
    "data-sticker",
    "gold",
  );
  await page.getByTestId("detail-back").click();
  await expect(page.getByTestId("spine").nth(0)).toHaveAttribute(
    "data-status",
    "finished",
  );
  await expect(
    page.getByTestId("spine").nth(0).getByTestId("spine-seal"),
  ).toBeVisible();
});

test("manage labels can rename and recolour without a free colour picker", async ({
  page,
}) => {
  await seed(page, {
    state: "ready",
    folderName: "PocketLibrary",
    books: [mockBook(1, "Raven Hall", 0)],
  });

  await page.getByTestId("manage-labels").click();
  const manager = page.getByTestId("manage-labels-panel");
  await manager.getByTestId("label-name").fill("Gothic");
  await manager.getByTestId("create-label").click();

  const row = manager.getByTestId("label-row").filter({ hasText: "Gothic" });
  await row.getByRole("button", { name: "Gothic", exact: true }).click();
  const rename = manager.getByTestId("rename-label");
  await expect(rename).toBeVisible();
  await rename.fill("Weird Tales");
  await manager.getByRole("button", { name: "Save" }).click();

  const renamed = manager.getByTestId("label-row").filter({
    hasText: "Weird Tales",
  });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Forest" }).click();
  await expect(
    renamed.getByRole("button", { name: "Forest" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    manager.getByRole("button", { name: "Teal" }).first(),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: "Indigo" }),
  ).toHaveCount(0);
});
