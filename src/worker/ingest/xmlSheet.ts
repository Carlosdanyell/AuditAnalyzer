/**
 * Reading of the XML Spreadsheet 2003 file the system writes (plain, or the only .xml inside a .zip) with the same
 * contract as readSheet (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1):
 *
 * 1. file check: SHA-256 of the file and, in the same pass for a plain XML, the list of worksheets with their first
 *    rows and the end of the document (</Workbook>); for a .zip, the CRC32 and size of every entry. A file that ends
 *    before </Workbook> (a transfer that stopped) is a reading error: without a ZIP there is no CRC32, so the end of
 *    the document is what proves that the file is whole;
 * 2. the module chooses the worksheet from their first rows;
 * 3. the rows of that worksheet, streamed.
 *
 * The XML has no directory, so the worksheets are only known after reading the whole file: hence the first pass.
 */
import { createSHA256 } from 'hash-wasm';
import type { Alert, EntryIntegrity } from '../../shared/protocol';
import { IngestError } from './errors';
import { requireIntact } from './integrity';
import type { IngestInput } from './pipeline';
import type { CellText, HeadRow, SheetReadOptions, SheetReadResult } from './readSheet';
import { CellKind, SheetFormatError, type ParsedRow } from './sheetStream';
import type { WorkbookSheet } from './workbook';
import { XmlSpreadsheetParser, xmlDeclaredEncoding } from './xmlSpreadsheet';
import { readEntry, type ZipEntry } from './zip';

/** First rows kept per worksheet for the choice of the module (the largest header search of the configuration). */
const HEAD_ROWS = 1000;

/** The XML inside a .zip already checked (SHA-256 and directory). */
export interface ZippedXml {
  sha256: string;
  entries: ZipEntry[];
  entry: ZipEntry;
}

/** The only .xml of a .zip (folders and the metadata a Mac adds are not files of the user). */
export function xmlEntryOf(name: string, entries: ZipEntry[]): ZipEntry {
  const xml = entries.filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && /\.xml$/i.test(e.name));
  if (xml.length === 1) return xml[0]!;
  if (xml.length > 1) throw new IngestError('fileCheck', `${name}: o .zip deve conter um único arquivo .xml (contém ${xml.length}: ${xml.map((e) => e.name).join(', ')}).`);
  throw new IngestError('fileCheck', `${name}: o .zip não contém nem uma planilha .xlsx nem um arquivo .xml da extração.`);
}

/** Text of a cell of a row read from the XML (no shared strings). */
const cellText: CellText = (row, c) => {
  const extra = c >= row.width;
  const kind = extra ? row.extraKind[c - row.width] : row.kind[c];
  if (kind === CellKind.Empty) return '';
  return (extra ? row.extraText[c - row.width] : row.text[c])!;
};

/** Streaming decoder of the bytes in the encoding the XML declares, made on the first bytes. */
class XmlText {
  private decoder: TextDecoder | null = null;
  encoding = 'utf-8';

  constructor(
    private readonly name: string,
    private readonly onText: (text: string) => void,
  ) {}

  push(bytes: Uint8Array): void {
    if (!this.decoder) {
      this.encoding = xmlDeclaredEncoding(bytes);
      try {
        this.decoder = new TextDecoder(this.encoding);
      } catch {
        throw new IngestError('fileCheck', `${this.name}: a codificação "${this.encoding}" declarada no XML não é suportada.`);
      }
    }
    this.onText(this.decoder.decode(bytes, { stream: true }));
  }

  finish(): void {
    if (this.decoder) this.onText(this.decoder.decode());
  }
}

/** Streams the bytes of the XML (the file, or its entry in the .zip, whose CRC32 and size are checked). */
async function streamXml(blob: Blob, zipped: ZippedXml | null, o: SheetReadOptions, onChunk: (bytes: Uint8Array) => void, onBytes: (done: number) => void): Promise<EntryIntegrity | null> {
  if (zipped) return readEntry(blob, zipped.entry, onChunk, { inflateMode: o.inflateMode, onBytes });
  const reader = (blob.stream() as ReadableStream<Uint8Array>).getReader();
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    onChunk(r.value);
    done += r.value.length;
    onBytes(done);
  }
  return null;
}

