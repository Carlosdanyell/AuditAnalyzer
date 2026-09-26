import { describe, expect, it } from 'vitest';
import { createCommandHandler } from '../../src/worker/handler';
import type { WorkerEvent } from '../../src/shared/protocol';
import { defaultConfig } from '../../src/config/schema';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { fileA } from '../synthetic/fixtures';
import { buildWorkbook } from '../synthetic/workbook';

function setup() {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e));
  return { events, handle };
}

describe('worker command handler', () => {
  it('ingests files and answers with reconciliation, then ready', async () => {
    const { events, handle } = setup();
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t !== 'progress')).toEqual(['reconciliation', 'ready']);
    const recon = events.find((e) => e.type === 'reconciliation');
    expect(recon?.type === 'reconciliation' && recon.data.files[0]!.rows.detailRows).toBe(9);
  });

  it('answers an empty ingest with a Portuguese error', async () => {
    const { events, handle } = setup();
    await handle({ type: 'ingest', files: [], config: defaultConfig() });
    expect(events).toEqual([{ type: 'error', stage: 'fileCheck', message: 'Nenhum arquivo selecionado.' }]);
  });

  it('rejects an invalid configuration', async () => {
    const { events, handle } = setup();
    await handle({ type: 'ingest', files: [], config: { ...defaultConfig(), table: '' } });
    expect(events[0]).toMatchObject({ type: 'error', message: 'Configuração inválida.' });
  });

  it('answers panel and page queries after an ingestion, echoing the request id', async () => {
    const { events, handle } = setup();
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    events.length = 0;
    await handle({ type: 'panel', requestId: 7, scope: 0, period: null, cutoffDay: null });
    await handle({ type: 'page', requestId: 8, scope: 0, table: 'baseRows', offset: 0, limit: 2 });
    const [panel, page] = events;
    expect(panel).toMatchObject({ type: 'panel', requestId: 7 });
    expect(page).toMatchObject({ type: 'page', requestId: 8, table: 'baseRows', offset: 0 });
    expect(page?.type === 'page' && page.rows).toHaveLength(2);
  });

  it('applies new presets and holidays without reprocessing the files', async () => {
    const { events, handle } = setup();
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    events.length = 0;
    const settings = { periodPresets: [{ label: 'Início', start: '01/09/2026', end: '02/09/2026' }], holidays: ['07/09/2026'] };
    await handle({ type: 'settings', requestId: 3, settings });
    await handle({ type: 'panel', requestId: 4, scope: 0, period: null, cutoffDay: null });
    const [answer, panel] = events;
    expect(answer).toEqual({ type: 'settings', requestId: 3, settings });
    expect(panel?.type === 'panel' && panel.data.presets.map((p) => p.label)).toContain('Início');
    expect(panel?.type === 'panel' && panel.data.settings).toEqual(settings);
  });

  it('answers queries without an ingestion with an error carrying the request id', async () => {
    const { events, handle } = setup();
    await handle({ type: 'panel', requestId: 1, scope: 0, period: null, cutoffDay: null });
    await handle({ type: 'page', requestId: 2, scope: 0, table: 'documents', offset: 0, limit: 50 });
    expect(events.map((e) => e.type === 'error' && e.requestId)).toEqual([1, 2]);
  });

  it('applies justifications and previews an import of a previous export', async () => {
    const { events, handle } = setup();
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    events.length = 0;
    const justification = {
      documentKey: 'x',
      kind: 'deletion' as const,
      text: 'Motivo',
      responsible: '',
      coverage: { files: ['a.xlsx'], lastEvent: null },
      updatedAt: 1,
    };
    await handle({ type: 'setJustifications', requestId: 5, items: [justification], replace: true });
    expect(events[0]).toEqual({ type: 'justificationsSet', requestId: 5, count: 1, unknown: 1 });
    const previous = new File(
      [buildWorkbook({ 'Justificativa da Exclusao': [['Documento', 'Justificativa da exclusão'], ['x', 'Motivo']] }) as Uint8Array<ArrayBuffer>],
      'anterior.xlsx',
    );
    await handle({ type: 'importJustifications', requestId: 6, file: previous });
    expect(events[1]).toMatchObject({
      type: 'justificationImport',
      requestId: 6,
      preview: { items: [{ documentKey: 'x', kind: 'deletion' }], coverage: { method: 'nenhum' }, unknownKeys: 1 },
    });
  });

  it('answers the export command with the workbook, echoing the request id', async () => {
    const { events, handle } = setup();
    const options = { scope: 0, language: 'pt' as const, confirmFailures: false, generatedAt: '26/09/2026 10:00:00' };
    await handle({ type: 'export', requestId: 7, options });
    expect(events).toEqual([{ type: 'error', stage: 'export', message: expect.stringContaining('Nenhuma análise'), requestId: 7 }]);
    events.length = 0;
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    await handle({ type: 'ingest', files: [file], config: defaultConfig() });
    events.length = 0;
    await handle({ type: 'export', requestId: 8, options });
    const done = events.filter((e) => e.type !== 'progress');
    expect(done).toEqual([{ type: 'exported', requestId: 8, blob: expect.any(Blob), fileName: 'Papel de trabalho CFGR700 - a - 2026-09-26.xlsx' }]);
    expect(events.some((e) => e.type === 'progress' && e.stage === 'export')).toBe(true);
  });

  it('ignores cancel (cancellation is done by terminating the worker)', async () => {
    const { events, handle } = setup();
    await handle({ type: 'cancel' });
    expect(events).toEqual([]);
  });

  it('reports malformed messages instead of throwing', async () => {
    const { events, handle } = setup();
    await handle({ type: 'nonsense' } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', stage: 'worker' });
  });
});
