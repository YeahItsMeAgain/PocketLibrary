import { expect, test, type Locator, type Page } from "@playwright/test";
import { inflateSync } from "node:zlib";

import type { Book, MockSpineConfig, SpineArtifact } from "../../src/platform";
import { shelfSpineStyle } from "../../src/library/spine";

type SpineStyleName = "art" | "cloth" | "typography" | "full-bleed";

function mockBook(
  id: number,
  title: string,
  style: SpineStyleName,
  overrides: Partial<Book> = {},
): Book {
  return {
    id,
    contentHash: `presentation-${id}-${style}`,
    format: "epub",
    title,
    authors: ["Alice Feeney"],
    series: null,
    language: "English",
    description: null,
    publisher: null,
    publishedDate: "2021-08-01",
    identifier: null,
    pageCount: 320,
    addedAt: 1,
    shelfId: 1,
    slotIndex: id - 1,
    readingStatus: "unread",
    labels: [],
    // The platform union is extended separately; render these defensively.
    spineStyle: style as unknown as Book["spineStyle"],
    ...overrides,
  };
}

function spineArt(color = "#7a2828"): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="104" height="472">` +
        `<rect width="104" height="236" fill="${color}"/>` +
        `<rect y="236" width="104" height="236" fill="#151515"/>` +
        `</svg>`,
    )
  );
}

function artifact(bookId: number): SpineArtifact {
  const strip = spineArt();
  return {
    bookId,
    route: "crop",
    verdict: "pass",
    maskPercent: 0,
    pagesApproximate: false,
    cropBox: { x: 1, y: 0, width: 52, height: 236 },
    artDataUrl: strip,
    spineDataUrl: strip,
    fallbackDataUrl: strip,
    runJson: {},
    qaJson: {},
  };
}

async function boot(
  page: Page,
  books: Book[],
  spine: Partial<MockSpineConfig> = {},
  strips: Record<number, string> = {},
) {
  const artifacts = Object.fromEntries(
    books.map((book) => {
      const strip = strips[book.id];
      if (!strip) return [book.id, artifact(book.id)];
      return [
        book.id,
        {
          ...artifact(book.id),
          artDataUrl: strip,
          spineDataUrl: strip,
          fallbackDataUrl: strip,
        },
      ];
    }),
  );
  await page.addInitScript(
    ({ books: seedBooks, spine: seedSpine, artifacts: seedArtifacts }) => {
      (
        window as unknown as { __POCKETLIBRARY_MOCK__: unknown }
      ).__POCKETLIBRARY_MOCK__ = {
        state: "ready",
        folderName: "PocketLibrary",
        books: seedBooks,
        shelves: [{ id: 1, ordinal: 0, capacity: 12 }],
        spine: {
          backfillPending: false,
          queueStartPaused: true,
          artifacts: seedArtifacts,
          ...seedSpine,
        },
      };
      window.localStorage.setItem("pocketlibrary.dragHintSeen", "1");
    },
    { books, spine, artifacts },
  );
  await page.goto("/");
  await expect(page.getByTestId("library-wall")).toBeVisible();
}

interface TitleColumnFit {
  fill: number;
  gap: number;
  text: string;
  tracking: number;
}

interface TitleFit {
  fill: number;
  columns: number;
  columnFits: TitleColumnFit[];
  overflowY: number;
  font: number;
  letterSpacing: number;
  inside: boolean;
  glyphTop: number;
  glyphBottom: number;
  boxTop: number;
  boxBottom: number;
  spineHeight: number;
}

function measureTitle(element: HTMLElement): TitleFit {
  const title = element.querySelector<HTMLElement>(".st");
  if (!title) throw new Error("no title");
  const style = getComputedStyle(title);
  const box = title.getBoundingClientRect();
  const spineRect = element.getBoundingClientRect();
  const columnNodes = [...title.querySelectorAll<HTMLElement>(":scope > .st-col")];
  const groups = columnNodes.length > 0 ? columnNodes : [title];
  const columnFits = groups.map((group) => {
    const range = document.createRange();
    range.selectNodeContents(group);
    const rect = range.getBoundingClientRect();
    const top = rect.top - box.top;
    const bottom = rect.bottom - box.top;
    return {
      fill: (bottom - top) / box.height,
      gap: (box.height - (bottom - top)) / box.height,
      text: group.textContent ?? "",
      tracking:
        getComputedStyle(group).letterSpacing === "normal"
          ? 0
          : Number.parseFloat(getComputedStyle(group).letterSpacing),
    };
  });
  const minFill = Math.min(...columnFits.map((column) => column.fill));
  const glyphRects = groups.map((group) => {
    const range = document.createRange();
    range.selectNodeContents(group);
    return range.getBoundingClientRect();
  });
  const inside = glyphRects.every(
    (rect) => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
  );
  return {
    fill: minFill,
    columns: groups.length,
    columnFits,
    overflowY: title.scrollHeight - title.clientHeight,
    font: Number.parseFloat(style.fontSize),
    letterSpacing:
      style.letterSpacing === "normal"
        ? 0
        : Number.parseFloat(style.letterSpacing),
    inside,
    glyphTop: Math.min(...glyphRects.map((rect) => rect.top - spineRect.top)),
    glyphBottom: Math.max(
      ...glyphRects.map((rect) => rect.bottom - spineRect.top),
    ),
    boxTop: box.top - spineRect.top,
    boxBottom: box.bottom - spineRect.top,
    spineHeight: spineRect.height,
  };
}

const FILL_TITLES: Array<[string, SpineStyleName]> = [
  ["Dune", "art"],
  ["Rock Paper Scissors", "art"],
  ["The Picture of Dorian Gray", "art"],
  ["Alice's Adventures in Wonderland", "art"],
  [
    "The Extraordinarily Long and Unabridged Chronicle of the Lighthouse Keeper's Daughter, Volume the Twenty-Seventh",
    "art",
  ],
  ["Dune", "typography"],
];

for (const width of [390, 320]) {
  test(`shelf titles fill the run without clipping at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const books = FILL_TITLES.map(([title, style], index) =>
      mockBook(index + 1, title, style),
    );
    await boot(page, books);
    await expect(page.getByTestId("spine")).toHaveCount(books.length);

    for (const [index, [title]] of FILL_TITLES.entries()) {
      const fit = await page
        .getByTestId("spine")
        .nth(index)
        .evaluate(measureTitle as unknown as (element: Element) => TitleFit);
      expect(fit.fill, `${title} fill`).toBeGreaterThanOrEqual(0.8);
      expect(fit.fill, `${title} fill`).toBeLessThanOrEqual(1.02);
      expect(fit.columns, `${title} columns`).toBeLessThanOrEqual(2);
      expect(fit.overflowY, `${title} overflow`).toBeLessThanOrEqual(2);
      expect(fit.inside, `${title} glyph inside box`).toBe(true);
      expect(fit.font, `${title} font`).toBeGreaterThan(2.5);
      // Two-column titles must carry type down both columns, not leave the
      // second one half empty. A single long word stays one column.
      for (const [column, metrics] of fit.columnFits.entries()) {
        expect(
          metrics.fill,
          `${title} column ${column} fill`,
        ).toBeGreaterThanOrEqual(0.8);
        expect(
          metrics.gap,
          `${title} column ${column} empty gap`,
        ).toBeLessThanOrEqual(0.2);
      }
    }
    // Short and medium titles fill one column instead of being split.
    for (const index of [0, 1, 2, 5]) {
      const fit = await page
        .getByTestId("spine")
        .nth(index)
        .evaluate(measureTitle as unknown as (element: Element) => TitleFit);
      expect(fit.columns, `${FILL_TITLES[index][0]} columns`).toBe(1);
    }
    // Short titles specifically must not sit in a large dark field.
    expect(
      (
        await page
          .getByTestId("spine")
          .first()
          .evaluate(measureTitle as unknown as (element: Element) => TitleFit)
      ).fill,
    ).toBeGreaterThanOrEqual(0.9);
  });
}

