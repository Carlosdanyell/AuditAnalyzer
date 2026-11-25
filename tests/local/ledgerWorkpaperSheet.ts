/**
 * Test source only, never a format of the screen (docs/REGRAS_CONCILIADOR.md, 5.4; docs/FASE_15_CONCILIADOR_FOLHA.md,
 * 6.3): the copy of the ledger the user pasted in sheet "3" of the workpaper, read with the platform's readSheet.ts and
 * given to the XML reader of the CTBR400 as spreadsheet rows. The copy differs from the export of the Protheus in three
 * ways, all tolerated here: an extra column "Visão" at the end (dropped), band rows "Documento arquivado no diretório: …"
 * between the accounts (dropped, each one starting the next account), and every account with its own grand total, as
 * if extracted alone (so each account is read as its own reading). Numbers of an .xlsx are stored as doubles: the text
 * is taken back to cents (Math.round, as the platform does for .xlsx amounts) and written as "1234.56".
 */
import { openAsBlob } from 'node:fs';
import { ProgressReporter } from '../../src/worker/ingest/progress';
import { readSheet } from '../../src/worker/ingest/readSheet';
import { CellKind } from '../../src/worker/ingest/sheetStream';
import { centsFromNumberText } from '../../src/shared/money';
import type { SpreadsheetCell, SpreadsheetCells } from '../../src/worker/modules/reconciliation/formats/spreadsheetml';
import { LedgerSheetReader, type LedgerReading } from '../../src/worker/modules/reconciliation/reports/ctbr400';

const SHEET = '3';
/** Columns of the ledger (A–K); the 12th ("Visão") is the user's. */
const LEDGER_COLUMNS = 11;
/** Debit and credit (columns I and J). */
const AMOUNT_COLUMNS = new Set([8, 9]);
const BAND = 'Documento arquivado no diretório:';

/** Cents → "1234.56" (the Number text the reader converts). */
const centsText = (cents: number) => `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;

/** One reading per account of sheet "3", in the order of the sheet. */
export async function readWorkpaperLedger(path: string): Promise<LedgerReading[]> {
  const rows: { r: number; cells: SpreadsheetCells }[] = [];
  await readSheet(
    { name: 'papel-de-trabalho.xlsx', blob: await openAsBlob(path) },
    {
      fileIndex: 0,
      progress: new ProgressReporter(() => {}, () => 0, 0),
      inflateMode: 'auto',
      width: 16,
      chooseSheet: async (sheets) => {
        const i = sheets.findIndex((s) => s.name === SHEET);
        return i >= 0 ? i : `Aba "${SHEET}" não encontrada.`;
      },
      onRow: (r, row, cell) => {
        const cells: (SpreadsheetCell | null)[] = [];
        for (let c = 0; c < LEDGER_COLUMNS; c++) {
          const text = cell(row, c);
          const kind = row.kind[c];
          if (kind === CellKind.Empty || (kind !== CellKind.Number && text === '')) cells.push(null);
          else if (kind === CellKind.Number) cells.push({ kind: 'number', text: AMOUNT_COLUMNS.has(c) ? centsText(centsFromNumberText(text)) : text });
          else cells.push({ kind: 'text', text });
        }
        while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
        rows.push({ r, cells });
      },
    },
  );
  const titles = rows.find((x) => x.cells[0]?.text === 'DATA');
  if (!titles) throw new Error(`Aba "${SHEET}" sem a linha de títulos.`);
  // Blocks between band rows; the first one holds the row of titles.
  const blocks: { r: number; cells: SpreadsheetCells }[][] = [[]];
  for (const row of rows) {
    if ((row.cells[0]?.text ?? '').startsWith(BAND)) blocks.push([]);
    else blocks[blocks.length - 1]!.push(row);
  }
  const readings: LedgerReading[] = [];
  for (const block of blocks) {
    if (!block.some((x) => (x.cells[0]?.text ?? '').startsWith('CONTA - '))) continue;
    const reader = new LedgerSheetReader();
    if (!block.includes(titles)) reader.row(0, SHEET, titles.r, titles.cells);
    for (const row of block) reader.row(0, SHEET, row.r, row.cells);
    readings.push(reader.finish());
  }
  return readings;
}
