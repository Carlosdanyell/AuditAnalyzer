/**
 * Synthetic CT2 extraction for the analysis (docs/REGRAS_CT2_INTEGRIDADE.md, sections 5, 6 and 11): one case per
 * rule, with the exceptions expected worked out by hand below. Period of the run: every month read, 01/09/2026 to
 * 31/10/2026 (decision of 29/10/2026); E5 comes only with a period informed for September. Holiday 07/09/2026 (a
 * Monday); 19/09/2026 is a Saturday. No real data.
 */
import type { Ct2Field } from '../../src/config/ct2IntegritySchema';
import { ct2Line, type Ct2LineRow, type Ct2Value } from './ct2Extraction';

type Fields = Partial<Record<Ct2Field, Ct2Value>>;

/** Double entry of `amount` reais (the same in "Valor Moeda1"). */
const pd = (amount: number, f: Fields = {}) => ct2Line({ amount, amountCurrency1: amount, ...f });
const debit = (amount: number, f: Fields = {}) => ct2Line({ entryType: 'Debito', creditAccount: null, amount, amountCurrency1: amount, ...f });
const credit = (amount: number, f: Fields = {}) => ct2Line({ entryType: 'Credito', debitAccount: null, amount, amountCurrency1: amount, ...f });
const doc = (date: string, batch: string, document: string) => ({ date, batch, document });

const D10 = doc('15/09/2026', '000002', '000010');
const BATCH4 = doc('16/09/2026', '000004', '');
const BATCH6 = doc('16/09/2026', '000006', '');
const at = (base: typeof BATCH4, document: string, line: string, f: Fields = {}): Fields => ({ ...base, document, line, ...f });

export const ENGINE_HOLIDAYS = ['07/09/2026'];

/** Rows in reading order; the Base sorts them (the days are out of order on purpose). */
export const ENGINE_ROWS: Ct2LineRow[] = [
  // 17/09, batch 000005: +5, −5, +5. B4: 60 ← next 61; 61 ← next 62 (the next first); 62 ← previous 61. B2, B3.
  debit(5, doc('17/09/2026', '000005', '000060')),
  credit(5, doc('17/09/2026', '000005', '000061')),
  debit(5, doc('17/09/2026', '000005', '000062')),
  // 15/09, batch 000001: balanced, nothing.
  pd(100, { ...doc('15/09/2026', '000001', '000001'), line: '001' }),
  // 15/09, batch 000002: document 10 with 1.000 lines (001-999 + A00) +50, compensated by document 11 (−50).
  ...Array.from({ length: 999 }, (_, i) => pd(1, { ...D10, line: String(i + 1).padStart(3, '0') })),
  debit(50, { ...D10, line: 'A00' }),
  credit(50, doc('15/09/2026', '000002', '000011')),
  // 15/09, batch 000003: document 20 +10 without compensation (21 is balanced). B1, B5, B2 and B3 on 15/09.
  debit(10, { ...doc('15/09/2026', '000003', '000020'), routine: 'CTBA500' }),
  pd(10, doc('15/09/2026', '000003', '000021')),
  // 16/09, batch 000004: consistency of the line, every document balanced.
  pd(10, at(BATCH4, '000030', '001', { creditAccount: null })), // I1: double entry without credit account
  debit(10, at(BATCH4, '000031', '001', { creditAccount: '21101001' })), // I1: debit with credit account
  credit(10, at(BATCH4, '000031', '002')),
  debit(5, at(BATCH4, '000032', '001')),
  credit(5, at(BATCH4, '000032', '002', { creditAccount: null })), // I1: credit without credit account
  pd(10, at(BATCH4, '000033', '001')),
  ct2Line(at(BATCH4, '000033', '002', { entryType: 'Cont.Hist', debitAccount: '11101001', creditAccount: null, amount: null, amountCurrency1: null })), // I1
  pd(10, at(BATCH4, '000034', '001')),
  ct2Line(at(BATCH4, '000034', '002', { entryType: 'Cont.Hist', debitAccount: null, creditAccount: null, amount: 5, amountCurrency1: null })), // I1
  ct2Line(at(BATCH4, '000035', '001', { entryType: 'XYZ', amount: 10, amountCurrency1: 10 })), // I1: unknown type
  pd(0, at(BATCH4, '000036', '001')), // I2
  pd(-5, at(BATCH4, '000036', '002')), // I2
  pd(10, at(BATCH4, '000037', '001', { creditAccount: '11101001' })), // I3
  ct2Line(at(BATCH4, '000038', '001', { amount: 10, amountCurrency1: 9 })), // I4
  ct2Line(at(BATCH4, '000038', '002', { amount: 10, amountCurrency1: null })), // out of I4 (no value to compare)
  pd(10, at(BATCH4, '000039', '001', { history: '   ' })), // I5
  // 16/09, batch 000006: structure.
  pd(10, at(BATCH6, '000040', '001')),
  pd(10, at(BATCH6, '000040', '001')), // E1 (and E2: 2 lines, last ordinal 1)
  pd(10, at(BATCH6, '000041', '001')),
  pd(10, at(BATCH6, '000041', '003')), // E2: last ordinal 3 for 2 lines
  pd(10, at(BATCH6, '000042', '001', { balanceType: '2' })), // E3, segment 2/01
  pd(10, at(BATCH6, '000043', '001', { currency: '02' })), // E4, segment 1/02
  pd(10, at(BATCH6, '000047', '001', { ctkSequence: '000123', standardEntry: '610' })), // P3: Seq CTK in documents 47 and 48
  pd(10, at(BATCH6, '000048', '001', { ctkSequence: '000123', standardEntry: '610' })),
  pd(10, at(BATCH6, '000049', '001', { ctkSequence: '000200' })), // P3: two Seq CTK in document 49
  pd(10, at(BATCH6, '000049', '002', { ctkSequence: '000201' })),
  pd(10, at(BATCH6, '000050', '001', { ctkSequence: '000300' })), // document 50 in two segments: no E1, no P3
  pd(10, at(BATCH6, '000050', '001', { ctkSequence: '000300', currency: '02' })), // E4
  // 01/10 (E5 when the period is September), 19/09 (Saturday, E6), 07/09 (holiday, E6).
  pd(10, { ...doc('01/10/2026', '000007', '000044'), line: '001' }),
  pd(10, { ...doc('19/09/2026', '000008', '000045'), line: '001', manual: '2' }),
  pd(10, { ...doc('07/09/2026', '000009', '000046'), line: '001', manual: null }),
];