async function longPress(page: Page, spine: Locator) {
  const box = await spine.boundingBox();
  if (!box) throw new Error("spine has no box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(460);
  await expect(page.getByTestId("spine-drag-ghost")).toBeVisible();
  await page.mouse.move(start.x + 44, start.y + 26, { steps: 5 });
  await page.waitForTimeout(120);
  return start;
}

test("the drag ghost keeps the shelf's spine presentation", async ({
  page,
}, testInfo) => {
  // Four drags and three saved screenshots: comfortably under the default
  // timeout alone, but not when the gate runs the web and Rust groups at once.
  test.setTimeout(90_000);
  const books = [
    mockBook(1, "Rock Paper Scissors", "art", {
      readingStatus: "finished",
      labels: [{ id: 1, name: "Thriller", colour: "#7a2828" }],
    }),
    mockBook(2, "Dune", "typography"),
    // A row that still carries the retired style renders as Wrap.
    mockBook(3, "The Picture of Dorian Gray", "full-bleed"),
    mockBook(4, "A Reading Volume", "art", {
      readingStatus: "reading",
      labels: [{ id: 2, name: "Favourite", colour: "#6e2630" }],
    }),
  ];
  await boot(page, books);
  await expect(page.getByTestId("spine-generated")).toHaveCount(3);

  for (const [index, expected] of [
    [0, "art"],
    [1, "typography"],
    [2, "art"],
    [3, "art"],
  ] as const) {
    const bookId = books[index].id;
    const source = page.locator(
      `[data-testid="spine"][data-book-id="${bookId}"]`,
    );
    const before = await source.evaluate((element) => {
      const pick = <T extends HTMLElement>(selector: string) =>
        element.querySelector<T>(selector);
      const title = pick<HTMLElement>(".st");
      const image = pick<HTMLImageElement>("img.spine-generated");
      const frame = element.getBoundingClientRect();
      const box = (node: HTMLElement | null) =>
        node
          ? {
              top: node.getBoundingClientRect().top - frame.top,
              bottom: node.getBoundingClientRect().bottom - frame.top,
            }
          : null;
      return {
        ink: title ? getComputedStyle(title).color : null,
        font: title ? getComputedStyle(title).fontSize : null,
        letterSpacing: title ? getComputedStyle(title).letterSpacing : null,
        style: (element as HTMLElement).dataset.style,
        status: (element as HTMLElement).dataset.status,
        image: box(image),
        imageFit: image ? getComputedStyle(image).objectFit : null,
        foot: box(pick<HTMLElement>(".spine-foot")),
        scrim: Boolean(pick(".spine-smoke")),
        band: Boolean(pick(".spine-band")),
        ribbon: Boolean(pick(".gold-ribbon")),
      };
    });

    await longPress(page, source);
    const ghost = page.getByTestId("spine-drag-ghost");
    await expect(ghost).toHaveAttribute("data-style", expected);
    await expect(ghost).toHaveAttribute(
      "data-status",
      books[index].readingStatus,
    );
    await expect(ghost).toHaveClass(/drag-ghost/);
    await expect(ghost.locator(".spine-band")).toHaveCount(0);
    if (expected === "typography") {
      await expect(ghost.locator("img.spine-generated")).toHaveCount(0);
      await expect(ghost.locator(".spine-smoke")).toHaveCount(0);
      await expect(ghost.locator(".spine-foot")).toHaveCount(0);
    } else {
      const image = ghost.locator("img.spine-generated");
      await expect(image).toBeVisible();
      await expect(image).toHaveCSS("object-fit", "fill");
      expect(
        await image.evaluate((img) => (img as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      await expect(ghost.locator(".spine-smoke")).toHaveCount(1);
      await expect(ghost.locator(".spine-foot")).toHaveCount(1);
      await expect(ghost.locator(".spine-foot .sa")).toBeVisible();
    }
    const after = await ghost.evaluate((element) => {
      const pick = <T extends HTMLElement>(selector: string) =>
        element.querySelector<T>(selector);
      const title = pick<HTMLElement>(".st");
      const image = pick<HTMLImageElement>("img.spine-generated");
      const foot = pick<HTMLElement>(".spine-foot");
      const frame = element.getBoundingClientRect();
      const box = (node: HTMLElement | null) =>
        node
          ? {
              top: node.getBoundingClientRect().top - frame.top,
              bottom: node.getBoundingClientRect().bottom - frame.top,
            }
          : null;
      return {
        ink: title ? getComputedStyle(title).color : null,
        font: title ? getComputedStyle(title).fontSize : null,
        letterSpacing: title ? getComputedStyle(title).letterSpacing : null,
        style: (element as HTMLElement).dataset.style,
        status: (element as HTMLElement).dataset.status,
        image: box(image),
        foot: box(foot),
        height: frame.height,
        authorInFoot: Boolean(foot && pick(".spine-foot .sa")),
        ribbon: Boolean(pick(".gold-ribbon")),
        drape: Boolean(pick(".spine-drape.is-inline")),
      };
    });
    expect(after.style).toBe(expected);
    expect(after.status).toBe(before.status);
    expect(after.ink).toBe(before.ink);
    expect(after.font).toBe(before.font);
    // Sub-pixel fit rounding may shift the tracking by a hundredth of a pixel.
    const spacing = (value: string | null) =>
      value && value !== "normal" ? Number.parseFloat(value) : 0;
    expect(
      Math.abs(spacing(after.letterSpacing) - spacing(before.letterSpacing)),
    ).toBeLessThan(0.05);
    expect(after.scrim ?? before.scrim).toBe(before.scrim);
    if (expected === "art") {
      // The ghost is lifted by scale(1.04); ratios, not pixels, match.
      expect(after.image?.top).toBeCloseTo(0, 0);
      expect(after.image?.bottom).toBeCloseTo(after.height, 0);
      expect(after.foot?.bottom).toBeCloseTo(after.height, 0);
      expect(after.authorInFoot).toBe(true);
      expect(after.ribbon).toBe(books[index].readingStatus === "finished");
      expect(after.drape).toBe(books[index].readingStatus === "reading");
    }
    // The only change on the shelf is the source fading out.
    await expect(source).toHaveCSS("opacity", "0");
    await page.screenshot({
      path: testInfo.outputPath(`drag-${expected}-${index}.png`),
    });
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
  }
});

for (const width of [390, 320]) {
  test(`S1 Art is full-height smoked leather at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const books = [
      mockBook(1, "Dune", "art"),
      mockBook(2, "Rock Paper Scissors", "art", {
        readingStatus: "finished",
        labels: [
          { id: 1, name: "Favourite", colour: "#6e2630" },
          { id: 2, name: "Book club", colour: "#214d4c" },
        ],
      }),
      // A retired row still renders as Wrap.
      mockBook(3, "The Picture of Dorian Gray", "full-bleed"),
      mockBook(4, "Rock Paper Scissors", "cloth"),
      mockBook(5, "Rock Paper Scissors", "typography"),
      mockBook(6, "Anonymous", "art", { authors: [], labels: [] }),
    ];
    await boot(page, books);
    await expect(page.getByTestId("spine-generated")).toHaveCount(4);
    await page.waitForTimeout(300);

    const read = (element: Element) => {
      const spine = element as HTMLElement;
      const pick = <T extends HTMLElement>(selector: string) =>
        spine.querySelector<T>(selector);
      const boxOf = (node: HTMLElement | null) => {
        if (!node) return null;
        // Layout offsets, not rects: a leaning book's rect is rotated.
        return {
          top: node.offsetTop,
          bottom: node.offsetTop + node.offsetHeight,
          height: node.offsetHeight,
          width: node.offsetWidth,
          left: node.offsetLeft,
        };
      };
      const image = pick<HTMLImageElement>("img.spine-generated");
      const title = pick<HTMLElement>(".st");
      const text = pick<HTMLElement>(".spine-text");
      const foot = pick<HTMLElement>(".spine-foot");
      const scrim = pick<HTMLElement>(".spine-smoke");
      const author = pick<HTMLElement>(".spine-foot .sa");
      const label = pick<HTMLElement>(".spine-foot .lb");
      const authorStyle = author ? getComputedStyle(author) : null;
      const labelStyle = label ? getComputedStyle(label) : null;
      return {
        style: spine.dataset.style,
        status: spine.dataset.status,
        height: spine.offsetHeight,
        width: spine.clientWidth,
        topBand: Boolean(pick(".spine-band-top")),
        bottomBand: Boolean(pick(".spine-band-bottom")),
        image: boxOf(image),
        objectFit: image ? getComputedStyle(image).objectFit : null,
        text: boxOf(text),
        titleBox: boxOf(title),
        foot: boxOf(foot),
        footBackground: foot ? getComputedStyle(foot).backgroundImage : null,
        footBorder: foot ? getComputedStyle(foot).borderTopWidth : null,
        smoke: scrim ? getComputedStyle(scrim).backgroundImage : null,
        authorInFoot: Boolean(author),
        authorWriting: authorStyle?.writingMode ?? null,
        authorCaps: authorStyle?.fontVariantCaps ?? null,
        authorText: author?.textContent ?? "",
        authorLineCount: author?.querySelectorAll("span").length ?? 0,
        authorClipped: author
          ? author.scrollWidth > author.clientWidth + 1 ||
            author.scrollHeight > author.clientHeight + 1
          : false,
        authorFont: authorStyle?.fontSize ?? null,
        labelInFoot: Boolean(label),
        labels: spine.querySelectorAll(".spine-foot .lb").length,
        labelChips: [...spine.querySelectorAll<HTMLElement>(".spine-foot .lb")].map(
          (chip) => ({
            short:
              getComputedStyle(chip, "::before").content?.replace(/"/g, "") ??
              "",
            text: chip.textContent ?? "",
            client: chip.clientWidth,
            scroll: chip.scrollWidth,
            font: getComputedStyle(chip).fontSize,
            height: chip.getBoundingClientRect().height,
          }),
        ),
        labelTransform: labelStyle?.textTransform ?? null,
        ribbon: Boolean(pick(".gold-ribbon")),
        drape: Boolean(pick(".spine-drape")),
      };
    };

    const spines: Array<ReturnType<typeof read>> = [];
    for (let index = 0; index < books.length; index += 1) {
      spines.push(
        await page
          .getByTestId("spine")
          .nth(index)
          .evaluate(read as unknown as (element: Element) => ReturnType<typeof read>),
      );
    }
    const [dune, labelled, retired, cloth, typography, empty] = spines;

    for (const wrapped of [dune, labelled, retired]) {
      expect(wrapped.style).toBe("art");
      // No cap band and no foot band: the art is full height under the scrim.
      expect(wrapped.topBand).toBe(false);
      expect(wrapped.bottomBand).toBe(false);
      expect(wrapped.image?.top).toBeCloseTo(0, 1);
      expect(wrapped.image?.bottom).toBeCloseTo(wrapped.height, 1);
      expect(wrapped.image?.height).toBeCloseTo(wrapped.height, 0);
      expect(wrapped.image?.width).toBeCloseTo(wrapped.width, 0);
      expect(wrapped.objectFit).toBe("fill");
      // The scrim is a plain warm gradient, .64 head to .84 tail.
      expect(wrapped.smoke).toContain("rgba(22, 13, 8, 0.64)");
      expect(wrapped.smoke).toContain("rgba(14, 8, 4, 0.84)");
      // The foot is the scrim's darkest 30%, not a painted band.
      expect(wrapped.foot).not.toBeNull();
      expect(wrapped.foot!.height / wrapped.height).toBeCloseTo(0.3, 2);
      expect(wrapped.foot!.bottom).toBeCloseTo(wrapped.height, 1);
      expect(wrapped.footBackground).toBe("none");
      expect(wrapped.footBorder).toBe("0px");
      // The title box: 10px head (28px finished), foot at 70% + 4px gap.
      const head = wrapped.status === "finished" ? 28 : 10;
      expect(wrapped.text!.top).toBeCloseTo(head, 0);
      expect(
        wrapped.height - wrapped.text!.bottom - wrapped.height * 0.3,
      ).toBeCloseTo(4, 0);
      expect(wrapped.text!.left).toBeCloseTo(2, 0);
      expect(wrapped.text!.bottom).toBeLessThanOrEqual(
        wrapped.foot!.top - 3,
      );
    }

    // Author and chips are inside the deep scrim, horizontal and compact.
    expect(labelled.authorInFoot).toBe(true);
    expect(labelled.authorWriting).toBe("horizontal-tb");
    expect(labelled.authorCaps).toBe("small-caps");
    // The whole name, balanced over two lines and not clipped.
    expect(labelled.authorText).toBe("Alice Feeney");
    expect(labelled.authorLineCount).toBe(2);
    expect(labelled.authorClipped).toBe(false);
    expect(Number.parseFloat(labelled.authorFont ?? "0")).toBeGreaterThan(5);
    expect(labelled.labelInFoot).toBe(true);
    expect(labelled.labelTransform).toBe("uppercase");
    // Full label names stay in the DOM; the visible chip is the 4-5 letter
    // code from `data-short`.
    expect(labelled.labelChips.map((chip) => chip.short)).toEqual([
      "FAVO",
      "BOOK",
    ]);
    expect(labelled.labelChips.map((chip) => chip.text)).toEqual([
      "Favourite",
      "Book club",
    ]);
    for (const chip of labelled.labelChips) {
      expect(chip.short.length).toBeGreaterThanOrEqual(3);
      expect(chip.short.length).toBeLessThanOrEqual(5);
      expect(chip.scroll).toBeLessThanOrEqual(chip.client + 1);
      expect(Number.parseFloat(chip.font)).toBe(5);
      expect(chip.height).toBe(9);
    }
    expect(labelled.ribbon).toBe(true);
    expect(labelled.drape).toBe(false);

    // A book with no author and no labels collapses the foot, so the art
    // still fills the whole spine.
    expect(empty.style).toBe("art");
    expect(empty.foot).toBeNull();
    expect(empty.image?.height).toBeCloseTo(empty.height, 0);
    expect(empty.text!.bottom).toBeGreaterThanOrEqual(
      empty.height * 0.7 - 6,
    );
    expect(empty.text!.bottom).toBeLessThanOrEqual(empty.height * 0.7 - 2);

    // Cloth and Typography keep their full-face layouts.
    expect(cloth.style).toBe("cloth");
    expect(cloth.image).toBeNull();
    expect(cloth.foot).toBeNull();
    expect(typography.style).toBe("typography");
    expect(typography.image).toBeNull();
    expect(typography.foot).toBeNull();

    // The title still fills the middle run.
    for (const index of [0, 1]) {
      const fit = await page
        .getByTestId("spine")
        .nth(index)
        .evaluate(measureTitle as unknown as (element: Element) => TitleFit);
      expect(fit.fill).toBeGreaterThanOrEqual(0.8);
      expect(fit.overflowY).toBeLessThanOrEqual(2);
      expect(fit.inside).toBe(true);
    }

    // No CSS filter or blend mode anywhere in the case.
    const effects = await page.getByTestId("shelf").evaluate((shelf) => {
      const offenders: string[] = [];
      for (const node of [shelf, ...shelf.querySelectorAll<HTMLElement>("*")]) {
        const style = getComputedStyle(node);
        if (style.filter !== "none") offenders.push(`filter:${style.filter}`);
        if (
          style.mixBlendMode !== "normal" ||
          style.backgroundBlendMode !== "normal"
        ) {
          offenders.push(`blend:${style.mixBlendMode}/${style.backgroundBlendMode}`);
        }
      }
      return offenders;
    });
    expect(effects).toEqual([]);
  });
}

for (const width of [390, 320]) {
  test(`Cloth and Typography centre the title and author at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const specs = [
      { title: "Dune", author: "Frank Herbert", labels: 0, finished: false },
      {
        title: "Rock Paper Scissors",
        author: "Alice Feeney",
        labels: 1,
        finished: false,
      },
      {
        title: "The Picture of Dorian Gray",
        author: "Oscar Wilde",
        labels: 2,
        finished: true,
      },
      {
        title:
          "The Extraordinary, Long and Complicated Lighthouse Keeper's Daughter",
        author: "E. Marlowe",
        labels: 0,
        finished: false,
      },
    ];
    const books: Book[] = [];
    for (const style of ["cloth", "typography"] as const) {
      for (const spec of specs) {
        const labels = Array.from({ length: spec.labels }, (_, index) => ({
          id: books.length * 10 + index,
          name: `Label ${index + 1}`,
          colour: index === 0 ? "#6e2630" : "#214d4c",
        }));
        books.push(
          mockBook(books.length + 1, spec.title, style, {
            authors: [spec.author],
            labels,
            readingStatus: spec.finished ? "finished" : "unread",
          }),
        );
      }
    }
    await boot(page, books);
    await expect(page.getByTestId("spine")).toHaveCount(books.length);
    await page.waitForTimeout(400);

    const metrics = await page.getByTestId("spine").evaluateAll((elements) =>
      elements.map((element) => {
        const spine = element as HTMLElement;
        const frame = spine.getBoundingClientRect();
        const box = (node: HTMLElement | null) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top - frame.top,
            bottom: rect.bottom - frame.top,
          };
        };
        const glyphs = (node: HTMLElement | null) => {
          if (!node) return null;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          return {
            top: rect.top - frame.top,
            bottom: rect.bottom - frame.top,
          };
        };
        const pick = (selector: string) =>
          spine.querySelector<HTMLElement>(selector);
        const text = pick(".spine-text");
        const title = pick(".st");
        const author = pick(".sa");
        const labels = [...spine.querySelectorAll<HTMLElement>(".lb")];
        const ribbon = pick(".gold-ribbon");
        const titleGlyph = glyphs(title);
        const authorGlyph = glyphs(author);
        return {
          style: spine.dataset.style,
          status: spine.dataset.status,
          height: spine.offsetHeight,
          text: box(text),
          title: box(title),
          author: box(author),
          labelTop:
            labels.length > 0
              ? Math.min(...labels.map((label) => box(label)!.top))
              : null,
          ribbonTop: ribbon ? ribbon.offsetTop : null,
          titleGlyph,
          authorGlyph,
          titleScroll: title
            ? { scroll: title.scrollHeight, client: title.clientHeight }
            : null,
          authorScroll: author
            ? { scroll: author.scrollHeight, client: author.clientHeight }
            : null,
        };
      }),
    );

    for (const meta of metrics) {
      expect(meta.style === "cloth" || meta.style === "typography").toBe(true);
      const furnitureTop = meta.labelTop ?? Number.POSITIVE_INFINITY;
      const expectedCenter = Number.isFinite(furnitureTop)
        ? ((meta.text?.top ?? 0) + furnitureTop) / 2
        : meta.height / 2;
      const boxCenter = ((meta.text?.top ?? 0) + (meta.text?.bottom ?? 0)) / 2;
      expect(Math.abs(boxCenter - expectedCenter)).toBeLessThanOrEqual(2);
      const glyphTop = Math.min(
        meta.titleGlyph?.top ?? 0,
        meta.authorGlyph?.top ?? 0,
      );
      const glyphBottom = Math.max(
        meta.titleGlyph?.bottom ?? 0,
        meta.authorGlyph?.bottom ?? 0,
      );
      const glyphCenter = (glyphTop + glyphBottom) / 2;
      expect(
        Math.abs(glyphCenter - expectedCenter),
        `${meta.style} centre`,
      ).toBeLessThanOrEqual(2.5);
      if (meta.titleScroll) {
        expect(meta.titleScroll.scroll).toBeLessThanOrEqual(
          meta.titleScroll.client + 2,
        );
      }
      if (meta.authorScroll) {
        expect(meta.authorScroll.scroll).toBeLessThanOrEqual(
          meta.authorScroll.client + 2,
        );
      }
      expect(glyphTop).toBeGreaterThanOrEqual(-0.5);
      expect(glyphBottom).toBeLessThanOrEqual(meta.height + 0.5);
      // Finished reserves the 28px head band on every face.
      if (meta.status === "finished") {
        expect(meta.text!.top).toBeCloseTo(28, 0);
        expect(meta.ribbonTop).toBe(0);
      }
    }
  });
}

function redEdgeStrip(): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="236">` +
        `<rect width="52" height="236" fill="#9b9384"/>` +
        `<rect width="5" height="236" fill="#164a9c"/>` +
        `<rect x="44" width="8" height="236" fill="#d20f24"/>` +
        `</svg>`,
    )
  );
}

for (const width of [390, 320]) {
  test(`Art preserves the strip's side edges at every spine width (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const books: Book[] = [];
    for (let attempt = 0; books.length < 3 && attempt < 40; attempt += 1) {
      const book = mockBook(books.length + 1, "Rock Paper Scissors", "art", {
        contentHash: `edge-${attempt}`,
        slotIndex: attempt,
      });
      const width = shelfSpineStyle(book).width;
      if (!books.some((existing) => shelfSpineStyle(existing).width === width)) {
        books.push(book);
      }
    }
    expect(books).toHaveLength(3);
    await boot(
      page,
      books,
      {},
      Object.fromEntries(books.map((book) => [book.id, redEdgeStrip()])),
    );
    await expect(page.getByTestId("spine-generated")).toHaveCount(3);
    await page.waitForTimeout(300);

    const spines = await page.getByTestId("spine").evaluateAll((elements) =>
      elements.map((element) => ({
        id: (element as HTMLElement).dataset.bookId,
        width: (element as HTMLElement).clientWidth,
        fit: getComputedStyle(
          element.querySelector("img.spine-generated")!,
        ).objectFit,
      })),
    );
    expect(new Set(spines.map((spine) => spine.width)).size).toBe(3);
    // The scrim and the gold hairlines sit over the strip by design; hide them
    // so this test reads the image's own mapped edges.
    await page.addStyleTag({
      content:
        ".spine[data-style='art']::after{display:none!important}" +
        ".spine-smoke,.spine-text,.spine-foot{visibility:hidden!important}",
    });

    for (const spine of spines) {
      expect(spine.fit).toBe("fill");
      const image = page.locator(
        `[data-testid="spine"][data-book-id="${spine.id}"] img.spine-generated`,
      );
      const shot = decodePng(await image.screenshot());
      const rightColumn = (y: number) => {
        const offset = (y * shot.width + shot.width - 1) * shot.channels;
        return [shot.data[offset], shot.data[offset + 1], shot.data[offset + 2]];
      };
      const leftColumn = (y: number) => {
        const offset = y * shot.width * shot.channels;
        return [shot.data[offset], shot.data[offset + 1], shot.data[offset + 2]];
      };
      let red = 0;
      let blue = 0;
      for (let y = 0; y < shot.height; y += 1) {
        const [r, g, b] = rightColumn(y);
        if (r > 100 && r > g + 35 && r > b + 35) red += 1;
        const [lr, lg, lb] = leftColumn(y);
        if (lb > 90 && lb > lr + 30 && lb > lg + 20) blue += 1;
      }
      // The strip's red right edge and blue left edge survive at every
      // thickness: object-fit fill maps the whole 52px composition.
      expect(red / shot.height).toBeGreaterThan(0.3);
      expect(blue / shot.height).toBeGreaterThan(0.3);
    }
  });
}

