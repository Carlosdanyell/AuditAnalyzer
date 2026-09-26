/**
 * Reads justifications from a previous export (docs/REGRAS_CFGR700.md, section 9): tabs "Justificativa da
 * Exclusao" and "Justificativa da Alteração" (key in column A, text in the column "Justificativa …", optional
 * "Responsável" and "Observação"), plus what is needed to deduce the coverage: the files listed in the
 * Rastreabilidade tab, or the last event date found in Documentos / Base_Linhas. Workbooks exported by the tool
 * (Portuguese or English) also carry the coverage of each justification and the "Abrange o novo evento?" column.
 */
import { INVALID_TIME, parseDate, parseDateTime } from '../../shared/dates';
import type { ImportedJustification, JustificationCoverage, JustificationKind, LoadedFileInfo } from '../../shared/protocol';
import { normalizeLabel } from '../ingest/parametros';
import { CellKind, SheetParser } from '../ingest/sheetStream';
import { SharedStringsParser } from '../ingest/sst';
import { parseRelationships, parseWorkbookSheets, resolvePartPath } from '../ingest/workbook';
import { readEntryBytes, readZipDirectory, type ZipEntry } from '../ingest/zip';

type Cell = string | number | null;

export interface JustificationWorkbook {
  items: ImportedJustification[];
  /** File names listed in the Rastreabilidade tab; null when there is no such tab or it lists no file. */
  rastreabilidadeFiles: string[] | null;
  /** Latest event date found in Documentos / Base_Linhas (seconds); null when none. */
  lastEvent: number | null;
}

const EXCEL_SERIAL_2000 = 36526;
/** Notes that confirm the coverage of a justification moved after it was written. */
const CONFIRMATION_NOTES = ['abrange o novo evento', 'covers the new event'];
const YES = new Set(['sim', 'yes', 's', 'y', 'x']);
const WIDTH = 40;

async function readSheets(blob: Blob): Promise<Map<string, Cell[][]>> {
  const entries = await readZipDirectory(blob);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (entry: ZipEntry | undefined) => (entry ? new TextDecoder().decode((await readEntryBytes(blob, entry)).bytes) : '');
  const sheets = parseWorkbookSheets(await text(byName.get('xl/workbook.xml')));
  const rels = parseRelationships(await text(byName.get('xl/_rels/workbook.xml.rels')));
  const target = new Map(rels.map((r) => [r.id, resolvePartPath(r.target)]));
  const sstPath = resolvePartPath(rels.find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  let strings: string[] = [];
  const sstEntry = byName.get(sstPath);
  if (sstEntry) {
    const parser = new SharedStringsParser();
    parser.push(await text(sstEntry));
    strings = parser.finish();
  }
  const out = new Map<string, Cell[][]>();
  for (const sheet of sheets) {
    const entry = byName.get(target.get(sheet.relationshipId) ?? '');
    if (!entry) continue;
    const rows: Cell[][] = [];
    const parser = new SheetParser((r, row) => {
      const cells: Cell[] = [];
      for (let c = 0; c < row.width; c++) {
        const kind = row.kind[c];
        cells[c] =
          kind === CellKind.Shared
            ? (strings[row.sharedIndex[c]!] ?? null)
            : kind === CellKind.Number
              ? Number(row.text[c])
              : kind === CellKind.Empty
                ? null
                : row.text[c]!;
      }
      rows[r - 1] = cells;
    }, WIDTH);
    parser.push((await readEntryBytes(blob, entry)).bytes);
    parser.finish();
    out.set(sheet.name, Array.from(rows, (r) => r ?? []));
  }
  return out;
}

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c)).trim();
const nonEmpty = (row: Cell[]) => row.filter((c) => str(c) !== '').length;

function findSheet(sheets: Map<string, Cell[][]>, test: (normalized: string) => boolean): Cell[][] | undefined {
  for (const [name, rows] of sheets) if (test(normalizeLabel(name).replace(/_/g, ' '))) return rows;
  return undefined;
}

const isTextHeader = (h: string) => h.startsWith('justificativa') || / justification$/.test(h);

function readJustifications(rows: Cell[][], kind: JustificationKind): ImportedJustification[] {
  const headerIndex = rows.findIndex((row) => nonEmpty(row) >= 2 && row.some((c, i) => i > 0 && isTextHeader(normalizeLabel(str(c)))));
  if (headerIndex < 0) return [];
  const header = rows[headerIndex]!.map((c) => normalizeLabel(str(c)));
  const col = (...prefixes: string[]) => header.findIndex((h) => prefixes.some((p) => h.startsWith(p)));
  const textCol = header.findIndex((h, i) => i > 0 && isTextHeader(h));
  const responsibleCol = col('responsavel', 'responsible');
  const noteCol = col('observa', 'note');
  const confirmCol = col(...CONFIRMATION_NOTES);
  const filesCol = col('arquivos cobertos', 'files covered');
  const lastCol = col('ultimo evento coberto', 'last event covered');
  const items: ImportedJustification[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const documentKey = str(row[0]);
    if (!documentKey) continue;
    const note = noteCol >= 0 ? normalizeLabel(str(row[noteCol])) : '';
    const item: ImportedJustification = {
      documentKey,
      kind,
      text: str(row[textCol]),
      responsible: responsibleCol >= 0 ? str(row[responsibleCol]) : '',
      confirmed:
        CONFIRMATION_NOTES.some((n) => note.includes(n)) || (confirmCol >= 0 && YES.has(normalizeLabel(str(row[confirmCol])))),
    };
    // Coverage written by the tool's export: file names separated by "; " and the last event covered.
    const files = filesCol >= 0 ? str(row[filesCol]).split(/\s*;\s*/).filter(Boolean) : [];
    const lastEvent = lastCol >= 0 ? eventSeconds(row[lastCol], false) : null;
    if (files.length > 0 || lastEvent !== null) item.coverage = { files, lastEvent };
    items.push(item);
  }
  return items;
}

