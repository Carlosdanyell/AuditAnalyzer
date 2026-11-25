/** The module Plano de contas on the platform: descriptor, probe, worker session and export (docs/MODULOS.md). */
import { describe, expect, it } from 'vitest';
import { chartDefaultConfig } from '../../src/config/chartOfAccountsSchema';
import { chartOfAccountsModule } from '../../src/modules/chartOfAccounts/module';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import { getModule, suggestModule } from '../../src/modules/registry';
import type { AvailableModule } from '../../src/modules/types';
import { isChartPeriod, isChartReconciliation, isChartSummary, type ChartReconciliation, type ChartSummary } from '../../src/shared/modules/chartOfAccounts';
import type { Command, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { probeWorkbook } from '../../src/worker/ingest/probe';
import { readWorkbookData } from '../support/xlsxStyles';
import { BASE_EXPECTED, chartCsv, chartFile, withAccount } from '../synthetic/chartOfAccountsFixture';

describe('descriptor of the Plano de contas', () => {
  it('is registered with the export only, one .csv, its stages and its own help section', () => {
    const m = chartOfAccountsModule;
    expect(getModule('chartOfAccounts')).toBe(m);
    expect(m).toMatchObject({ status: 'available', id: 'chartOfAccounts', title: 'Plano de contas', shortTitle: 'CT1', helpAnchor: 'chartOfAccounts', icon: 'accounts' });
    expect(m.accepts).toEqual({ extensions: ['.csv'], maxFiles: 1 });
    expect(m.features).toEqual({ panel: false, findings: false, tables: false, justifications: false, export: true });
    expect(m.progress.stages.map((s) => s.id)).toEqual(['fileCheck', 'rows', 'checks', 'transform']);
    expect(m.config.saved).toBe(false);
    expect(m.config.defaults()).toEqual(chartDefaultConfig());
    expect(m.preview).toMatch(/^Prévia/);
  });

  it('validates the period MM.AAAA', () => {
    for (const ok of ['01.2026', '11.2026', '12.1999']) expect(isChartPeriod(ok), ok).toBe(true);
    for (const bad of ['13.2026', '00.2026', '1.2026', '11/2026', '11.26', ' 11.2026', '']) expect(isChartPeriod(bad), bad).toBe(false);
  });
});

describe('probe of the start screen', () => {
  it('reads the CSV as a text sample, which only this module recognizes', async () => {
    const samples = await probeWorkbook(chartFile(), 30);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.format).toBe('text');
    expect(samples[0]!.rows[0]!.titles[0]).toBe('0;CT1;CVD');
    expect(chartOfAccountsModule.detect(samples, chartDefaultConfig())).toBe('match');
    const config = (m: AvailableModule) => m.config.defaults();
    expect(reconciliationModule.detect(samples, reconciliationModule.config.defaults())).toBe('no');
    expect(suggestModule(reconciliationModule as unknown as AvailableModule, [samples], config)?.module.id).toBe('chartOfAccounts');
    expect(cfgr700Module.detect(samples, cfgr700Module.config.defaults())).toBe('no');
  });

  it('recognizes the file without the control line, by the CT1 header', async () => {
    const samples = await probeWorkbook(chartFile(chartCsv({ control: null })), 30);
    expect(chartOfAccountsModule.detect(samples, chartDefaultConfig())).toBe('match');
  });

  it('does not take another text file', () => {
    expect(chartOfAccountsModule.detect([{ name: '', format: 'text', rows: [{ r: 1, titles: ['conta;descricao'] }] }], chartDefaultConfig())).toBe('no');
  });
});

async function session(file: File = chartFile()) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e));
  await handle({ type: 'ingest', module: 'chartOfAccounts', files: [file], config: chartDefaultConfig() });
  const exportWith = async (chart: { period: string | null } | undefined, confirmFailures = false) => {
    const before = events.length;
    const command: Command = { type: 'export', requestId: 7, options: { scope: 0, language: 'pt', confirmFailures, generatedAt: '25/11/2026 10:00:00', ...(chart && { chart }) } };
    await handle(command);
    return events.slice(before).filter((e) => e.type !== 'progress');
  };
  return { events, exportWith };
}