/* ------------------------------------------------- contrast on real art */

function lightMarbleStrip(): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="236">` +
        `<rect width="52" height="236" fill="#f1eee7"/>` +
        `<path d="M2 10 C 28 46, 8 74, 30 116 S 8 186, 26 230" stroke="#cfcabe" stroke-width="11" fill="none"/>` +
        `<path d="M38 0 C 18 40, 44 82, 20 128 S 40 194, 16 236" stroke="#fbfaf6" stroke-width="7" fill="none"/>` +
        `<path d="M0 60 C 20 78, 34 96, 52 108" stroke="#bdb7a9" stroke-width="5" fill="none"/>` +
        `</svg>`,
    )
  );
}

function darkStrip(): string {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="236">` +
        `<rect width="52" height="236" fill="#211710"/>` +
        `<path d="M4 0 C 26 58, 10 112, 36 166 S 14 210, 30 236" stroke="#2f2318" stroke-width="14" fill="none"/>` +
        `<path d="M42 0 C 20 52, 46 120, 22 176 S 38 218, 20 236" stroke="#3a2b1d" stroke-width="8" fill="none"/>` +
        `</svg>`,
    )
  );
}

interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

function decodePng(buffer: Buffer): DecodedPng {
  let position = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks: Buffer[] = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString("ascii", position + 4, position + 8);
    const data = buffer.subarray(position + 8, position + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      chunks.push(data);
    }
    position += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported png colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source];
    source += 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        y > 0 && x >= channels
          ? pixels[(y - 1) * stride + x - channels]
          : 0;
      let decoded = value;
      if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + ((left + up) >> 1);
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        decoded =
          value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      pixels[y * stride + x] = decoded & 255;
    }
    source += stride;
  }
  return { width, height, channels, data: pixels };
}