export async function readXmlSheet(input: IngestInput, o: SheetReadOptions, zipped: ZippedXml | null): Promise<SheetReadResult> {
  const { name, blob } = input;
  const { progress, fileIndex } = o;
  const alerts: Alert[] = [];
  const checked = new Map<string, EntryIntegrity>();
  const malformed = (stage: 'fileCheck' | 'rows', e: unknown): never => {
    if (e instanceof SheetFormatError) throw new IngestError(stage, `${name}: ${e.message}`);
    throw e;
  };

  // 1. File check: worksheets and their first rows, the end of the document; SHA-256 with a plain XML.
  const heads: HeadRow[][] = [];
  const scan = new XmlSpreadsheetParser(
    {
      onSheet: (s) => (heads[s.index] = []),
      onRow: (sheet: number, r: number, row: ParsedRow) => {
        const titles = Array.from({ length: row.width }, (_, c) => cellText(row, c));
        while (titles.length > 0 && titles[titles.length - 1] === '') titles.pop();
        heads[sheet]!.push({ r, titles });
      },
    },
    o.width,
    { headRows: HEAD_ROWS },
  );
  const scanText = new XmlText(name, (t) => {
    try {
      scan.push(t);
    } catch (e) {
      malformed('fileCheck', e);
    }
  });
  let hash: string;
  if (zipped) {
    hash = zipped.sha256;
    progress.begin('fileCheck', fileIndex, zipped.entry.uncompressedSize, 'bytes', `Conferindo o XML de ${name}`);
    const integrity = await streamXml(blob, zipped, o, (c) => scanText.push(c), (b) => progress.update(b));
    checked.set(zipped.entry.name, requireIntact(integrity!, 'fileCheck'));
  } else {
    progress.begin('fileCheck', fileIndex, blob.size, 'bytes', `Conferindo ${name}`);
    const hasher = await createSHA256();
    hasher.init();
    await streamXml(blob, null, o, (c) => {
      hasher.update(c);
      scanText.push(c);
    }, (b) => progress.update(b));
    hash = hasher.digest('hex');
  }
  scanText.finish();
  try {
    scan.finish();
  } catch (e) {
    malformed('fileCheck', e);
  }
  if (zipped) {
    for (const entry of zipped.entries) {
      if (!checked.has(entry.name)) checked.set(entry.name, requireIntact(await readEntry(blob, entry, () => {}, { inflateMode: o.inflateMode }), 'fileCheck'));
    }
  }

  // 2. The worksheet chosen by the module.
  const sheets: WorkbookSheet[] = scan.sheets.map((s) => ({ name: s.name, relationshipId: '' }));
  const head = async (sheet: WorkbookSheet, count: number) => (heads[sheets.indexOf(sheet)] ?? []).slice(0, count);
  const chosen = await o.chooseSheet(sheets, head, { date1904: false });
  if (typeof chosen === 'string') throw new IngestError('rows', chosen);
  const sheet = scan.sheets[chosen]!;

  // 3. Its rows, streamed.
  const total = zipped ? zipped.entry.uncompressedSize : blob.size;
  progress.begin('rows', fileIndex, total, 'bytes', `Lendo as linhas de ${name}`);
  let lastRow = 0;
  let presentRows = 0;
  let extraCells = 0;
  const rows = new XmlSpreadsheetParser(
    {
      onRow: (index: number, r: number, row: ParsedRow) => {
        if (index !== chosen) return;
        if (r <= lastRow) throw new IngestError('rows', `Linhas fora de ordem na aba "${sheet.name}" (linha ${r} após a linha ${lastRow}).`);
        lastRow = r;
        presentRows++;
        extraCells += row.extraCells;
        o.onRow(r, row, cellText, () => 0);
      },
    },
    o.width,
  );
  const rowText = new XmlText(name, (t) => {
    try {
      rows.push(t);
    } catch (e) {
      if (e instanceof SheetFormatError) throw new IngestError('rows', `A aba "${sheet.name}" de ${name} está malformada.`, e.message);
      throw e;
    }
  });
  const integrity = await streamXml(blob, zipped, o, (c) => rowText.push(c), (b) => progress.update(b, presentRows));
  if (integrity) requireIntact(integrity, 'rows');
  rowText.finish();
  try {
    rows.finish();
  } catch (e) {
    malformed('rows', e);
  }
  progress.update(total, presentRows);
  progress.closeStage();

  return {
    name,
    size: blob.size,
    sha256: hash,
    format: zipped ? 'xmlZip' : 'xml',
    entries: zipped ? zipped.entries.map((e) => checked.get(e.name)!) : [],
    sheetNames: sheets.map((s) => s.name),
    sheetName: sheet.name,
    date1904: false,
    dimensionRows: sheet.expandedRowCount,
    lastRow,
    extraCells,
    invalidSharedIndex: 0,
    alerts,
  };
}
