/**
 * Streaming reading of one sheet of an .xlsx, shared by the modules (docs/MODULOS.md, section 2): SHA-256 of the
 * file, ZIP directory, CRC32 and size of every entry, shared strings, then the rows of the sheet chosen by the
 * module, given one by one. What a row means (header, blank, detail) is decided by the module. Built only on the
 * reading primitives used by the CFGR700 pipeline, which keeps its own path.
 */
import type { Alert, EntryIntegrity } from '../../shared/protocol';
import { IngestError } from './errors';
import type { InflateMode } from './inflate';
import { requireIntact, sha256 } from './integrity';
import type { IngestInput } from './pipeline';
import type { ProgressReporter } from './progress';
import { CellKind, SheetParser, type ParsedRow } from './sheetStream';
import { SharedStringsParser } from './sst';
import { parseRelationships, parseWorkbookSheets, resolvePartPath, type WorkbookSheet } from './workbook';
import { ZipFormatError, readEntry, readEntryBytes, readEntryHead, readZipDirectory, type ZipEntry } from './zip';

/** A row of the beginning of a sheet, with its cells as text. */
export interface HeadRow {
  r: number;
  titles: string[];
}

export type CellText = (row: ParsedRow, c: number) => string;

/** What the module may need of the workbook before reading the rows. */
export interface WorkbookInfo {
  /** Dates of the workbook counted from 1904 (Excel for Mac), not 1900. */
  date1904: boolean;
}

export interface SheetReadOptions {
  fileIndex: number;
  progress: ProgressReporter;
  inflateMode: InflateMode;
  /** Columns kept per row; cells beyond it are counted in `extraCells`. */
  width: number;
  /**
   * Index of the sheet to read, or the message of the reading error when none fits. `head` gives the first rows of
   * a sheet (not checked; the chosen sheet is read in full). May also throw an IngestError of its own.
   */
  chooseSheet(
    sheets: WorkbookSheet[],
    head: (sheet: WorkbookSheet, rows: number) => Promise<HeadRow[]>,
    workbook: WorkbookInfo,
  ): Promise<number | string>;
  /**
   * Each row present in the sheet, in order. `row` is reused: read it during the call. `invalidShared` counts the
   * cells read so far that point outside the shared strings (`cell` gives '' for them).
   */
  onRow(r: number, row: ParsedRow, cell: CellText, invalidShared: () => number): void;
}

export interface SheetReadResult {
  name: string;
  size: number;
  sha256: string;
  /** Every entry of the ZIP, in directory order, all intact. */
  entries: EntryIntegrity[];
  sheetNames: string[];
  sheetName: string;
  date1904: boolean;
  /** Last row according to <dimension>, when present. */
  dimensionRows: number | null;
  /** Last row present in the sheet. */
  lastRow: number;
  /** Cells beyond `width` columns. */
  extraCells: number;
  /** Shared-string cells pointing outside the shared strings. */
  invalidSharedIndex: number;
  alerts: Alert[];
}

const DATE_1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/;