function contrastRatio(
  left: [number, number, number],
  right: [number, number, number],
): number {
  const luminance = ([red, green, blue]: [number, number, number]) => {
    const channel = (part: number) => {
      const value = part / 255;
      return value <= 0.03928
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    );
  };
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function pixelStats(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) =>
    sorted[Math.floor(sorted.length * fraction)] ?? 0;
  return { count: sorted.length, min: at(0), p10: at(0.1), median: at(0.5) };
}

for (const width of [390, 320]) {
  test(`the smoked scrim clears 4.5:1 over light and dark art at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const books = [
      mockBook(1, "Rock Paper Scissors", "art"),
      mockBook(2, "The Picture of Dorian Gray", "art"),
    ];
    await boot(page, books, {}, {
      1: lightMarbleStrip(),
      2: darkStrip(),
    });
    await expect(page.getByTestId("spine-generated")).toHaveCount(2);
    await page.waitForTimeout(500);

    const inks = await page.getByTestId("spine").evaluateAll((spines) =>
      spines.map((spine) => {
        const title = spine.querySelector<HTMLElement>(".st");
        const style = title ? getComputedStyle(title) : null;
        return {
          colour: style?.color ?? null,
          stroke: style?.getPropertyValue("-webkit-text-stroke") ?? null,
          adaptive: title?.classList.contains("is-adaptive") ?? false,
        };
      }),
    );
    // The scrim standardises the art, so the ink is always the same cream and
    // there is no adaptive halo.
    for (const ink of inks) {
      expect(ink.colour).toBe("rgb(244, 230, 196)");
      expect(ink.adaptive).toBe(false);
      expect(ink.stroke).not.toContain("1px");
    }

    for (const index of [0, 1]) {
      const spine = page.getByTestId("spine").nth(index);
      const box = await spine.boundingBox();
      if (!box) throw new Error("spine has no box");
      const withText = await page.screenshot({ clip: box });
      await spine.evaluate((element) => {
        element.querySelectorAll(".st").forEach((node) => {
          (node as HTMLElement).style.visibility = "hidden";
        });
      });
      const behind = await page.screenshot({ clip: box });
      await spine.evaluate((element) => {
        element.querySelectorAll(".st").forEach((node) => {
          (node as HTMLElement).style.visibility = "";
        });
      });

      const shown = decodePng(withText);
      const hidden = decodePng(behind);
      const inkVsArt: number[] = [];
      for (let y = 0; y < shown.height; y += 1) {
        for (let x = 0; x < shown.width; x += 1) {
          const offset = (y * shown.width + x) * shown.channels;
          const a: [number, number, number] = [
            shown.data[offset],
            shown.data[offset + 1],
            shown.data[offset + 2],
          ];
          const b: [number, number, number] = [
            hidden.data[offset],
            hidden.data[offset + 1],
            hidden.data[offset + 2],
          ];
          const rawDelta = Math.max(
            Math.abs(a[0] - b[0]),
            Math.abs(a[1] - b[1]),
            Math.abs(a[2] - b[2]),
          );
          if (rawDelta >= 150) inkVsArt.push(contrastRatio(a, b));
        }
      }
      const raw = pixelStats(inkVsArt);
      expect(raw.count).toBeGreaterThan(200);
      expect(raw.min).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const width of [390, 320]) {
  test(`Art fits a long author over two lines at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page, [
      mockBook(1, "The Hollow Crown", "art", {
        authors: ["A. Very Long Author Name"],
        labels: [{ id: 1, name: "Favourite", colour: "#6e2630" }],
      }),
    ]);
    await expect(page.getByTestId("spine")).toHaveCount(1);
    await page.waitForTimeout(400);

    const author = page.locator(".spine-foot .sa");
    const metrics = await author.evaluate((element) => {
      const node = element as HTMLElement;
      const style = getComputedStyle(node);
      return {
        text: node.textContent,
        lines: node.querySelectorAll("span").length,
        font: Number.parseFloat(style.fontSize),
        clipped:
          node.scrollWidth > node.clientWidth + 1 ||
          node.scrollHeight > node.clientHeight + 1,
        inFoot: Boolean(node.closest(".spine-foot")),
      };
    });
    expect(metrics.text).toBe("A. Very Long Author Name");
    expect(metrics.lines).toBe(2);
    expect(metrics.clipped).toBe(false);
    expect(metrics.inFoot).toBe(true);
    // The name starts at 6.2px and shrinks toward the 4.2px floor.
    expect(metrics.font).toBeLessThanOrEqual(6.2);
    expect(metrics.font).toBeGreaterThanOrEqual(4.19);
  });
}

