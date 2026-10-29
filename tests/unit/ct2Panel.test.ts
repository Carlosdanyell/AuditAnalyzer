import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { analyzeCt2 } from '../../src/worker/modules/ct2Integrity/analysis';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { ct2Panel } from '../../src/worker/modules/ct2Integrity/panel';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';

/** Panel of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, section 9; decisions of 29/10/2026). */
async function engine() {
  const config = ct2DefaultConfig();
  const base = await ingestCt2([{ name: 'sintetico.xlsx', blob: ct2Blob({ rows: ENGINE_ROWS }) }], config, () => {});
  const analysis = analyzeCt2(base, config, new Set(ENGINE_HOLIDAYS.map(parseDate)));
  return { base, analysis, config };
}

describe('CT2 panel', async () => {
  const { base, analysis } = await engine();
  const all = ct2Panel(base, analysis, null);

  it('lists the segments for the selector and shows every segment by default', () => {
    expect(all.segment).toBeNull();
    expect(all.segments.map((s) => s.label)).toEqual(['Saldo 1 · Moeda 01', 'Saldo 1 · Moeda 02', 'Saldo 2 · Moeda 01']);
    expect(all.parameters).toEqual(analysis.parameters);
    expect(all.indicators.map((r) => [r.balanceType, r.currency, r.documents, r.lines])).toEqual([
      ['1', '01', 27, 1035],
      ['1', '02', 2, 2],
      ['2', '01', 1, 1],
    ]);
    expect(all.totals).toEqual({ days: 8, batches: all.indicators.reduce((n, r) => n + r.batches, 0), documents: 30, lines: 1038, unbalancedDocuments: 6 });
    expect(all.exceptions).toEqual({ error: 19, warning: 7 });
  });

  it('ties out the levels (matrix) and gives the board of the engine, each test with its table', () => {
    expect(all.matrix.map((m) => [m.level, m.lines, m.ok])).toEqual([
      ['base', 1038, true],
      ['documents', 1038, true],
      ['batches', 1038, true],
      ['days', 1038, true],
    ]);
    for (const t of analysis.tests) expect(all.board.find((b) => b.code === t.code)!.occurrences, t.code).toBe(t.occurrences);
    const link = (code: string) => all.board.find((b) => b.code === code)!.link;
    expect([link('B1'), link('I1'), link('E5'), link('B4'), link('E2'), link('E6'), link('P1')]).toEqual(['ct2Exceptions', 'ct2Exceptions', 'ct2Exceptions', 'ct2Documents', 'ct2Documents', 'ct2Days', null]);
  });

  it('lists the unbalanced documents with the adjacent offset and the largest documents with the limit', () => {
    expect(all.unbalanced.total).toBe(6);
    expect(all.unbalanced.rows.map((r) => `${r.document} ${r.differenceCents} ${r.compensation}`)).toEqual([
      '000010 5000 Compensa doc 000011',
      '000011 -5000 Compensa doc 000010',
      '000020 1000 Sem compensação',
      '000060 500 Compensa doc 000061',
      '000061 -500 Compensa doc 000062',
      '000062 500 Compensa doc 000061',
    ]);
    expect(all.largest.limit).toBe(1000);
    expect(all.largest.rows[0]).toMatchObject({ document: '000010', lines: 1000, atLimit: true });
    expect(all.largest.rows).toHaveLength(10);
    expect(all.largest.atLimit).toBe(1);
  });

  it('cuts every number by the segment chosen', () => {
    const s = ct2Panel(base, analysis, 1);
    expect(s.segment).toBe(1);
    expect(s.indicators.map((r) => r.currency)).toEqual(['02']);
    expect(s.totals).toMatchObject({ documents: 2, lines: 2 });
    const occurrences = Object.fromEntries(s.board.filter((b) => b.occurrences > 0).map((b) => [b.code, b.occurrences]));
    expect(occurrences).toEqual({ E4: 2, P1: 2, P2: 1 });
    expect(s.unbalanced.total).toBe(0);
    expect(s.profile.routines.map((g) => g.currency)).toEqual(['02']);
    expect(s.matrix.every((m) => m.ok && m.lines === 2)).toBe(true);
    expect(() => ct2Panel(base, analysis, 9)).toThrow(/Segmento 9/);
  });
});
