/**
 * Format adapter of the PDF (docs/REGRAS_CONCILIADOR.md, section 3.3; decision D-6): the PDF a report of the Protheus
 * prints, with selectable text, read page by page (src/worker/ingest/pdfText.ts, pdf.js bundled with the app) into the
 * same fixed-width lines the TXT of the spool gives the readers (formats/text.ts), plus the proportional text of each
 * page (the page header: the routine and, in the ledger, the parameters). Knows no report.
 *
 * Grid (3.3): the body uses one monospaced font. Per page, the step of the character is measured over the items of
 * that font; the origin X is the smallest x of those items in the whole document; character i of an item is at column
 * (x − origin) / step + i, and a column more than 0.15 away from an integer rejects the PDF (V-1), never rounded. Lines
 * are the items with the same y (rounded to 0.1 pt), top to bottom; empty columns are spaces; the lines with no text
 * (blank lines of the spool) do not exist in the PDF. Each page is laid on the grid when read and only its lines are
 * kept; the origin of the document is applied when the last page is read (the left margin of a page is checked then).
 *
 * Spread pages (Fase 16, etapa 4): when the PDF advances each character more than the width of its glyph (observed in
 * the provisions, printed character by character), pdf.js writes a space between every two characters of an item
 * ("D a t a"); such a space is not a character of the report. A page is spread when every item of 2+ characters of the
 * monospaced font alternates a character and one space: its characters are the even positions and its step is
 * measured between items, as the difference of width between items of n and n + 1 characters (width = (n − 1) × step
 * + the width of one glyph). Pages that are not spread follow 3.3 as written: step = mode of width / length.
 */
import { formatDecimal } from '../../../../shared/format';
import { readPdfPages, readingOrderLines, type PdfItem, type PdfPagesOptions } from '../../../ingest/pdfText';

/** The PDF cannot be read as a grid (V-1, or no monospaced body): it is rejected with the reason (3.3). */
export class PdfGridError extends Error {
  override name = 'PdfGridError';
  constructor(
    message: string,
    /** Page (1-based) where the reading stopped; null for the whole document. */
    readonly page: number | null,
  ) {
    super(message);
  }
}

/** What the reading of a PDF reports (Reconciliação de leitura, Rastreabilidade). */
export interface PdfReading {
  /** Library and version that read the text ("pdf.js 5.6.205"), for the Rastreabilidade (3.2). */
  library: `pdf.js ${string}`;
  pages: number;
  /** Fixed-width lines given to the reader (the numbering the messages cite). */
  lines: number;
  /** Lines of proportional text (page headers). */
  headerLines: number;
  /** Step of the character (points): the one of most pages; null without a monospaced body. */
  step: number | null;
  originX: number | null;
  /** Pages whose items pdf.js spread (a space between every two characters). */
  spreadPages: number;
}

/** Receives what the PDF holds, page by page, in order: the proportional text of the page, then its lines. */
export interface PdfSink {
  header?(lines: readonly string[], page: number): void;
  line(text: string, lineNumber: number): void;
}

export interface PdfReadOptions extends PdfPagesOptions {
  /** After each page read: pages done, pages of the document. */
  onPage?: (done: number, total: number) => void;
}

/** Tolerances of 3.3: rounding of the step, of y, the ratio of a monospaced item and the distance to the grid. */
const STEP_DECIMALS = 1000;
const Y_DECIMALS = 10;
const RATIO_TOLERANCE = 0.005;
const GRID_TOLERANCE = 0.15;

const round = (v: number, d: number) => Math.round(v * d) / d;
const SPREAD = /^(?:\S )+\S$/;

/** The most frequent value; ties go to the smallest (determinism). Null for none. */
function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount || (c === bestCount && v < best!)) [best, bestCount] = [v, c];
  return best;
}