for (const width of [430, 390, 360, 320]) {
  test(`the S1 shelf has no overflow and no clipped title at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const books = [
      mockBook(1, "The Whisper Man", "art", {
        readingStatus: "finished",
        labels: [{ id: 1, name: "Crime", colour: "#6e2630" }],
      }),
      mockBook(2, "Ready Player One", "art", {
        readingStatus: "reading",
        labels: [{ id: 2, name: "Sci-Fi", colour: "#214d4c" }],
      }),
      mockBook(3, "The Shadow Friend", "art", { readingStatus: "reading" }),
      mockBook(4, "Everyone in My Family Has Killed Someone", "art", {
        authors: ["Benjamin Stevenson"],
        readingStatus: "reading",
        labels: [
          { id: 3, name: "Humour", colour: "#7a5a26" },
          { id: 4, name: "Family", colour: "#2f4a3c" },
          { id: 5, name: "Crime", colour: "#6e2630" },
        ],
      }),
      mockBook(5, "The Collector", "art", { readingStatus: "finished" }),
      mockBook(6, "Needful Things", "art"),
      mockBook(7, "The Picture of Dorian Gray", "art"),
    ];
    await boot(page, books);
    await expect(page.getByTestId("spine")).toHaveCount(books.length);
    await page.waitForTimeout(300);

    const sizes = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        doc: root.scrollWidth - root.clientWidth,
        body: body.scrollWidth - body.clientWidth,
      };
    });
    expect(sizes.doc).toBeLessThanOrEqual(1);
    expect(sizes.body).toBeLessThanOrEqual(1);

    const fits = await page.getByTestId("spine").evaluateAll((spines) =>
      spines.map((spine) => {
        const frame = (spine as HTMLElement).getBoundingClientRect();
        const title = spine.querySelector<HTMLElement>(".st")!;
        const text = spine.querySelector<HTMLElement>(".spine-text")!;
        const titleBox = title.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        const groups = [
          ...title.querySelectorAll<HTMLElement>(".st-col"),
        ];
        const ranges = (groups.length > 0 ? groups : [title]).map((group) => {
          const range = document.createRange();
          range.selectNodeContents(group);
          return range.getBoundingClientRect();
        });
        return {
          title: title.textContent,
          insideSpine:
            titleBox.top >= frame.top - 1 &&
            titleBox.bottom <= frame.bottom + 1 &&
            titleBox.left >= frame.left - 1 &&
            titleBox.right <= frame.right + 1,
          insideBox: ranges.every(
            (box) =>
              box.top >= textBox.top - 1 && box.bottom <= textBox.bottom + 1,
          ),
          clipped: title.scrollHeight > title.clientHeight + 1,
        };
      }),
    );
    for (const fit of fits) {
      expect(fit.insideSpine, `${fit.title} inside spine`).toBe(true);
      expect(fit.insideBox, `${fit.title} glyph inside box`).toBe(true);
      expect(fit.clipped, `${fit.title} clipped`).toBe(false);
    }
  });
}

/* ------------------------------------------------------- status language */

function positionedBook(
  id: number,
  title: string,
  overrides: Partial<Book> = {},
): Book {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = mockBook(id, title, "art", {
      contentHash: `position-${id}-${title}-${attempt}`,
      slotIndex: id - 1 + attempt * 17,
      ...overrides,
    });
    if (shelfSpineStyle(candidate).width === 27) return candidate;
  }
  throw new Error(`no 27px spine for ${title}`);
}

test("reading is a drape past the lip, finished is a gold head ribbon", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const books = [
    positionedBook(1, "The Whisper Man", {
      authors: ["Alex North"],
      readingStatus: "finished",
      labels: [
        { id: 1, name: "Crime", colour: "#6e2630" },
        { id: 2, name: "Gothic", colour: "#4b2d5c" },
      ],
    }),
    positionedBook(2, "Ready Player One", {
      authors: ["Ernest Cline"],
      readingStatus: "reading",
      labels: [{ id: 3, name: "Sci-Fi", colour: "#214d4c" }],
    }),
    positionedBook(3, "The Shadow Friend", {
      authors: ["Alex North"],
      readingStatus: "reading",
      labels: [{ id: 1, name: "Crime", colour: "#6e2630" }],
    }),
    positionedBook(4, "Needful Things", {
      authors: ["Stephen King"],
      readingStatus: "unread",
      labels: [{ id: 4, name: "Horror", colour: "#5d1f2a" }],
    }),
  ];
  await boot(page, books);
  await expect(page.getByTestId("spine")).toHaveCount(4);
  await page.waitForTimeout(500);

  // Exactly the reading books have a drape, in the case-level cue layer.
  await expect(page.getByTestId("spine-drape")).toHaveCount(2);
  const drapeIds = await page
    .getByTestId("spine-drape")
    .evaluateAll((drapes) =>
      drapes.map((drape) => (drape as HTMLElement).dataset.bookId),
    );
  expect(new Set(drapeIds)).toEqual(new Set(["2", "3"]));

  // Finished books carry the gold head ribbon; unread books carry neither.
  const marks = await page.getByTestId("spine").evaluateAll((spines) =>
    spines.map((spine) => {
      const element = spine as HTMLElement;
      const ribbon = element.querySelector<HTMLElement>(".gold-ribbon");
      const text = element.querySelector<HTMLElement>(".spine-text")!;
      return {
        id: element.dataset.bookId,
        status: element.dataset.status,
        ribbon: ribbon
          ? {
              // Offsets, not rects: a leaning book rotates its rect.
              top: ribbon.offsetTop,
              right:
                element.clientWidth - ribbon.offsetLeft - ribbon.offsetWidth,
              width: ribbon.offsetWidth,
              height: ribbon.offsetHeight,
            }
          : null,
        titleTop: text.offsetTop,
        aria: element.getAttribute("aria-label"),
      };
    }),
  );

  for (const meta of marks) {
    if (meta.status === "finished") {
      expect(meta.ribbon, `finished ${meta.id} ribbon`).not.toBeNull();
      expect(meta.ribbon!.width).toBeCloseTo(8, 0);
      expect(meta.ribbon!.height).toBeCloseTo(26, 0);
      expect(meta.ribbon!.top).toBeCloseTo(0, 0);
      expect(meta.ribbon!.right).toBeCloseTo(3, 0);
      // The title box starts below the 26px ribbon's 28px reserve.
      expect(meta.titleTop).toBeGreaterThanOrEqual(27);
      expect(meta.ribbon!.top + meta.ribbon!.height).toBeLessThanOrEqual(
        meta.titleTop - 1,
      );
      expect(meta.aria).toMatch(/Finished/);
    } else {
      expect(meta.ribbon, `${meta.status} ${meta.id} ribbon`).toBeNull();
      expect(meta.aria).toMatch(meta.status === "reading" ? /Reading/ : /Unread/);
    }
  }

  // No book shows both marks: status is exclusive.
  for (const book of books) {
    const both = await page.evaluate((bookId) => {
      const ribbon = document.querySelector(
        `[data-testid="spine"][data-book-id="${bookId}"] .gold-ribbon`,
      );
      const drape = document.querySelector(
        `[data-testid="spine-drape"][data-book-id="${bookId}"]`,
      );
      return Boolean(ribbon && drape);
    }, book.id);
    expect(both).toBe(false);
  }

  // The drape hangs from 4px above the book's foot to the bottom of the board.
  const geometry = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>(".v4-board")!;
    const boardBottom = board.getBoundingClientRect().bottom;
    return [...document.querySelectorAll<HTMLElement>(".spine-drape")].map(
      (drape) => {
        const box = drape.getBoundingClientRect();
        const spine = document.querySelector<HTMLElement>(
          `[data-testid="spine"][data-book-id="${drape.dataset.bookId}"]`,
        )!;
        const book = spine.getBoundingClientRect();
        return {
          id: drape.dataset.bookId,
          width: box.width,
          top: box.top,
          bottom: box.bottom,
          left: box.left,
          bookBottom: book.bottom,
          bookRight: book.right,
          boardBottom,
        };
      },
    );
  });
  for (const drape of geometry) {
    expect(drape.width).toBeCloseTo(8, 0);
    expect(drape.top).toBeCloseTo(drape.bookBottom - 4, 0);
    // It passes the clip and reaches the board, not the cavity's foot.
    expect(drape.bottom).toBeGreaterThan(drape.bookBottom + 9);
    expect(drape.bottom).toBeCloseTo(drape.boardBottom, 0);
    expect(drape.left).toBeCloseTo(drape.bookRight - 10, 0);
  }

  // Prove the drape is painted (not clipped) by finding its oxblood below the
  // cavity's foot, over the lip and board.
  const reading = geometry[0];
  const strip = await page.screenshot({
    clip: {
      x: reading.left,
      y: reading.bookBottom - 2,
      width: 10,
      height: reading.boardBottom - reading.bookBottom + 2,
    },
  });
  const shot = decodePng(strip);
  let red = 0;
  for (let y = 0; y < shot.height; y += 1) {
    for (let x = 0; x < shot.width; x += 1) {
      const offset = (y * shot.width + x) * shot.channels;
      const r = shot.data[offset];
      const g = shot.data[offset + 1];
      const b = shot.data[offset + 2];
      if (r > 60 && r > g + 18 && r > b + 18) red += 1;
    }
  }
  expect(red / (shot.width * shot.height)).toBeGreaterThan(0.35);
  await page.screenshot({
    path: testInfo.outputPath("reading-drape.png"),
    clip: {
      x: reading.bookRight - 14,
      y: reading.bookBottom - 8,
      width: 16,
      height: reading.boardBottom - reading.bookBottom + 12,
    },
  });
});

/* ------------------------------------------------ 27px title containment */

const STRESS: Array<{
  title: string;
  overrides: Partial<Book>;
  columns: number;
  rtl?: boolean;
}> = [
  {
    title: "Forty Characters Make A Long Spine Title",
    overrides: {},
    columns: 2,
  },
  {
    title: "Characteristically",
    overrides: {},
    columns: 1,
  },
  {
    title: "השם של הוורד",
    overrides: { authors: ["David Grossman"] },
    columns: 1,
    rtl: true,
  },
];

for (const width of [390, 320]) {
  test(`27px titles stay inside the title box at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const books = STRESS.map((entry, index) =>
      positionedBook(index + 1, entry.title, entry.overrides),
    );
    for (const book of books) {
      expect(shelfSpineStyle(book).width).toBe(27);
    }
    await boot(page, books);
    await expect(page.getByTestId("spine")).toHaveCount(books.length);
    await page.waitForTimeout(500);

    for (const [index, entry] of STRESS.entries()) {
      const spine = page.getByTestId("spine").nth(index);
      const fit = await spine.evaluate(
        measureTitle as unknown as (element: Element) => TitleFit,
      );
      const textContent = await spine.locator(".st").textContent();
      // Nothing truncated, nothing moved outside the box.
      expect(textContent?.replace(/\s+/g, " ").trim()).toBe(entry.title);
      expect(fit.columns, `${entry.title} columns`).toBeLessThanOrEqual(
        entry.columns,
      );
      expect(fit.font, `${entry.title} font`).toBeGreaterThanOrEqual(2.8);
      expect(fit.overflowY, `${entry.title} overflow`).toBeLessThanOrEqual(1);
      expect(fit.inside, `${entry.title} run inside`).toBe(true);
      expect(fit.glyphTop, `${entry.title} glyph top`).toBeGreaterThanOrEqual(
        fit.boxTop - 0.5,
      );
      expect(
        fit.glyphBottom,
        `${entry.title} glyph bottom`,
      ).toBeLessThanOrEqual(fit.boxBottom + 0.5);
      // Title box: 10px head to 70% + 4px gap on a 27px spine.
      expect(fit.boxTop).toBeCloseTo(10, 0);
      expect(fit.boxBottom).toBeLessThanOrEqual(fit.spineHeight * 0.7 - 3);
      // Two-column halves are tracked to the same run; the cap stops a short
      // half being spread into "M a n". A one-column title is tracked out to
      // fill its run, as before.
      if (fit.columns > 1) {
        for (const column of fit.columnFits) {
          expect(column.tracking).toBeLessThanOrEqual(
            fit.font * 0.12 + 0.011,
          );
        }
      }
      const dir = await spine.getAttribute("dir");
      expect(dir).toBe(entry.rtl ? "rtl" : null);
      await spine.screenshot({
        path: testInfo.outputPath(`stress-${width}-${index}.png`),
      });
    }
  });
}

test("a single long word shrinks one column instead of overflowing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // 38 characters, no space to split at: the old two-column branch returned a
  // run that overflowed here.
  const title = "CharacteristicallyUncharacteristically";
  const book = positionedBook(1, title, { authors: ["Alice Feeney"] });
  await boot(page, [book]);
  await expect(page.getByTestId("spine")).toHaveCount(1);
  await page.waitForTimeout(400);

  const fit = await page
    .getByTestId("spine")
    .first()
    .evaluate(measureTitle as unknown as (element: Element) => TitleFit);
  expect(fit.columns).toBe(1);
  expect(fit.font).toBeGreaterThanOrEqual(2.8);
  expect(fit.overflowY).toBeLessThanOrEqual(1);
  expect(fit.inside).toBe(true);
  expect(fit.glyphTop).toBeGreaterThanOrEqual(fit.boxTop - 0.5);
  expect(fit.glyphBottom).toBeLessThanOrEqual(fit.boxBottom + 0.5);
  expect((await page.locator(".st").textContent())?.replace(/\s+/g, "")).toBe(
    title,
  );
});
