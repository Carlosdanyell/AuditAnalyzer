/**
 * Synthetic PDF of a report of the Protheus (docs/FASE_16_CONCILIADOR_PROVISOES_PDF.md, section 6.1), written by hand
 * in the test, without a dependency: a minimal valid PDF 1.4 (uncompressed content streams, a cross-reference table)
 * with the two standard Type 1 fonts that need no embedding: Courier (monospaced) for the body of the report and
 * Helvetica (proportional) for the page header, as the PDFs of the Protheus print them (docs/REGRAS_CONCILIADOR.md,
 * 3.3). The separation lines of the spool are drawing in the PDF, not text: they are left out.
 *
 * `spoolPages` turns the normalized lines of a synthetic spool (GPER040, CTBR400) into the pages of the same report: the
 * lines between two `****` rules that name the routine (`SIGA /<ROTINA>/`) are the page header, the parameters of the
 * ledger (`Pergunta NN : …`) go to the header too (in the PDF they are proportional text), every other line is body.
 *
 * Variants: `spread` prints the body with a character spacing (Tc), the advance between characters larger than the
 * glyph (as the PDFs of the provisions are printed); `offGrid` moves one character a fraction of a column (V-1);
 * `bodyFont: 'Helvetica'` prints a body without a monospaced font. Invented data only.
 */
import { spoolRoutine } from '../../src/shared/spool';
import { spoolLines } from '../../src/worker/ingest/spoolText';

export interface PdfPageText {
  /** Proportional text (Helvetica), in reading order. */
  header: string[];
  /** Fixed-width lines (Courier); a blank line only advances the line. */
  body: string[];
}

export interface PdfFixtureOptions {
  /** Font size of the body (points). */
  fontSize?: number;
  /** Character spacing of the body (Tc, points): the advance becomes 0.6 × size + spacing. */
  spread?: number;
  /** One character (page and body line base 0, column base 0) printed `fraction` of a column to the right. */
  offGrid?: { page: number; line: number; column: number; fraction: number };
  bodyFont?: 'Courier' | 'Helvetica';
  /** X of the column 0 of the body (points). */
  left?: number;
}

const isRule = (line: string) => /^\*{4,}/.test(line);
const isDrawing = (line: string) => line.trim() !== '' && /^[-#*=\s]+$/.test(line) && /[-#*=]{4,}/.test(line);
const PARAMETER = /^\s*Pergunta \d{2} : /;

/** The pages of a spool, from its normalized lines (what formats/text.ts gives the readers). */
export function spoolPages(lines: readonly string[]): PdfPageText[] {
  const pages: PdfPageText[] = [];
  let page: PdfPageText = { header: [], body: [] };
  const flush = () => {
    if (page.header.length > 0 || page.body.some((l) => l.trim() !== '')) pages.push(page);
    page = { header: [], body: [] };
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isRule(line)) {
      let j = i + 1;
      while (j < lines.length && !isRule(lines[j]!)) j++;
      const block = lines.slice(i + 1, j);
      if (j < lines.length && block.some((l) => spoolRoutine(l) !== null)) {
        flush();
        page.header.push(...block.map((l) => l.replace(/^\*/, '').replace(/\*\s*$/, '').trim()).filter((l) => l !== ''));
        i = j;
      }
      continue;
    }
    if (isDrawing(line)) continue;
    if (PARAMETER.test(line)) page.header.push(line.trim());
    else page.body.push(line);
  }
  flush();
  return pages;
}

/** windows-1252 byte of a character (WinAnsiEncoding); throws for any other. */
function winAnsi(ch: string): number {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) return c;
  throw new Error(`Caractere sem código WinAnsi no gerador de PDF: ${ch}`);
}

/**
 * A PDF string literal: parentheses and backslash escaped, bytes above 0x7e in octal. U+FFFD (an accent the TXT lost,
 * 4.1) is written as "ã": the PDF has the accented letter (3.3).
 */
function literal(text: string): string {
  let out = '(';
  for (const ch of text.replace(/\ufffd/g, '\u00e3')) {
    const b = winAnsi(ch);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (b > 0x7e) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `${out})`;
}

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** The bytes of the PDF of the pages. */
export function pdfBytes(pages: readonly PdfPageText[], o: PdfFixtureOptions = {}): Uint8Array {
  const size = o.fontSize ?? 7;
  const step = 0.6 * size + (o.spread ?? 0);
  const left = o.left ?? 20;
  const width = Math.max(...pages.flatMap((p) => p.body.map((l) => l.length)), 80);
  const pageWidth = Math.ceil(left * 2 + width * step);
  const leading = size + 2;
  const pageHeight = Math.ceil(60 + (Math.max(...pages.map((p) => p.header.length + p.body.length)) + 2) * leading);

  const objects: string[] = [];
  // Object numbers are 1-based: the length after the push.
  const add = (body: string) => objects.push(body);
  const catalog = add('');
  const pagesObj = add('');
  const courier = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const helvetica = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const body = o.bodyFont === 'Helvetica' ? '/F2' : '/F1';
  const kids: number[] = [];
  pages.forEach((p, pi) => {
    const ops: string[] = [];
    let y = pageHeight - 30;
    for (const h of p.header) {
      ops.push(`BT /F2 8 Tf 1 0 0 1 ${num(left)} ${num(y)} Tm ${literal(h)} Tj ET`);
      y -= leading;
    }
    y -= leading;
    p.body.forEach((line, li) => {
      let text = line;
      const off = o.offGrid && o.offGrid.page === pi && o.offGrid.line === li ? o.offGrid : null;
      if (off && (line[off.column] ?? ' ') === ' ') throw new Error(`offGrid: a coluna ${off.column} da linha ${off.line} da página ${off.page} não tem caractere.`);
      if (off) text = `${line.slice(0, off.column)} ${line.slice(off.column + 1)}`;
      if (text.trim() !== '') ops.push(`BT ${body} ${num(size)} Tf ${num(o.spread ?? 0)} Tc 1 0 0 1 ${num(left)} ${num(y)} Tm ${literal(text)} Tj ET`);
      if (off) ops.push(`BT ${body} ${num(size)} Tf 1 0 0 1 ${num(left + (off.column + off.fraction) * step)} ${num(y)} Tm ${literal(line[off.column]!)} Tj ET`);
      y -= leading;
    });
    const content = ops.join('\n');
    const stream = add(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${courier} 0 R /F2 ${helvetica} 0 R >> >> /Contents ${stream} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  // Latin-1 throughout: the content streams hold only ASCII (non-ASCII bytes are octal escapes).
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0));
}

/** The PDF of the same report as a synthetic spool (its bytes, normalized as section 4.1 says). */
export function spoolPdf(spool: Uint8Array, o: PdfFixtureOptions = {}): Uint8Array {
  return pdfBytes(spoolPages(spoolLines(spool).lines), o);
}
