/**
 * First rows of every sheet of a workbook (docs/MODULOS.md, section 3.1), for the warning of the start screen about
 * a file of another analysis. Reads only the beginning of each sheet and of the shared strings, up to the last string
 * those rows use: a few kilobytes even for the largest files. Nothing is checked here (the analysis checks everything).
 * For the XML the system writes (no directory), the worksheets that start in its first megabytes. For a plain-text
 * spool of the system (docs/REGRAS_CONCILIADOR.md, section 3.1), its first lines, normalized, from its first 64 KB. For a
 * PDF (`%PDF-`), the text of its first page in reading order (pdfText.ts; 3.1: the routine is in the page header).
 */
import type { InputFormat, SheetSample } from '../../shared/protocol';
import { spoolRoutine } from '../../shared/spool';
import type { InflateMode } from './inflate';
import { isPdfHead, readPdfPages, readingOrderLines } from './pdfText';
import { CellKind, SheetParser } from './sheetStream';
import { SharedStringsBytesParser } from './sst';
import { parseRelationships, parseWorkbookSheets, resolvePartPath } from './workbook';
import { xmlEntryOf } from './xmlSheet';
import { XmlSpreadsheetParser, xmlDeclaredEncoding } from './xmlSpreadsheet';
import { spoolLines } from './spoolText';
import { readEntryBytes, readEntryHead, readZipDirectory } from './zip';

/** Columns read per row. */
const WIDTH = 256;

type RawCell = number | string;

/** Text read from the beginning of an XML file for its first rows (the first worksheets of the file). */
const XML_HEAD_BYTES = 4 * 1024 * 1024;

/** Bytes read from the beginning of a file that is not a ZIP, to tell a plain-text spool from an XML. */
const SPOOL_HEAD_BYTES = 64 * 1024;

/** The first byte of a text after a UTF-8 BOM and white space ("<" for an XML). */
function firstByte(head: Uint8Array): number | undefined {
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (i < head.length && (head[i] === 0x20 || head[i] === 0x09 || head[i] === 0x0a || head[i] === 0x0d)) i++;
  return head[i];
}

/**
 * A plain-text spool: the first `rows` non-blank lines of its first 64 KB, normalized (section 4.1), plus the line of
 * the page header with `SIGA /<ROTINA>/` when it comes later. Null when no such line is there: only a spool of the
 * system is read as text.
 */
function probeSpool(head: Uint8Array, complete: boolean, rows: number): SheetSample | null {
  const { lines } = spoolLines(head, complete);
  const id = lines.findIndex((line) => spoolRoutine(line) !== null);
  if (id < 0) return null;
  const out: SheetSample['rows'] = [];
  for (let i = 0; i < lines.length && out.length < rows; i++) if (lines[i]!.trim() !== '') out.push({ r: i + 1, titles: [lines[i]!] });
  if (!out.some((row) => row.r === id + 1)) out.push({ r: id + 1, titles: [lines[id]!] });
  return { name: '', rows: out, format: 'text' };
}

/** A PDF: the lines of its first page in reading order (`r` = line number, the whole line in `titles[0]`). */
async function probePdf(blob: Blob, rows: number): Promise<SheetSample> {
  let lines: string[] = [];
  await readPdfPages(blob, (_page, items) => void (lines = readingOrderLines(items)), { maxPages: 1 });
  return { name: '', rows: lines.slice(0, Math.max(rows, 1) * 4).map((line, i) => ({ r: i + 1, titles: [line] })), format: 'pdf' };
}

/** First rows of each worksheet that starts in the first bytes of the XML the system writes (plain or zipped). */
async function probeXml(read: (onChunk: (c: Uint8Array) => boolean) => Promise<void>, rows: number, format: InputFormat): Promise<SheetSample[]> {
  const out: SheetSample[] = [];
  const parser = new XmlSpreadsheetParser(
    {
      onSheet: (s) => out.push({ name: s.name, rows: [], format }),
      onRow: (sheet, r, row) => {
        const titles = Array.from({ length: row.width }, (_, c) => (row.kind[c] === CellKind.Empty ? '' : row.text[c]!));
        while (titles.length > 0 && titles[titles.length - 1] === '') titles.pop();
        out[sheet]!.rows.push({ r, titles });
      },
    },
    WIDTH,
    { headRows: rows },
  );
  let decoder: TextDecoder | null = null;
  let seen = 0;
  await read((chunk) => {
    decoder ??= new TextDecoder(xmlDeclaredEncoding(chunk));
    parser.push(decoder.decode(chunk, { stream: true }));
    seen += chunk.length;
    return !parser.complete && seen < XML_HEAD_BYTES;
  });
  if (!parser.started) throw new Error('Não é uma planilha XML.');
  return out;
}

