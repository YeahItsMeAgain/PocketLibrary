/**
 * Thin adapter around vendored foliate-js.
 *
 * foliate-js ships plain ES modules with no types and no stable API, so this
 * file is the only place that knows its shape. Everything else talks in the
 * small ReaderView interface below.
 */
// Side-effect import: registers the <foliate-view> custom element.
import "../vendor/foliate/view.js";

import garamondUrl from "../assets/fonts/EBGaramond-Regular.woff2?url";
import literataUrl from "../assets/fonts/Literata-Regular.woff2?url";
import sourceSerifUrl from "../assets/fonts/SourceSerif4-Regular.woff2?url";

import {
  READER_FONTS,
  READER_MARGINS,
  READER_SIZES,
  READER_SPACINGS,
  READER_THEMES,
  type ReaderSettings,
} from "./settings";

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[];
}

export interface FoliateRelocate {
  cfi?: string;
  fraction?: number;
  tocItem?: FoliateTocItem | null;
  range?: Range;
}

export interface FoliateRenderer extends HTMLElement {
  atStart: boolean;
  atEnd: boolean;
  page: number;
  pages: number;
  start: number;
  end: number;
  viewSize: number;
  render(): void;
  setStyles(styles: string | [string, string]): void;
  getContents(): Array<{ doc: Document; index: number }>;
}

export interface FoliateSection {
  id?: string;
  cfi?: string;
  createDocument?: () => Promise<Document>;
}

export interface FoliateSearchResult {
  cfi?: string;
  excerpt?: string;
  label?: string;
  subitems?: Array<{ cfi?: string }>;
}

export interface FoliateView extends HTMLElement {
  book?: {
    toc?: FoliateTocItem[];
    sections?: FoliateSection[];
  };
  renderer?: FoliateRenderer;
  lastLocation?: FoliateRelocate;
  open(file: File): Promise<void>;
  init(options: {
    lastLocation?: string | null;
    showTextStart?: boolean;
  }): Promise<void>;
  close(): void;
  prev(): Promise<void>;
  next(): Promise<void>;
  goTo(target: unknown): Promise<unknown>;
  resolveCFI(cfi: string): { index: number; anchor(doc: Document): unknown };
  getCFI(index: number, range: Range): string;
  search(options: {
    query: string;
    index?: number;
  }): AsyncGenerator<FoliateSearchResult | string>;
  clearSearch(): void;
  addAnnotation(
    annotation: { value: string; colour?: string; kind?: string },
    remove?: boolean,
  ): Promise<unknown>;
  deselect(): void;
}

export function createFoliateView(): FoliateView {
  const view = document.createElement("foliate-view") as FoliateView;
  view.className = "reader-book";
  return view;
}

/**
 * Draw one saved highlight into foliate's overlay.
 *
 * Matches the vendored `Overlayer.highlight` shape, and adds a small wax-dot
 * marker at the end of a note so a written annotation is visible in the text.
 */
export function drawAnnotationHighlight(
  rects: ArrayLike<DOMRect>,
  options: { color?: string; marker?: boolean } = {},
): Element {
  const svg = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(svg, "g");
  const wash = document.createElementNS(svg, "g");
  wash.setAttribute("fill", options.color ?? "#b08a45");
  wash.style.opacity = "var(--overlayer-highlight-opacity, 0.38)";
  wash.style.mixBlendMode = "multiply";
  for (const rect of Array.from(rects)) {
    const element = document.createElementNS(svg, "rect");
    element.setAttribute("x", String(rect.left));
    element.setAttribute("y", String(rect.top));
    element.setAttribute("height", String(rect.height));
    element.setAttribute("width", String(rect.width));
    wash.append(element);
  }
  group.append(wash);
  if (options.marker && rects.length > 0) {
    const last = rects[rects.length - 1];
    const dot = document.createElementNS(svg, "circle");
    dot.setAttribute("cx", String(last.right - 4));
    dot.setAttribute("cy", String(last.top + 4));
    dot.setAttribute("r", "3.4");
    dot.setAttribute("fill", options.color ?? "#b08a45");
    dot.setAttribute("stroke", "rgba(250, 242, 222, 0.85)");
    dot.setAttribute("stroke-width", "1");
    group.append(dot);
  }
  return group;
}

export function flattenToc(
  items: FoliateTocItem[] | undefined,
  depth = 0,
): Array<FoliateTocItem & { depth: number }> {
  if (!items) return [];
  return items.flatMap((item) => [
    { ...item, depth },
    ...flattenToc(item.subitems, depth + 1),
  ]);
}

const FONT_URLS: Record<string, string> = {
  garamond: garamondUrl,
  literata: literataUrl,
  "source-serif": sourceSerifUrl,
};

function absoluteFontUrl(url: string): string {
  return new URL(url, window.location.href).href;
}

export function readerCss(settings: ReaderSettings): [string, string] {
  const theme = READER_THEMES[settings.theme];
  const font = READER_FONTS.find((entry) => entry.id === settings.font) ?? READER_FONTS[0];
  const size = READER_SIZES[settings.size] ?? READER_SIZES[2];
  const spacing = READER_SPACINGS[settings.spacing] ?? READER_SPACINGS[1];
  const fontUrl = absoluteFontUrl(FONT_URLS[font.id] ?? FONT_URLS.garamond);

  const before = `
    @font-face {
      font-family: '${font.family}';
      src: url('${fontUrl}') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
  `;

  const after = `
    html, body {
      background: ${theme.paper} !important;
      color: ${theme.ink} !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    body {
      font-family: '${font.family}', Georgia, serif !important;
      font-size: ${size.px}px !important;
      line-height: ${spacing.value} !important;
      overflow-wrap: break-word !important;
      -webkit-text-size-adjust: 100% !important;
    }
    body * {
      color: inherit !important;
      font-family: inherit !important;
    }
    p { margin: 0 0 0.85em !important; }
    p + p { text-indent: 1.1em; }
    h1, h2, h3, h4 {
      color: ${theme.ink} !important;
      line-height: 1.25 !important;
      margin: 0.4em 0 0.7em !important;
    }
    h1 { font-size: 1.5em !important; }
    h2 { font-size: 1.28em !important; }
    a { color: ${theme.accent} !important; }
    img, svg, video, canvas {
      max-width: 100% !important;
      height: auto !important;
    }
    ::selection { background: ${theme.accent}55 !important; }
  `;
  return [before, after];
}

export function applyReaderSettings(view: FoliateView, settings: ReaderSettings) {
  const renderer = view.renderer;
  if (!renderer) return;
  const margin = READER_MARGINS[settings.margin] ?? READER_MARGINS[0];
  renderer.setAttribute("margin", `${margin.px}px`);
  renderer.setAttribute("max-inline-size", "680px");
  renderer.setAttribute("flow", settings.mode === "scrolled" ? "scrolled" : "paginated");
  renderer.setStyles(readerCss(settings));
  renderer.render();
}
