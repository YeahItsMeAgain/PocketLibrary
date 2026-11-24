/**
 * Thin adapter around PDF.js.
 *
 * PDF.js is the only module here that knows the worker URL, the local runtime
 * asset paths and the display API shape. The reader component talks in plain
 * pages, outline items and locators.
 */
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

// Local worker: the API and worker builds must be the same version. Vite emits
// the worker as a hashed asset, so nothing is fetched from a CDN.
GlobalWorkerOptions.workerSrc = workerUrl;

/** PDF.js fetches these lazily for CJK text, font substitution and wasm decoders. */
export const PDF_RUNTIME_PATHS = {
  cMapUrl: new URL("/pdfjs/cmaps/", window.location.href).href,
  standardFontDataUrl: new URL("/pdfjs/standard_fonts/", window.location.href)
    .href,
  wasmUrl: new URL("/pdfjs/wasm/", window.location.href).href,
};

export interface PdfOutlineEntry {
  title: string;
  page: number;
  depth: number;
}

export interface PdfPageSize {
  width: number;
  height: number;
}

export type PdfLocator = {
  v: 1;
  page: number;
  progress?: number;
  quote?: string;
};

export function parsePdfLocator(raw: string | null | undefined): PdfLocator | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PdfLocator>;
    if (value && value.v === 1 && typeof value.page === "number") {
      const page = Math.floor(value.page);
      if (page >= 1) {
        return {
          v: 1,
          page,
          progress:
            typeof value.progress === "number" ? value.progress : undefined,
          quote: typeof value.quote === "string" ? value.quote : undefined,
        };
      }
    }
  } catch {
    // A locator from another engine is ignored; the PDF opens at page one.
  }
  return null;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Tear down the worker and every page canvas held by PDF.js. */
  destroy(): Promise<void>;
}

export async function openPdf(bytes: ArrayBuffer): Promise<OpenedPdf> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: PDF_RUNTIME_PATHS.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: PDF_RUNTIME_PATHS.standardFontDataUrl,
    wasmUrl: PDF_RUNTIME_PATHS.wasmUrl,
    // Match the worker's streaming behaviour but keep memory bounded.
    disableAutoFetch: true,
    disableStream: true,
  });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export async function pageSize(page: PDFPageProxy): Promise<PdfPageSize> {
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/** Turn a PDF.js destination (link target or outline dest) into a page number. */
async function destinationPage(
  pdf: PDFDocumentProxy,
  destination: string | unknown[] | null,
): Promise<number | null> {
  if (destination === null) return null;
  let explicit = destination;
  if (typeof destination === "string") {
    explicit = (await pdf.getDestination(destination)) ?? [];
  }
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const target = explicit[0] as unknown;
  if (typeof target === "number") {
    return Math.max(1, Math.floor(target) + 1);
  }
  if (target && typeof target === "object" && "num" in target) {
    const index = await pdf.getPageIndex(target as { num: number; gen: number });
    return index + 1;
  }
  return null;
}

interface RawOutlineItem {
  title?: string;
  dest?: string | unknown[] | null;
  items?: RawOutlineItem[];
}

export async function readOutline(
  pdf: PDFDocumentProxy,
): Promise<PdfOutlineEntry[]> {
  const outline = (await pdf.getOutline()) as RawOutlineItem[] | null;
  if (!outline || outline.length === 0) return [];
  const entries: PdfOutlineEntry[] = [];

  const walk = async (items: RawOutlineItem[], depth: number) => {
    for (const item of items) {
      const page = await destinationPage(pdf, item.dest ?? null);
      if (page !== null && item.title) {
        entries.push({ title: item.title, page, depth });
      }
      if (item.items && item.items.length > 0) {
        await walk(item.items, depth + 1);
      }
    }
  };

  await walk(outline, 0);
  return entries;
}

export interface RenderedPage {
  width: number;
  height: number;
}

/**
 * Paint one page into a canvas and lay PDF.js's text layer over it.
 *
 * `availableWidth` drives fit-width; `zoom` multiplies that fit scale. The
 * canvas backing store is capped so a large page or a deep zoom cannot ask the
 * WebView for an unbounded bitmap.
 */
export async function renderPage(options: {
  page: PDFPageProxy;
  canvas: HTMLCanvasElement;
  textContainer: HTMLDivElement;
  availableWidth: number;
  zoom: number;
  maxCanvasPixels?: number;
  onTask?: (task: RenderTask) => void;
}): Promise<RenderedPage> {
  const { page, canvas, textContainer, availableWidth, zoom } = options;
  const maxPixels = options.maxCanvasPixels ?? 12_000_000;
  const base = page.getViewport({ scale: 1 });
  const fitScale = Math.max(0.05, availableWidth / base.width);
  const scale = fitScale * zoom;
  const viewport = page.getViewport({ scale });

  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const pixels = viewport.width * viewport.height * ratio * ratio;
  const outputRatio =
    pixels > maxPixels ? ratio * Math.sqrt(maxPixels / pixels) : ratio;

  canvas.width = Math.max(1, Math.floor(viewport.width * outputRatio));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputRatio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable");
  context.setTransform(outputRatio, 0, 0, outputRatio, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, viewport.width, viewport.height);

  const task = page.render({ canvas: null, canvasContext: context, viewport });
  options.onTask?.(task);
  await task.promise;

  textContainer.replaceChildren();
  textContainer.style.width = `${viewport.width}px`;
  textContainer.style.height = `${viewport.height}px`;
  textContainer.style.setProperty("--total-scale-factor", String(scale));
  textContainer.style.setProperty("--scale-round-x", "1px");
  textContainer.style.setProperty("--scale-round-y", "1px");
  const textContent = await page.getTextContent();
  const layer = new TextLayer({
    textContentSource: textContent,
    container: textContainer,
    viewport,
  });
  await layer.render();

  return { width: viewport.width, height: viewport.height };
}