/** A monospaced item with its characters (the even positions of a spread item). */
interface Glyphs {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** The grid measures of a page: step, width of one glyph and whether pdf.js spread its items. */
interface Measure {
  step: number;
  glyph: number;
  spread: boolean;
}

/** The monospaced items of a page that carry text, and whether pdf.js spread them. */
function monoGlyphs(items: readonly PdfItem[]): { glyphs: Glyphs[]; spread: boolean | null } {
  const mono = items.filter((it) => it.mono && it.str.trim() !== '');
  const multi = mono.filter((it) => it.str.length >= 2);
  const spread = multi.length === 0 ? null : multi.every((it) => SPREAD.test(it.str));
  const glyphs = mono.map((it) => ({ text: spread ? [...it.str].filter((_, i) => i % 2 === 0).join('') : it.str, x: it.x, y: it.y, width: it.width }));
  return { glyphs, spread };
}

/** Step and glyph width of a page (3.3, step 2; spread pages: measured between items of consecutive lengths). */
function measure(glyphs: readonly Glyphs[], spread: boolean): Measure | null {
  const multi = glyphs.filter((g) => g.text.length >= 2);
  if (!spread) {
    const step = mode(multi.map((g) => round(g.width / g.text.length, STEP_DECIMALS)));
    return step === null || step <= 0 ? null : { step, glyph: step, spread };
  }
  const widths = new Map<number, number[]>();
  for (const g of glyphs) {
    const list = widths.get(g.text.length);
    if (list) list.push(round(g.width, STEP_DECIMALS));
    else widths.set(g.text.length, [round(g.width, STEP_DECIMALS)]);
  }
  const byLength = new Map([...widths].map(([n, ws]) => [n, mode(ws)!]));
  const differences: number[] = [];
  for (const [n, w] of byLength) {
    const next = byLength.get(n + 1);
    if (next !== undefined) differences.push(round(next - w, STEP_DECIMALS));
  }
  const step = mode(differences);
  if (step === null || step <= 0) return null;
  const glyph = mode(glyphs.map((g) => round(g.width - (g.text.length - 1) * step, STEP_DECIMALS)))!;
  return { step, glyph, spread };
}

/** The item is monospaced in the measures of its page: its ratio within 0.5% of the step (3.3, step 2). */
function fits(g: Glyphs, m: Measure): boolean {
  const n = g.text.length;
  const limit = RATIO_TOLERANCE * m.step;
  if (!m.spread) return Math.abs(g.width / n - m.step) <= limit;
  return n === 1 ? Math.abs(g.width - m.glyph) <= limit : Math.abs((g.width - m.glyph) / (n - 1) - m.step) <= limit;
}

/** A page laid on its own grid: lines with columns counted from the smallest x of the page. */
interface LaidPage {
  page: number;
  header: string[];
  lines: string[];
  minX: number;
  measure: Measure;
  /** Smallest and largest distance of a column to its integer (signed), to check against the document origin. */
  low: number;
  high: number;
}

const sample = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

function lay(page: number, header: string[], glyphs: readonly Glyphs[], m: Measure): LaidPage {
  const minX = Math.min(...glyphs.map((g) => g.x));
  const rows = new Map<number, string[]>();
  let low = 0;
  let high = 0;
  for (const g of glyphs) {
    if (!fits(g, m)) {
      throw new PdfGridError(
        `Página ${page}: o trecho "${sample(g.text)}" está na fonte monoespaçada, mas a largura dos caracteres (${formatDecimal(g.width / g.text.length, 3)} pt) não é a do passo da página (${formatDecimal(m.step, 3)} pt, tolerância de 0,5%): caractere fora da grade (V-1). O PDF foi rejeitado; nada foi arredondado.`,
        page,
      );
    }
    const at = (g.x - minX) / m.step;
    const column = Math.round(at);
    const off = at - column;
    low = Math.min(low, off);
    high = Math.max(high, off);
    if (Math.abs(off) > GRID_TOLERANCE) {
      throw new PdfGridError(`Página ${page}: o trecho "${sample(g.text)}" começa a ${formatDecimal(Math.abs(off), 2)} coluna de uma coluna inteira (limite 0,15): caractere fora da grade (V-1). O PDF foi rejeitado; nada foi arredondado.`, page);
    }
    const y = round(g.y, Y_DECIMALS);
    let row = rows.get(y);
    if (!row) rows.set(y, (row = []));
    for (let i = 0; i < g.text.length; i++) {
      const ch = g.text[i]!;
      const at = column + i;
      const there = row[at];
      if (there !== undefined && there !== ' ' && ch !== ' ' && there !== ch) {
        throw new PdfGridError(`Página ${page}: dois caracteres na mesma coluna (${at + 1}) da mesma linha ("${there}" e "${ch}"): a grade não fecha (V-1). O PDF foi rejeitado.`, page);
      }
      if (there === undefined || there === ' ') row[at] = ch;
    }
  }
  const lines = [...rows].sort((a, b) => b[0] - a[0]).map(([, row]) => Array.from(row, (ch) => ch ?? ' ').join(''));
  return { page, header, lines, minX, measure: m, low, high };
}

/** A page read but not yet laid: it has no item of 2+ characters to measure the step (laid with the document's). */
interface PendingPage {
  page: number;
  header: string[];
  glyphs: Glyphs[];
}

/**
 * The grid of a document: `page()` with the text items of each page, in order, then `finish()` gives the pages to the
 * sink. Pure (the tests call it with items made by hand). Throws PdfGridError (V-1, no monospaced body).
 */
export class PdfGrid {
  private readonly laid: (LaidPage | PendingPage)[] = [];

