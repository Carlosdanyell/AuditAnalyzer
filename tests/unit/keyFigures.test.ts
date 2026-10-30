import { describe, expect, it } from 'vitest';
import { cfgr700Figures } from '../../src/app/modules/cfgr700/figures';
import { ct2Figures } from '../../src/app/modules/ct2Integrity/figures';
import type { Reconciliation, ScopeStats, Summary } from '../../src/shared/modules/cfgr700';
import type { Ct2Reconciliation, Ct2Summary, Ct2TestResult } from '../../src/shared/modules/ct2Integrity';
import { parseDate, parseDateTime } from '../../src/shared/dates';

/** The strip of key figures under the header of the console (docs/INTERFACE.md, item 0). */
const asMap = (figures: { label: string; value: string; tone?: string }[]) => Object.fromEntries(figures.map((f) => [f.label, f.tone ? `${f.value} (${f.tone})` : f.value]));

describe('key figures of the CT2 integrity', () => {
  const reconciliation = { module: 'ct2Integrity', files: [], consolidated: { detailRows: 1038, alerts: [] }, checks: [], totalMs: 1 } as Ct2Reconciliation;
  const test = (code: Ct2TestResult['code'], occurrences: number, state: Ct2TestResult['state'] = 'on'): Ct2TestResult => ({ code, severity: 'error', state, occurrences, detail: null });
  const summary = (tests: Ct2TestResult[]): Ct2Summary => ({
    module: 'ct2Integrity',
    lines: 1038,
    segments: [],
    documents: 30,
    batches: 4,
    days: 21,
    firstDay: parseDate('01/09/2026'),
    lastDay: parseDate('31/10/2026'),
    analysis: {
      parameters: { periodStart: null, periodEnd: null, expectedBalanceType: '1', expectedCurrency: '01', localCurrency: '01', toleranceCents: 0, documentLineLimit: 999 },
      tests,
      exceptions: 19,
    },
  });

  it('shows lines, documents, batches, unbalanced documents, exceptions and the period', () => {
    expect(asMap(ct2Figures(reconciliation, summary([test('B1', 6)]), 0))).toEqual({
      Linhas: '1.038',
      Documentos: '30',
      Lotes: '4',
      Desbalanceados: '6 (error)',
      Exceções: '19 (warn)',
      Período: '01/09/2026 a 31/10/2026',
    });
  });

  it('leaves the unbalanced documents out when B1 did not run, and marks nothing when there is none', () => {
    expect(asMap(ct2Figures(reconciliation, summary([test('B1', 0, 'off')]), 0))).not.toHaveProperty('Desbalanceados');
    expect(asMap(ct2Figures(reconciliation, summary([test('B1', 0)]), 0)).Desbalanceados).toBe('0');
  });

  it('shows the lines read when the summary has not come yet', () => {
    expect(asMap(ct2Figures(reconciliation, null, 0))).toEqual({ Linhas: '1.038' });
  });
});

describe('key figures of the CFGR700 log', () => {
  const file = (detailRows: number, first: string, last: string) => ({
    rows: { detailRows },
    firstEvent: parseDateTime(first),
    lastEvent: parseDateTime(last),
  });
  const reconciliation = {
    files: [file(600, '02/08/2026 08:00:00', '31/08/2026 18:00:00'), file(400, '01/09/2026 09:00:00', '30/09/2026 17:00:00')],
    consolidated: { detailRows: 1000, events: [], totalEvents: 0, firstEvent: null, lastEvent: null, alerts: [] },
    checks: [],
    totalMs: 1,
  } as unknown as Reconciliation;
  const stats = (documents: number, deleted: number, changed: number, unbalanced: number) =>
    ({ documents, deletedRecords: deleted, alterations: { effective: changed }, unbalancedCompleteDocuments: unbalanced }) as unknown as ScopeStats;
  const summary: Summary = {
    scopes: [
      { label: 'agosto.xlsx', sources: [0], stats: stats(12, 3, 5, 0) },
      { label: 'setembro.xlsx', sources: [1], stats: stats(9, 0, 2, 1) },
      { label: 'Consolidado', sources: [0, 1], stats: stats(20, 3, 7, 1) },
    ],
  };

  it('follows the scope chosen: lines and period of its files, and its statistics', () => {
    expect(asMap(cfgr700Figures(reconciliation, summary, 2))).toEqual({
      Linhas: '1.000',
      Documentos: '20',
      'Partidas excluídas': '3',
      'Alterações efetivas': '7',
      Desbalanceados: '1 (error)',
      Período: '02/08/2026 a 30/09/2026',
    });
    expect(asMap(cfgr700Figures(reconciliation, summary, 0))).toMatchObject({ Linhas: '600', Desbalanceados: '0', Período: '02/08/2026 a 31/08/2026' });
  });

  it('shows the lines read when the summary has not come yet', () => {
    expect(asMap(cfgr700Figures(reconciliation, null, 0))).toEqual({ Linhas: '1.000' });
  });
});
