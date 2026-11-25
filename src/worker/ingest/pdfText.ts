/**
 * The text of a PDF, page by page, read by pdf.js (docs/REGRAS_CONCILIADOR.md, section 3.3; decision D-6), shared by the
 * probe of the start screen (the text of the first page identifies the report, 3.1) and the format adapter of the
 * Conciliador (src/worker/modules/reconciliation/formats/pdf.ts, which lays the monospaced text on its grid).
 *
 * pdf.js is bundled with the app (no CDN, no network) and loaded only when a PDF is read. Its "worker" runs inside this
 * worker, from the same bundle (`globalThis.pdfjsWorker`): pdf.js creates no other worker and fetches no script. The
 * legacy build is the one that runs in the managed browsers (the modern one needs the newest JavaScript built-ins) and
 * in Node (the tests). Options of 3.3: no eval, no font faces, no system fonts; no CMap, standard font, wasm or ICC URL,
 * so there is nothing to fetch. Each page is released (`cleanup`) once its text is read, the document at the end.
 */
import type { TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';

/** A text item of a page, as pdf.js gives it (only what the readings use). Coordinates in points, y upwards. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** In a monospaced font (pdf.js style `fontFamily: 'monospace'`, from the font's fixed pitch). */
  mono: boolean;
}

export interface PdfPagesOptions {
  signal?: AbortSignal;
  /** Read only the first pages (the probe reads one). */
  maxPages?: number;
}

/** A PDF starts with `%PDF-` (the header may follow up to 1 KB of anything, as readers accept). */
export function isPdfHead(head: Uint8Array): boolean {
  const text = String.fromCharCode(...head.subarray(0, 1024));
  return text.includes('%PDF-');
}

/** pdf.js and its worker, from the bundle of the app. */
async function loadPdfjs() {
  const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
  // The "worker" of pdf.js runs here, in this worker: no nested worker, no URL to fetch.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker;
  return lib;
}

const Y_DECIMALS = 10;
const roundY = (y: number) => Math.round(y * Y_DECIMALS) / Y_DECIMALS;

/**
 * Lines of text in reading order: items with the same y (rounded to 0.1 pt), top to bottom, each line its items by x,
 * joined as pdf.js gives them (it writes the spaces between words as items); blank lines left out.
 */
export function readingOrderLines(items: readonly PdfItem[]): string[] {
  const rows = new Map<number, PdfItem[]>();
  for (const it of items) {
    if (it.str === '') continue;
    const y = roundY(it.y);
    let row = rows.get(y);
    if (!row) rows.set(y, (row = []));
    row.push(it);
  }
  return [...rows]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((it) => it.str).join('').trimEnd())
    .filter((line) => line.trim() !== '');
}

function pageItems(items: readonly unknown[], styles: Record<string, TextStyle>): PdfItem[] {
  const out: PdfItem[] = [];
  for (const raw of items) {
    const it = raw as Partial<TextItem>;
    if (typeof it.str !== 'string' || !Array.isArray(it.transform)) continue;
    out.push({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number, width: it.width ?? 0, mono: styles[it.fontName ?? '']?.fontFamily === 'monospace' });
  }
  return out;
}

/**
 * Calls `onPage` with the text items of each page, in order (1-based page, pages to read). Returns the pages read and
 * the library ("pdf.js 5.6.205", for the Rastreabilidade, 3.2). A file pdf.js cannot open (not a PDF, encrypted)
 * throws its error.
 */
export async function readPdfPages(blob: Blob, onPage: (page: number, items: PdfItem[], total: number) => void, options: PdfPagesOptions = {}): Promise<{ pages: number; library: `pdf.js ${string}` }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const doc = await task.promise;
    const total = Math.min(doc.numPages, options.maxPages ?? Infinity);
    for (let p = 1; p <= total; p++) {
      options.signal?.throwIfAborted();
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = pageItems(content.items, content.styles);
      page.cleanup();
      onPage(p, items, total);
    }
    return { pages: total, library: `pdf.js ${pdfjs.version}` as const };
  } finally {
    await task.destroy();
  }
}
