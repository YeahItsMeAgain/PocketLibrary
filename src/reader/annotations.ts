/**
 * Annotation anchoring for the EPUB reader.
 *
 * A saved locator is Readium-shaped: an href, a CFI fragment, progression and
 * text context, plus W3C TextQuote and TextPosition selectors. Resolution tries
 * the CFI first, validates the quoted text, then searches the section and the
 * whole book before falling back to raw character offsets. A recovered CFI is
 * written back by the reader, so small edits repair themselves.
 */
import type { FoliateView } from "./foliate";

export const ANNOTATION_COLOURS: ReadonlyArray<{
  name: string;
  colour: string;
}> = [
  { name: "Brass", colour: "#b08a45" },
  { name: "Sage", colour: "#778b6c" },
  { name: "Rose", colour: "#a86c72" },
  { name: "Slate", colour: "#6d8197" },
];

export const DEFAULT_ANNOTATION_COLOUR = ANNOTATION_COLOURS[0].colour;
export const HIGHLIGHT_OPACITY = 0.38;

export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

export interface AnnotationLocator {
  v: 2;
  href: string;
  title?: string;
  locations: {
    fragments: string[];
    progression?: number;
    totalProgression?: number;
    position?: number;
  };
  text: {
    before?: string;
    highlight: string;
    after?: string;
  };
  selectors: {
    quote: TextQuoteSelector;
    position?: TextPositionSelector;
  };
}

interface SectionLike {
  id?: string;
  createDocument?: () => Promise<Document>;
}

interface BookLike {
  sections?: SectionLike[];
}

interface ResolvedAnnotation {
  cfi: string;
  repaired: boolean;
}

const CONTEXT_LENGTH = 64;
const SEARCH_QUERY_LENGTH = 72;

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function sectionIndexForHref(
  view: FoliateView,
  href: string | undefined,
): number {
  if (!href) return -1;
  const sections = (view.book as BookLike | undefined)?.sections ?? [];
  const target = decode(href.split("#")[0]);
  return sections.findIndex((section) => {
    const id = section.id ? decode(section.id.split("#")[0]) : "";
    return id === target;
  });
}

function annotationLocatorValue(value: unknown): AnnotationLocator | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AnnotationLocator>;
  if (raw.v !== 2 || typeof raw.href !== "string") return null;
  const cfi = raw.locations?.fragments?.[0];
  const exact = raw.selectors?.quote?.exact ?? raw.text?.highlight;
  if (typeof cfi !== "string" || !cfi || typeof exact !== "string") {
    return null;
  }
  return {
    v: 2,
    href: raw.href,
    title: typeof raw.title === "string" ? raw.title : undefined,
    locations: {
      fragments: [cfi],
      progression:
        typeof raw.locations?.progression === "number"
          ? raw.locations.progression
          : undefined,
      totalProgression:
        typeof raw.locations?.totalProgression === "number"
          ? raw.locations.totalProgression
          : undefined,
      position:
        typeof raw.locations?.position === "number"
          ? raw.locations.position
          : undefined,
    },
    text: {
      before: typeof raw.text?.before === "string" ? raw.text.before : undefined,
      highlight: exact,
      after: typeof raw.text?.after === "string" ? raw.text.after : undefined,
    },
    selectors: {
      quote: {
        type: "TextQuoteSelector",
        exact,
        prefix:
          typeof raw.selectors?.quote?.prefix === "string"
            ? raw.selectors.quote.prefix
            : undefined,
        suffix:
          typeof raw.selectors?.quote?.suffix === "string"
            ? raw.selectors.quote.suffix
            : undefined,
      },
      position:
        raw.selectors?.position &&
        typeof raw.selectors.position.start === "number" &&
        typeof raw.selectors.position.end === "number"
          ? {
              type: "TextPositionSelector",
              start: raw.selectors.position.start,
              end: raw.selectors.position.end,
            }
          : undefined,
    },
  };
}

/** Parse a stored annotation locator, or null when it is not v2-shaped. */
export function parseAnnotationLocator(
  raw: string | null | undefined,
): AnnotationLocator | null {
  if (!raw) return null;
  try {
    return annotationLocatorValue(JSON.parse(raw));
  } catch {
    return null;
  }
}

function bodyText(doc: Document): string {
  return doc.body?.textContent ?? "";
}