describe('the module in the worker', () => {
  it('reads, validates and transforms in four stages, then sends the reconciliation and the summary', async () => {
    const { events } = await session();
    const stages = [...new Set(events.filter((e) => e.type === 'progress').map((e) => (e as { stage: string }).stage))];
    expect(stages).toEqual(['fileCheck', 'rows', 'checks', 'transform']);
    const recon = events.find((e) => e.type === 'reconciliation') as { data: ChartReconciliation };
    expect(isChartReconciliation(recon.data)).toBe(true);
    expect(recon.data.file).toMatchObject({ name: 'plano-sintetico.csv', encoding: 'windows-1252', ct1Records: 39, cvdRecords: 12, ct1HeaderLine: 2, cvdHeaderLine: 42, controlTables: ['CT1', 'CVD'] });
    expect(recon.data.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recon.data.checks.map((c) => c.id)).toEqual(['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09']);
    expect(recon.data.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['A02', 'A03', 'A04', 'A08', 'A09']);
    expect(recon.data.checks.find((c) => c.id === 'A02')).toMatchObject({ severity: 'warning', label: 'A02 · Conta analítica com vínculo CVD', message: expect.stringMatching(/^2 ocorrência\(s\)\. linha 16: /) });
    const ready = events.find((e) => e.type === 'ready') as { summary: ChartSummary };
    expect(isChartSummary(ready.summary)).toBe(true);
    expect(ready.summary).toMatchObject({ accounts: BASE_EXPECTED.accounts, synthetic: BASE_EXPECTED.synthetic, blocking: 0 });
  });

  it('exports the workbook with the period in the names; none when the period is left out', async () => {
    const { exportWith } = await session();
    const [withPeriod] = await exportWith({ period: '11.2026' });
    expect(withPeriod).toMatchObject({ type: 'exported', fileName: 'Plano_de_Contas_plano-sintetico_11.2026.xlsx' });
    const data = readWorkbookData(new Uint8Array(await (withPeriod as { blob: Blob }).blob.arrayBuffer()));
    expect(data.sheets.map((s) => s.name)).toEqual(['Doc-01-Plano de Contas 11.2026']);
    const [plain] = await exportWith(undefined);
    expect(plain).toMatchObject({ type: 'exported', fileName: 'Plano_de_Contas_plano-sintetico.xlsx' });
  });

  it('refuses an invalid period', async () => {
    const { exportWith } = await session();
    expect(await exportWith({ period: '13.2026' })).toEqual([{ type: 'error', stage: 'export', requestId: 7, message: expect.stringContaining('MM.AAAA') }]);
  });

  it('never exports with a blocking error, even when confirmed, and shows the account and the line', async () => {
    const { events, exportWith } = await session(chartFile(chartCsv({ accounts: withAccount('11103', { sup: '119' }) })));
    const recon = events.find((e) => e.type === 'reconciliation') as { data: ChartReconciliation };
    const e05 = recon.data.issues.find((i) => i.code === 'E05')!;
    expect(e05.occurrences).toEqual([{ line: 13, accounts: ['11103', '119'], text: expect.any(String) }]);
    for (const confirm of [false, true]) {
      const [answer] = await exportWith({ period: null }, confirm);
      expect(answer).toMatchObject({ type: 'exportBlocked', failures: [{ id: 'E05', passed: false, severity: 'error' }] });
    }
  });

  it('reads a UTF-8 file the same way', async () => {
    const { events } = await session(chartFile(chartCsv(), 'plano.csv', 'utf-8'));
    const recon = events.find((e) => e.type === 'reconciliation') as { data: ChartReconciliation };
    expect(recon.data.file.encoding).toBe('utf-8');
    expect((events.find((e) => e.type === 'ready') as { summary: ChartSummary }).summary.accounts).toBe(39);
  });

  it('takes one .csv only', async () => {
    const events: WorkerEvent[] = [];
    await createCommandHandler((e) => events.push(e))({ type: 'ingest', module: 'chartOfAccounts', files: [chartFile(), chartFile(undefined, 'b.csv')], config: chartDefaultConfig() });
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', stage: 'fileCheck', message: expect.stringContaining('único arquivo .csv') }]);
    events.length = 0;
    await createCommandHandler((e) => events.push(e))({ type: 'ingest', module: 'chartOfAccounts', files: [chartFile(undefined, 'plano.txt')], config: chartDefaultConfig() });
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', stage: 'fileCheck', message: expect.stringContaining('.csv') }]);
  });
});
