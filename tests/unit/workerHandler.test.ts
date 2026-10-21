import { describe, expect, it } from 'vitest';
import { createCommandHandler } from '../../src/worker/handler';
import { cfgr700Worker } from '../../src/worker/modules/cfgr700';
import type { WorkerModules } from '../../src/worker/modules/registry';
import type { WorkerModule } from '../../src/worker/modules/types';
import type { WorkerEvent } from '../../src/shared/protocol';
import { defaultConfig } from '../../src/config/schema';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { fileA } from '../synthetic/fixtures';
import { buildWorkbook } from '../synthetic/workbook';

function setup(modules?: WorkerModules) {
  const events: WorkerEvent[] = [];
  const handle = createCommandHandler((e) => events.push(e), {}, modules);
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

describe('worker command handler with analysis modules (docs/MODULOS.md)', () => {
  const ingestA = (module?: 'cfgr700') => {
    const file = new File([buildCfgr700(fileA()) as Uint8Array<ArrayBuffer>], 'a.xlsx');
    return { type: 'ingest' as const, ...(module && { module }), files: [file], config: defaultConfig() };
  };
  const unavailable = (id: string) => ({
    type: 'error',
    stage: 'fileCheck',
    message: 'Esta análise ainda não está disponível nesta versão.',
    detail: id,
  });

  it('answers an ingest naming the CFGR700 module exactly as one without a module', async () => {
    // A fixed clock removes the measured durations from the reconciliation.
    const run = async (module?: 'cfgr700') => {
      const events: WorkerEvent[] = [];
      const handle = createCommandHandler((e) => events.push(e), { now: () => 0 });
      await handle(ingestA(module));
      const answers = events.filter((e) => e.type !== 'progress');
      events.length = 0;
      const options = { scope: 0, language: 'pt' as const, confirmFailures: false, generatedAt: '26/09/2026 10:00:00' };
      await handle({ type: 'export', requestId: 1, options });
      const exported = events.find((e) => e.type === 'exported');
      const bytes = exported?.type === 'exported' ? new Uint8Array(await exported.blob.arrayBuffer()) : null;
      return { answers, bytes };
    };
    const plain = await run();
    const named = await run('cfgr700');
    expect(named.answers.map((e) => e.type)).toEqual(['reconciliation', 'ready']);
    expect(named.answers).toEqual(plain.answers);
    expect(named.bytes).not.toBeNull();
    expect(named.bytes).toEqual(plain.bytes);
  });

  it('refuses a module that is not available, without keeping the previous session', async () => {
    // A version whose worker has only the CFGR700.
    const { events, handle } = setup({ cfgr700: cfgr700Worker });
    await handle(ingestA());
    events.length = 0;
    await handle({ type: 'ingest', module: 'ct2Integrity', files: [], config: defaultConfig() });
    expect(events).toEqual([unavailable('ct2Integrity')]);
    events.length = 0;
    await handle({ type: 'panel', requestId: 4, scope: 0, period: null, cutoffDay: null });
    expect(events).toEqual([{ type: 'error', stage: 'panel', message: expect.stringContaining('Nenhuma análise'), requestId: 4 }]);
  });

  it('refuses unknown module names, including names of object members, without throwing', async () => {
    for (const id of ['xyz', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const { events, handle } = setup();
      await handle({ type: 'ingest', module: id as never, files: [], config: defaultConfig() });
      expect(events).toEqual([unavailable(id)]);
    }
  });

  it('still refuses a configuration of an older version (the worker does not migrate it)', async () => {
    const { events, handle } = setup();
    await handle({ type: 'ingest', module: 'cfgr700', files: [], config: { ...defaultConfig(), schemaVersion: 1 } as never });
    expect(events).toEqual([{ type: 'error', stage: 'fileCheck', message: 'Configuração inválida.', detail: expect.any(String) }]);
  });

  it('dispatches to the session of the module, with a page limit of 2,000 rows and optional features', async () => {
    const calls: unknown[][] = [];
    const fake: WorkerModule = {
      configure: (config) => {
        if (config !== 'ok') throw new Error('bad config');
        return async () => ({
          reconciliation: { files: [] } as never,
          summary: { scopes: [] } as never,
          checks: [],
          session: {
            panel: (...args) => (calls.push(['panel', ...args]), { fake: true } as never),
            page: (...args) => (calls.push(['page', ...args]), { columns: [], rows: [], total: 0 }),
            export: async () => ({ blob: new Blob(['x']), fileName: 'f.xlsx' }),
          },
        });
      },
    };
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), {}, { cfgr700: fake });
    await handle({ type: 'ingest', module: 'cfgr700', files: [], config: 'ok' as never });
    expect(events.map((e) => e.type)).toEqual(['reconciliation', 'ready']);
    events.length = 0;
    await handle({ type: 'panel', requestId: 1, scope: 0, period: null, cutoffDay: 5 });
    await handle({ type: 'page', requestId: 2, scope: 0, table: 'documents', offset: 10, limit: 5000 });
    await handle({ type: 'export', requestId: 3, options: { scope: 0, language: 'pt', confirmFailures: false, generatedAt: 'x' } });
    await handle({ type: 'settings', requestId: 4, settings: { periodPresets: [], holidays: [] } });
    await handle({ type: 'setJustifications', requestId: 5, items: [], replace: true });
    await handle({ type: 'importJustifications', requestId: 6, file: new File([], 'j.json') });
    expect(calls).toEqual([
      ['panel', 0, null, 5],
      ['page', 0, 'documents', undefined, undefined, 10, 2000],
    ]);
    const notOffered = { type: 'error', message: 'Recurso não disponível nesta análise.' };
    expect(events).toEqual([
      { type: 'panel', requestId: 1, data: { fake: true } },
      { type: 'page', requestId: 2, table: 'documents', offset: 10, columns: [], rows: [], total: 0 },
      { type: 'exported', requestId: 3, blob: expect.any(Blob), fileName: 'f.xlsx' },
      { ...notOffered, stage: 'panel', requestId: 4 },
      { ...notOffered, stage: 'justifications', requestId: 5 },
      { ...notOffered, stage: 'justifications', requestId: 6 },
    ]);
  });

  it('answers queries a module does not offer (panel, tables, export) with an error carrying the request id', async () => {
    const reading: WorkerModule = {
      configure: () => async () => ({ reconciliation: { files: [] } as never, summary: { scopes: [] } as never, checks: [], session: {} }),
    };
    const events: WorkerEvent[] = [];
    const handle = createCommandHandler((e) => events.push(e), {}, { cfgr700: reading });
    await handle({ type: 'ingest', module: 'cfgr700', files: [], config: defaultConfig() });
    events.length = 0;
    await handle({ type: 'panel', requestId: 1, scope: 0, period: null, cutoffDay: null });
    await handle({ type: 'page', requestId: 2, scope: 0, table: 'documents', offset: 0, limit: 10 });
    await handle({ type: 'export', requestId: 3, options: { scope: 0, language: 'pt', confirmFailures: false, generatedAt: 'x' } });
    const notOffered = { type: 'error', message: 'Recurso não disponível nesta análise.' };
    expect(events).toEqual([
      { ...notOffered, stage: 'panel', requestId: 1 },
      { ...notOffered, stage: 'page', requestId: 2 },
      { ...notOffered, stage: 'export', requestId: 3 },
    ]);
  });
});