/**
 * Exceptions (Erro and Alerta) with the default configuration, in the order of the list: by test, then in the order
 * of the Base (segment 1/01, then 1/02, then 2/01; date, batch, document, line). Lines as document-line; a segment
 * other than 1/01 in brackets.
 */
export const ENGINE_EXCEPTIONS = [
  'B1 doc 000002/000010',
  'B1 doc 000002/000011',
  'B1 doc 000003/000020',
  'B1 doc 000005/000060',
  'B1 doc 000005/000061',
  'B1 doc 000005/000062',
  'B2 lote 15/09/2026 000003',
  'B2 lote 17/09/2026 000005',
  'B3 dia 15/09/2026',
  'B3 dia 17/09/2026',
  'B5 doc 000003/000020',
  'I1 linha 000030-001',
  'I1 linha 000031-001',
  'I1 linha 000032-002',
  'I1 linha 000033-002',
  'I1 linha 000034-002',
  'I1 linha 000035-001',
  'I2 linha 000036-001',
  'I2 linha 000036-002',
  'I3 linha 000037-001',
  'I4 linha 000038-001',
  'I5 linha 000039-001',
  'E1 linha 000040-001',
  'E3 linha 000042-001 [2/01]',
  'E4 linha 000043-001 [1/02]',
  'E4 linha 000050-001 [1/02]',
];

/** With the period informed as September only: the line of 01/10 is outside it. */
export const ENGINE_E5 = 'E5 linha 000044-001';

/** Results of the Info tests and of B4. */
export const ENGINE_INFO = {
  B4: {
    '000010': 'Compensa doc 000011',
    '000011': 'Compensa doc 000010',
    '000020': 'Sem compensação',
    '000060': 'Compensa doc 000061',
    '000061': 'Compensa doc 000062',
    '000062': 'Compensa doc 000061',
  },
  E2: ['000040', '000041'],
  E6: ['07/09/2026', '19/09/2026'],
  P3: ['000047', '000048', '000049'],
  P4: ['000010'],
};