export async function readSheet(input: IngestInput, o: SheetReadOptions): Promise<SheetReadResult> {
  const { name, blob } = input;
  const { progress, inflateMode, fileIndex } = o;
  const checked = new Map<string, EntryIntegrity>();
  const alerts: Alert[] = [];

  // 1. File check: SHA-256, ZIP directory, workbook structure and the small entries.
  progress.begin('fileCheck', fileIndex, blob.size, 'bytes', `Conferindo ${name}`);
  const hash = await sha256(blob, progress);
  let entries: ZipEntry[];
  try {
    entries = await readZipDirectory(blob);
  } catch (e) {
    if (e instanceof ZipFormatError) throw new IngestError('fileCheck', `${name}: ${e.message}`);
    throw e;
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const readText = async (entryName: string): Promise<string> => {
    const entry = byName.get(entryName);
    if (!entry) throw new IngestError('fileCheck', `${name}: o arquivo não é um .xlsx válido (${entryName} ausente).`);
    const { bytes, integrity } = await readEntryBytes(blob, entry, inflateMode);
    checked.set(entry.name, requireIntact(integrity, 'fileCheck'));
    return new TextDecoder().decode(bytes);
  };
  const workbookXml = await readText('xl/workbook.xml');
  const date1904 = DATE_1904.test(workbookXml);
  const sheets = parseWorkbookSheets(workbookXml);
  const rels = parseRelationships(await readText('xl/_rels/workbook.xml.rels'));
  const relTarget = new Map(rels.map((r) => [r.id, resolvePartPath(r.target)]));
  const entryOf = (sheet: WorkbookSheet): ZipEntry => {
    const path = relTarget.get(sheet.relationshipId);
    const entry = path ? byName.get(path) : undefined;
    if (!entry) throw new IngestError('fileCheck', `${name}: dados da aba "${sheet.name}" não encontrados no arquivo.`);
    return entry;
  };
  const sheetEntries = new Set(sheets.map((s) => entryOf(s).name));
  const sstPath = resolvePartPath(rels.find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  const sstEntry = byName.get(sstPath);
  for (const entry of entries) {
    if (checked.has(entry.name) || sheetEntries.has(entry.name) || entry.name === sstEntry?.name) continue;
    checked.set(entry.name, requireIntact(await readEntry(blob, entry, () => {}, { inflateMode }), 'fileCheck'));
  }

  // 2. Shared strings of this file.
  let strings: string[] = [];
  progress.begin('sharedStrings', fileIndex, sstEntry?.uncompressedSize ?? 0, 'bytes', `Lendo as strings compartilhadas de ${name}`);
  if (sstEntry) {
    const sst = new SharedStringsParser();
    const decoder = new TextDecoder('utf-8');
    const integrity = await readEntry(blob, sstEntry, (c) => sst.push(decoder.decode(c, { stream: true })), {
      inflateMode,
      onBytes: (b) => progress.update(b),
    });
    checked.set(sstEntry.name, requireIntact(integrity, 'sharedStrings'));
    sst.push(decoder.decode());
    try {
      strings = sst.finish();
    } catch (e) {
      throw new IngestError('sharedStrings', `${name}: as strings compartilhadas estão incompletas.`, String(e));
    }
    if (sst.declaredUniqueCount !== null && sst.declaredUniqueCount >= 0 && sst.declaredUniqueCount !== strings.length) {
      alerts.push({ level: 'warning', message: `sharedStrings declara ${sst.declaredUniqueCount} strings únicas, mas contém ${strings.length}.` });
    }
  }
  let invalidSharedIndex = 0;
  const cell: CellText = (row, c) => {
    switch (row.kind[c]) {
      case CellKind.Empty:
        return '';
      case CellKind.Shared: {
        const s = strings[row.sharedIndex[c]!];
        if (s !== undefined) return s;
        invalidSharedIndex++;
        return '';
      }
      default:
        return row.text[c]!;
    }
  };

  const invalidShared = () => invalidSharedIndex;

  // 3. The sheet chosen by the module, streamed; then the integrity of the other sheets.
  const head = async (sheet: WorkbookSheet, count: number): Promise<HeadRow[]> => {
    const out: HeadRow[] = [];
    const parser = new SheetParser((r, row) => {
      if (out.length >= count) return;
      const titles = Array.from({ length: row.width }, (_, c) => cell(row, c));
      while (titles.length > 0 && titles[titles.length - 1] === '') titles.pop();
      out.push({ r, titles });
    }, o.width);
    await readEntryHead(blob, entryOf(sheet), (c) => {
      parser.push(c);
      return out.length < count;
    }, inflateMode);
    return out;
  };
  const chosen = await o.chooseSheet(sheets, head, { date1904 });
  if (typeof chosen === 'string') throw new IngestError('rows', chosen);
  const sheet = sheets[chosen]!;
  const entry = entryOf(sheet);
  progress.begin('rows', fileIndex, entry.uncompressedSize, 'bytes', `Lendo as linhas de ${name}`);
  let lastRow = 0;
  let presentRows = 0;
  let extraCells = 0;
  const parser = new SheetParser((r, row) => {
    if (r <= lastRow) throw new IngestError('rows', `Linhas fora de ordem na aba "${sheet.name}" (linha ${r} após a linha ${lastRow}).`);
    lastRow = r;
    presentRows++;
    extraCells += row.extraCells;
    o.onRow(r, row, cell, invalidShared);
  }, o.width);
  const integrity = await readEntry(blob, entry, (c) => parser.push(c), { inflateMode, onBytes: (b) => progress.update(b, presentRows) });
  checked.set(entry.name, requireIntact(integrity, 'rows'));
  try {
    parser.finish();
  } catch (e) {
    throw new IngestError('rows', `A aba "${sheet.name}" de ${name} está incompleta.`, String(e));
  }
  progress.update(entry.uncompressedSize, presentRows);
  for (const other of sheets) {
    const e = entryOf(other);
    if (!checked.has(e.name)) checked.set(e.name, requireIntact(await readEntry(blob, e, () => {}, { inflateMode }), 'rows'));
  }
  progress.closeStage();

  return {
    name,
    size: blob.size,
    sha256: hash,
    entries: entries.map((e) => checked.get(e.name)!).filter((e) => e !== undefined),
    sheetNames: sheets.map((s) => s.name),
    sheetName: sheet.name,
    date1904,
    dimensionRows: parser.dimension?.lastRow ?? null,
    lastRow,
    extraCells,
    invalidSharedIndex,
    alerts,
  };
}
