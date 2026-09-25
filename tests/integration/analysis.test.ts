import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { FULL_PERIOD, periodPanel } from '../../src/worker/engine/periods';
import { synthBlob } from '../synthetic/cfgr700';
import { EVENTS, EXPECTED_PANELS, EXPECTED_STATS, PERIODS } from '../synthetic/engineFixture';
import { toReportRows } from '../synthetic/logBuilder';

async function ingestFixture() {
  return runIngestion(
    [
      { name: 'agosto.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 0), parameters: { 'Data inicial': '17/08/2026', 'Data final': '31/08/2026' } }) },
      { name: 'setembro.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 1), parameters: { 'Data inicial': '01/09/2026', 'Data final': '04/09/2026' } }) },
    ],
    defaultConfig(),
    () => {},
  );
}

describe('analysis after ingesting two synthetic .xlsx files', () => {
  it('produces the per-file and consolidated statistics', async () => {
    const result = await ingestFixture();
    expect(result.summary.scopes.map((s) => [s.label, s.sources])).toEqual([
      ['agosto.xlsx', [0]],
      ['setembro.xlsx', [1]],
      ['Consolidado', [0, 1]],
    ]);
    expect(result.summary.scopes.map((s) => s.stats)).toEqual([
      EXPECTED_STATS.august,
      EXPECTED_STATS.september,
      EXPECTED_STATS.consolidated,
    ]);
  });

  it('keeps the analyses for the panel and reproduces the consolidated panels', async () => {
    const result = await ingestFixture();
    const consolidated = result.analyses.at(-1)!;
    expect(periodPanel(consolidated, PERIODS.P1)).toEqual(EXPECTED_PANELS.P1);
    expect(periodPanel(consolidated, FULL_PERIOD)).toEqual(EXPECTED_PANELS.full);
  });

  it('passes all invariants and runs the documents stage', async () => {
    const events: string[] = [];
    const result = await runIngestion(
      [{ name: 'agosto.xlsx', blob: synthBlob({ rows: toReportRows(EVENTS, 0) }) }],
      defaultConfig(),
      (e) => e.type === 'progress' && events.push(e.stage),
    );
    expect(new Set(events)).toContain('documents');
    const checks = Object.fromEntries(result.reconciliation.checks.map((c) => [c.id, c.passed]));
    expect(checks).toMatchObject({
      'rows-reconciliation': true,
      'events-by-operation': true,
      'alteration-classification': true,
      'balance-type': true,
      'base-contiguity': true,
      'period-partition': true,
      'data-quality': true,
    });
    expect(result.summary.scopes).toHaveLength(1);
  });

  it('fails "Valores legíveis" on an unreadable CT2_VALOR', async () => {
    const bad = EVENTS.filter((e) => (e.source ?? 0) === 0).map((e) =>
      e.recno === 1 && e.op === 'Inclusão' ? { ...e, fields: { ...e.fields, CT2_VALOR: '100,00' } } : e,
    );
    const result = await runIngestion(
      [{ name: 'a.xlsx', blob: synthBlob({ rows: toReportRows(bad) }) }],
      defaultConfig(),
      () => {},
    );
    const quality = result.reconciliation.checks.find((c) => c.id === 'data-quality')!;
    expect(quality.passed).toBe(false);
    expect(quality.message).toMatch(/1 valor\(es\) ilegível\(is\)/);
    expect(result.reconciliation.files[0]!.invalid.value).toBe(1);
  });
});
