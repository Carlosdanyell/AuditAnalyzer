import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { checkOrder, sortBase, sortKeys } from '../../src/worker/modules/ct2Integrity/order';
import { Ct2Store, type TextField } from '../../src/worker/modules/ct2Integrity/store';

/**
 * Order of the Base (docs/REGRAS_CT2_INTEGRIDADE.md, section 3): segment, document key, line, company and branch of
 * origin, ties in reading order; CI-2 proves that every document, batch and day is a contiguous block.
 */
const config = ct2DefaultConfig();
type Line = Partial<Record<TextField, string>> & { date?: string };

function store(lines: Line[]): Ct2Store {
  const s = new Ct2Store();
  lines.forEach((l, i) =>
    s.pushRow({
      source: 0,
      sourceRow: i + 4,
      day: parseDate(l.date ?? '15/09/2026'),
      amount: 100,
      amountCurrency1: NaN,
      entryType: 1,
      flags: 0,
      text: { batch: '000001', subBatch: '001', document: '000001', line: '001', balanceType: '1', currency: '01', ...l },
    }),
  );
  return s;
}

const sorted = (s: Ct2Store) => {
  const keys = sortKeys(s, config);
  const order = sortBase(keys, s.rows);
  return { keys, order, rows: Array.from(order, (i) => i) };
};

describe('order of the Base', () => {
  it('sorts by segment, date, batch, sub-batch, document and line, ties in reading order', () => {
    const s = store([
      { document: '000002', line: '001' },
      { currency: '02', line: '001' },
      { document: '000001', line: '002' },
      { date: '14/09/2026' },
      { batch: '000002' },
      { line: '001' },
      { balanceType: '0' },
      { line: '001' },
    ]);
    // Expected: segment 0/01 (row 6); 1/01: 14/09 (3), then 15/09 batch 1: doc 1 lines 001 (5, 7), 002 (2), doc 2 (0); batch 2 (4); 1/02 (1).
    expect(sorted(s).rows).toEqual([6, 3, 5, 7, 2, 0, 4, 1]);
  });

  it('compares texts by their code units, with no language rules', () => {
    const s = store([{ document: 'a' }, { document: 'B' }, { document: '0' }]);
    expect(sorted(s).rows).toEqual([2, 1, 0]);
  });

  it('puts the lines after 999 in the order of their text (A00, A01, ...)', () => {
    const lines = ['A01', '999', 'A00', '001', '010', 'B00', '100'];
    expect(sorted(store(lines.map((line) => ({ line })))).rows.map((i) => lines[i])).toEqual(['001', '010', '100', '999', 'A00', 'A01', 'B00']);
  });

  it('keeps the same line of two currencies apart (two segments) and identical line keys adjacent', () => {
    const s = store([{ currency: '02' }, { line: '002' }, {}, { currency: '02' }, {}]);
    expect(sorted(s).rows).toEqual([2, 4, 1, 0, 3]);
  });
});

describe('CI-2: contiguous blocks', () => {
  const lines: Line[] = [
    { document: '000001', line: '001' },
    { document: '000001', line: '002' },
    { document: '000002', line: '001' },
    { batch: '000002', document: '000001' },
    { date: '16/09/2026' },
    { currency: '02' },
  ];

  it('passes for the sorted Base and counts segments, days, batches and documents', () => {
    const s = store(lines);
    const { keys, order } = sorted(s);
    expect(checkOrder(keys, order, config)).toEqual({ ok: true, problem: null, segments: 2, days: 3, batches: 4, documents: 5 });
  });

  it('fails when two rows are out of order or a row is missing or repeated', () => {
    const s = store(lines);
    const { keys, order } = sorted(s);
    const swapped = order.slice();
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(checkOrder(keys, swapped, config)).toMatchObject({ ok: false, problem: 'Linhas 2 e 3 da base fora da ordem da chave.' });
    const repeated = order.slice();
    repeated[5] = repeated[0]!;
    expect(checkOrder(keys, repeated, config)).toMatchObject({ ok: false, problem: 'A base não contém cada linha lida exatamente uma vez.' });
  });
});
