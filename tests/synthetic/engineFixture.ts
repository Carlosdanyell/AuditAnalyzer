/**
 * Two synthetic extractions covering the rules of docs/REGRAS_CFGR700.md, sections 4–8, with
 * hand-computed expected answers. Source 0 = "August" (17–31/08/2026), source 1 = "September" (01–04/09).
 *
 * Documents (key CT2_DATA|LOTE|SBLOTE|DOC):
 *  D1 17/08|000001|001|000001  manual   r1 DC1 100,00 · r2 DC2 100,00 · r3 DC4          balanced
 *  D2 18/08|000002|001|000010  autom.   r10 DC1 50,00 · r11 DC2 49,99                    unbalanced (1 cent)
 *  D3 19/08|000001|001|000020  mixed    r20 manual DC3 10,00 · r21 autom. DC4            deleted 21/08 and 26/08
 *  D4 20/08|000003|001|000030  manual   r31 DC1 20,00 (incl.) · r32 DC2 30,00 (only deleted)  partial base
 *  D5 24/08|000001|001|000050  manual   r50 DC1 5,00 INCONS 1→2 · r51 DC2 5,00 INCONS 1
 *  D6 02/09|000009|001|000060  autom.   r60 DC1 7,00 (two inclusions) · r61 DC2 7,00      September
 *  D7 30/08|000004|001|000070  manual   r70 DC1 1,00 deleted 04/09 without inclusion       September
 * Unidentified: r40 (HIST changed), r41 (USERGA only), r42 (TPSALD 9→1 only).
 * r2 has effective changes in both files; r10 is deleted in September.
 */
import { parseDate } from '../../src/shared/dates';
import { ct2Line, type LineSpec, type LogEvent } from './logBuilder';

const line = (p: LineSpec) => ct2Line(p);

const D1 = { date: '17/08/2026', lote: '000001', doc: '000001' };
const D2 = { date: '18/08/2026', lote: '000002', doc: '000010', manual: '2' };
const D3 = { date: '19/08/2026', lote: '000001', doc: '000020' };
const D4 = { date: '20/08/2026', lote: '000003', doc: '000030' };
const D5 = { date: '24/08/2026', lote: '000001', doc: '000050' };
const D6 = { date: '02/09/2026', lote: '000009', doc: '000060', manual: '2' };
const D7 = { date: '30/08/2026', lote: '000004', doc: '000070' };

const r20 = line({ ...D3, linha: '001', manual: '1', dc: '3', value: '10.00' });
const r21 = line({ ...D3, linha: '002', manual: '2', dc: '4', value: '0' });
const r10 = line({ ...D2, linha: '001', dc: '1', value: '50.00' });