/** Seconds of an event date cell; a date alone covers the whole day unless endOfDay is false. */
function eventSeconds(cell: Cell | undefined, endOfDay = true): number | null {
  if (typeof cell === 'number') {
    if (!(cell > 1 && cell < 2958466)) return null;
    return Math.round((cell - EXCEL_SERIAL_2000) * 86400);
  }
  const s = str(cell);
  if (!s) return null;
  const dt = parseDateTime(s);
  if (dt !== INVALID_TIME) return dt;
  const day = parseDate(s);
  return day === INVALID_TIME ? null : day * 86400 + (endOfDay ? 86399 : 0);
}

/** Latest event date in the date columns of an analysis tab (ignores accounting dates). */
function lastEventIn(rows: Cell[][] | undefined): number | null {
  if (!rows) return null;
  const headerIndex = rows.findIndex((row) => nonEmpty(row) >= 2);
  if (headerIndex < 0) return null;
  const columns = rows[headerIndex]!.flatMap((c, i) => {
    const h = normalizeLabel(str(c));
    const isEvent =
      (h.includes('data') && ['exclus', 'altera', 'postagem', 'inclus', 'evento'].some((w) => h.includes(w))) ||
      h.startsWith('ultima alteracao efetiva') ||
      ['first deletion', 'last deletion', 'last effective change', 'first posting', 'insert time', 'delete time'].some((w) => h.startsWith(w));
    const isAccounting = h.includes('lancamento') || h.includes('contabil') || h.includes('accounting');
    return isEvent && !isAccounting ? [i] : [];
  });
  let last: number | null = null;
  for (const row of rows.slice(headerIndex + 1)) {
    for (const i of columns) {
      const t = eventSeconds(row[i]);
      if (t !== null && (last === null || t > last)) last = t;
    }
  }
  return last;
}

export async function readJustificationWorkbook(blob: Blob): Promise<JustificationWorkbook> {
  const sheets = await readSheets(blob);
  const deletion = findSheet(sheets, (n) => n.includes('justificativa da exclusao') || n === 'deletion justifications');
  const change = findSheet(sheets, (n) => n.includes('justificativa da alteracao') || n === 'change justifications');
  if (!deletion && !change) {
    throw new Error('a planilha não tem as abas "Justificativa da Exclusao" nem "Justificativa da Alteração".');
  }
  const items = [...(deletion ? readJustifications(deletion, 'deletion') : []), ...(change ? readJustifications(change, 'change') : [])];

  const trace = findSheet(sheets, (n) => n.includes('rastreabilidade') || n === 'traceability');
  let rastreabilidadeFiles: string[] | null = null;
  if (trace) {
    const names = new Set<string>();
    for (const row of trace) {
      for (const c of row) {
        const s = str(c);
        if (/\.xlsx?$/i.test(s)) names.add(s.split(/[\\/]/).pop()!);
      }
    }
    rastreabilidadeFiles = names.size ? [...names] : null;
  }

  const candidates = [
    findSheet(sheets, (n) => n === 'documentos' || n === 'documents'),
    findSheet(sheets, (n) => n === 'base linhas' || n === 'lines'),
  ];
  const lasts = candidates.map(lastEventIn).filter((t): t is number => t !== null);
  return { items, rastreabilidadeFiles, lastEvent: lasts.length ? Math.max(...lasts) : null };
}

/** Coverage of the imported justifications (the user can change it on screen). */
export function deduceCoverage(
  book: JustificationWorkbook,
  loaded: LoadedFileInfo[],
): JustificationCoverage & { method: 'rastreabilidade' | 'eventos' | 'nenhum' } {
  if (book.rastreabilidadeFiles) {
    const listed = new Set(book.rastreabilidadeFiles.map((n) => n.toLowerCase()));
    const files = loaded.filter((f) => listed.has(f.name.split(/[\\/]/).pop()!.toLowerCase()));
    const lasts = files.map((f) => f.lastEvent).filter((t): t is number => t !== null);
    return { method: 'rastreabilidade', files: files.map((f) => f.name), lastEvent: lasts.length ? Math.max(...lasts) : null };
  }
  if (book.lastEvent !== null) {
    const last = book.lastEvent;
    return {
      method: 'eventos',
      files: loaded.filter((f) => f.firstEvent !== null && f.firstEvent <= last).map((f) => f.name),
      lastEvent: last,
    };
  }
  return { method: 'nenhum', files: [], lastEvent: null };
}