function offsetOfRange(doc: Document, range: Range): number {
  const body = doc.body;
  if (!body) return 0;
  const before = doc.createRange();
  before.selectNodeContents(body);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/** Build the locator saved for a fresh selection. */
export function buildAnnotationLocator(
  view: FoliateView,
  index: number,
  range: Range,
  progression: number,
  title?: string,
): AnnotationLocator {
  const section = (view.book as BookLike | undefined)?.sections?.[index];
  const doc = range.startContainer.ownerDocument ?? range.commonAncestorContainer.ownerDocument;
  const raw = doc ? bodyText(doc) : "";
  const start = doc ? offsetOfRange(doc, range) : 0;
  const selected = range.toString();
  const end = start + selected.length;
  const exact = normalizeWhitespace(selected);
  const before = normalizeWhitespace(raw.slice(Math.max(0, start - CONTEXT_LENGTH), start));
  const after = normalizeWhitespace(raw.slice(end, end + CONTEXT_LENGTH));
  return {
    v: 2,
    href: section?.id ?? "",
    title,
    locations: {
      fragments: [view.getCFI(index, range)],
      progression,
      totalProgression: progression,
      position: index + 1,
    },
    text: {
      before: before.slice(-CONTEXT_LENGTH) || undefined,
      highlight: exact,
      after: after.slice(0, CONTEXT_LENGTH) || undefined,
    },
    selectors: {
      quote: {
        type: "TextQuoteSelector",
        exact,
        prefix: before.slice(-CONTEXT_LENGTH) || undefined,
        suffix: after.slice(0, CONTEXT_LENGTH) || undefined,
      },
      position: { type: "TextPositionSelector", start, end },
    },
  };
}

function isRange(value: unknown): value is Range {
  return Boolean(
    value &&
      typeof value === "object" &&
      "startContainer" in value &&
      "endContainer" in value,
  );
}

async function sectionDocument(
  view: FoliateView,
  index: number,
): Promise<Document | null> {
  const section = (view.book as BookLike | undefined)?.sections?.[index];
  if (!section?.createDocument) return null;
  try {
    return await section.createDocument();
  } catch {
    return null;
  }
}

async function rangeFromCfi(
  view: FoliateView,
  cfi: string,
): Promise<{ index: number; range: Range } | null> {
  try {
    const resolved = view.resolveCFI(cfi);
    if (!resolved || typeof resolved.index !== "number") return null;
    const doc = await sectionDocument(view, resolved.index);
    if (!doc) return null;
    const anchor = resolved.anchor(doc);
    return isRange(anchor) ? { index: resolved.index, range: anchor } : null;
  } catch {
    return null;
  }
}

function quoteMatches(range: Range, exact: string): boolean {
  const quote = normalizeWhitespace(exact);
  if (!quote) return true;
  const text = normalizeWhitespace(range.toString());
  return text === quote || text.includes(quote) || quote.includes(text);
}

function searchQueries(exact: string): string[] {
  const normalized = normalizeWhitespace(exact);
  if (!normalized) return [];
  const queries = [normalized.slice(0, SEARCH_QUERY_LENGTH)];
  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 5) {
    queries.push(words.slice(0, 5).join(" "));
  }
  return [...new Set(queries.filter(Boolean))];
}

async function searchSectionCfi(
  view: FoliateView,
  index: number,
  exact: string,
): Promise<string | null> {
  for (const query of searchQueries(exact)) {
    try {
      for await (const result of view.search({ query, index })) {
        if (typeof result !== "string" && result.cfi) return result.cfi;
      }
    } catch {
      // Try the next, shorter query.
    } finally {
      view.clearSearch();
    }
  }
  return null;
}

async function searchBookCfi(
  view: FoliateView,
  exact: string,
): Promise<string | null> {
  for (const query of searchQueries(exact)) {
    try {
      for await (const result of view.search({ query })) {
        if (typeof result === "string") continue;
        if (result.cfi) return result.cfi;
        if (Array.isArray(result.subitems)) {
          const subitem = result.subitems.find(
            (item) => typeof item === "object" && item !== null && "cfi" in item,
          ) as { cfi?: string } | undefined;
          if (subitem?.cfi) return subitem.cfi;
        }
      }
    } catch {
      // Try the next, shorter query.
    } finally {
      view.clearSearch();
    }
  }
  return null;
}

function textNodes(doc: Document): Text[] {
  const body = doc.body;
  if (!body) return [];
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement?.tagName.toLowerCase();
      if (parent === "script" || parent === "style") {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function rangeFromOffsets(
  doc: Document,
  start: number,
  end: number,
): Range | null {
  const nodes = textNodes(doc);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const node of nodes) {
    const length = node.nodeValue?.length ?? 0;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = Math.max(0, start - offset);
    }
    if (!endNode && end <= offset + length) {
      endNode = node;
      endOffset = Math.max(0, end - offset);
      break;
    }
    offset += length;
  }
  if (!startNode || !endNode) return null;
  try {
    const range = doc.createRange();
    range.setStart(startNode, Math.min(startOffset, startNode.length));
    range.setEnd(endNode, Math.min(endOffset, endNode.length));
    return range;
  } catch {
    return null;
  }
}

/**
 * Resolve a stored locator to a CFI that still points at the quoted text.
 *
 * `repaired` is true when the stored CFI was stale and another strategy found
 * the text; the caller persists the corrected locator.
 */
export async function resolveAnnotationLocator(
  view: FoliateView,
  locator: AnnotationLocator,
): Promise<ResolvedAnnotation | null> {
  const storedCfi = locator.locations.fragments[0];
  const exact = locator.selectors.quote.exact;
  if (storedCfi) {
    const resolved = await rangeFromCfi(view, storedCfi);
    if (resolved && quoteMatches(resolved.range, exact)) {
      return { cfi: storedCfi, repaired: false };
    }
  }

  const preferredIndex = sectionIndexForHref(view, locator.href);
  if (preferredIndex >= 0) {
    const cfi = await searchSectionCfi(view, preferredIndex, exact);
    if (cfi) return { cfi, repaired: true };
  }

  const bookCfi = await searchBookCfi(view, exact);
  if (bookCfi) return { cfi: bookCfi, repaired: true };

  const position = locator.selectors.position;
  if (preferredIndex >= 0 && position) {
    const doc = await sectionDocument(view, preferredIndex);
    const range = doc ? rangeFromOffsets(doc, position.start, position.end) : null;
    if (range) {
      const cfi = view.getCFI(preferredIndex, range);
      if (cfi) return { cfi, repaired: true };
    }
  }
  return null;
}
