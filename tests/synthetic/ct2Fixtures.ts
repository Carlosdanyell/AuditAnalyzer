/**
 * Synthetic CT2 extractions for the reading tests (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4 and 11), with the
 * expected numbers worked out by hand next to each case. No real data.
 */
import { CT2_COLUMNS, ct2Line, type Ct2ExtractionOptions, type Ct2Row } from './ct2Extraction';

const NO_KEY = { date: null, batch: null, subBatch: null, document: null, line: null, balanceType: null, currency: null, entryType: null } as const;

/**
 * File A, header in row 3 (rows 4-16):
 * 4-6 document 1 (double entry 100, debit 30, credit 30); 7-8 gap; 9 history continuation without amount (0);
 * 10 empty row; 11 document 2 in currency 02 (another segment); 12 numeric codes (document 3); 13 orphan row with
 * only a history (CI-4: key, line, segment, amount); 14 unreadable amount (CI-4); 15 date 31/09/2026 (CI-4);
 * 16 pt-BR text amount and an Excel serial date (document 6).
 */
export const FILE_A_ROWS: Ct2Row[] = [
  ct2Line({ line: '001', amount: 100 }),
  ct2Line({ line: '002', entryType: 'Debito', creditAccount: null, amount: 30, amountCurrency1: 30 }),
  ct2Line({ line: '003', entryType: 'Credito', debitAccount: null, amount: 30, amountCurrency1: 30 }),
  { gap: 2 },
  ct2Line({ document: '000002', entryType: 'Cont.Hist', debitAccount: null, creditAccount: null, amount: null, amountCurrency1: null }),
  { empty: true },
  ct2Line({ document: '000002', currency: '02' }),
  ct2Line({ batch: 1, subBatch: 1, document: 3, line: 1, amount: 50, amountCurrency1: 50 }),
  ct2Line({ ...NO_KEY, debitAccount: null, creditAccount: null, amount: null, amountCurrency1: null, history: 'CONTINUACAO SOLTA' }),
  ct2Line({ document: '000004', amount: 'abc' }),
  ct2Line({ document: '000005', date: '31/09/2026' }),
  ct2Line({ document: '000006', date: 46280, amount: '1.234,56', amountCurrency1: '1.234,56' }),
];

export const fileA = (o: Partial<Ct2ExtractionOptions> = {}): Ct2ExtractionOptions => ({ rows: FILE_A_ROWS, ...o });

/** Columns of file B: another order, an alias for Valor, and a column only it has. */
export const FILE_B_COLUMNS = [
  'Filial',
  ...CT2_COLUMNS.slice(0, 20).reverse().map((t) => (t.trim() === 'Valor' ? 'CT2_VALOR' : t)),
  'Campo Exclusivo B',
  ...CT2_COLUMNS.slice(21),
];

/** File B, clean: document 10 with three balanced lines (double entry 200, debit 70, credit 70). */
export const fileB = (o: Partial<Ct2ExtractionOptions> = {}): Ct2ExtractionOptions => ({
  columns: FILE_B_COLUMNS,
  inlineStrings: true,
  rows: [
    ct2Line({ document: '000010', line: '001', amount: 200, amountCurrency1: 200 }, { 'Campo Exclusivo B': 'x' }),
    ct2Line({ document: '000010', line: '002', entryType: 'Debito', creditAccount: null, amount: 70, amountCurrency1: 70 }),
    ct2Line({ document: '000010', line: '003', entryType: 'Credito', debitAccount: null, amount: 70, amountCurrency1: 70 }),
  ],
  ...o,
});