  /** Adds the items of the next page (1-based). */
  page(page: number, items: readonly PdfItem[]): void {
    const header = readingOrderLines(items.filter((it) => !it.mono));
    const { glyphs, spread } = monoGlyphs(items);
    const m = spread === null ? null : measure(glyphs, spread);
    if (glyphs.length === 0 || m === null) this.laid.push({ page, header, glyphs });
    else this.laid.push(lay(page, header, glyphs, m));
  }

  /** Lays the pending pages, checks every page against the origin of the document and emits. */
  finish(sink: PdfSink): Omit<PdfReading, 'library' | 'pages'> {
    const measured = this.laid.filter((p): p is LaidPage => 'lines' in p);
    const pending = this.laid.filter((p): p is PendingPage => !('lines' in p));
    const anyGlyph = measured.length > 0 || pending.some((p) => p.glyphs.length > 0);
    if (!anyGlyph) {
      throw new PdfGridError('O PDF não tem texto em fonte monoespaçada: não é o corpo de um relatório do Protheus com texto selecionável (PDF digitalizado não é lido, sem OCR). O PDF foi rejeitado (seção 3.3).', null);
    }
    if (measured.length === 0) throw new PdfGridError('O PDF não tem nenhum trecho de 2 ou mais caracteres na fonte monoespaçada: o passo da grade não pôde ser medido (seção 3.3).', null);
    // Pages without an item of 2+ characters are laid with the measures of the document: those of most pages.
    const step = mode(measured.map((p) => p.measure.step))!;
    const common = measured.find((p) => p.measure.step === step)!.measure;
    const pages: LaidPage[] = this.laid.map((p) => {
      if ('lines' in p) return p;
      if (p.glyphs.length === 0) return { page: p.page, header: p.header, lines: [], minX: Infinity, measure: common, low: 0, high: 0 };
      return lay(p.page, p.header, p.glyphs, common);
    });
    const originX = Math.min(...pages.map((p) => p.minX));
    let n = 0;
    let headerLines = 0;
    for (const p of pages) {
      let pad = 0;
      if (p.lines.length > 0) {
        const at = (p.minX - originX) / p.measure.step;
        pad = Math.round(at);
        const off = at - pad;
        if (p.high + off > GRID_TOLERANCE || p.low + off < -GRID_TOLERANCE) {
          throw new PdfGridError(`Página ${p.page}: a margem esquerda do texto monoespaçado está a ${formatDecimal(Math.abs(off), 2)} coluna da grade do documento (limite 0,15): caractere fora da grade (V-1). O PDF foi rejeitado.`, p.page);
        }
      }
      sink.header?.(p.header, p.page);
      headerLines += p.header.length;
      const spaces = ' '.repeat(pad);
      for (const line of p.lines) sink.line(spaces + line, ++n);
    }
    return { lines: n, headerLines, step, originX, spreadPages: pages.filter((p) => p.lines.length > 0 && p.measure.spread).length };
  }
}

/**
 * Reads a PDF page by page (each page released after its text is read) and gives the sink the proportional text and
 * the fixed-width lines of every page. Throws PdfGridError when the grid does not close (V-1) or there is no monospaced
 * body; any other failure of pdf.js (not a PDF, encrypted) as an Error with its message.
 */
export async function readPdfLines(blob: Blob, sink: PdfSink, options: PdfReadOptions = {}): Promise<PdfReading> {
  const grid = new PdfGrid();
  const read = await readPdfPages(
    blob,
    (page, items, total) => {
      grid.page(page, items);
      options.onPage?.(page, total);
    },
    options,
  );
  return { ...read, ...grid.finish(sink) };
}
