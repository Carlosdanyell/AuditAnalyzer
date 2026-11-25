/**
 * Format adapter of the XML Spreadsheet 2003 the Protheus exports (docs/REGRAS_CONCILIADOR.md, sections 2 and 5.3):
 * Blob → rows of every worksheet, in a stream, as "spreadsheet rows" (cells as text). Knows no report. The parsing is the
 * platform's (src/worker/ingest/xmlSpreadsheet.ts, also used by the CT2 module): ss:Index of rows and cells,
 * ss:MergeAcross, CDATA and entities handled there; a Number cell keeps the text as written (the reader converts it to
 * cents, never through a float) and a DateTime becomes the Excel serial of its day.
 */
import { ParsedRow, CellKind } from '../../../ingest/sheetStream';
import { XmlSpreadsheetParser, xmlDeclaredEncoding } from '../../../ingest/xmlSpreadsheet';

/** A cell with a value; an empty cell is null. `number`: a Number or DateTime cell (its text, or the serial of the day). */
export interface SpreadsheetCell {
  kind: 'text' | 'number' | 'other';
  text: string;
}

/** The cells of one row, from column 1 (index 0); trailing empty cells left out. */
export type SpreadsheetCells = readonly (SpreadsheetCell | null)[];

/** What the reading of a SpreadsheetML file reports (Reconciliação de leitura). */
export interface SpreadsheetReading {
  encoding: string;
  bytes: number;
  /** Names of the worksheets, in order. */
  sheets: string[];
  /** Rows present, in every worksheet. */
  rows: number;
  /** Cells beyond the columns read (WIDTH): none in the reports of the module. */
  extraCells: number;
}

/** Columns kept per row: the ledger has 11; the rest are counted in `extraCells`. */
const WIDTH = 64;

const KIND: Record<number, SpreadsheetCell['kind'] | undefined> = { [CellKind.Number]: 'number', [CellKind.Text]: 'text', [CellKind.Other]: 'other' };

function cellsOf(row: ParsedRow): (SpreadsheetCell | null)[] {
  const cells: (SpreadsheetCell | null)[] = [];
  for (let c = 0; c < row.width; c++) {
    const kind = KIND[row.kind[c]!];
    cells.push(kind ? { kind, text: row.text[c]! } : null);
  }
  while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
  return cells;
}

/**
 * Calls `onRow` with each row present of each worksheet (sheet position and name, row number from 1, its cells). The
 * file is decoded in the encoding its declaration names and parsed piece by piece; it must end with </Workbook>
 * (otherwise it is incomplete and the parser throws).
 */
export async function readSpreadsheetRows(
  blob: Blob,
  onRow: (sheet: number, sheetName: string, r: number, cells: SpreadsheetCells) => void,
  onBytes?: (read: number, total: number) => void,
): Promise<SpreadsheetReading> {
  let rows = 0;
  let extraCells = 0;
  const parser = new XmlSpreadsheetParser(
    {
      onRow: (sheet, r, row) => {
        rows++;
        extraCells += row.extraCells;
        onRow(sheet, parser.sheets[sheet]!.name, r, cellsOf(row));
      },
    },
    WIDTH,
  );
  let decoder: TextDecoder | null = null;
  let encoding = 'utf-8';
  let bytes = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!decoder) {
      encoding = xmlDeclaredEncoding(value);
      decoder = new TextDecoder(encoding);
    }
    bytes += value.length;
    parser.push(decoder.decode(value, { stream: true }));
    onBytes?.(bytes, blob.size);
  }
  if (decoder) parser.push(decoder.decode());
  parser.finish();
  return { encoding, bytes, sheets: parser.sheets.map((s) => s.name), rows, extraCells };
}
