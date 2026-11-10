/**
 * Synthetic CT2 extractions for the reading tests (docs/REGRAS_CT2_INTEGRIDADE.md, sections 2-4 and 11), with the
 * expected numbers worked out by hand next to each case. No real data.
 */
import { CT2_FIELDS, ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
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
  // The entities of Phase 14 (after the first 20 fields), then the other columns without "Filial".
  ...CT2_COLUMNS.slice(20, CT2_FIELDS.length),
  ...CT2_COLUMNS.slice(CT2_FIELDS.length + 1),
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

/** Fields added by version 3 (Phase 14): the entities of each side. */
const V3_COLUMNS = ['costCenterDebit', 'costCenterCredit', 'itemDebit', 'itemCredit', 'valueClassDebit', 'valueClassCredit'];

/** The default columns as versions 1 and 2 wrote them (the 20 fields of Phase 9, without the entities). */
function columnsBeforeV3(): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...ct2DefaultConfig().columns };
  for (const f of V3_COLUMNS) delete columns[f];
  return columns;
}

/** The default configuration as version 1 wrote it (Phase 9: the reading only, without tests and parameters). */
export function ct2ConfigV1(): Record<string, unknown> {
  const c: Record<string, unknown> = { ...ct2DefaultConfig(), schemaVersion: 1, columns: columnsBeforeV3() };
  delete c.tests;
  delete c.parameters;
  delete c.manualFlag;
  return c;
}

/** The default configuration as version 2 wrote it (Phases 10-13): the 20 columns and the tests I3 and I4 whole. */
export function ct2ConfigV2(): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const [code, t] of Object.entries(ct2DefaultConfig().tests)) {
    if (code === 'I3a') ordered.I3 = { enabled: true, severity: 'warning' };
    else if (code === 'I4a') ordered.I4 = { enabled: true, severity: 'warning' };
    if (!/^I[34][abc]$/.test(code)) ordered[code] = { ...t };
  }
  return { ...ct2DefaultConfig(), schemaVersion: 2, columns: columnsBeforeV3(), tests: ordered };
}