export const EVENTS: LogEvent[] = [
  // ── Source 0 ──
  { recno: 1, op: 'Inclusão', at: '17/08/2026 10:00:00', user: 'usr01', fields: line({ ...D1, linha: '001', dc: '1', value: '100.00', tpsald: '9' }) },
  { recno: 2, op: 'Inclusão', at: '17/08/2026 10:00:00', user: 'usr01', fields: line({ ...D1, linha: '002', dc: '2', value: '100' }) },
  { recno: 3, op: 'Inclusão', at: '17/08/2026 10:00:00', user: 'usr01', fields: line({ ...D1, linha: '003', dc: '4', value: '0' }) },
  { recno: 1, op: 'Alteração', at: '18/08/2026 09:00:00', user: 'usr02', fields: { CT2_TPSALD: ['9', '1'], CT2_USERGA: ['a', 'b'] } },
  { recno: 3, op: 'Alteração', at: '19/08/2026 09:00:00', user: 'usr02', fields: { CT2_USERGA: ['a', 'b'] } },
  { recno: 2, op: 'Alteração', at: '20/08/2026 09:00:00', user: 'usr03', fields: { CT2_HIST: ['HISTORICO', 'NOVO'], CT2_USERGA: ['a', 'b'] } },
  { recno: 10, op: 'Inclusão', at: '18/08/2026 11:00:00', user: 'usr04', fields: r10 },
  { recno: 11, op: 'Inclusão', at: '18/08/2026 11:00:00', user: 'usr04', fields: line({ ...D2, linha: '002', dc: '2', value: '49.99' }) },
  { recno: 20, op: 'Inclusão', at: '19/08/2026 08:00:00', user: 'usr01', fields: r20 },
  { recno: 21, op: 'Inclusão', at: '19/08/2026 08:00:00', user: 'usr05', fields: r21 },
  { recno: 20, op: 'Exclusão', at: '21/08/2026 15:00:00', user: 'usr02', fields: r20 },
  { recno: 21, op: 'Exclusão', at: '26/08/2026 15:00:00', user: 'usr02', fields: r21 },
  { recno: 31, op: 'Inclusão', at: '20/08/2026 10:00:00', user: 'usr01', fields: line({ ...D4, linha: '001', dc: '1', value: '20.00' }) },
  { recno: 32, op: 'Exclusão', at: '27/08/2026 10:00:00', user: 'usr01', fields: line({ ...D4, linha: '002', dc: '2', value: '30.00' }) },
  { recno: 40, op: 'Alteração', at: '21/08/2026 12:00:00', user: 'usr02', fields: { CT2_HIST: ['A', 'B'] } },
  { recno: 41, op: 'Alteração', at: '22/08/2026 12:00:00', user: 'usr02', fields: { CT2_USERGA: ['a', 'b'] } },
  { recno: 42, op: 'Alteração', at: '23/08/2026 12:00:00', user: 'usr02', fields: { CT2_TPSALD: ['9', '1'] } },
  { recno: 50, op: 'Inclusão', at: '24/08/2026 09:00:00', user: 'usr01', fields: line({ ...D5, linha: '001', dc: '1', value: '5.00', incons: '1' }) },
  { recno: 51, op: 'Inclusão', at: '24/08/2026 09:00:00', user: 'usr01', fields: line({ ...D5, linha: '002', dc: '2', value: '5.00', incons: '1' }) },
  { recno: 50, op: 'Alteração', at: '25/08/2026 09:00:00', user: 'usr03', fields: { CT2_INCONS: ['1', '2'] } },
  // ── Source 1 ──
  { recno: 2, op: 'Alteração', at: '01/09/2026 10:00:00', user: 'usr03', source: 1, fields: { CT2_HIST: ['NOVO', 'OUTRO'] } },
  { recno: 60, op: 'Inclusão', at: '02/09/2026 08:00:00', user: 'usr06', source: 1, fields: line({ ...D6, linha: '001', dc: '1', value: '7.00' }) },
  { recno: 61, op: 'Inclusão', at: '02/09/2026 08:00:00', user: 'usr06', source: 1, fields: line({ ...D6, linha: '002', dc: '2', value: '7.00' }) },
  { recno: 61, op: 'Recuperação', at: '02/09/2026 08:00:00', user: 'usr06', source: 1, fields: { CT2_DATA: ['02/09/2026', '02/09/2026'] } },
  { recno: 60, op: 'Inclusão', at: '02/09/2026 08:00:05', user: 'usr07', source: 1, fields: { CT2_HIST: 'COMPLEMENTO' } },
  { recno: 10, op: 'Exclusão', at: '03/09/2026 10:00:00', user: 'usr02', source: 1, fields: r10 },
  { recno: 70, op: 'Exclusão', at: '04/09/2026 10:00:00', user: 'usr01', source: 1, fields: line({ ...D7, linha: '001', dc: '1', value: '1.00' }) },
];

export const KEYS = {
  D1: '17/08/2026|000001|001|000001',
  D2: '18/08/2026|000002|001|000010',
  D3: '19/08/2026|000001|001|000020',
  D4: '20/08/2026|000003|001|000030',
  D5: '24/08/2026|000001|001|000050',
  D6: '02/09/2026|000009|001|000060',
  D7: '30/08/2026|000004|001|000070',
};

const stats = (s: {
  records: number;
  documents: number;
  effective: number;
  activation: number;
  stamp: number;
  tpsald: number;
  unidentified: number;
  content: number;
  onlyActivation: number;
  onlyStamp: number;
  partial: number;
  unbalanced: number;
  deleted: number;
  deletedAccounting: number;
  changeRows: number;
  several: number;
}) => ({
  records: s.records,
  documents: s.documents,
  alterations: { effective: s.effective, activation: s.activation, stamp: s.stamp, total: s.effective + s.activation + s.stamp },
  balanceType: { total: s.tpsald, expected: s.tpsald },
  unidentifiedRecords: s.unidentified,
  unidentified: { contentChange: s.content, onlyActivation: s.onlyActivation, onlyStamp: s.onlyStamp, other: 0 },
  partialBaseDocuments: s.partial,
  unbalancedCompleteDocuments: s.unbalanced,
  deletedRecords: s.deleted,
  deletedAccountingRecords: s.deletedAccounting,
  effectiveChangeRows: s.changeRows,
  recordsInSeveralFiles: s.several,
  invalidValues: 0,
});

