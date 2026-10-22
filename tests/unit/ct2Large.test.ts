import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { writeLargeCt2, type LargeCt2Options } from '../synthetic/ct2Large';

/** The streaming generator of the measurements, small: its own totals must match the reading of the file. */
function build(o: LargeCt2Options) {
  const chunks: Uint8Array[] = [];
  const expected = writeLargeCt2((c) => chunks.push(c), o);
  return { blob: new Blob(chunks as Uint8Array<ArrayBuffer>[]), expected };
}

describe('large synthetic CT2 extraction', () => {
  it('is read back with the totals computed while writing, in one or two files', async () => {
    const a = build({ rows: 3000, seed: 1, firstDate: '01/09/2026', days: 5, firstBatch: 0 });
    const b = build({ rows: 2000, seed: 2, firstDate: '01/10/2026', days: 3, firstBatch: 5000 });
    const one = await ingestCt2([{ name: 'a.xlsx', blob: a.blob }], ct2DefaultConfig(), () => {});
    expect(one.reconciliation.checks.map((c) => [c.id, c.passed])).toEqual([
      ['ct2-reading', true],
      ['ct2-order', true],
      ['ct2-values', true],
    ]);
    expect(one.reconciliation.files[0]!.rows).toMatchObject({ detailRows: a.expected.detailRows, blankRows: 0, outsideCells: 0, balanced: true });
    const { segments, documents, batches, days } = a.expected;
    expect(one.summary).toMatchObject({ lines: a.expected.detailRows, segments, documents, batches, days, firstDay: parseDate('01/09/2026'), lastDay: parseDate('05/09/2026') });
    // The document of 1,100 lines keeps its lines after 999 in text order, after 999.
    const line = one.store.text.line;
    const after999 = Array.from(one.order).map((i) => line.get(i)).filter((l) => typeof l === 'string' && /^[A-Z]/.test(l));
    expect(after999.slice(0, 3)).toEqual(['A00', 'A01', 'A02']);
    expect(after999.at(-1)).toBe('B00');

    const two = await ingestCt2([{ name: 'a.xlsx', blob: a.blob }, { name: 'b.xlsx', blob: b.blob }], ct2DefaultConfig(), () => {});
    expect(two.summary.lines).toBe(a.expected.detailRows + b.expected.detailRows);
    expect(two.summary.documents).toBe(a.expected.documents + b.expected.documents);
    expect(two.reconciliation.checks.every((c) => c.passed)).toBe(true);
  });
});
