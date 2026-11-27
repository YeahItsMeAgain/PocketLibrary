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
}

interface TitleFit {
  fill: number;
  columns: number;
  columnFits: TitleColumnFit[];
  overflowY: number;
  font: number;
  letterSpacing: number;
  inside: boolean;
}

function measureTitle(element: HTMLElement): TitleFit {
  const title = element.querySelector<HTMLElement>(".st");
  if (!title) throw new Error("no title");
  const style = getComputedStyle(title);
  const box = title.getBoundingClientRect();
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
    };
  });
  const minFill = Math.min(...columnFits.map((column) => column.fill));
  const inside = columnFits.every((column) => {
    const range = document.createRange();
    range.selectNodeContents(
      columnNodes.length > 0 ? groups[columnFits.indexOf(column)] : title,
    );
    const rect = range.getBoundingClientRect();
    return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;
  });
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
      expect(fit.fill, `${title} fill`).toBeGreaterThanOrEqual(0.85);
      expect(fit.fill, `${title} fill`).toBeLessThanOrEqual(1.02);
      expect(fit.columns, `${title} columns`).toBeLessThanOrEqual(2);
      expect(fit.overflowY, `${title} overflow`).toBeLessThanOrEqual(2);
      expect(fit.inside, `${title} glyph inside box`).toBe(true);
      expect(fit.font, `${title} font`).toBeGreaterThan(2.5);
      // Two-column titles must carry type down both columns, not leave the
      // second one half empty.
      for (const [column, metrics] of fit.columnFits.entries()) {
        expect(
          metrics.fill,
          `${title} column ${column} fill`,
        ).toBeGreaterThanOrEqual(0.85);
        expect(
          metrics.gap,
          `${title} column ${column} empty gap`,
        ).toBeLessThanOrEqual(0.15);
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
  const books = [
    mockBook(1, "Rock Paper Scissors", "art", {
      readingStatus: "finished",
      labels: [{ id: 1, name: "Thriller", colour: "#7a2828" }],
    }),
    mockBook(2, "Dune", "typography"),
    // A row that still carries the retired style renders as Wrap.
    mockBook(3, "The Picture of Dorian Gray", "full-bleed"),
  ];
  await boot(page, books);
  await expect(page.getByTestId("spine-generated")).toHaveCount(2);
  // Let the per-strip ink sample land before comparing source and ghost.
  await page.waitForTimeout(700);

  for (const [index, expected] of [
    [0, "art"],
    [1, "typography"],
    [2, "art"],
  ] as const) {
    const bookId = books[index].id;
    const source = page.locator(
      `[data-testid="spine"][data-book-id="${bookId}"]`,
    );
    const before = await source.evaluate((element) => {
      const title = element.querySelector<HTMLElement>(".st");
      const top = element.querySelector<HTMLElement>(".spine-band-top");
      const bottom = element.querySelector<HTMLElement>(".spine-band-bottom");
      const image = element.querySelector<HTMLImageElement>("img.spine-generated");
      const frame = element.getBoundingClientRect();
      return {
        ink: title ? getComputedStyle(title).color : null,
        font: title ? getComputedStyle(title).fontSize : null,
        letterSpacing: title ? getComputedStyle(title).letterSpacing : null,
        style: (element as HTMLElement).dataset.style,
        topBand: top
          ? {
              height: top.getBoundingClientRect().height,
              top: top.getBoundingClientRect().top - frame.top,
              bottom: top.getBoundingClientRect().bottom - frame.top,
            }
          : null,
        bottomBand: bottom
          ? {
              height: bottom.getBoundingClientRect().height,
              top: bottom.getBoundingClientRect().top - frame.top,
              bottom: bottom.getBoundingClientRect().bottom - frame.top,
            }
          : null,
        image: image
          ? {
              top: image.getBoundingClientRect().top - frame.top,
              bottom: image.getBoundingClientRect().bottom - frame.top,
            }
          : null,
      };
    });

    await longPress(page, source);
    const ghost = page.getByTestId("spine-drag-ghost");
    await expect(ghost).toHaveAttribute("data-style", expected);
    await expect(ghost).toHaveClass(/drag-ghost/);
    await expect(ghost.locator(".spine-scrim")).toHaveCount(0);
    if (expected === "typography") {
      await expect(ghost.locator("img.spine-generated")).toHaveCount(0);
      await expect(ghost.locator(".spine-band")).toHaveCount(0);
    } else {
      const image = ghost.locator("img.spine-generated");
      await expect(image).toBeVisible();
      await expect(image).toHaveCSS("object-fit", "fill");
      expect(
        await image.evaluate((img) => (img as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      await expect(ghost.locator(".spine-band-top")).toHaveCount(0);
      await expect(ghost.locator(".spine-band-bottom")).toHaveCount(1);
      if (index === 0) {
        await expect(
          ghost.locator(".spine-band-bottom .lb").first(),
        ).toBeVisible();
      } else {
        await expect(
          ghost.locator(".spine-band-bottom .sa"),
        ).toBeVisible();
      }
    }
    const after = await ghost.evaluate((element) => {
      const title = element.querySelector<HTMLElement>(".st");
      const top = element.querySelector<HTMLElement>(".spine-band-top");
      const bottom = element.querySelector<HTMLElement>(".spine-band-bottom");
      const image = element.querySelector<HTMLImageElement>("img.spine-generated");
      const frame = element.getBoundingClientRect();
      const author = element.querySelector<HTMLElement>(".spine-band-bottom .sa");
      return {
        ink: title ? getComputedStyle(title).color : null,
        font: title ? getComputedStyle(title).fontSize : null,
        letterSpacing: title ? getComputedStyle(title).letterSpacing : null,
        style: (element as HTMLElement).dataset.style,
        topBand: top
          ? {
              height: top.getBoundingClientRect().height,
              top: top.getBoundingClientRect().top - frame.top,
              bottom: top.getBoundingClientRect().bottom - frame.top,
            }
          : null,
        bottomBand: bottom
          ? {
              height: bottom.getBoundingClientRect().height,
              top: bottom.getBoundingClientRect().top - frame.top,
              bottom: bottom.getBoundingClientRect().bottom - frame.top,
            }
          : null,
        image: image
          ? {
              top: image.getBoundingClientRect().top - frame.top,
              bottom: image.getBoundingClientRect().bottom - frame.top,
            }
          : null,
        authorInBand: Boolean(author),
      };
    });
    expect(after.style).toBe(expected);
    expect(after.ink).toBe(before.ink);
    expect(after.font).toBe(before.font);
    // Sub-pixel fit rounding may shift the tracking by a hundredth of a pixel.
    const spacing = (value: string | null) =>
      value && value !== "normal" ? Number.parseFloat(value) : 0;
    expect(
      Math.abs(spacing(after.letterSpacing) - spacing(before.letterSpacing)),
    ).toBeLessThan(0.05);
    if (expected === "art") {
      const ghostHeight = (await ghost.boundingBox())?.height ?? 1;
      const ghostBottom = after.bottomBand?.height ?? 0;
      // The ghost is lifted by scale(1.04); ratios, not pixels, must match.
      expect(after.topBand).toBeNull();
      expect(ghostBottom / ghostHeight).toBeCloseTo(0.27, 2);
      // With no cap band the art starts at the spine's top edge.
      expect(after.image?.top).toBeCloseTo(0, 0);
      expect(after.image?.bottom).toBeCloseTo(
        after.bottomBand?.top ?? 0,
        0,
      );
      expect(after.authorInBand).toBe(true);
    }
    // The only change on the shelf is the source fading out.
    await expect(source).toHaveCSS("opacity", "0");
    await page.screenshot({
      path: testInfo.outputPath(`drag-${expected}.png`),
    });
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
  }
});

for (const width of [390, 320]) {
  test(`Art runs to the top edge above its foot band at ${width}px`, async ({
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
      const pick = (selector: string) =>
        spine.querySelector<HTMLElement>(selector);
      const boxOf = (node: HTMLElement | null) => {
        if (!node) return null;
        return {
          top: node.offsetTop,
          bottom: node.offsetTop + node.offsetHeight,
          height: node.offsetHeight,
          width: node.offsetWidth,
        };
      };
      const image = pick("img.spine-generated");
      const title = pick(".st");
      const text = pick(".spine-text");
      const author = pick(".spine-band-bottom .sa");
      const label = pick(".spine-band-bottom .lb");
      const authorStyle = author ? getComputedStyle(author) : null;
      const labelStyle = label ? getComputedStyle(label) : null;
      return {
        style: spine.dataset.style,
        height: spine.offsetHeight,
        width: spine.clientWidth,
        topBand: boxOf(pick(".spine-band-top")),
        bottomBand: boxOf(pick(".spine-band-bottom")),
        image: boxOf(image),
        objectFit: image ? getComputedStyle(image).objectFit : null,
        text: boxOf(text),
        titleBox: boxOf(title),
        hasFrame: Boolean(pick(".spine-scrim")),
        authorInBand: Boolean(author),
        authorWriting: authorStyle?.writingMode ?? null,
        authorCaps: authorStyle?.fontVariantCaps ?? null,
        authorText: author?.textContent ?? "",
        authorLineCount: author?.querySelectorAll("span").length ?? 0,
        authorClipped: author
          ? author.scrollWidth > author.clientWidth + 1 ||
            author.scrollHeight > author.clientHeight + 1
          : false,
        authorFont: authorStyle?.fontSize ?? null,
        labelInBand: Boolean(label),
        labels: spine.querySelectorAll(".spine-band-bottom .lb").length,
        labelChips: [...spine.querySelectorAll<HTMLElement>(".spine-band-bottom .lb")].map(
          (chip) => ({
            short:
              chip.querySelector<HTMLElement>(".lb-name")?.textContent ??
              chip.dataset.short ??
              "",
            text:
              chip.querySelector<HTMLElement>(".lb-name")?.textContent ?? "",
            client: chip.clientWidth,
            scroll: chip.scrollWidth,
            font: getComputedStyle(chip).fontSize,
          }),
        ),
        labelTransform: labelStyle?.textTransform ?? null,
        labelOverflow: labelStyle?.textOverflow ?? null,
        seal: Boolean(pick(".seal")),
        ribbon: Boolean(pick(".ribbon")),
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
      expect(wrapped.hasFrame).toBe(false);
      // No cap band; foot ~27%, art exactly the 73% above it.
      expect(wrapped.topBand).toBeNull();
      expect(wrapped.bottomBand!.height / wrapped.height).toBeCloseTo(0.27, 2);
      expect(
        (wrapped.height - wrapped.bottomBand!.height - wrapped.bottomBand!.top) /
          wrapped.height,
      ).toBeLessThan(0.01);
      expect(wrapped.image?.top).toBeCloseTo(0, 0);
      expect(
        Math.abs((wrapped.image?.bottom ?? 0) - wrapped.bottomBand!.top),
      ).toBeLessThan(1.5);
      expect(wrapped.image!.height / wrapped.height).toBeCloseTo(0.73, 2);
      expect(wrapped.image?.width).toBeCloseTo(wrapped.width, 1);
      expect(wrapped.objectFit).toBe("fill");
      // The title lives only above the foot band.
      expect(wrapped.text!.top).toBeGreaterThanOrEqual(2);
      expect(wrapped.text!.bottom).toBeLessThanOrEqual(
        wrapped.bottomBand!.top + 1,
      );
      expect(
        Math.abs(wrapped.text!.height - (wrapped.bottomBand!.top - 6)),
      ).toBeLessThan(3);
      expect(
        Math.abs(
          (wrapped.text!.top + wrapped.text!.bottom) / 2 -
            wrapped.bottomBand!.top / 2,
        ),
      ).toBeLessThanOrEqual(2);
    }

    // Author and chips are inside the foot band, horizontal and compact.
    expect(labelled.authorInBand).toBe(true);
    expect(labelled.authorWriting).toBe("horizontal-tb");
    expect(labelled.authorCaps).toBe("small-caps");
    // The whole name, balanced over two lines and not clipped.
    expect(labelled.authorText).toBe("Alice Feeney");
    expect(labelled.authorLineCount).toBe(2);
    expect(labelled.authorClipped).toBe(false);
    expect(Number.parseFloat(labelled.authorFont ?? "0")).toBeGreaterThan(5);
    expect(labelled.labelInBand).toBe(true);
    expect(labelled.labelTransform).toBe("uppercase");
    expect(labelled.labelOverflow).toBe("ellipsis");
    // Full label names, not four-letter abbreviations; two chips fit the band.
    expect(labelled.labelChips.map((chip) => chip.short)).toEqual([
      "Favourite",
      "Book club",
    ]);
    for (const chip of labelled.labelChips) {
      expect(chip.short.length).toBeGreaterThan(4);
      expect(chip.text).toContain(chip.short);
      expect(chip.scroll).toBeLessThanOrEqual(chip.client + 1);
      expect(Number.parseFloat(chip.font)).toBeGreaterThanOrEqual(3.9);
    }
    expect(labelled.seal).toBe(true);

    // A book with no author and no labels collapses the foot band, so the art
    // fills the whole spine.
    expect(empty.style).toBe("art");
    expect(empty.bottomBand).toBeNull();
    expect(empty.image!.height / empty.height).toBeCloseTo(1, 2);
    expect(empty.text!.bottom).toBeCloseTo(empty.height - 3, 0);

    // Cloth and Typography keep their full-face layouts.
    expect(cloth.style).toBe("cloth");
    expect(cloth.topBand).toBeNull();
    expect(cloth.bottomBand).toBeNull();
    expect(cloth.image).toBeNull();
    expect(typography.style).toBe("typography");
    expect(typography.topBand).toBeNull();
    expect(typography.bottomBand).toBeNull();
    expect(typography.image).toBeNull();

    // The title still fills the middle run.
    for (const index of [0, 1]) {
      const fit = await page
        .getByTestId("spine")
        .nth(index)
        .evaluate(measureTitle as unknown as (element: Element) => TitleFit);
      expect(fit.fill).toBeGreaterThanOrEqual(0.85);
      expect(fit.overflowY).toBeLessThanOrEqual(2);
    }
  });
}

for (const width of [390, 320]) {
  test(`Cloth and Typography centre the title and author at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const specs = [
      { title: "Dune", author: "Frank Herbert", labels: 0, seal: false },
      {
        title: "Rock Paper Scissors",
        author: "Alice Feeney",
        labels: 1,
        seal: false,
      },
      {
        title: "The Picture of Dorian Gray",
        author: "Oscar Wilde",
        labels: 2,
        seal: true,
      },
      {
        title:
          "The Extraordinary, Long and Complicated Lighthouse Keeper's Daughter",
        author: "E. Marlowe",
        labels: 0,
        seal: false,
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
            readingStatus: spec.seal ? "finished" : "unread",
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
        const seal = pick(".seal");
        const titleGlyph = glyphs(title);
        const authorGlyph = glyphs(author);
        return {
          style: spine.dataset.style,
          height: spine.offsetHeight,
          text: box(text),
          title: box(title),
          author: box(author),
          labelTop:
            labels.length > 0
              ? Math.min(...labels.map((label) => box(label)!.top))
              : null,
          sealTop: seal ? box(seal)!.top : null,
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
      const furnitureTop = Math.min(
        meta.labelTop ?? Number.POSITIVE_INFINITY,
        meta.sealTop ?? Number.POSITIVE_INFINITY,
      );
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
  test(`adaptive ink clears 4.5:1 over light and dark art at ${width}px`, async ({
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
    await page.waitForTimeout(900);

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
    expect(inks[0].adaptive).toBe(true);
    expect(inks[0].colour).toBe("rgb(42, 26, 16)");
    expect(inks[1].colour).toBe("rgb(244, 230, 196)");
    expect(inks[0].stroke).not.toBe("0px");

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
          const title = node as HTMLElement;
          title.style.visibility = "";
          title.style.color = "transparent";
          title.style.textShadow = "none";
        });
      });
      const haloOnly = await page.screenshot({ clip: box });
      await spine.evaluate((element) => {
        element.querySelectorAll(".st").forEach((node) => {
          const title = node as HTMLElement;
          title.style.color = "";
          title.style.textShadow = "";
        });
      });

      const shown = decodePng(withText);
      const hidden = decodePng(behind);
      const halo = decodePng(haloOnly);
      const fillVsHalo: number[] = [];
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
          const c: [number, number, number] = [
            halo.data[offset],
            halo.data[offset + 1],
            halo.data[offset + 2],
          ];
          const fillDelta = Math.max(
            Math.abs(a[0] - c[0]),
            Math.abs(a[1] - c[1]),
            Math.abs(a[2] - c[2]),
          );
          if (fillDelta >= 150) fillVsHalo.push(contrastRatio(a, c));
          const rawDelta = Math.max(
            Math.abs(a[0] - b[0]),
            Math.abs(a[1] - b[1]),
            Math.abs(a[2] - b[2]),
          );
          if (rawDelta >= 150) inkVsArt.push(contrastRatio(a, b));
        }
      }
      const fill = pixelStats(fillVsHalo);
      const raw = pixelStats(inkVsArt);
      expect(fill.count).toBeGreaterThan(200);
      expect(fill.min).toBeGreaterThanOrEqual(4.5);
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

    const author = page.locator(".spine-band-bottom .sa");
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
        inBand: Boolean(node.closest(".spine-band-bottom")),
      };
    });
    expect(metrics.text).toBe("A. Very Long Author Name");
    expect(metrics.lines).toBe(2);
    expect(metrics.clipped).toBe(false);
    expect(metrics.inBand).toBe(true);
    // The name shrinks below the 6.8px start but never below the 4.2px floor.
    expect(metrics.font).toBeLessThanOrEqual(6.8);
    expect(metrics.font).toBeGreaterThanOrEqual(4.19);
  });
}