export const EXPECTED_STATS = {
  august: stats({
    records: 14, documents: 5, effective: 3, activation: 2, stamp: 2, tpsald: 2, unidentified: 3, content: 1,
    onlyActivation: 1, onlyStamp: 1, partial: 1, unbalanced: 1, deleted: 3, deletedAccounting: 2, changeRows: 3, several: 0,
  }),
  september: stats({
    records: 5, documents: 3, effective: 1, activation: 0, stamp: 0, tpsald: 0, unidentified: 1, content: 1,
    onlyActivation: 0, onlyStamp: 0, partial: 2, unbalanced: 0, deleted: 2, deletedAccounting: 2, changeRows: 1, several: 0,
  }),
  consolidated: stats({
    records: 17, documents: 7, effective: 4, activation: 2, stamp: 2, tpsald: 2, unidentified: 3, content: 1,
    onlyActivation: 1, onlyStamp: 1, partial: 2, unbalanced: 1, deleted: 5, deletedAccounting: 4, changeRows: 4, several: 2,
  }),
};

const day = parseDate;
export const PERIODS = {
  P1: { startDay: day('17/08/2026'), endDay: day('24/08/2026') },
  P2: { startDay: day('25/08/2026'), endDay: day('31/08/2026') },
  P3: { startDay: day('01/09/2026'), endDay: day('04/09/2026') },
};

const cell = (lines: number, documents: number, debitCents: number) => ({ lines, documents, debitCents });
const cat = (
  manual: ReturnType<typeof cell>,
  automatic: ReturnType<typeof cell>,
  mixedDocuments: number,
  unidentifiedLines = 0,
) => ({
  manual,
  automatic,
  mixedDocuments,
  totalDocuments: manual.documents + automatic.documents + mixedDocuments,
  unidentifiedLines,
});
const zero = cat(cell(0, 0, 0), cell(0, 0, 0), 0);

/** Consolidated panels (both sources). */
export const EXPECTED_PANELS = {
  P1: {
    deleted: cat(cell(1, 0, 1000), cell(0, 0, 0), 1),
    changed: cat(cell(1, 1, 0), cell(0, 0, 0), 0, 1),
    unbalanced: cat(cell(0, 0, 0), cell(2, 1, 5000), 0),
    posted: cat(cell(7, 3, 13500), cell(3, 1, 5000), 1),
  },
  P2: {
    deleted: cat(cell(1, 1, 0), cell(1, 0, 0), 0),
    changed: cat(cell(1, 1, 500), cell(0, 0, 0), 0),
    unbalanced: zero,
    posted: zero,
  },
  P3: {
    deleted: cat(cell(1, 1, 100), cell(1, 1, 5000), 0),
    changed: cat(cell(1, 1, 0), cell(0, 0, 0), 0),
    unbalanced: zero,
    posted: cat(cell(0, 0, 0), cell(2, 1, 700), 0),
  },
  full: {
    deleted: cat(cell(3, 2, 1100), cell(2, 1, 5000), 1),
    changed: cat(cell(3, 3, 500), cell(0, 0, 0), 0, 1),
    unbalanced: cat(cell(0, 0, 0), cell(2, 1, 5000), 0),
    posted: cat(cell(7, 3, 13500), cell(5, 2, 5700), 1),
  },
};

/** Documents in the order of the Documentos tab (date, lote, sublote, doc) and the base order of records. */
export const EXPECTED_DOCUMENT_ORDER = [KEYS.D1, KEYS.D2, KEYS.D3, KEYS.D4, KEYS.D5, KEYS.D7, KEYS.D6];
export const EXPECTED_BASE_ORDER = [1, 2, 3, 10, 11, 20, 21, 31, 32, 50, 51, 70, 60, 61, 40, 41, 42];