export async function probeWorkbook(blob: Blob, rows: number, inflateMode: InflateMode = 'auto'): Promise<SheetSample[]> {
  const start = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (start[0] !== 0x50 || start[1] !== 0x4b) {
    // Not an XML: a spool of the system is read as text; anything else goes on as before (the XML reading refuses it).
    const head = new Uint8Array(await blob.slice(0, SPOOL_HEAD_BYTES).arrayBuffer());
    if (isPdfHead(head)) return [await probePdf(blob, rows)];
    if (firstByte(head) !== 0x3c) {
      const spool = probeSpool(head, blob.size <= SPOOL_HEAD_BYTES, rows);
      if (spool) return [spool];
    }
    return probeXml(async (onChunk) => void onChunk(new Uint8Array(await blob.slice(0, XML_HEAD_BYTES).arrayBuffer())), rows, 'xml');
  }
  const entries = await readZipDirectory(blob);
  const byName = new Map(entries.map((e) => [e.name, e]));
  if (!byName.has('xl/workbook.xml')) {
    const entry = xmlEntryOf('', entries);
    return probeXml((onChunk) => readEntryHead(blob, entry, onChunk, inflateMode), rows, 'xmlZip');
  }
  const text = async (name: string) => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`${name} ausente.`);
    return new TextDecoder().decode((await readEntryBytes(blob, entry, inflateMode)).bytes);
  };
  const sheets = parseWorkbookSheets(await text('xl/workbook.xml'));
  const rels = parseRelationships(await text('xl/_rels/workbook.xml.rels'));
  const target = new Map(rels.map((r) => [r.id, resolvePartPath(r.target)]));

  // Rows of each sheet with shared strings as indexes (negative: none), then the strings they use.
  let lastIndex = -1;
  const raw: { name: string; rows: { r: number; cells: RawCell[] }[] }[] = [];
  for (const sheet of sheets) {
    const entry = byName.get(target.get(sheet.relationshipId) ?? '');
    const out: { r: number; cells: RawCell[] }[] = [];
    if (entry) {
      const parser = new SheetParser((r, row) => {
        if (out.length >= rows) return;
        const cells: RawCell[] = [];
        for (let c = 0; c < row.width; c++) {
          const kind = row.kind[c];
          if (kind === CellKind.Shared) {
            const index = row.sharedIndex[c]!;
            cells[c] = index;
            lastIndex = Math.max(lastIndex, index);
          } else {
            cells[c] = kind === CellKind.Empty ? '' : row.text[c]!;
          }
        }
        out.push({ r, cells });
      }, WIDTH);
      await readEntryHead(blob, entry, (c) => {
        parser.push(c);
        return out.length < rows;
      }, inflateMode);
    }
    raw.push({ name: sheet.name, rows: out });
  }

  const sstPath = resolvePartPath(rels.find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  const sstEntry = byName.get(sstPath);
  const sst = new SharedStringsBytesParser();
  if (sstEntry && lastIndex >= 0) {
    await readEntryHead(blob, sstEntry, (c) => {
      sst.push(c);
      return sst.count <= lastIndex;
    }, inflateMode);
  }
  const strings = sst.partial();

  return raw.map(({ name, rows: sample }) => ({
    name,
    rows: sample.map(({ r, cells }) => {
      const titles = Array.from(cells, (v) => (typeof v === 'number' ? (v >= 0 ? (strings[v] ?? '') : '') : (v ?? '')));
      while (titles.length > 0 && titles[titles.length - 1] === '') titles.pop();
      return { r, titles };
    }),
    format: 'xlsx' as const,
  }));
}
